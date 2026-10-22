/**
 * A look for text that was read as one encoding and written as another.
 *
 * The house style keeps a Thai comment's dashes and its box-drawing characters
 * in the file. A machine whose default code page is CP874 will read a UTF-8
 * file as CP874 and hand back Thai letters that spell nothing; written out as
 * UTF-8 again, the damage is doubled and cannot be undone by reading it a
 * second time.
 *
 * The tell is a run of those letters in a place where a dash or a line should
 * be. This walks the source and says where it finds them, and can put the
 * characters back:
 *
 *   node scripts/check-encoding.mjs          look
 *   node scripts/check-encoding.mjs --fix    look, and put them back
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIX = process.argv.includes('--fix');

const ROOTS = ['server', 'public', 'scripts', 'data'];
const EXTS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.md', '.yml']);
const TOP = ['README.md', 'PROGRESS.md', 'render.yaml'];

// The code page's decoder, and the table that turns a character back into the
// byte it came from.
const CP874 = new TextDecoder('windows-874');
const REVERSE = new Map();
for (let b = 0; b < 256; b += 1) {
  const ch = CP874.decode(Uint8Array.of(b))[0];
  if (ch !== undefined && !REVERSE.has(ch)) REVERSE.set(ch, b);
}
const toCp874 = (text) => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const b = REVERSE.get(text[i]);
    out[i] = b === undefined ? 0x3f : b; // '?' for anything the page cannot hold
  }
  return out;
};

// What a box-drawing character or an em-dash looks like after the round trip.
const MOJIBAKE = /\u0E42\u201D\u20AC|\u0E44\u201D\u20AC|\u0E45\u201D\u20AC/;

const files = [];
const walk = (dir) => {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (name === 'node_modules' || name === '.git') continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (EXTS.has(name.slice(name.lastIndexOf('.')))) files.push(path);
  }
};
for (const root of ROOTS) walk(join(ROOT, root));
for (const name of TOP) files.push(join(ROOT, name));

let damaged = 0;
for (const file of files) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (!MOJIBAKE.test(text)) continue;
  damaged += 1;
  const at = text.indexOf(text.match(MOJIBAKE)[0]);
  const where = relative(ROOT, file);
  if (FIX) {
    // One turn back: the text as it stands, encoded as CP874, is the bytes
    // the original file was made of.
    const original = new TextDecoder('utf-8').decode(toCp874(text));
    if (!MOJIBAKE.test(original)) {
      writeFileSync(file, Buffer.from(original, 'utf8'));
      console.log(`repaired ${where}`);
      continue;
    }
  }
  console.log(`${where}  ${text.match(new RegExp(MOJIBAKE.source, 'g')).length} damaged run(s)`);
  console.log(`   ...${JSON.stringify(text.slice(Math.max(0, at - 60), at + 40))}`);
}
console.log(damaged
  ? `\n${damaged} file(s) need ${FIX ? 'another look at' : 'the round trip back'}`
  : '\nthe text is intact');
process.exit(damaged && !FIX ? 1 : 0);
