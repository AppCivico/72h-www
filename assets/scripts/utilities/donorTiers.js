/**
 * Régua dos portes de doador e as contas puras da página /doadores.
 *
 * O porte é do DOADOR, não da doação: é a soma do que a pessoa declarou ter
 * dado na eleição, já sem autofinanciamento. Pequeno vai até R$ 2 mil, grande
 * passa do corte que o leitor escolhe, médio é o que sobra entre os dois. As
 * mesmas bordas vivem no backend (`donor_total_band`), e é por isso que o
 * corte só aceita a lista fechada abaixo: cada um deles cai numa fronteira de
 * banda, então todo porte é uma união de bandas inteiras e a API responde sem
 * recalcular nada.
 *
 * Tudo aqui é função pura, sem DOM e sem fetch, para os testes de
 * tests/unit/donorTiers.test.mjs valerem para o que vai ao ar.
 */

/** Teto do pequeno doador, em reais. Espelha H72_SMALL_DONOR_MAX na API. */
export const SMALL_MAX = 2000;

/** Cortes que a API aceita em `threshold`. Qualquer outro valor responde 400. */
export const THRESHOLDS = [50000, 100000, 250000, 500000, 1000000];

export const DEFAULT_THRESHOLD = 100000;

/** Ordem fixa dos portes, do menor para o maior. Nunca ciclar. */
export const TIERS = ['small', 'medium', 'big'];

/**
 * Bordas de `total_band` (o array `bands` de /donors/summary vem só com o
 * índice). Conferidas contra a própria API em 02/09/2026: com
 * threshold=100000 os grandes são as bandas 5 a 8, com threshold=50000 são as
 * bandas 4 a 8, e a banda 1 tem exatamente a contagem do porte pequeno.
 */
export const TOTAL_BANDS = [
  { band: 1, min: 0, max: 2000 },
  { band: 2, min: 2000, max: 10000 },
  { band: 3, min: 10000, max: 50000 },
  { band: 4, min: 50000, max: 100000 },
  { band: 5, min: 100000, max: 250000 },
  { band: 6, min: 250000, max: 500000 },
  { band: 7, min: 500000, max: 1000000 },
  { band: 8, min: 1000000, max: null },
];

/**
 * A API mistura número e string no mesmo campo (individuals.value chega como
 * número, tiers.medium.value como string), então nada é somado antes de
 * passar por aqui. Ausente vira 0, e não NaN espalhado pela tela.
 */
export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** Fração de um total, protegida contra divisão por zero. */
export function share(part, total) {
  const whole = toNumber(total);
  return whole > 0 ? toNumber(part) / whole : 0;
}

/**
 * Reparte `cells` células inteiras entre pesos, pelo método do maior resto,
 * com uma regra a mais: quem tem peso maior que zero recebe pelo menos uma
 * célula. Sem isso o grupo minúsculo some do waffle, e é justamente o grupo
 * que a página existe para mostrar — 1,9% do dinheiro dos grandes doadores
 * indo para candidaturas de mulheres negras não pode virar zero quadrado.
 */
export function largestRemainder(weights, cells) {
  const clean = weights.map((weight) => Math.max(0, toNumber(weight)));
  const total = clean.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0 || cells <= 0) return clean.map(() => 0);

  const exact = clean.map((weight) => (weight / total) * cells);
  const out = exact.map((value) => Math.floor(value));

  exact.forEach((value, index) => {
    if (value > 0 && out[index] === 0) out[index] = 1;
  });

  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest);

  let left = cells - out.reduce((sum, value) => sum + value, 0);
  let step = 0;
  while (left > 0 && order.length) {
    out[order[step % order.length].index] += 1;
    left -= 1;
    step += 1;
  }
  // O piso de uma célula pode estourar o total; devolve tirando de quem tem
  // mais, e nunca de quem ficaria zerado.
  while (left < 0) {
    let biggest = 1;
    let target = -1;
    out.forEach((value, index) => {
      if (value > biggest) {
        biggest = value;
        target = index;
      }
    });
    if (target < 0) break;
    out[target] -= 1;
    left += 1;
  }

  return out;
}

/**
 * Série acumulada por porte a partir das linhas cruas de /donors/timeline
 * (uma linha por data e porte). Cada porte acumula sobre o PRÓPRIO total, que
 * é a pergunta da seção: quando cada grupo entrou, não quanto ele pesa.
 * As datas são as mesmas nas três séries, senão as linhas terminam em
 * lugares diferentes do eixo e a comparação engana.
 */
export function cumulativeSeries(days) {
  const rows = Array.isArray(days) ? days : [];
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const byTier = new Map();

  rows.forEach((row) => {
    if (!byTier.has(row.tier)) byTier.set(row.tier, new Map());
    const daily = byTier.get(row.tier);
    daily.set(row.date, (daily.get(row.date) || 0) + toNumber(row.value));
  });

  const out = {};
  byTier.forEach((daily, tier) => {
    const total = [...daily.values()].reduce((sum, value) => sum + value, 0);
    let running = 0;
    out[tier] = dates.map((date) => {
      running += daily.get(date) || 0;
      return { date, share: total > 0 ? running / total : 0 };
    });
  });

  return out;
}

/** Primeira data em que a série cruzou a metade do dinheiro do porte. */
export function halfwayDate(series) {
  const point = (series || []).find((entry) => entry.share >= 0.5);
  return point ? point.date : null;
}

/**
 * Quantas doações medianas de pequeno doador cabem numa doação mediana de
 * grande doador. É a comparação da seção "a escala", e vale só quando os dois
 * lados existem.
 */
export function medianRatio(tiers) {
  const big = toNumber(tiers?.big?.median_total);
  const small = toNumber(tiers?.small?.median_total);
  if (!big || !small) return null;
  return Math.round(big / small);
}
