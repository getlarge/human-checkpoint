import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'templates/request-queue.html',
  'templates/hardware-setup.html',
  'templates/technician-workspace.html',
  'flows/flows.json',
  'settings.cjs',
];

await Promise.all(required.map((file) => access(resolve(root, file))));
JSON.parse(await readFile(resolve(root, 'flows/flows.json'), 'utf8'));
