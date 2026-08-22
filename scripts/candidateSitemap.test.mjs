/**
 * `npm run test:sitemap` (node --test, no test framework to install).
 *
 * The API is not reachable from a dev machine behind the office allowlist,
 * so fetchCandidacies is exercised with a stub that replays recorded
 * responses — the shapes below are what h72-api actually returned on
 * 2026-08-22 (results caps at 100, paging via has_more).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  API_PAGE_SIZE,
  absoluteUrl,
  buildSitemapFiles,
  candidacyUrls,
  chunk,
  fetchCandidacies,
  renderSitemapIndex,
  renderUrlset,
} from './candidateSitemap.mjs';

const BASE = 'https://72horas.org';

test('absoluteUrl junta base e caminho sem barra dupla', () => {
  assert.equal(absoluteUrl(BASE, '/candidato/x-1/'), 'https://72horas.org/candidato/x-1/');
  assert.equal(absoluteUrl(`${BASE}/`, '/candidato/x-1/'), 'https://72horas.org/candidato/x-1/');
  assert.equal(absoluteUrl(`${BASE}/`, 'sitemap-candidatos-1.xml'), 'https://72horas.org/sitemap-candidatos-1.xml');
});

test('candidacyUrls usa person_id e slug sem acento', () => {
  const urls = candidacyUrls([{ person_id: 260327, name: 'MÁRCIO FRANÇA' }], BASE);
  assert.deepEqual(urls, ['https://72horas.org/candidato/marcio-franca-260327/']);
});

test('candidacyUrls deduplica a mesma pessoa em várias candidaturas', () => {
  // Felipe Camozzato aparece como Deputado Federal, Vereador e Prefeito em
  // eleições diferentes — é uma pessoa, logo uma URL.
  const urls = candidacyUrls([
    { person_id: 42, name: 'FELIPE CAMOZZATO', total_value: '273831' },
    { person_id: 42, name: 'FELIPE CAMOZZATO', total_value: '10000' },
    { person_id: 43, name: 'ADRIANA VENTURA', total_value: '2002500' },
  ], BASE);

  assert.deepEqual(urls, [
    'https://72horas.org/candidato/felipe-camozzato-42/',
    'https://72horas.org/candidato/adriana-ventura-43/',
  ]);
});

test('candidacyUrls preserva a ordem da API (maior valor primeiro)', () => {
  const urls = candidacyUrls([
    { person_id: 1, name: 'PRIMEIRO' },
    { person_id: 2, name: 'SEGUNDO' },
    { person_id: 3, name: 'TERCEIRO' },
  ], BASE);
  assert.deepEqual(urls.map((url) => url.split('-').pop()), ['1/', '2/', '3/']);
});

test('candidacyUrls descarta registros sem person_id ou sem nome', () => {
  const urls = candidacyUrls([
    { person_id: null, name: 'SEM ID' },
    { person_id: 7, name: '' },
    { person_id: 8 },
    { name: 'SÓ NOME' },
    { person_id: 9, name: 'VÁLIDO' },
  ], BASE);
  assert.deepEqual(urls, ['https://72horas.org/candidato/valido-9/']);
});

test('renderUrlset escapa & e produz XML bem formado', () => {
  const xml = renderUrlset(['https://72horas.org/candidato/a-1/?x=1&y=2']);
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8" standalone="yes"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.ok(xml.includes('<loc>https://72horas.org/candidato/a-1/?x=1&amp;y=2</loc>'));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'nenhum & solto');
  assert.match(xml.trimEnd(), /<\/urlset>$/);
});

test('renderSitemapIndex lista os arquivos com lastmod', () => {
  const xml = renderSitemapIndex(['https://72horas.org/sitemap-candidatos-1.xml'], '2026-08-22T10:00:00+00:00');
  assert.match(xml, /<sitemapindex/);
  assert.ok(xml.includes('<loc>https://72horas.org/sitemap-candidatos-1.xml</loc>'));
  assert.ok(xml.includes('<lastmod>2026-08-22T10:00:00+00:00</lastmod>'));
});

test('chunk parte na medida exata', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
});

test('buildSitemapFiles devolve índice + partições e as referencia', () => {
  const urls = Array.from({ length: 5 }, (_, i) => `https://72horas.org/candidato/p-${i}/`);
  const files = buildSitemapFiles({
    urls, baseUrl: BASE, lastmod: '2026-08-22T10:00:00+00:00', maxPerFile: 2,
  });

  assert.deepEqual(files.map((file) => file.name), [
    'sitemap-candidatos.xml',
    'sitemap-candidatos-1.xml',
    'sitemap-candidatos-2.xml',
    'sitemap-candidatos-3.xml',
  ]);

  const [index, ...parts] = files;
  for (const part of parts) {
    assert.ok(
      index.contents.includes(`https://72horas.org/${part.name}`),
      `índice deve referenciar ${part.name}`,
    );
  }
  // Nenhuma URL some no particionamento.
  const emitted = parts.flatMap((part) => [...part.contents.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  assert.deepEqual(emitted, urls);
});

test('buildSitemapFiles não escreve nada quando não há URLs', () => {
  assert.deepEqual(buildSitemapFiles({ urls: [], baseUrl: BASE, lastmod: 'x' }), []);
});

test('fetchCandidacies pagina enquanto has_more e para no fim', async () => {
  const requested = [];
  const page = (n, hasMore) => ({
    ok: true,
    json: async () => ({
      candidates: Array.from({ length: API_PAGE_SIZE }, (_, i) => ({
        person_id: n * 1000 + i,
        name: `PESSOA ${n}-${i}`,
      })),
      has_more: hasMore,
    }),
  });

  const fetchImpl = async (url) => {
    requested.push(url);
    const pageNumber = Number(new URL(url).searchParams.get('page'));
    return page(pageNumber, pageNumber < 3);
  };

  const candidacies = await fetchCandidacies({
    year: 2026, apiBase: 'https://api.test/v1/', fetchImpl,
  });

  assert.equal(requested.length, 3);
  assert.equal(candidacies.length, 3 * API_PAGE_SIZE);
  assert.match(requested[0], /candidates\?year=2026&results=100&page=1&order_by=total_value&order=desc/);
});

test('fetchCandidacies para numa página vazia mesmo com has_more', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ candidates: [], has_more: true }) });
  const candidacies = await fetchCandidacies({ year: 2026, apiBase: 'https://api.test/v1/', fetchImpl });
  assert.deepEqual(candidacies, []);
});

test('fetchCandidacies tenta de novo antes de desistir', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('ECONNRESET');
    return { ok: true, json: async () => ({ candidates: [{ person_id: 1, name: 'A' }], has_more: false }) };
  };

  const candidacies = await fetchCandidacies({ year: 2026, apiBase: 'https://api.test/v1/', fetchImpl });
  assert.equal(calls, 2);
  assert.equal(candidacies.length, 1);
});

test('fetchCandidacies aborta ao estourar o orçamento de tempo', async () => {
  let clock = 0;
  const fetchImpl = async () => {
    clock += 60000; // cada página "leva" 1 minuto
    return { ok: true, json: async () => ({ candidates: [{ person_id: clock, name: 'A' }], has_more: true }) };
  };

  await assert.rejects(
    () => fetchCandidacies({
      year: 2026,
      apiBase: 'https://api.test/v1/',
      fetchImpl,
      now: () => clock,
      deadline: 150000,
    }),
    /orçamento de tempo esgotado/,
  );
});

test('fetchCandidacies propaga o erro em vez de devolver lista parcial', async () => {
  const fetchImpl = async (url) => {
    if (new URL(url).searchParams.get('page') === '2') {
      return { ok: false, status: 502 };
    }
    return {
      ok: true,
      json: async () => ({ candidates: [{ person_id: 1, name: 'A' }], has_more: true }),
    };
  };

  await assert.rejects(
    () => fetchCandidacies({ year: 2026, apiBase: 'https://api.test/v1/', fetchImpl }),
    /2026 page 2: HTTP 502/,
  );
});
