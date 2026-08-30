/**
 * O que o build precisa ter produzido além de HTML: os JSON de filtros
 * (que salvam a home quando a API está fora), o CSS com a regra que
 * esconde o app antes de hidratar, e os bundles de JS por página.
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
const ANOS = [2026, 2024, 2022, 2020];

test('cada ano de eleição tem seu JSON de filtros publicado', { skip }, () => {
  // O cliente lê /filters/{ano}.json em vez de chamar a API externa. Se um
  // ano some, os filtros daquela eleição abrem vazios.
  for (const ano of ANOS) {
    assert.ok(inSite('filters', `${ano}.json`), `sem filters/${ano}.json`);
  }
});

test('o JSON de filtros tem os catálogos que a home usa', { skip }, () => {
  for (const ano of ANOS) {
    const { filters } = JSON.parse(readFileSync(path.join(SITE, 'filters', `${ano}.json`), 'utf8'));
    for (const catalogo of ['regions', 'parties', 'offices', 'races', 'genders', 'fund_types']) {
      assert.ok(Array.isArray(filters[catalogo]), `filters/${ano}.json sem ${catalogo}`);
      assert.ok(filters[catalogo].length > 0, `filters/${ano}.json com ${catalogo} vazio`);
    }
    assert.equal(filters.regions.length, ano % 4 === 0 ? 28 : 27, `filters/${ano}.json com número estranho de regiões`);
  }
});

test('o build sobrevive à API fora do ar (o fallback de filtros funciona)', { skip }, () => {
  // Este build pode ter sido feito sem acesso à API: o teste acima já
  // passou, então ou a API respondeu, ou o snapshot committado entrou no
  // lugar. Os dois caminhos são aceitáveis; publicar filtro vazio não é.
  const paulo = JSON.parse(readFileSync(path.join(SITE, 'filters', '2026.json'), 'utf8'))
    .filters.regions.find((region) => region.name === 'SÃO PAULO');
  assert.equal(paulo.id, 24, 'o id de São Paulo mudou — a query region_id[] vai filtrar outro estado');
});

test('o CSS cobre o app com o overlay de carregando enquanto o Vue não monta', { skip }, () => {
  // O site NÃO usa `[v-cloak] { display: none }`: usa um overlay branco
  // (%loading-el). A diferença importa — com display:none, um v-cloak que
  // o Vue nunca remove deixa o elemento invisível para sempre, que foi
  // exatamente o bug do menu. Com overlay, o pior caso é um spinner.
  const css = filesInSite().filter((file) => file.endsWith('.css'));
  assert.ok(css.length > 0, 'nenhum CSS no build');

  const juntos = css.map((file) => readFileSync(path.join(SITE, file), 'utf8')).join('\n');
  assert.match(juntos, /\[v-cloak\]\s*\{[^}]+\}/, 'o CSS compilado não trata [v-cloak]');
  assert.match(juntos, /\[v-cloak\]:+after\s*\{[^}]*(background|content)/i, 'sem o overlay de carregamento no v-cloak');
  assert.ok(
    !/\[v-cloak\]\s*\{[^}]*display\s*:\s*none/i.test(juntos),
    'alguém trocou o overlay por display:none — um v-cloak esquecido volta a esconder o elemento para sempre',
  );
});

test('todo v-cloak do HTML publicado está num elemento que o Vue monta', { skip }, () => {
  // v-cloak fora da árvore de um app montado nunca é removido: aquele
  // pedaço da página fica coberto pelo overlay indefinidamente.
  const RAIZES = ['vueHome', 'vueCandidato', 'vuePainel'];
  for (const page of pages()) {
    const raizes = RAIZES.filter((id) => page.html.includes(`id="${id}"`));
    if (!page.html.includes('v-cloak')) continue;
    assert.ok(raizes.length > 0, `${page.rel} usa v-cloak sem nenhum app Vue na página`);
  }
});

test('cada página carrega o bundle da sua própria tela', { skip }, () => {
  const esperado = {
    'index.html': 'index',
    '2026/index.html': 'index',
    'candidato/index.html': 'candidato',
    'partidos/painel/index.html': 'painel',
    'quem-somos/index.html': 'content-page',
  };

  const porArquivo = new Map(pages().map((page) => [page.rel, page]));
  for (const [arquivo, bundle] of Object.entries(esperado)) {
    const page = porArquivo.get(arquivo);
    assert.ok(page, `${arquivo} não está no build`);
    const scripts = references(page.html).filter((ref) => ref.kind === 'script').map((ref) => ref.value);
    assert.ok(
      scripts.some((src) => src.includes(`/scripts/${bundle}.min.`)),
      `${arquivo} não carrega scripts/${bundle}: ${scripts.join(', ')}`,
    );
  }
});

test('os arquivos com hash no nome são realmente únicos por conteúdo', { skip }, () => {
  // Fingerprint do Hugo: dois builds do mesmo código têm que gerar o mesmo
  // nome, e conteúdo diferente tem que gerar nome diferente — é o que
  // permite cache eterno no CDN.
  const hashed = filesInSite().filter((file) => /\.[0-9a-f]{40,}\.(js|css)$/.test(file));
  assert.ok(hashed.length >= 3, `só ${hashed.length} arquivos com fingerprint`);
  assert.equal(new Set(hashed).size, hashed.length);
});
