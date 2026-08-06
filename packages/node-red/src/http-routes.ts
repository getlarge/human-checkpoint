import { createHash, randomBytes } from 'node:crypto';
import { createSigningProxy, MAX_SIGNING_BODY_BYTES } from './proxy.js';
import { workflowStore } from './workflow-store.js';
import {
  clearSessionCookie,
  cookieValue,
  HUMAN_OIDC_SCOPE,
  type SealedSession,
  sealCookie,
  sessionCookie,
  unsealCookie,
} from './session.js';

interface RequestLike {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query: Record<string, unknown>;
  params?: Record<string, string>;
  [Symbol.asyncIterator]?(): AsyncIterator<unknown>;
}
interface ResponseLike {
  status(code: number): ResponseLike;
  setHeader(name: string, value: string | string[]): void;
  json(value: unknown): void;
  send(value: string | Buffer): void;
  redirect(url: string): void;
}
interface HttpRouter {
  use(
    handler: (
      request: RequestLike,
      response: ResponseLike,
      next: () => void,
    ) => void | Promise<void>,
  ): void;
  get(
    path: string,
    handler: (
      request: RequestLike,
      response: ResponseLike,
    ) => void | Promise<void>,
  ): void;
  all(
    path: string,
    handler: (
      request: RequestLike,
      response: ResponseLike,
    ) => void | Promise<void>,
  ): void;
}
interface RedWithHttp {
  httpNode?: HttpRouter;
}

let installed = false;

