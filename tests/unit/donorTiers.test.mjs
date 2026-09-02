import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SMALL_MAX,
  THRESHOLDS,
  TOTAL_BANDS,
  cumulativeSeries,
  halfwayDate,
  largestRemainder,
  medianRatio,
  share,
  toNumber,
} from '../../assets/scripts/utilities/donorTiers.js';

test('toNumber aceita o que a API manda de verdade', () => {
  // individuals.value chega número, tiers.medium.value chega string, e
  // small_share chega null quando a métrica pedida não é essa.
  assert.equal(toNumber(133911058.41), 133911058.41);
  assert.equal(toNumber('77382326.42'), 77382326.42);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber(undefined), 0);
  assert.equal(toNumber('n/d'), 0);
});

test('share não divide por zero', () => {
  assert.equal(share('50', 200), 0.25);
  assert.equal(share(10, 0), 0);
  assert.equal(share(10, null), 0);
});

test('largestRemainder devolve exatamente as células pedidas', () => {
  const cells = largestRemainder([70.5, 15.9, 11.4, 1.9, 0.3], 100);
  assert.equal(cells.reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(cells, [70, 16, 11, 2, 1]);
});

test('largestRemainder nunca apaga um grupo que existe', () => {
  // 0,3% do dinheiro ainda é um quadrado: é o grupo que a seção de gênero e
  // cor/raça precisa mostrar, não um arredondamento.
  const cells = largestRemainder([0.4, 99.6], 100);
  assert.equal(cells[0], 1);
  assert.equal(cells.reduce((sum, value) => sum + value, 0), 100);
});

test('largestRemainder com tudo zerado devolve tudo zerado', () => {
  assert.deepEqual(largestRemainder([0, 0, 0], 500), [0, 0, 0]);
});

test('largestRemainder reparte os pontos dos portes', () => {
  // Números reais de 02/09/2026: 176 grandes, 5.744 médios, 8.936 pequenos.
  const people = largestRemainder([176, 5744, 8936], 500);
  assert.deepEqual(people, [6, 193, 301]);
  assert.equal(people.reduce((sum, value) => sum + value, 0), 500);
});

test('cumulativeSeries acumula cada porte sobre o próprio total', () => {
  const series = cumulativeSeries([
    { date: '2026-08-01', tier: 'big', value: '50' },
    { date: '2026-08-02', tier: 'big', value: '50' },
    { date: '2026-08-02', tier: 'small', value: '10' },
    { date: '2026-08-03', tier: 'small', value: '90' },
  ]);

  // As três séries compartilham o eixo, senão terminam em pontos diferentes.
  assert.equal(series.big.length, 3);
  assert.equal(series.small.length, 3);
  assert.equal(series.big[2].share, 1);
  assert.equal(series.small[0].share, 0);
  assert.equal(series.small[1].share, 0.1);
});

test('cumulativeSeries aguenta payload vazio', () => {
  assert.deepEqual(cumulativeSeries([]), {});
  assert.deepEqual(cumulativeSeries(null), {});
});

test('halfwayDate acha o dia em que o porte passou da metade', () => {
  const series = cumulativeSeries([
    { date: '2026-08-01', tier: 'big', value: '60' },
    { date: '2026-08-05', tier: 'big', value: '40' },
  ]);
  assert.equal(halfwayDate(series.big), '2026-08-01');
  assert.equal(halfwayDate([]), null);
  assert.equal(halfwayDate(undefined), null);
});

test('medianRatio compara as medianas dos dois extremos', () => {
  assert.equal(medianRatio({ big: { median_total: '200000.00' }, small: { median_total: '200.00' } }), 1000);
  assert.equal(medianRatio({ big: { median_total: '0' }, small: { median_total: '200' } }), null);
  assert.equal(medianRatio(null), null);
});

test('a régua bate com a que a API aceita', () => {
  // threshold fora desta lista devolve 400, e cada corte precisa cair numa
  // fronteira de banda para o porte ser uma união de bandas inteiras.
  assert.deepEqual(THRESHOLDS, [50000, 100000, 250000, 500000, 1000000]);
  assert.equal(SMALL_MAX, 2000);
  assert.equal(TOTAL_BANDS[0].max, SMALL_MAX);
  THRESHOLDS.forEach((threshold) => {
    assert.ok(
      TOTAL_BANDS.some((band) => band.max === threshold),
      `nenhuma banda termina em ${threshold}`,
    );
  });
});
