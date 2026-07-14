/**
 * Long-running local fixture server for Owner manual tests.
 * Fixed port so URLs are stable across reloads.
 *
 *   node scripts/serve-fixtures.mjs
 *   FORM:  http://127.0.0.1:8765/form
 *   MEDIA: http://127.0.0.1:8765/media
 *   COUNT: http://127.0.0.1:8765/count  (submit counter)
 */
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../fixtures');
// 8765 often taken on this machine; default 18765 for Owner manual tests.
const PORT = Number(process.env.FIXTURE_PORT || 18765);

function silentWav() {
  const dataBytes = 8000;
  const out = Buffer.alloc(44 + dataBytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(8000, 24);
  out.writeUInt32LE(8000, 28);
  out.writeUInt16LE(1, 32);
  out.writeUInt16LE(8, 34);
  out.write('data', 36);
  out.writeUInt32LE(dataBytes, 40);
  out.fill(128, 44);
  return out;
}

let submissions = 0;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  if (request.method === 'POST' && url.pathname === '/submit') {
    submissions += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ ok: true, submissions }));
  }
  if (url.pathname === '/count') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    return response.end(String(submissions));
  }
  if (url.pathname === '/reset') {
    submissions = 0;
    response.writeHead(200, { 'content-type': 'text/plain' });
    return response.end('0');
  }
  if (url.pathname === '/audio.wav') {
    response.writeHead(200, { 'content-type': 'audio/wav' });
    return response.end(silentWav());
  }
  if (url.pathname === '/' || url.pathname === '/index') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return response.end(`<!doctype html><meta charset=utf-8><title>Scion fixtures</title>
      <h1>Scion test fixtures</h1>
      <ul>
        <li><a href="/form">Form (approval / submit)</a></li>
        <li><a href="/media">Media (play / pause)</a></li>
        <li><a href="/count">Submit count</a></li>
        <li><a href="/reset">Reset count</a></li>
      </ul>`);
  }
  const fixture = url.pathname === '/media' ? 'media.html' : 'form.html';
  try {
    const html = await readFile(path.join(fixturesDir, fixture));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fixtures] http://127.0.0.1:${PORT}/`);
  console.log(`[fixtures] form  http://127.0.0.1:${PORT}/form`);
  console.log(`[fixtures] media http://127.0.0.1:${PORT}/media`);
});