export function installHttpRoutesFromEnvironment(RED: RedWithHttp): void {
  if (installed || !RED.httpNode) return;
  installed = true;
  const middleware = (
    RED as RedWithHttp & {
      settings?: { httpNodeMiddleware?: Parameters<HttpRouter['use']>[0] };
    }
  ).settings?.httpNodeMiddleware;
  if (!middleware) {
    throw new Error(
      'Human Checkpoint requires fail-closed HTTP node middleware',
    );
  }
  RED.httpNode.use(middleware);
  const env = process.env;
  const port = env.HUMAN_CHECKPOINT_PORT ?? '1880';
  const expectedOrigin =
    env.HUMAN_CHECKPOINT_ORIGIN ?? `http://localhost:${port}`;
  const redirectUri = `${expectedOrigin}/dashboard/auth/callback`;
  const secure = expectedOrigin.startsWith('https://');
  const cookieSecret = env.HUMAN_CHECKPOINT_COOKIE_SECRET ?? '';
  const teamId = env.HUMAN_CHECKPOINT_TEAM_ID ?? '';
  const moltNetUrl = env.HUMAN_CHECKPOINT_MOLTNET_URL ?? '';

  const proxy = createSigningProxy({
    moltNetUrl,
    teamId,
    expectedOrigin,
    async getAccessToken(cookieHeader) {
      if (!cookieSecret) return null;
      const sealed = cookieValue(cookieHeader, 'hc_session');
      if (!sealed) return null;
      try {
        const session = unsealCookie<SealedSession>(sealed, cookieSecret);
        return session.expiresAt > Date.now() ? session.accessToken : null;
      } catch {
        return null;
      }
    },
  });

  RED.httpNode.get('/', (_request, response) => {
    response.redirect('/dashboard/ui/requests');
  });

  RED.httpNode.get('/dashboard/', (_request, response) => {
    response.redirect('/dashboard/ui/requests');
  });

  RED.httpNode.get('/dashboard/api/config', (_request, response) => {
    noStore(response);
    response.json({
      teamId,
      signerUrl: env.HUMAN_CHECKPOINT_SIGNER_URL ?? 'http://127.0.0.1:17373',
    });
  });

  RED.httpNode.get('/dashboard/api/session', (request, response) => {
    noStore(response);
    const sealed = cookieValue(header(request, 'cookie'), 'hc_session');
    let authenticated = false;
    if (sealed && cookieSecret) {
      try {
        authenticated =
          unsealCookie<SealedSession>(sealed, cookieSecret).expiresAt >
          Date.now();
      } catch {
        authenticated = false;
      }
    }
    response.status(authenticated ? 200 : 401).json({
      authenticated,
      ...(authenticated ? { logoutUrl: '/dashboard/auth/logout' } : {}),
    });
  });

  RED.httpNode.get('/dashboard/api/attachments/:id', (request, response) => {
    noStore(response);
    const id = String(request.params?.id ?? '');
    if (!isRequestAttachmentId(id)) {
      response.status(400).send('Invalid attachment ID.');
      return;
    }
    const attachment = workflowStore().getSupportRequestAttachment(id);
    if (!attachment) {
      response.status(404).send('Attachment not found.');
      return;
    }
    response.setHeader('content-type', attachment.mediaType);
    response.setHeader('content-length', String(attachment.byteLength));
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-disposition', `inline; filename="${id}.webp"`);
    response.send(Buffer.from(attachment.content));
  });

  RED.httpNode.get('/dashboard/auth/login', (_request, response) => {
    const missing = requiredEnv(env, [
      'HUMAN_CHECKPOINT_HUMAN_AUTHORIZE_URL',
      'HUMAN_CHECKPOINT_HUMAN_CLIENT_ID',
      'HUMAN_CHECKPOINT_COOKIE_SECRET',
    ]);
    if (missing)
      return response.status(503).json({ error: `Missing ${missing}` });
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const returnTo = safeReturnTo(
      typeof _request.query.return_to === 'string'
        ? _request.query.return_to
        : undefined,
    );
    const transaction = sealCookie(
      { state, verifier, returnTo, expiresAt: Date.now() + 300_000 },
      cookieSecret,
    );
    response.setHeader(
      'set-cookie',
      `hc_oidc_tx=${transaction}; HttpOnly; SameSite=Lax; Path=/dashboard/auth; Max-Age=300${secure ? '; Secure' : ''}`,
    );
    const authorize = new URL(env.HUMAN_CHECKPOINT_HUMAN_AUTHORIZE_URL!);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: env.HUMAN_CHECKPOINT_HUMAN_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: HUMAN_OIDC_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    response.redirect(authorize.toString());
  });

  RED.httpNode.get('/dashboard/auth/consent', async (request, response) => {
    noStore(response);
    try {
      await acceptLocalConsent(request, response, {
        hydraAdminUrl: env.HUMAN_CHECKPOINT_HYDRA_ADMIN_URL ?? '',
        clientId: env.HUMAN_CHECKPOINT_HUMAN_CLIENT_ID ?? '',
      });
    } catch (error) {
      response
        .status(500)
        .send(error instanceof Error ? error.message : String(error));
    }
  });

  RED.httpNode.get('/dashboard/auth/callback', async (request, response) => {
    noStore(response);
    try {
      const missing = requiredEnv(env, [
        'HUMAN_CHECKPOINT_HUMAN_TOKEN_URL',
        'HUMAN_CHECKPOINT_HUMAN_CLIENT_ID',
        'HUMAN_CHECKPOINT_HUMAN_CLIENT_SECRET',
        'HUMAN_CHECKPOINT_COOKIE_SECRET',
      ]);
      if (missing) throw new Error(`Missing ${missing}`);
      const sealed = cookieValue(header(request, 'cookie'), 'hc_oidc_tx');
      if (!sealed) throw new Error('Missing OIDC transaction');
      const transaction = unsealCookie<{
        state: string;
        verifier: string;
        returnTo: string;
        expiresAt: number;
      }>(sealed, cookieSecret);
      if (
        transaction.expiresAt <= Date.now() ||
        request.query.state !== transaction.state ||
        typeof request.query.code !== 'string'
      )
        throw new Error('Invalid or expired OIDC callback');
      const tokenResponse = await fetch(env.HUMAN_CHECKPOINT_HUMAN_TOKEN_URL!, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: request.query.code,
          redirect_uri: redirectUri,
          client_id: env.HUMAN_CHECKPOINT_HUMAN_CLIENT_ID!,
          client_secret: env.HUMAN_CHECKPOINT_HUMAN_CLIENT_SECRET!,
          code_verifier: transaction.verifier,
        }),
      });
      const token = (await tokenResponse.json()) as Record<string, unknown>;
      if (!tokenResponse.ok || typeof token.access_token !== 'string')
        throw new Error('OIDC token exchange failed');
      const teamResponse = await fetch(
        `${moltNetUrl.replace(/\/+$/, '')}/teams/${encodeURIComponent(teamId)}`,
        { headers: { authorization: `Bearer ${token.access_token}` } },
      );
      if (!teamResponse.ok)
        throw new Error(
          'This account is not a member of the demo service team',
        );
      const session: SealedSession = {
        accessToken: token.access_token,
        expiresAt:
          Date.now() +
          (typeof token.expires_in === 'number' ? token.expires_in : 3600) *
            1000,
        ...(typeof token.refresh_token === 'string'
          ? { refreshToken: token.refresh_token }
          : {}),
      };
      response.setHeader('set-cookie', [
        sessionCookie(sealCookie(session, cookieSecret), secure),
        `hc_oidc_tx=; HttpOnly; SameSite=Lax; Path=/dashboard/auth; Max-Age=0${secure ? '; Secure' : ''}`,
      ]);
      response.redirect(safeReturnTo(transaction.returnTo));
    } catch (error) {
      response
        .status(400)
        .send(error instanceof Error ? error.message : String(error));
    }
  });

  RED.httpNode.get('/dashboard/auth/logout', (_request, response) => {
    response.setHeader('set-cookie', clearSessionCookie(secure));
    response.redirect(humanLogoutTarget(env.HUMAN_CHECKPOINT_HUMAN_LOGOUT_URL));
  });

  RED.httpNode.all('/dashboard/api/signing/*', async (request, response) => {
    const streamed = await readSigningRequestBody(request);
    const raw = streamed.tooLarge
      ? Buffer.alloc(MAX_SIGNING_BODY_BYTES + 1)
      : streamed.body;
    const proxied = await proxy({
      method: request.method,
      url: request.originalUrl,
      headers: {
        origin: header(request, 'origin'),
        cookie: header(request, 'cookie'),
        'content-type': header(request, 'content-type'),
        'content-length': header(request, 'content-length'),
      },
      ...(raw ? { body: raw } : {}),
    });
    response.status(proxied.status);
    for (const [name, value] of Object.entries(proxied.headers))
      response.setHeader(name, value);
    response.send(proxied.body);
  });
}

