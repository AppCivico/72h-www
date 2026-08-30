/**
 * Edge function do Netlify (netlify/edge-functions/candidato-meta.js).
 *
 * É o único código do projeto que roda entre o Netlify e o Google: ele
 * reescreve o <head> do shell estático com os dados de cada candidatura.
 * Se ele falhar em silêncio, todas as ~853 mil URLs voltam a ser
 * "duplicata de /candidato/" para o buscador — que foi exatamente o bug
 * que a função veio consertar. O casamento das regexes com o shell real
 * do Hugo é testado em tests/build/edgeFunction.test.mjs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMeta, injectMeta, injectNoindex, personIdFromPath,
} from '../../netlify/edge-functions/candidato-meta.js';
import { readJson } from '../helpers/paths.mjs';

const PAYLOAD = readJson('tests', 'e2e', 'fixtures', 'person.json');
const URL_CANONICA = 'https://72horas.org/candidato/marcio-franca-260327/';

test('personIdFromPath lê o id no fim do slug', () => {
  assert.equal(personIdFromPath('/candidato/marcio-franca-260327/'), 260327);
  assert.equal(personIdFromPath('/candidato/joao-2-silva-99/'), 99, 'número no meio do nome não pode confundir');
  assert.equal(personIdFromPath('/candidato/260327/'), 260327);
});

test('sem id, a função não mexe na página', () => {
  assert.equal(personIdFromPath('/candidato/'), null);
  assert.equal(personIdFromPath('/'), null);
  assert.equal(personIdFromPath('/candidato/sem-numero/'), null);
});

test('buildMeta descreve a candidatura mais recente', () => {
  const meta = buildMeta(PAYLOAD, URL_CANONICA);
  assert.equal(meta.title, 'Márcio França (PSB) · Deputado Federal · São Paulo · 72Horas');
  // Intl usa espaço não separável depois do R$ — normalizado aqui, e nunca
  // no código, para o valor sair da mesma forma no snippet do Google.
  assert.match(meta.description.replace(/\u00a0/g, ' '), /declarou R\$ 2\.853\.183 em 5 repasses/);
  assert.match(meta.description, /Eleições 2026/);
  assert.equal(meta.canonical, URL_CANONICA);
});

test('o canonical NUNCA carrega a query ?na_eleicao=', () => {
  // A home linka ${personUrl}?na_eleicao=${candidate.id}: se a query
  // entrasse na canônica, cada candidatura viraria uma URL no índice.
  const meta = buildMeta(PAYLOAD, URL_CANONICA);
  assert.ok(!meta.canonical.includes('?'));
  assert.equal(meta.jsonLd['@graph'][0].url, URL_CANONICA);
});

test('quem ainda não declarou recebimento tem descrição própria', () => {
  const zerado = {
    ...PAYLOAD,
    elections: [{ ...PAYLOAD.elections[0], total_value: '0', total_transfers: 0 }],
  };
  assert.match(buildMeta(zerado, URL_CANONICA).description, /ainda não declarou/);
});

test('singular e plural de repasse', () => {
  const um = { ...PAYLOAD, elections: [{ ...PAYLOAD.elections[0], total_transfers: 1 }] };
  assert.match(buildMeta(um, URL_CANONICA).description, /em 1 repasse de campanha/);
});

test('payload incompleto devolve null (e o chamador emite noindex)', () => {
  assert.equal(buildMeta(null, URL_CANONICA), null);
  assert.equal(buildMeta({}, URL_CANONICA), null);
  assert.equal(buildMeta({ person: { name: 'X' }, elections: [] }, URL_CANONICA), null);
  assert.equal(buildMeta({ elections: PAYLOAD.elections }, URL_CANONICA), null);
});

test('candidatura sem partido ou sem estado não quebra o título', () => {
  const magro = {
    person: { name: 'FULANO DE TAL' },
    elections: [{ year: 2026, total_value: '1000', total_transfers: 1 }],
  };
  const meta = buildMeta(magro, URL_CANONICA);
  assert.ok(meta);
  assert.ok(!meta.title.includes('()'), `título com parênteses vazio: ${meta.title}`);
  assert.ok(!meta.title.includes('· ·'), `título com separador duplo: ${meta.title}`);
  assert.ok(meta.title.endsWith('72Horas'));
});

test('o JSON-LD é válido e tem a trilha completa', () => {
  const { jsonLd } = buildMeta(PAYLOAD, URL_CANONICA);
  const serializado = JSON.stringify(jsonLd);
  assert.doesNotThrow(() => JSON.parse(serializado));
  assert.ok(!serializado.includes('</script'), 'JSON-LD não pode fechar o próprio <script>');

  const [pessoa, trilha] = jsonLd['@graph'];
  assert.equal(pessoa['@type'], 'Person');
  assert.equal(pessoa.affiliation.alternateName, 'PSB');
  assert.deepEqual(trilha.itemListElement.map((item) => item.position), [1, 2, 3]);
  assert.equal(trilha.itemListElement[1].item, 'https://72horas.org/2026/');
});

const SHELL = `<!doctype html><html lang="pt-br"><head>
<title>Candidatura · 72Horas</title>
<link rel="canonical" href="https://72horas.org/candidato/" />
<meta name="description" content="antigo">
<meta name="twitter:title" property="og:title" content="antigo">
<meta name="twitter:description" property="og:description" content="antigo">
<meta name="twitter:url" property="og:url" content="https://72horas.org/candidato/">
<meta itemprop="name" content="antigo">
<meta itemprop="description" content="antigo">
</head><body>corpo</body></html>`;

test('injectMeta troca head sem tocar no corpo', () => {
  const meta = buildMeta(PAYLOAD, URL_CANONICA);
  const out = injectMeta(SHELL, meta);

  assert.match(out, /<title>Márcio França \(PSB\)[^<]*<\/title>/);
  assert.ok(out.includes(`<link rel="canonical" href="${URL_CANONICA}" />`));
  assert.ok(!out.includes('content="antigo"'), 'sobrou meta com o texto do shell');
  assert.ok(!out.includes('href="https://72horas.org/candidato/"'), 'o canonical velho ficou');
  assert.ok(out.includes('<body>corpo</body>'), 'o corpo do shell tem que passar intacto');
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.equal((out.match(/rel="canonical"/g) || []).length, 1);
  assert.match(out, /<script type="application\/ld\+json">.*<\/script>\s*<\/head>/s);
});

test('injectMeta escapa aspas e sinais do nome (não dá para quebrar o head)', () => {
  // O nome vem da API, que espelha o TSE: é entrada externa. Uma aspa solta
  // fecha o atributo content= e derruba metade do <head>.
  const hostil = {
    person: { name: 'FULANO "ASPAS" & CIA' },
    elections: [{
      year: 2026, total_value: '1000', total_transfers: 1, party: { acronym: 'A"B' },
    }],
  };
  const out = injectMeta(SHELL, buildMeta(hostil, URL_CANONICA));
  const head = out.slice(0, out.indexOf('</head>'));
  assert.ok(!head.includes('content=""ASPAS"'), 'aspas não escapadas fecham o atributo');
  assert.ok(head.includes('&quot;') && head.includes('&amp;'));
  assert.equal((head.match(/<title>/g) || []).length, 1);
});

test('nome com </script> não fecha o bloco de dados estruturados', () => {
  // Nenhum candidato se chama assim hoje; o ponto é que o <head> de 853 mil
  // URLs é montado a partir de uma resposta HTTP externa, e uma única
  // sequência dessas transformaria o resto do head em conteúdo de página.
  const hostil = {
    person: { name: 'FULANO </script><script>alert(1)</script>' },
    elections: [{ year: 2026, total_value: '1000', total_transfers: 1 }],
  };
  const out = injectMeta(SHELL, buildMeta(hostil, URL_CANONICA));
  const bloco = out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];

  assert.doesNotThrow(() => JSON.parse(bloco), 'o JSON-LD foi cortado ao meio');
  assert.equal((out.match(/<script/g) || []).length, 1, 'apareceu um <script> extra no head');
});

test('injectNoindex é a saída quando a API falha — e não mente o canonical', () => {
  const out = injectNoindex(SHELL);
  assert.match(out, /<meta name="robots" content="noindex">\s*<\/head>/);
  assert.ok(out.includes('<body>corpo</body>'), 'o leitor humano continua vendo a página');
  assert.ok(!out.includes('application/ld+json'));
});
