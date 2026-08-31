import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FALLBACK_RACES,
  FEFC_FUND_ID,
  PARTY_FUND_ID,
  fundGroupIds,
  introBreakdownRequests,
  shapeIntroBreakdowns,
} from '../../assets/scripts/utilities/introBreakdowns.js';

// A lista que a API publica hoje em /filters (ids conferidos em 31/08/2026).
const FUND_TYPES = [
  { id: 1, name: 'Fundo Partidário' },
  { id: 2, name: 'Fundo Especial' },
  { id: 3, name: 'Outros Recursos' },
  { id: 4, name: 'Financiamento Coletivo' },
  { id: 5, name: 'Doação Direta' },
  { id: 6, name: 'Auto Financiamento' },
];

test('cada chip resolve para os fund_type_id certos', () => {
  // FEFC e Fundo Partidário são ids fixos da API; trocá-los inverte a
  // leitura da cota de gênero (o painel inteiro mede fund_type 2).
  assert.deepEqual(fundGroupIds('fefc', FUND_TYPES), [FEFC_FUND_ID]);
  assert.deepEqual(fundGroupIds('fp', FUND_TYPES), [PARTY_FUND_ID]);
  assert.deepEqual(fundGroupIds('others', FUND_TYPES), [3, 4, 5, 6]);
});

test("'all' manda TODOS os ids explícitos, nunca uma URL sem filtro", () => {
  // O /index sem filtro é servido de um snapshot que envelhece em outra
  // cadência do que o caminho filtrado (31/08/2026: R$ 2,391 bi sem filtro
  // contra R$ 2,557 bi somando os tipos). Os quatro chips precisam ser
  // comparáveis entre si, então 'all' também vai pelo caminho filtrado.
  assert.deepEqual(fundGroupIds('all', FUND_TYPES), [1, 2, 3, 4, 5, 6]);
  assert.ok(fundGroupIds('all', FUND_TYPES).length > 0);
});

test('sem /filters carregado, os fallbacks cobrem os chips', () => {
  assert.deepEqual(fundGroupIds('others', undefined), [3, 4, 5, 6]);
  assert.deepEqual(fundGroupIds('all', []), [1, 2, 3, 4, 5, 6]);
  assert.equal(FALLBACK_RACES.length, 6);
});

test('o lote tem uma URL de gênero e uma por cor/raça, todas com days=all', () => {
  const requests = introBreakdownRequests({
    domain: 'https://api.example/v1/',
    year: 2026,
    fundIds: [2],
    races: FALLBACK_RACES,
  });

  // A seção é "Total acumulado": o período dos filtros da página não entra.
  assert.match(requests.gender, /days=all/);
  assert.match(requests.gender, /fund_type_id\[\]=2/);
  assert.ok(!requests.gender.includes('race_id'));

  assert.equal(requests.races.length, FALLBACK_RACES.length);
  for (const race of requests.races) {
    assert.match(race.url, /days=all/);
    assert.match(race.url, /fund_type_id\[\]=2/);
    assert.match(race.url, new RegExp(`race_id\\[\\]=${race.id}$`));
  }
});

test('shape: gênero e cor/raça no formato do handleBarData, fechando com o total', () => {
  // Números reais do FEFC em 31/08/2026 — a conta que tem que bater com o
  // painel: 722,3 mi de 2.285,6 mi é 31,6% para mulheres, nunca os 21,6%
  // que o pie_charts inflado mostrava.
  const bigNumbers = {
    amount_female: '722297658.31',
    amount_male: '1563259236.82',
    total_amount: '2285556895.13',
  };
  const raceRows = [
    { name: 'Branca', total: '1500000000' },
    { name: 'Parda', total: '517801940.50' },
    { name: 'Preta', total: '267754954.63' },
    { name: 'Sem Informação', total: '0' },
  ];

  const [ethnicity, gender] = shapeIntroBreakdowns({
    bigNumbers,
    raceRows,
    fundLabel: 'Fundo Eleitoral (FEFC)',
  });

  assert.equal(ethnicity.type, 'ethnicity');
  assert.equal(gender.type, 'gender');

  // total = o que a API declara para o recorte; handleBarData o guarda como
  // apiTotal e compara com a soma das fatias (a régua de "não fecha").
  assert.equal(gender.total, 2285556895.13);
  assert.equal(ethnicity.total, 2285556895.13);

  const female = gender.data.find((point) => point.name === 'Feminino');
  const male = gender.data.find((point) => point.name === 'Masculino');
  assert.equal(female.y, 722297658.31);
  assert.equal(male.y, 1563259236.82);

  const femaleShare = (female.y / (female.y + male.y)) * 100;
  assert.ok(femaleShare > 31 && femaleShare < 32, `fatia feminina ${femaleShare}`);

  // Categoria sem valor não vira barra de zero.
  assert.equal(ethnicity.data.length, 3);
  assert.ok(ethnicity.data.every((point) => point.y > 0));

  // O subtítulo do gráfico diz de qual dinheiro se trata.
  assert.equal(gender.fundLabel, 'Fundo Eleitoral (FEFC)');
});

test('shape: recorte sem movimento vira data vazio, nunca 0% inventado', () => {
  const [ethnicity, gender] = shapeIntroBreakdowns({
    bigNumbers: { amount_female: '0', amount_male: '0', total_amount: '0' },
    raceRows: [{ name: 'Branca', total: '0' }],
  });

  assert.deepEqual(gender.data, []);
  assert.deepEqual(ethnicity.data, []);
  assert.equal(gender.fundLabel, '');
});
