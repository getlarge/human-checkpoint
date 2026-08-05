const PREFIX = '/dashboard/api/signing';
const MAX_BODY_BYTES = 64 * 1024;

const ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/crypto\/signing-credentials(?:\?[^#]*)?$/ },
  { method: 'POST', pattern: /^\/crypto\/signing-credentials\/registrations$/ },
  {
    method: 'POST',
    pattern:
      /^\/crypto\/signing-credentials\/registrations\/[0-9a-f-]{36}\/complete$/i,
  },
  {
    method: 'POST',
    pattern: /^\/crypto\/signing-credentials\/[0-9a-f-]{36}\/approve$/i,
  },
  { method: 'GET', pattern: /^\/crypto\/signing-requests(?:\?[^#]*)?$/ },
  { method: 'GET', pattern: /^\/crypto\/signing-requests\/[0-9a-f-]{36}$/i },
  {
    method: 'POST',
    pattern:
      /^\/crypto\/signing-requests\/[0-9a-f-]{36}\/(?:claim|complete|reject)$/i,
  },
];

export interface SigningProxyRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body?: Uint8Array;
}
export interface SigningProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface SigningProxyOptions {
  moltNetUrl: string;
  teamId: string;
  expectedOrigin: string;
  getAccessToken: (cookieHeader: string | undefined) => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}

export function createSigningProxy(options: SigningProxyOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return async (
    request: SigningProxyRequest,
  ): Promise<SigningProxyResponse> => {
    const headers = {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    };
    try {
      if (!request.url.startsWith(PREFIX))
        return response(404, 'route_not_found', headers);
      const upstreamPath = request.url.slice(PREFIX.length) || '/';
      if (
        !ROUTES.some(
          (route) =>
            route.method === request.method && route.pattern.test(upstreamPath),
        )
      ) {
        return response(405, 'method_or_route_not_allowed', headers);
      }
      const mutation = request.method !== 'GET';
      if (mutation) {
        if (request.headers.origin !== options.expectedOrigin)
          return response(403, 'origin_rejected', headers);
        if (
          !request.headers['content-type']
            ?.toLowerCase()
            .startsWith('application/json')
        ) {
          return response(415, 'json_required', headers);
        }
        const length = request.body?.byteLength ?? 0;
        const declared = Number(request.headers['content-length'] ?? length);
        if (length > MAX_BODY_BYTES || declared > MAX_BODY_BYTES)
          return response(413, 'body_too_large', headers);
      }
      const token = await options.getAccessToken(request.headers.cookie);
      if (!token) return response(401, 'sign_in_required', headers);
      const upstream = await fetchImpl(
        new URL(upstreamPath, options.moltNetUrl),
        {
          method: request.method,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'x-moltnet-team-id': options.teamId,
          },
          ...(mutation && request.body
            ? { body: Buffer.from(request.body) }
            : {}),
          redirect: 'manual',
        },
      );
      const raw = await upstream.text();
      let body = raw;
      if (raw) body = JSON.stringify(redactTokens(JSON.parse(raw) as unknown));
      return { status: upstream.status, headers, body };
    } catch (error) {
      return response(
        502,
        error instanceof Error ? error.message : String(error),
        headers,
      );
    }
  };
}

function response(
  status: number,
  code: string,
  headers: Record<string, string>,
): SigningProxyResponse {
  return { status, headers, body: JSON.stringify({ error: code }) };
}

function redactTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTokens);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          ![
            'access_token',
            'refresh_token',
            'id_token',
            'client_secret',
          ].includes(key),
      )
      .map(([key, child]) => [key, redactTokens(child)]),
  );
}
