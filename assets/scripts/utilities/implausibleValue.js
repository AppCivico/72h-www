/**
 * Detecta valores declarados que são implausíveis para o cargo, comparando o
 * que a candidatura declarou ter recebido com o teto LEGAL DE GASTOS do cargo
 * (utilities/spendingLimits.js, tabela da Portaria TSE 449/2026).
 *
 * Para que serve: prestação de contas é declaração, e declaração tem erro de
 * digitação. Um zero a mais transforma R$ 1.000.093 em R$ 10.000.930, e foi
 * assim que uma candidatura a deputado federal apareceu no site com
 * R$ 1.000.009.300 — 315 vezes o teto de gastos do cargo, que é de
 * R$ 3.176.572,53. Um valor desses distorce a escala de qualquer gráfico e o
 * topo de qualquer ranking.
 *
 * O que este módulo NÃO afirma: nada sobre a legalidade da candidatura. O
 * teto é de GASTO, não de arrecadação, e receber acima dele tem explicação
 * possível (o excedente é devolvido). Por isso a régua é folgada e a palavra
 * usada na tela é "provável erro de preenchimento", nunca irregularidade.
 */

import spendingLimit from './spendingLimits';

// Quantas vezes o teto de gastos do cargo um valor precisa passar para ser
// tratado como provável erro. Três vezes pega o erro clássico do zero a mais
// (que dá 10x) com folga, e não marca quem declarou um pouco acima do teto.
export const IMPLAUSIBLE_FACTOR = 3;

/**
 * O teto de gastos do cargo e o limite de plausibilidade que sai dele.
 * Retorna null quando não conhecemos o teto (ano ou cargo fora da tabela):
 * sem régua não há sinalização, nunca um palpite.
 */
export function implausibleCeiling(year, position, regionName) {
  const cap = spendingLimit(year, position, regionName);
  if (!cap) return null;
  return { cap, ceiling: cap * IMPLAUSIBLE_FACTOR };
}

/**
 * Avalia uma candidatura da listagem. Devolve null quando o valor é
 * plausível ou quando não há teto conhecido para comparar.
 */
export function implausibleValue(candidate, year) {
  const value = Number.parseFloat(candidate?.total_value) || 0;
  if (value <= 0) return null;

  const limits = implausibleCeiling(
    year,
    candidate?.position?.name,
    candidate?.city?.region?.name,
  );
  if (!limits || value <= limits.ceiling) return null;

  return {
    value,
    cap: limits.cap,
    times: value / limits.cap,
  };
}

export default implausibleValue;
