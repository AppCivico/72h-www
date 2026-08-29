/**
 * Reais com centavos, para quando o número citado é uma cifra da lei.
 *
 * formatCurrencyNoAbbr arredonda para o real inteiro, que é o certo para dado
 * declarado: ninguém precisa dos centavos de R$ 1,8 bilhão. Mas o teto de
 * gastos de deputado federal é R$ 3.176.572,53 na Portaria TSE nº 449/2026, e
 * arredondar cita a lei errado: a tela dizia "R$ 3.176.573", um valor que não
 * existe em norma nenhuma. Vale para o teto do cargo, para o limite de
 * autofinanciamento (10% dele) e para a régua do valor implausível, que é o
 * mesmo teto.
 */
export default (value) => {
  const formatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const numericValue = Number(value);
  return formatter.format(Number.isFinite(numericValue) ? numericValue : 0);
};
