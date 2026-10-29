'use strict';
const fs = require('fs');
const path = require('path');
const target = path.join('lib', 'Utils', 'messages-media.js');
const original = '    return fetched.pipe(output, { end: true });';
const replacement = `    // OpenWA: propagate source errors and close the source when the consumer stops.
    pipeline(fetched, output, () => {});
    return output;`;
function apply(dir = path.join(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys')) {
  const file = path.join(dir, target);
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(replacement)) return { skipped: true };
  const imports = "import { Readable, Transform } from 'stream';";
  if (source.split(original).length !== 2 || source.split(imports).length !== 2) throw new Error('Baileys media pipeline shape changed');
  source = source.replace(imports, "import { Readable, Transform, pipeline } from 'stream';").replace(original, replacement);
  fs.writeFileSync(file, source);
  return { skipped: false };
}
if (require.main === module) {
  try { console.log('patch-baileys-media:', apply().skipped ? 'already patched' : 'patched'); }
  catch (error) { console.error('patch-baileys-media:', error.message); if (!process.argv.includes('--best-effort')) process.exitCode = 1; }
}
function isApplied(dir = path.join(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys')) {
  try {
    return fs.readFileSync(path.join(dir, target), 'utf8').includes(replacement);
  } catch {
    return true;
  }
}
module.exports = { apply, isApplied };
