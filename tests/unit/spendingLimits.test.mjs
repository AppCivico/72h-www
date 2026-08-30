import assert from 'node:assert/strict';
import { test } from 'node:test';

import spendingLimit, { SELF_FUNDING_FRACTION } from '../../assets/scripts/utilities/spendingLimits.js';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

const REGION_NAMES = ['Acre', 'Alagoas', 'Amazonas', 'Amapá', 'Bahia', 'Ceará', 'Distrito Federal',
  'Espírito Santo', 'Goiás', 'Maranhão', 'Minas Gerais', 'Mato Grosso do Sul', 'Mato Grosso',
  'Pará', 'Paraíba', 'Pernambuco', 'Piauí', 'Paraná', 'Rio de Janeiro', 'Rio Grande do Norte',
  'Rondônia', 'Roraima', 'Rio Grande do Sul', 'Santa Catarina', 'Sergipe', 'São Paulo', 'Tocantins'];

test('valores nacionais da Portaria TSE 449/2026', () => {
  assert.equal(spendingLimit(2026, 'Deputado Federal', 'São Paulo'), 3176572.53);
  assert.equal(spendingLimit(2026, 'Deputado Estadual', 'Bahia'), 1270629.01);
  assert.equal(spendingLimit(2026, 'Deputado Distrital', 'Distrito Federal'), 1270629.01);
  assert.equal(spendingLimit(2026, 'Presidente', null), 88944030.80);
});

test('o teto de deputado NÃO varia com o estado', () => {
  const caps = REGION_NAMES.map((uf) => spendingLimit(2026, 'Deputado Federal', uf));
  assert.equal(new Set(caps).size, 1);
});

test('2022 e 2026 usam a mesma tabela (a portaria manteve os valores)', () => {
  for (const office of ['Governador', 'Senador', 'Deputado Federal', 'Presidente']) {
    assert.equal(
      spendingLimit(2022, office, 'São Paulo'),
      spendingLimit(2026, office, 'São Paulo'),
      `${office} divergiu entre 2022 e 2026`,
    );
  }
});

test('todos os 27 estados têm teto de Governador e de Senador', () => {
  for (const name of REGION_NAMES) {
    assert.ok(spendingLimit(2026, 'Governador', name) > 0, `sem teto de Governador em ${name}`);
    assert.ok(spendingLimit(2026, 'Senador', name) > 0, `sem teto de Senador em ${name}`);
  }
  assert.equal(REGION_NAMES.length, UFS.length);
});

test('o nome do estado vem da API e pode chegar em qualquer caixa', () => {
  const sp = spendingLimit(2026, 'Governador', 'São Paulo');
  assert.equal(spendingLimit(2026, 'GOVERNADOR', 'SÃO PAULO'), sp);
  assert.equal(spendingLimit(2026, 'governador', 'são paulo'), sp);
});

test('eleição municipal não tem teto conhecido — devolve null, nunca palpite', () => {
  // 2020/2024 têm teto por município, que a tabela não carrega. Mostrar o
  // teto de deputado numa candidatura a vereador seria pior que não mostrar.
  assert.equal(spendingLimit(2024, 'Vereador', 'São Paulo'), null);
  assert.equal(spendingLimit(2020, 'Prefeito', 'São Paulo'), null);
  assert.equal(spendingLimit(2024, 'Deputado Federal', 'São Paulo'), null);
});

test('cargo ou estado desconhecido devolve null', () => {
  assert.equal(spendingLimit(2026, 'Vereador', 'São Paulo'), null);
  assert.equal(spendingLimit(2026, 'Governador', 'Narnia'), null);
  assert.equal(spendingLimit(2026, 'Governador', null), null);
  assert.equal(spendingLimit(2026, null, null), null);
  assert.equal(spendingLimit(null, 'Presidente', null), null);
});

test('o ano pode chegar como string da querystring', () => {
  assert.equal(spendingLimit('2026', 'Deputado Federal', 'São Paulo'), 3176572.53);
});

test('a hierarquia dos tetos bate com a lei (SP maior estado, deputado o menor cargo)', () => {
  const sp = spendingLimit(2026, 'Governador', 'São Paulo');
  for (const name of REGION_NAMES) {
    assert.ok(spendingLimit(2026, 'Governador', name) <= sp, `${name} passou SP`);
    assert.ok(
      spendingLimit(2026, 'Senador', name) < spendingLimit(2026, 'Governador', name),
      `Senador >= Governador em ${name}`,
    );
  }
  assert.ok(spendingLimit(2026, 'Deputado Estadual', 'São Paulo') < spendingLimit(2026, 'Deputado Federal', 'São Paulo'));
  assert.ok(sp < spendingLimit(2026, 'Presidente', null));
});

test('autofinanciamento é 10% do teto (Lei 9.504/97, art. 23, §2º-A)', () => {
  assert.equal(SELF_FUNDING_FRACTION, 0.10);
});
