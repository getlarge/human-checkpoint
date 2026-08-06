const { createDecipheriv, createHash } = require('node:crypto');

function createHumanCheckpointAuth(input) {
  const configured = Boolean(
    input.cookieSecret &&
    input.expectedOrigin &&
    input.moltNetUrl &&
    input.teamId,
  );
  const authorizedTokens = new Map();

  return {
    middleware: async (request, response, next) => {
      const pathname = requestPath(request);
      if (PUBLIC_AUTH_PATHS.has(pathname)) return next();

      if (!configured) {
        return sendText(
          response,
          503,
          'Human Checkpoint authentication is not configured. Complete the local bootstrap and restart Node-RED.',
        );
      }

      const session = readSession(request.headers?.cookie, input.cookieSecret);
      if (!session || session.expiresAt <= Date.now()) {
        if (isBrowserNavigation(request)) {
          const returnTo = safeReturnTo(
            request.originalUrl || request.url || '/dashboard/',
            input,
          );
          response.redirect(
            303,
            `/dashboard/auth/login?return_to=${encodeURIComponent(returnTo)}`,
          );
          return;
        }
        return sendText(
          response,
          401,
          'Sign in to access this service request.',
        );
      }

      const allowed = await hasTeamAccess(
        session.accessToken,
        input,
        authorizedTokens,
      );
      if (!allowed) {
        clearSession(response, input.expectedOrigin);
        return sendText(
          response,
          403,
          'Your account does not have access to this service team.',
        );
      }

      request.humanCheckpointSession = session;
      return next();
    },
    ioMiddleware: async (socket, next) => {
      const session = readSession(
        socket.handshake?.headers?.cookie,
        input.cookieSecret,
      );
      if (!session || session.expiresAt <= Date.now()) {
        return next(new Error('Human Checkpoint sign-in required'));
      }
      const allowed = await hasTeamAccess(
        session.accessToken,
        input,
        authorizedTokens,
      );
      if (!allowed) {
        return next(new Error('Human Checkpoint team access required'));
      }
      socket.humanCheckpointSession = session;
      return next();
    },
  };
}

const PUBLIC_AUTH_PATHS = new Set([
  '/dashboard/auth/login',
  '/dashboard/auth/consent',
  '/dashboard/auth/callback',
  '/dashboard/api/session',
]);

async function hasTeamAccess(token, input, cache) {
  const key = createHash('sha256').update(token).digest('hex');
  const cached = cache.get(key);
  if (cached?.expiresAt > Date.now()) return true;
  cache.delete(key);
  try {
    const response = await fetch(
      `${String(input.moltNetUrl).replace(/\/+$/, '')}/teams/${encodeURIComponent(input.teamId)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return false;
    cache.set(key, { expiresAt: Date.now() + 60_000 });
    return true;
  } catch {
    return false;
  }
}

function readSession(cookieHeader, secret) {
  const sealed = cookieValue(cookieHeader, 'hc_session');
  if (!sealed || !secret) return null;
  try {
    const bytes = Buffer.from(sealed, 'base64url');
    if (bytes.length < 29) return null;
    const key = createHash('sha256').update(secret).digest();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString('utf8'),
    );
    return typeof value?.accessToken === 'string' &&
      typeof value?.expiresAt === 'number'
      ? value
      : null;
  } catch {
    return null;
  }
}

function cookieValue(header, name) {
  for (const pair of String(header || '').split(';')) {
    const index = pair.indexOf('=');
    if (index > 0 && pair.slice(0, index).trim() === name) {
      return decodeURIComponent(pair.slice(index + 1).trim());
    }
  }
  return null;
}

function requestPath(request) {
  return new URL(
    request.originalUrl || request.url || '/',
    'http://human-checkpoint.local',
  ).pathname;
}

function isBrowserNavigation(request) {
  return (
    ['GET', 'HEAD'].includes(request.method) &&
    String(request.headers?.accept || '').includes('text/html')
  );
}

function safeReturnTo(raw, input) {
  try {
    const url = new URL(raw || '/dashboard/', input.expectedOrigin);
    if (
      url.origin === new URL(input.expectedOrigin).origin &&
      url.pathname.startsWith('/dashboard/') &&
      !url.pathname.startsWith('/dashboard/auth/')
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {}
  return '/dashboard/ui/requests';
}

function clearSession(response, expectedOrigin) {
  const secure = String(expectedOrigin).startsWith('https://')
    ? '; Secure'
    : '';
  response.setHeader(
    'set-cookie',
    `hc_session=; HttpOnly; SameSite=Lax; Path=/dashboard; Max-Age=0${secure}`,
  );
}

function sendText(response, status, body) {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(body);
}

module.exports = { createHumanCheckpointAuth };
