import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FEFC_TOTALS, QUOTA_DEADLINES } from '../../assets/scripts/utilities/electoralFund.js';
import { readJson } from '../helpers/paths.mjs';

const fefc = readJson('data', 'fefc2026.json');

test('a constante do FEFC 2026 é a soma da tabela oficial do TSE', () => {
  // Este é o teste que mais importa deste arquivo: a home divide dinheiro
  // declarado por esta constante para dizer "X% do fundo". Se alguém
  // editar data/fefc2026.json (novo rateio, partido novo) e esquecer a
  // constante, a porcentagem da manchete fica errada em silêncio.
  const soma = Object.values(fefc.quotas).reduce((total, value) => total + value, 0);
  assert.equal(Math.round(soma), FEFC_TOTALS[2026]);
  assert.equal(fefc.total, FEFC_TOTALS[2026]);
});

test('o prazo das cotas é uma data ISO válida', () => {
  for (const [year, deadline] of Object.entries(QUOTA_DEADLINES)) {
    assert.match(deadline, /^\d{4}-\d{2}-\d{2}$/, `prazo de ${year} fora do formato ISO`);
    assert.ok(!Number.isNaN(Date.parse(deadline)), `prazo de ${year} não é data`);
    assert.equal(deadline.slice(0, 4), year, `o prazo de ${year} caiu em outro ano`);
  }
});

test('o prazo de 2026 é 08/09, como o TSE remarcou', () => {
  // Era 30/08; o plenário mudou em ago/2026 ajustando a Res. 23.607/2019.
  // O painel e a home escrevem essa data no texto; mudar aqui sem mudar o
  // i18n publica duas datas diferentes na mesma página.
  assert.equal(QUOTA_DEADLINES[2026], '2026-09-08');
});

test('só existe constante para eleição com número vetado', () => {
  // Anos ausentes simplesmente não renderizam o bloco de fundos públicos.
  // Um ano municipal aqui significaria um número chutado no ar.
  for (const year of Object.keys(FEFC_TOTALS)) {
    assert.equal(Number(year) % 4, 2, `${year} não é ano de eleição geral`);
    assert.ok(FEFC_TOTALS[year] > 0);
  }
  assert.equal(FEFC_TOTALS[2024], undefined);
  assert.equal(FEFC_TOTALS[2020], undefined);
});
