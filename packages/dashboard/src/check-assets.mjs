import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'public/app.css',
  'public/app.js',
  'public/hardware-setup/index.html',
  'public/technician-briefing/index.html',
  'flows/flows.json',
  'settings.cjs',
];

await Promise.all(required.map((file) => access(resolve(root, file))));
JSON.parse(await readFile(resolve(root, 'flows/flows.json'), 'utf8'));
