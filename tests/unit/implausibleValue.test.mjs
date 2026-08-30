import assert from 'node:assert/strict';
import { test } from 'node:test';

import implausibleValue, { IMPLAUSIBLE_FACTOR, implausibleCeiling } from '../../assets/scripts/utilities/implausibleValue.js';

const candidacy = (total, position = 'Deputado Federal', region = 'São Paulo') => ({
  total_value: String(total),
  position: { name: position },
  city: { region: { name: region } },
});

const CAP_DEP_FEDERAL = 3176572.53;

test('o caso que originou o módulo: R$ 1.000.009.300 para deputado federal', () => {
  // 315x o teto de gastos do cargo — um zero a mais numa declaração de
  // R$ 1.000.093 distorceu a escala de todos os gráficos da home.
  const flag = implausibleValue(candidacy(1000009300), 2026);
  assert.ok(flag, 'o valor absurdo passou sem sinalização');
  assert.equal(flag.cap, CAP_DEP_FEDERAL);
  assert.ok(flag.times > 300);
});

test('quem declarou um pouco acima do teto NÃO é sinalizado', () => {
  // A régua é folgada de propósito: receber acima do teto de GASTO tem
  // explicação legítima (o excedente é devolvido).
  assert.equal(implausibleValue(candidacy(CAP_DEP_FEDERAL * 1.5), 2026), null);
  assert.equal(implausibleValue(candidacy(CAP_DEP_FEDERAL * 2.99), 2026), null);
});

test('a fronteira é exatamente 3x o teto, e o limite em si não sinaliza', () => {
  assert.equal(IMPLAUSIBLE_FACTOR, 3);
  assert.equal(implausibleValue(candidacy(CAP_DEP_FEDERAL * 3), 2026), null);
  assert.ok(implausibleValue(candidacy(CAP_DEP_FEDERAL * 3 + 1), 2026));
});

test('sem teto conhecido não há sinalização — municipal e cargo fora da tabela', () => {
  assert.equal(implausibleValue(candidacy(999999999, 'Vereador', 'São Paulo'), 2024), null);
  assert.equal(implausibleValue(candidacy(999999999, 'Deputado Federal', 'São Paulo'), 2024), null);
  assert.equal(implausibleValue(candidacy(999999999, 'Governador', 'Narnia'), 2026), null);
});

test('valor zero, negativo ou ausente nunca vira alerta', () => {
  assert.equal(implausibleValue(candidacy(0), 2026), null);
  assert.equal(implausibleValue(candidacy(-100), 2026), null);
  assert.equal(implausibleValue({ position: { name: 'Deputado Federal' } }, 2026), null);
});

test('não quebra com payload incompleto da API', () => {
  assert.equal(implausibleValue(null, 2026), null);
  assert.equal(implausibleValue({}, 2026), null);
  assert.equal(implausibleValue({ total_value: '5000000000' }, 2026), null);
  assert.equal(implausibleValue({ total_value: '5000000000', position: {} }, 2026), null);
});

test('implausibleCeiling expõe teto e régua juntos', () => {
  const limits = implausibleCeiling(2026, 'Senador', 'Rondônia');
  assert.equal(limits.ceiling, limits.cap * IMPLAUSIBLE_FACTOR);
  assert.equal(implausibleCeiling(2024, 'Prefeito', 'São Paulo'), null);
});
