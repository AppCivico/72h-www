/**
 * Detecta quando as fatias de um recorte não fecham com o total que a
 * própria API declara para aquele recorte.
 *
 * Para que serve: em `accumulated`, cada gráfico de `pie_charts` vem com um
 * campo `total` que deveria ser a soma das suas fatias, e que é o mesmo
 * `accumulated.total_value` mostrado no bloco de grandes números. Quando os
 * dois discordam, a página passa a afirmar duas divisões diferentes do mesmo
 * dinheiro na mesma tela: em 29/08/2026 as fatias somavam R$ 3.293.266.621,71
 * contra um total declarado de R$ 1.817.415.166,10, e a manchete do gráfico
 * de gênero dizia 81% para candidaturas masculinas enquanto os grandes
 * números logo acima implicavam 70%. O mesmo endpoint com year=2022 fecha na
 * vírgula, então é problema de origem, não de recorte.
 *
 * O que este módulo NÃO afirma: qual dos dois números está certo. Ele só diz
 * que não dá para cravar uma porcentagem enquanto os dois discordarem, e quem
 * decide o que fazer com isso é a tela (utilities/implausibleValue.js segue a
 * mesma ideia para o valor implausível).
 */

// Folga antes de tratar a diferença como divergência real. Um centavo de
// arredondamento entre a soma das fatias e o total da API é esperado; meio
// por cento já não é, e o caso que motivou o módulo passava de 80%.
export const MISMATCH_TOLERANCE = 0.005;

/**
 * Compara o total declarado com a soma das fatias.
 *
 * Devolve null quando fecham (ou quando não há o que comparar: sem total
 * declarado não existe divergência a apontar, só a soma das fatias, que é o
 * que a página sempre usou). Quando não fecham, devolve os dois valores e a
 * razão entre eles, para a nota da tela poder mostrar os números em vez de
 * pedir confiança.
 */
export function sliceTotalMismatch(declaredTotal, slices) {
  const declared = Number.parseFloat(declaredTotal);
  if (!Number.isFinite(declared) || declared <= 0) return null;

  const summed = (Array.isArray(slices) ? slices : [])
    .reduce((sum, point) => sum + (Number.parseFloat(point?.y) || 0), 0);
  if (summed <= 0) return null;

  const drift = Math.abs(summed - declared) / declared;
  if (drift <= MISMATCH_TOLERANCE) return null;

  return { declared, summed, ratio: summed / declared };
}

export default sliceTotalMismatch;
