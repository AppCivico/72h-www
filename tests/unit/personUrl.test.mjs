import assert from 'node:assert/strict';
import { test } from 'node:test';

import personUrl, { slugify } from '../../assets/scripts/utilities/personUrl.js';

test('slugify tira acento, cedilha e caixa', () => {
  assert.equal(slugify('MÁRCIO FRANÇA'), 'marcio-franca');
  assert.equal(slugify('José António de Assunção'), 'jose-antonio-de-assuncao');
  assert.equal(slugify('ANDRÉ  DO  Ó'), 'andre-do-o');
});

test('slugify não deixa hífen sobrando nas pontas nem repetido', () => {
  assert.equal(slugify('  "FULANO" (PT) — 2026  '), 'fulano-pt-2026');
  assert.equal(slugify('...'), '');
});

test('a URL é da PESSOA, não da candidatura', () => {
  // person_id é estável entre eleições; candidate_id (SQ_CANDIDATO) é
  // reemitido a cada pleito. Trocar um pelo outro quebraria a canônica de
  // todo mundo que já concorreu mais de uma vez.
  assert.equal(personUrl({ name: 'FELIPE CAMOZZATO', id: 42 }), '/candidato/felipe-camozzato-42/');
});

test('a URL termina em barra e começa em /candidato/', () => {
  // O canonical e o sitemap são montados em cima disso; sem a barra final
  // o Netlify redireciona e o Google vê duas URLs para a mesma pessoa.
  const url = personUrl({ name: 'ADRIANA VENTURA', id: 43 });
  assert.match(url, /^\/candidato\/[a-z0-9-]+-\d+\/$/);
});

test('o id sobrevive a um nome que vira slug vazio', () => {
  // Nome só de símbolos não pode gerar /candidato/-7/ sem id legível.
  assert.match(personUrl({ name: '***', id: 7 }), /7\/$/);
});
