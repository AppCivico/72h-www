import assert from 'node:assert/strict';
import { test } from 'node:test';

import formatNumeral from '../../assets/scripts/utilities/formatNumeral.js';
import formatCurrencyNoAbbr from '../../assets/scripts/utilities/formatCurrencyNoAbbr.js';

test('formatNumeral usa ponto como separador de milhar (pt-BR)', () => {
  assert.equal(formatNumeral(1365), '1.365');
  assert.equal(formatNumeral(853000), '853.000');
  assert.equal(formatNumeral(0), '0');
});

test('formatNumeral usa vírgula decimal quando pedem casas', () => {
  assert.equal(formatNumeral(1.5, 1), '1,5');
  assert.equal(formatNumeral(12.345, 2), '12,35');
});

test('formatNumeral não escreve NaN na tela', () => {
  // A API pode devolver null em qualquer big number; "NaN" no lugar de um
  // número é o tipo de coisa que o leitor lê como erro do site.
  assert.equal(formatNumeral(null), '0');
  assert.equal(formatNumeral(undefined), '0');
});

test('formatCurrencyNoAbbr escreve o valor inteiro, sem abreviar', () => {
  // Existe justamente para os lugares onde "R$ 4,90 bi" esconde a ordem de
  // grandeza que o texto ao lado está discutindo.
  assert.equal(formatCurrencyNoAbbr('1000093').replace(/ /g, ' '), 'R$ 1.000.093');
  assert.equal(formatCurrencyNoAbbr(4961519777).replace(/ /g, ' '), 'R$ 4.961.519.777');
});

test('formatCurrencyNoAbbr degrada para R$ 0 em valor inválido', () => {
  assert.equal(formatCurrencyNoAbbr('abc').replace(/ /g, ' '), 'R$ 0');
  assert.equal(formatCurrencyNoAbbr(null).replace(/ /g, ' '), 'R$ 0');
  assert.equal(formatCurrencyNoAbbr(Infinity).replace(/ /g, ' '), 'R$ 0');
});

test('formatCurrencyNoAbbr não mostra centavos', () => {
  assert.equal(formatCurrencyNoAbbr(1234.56).replace(/ /g, ' '), 'R$ 1.235');
});
