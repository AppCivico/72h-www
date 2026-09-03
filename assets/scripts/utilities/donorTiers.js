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

// O corte que a página abre. R$ 50 mil é o menor da lista: começa mostrando
// o maior grupo de grandes doadores, e o leitor aperta para cima se quiser.
export const DEFAULT_THRESHOLD = 50000;

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
 * Dinheiro por extenso, para a página não abreviar "milhões" como "mi".
 * Milhar continua "mil", que ninguém lê como abreviação. O singular vale até
 * dois, como em português se escreve: "R$ 1,5 milhão", "R$ 2 milhões".
 */
export function spelledCurrency(value) {
  const number = toNumber(value);
  const abs = Math.abs(number);

  // Zero à direita é ruído numa escala ("R$ 1,0 milhão"), mas a casa decimal
  // fica quando carrega informação ("R$ 1,5 milhão").
  const br = (amount, digits) => {
    const fixed = amount.toFixed(digits);
    const trimmed = fixed.includes('.')
      ? fixed.replace(/0+$/, '').replace(/\.$/, '')
      : fixed;
    return trimmed.replace('.', ',');
  };

  if (abs >= 1e9) {
    const scaled = number / 1e9;
    return `R$ ${br(scaled, 2)} ${Math.abs(scaled) < 2 ? 'bilhão' : 'bilhões'}`;
  }
  if (abs >= 1e6) {
    const scaled = number / 1e6;
    return `R$ ${br(scaled, 2)} ${Math.abs(scaled) < 2 ? 'milhão' : 'milhões'}`;
  }
  if (abs >= 1e3) return `R$ ${br(number / 1e3, 0)} mil`;

  return `R$ ${br(number, 0)}`;
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

/**
 * Rótulo de uma faixa de porte (`total_band`), como o leitor lê no eixo.
 */
export function bandLabel(band, money = spelledCurrency) {
  const entry = TOTAL_BANDS.find((item) => item.band === Number(band));
  if (!entry) return '';
  if (entry.min === 0) return `até ${money(entry.max)}`;
  if (entry.max === null) return `acima de ${money(entry.min)}`;
  return `${money(entry.min)} a ${money(entry.max)}`;
}

/**
 * Beeswarm sem d3, por simulação de forças (o mesmo princípio do d3-force do
 * protótipo). Cada círculo é puxado para o x que o valor dele manda e
 * empurrado para fora de quem colide. O empurrão vale nos dois eixos, e é
 * isso que resolve o dado real: dezenas de pessoas doaram exatamente R$ 100
 * mil, e um layout que só empilha na vertical transforma o grupo numa coluna
 * que sai do gráfico. Aqui o grupo abre em bolha. O deslocamento horizontal
 * fica pequeno (a atração ao x é mais forte que a repulsão) e é sempre igual
 * para o mesmo dado: sem aleatoriedade, o jitter inicial é determinístico.
 *
 * Recebe itens com `x` e `r` em unidades do desenho e devolve os mesmos itens
 * com `x` ajustado e `y` em torno de zero. O caller centraliza.
 */
export function beeswarmLayout(items, padding = 1, options = {}) {
  const iterations = options.iterations || 300;
  const xStrength = options.xStrength || 0.15;
  const yStrength = options.yStrength || 0.06;

  // Jitter inicial determinístico nos DOIS eixos, só para quebrar a simetria
  // de quem cai no mesmo x: com todos exatamente no mesmo ponto a repulsão
  // só saberia empurrar na vertical, e o grupo viraria coluna.
  const noise = (index, salt) => ((((index + 1) * salt) % 1000) / 1000 - 0.5);
  const nodes = items.map((item, index) => ({
    ...item,
    targetX: item.x,
    x: item.x + noise(index, 7919) * item.r,
    y: noise(index, 104729) * item.r,
  }));

  // As últimas passadas são só de colisão, sem atração: limpam a sobreposição
  // residual que a simulação deixa quando a atração e o empurrão se equilibram
  // a meio pixel de distância.
  const settle = 24;
  for (let step = 0; step < iterations + settle; step += 1) {
    const alpha = Math.max(0.08, 1 - step / iterations);
    const attracting = step < iterations;

    if (attracting) {
      for (let k = 0; k < nodes.length; k += 1) {
        nodes[k].x += (nodes[k].targetX - nodes[k].x) * xStrength * alpha;
        nodes[k].y -= nodes[k].y * yStrength * alpha;
      }
    }

    nodes.sort((a, b) => a.x - b.x);
    const maxReach = 2 * Math.max(...nodes.map((node) => node.r)) + padding;
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        if (b.x - a.x > maxReach) break;
        const reach = a.r + b.r + padding;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        if (distance >= reach) continue; // eslint-disable-line no-continue
        if (distance === 0) {
          // Sobreposição exata: empurra numa direção que depende só da
          // posição na lista, para o resultado ser o mesmo a cada carga.
          const angle = ((i * 31 + j * 17) % 360) * (Math.PI / 180);
          dx = Math.cos(angle) * 1e-3;
          dy = Math.sin(angle) * 1e-3;
          distance = 1e-3;
        }
        const overlap = ((reach - distance) / distance) * 0.5;
        const pushX = dx * overlap;
        const pushY = dy * overlap;
        a.x -= pushX;
        a.y -= pushY;
        b.x += pushX;
        b.y += pushY;
      }
    }
  }

  return nodes.map((node) => {
    const { targetX, ...rest } = node;
    return rest;
  });
}

