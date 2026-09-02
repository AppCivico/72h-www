import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_THRESHOLD,
  SMALL_MAX,
  THRESHOLDS,
  TOTAL_BANDS,
  bandLabel,
  beeswarmLayout,
  cumulativeSeries,
  halfwayDate,
  largestRemainder,
  medianRatio,
  share,
  spelledCurrency,
  spreadLabels,
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

test('spelledCurrency escreve milhões por extenso', () => {
  assert.equal(spelledCurrency(51716306.51), 'R$ 51,72 milhões');
  assert.equal(spelledCurrency('4812425.48'), 'R$ 4,81 milhões');
  assert.equal(spelledCurrency(1000000), 'R$ 1 milhão');
  assert.equal(spelledCurrency(1500000), 'R$ 1,5 milhão');
  assert.equal(spelledCurrency(2000000), 'R$ 2 milhões');
  assert.equal(spelledCurrency(2390000000), 'R$ 2,39 bilhões');
  assert.equal(spelledCurrency(1000000000), 'R$ 1 bilhão');
});

test('spelledCurrency mantém mil e valores pequenos', () => {
  assert.equal(spelledCurrency(50000), 'R$ 50 mil');
  assert.equal(spelledCurrency(2000), 'R$ 2 mil');
  assert.equal(spelledCurrency(200), 'R$ 200');
  assert.equal(spelledCurrency(null), 'R$ 0');
});

test('o corte padrão é o menor da lista', () => {
  assert.equal(DEFAULT_THRESHOLD, 50000);
  assert.ok(THRESHOLDS.includes(DEFAULT_THRESHOLD));
});

test('bandLabel escreve as faixas com as bordas conferidas', () => {
  assert.equal(bandLabel(1), 'até R$ 2 mil');
  assert.equal(bandLabel(2), 'R$ 2 mil a R$ 10 mil');
  assert.equal(bandLabel(5), 'R$ 100 mil a R$ 250 mil');
  assert.equal(bandLabel(8), 'acima de R$ 1 milhão');
  assert.equal(bandLabel(9), '');
});

test('beeswarmLayout abre em bolha quem tem o mesmo valor', () => {
  // Setenta pessoas que doaram exatamente o mesmo valor: o dado real tem
  // isso em R$ 100 mil. Não podem virar uma coluna que sai do gráfico.
  const items = Array.from({ length: 70 }, (_, index) => ({ id: index, x: 400, r: 6 }));
  const placed = beeswarmLayout(items, 1);
  const height = Math.max(...placed.map((item) => Math.abs(item.y) + item.r));
  const width = Math.max(...placed.map((item) => Math.abs(item.x - 400) + item.r));
  assert.ok(height < 140, `a bolha ficou alta demais: ${height}`);
  assert.ok(width < 140, `a bolha ficou larga demais: ${width}`);
  // e ninguém foi parar longe do próprio valor
  placed.forEach((item) => assert.ok(Math.abs(item.x - 400) < 90));
});

test('beeswarmLayout quase não sobrepõe círculos', () => {
  const items = Array.from({ length: 60 }, (_, index) => ({
    id: index, x: 100 + (index % 7) * 3, r: 4 + (index % 5) * 2,
  }));
  const placed = beeswarmLayout(items, 1);
  let worst = 0;
  for (let a = 0; a < placed.length; a += 1) {
    for (let b = a + 1; b < placed.length; b += 1) {
      const dx = placed[a].x - placed[b].x;
      const dy = placed[a].y - placed[b].y;
      const minimum = placed[a].r + placed[b].r;
      worst = Math.max(worst, minimum - Math.sqrt(dx * dx + dy * dy));
    }
  }
  // Simulação de forças converge, não resolve exato: tolerância de um pixel.
  assert.ok(worst < 1, `sobreposição máxima de ${worst.toFixed(2)}`);
});

test('beeswarmLayout deixa quem está sozinho no eixo', () => {
  const placed = beeswarmLayout([{ id: 1, x: 10, r: 5 }, { id: 2, x: 500, r: 5 }]);
  placed.forEach((item) => assert.ok(Math.abs(item.y) < 0.5));
  placed.forEach((item) => assert.ok(Math.abs(item.x - (item.id === 1 ? 10 : 500)) < 0.5));
});

test('beeswarmLayout é determinístico e preserva os dados', () => {
  const items = [{ id: 'a', x: 10, r: 5, name: 'Fulana' }, { id: 'b', x: 11, r: 5, name: 'Beltrano' }];
  const first = beeswarmLayout(items);
  const second = beeswarmLayout(items);
  assert.deepEqual(first, second);
  assert.equal(first.find((item) => item.id === 'a').name, 'Fulana');
});

test('spreadLabels afasta rótulos colados sem trocar a ordem', () => {
  const out = spreadLabels([100, 104, 300], 18);
  assert.ok(out[1] - out[0] >= 18 - 1e-9);
  assert.ok(out[0] < out[1] && out[1] < out[2]);
  // o terceiro, longe dos outros, mal se move
  assert.ok(Math.abs(out[2] - 300) < 10);
});

test('spreadLabels devolve o mesmo quando ninguém colide', () => {
  assert.deepEqual(spreadLabels([10, 50, 90], 18), [10, 50, 90]);
  assert.deepEqual(spreadLabels([], 18), []);
});

