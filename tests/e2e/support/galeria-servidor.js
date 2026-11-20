// Static server for the state gallery: serves the repository's app/ and tests/e2e/support/ folders (and
// nothing else) under their real paths, so the gallery page can import the app's modules and styles with
// the same relative URLs the type checker follows on disk.
//   node tests/e2e/support/galeria-servidor.js   → prints the gallery URL

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SERVED = [join(ROOT, 'app') + sep, join(ROOT, 'tests', 'e2e', 'support') + sep];
const GALLERY = 'tests/e2e/support/galeria.html';
/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @param {number} [port] 0 picks a free one
 * @param {string} [host]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>} `url` is the gallery page
 */
export function startGalleryServer(port = 0, host = '127.0.0.1') {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const file = normalize(join(ROOT, pathname === '/' ? GALLERY : pathname));
      if (!SERVED.some((folder) => file.startsWith(folder))) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('403');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      ok({
        url: `http://${host}:${actual}/${GALLERY}`,
        port: actual,
        close: () => new Promise((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startGalleryServer(Number(process.env.PORT ?? 5174), process.env.HOST ?? '127.0.0.1')
    .then((server) => console.log(`Galeria de estados em ${server.url}`));
}