/**
 * Afasta rótulos que cairiam uns sobre os outros, mantendo a ordem e o
 * centro do conjunto: quem estava acima continua acima, e o grupo inteiro
 * não migra para baixo. Recebe e devolve posições y na mesma ordem.
 */
export function spreadLabels(positions, gap) {
  const order = positions
    .map((y, index) => ({ y: toNumber(y), index }))
    .sort((a, b) => a.y - b.y);

  for (let k = 1; k < order.length; k += 1) {
    if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  }

  const before = positions.reduce((sum, y) => sum + toNumber(y), 0);
  const after = order.reduce((sum, item) => sum + item.y, 0);
  const shift = order.length ? (after - before) / order.length : 0;

  const out = [];
  order.forEach((item) => {
    out[item.index] = item.y - shift;
  });
  return out;
}

/**
 * A serpentina do enxame: duas senoides lentas somadas, uma volta e meia ao
 * longo do desenho. Move só a LINHA DE CENTRO, e por isso é enfeite honesto —
 * a posição vertical num beeswarm nunca significou nada. Ondular a ALTURA,
 * essa sim, inventaria uma distribuição que os dados não têm.
 */
export function waveAt(x, amplitude) {
  if (!amplitude) return 0;
  return amplitude * (0.62 * Math.sin(x / 205 + 0.9) + 0.38 * Math.sin(x / 78 + 2.3));
}

/**
 * Tremor determinístico, para o desenho sair igual a cada carga da página.
 */
function wiggle(index) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value) - 0.5;
}

/**
 * Reparte bolinhas entre colunas pelo maior resto, SEM o piso de uma célula
 * que o largestRemainder aplica: ali o piso existe para o grupo minúsculo não
 * sumir do waffle; aqui ele inflaria a contagem sempre que houvesse mais
 * colunas do que bolinhas.
 */
function spreadCounts(weights, total) {
  const clean = weights.map((weight) => Math.max(0, toNumber(weight)));
  const sum = clean.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0 || total <= 0) return clean.map(() => 0);

  const exact = clean.map((weight) => (weight / sum) * total);
  const out = exact.map((value) => Math.floor(value));
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest);

  let left = total - out.reduce((acc, value) => acc + value, 0);
  let step = 0;
  while (left > 0 && order.length) {
    out[order[step % order.length].index] += 1;
    left -= 1;
    step += 1;
  }
  return out;
}

