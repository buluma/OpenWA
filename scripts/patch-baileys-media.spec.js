'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { apply, isApplied } = require('./patch-baileys-media');

test('patch is exact, idempotent, and rejects unknown shapes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baileys-media-'));
  try {
    const file = path.join(dir, 'lib/Utils/messages-media.js');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "import { Readable, Transform } from 'stream';\n    return fetched.pipe(output, { end: true });\n");
    assert.equal(isApplied(dir), false);
    assert.equal(apply(dir).skipped, false);
    assert.equal(isApplied(dir), true);
    assert.equal(apply(dir).skipped, true);
    fs.writeFileSync(file, 'unknown');
    assert.throws(() => apply(dir), /shape changed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('truncated media response rejects the consumer instead of crashing', () => {
  const script = `
    import http from 'node:http';
    import { downloadEncryptedContent } from '@whiskeysockets/baileys/lib/Utils/messages-media.js';
    const server = http.createServer((req, res) => {
      res.writeHead(200, {'Content-Length': '1000'});
      res.write(Buffer.alloc(32));
      setTimeout(() => res.destroy(), 50);
    });
    server.listen(0, '127.0.0.1', async () => {
      const stream = await downloadEncryptedContent('http://127.0.0.1:' + server.address().port, {cipherKey: Buffer.alloc(32), iv: Buffer.alloc(16)});
      try { for await (const chunk of stream) {} process.exitCode = 2; }
      catch (error) { console.log('caught:', error.message); }
      finally { server.close(); }
    });`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /caught: terminated/);
});
