/**
 * Acesso ao site construído. Todos os testes de tests/build/ rodam sobre
 * o HTML que o Hugo escreveu — não sobre os templates —, porque é o HTML
 * que vai para o ar.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { siteDir } from './paths.mjs';

export const SITE = siteDir();

export const built = () => existsSync(path.join(SITE, 'index.html'));

/** Motivo do skip quando não há build — some quando existe. */
export const semBuild = () => (built()
  ? false
  : `sem build em ${SITE} — rode "npm run test:build" (que constrói) ou defina SITE_DIR`);

const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((entry) => {
  const full = path.join(dir, entry);
  return statSync(full).isDirectory() ? walk(full) : [full];
}) : []);

/** Páginas do site, já sem as que não são páginas editoriais. */
export const EXCLUIDAS = [
  'admin/index.html', // Netlify CMS, HTML de terceiro
  'a37356b8.html', // arquivo de verificação de propriedade
];

export const pages = () => walk(SITE)
  .filter((file) => file.endsWith('.html'))
  .map((file) => path.relative(SITE, file))
  .filter((rel) => !EXCLUIDAS.includes(rel))
  .sort()
  .map((rel) => ({
    rel,
    /** URL pública ("/2026/index.html" -> "/2026/") */
    url: `/${rel.replace(/index\.html$/, '').replace(/\.html$/, '/')}`,
    html: readFileSync(path.join(SITE, rel), 'utf8'),
  }));

export const readSite = (...parts) => readFileSync(path.join(SITE, ...parts), 'utf8');

export const inSite = (...parts) => existsSync(path.join(SITE, ...parts));

export const filesInSite = () => walk(SITE).map((file) => path.relative(SITE, file));
