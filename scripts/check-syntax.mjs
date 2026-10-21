/**
 * Syntax-check every JavaScript file the app ships.
 *
 * `node --check` parses one file at a time, so this list used to live in
 * package.json and went stale the moment a module was added: a new file could
 * carry a syntax error and `npm run check` still exited zero. Walking the two
 * source trees is the version of that list that cannot go stale.
 *
 * This is a parse check, not a test run — it catches a broken brace or a stray
 * token before the server is restarted, which is the failure that otherwise
 * shows up as a blank page or a dead API route.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const files = [
  ...walk(join(ROOT, 'server')),
  ...walk(join(ROOT, 'public', 'js')),
  ...walk(join(ROOT, 'scripts')),
];

let failed = 0;
for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status === 0) continue;
  failed += 1;
  console.log(`FAIL  ${relative(ROOT, file)}`);
  const message = (res.stderr || res.stdout || '').trim();
  if (message) console.log(message.split('\n').map((l) => `      ${l}`).join('\n'));
}

console.log(failed === 0
  ? `\nall ${files.length} files parse\n`
  : `\n${failed} of ${files.length} files failed to parse\n`);
process.exit(failed === 0 ? 0 : 1);
