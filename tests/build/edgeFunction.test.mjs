/**
 * A edge function reescreve o <head> do shell por substituição de texto:
 * ela depende da FORMA exata das tags que o Hugo gera. Uma mudança
 * inocente no head.html (aspas simples, atributos em outra ordem, tag
 * quebrada em duas linhas) faz cada regex não casar — e a função continua
 * respondendo 200, publicando a canônica errada em ~853 mil URLs.
 *
 * Por isso este teste roda contra o shell construído, não contra fixture.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMeta, injectMeta, injectNoindex } from '../../netlify/edge-functions/candidato-meta.js';
import { canonical, jsonLdBlocks, meta, title } from '../helpers/html.mjs';
import { readJson } from '../helpers/paths.mjs';
import { inSite, readSite, semBuild } from '../helpers/site.mjs';

const skip = semBuild() || (!inSite('candidato', 'index.html') && 'sem o shell /candidato/');
const SHELL = skip ? '' : readSite('candidato', 'index.html');
const CANONICA = 'https://72horas.org/candidato/marcio-franca-260327/';
const META = buildMeta(readJson('tests', 'e2e', 'fixtures', 'person.json'), CANONICA);

test('o shell tem as tags que a função procura', { skip }, () => {
  assert.match(SHELL, /<title>[^<]*<\/title>/);
  assert.match(SHELL, /<link rel="canonical" href="[^"]*"\s*\/?>/);
  assert.match(SHELL, /<meta name="description" content="[^"]*"/);
  assert.match(SHELL, /<meta name="twitter:title" property="og:title" content="[^"]*"/);
  assert.match(SHELL, /<meta name="twitter:description" property="og:description" content="[^"]*"/);
  assert.match(SHELL, /<meta name="twitter:url" property="og:url" content="[^"]*"/);
  assert.match(SHELL, /<meta itemprop="name" content="[^"]*"/);
  assert.match(SHELL, /<meta itemprop="description" content="[^"]*"/);
  assert.ok(SHELL.includes('</head>'));
});

test('rodando sobre o shell real, a página fica com os dados da candidatura', { skip }, () => {
  const out = injectMeta(SHELL, META);

  assert.equal(title(out), META.title);
  assert.equal(canonical(out), CANONICA);
  assert.equal(meta(out, 'description'), META.description);
  assert.equal(meta(out, 'og:title'), META.title);
  assert.equal(meta(out, 'og:url'), CANONICA);
  assert.equal(meta(out, 'itemprop' in {} ? '' : 'name'), META.title);
});

test('nenhum resto do head da seção sobra na página do candidato', { skip }, () => {
  // O bug original: /candidato/{id}/ saía com a canônica de /candidato/, e
  // o Google tratava as 853 mil como duplicata de uma página só.
  const out = injectMeta(SHELL, META);
  const head = out.slice(0, out.indexOf('</head>'));

  assert.ok(!/href="[^"]*\/candidato\/"/.test(head), 'a canônica da seção continua no head');
  assert.ok(!head.includes(title(SHELL)), 'o título do shell continua no head');
  assert.equal((head.match(/rel="canonical"/g) || []).length, 1);
});

test('o JSON-LD entra uma vez e é válido no shell real', { skip }, () => {
  const blocos = jsonLdBlocks(injectMeta(SHELL, META));
  assert.equal(blocos.length, jsonLdBlocks(SHELL).length + 1);
  blocos.forEach((bloco) => assert.doesNotThrow(() => JSON.parse(bloco)));
});

test('quando a API falha, o shell sai com noindex e sem canônica nova', { skip }, () => {
  const out = injectNoindex(SHELL);
  assert.equal(meta(out, 'robots'), 'noindex');
  assert.equal(canonical(out), canonical(SHELL));
});

test('o shell continua servindo o leitor humano (o Vue monta o corpo)', { skip }, () => {
  assert.match(SHELL, /id="vueCandidato"/);
  assert.match(SHELL, /scripts\/candidato\.min\./);
});
