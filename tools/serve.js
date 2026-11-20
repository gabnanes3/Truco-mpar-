// Servidor estático mínimo para desenvolvimento e testes: serve a pasta app/ e, só quando os testes pedem,
// outras pastas sob prefixos de URL próprios (as páginas de apoio de tests/e2e/support nunca entram em app/).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../app', import.meta.url)));
/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

/**
 * @param {number} [port] 0 picks a free one
 * @param {string} [host]
 * @param {Record<string, string>} [mounts] extra folders by URL prefix, e.g. `{ '/tests/e2e/support/': folder }`;
 *   everything else is served from app/
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export function startStaticServer(port = 0, host = '127.0.0.1', mounts = {}) {
  const extra = Object.entries(mounts).map(([prefix, folder]) => ({ prefix, folder: resolve(folder) }));
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const mount = extra.find(({ prefix }) => pathname.startsWith(prefix));
      const root = mount === undefined ? ROOT : mount.folder;
      let file = normalize(join(root, mount === undefined ? pathname : pathname.slice(mount.prefix.length)));
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      if (pathname.endsWith('/')) file = join(file, 'index.html');
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
        url: `http://${host}:${actual}/`,
        port: actual,
        close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 5173);
  startStaticServer(port, process.env.HOST ?? '127.0.0.1').then((s) => console.log(`Truco Ímpar em ${s.url}`));
}
