/**
 * Serve o ./public como o Netlify serve — que não é como o `hugo server`
 * serve. As duas diferenças que importam para os testes:
 *
 *  1. o rewrite `/candidato/* -> /candidato/index.html` com status 200
 *     (netlify.toml). Sem ele, a página de candidatura só abre por
 *     `/candidato/?id=N`, e um E2E que usasse essa forma testaria um
 *     caminho que não existe em produção;
 *  2. 404.html de verdade, para o smoke conseguir distinguir "link
 *     quebrado" de "página existe".
 */
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const fileFor = (root, pathname) => {
  const clean = decodeURIComponent(pathname.split('?')[0]);
  const candidates = [
    path.join(root, clean),
    path.join(root, clean, 'index.html'),
    `${path.join(root, clean)}.html`,
  ];

  for (const candidate of candidates) {
    if (!path.resolve(candidate).startsWith(path.resolve(root))) continue;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* próximo */ }
  }
  return null;
};

export function serve(root, { port = 0 } = {}) {
  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    let file = fileFor(root, pathname);

    // netlify.toml: toda /candidato/{slug}-{id}/ é o mesmo shell estático.
    if (!file && /^\/candidato\//.test(pathname)) {
      file = fileFor(root, '/candidato/index.html');
    }

    if (!file) {
      const notFound = fileFor(root, '/404.html');
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      if (notFound) { createReadStream(notFound).pipe(response); return; }
      response.end('404');
      return;
    }

    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: bound } = server.address();
      resolve({
        url: `http://127.0.0.1:${bound}`,
        port: bound,
        close: () => new Promise((done) => { server.close(done); }),
      });
    });
  });
}

/** `node tests/helpers/staticServer.mjs <dir> <porta>` — usado pelo Playwright. */
if (process.argv[1] && process.argv[1].endsWith('staticServer.mjs')) {
  const [, , dir = 'public', port = '4321'] = process.argv;
  serve(path.resolve(dir), { port: Number(port) }).then(({ url }) => {
    process.stdout.write(`servindo ${path.resolve(dir)} em ${url}\n`);
  });
}
