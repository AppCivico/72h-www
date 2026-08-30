/**
 * Smoke do HTML publicado: as páginas que precisam existir, existem, e
 * cada uma sai com o <head> que o buscador e o compartilhamento leem.
 * Um erro de template no Hugo não derruba build — ele publica a página
 * com um pedaço a menos.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonical, countTag, htmlLang, jsonLdBlocks, meta, title,
} from '../helpers/html.mjs';
import { inSite, pages, semBuild } from '../helpers/site.mjs';

const skip = semBuild();
const PAGINAS = skip ? [] : pages();

const OBRIGATORIAS = [
  'index.html',
  '2026/index.html',
  '2024/index.html',
  '2022/index.html',
  '2020/index.html',
  'candidato/index.html',
  'partidos/painel/index.html',
  'quem-somos/index.html',
  'sobre-os-dados/index.html',
  'imprensa/index.html',
  'robots.txt',
  'sitemap.xml',
];

test('as páginas do site foram publicadas', { skip }, () => {
  const faltando = OBRIGATORIAS.filter((arquivo) => !inSite(arquivo));
  assert.deepEqual(faltando, [], `não saíram do build: ${faltando.join(', ')}`);
});

test('nenhuma página carrega resíduo de template do Hugo', { skip }, () => {
  // ZgotmplZ é o Hugo recusando interpolar algo num contexto perigoso;
  // "%!s(MISSING)" é argumento faltando no i18n; "<no value>" é campo
  // que não existe. Os três aparecem como texto na tela.
  // ({{ }} sozinho não conta: o Vue usa a mesma marcação no navegador.)
  const residuos = /ZgotmplZ|%!s\(|%!d\(|<no value>|\{\{\s*(i18n|partial|\.[A-Z])/;
  const sujas = PAGINAS.filter((page) => residuos.test(page.html)).map((page) => page.rel);
  assert.deepEqual(sujas, [], `resíduo de template em: ${sujas.join(', ')}`);
});

test('toda página declara idioma e viewport', { skip }, () => {
  for (const page of PAGINAS) {
    assert.match(htmlLang(page.html) || '', /^pt/i, `${page.rel} sem lang pt`);
    assert.ok(meta(page.html, 'viewport'), `${page.rel} sem viewport`);
    assert.match(page.html, /<meta charset="utf-8">/i, `${page.rel} sem charset`);
  }
});

test('toda página tem título, descrição e canônica', { skip }, () => {
  for (const page of PAGINAS) {
    const t = title(page.html);
    assert.ok(t && t.length > 10, `${page.rel} sem título (${t})`);
    assert.ok(t.length <= 120, `${page.rel} com título de ${t.length} caracteres`);

    const descricao = meta(page.html, 'description');
    assert.ok(descricao && descricao.length > 40, `${page.rel} sem descrição útil`);
    assert.ok(descricao.length <= 320, `${page.rel} com descrição de ${descricao.length} caracteres`);

    assert.ok(canonical(page.html), `${page.rel} sem canonical`);
  }
});

test('cada página tem exatamente um h1', { skip }, () => {
  for (const page of PAGINAS) {
    assert.equal(countTag(page.html, 'h1'), 1, `${page.rel} tem ${countTag(page.html, 'h1')} h1`);
  }
});

test('títulos e descrições não se repetem entre páginas', { skip }, () => {
  // Duas páginas com o mesmo <title> é o sinal clássico de partial de head
  // que parou de receber o contexto da página.
  const porTitulo = new Map();
  PAGINAS.forEach((page) => {
    const chave = title(page.html);
    porTitulo.set(chave, [...(porTitulo.get(chave) || []), page.rel]);
  });
  const repetidos = [...porTitulo.entries()].filter(([, arquivos]) => arquivos.length > 1);
  assert.deepEqual(repetidos, [], `título repetido: ${JSON.stringify(repetidos)}`);
});

test('a canônica de cada página aponta para a própria página', { skip }, () => {
  // Exceção deliberada: / e /2026/ renderizam a mesma coisa, e a home
  // aponta para o ano corrente para não duplicar conteúdo no índice.
  const excecoes = { 'index.html': '/2026/' };

  for (const page of PAGINAS) {
    const href = canonical(page.html);
    const caminho = href.startsWith('http') ? new URL(href).pathname : href;
    assert.equal(caminho, excecoes[page.rel] || page.url, `canônica errada em ${page.rel}`);
  }
});

test('as tags de compartilhamento acompanham o título da página', { skip }, () => {
  for (const page of PAGINAS) {
    // og:type não é emitido pelo head.html — o Facebook assume "website"
    // e nada quebra, por isso não está exigido aqui.
    for (const chave of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card']) {
      assert.ok(meta(page.html, chave), `${page.rel} sem ${chave}`);
    }
    assert.equal(meta(page.html, 'og:title'), title(page.html), `${page.rel}: og:title diferente do <title>`);
    // head.html corta a og:description em 200 caracteres.
    assert.ok(
      meta(page.html, 'description').startsWith(meta(page.html, 'og:description')),
      `${page.rel}: og:description não é o começo da descrição`,
    );
    assert.equal(
      meta(page.html, 'og:url'),
      canonical(page.html),
      `${page.rel}: og:url diferente da canônica`,
    );
    assert.match(meta(page.html, 'og:image'), /^https?:\/\/|^\//, `${page.rel} com og:image relativo demais`);
  }
});

test('o JSON-LD de toda página é JSON válido', { skip }, () => {
  for (const page of PAGINAS) {
    jsonLdBlocks(page.html).forEach((bloco, indice) => {
      assert.doesNotThrow(
        () => JSON.parse(bloco),
        `${page.rel}: bloco ld+json #${indice + 1} não parseia`,
      );
    });
  }
});

test('nenhuma página fica sem conteúdo se o JS não rodar', { skip }, () => {
  // O site é Vue in-DOM: o HTML publicado já traz o texto editorial e os
  // números do snapshot de build. Uma página que só tem <div id="app">
  // significa que o partial parou de renderizar no servidor.
  for (const page of PAGINAS) {
    const corpo = page.html.slice(page.html.indexOf('<body'));
    const texto = corpo.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
    assert.ok(texto.replace(/\s+/g, ' ').trim().length > 500, `${page.rel} sai quase vazio sem JS`);
  }
});
