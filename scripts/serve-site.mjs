#!/usr/bin/env node
// Static server for the docs/ site. The page loads ES modules and fetches the
// evidence record, so it needs an http origin; file:// leaves the gate console
// and the verifier dead.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../docs/', import.meta.url));
const port = Number(process.env.PORT ?? 8899);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requested = decodeURIComponent(url.pathname);
  // Resolve inside root so ../ cannot escape the served directory.
  const candidate = resolve(root, `.${normalize(requested)}`);
  if (candidate !== root.slice(0, -1) && !candidate.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  let file = candidate;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
    await stat(file);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  response.writeHead(200, {
    'content-type':
      TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(
    `Human Checkpoint site → http://127.0.0.1:${port}/\nserving ${root}\n`,
  );
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    process.stderr.write(
      `Port ${port} is already in use. Stop the other server, or run PORT=8900 pnpm run site:serve\n`,
    );
    process.exit(1);
  }
  throw error;
});