/**
 * A multidão abaixo do piso desenhada como enxame, e não como barra.
 *
 * Cada faixa ocupa uma fatia da calha proporcional a quanta gente tem, então
 * a ÁREA de cada cor é a contagem. As bolinhas se empilham em colunas
 * centradas, com as colunas ímpares meio passo abaixo (empacotamento
 * hexagonal), e o passo é único para as três faixas: se o grão mudasse no
 * meio do desenho pareceria outra unidade de medida.
 *
 * Duas coisas ondulam, as duas decorativas: a linha de centro (waveAt) e a
 * borda, por senoide lenta ao longo das colunas. O peso de cada coluna passa
 * pelo maior resto, então a contagem fecha exata e ninguém aparece ou some.
 * Sorteio coluna a coluna foi testado e sai serrilhado, não ondulado.
 *
 * Uma bolinha vale `perDot` pessoas: abaixo de R$ 50 mil só se sabe quantas
 * pessoas há em cada faixa, e uma bolinha por pessoa sairia com menos de um
 * pixel na calha. Quem chama precisa dizer isso na tela.
 */
export function crowdLayout(bands, options = {}) {
  const originX = toNumber(options.originX);
  const width = options.width || 260;
  const height = options.height || 240;
  const centerY = toNumber(options.centerY);
  const perDot = Math.max(1, options.perDot || 10);
  const maxStep = options.maxStep || 10.5;
  const wave = options.wave === undefined ? Math.min(30, height * 0.12) : options.wave;

  const rows = (bands || []).filter((band) => toNumber(band.donors) > 0);
  const people = rows.reduce((sum, band) => sum + toNumber(band.donors), 0);
  if (!rows.length || !people) {
    return {
      dots: [], regions: [], step: 0, radius: 0, people: 0, perDot,
    };
  }

  // A onda come altura nas duas pontas, então o empilhamento só pode contar
  // com o que sobra — senão a massa transborda o gráfico.
  const usable = Math.max(24, height - wave * 2 - 14);

  const regions = [];
  let cursor = originX;
  let step = Infinity;
  rows.forEach((band) => {
    const donors = toNumber(band.donors);
    const slot = (donors / people) * width;
    const dots = Math.max(1, Math.round(donors / perDot));
    const x0 = cursor + 1;
    const x1 = cursor + Math.max(6, slot - 1);
    regions.push({
      band: band.band,
      tone: band.tone,
      label: band.label,
      donors,
      dots,
      x0,
      x1,
    });
    cursor += slot;
    step = Math.min(step, Math.sqrt((usable * Math.max(8, x1 - x0)) / (0.87 * dots)));
  });

  step = Math.min(step, maxStep);
  const radius = Math.max(0.5, step * 0.38);

  const dots = [];
  const marcas = [];
  regions.forEach((region, index) => {
    const span = region.x1 - region.x0;
    const columns = Math.max(1, Math.min(Math.round(span / step), region.dots));
    // Fase própria por faixa: em uníssono as três sobem e descem juntas e o
    // desenho vira bandeira.
    const phase = 1.7 + index * 2.1;
    const weights = [];
    for (let c = 0; c < columns; c += 1) {
      weights.push(1
        + 0.16 * Math.sin(c / 3.4 + phase)
        + 0.09 * Math.sin(c / 8.9 + phase * 0.7));
    }
    const counts = spreadCounts(weights, region.dots);

    let top = Infinity;
    for (let c = 0; c < columns; c += 1) {
      const many = counts[c];
      const cx = region.x0 + (c + 0.5) * (span / columns);
      const base = centerY + waveAt(cx, wave) + (c % 2) * step * 0.435;
      for (let i = 0; i < many; i += 1) {
        const y = base + (i - (many - 1) / 2) * step * 0.87
          + wiggle(index * 977 + c * 31 + i * 7) * step * 0.13;
        if (y - radius < top) top = y - radius;
        dots.push({
          x: cx + wiggle(index * 613 + c * 17 + i) * step * 0.13,
          y,
          r: radius,
          tone: region.tone,
          band: region.band,
        });
      }
    }
    marcas[index] = {
      top: Number.isFinite(top) ? top : centerY,
      labelX: (region.x0 + region.x1) / 2,
    };
  });

  return {
    dots,
    regions: regions.map((region, index) => ({ ...region, ...marcas[index] })),
    step,
    radius,
    people,
    perDot,
  };
}
