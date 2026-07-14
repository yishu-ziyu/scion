import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../fixtures');

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

/**
 * Local fixture server with submission counter (approval correctness).
 * @returns {Promise<{ origin: string, submissions: () => number, close: () => Promise<void> }>}
 */
export async function startFixtureServer() {
  let submissions = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname === '/submit') {
      submissions += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ ok: true }));
    }
    if (url.pathname === '/count') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      return response.end(String(submissions));
    }
    if (url.pathname === '/audio.wav') {
      response.writeHead(200, { 'content-type': 'audio/wav' });
      return response.end(silentWav());
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    submissions: () => submissions,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
