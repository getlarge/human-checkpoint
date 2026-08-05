import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { createSigningProxy } from './proxy.js';
import {
  clearSessionCookie,
  cookieValue,
  HUMAN_OIDC_SCOPE,
  type SealedSession,
  sealCookie,
  sessionCookie,
  unsealCookie,
} from './session.js';
import { workflowStore } from './workflow-store.js';

interface RequestLike {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query: Record<string, unknown>;
  params?: Record<string, string>;
}
interface ResponseLike {
  status(code: number): ResponseLike;
  setHeader(name: string, value: string | string[]): void;
  json(value: unknown): void;
  send(value: string): void;
  sendFile(path: string): void;
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
  const customerId =
    env.HUMAN_CHECKPOINT_DEMO_CUSTOMER_ID ?? 'CUST-NORTH-WATER';
  const publicDirectory = env.HUMAN_CHECKPOINT_DASHBOARD_PUBLIC_DIR ?? '';
  const store = workflowStore();

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
    response.redirect('/dashboard/requests/');
  });

  RED.httpNode.get('/dashboard/', (_request, response) => {
    response.redirect('/dashboard/requests/');
  });

  RED.httpNode.get('/dashboard/requests/', (_request, response) => {
    noStore(response);
    response.sendFile(join(publicDirectory, 'requests/index.html'));
  });

  RED.httpNode.get('/dashboard/hardware-setup/', (_request, response) => {
    noStore(response);
    response.sendFile(join(publicDirectory, 'hardware-setup/index.html'));
  });

  RED.httpNode.get('/dashboard/technician-briefing/', (_request, response) => {
    noStore(response);
    response.sendFile(join(publicDirectory, 'technician-briefing/index.html'));
  });

  RED.httpNode.get('/dashboard/app.css', (_request, response) => {
    noStore(response);
    response.sendFile(join(publicDirectory, 'app.css'));
  });

  RED.httpNode.get('/dashboard/app.js', (_request, response) => {
    noStore(response);
    response.sendFile(join(publicDirectory, 'app.js'));
  });

  RED.httpNode.get('/dashboard/api/config', (_request, response) => {
    noStore(response);
    response.json({
      teamId,
      signerUrl: env.HUMAN_CHECKPOINT_SIGNER_URL ?? 'http://127.0.0.1:17373',
      serviceRequestId: 'SR-2048',
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

  RED.httpNode.get('/dashboard/auth/consent', async (request, response) => {
    noStore(response);
    try {
      if (env.HUMAN_CHECKPOINT_LOCAL_AUTO_CONSENT !== 'true') {
        return response.status(404).send('Not found');
      }
      const adminUrl = env.HUMAN_CHECKPOINT_HYDRA_ADMIN_URL ?? '';
      if (!isLoopbackUrl(adminUrl)) {
        throw new Error('Local consent requires a loopback Hydra admin URL');
      }
      const challenge = request.query.consent_challenge;
      if (typeof challenge !== 'string' || !challenge) {
        throw new Error('Missing consent challenge');
      }
      const encoded = encodeURIComponent(challenge);
      const pendingResponse = await fetch(
        `${adminUrl.replace(/\/+$/, '')}/admin/oauth2/auth/requests/consent?consent_challenge=${encoded}`,
      );
      const pending = (await pendingResponse.json()) as Record<string, unknown>;
      if (!pendingResponse.ok) {
        throw new Error(`Consent lookup failed (${pendingResponse.status})`);
      }
      const client = pending.client as Record<string, unknown> | undefined;
      if (client?.client_id !== env.HUMAN_CHECKPOINT_HUMAN_CLIENT_ID) {
        throw new Error('Consent request is for an unexpected client');
      }
      const allowedScopes = new Set(HUMAN_OIDC_SCOPE.split(' '));
      const requestedScopes = Array.isArray(pending.requested_scope)
        ? pending.requested_scope.filter(
            (scope): scope is string =>
              typeof scope === 'string' && allowedScopes.has(scope),
          )
        : [];
      const acceptResponse = await fetch(
        `${adminUrl.replace(/\/+$/, '')}/admin/oauth2/auth/requests/consent/accept?consent_challenge=${encoded}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_scope: requestedScopes,
            remember: false,
            session: { access_token: {}, id_token: {} },
          }),
        },
      );
      const accepted = (await acceptResponse.json()) as Record<string, unknown>;
      if (!acceptResponse.ok || typeof accepted.redirect_to !== 'string') {
        throw new Error(`Consent acceptance failed (${acceptResponse.status})`);
      }
      response.redirect(accepted.redirect_to);
    } catch (error) {
      response
        .status(400)
        .send(error instanceof Error ? error.message : String(error));
    }
  });

  RED.httpNode.get('/dashboard/api/requests', (request, response) => {
    noStore(response);
    const rawStatus = request.query.status;
    const status =
      rawStatus === 'open' ||
      rawStatus === 'pending-review' ||
      rawStatus === 'closed'
        ? rawStatus
        : undefined;
    response.json({
      requests: store.listSupportRequestsForCustomer(customerId, status),
    });
  });

  RED.httpNode.get('/dashboard/api/requests/:id', (request, response) => {
    noStore(response);
    const id = request.params?.id ?? '';
    const supportRequest = store.getSupportRequestForCustomer(id, customerId);
    if (!supportRequest)
      return response.status(404).json({ error: 'Support request not found' });
    response.json({
      request: supportRequest,
      reusableHistory: store.listReusableHistory(supportRequest.id),
    });
  });

  RED.httpNode.get(
    '/dashboard/api/workflows/recoverable',
    (_request, response) => {
      noStore(response);
      response.json({
        workflows: store
          .listRecoverableWorkflows()
          .filter((snapshot) => snapshot.request.customerId === customerId),
      });
    },
  );

  RED.httpNode.get('/dashboard/api/workflows/:id', (request, response) => {
    noStore(response);
    try {
      const snapshot = store.getWorkflowSnapshot(request.params?.id ?? '');
      if (snapshot.request.customerId !== customerId) {
        return response.status(404).json({ error: 'Workflow not found' });
      }
      response.json(snapshot);
    } catch {
      response.status(404).json({ error: 'Workflow not found' });
    }
  });

  RED.httpNode.all(
    '/dashboard/api/requests/:id/workflow',
    (request, response) => {
      noStore(response);
      if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
      }
      const id = request.params?.id ?? '';
      const supportRequest = store.getSupportRequestForCustomer(id, customerId);
      if (!supportRequest) {
        return response
          .status(404)
          .json({ error: 'Support request not found' });
      }
      if (supportRequest.status !== 'open') {
        return response
          .status(409)
          .json({ error: 'Only open support requests can start work' });
      }
      const workflow = store.startWorkflow(id);
      response.status(201).json(store.getWorkflowSnapshot(workflow.id));
    },
  );

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
    response.redirect('/dashboard/hardware-setup/');
  });

  RED.httpNode.all('/dashboard/api/signing/*', async (request, response) => {
    const raw =
      request.body === undefined
        ? undefined
        : Buffer.from(JSON.stringify(request.body));
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

function safeReturnTo(value: string | undefined): string {
  if (!value) return '/dashboard/requests/';
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
  return '/dashboard/requests/';
}
