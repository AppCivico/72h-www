/**
 * Cobre a guarda que impede a home de cravar uma porcentagem quando as fatias
 * de um recorte não fecham com o total que a API declara para ele.
 *
 * O módulo vive em assets/scripts/utilities porque é a home que o usa; como
 * não há "type": "module" no package.json, quem o carrega aqui é a detecção
 * de sintaxe do Node (22.7+), que reconhece o `export` e trata o arquivo como
 * ESM. Se um dia isso deixar de valer, o teste quebra alto em vez de sumir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MISMATCH_TOLERANCE, sliceTotalMismatch,
} from '../assets/scripts/utilities/sliceTotalMismatch.js';

const slices = (...values) => values.map((y) => ({ y }));

test('fatias que fecham com o total declarado não viram divergência', () => {
  assert.equal(sliceTotalMismatch(100, slices(60, 40)), null);
});

test('centavo de arredondamento fica dentro da folga', () => {
  assert.equal(sliceTotalMismatch(1817415166.1, slices(1273271105.59, 544144060.51)), null);
  assert.equal(sliceTotalMismatch(100, slices(60, 40.4)), null);
});

test('divergência real devolve os dois valores e a razão entre eles', () => {
  // O caso que motivou o módulo: 29/08/2026, recorte de gênero da home.
  const found = sliceTotalMismatch(1817415166.1, slices(2653930444.9, 639336176.81));
  assert.ok(found);
  assert.equal(found.declared, 1817415166.1);
  assert.equal(found.summed, 3293266621.71);
  assert.ok(found.ratio > 1.81 && found.ratio < 1.82);
});

test('a divergência é simétrica: fatias menores que o total também contam', () => {
  const found = sliceTotalMismatch(100, slices(30, 20));
  assert.ok(found);
  assert.equal(found.summed, 50);
});

test('a folga é a documentada, e o limite não dispara', () => {
  assert.equal(MISMATCH_TOLERANCE, 0.005);
  const atLimit = 100 * (1 + MISMATCH_TOLERANCE);
  assert.equal(sliceTotalMismatch(100, slices(atLimit)), null);
});

test('sem total declarado não há divergência a apontar', () => {
  // Ano/recorte em que a API não manda o total: a página segue usando a soma
  // das fatias, como sempre fez, sem nota e sem manchete censurada.
  assert.equal(sliceTotalMismatch(undefined, slices(60, 40)), null);
  assert.equal(sliceTotalMismatch(0, slices(60, 40)), null);
  assert.equal(sliceTotalMismatch('não é número', slices(60, 40)), null);
});

test('recorte vazio ou zerado não vira divergência', () => {
  assert.equal(sliceTotalMismatch(100, []), null);
  assert.equal(sliceTotalMismatch(100, null), null);
  assert.equal(sliceTotalMismatch(100, slices(0, 0)), null);
});

test('valores em string, como a API às vezes manda, são lidos como número', () => {
  assert.equal(sliceTotalMismatch('100', [{ y: '60' }, { y: '40' }]), null);
  assert.ok(sliceTotalMismatch('100', [{ y: '300' }]));
});