export async function acceptLocalConsent(
  request: Pick<RequestLike, 'query'>,
  response: Pick<ResponseLike, 'status' | 'send' | 'redirect'>,
  input: { hydraAdminUrl: string; clientId: string },
): Promise<void> {
  const challenge =
    typeof request.query.consent_challenge === 'string'
      ? request.query.consent_challenge
      : '';
  if (!challenge) {
    response.status(400).send('Missing consent challenge.');
    return;
  }
  if (!input.hydraAdminUrl || !input.clientId) {
    response.status(503).send('Local consent is not configured.');
    return;
  }
  const adminUrl = input.hydraAdminUrl.replace(/\/+$/, '');
  const encoded = encodeURIComponent(challenge);
  const pending = await fetch(
    `${adminUrl}/admin/oauth2/auth/requests/consent?consent_challenge=${encoded}`,
  );
  if (!pending.ok)
    throw new Error(`Consent lookup failed with HTTP ${pending.status}`);
  const consent = (await pending.json()) as {
    client?: { client_id?: unknown };
    requested_scope?: unknown;
  };
  if (consent.client?.client_id !== input.clientId) {
    response
      .status(403)
      .send('Consent is only available for the local dashboard client.');
    return;
  }
  const scopes = Array.isArray(consent.requested_scope)
    ? consent.requested_scope.filter(
        (scope): scope is string => typeof scope === 'string',
      )
    : [];
  const allowedScopes = new Set(HUMAN_OIDC_SCOPE.split(' '));
  if (scopes.some((scope) => !allowedScopes.has(scope))) {
    response.status(403).send('The dashboard requested an unsupported scope.');
    return;
  }
  const accepted = await fetch(
    `${adminUrl}/admin/oauth2/auth/requests/consent/accept?consent_challenge=${encoded}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_scope: scopes,
        remember: true,
        remember_for: 3600,
      }),
    },
  );
  if (!accepted.ok)
    throw new Error(`Consent acceptance failed with HTTP ${accepted.status}`);
  const result = (await accepted.json()) as { redirect_to?: unknown };
  if (typeof result.redirect_to !== 'string' || !result.redirect_to) {
    throw new Error('Consent acceptance returned no redirect.');
  }
  response.redirect(result.redirect_to);
}

export async function readSigningRequestBody(
  request: Pick<RequestLike, 'body' | 'method'> &
    Partial<AsyncIterable<unknown>>,
): Promise<{ body?: Buffer; tooLarge: boolean }> {
  if (request.body !== undefined) {
    const body = encodeRequestBody(request.body);
    return {
      ...(body.byteLength <= MAX_SIGNING_BODY_BYTES ? { body } : {}),
      tooLarge: body.byteLength > MAX_SIGNING_BODY_BYTES,
    };
  }
  if (
    request.method === 'GET' ||
    typeof request[Symbol.asyncIterator] !== 'function'
  ) {
    return { tooLarge: false };
  }
  const chunks: Buffer[] = [];
  let length = 0;
  let tooLarge = false;
  for await (const chunk of request as AsyncIterable<unknown>) {
    const bytes = encodeRequestBody(chunk);
    length += bytes.byteLength;
    if (length <= MAX_SIGNING_BODY_BYTES) chunks.push(bytes);
    else tooLarge = true;
  }
  return {
    ...(tooLarge ? {} : { body: Buffer.concat(chunks, length) }),
    tooLarge,
  };
}

function encodeRequestBody(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  return Buffer.from(JSON.stringify(value) ?? '');
}

function header(request: RequestLike, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
function noStore(response: ResponseLike) {
  response.setHeader('cache-control', 'no-store');
}
function requiredEnv(env: NodeJS.ProcessEnv, names: string[]): string | null {
  return names.find((name) => !env[name]) ?? null;
}

function isLoopbackUrl(value: string): boolean {
  try {
    return ['127.0.0.1', 'localhost', '::1'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function humanLogoutTarget(value: string | undefined): string {
  return value && isLoopbackUrl(value) ? value : '/dashboard/ui/hardware-setup';
}

export function isRequestAttachmentId(value: string): boolean {
  return /^ATT-[0-9]{3,12}$/.test(value);
}

function safeReturnTo(value: string | undefined): string {
  if (!value) return '/dashboard/ui/requests';
  try {
    const url = new URL(value, 'http://human-checkpoint.local');
    if (
      url.origin === 'http://human-checkpoint.local' &&
      url.pathname.startsWith('/dashboard/') &&
      !url.pathname.startsWith('/dashboard/auth/')
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {}
  return '/dashboard/ui/requests';
}
