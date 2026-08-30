/**
 * Link e asset internos que não existem no build. É a categoria de erro
 * que passa por qualquer revisão de código (o template está certo, o
 * arquivo é que não está lá) e só aparece como 404 para o leitor.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { references } from '../helpers/html.mjs';
import {
  SITE, filesInSite, inSite, pages, semBuild,
} from '../helpers/site.mjs';

const skip = semBuild();
const PAGINAS = skip ? [] : pages();
const ARQUIVOS = skip ? new Set() : new Set(filesInSite().map((file) => file.split(path.sep).join('/')));

const externo = (valor) => /^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i.test(valor);

/** Resolve uma referência da página para o arquivo que o Netlify serviria. */
const resolve = (valor, paginaUrl) => {
  const semQuery = valor.split('#')[0].split('?')[0];
  if (!semQuery) return null;

  const absoluto = semQuery.startsWith('/')
    ? semQuery
    : path.posix.normalize(path.posix.join(paginaUrl, semQuery));

  const limpo = absoluto.replace(/^\//, '');
  for (const tentativa of [limpo, `${limpo}index.html`, `${limpo}/index.html`, `${limpo}.html`]) {
    if (ARQUIVOS.has(tentativa.replace(/\/+/g, '/'))) return tentativa;
  }
  return null;
};

test('nenhum link interno aponta para página inexistente', { skip }, () => {
  const quebrados = [];

  for (const page of PAGINAS) {
    for (const referencia of references(page.html)) {
      if (referencia.kind !== 'link' || externo(referencia.value)) continue;
      // /candidato/{slug}-{id}/ é servida pelo shell via rewrite do Netlify.
      if (/^\/candidato\/.+/.test(referencia.value)) continue;
      if (!resolve(referencia.value, page.url)) {
        quebrados.push(`${page.rel} -> ${referencia.value}`);
      }
    }
  }

  assert.deepEqual(quebrados, [], `links quebrados:\n  ${quebrados.join('\n  ')}`);
});

test('nenhum script, estilo ou imagem referenciada está faltando', { skip }, () => {
  const faltando = [];

  for (const page of PAGINAS) {
    for (const referencia of references(page.html)) {
      if (referencia.kind === 'link' || externo(referencia.value)) continue;
      if (!resolve(referencia.value, page.url)) {
        faltando.push(`${page.rel} -> ${referencia.value} (${referencia.kind})`);
      }
    }
  }

  assert.deepEqual(faltando, [], `assets faltando:\n  ${faltando.join('\n  ')}`);
});

test('toda página carrega o CSS e o JS do site', { skip }, () => {
  for (const page of PAGINAS) {
    const refs = references(page.html);
    assert.ok(
      refs.some((ref) => ref.kind === 'asset' && /\.css$/.test(ref.value.split('?')[0])),
      `${page.rel} sem folha de estilo`,
    );
    assert.ok(
      refs.some((ref) => ref.kind === 'script' && ref.value.includes('/scripts/')),
      `${page.rel} sem o bundle de scripts`,
    );
  }
});

test('o robots.txt anuncia sitemaps que existem', { skip }, () => {
  const robots = readFileSync(path.join(SITE, 'robots.txt'), 'utf8');
  const anunciados = [...robots.matchAll(/^Sitemap:\s*(\S+)/gim)].map((match) => match[1]);
  assert.ok(anunciados.length >= 1, 'robots.txt sem linha Sitemap');

  for (const url of anunciados) {
    const arquivo = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
    assert.ok(inSite(arquivo), `robots.txt anuncia ${arquivo}, que não está no build`);
  }
});

test('o sitemap só lista URLs que o site serve', { skip }, () => {
  const sitemap = readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(urls.length > 3, `sitemap com ${urls.length} URLs`);

  const quebradas = urls
    .map((url) => url.replace(/^https?:\/\/[^/]+/, '') || '/')
    .filter((caminho) => !/^\/candidato\/.+/.test(caminho))
    .filter((caminho) => !resolve(caminho, '/'));

  assert.deepEqual(quebradas, [], `sitemap aponta para páginas que não existem: ${quebradas.join(', ')}`);
});
