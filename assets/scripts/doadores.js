/* global Vue, Highcharts */
import chartTheme, { categorical } from './utilities/chartTheme';
import formatCurrencyNoAbbr from './utilities/formatCurrencyNoAbbr';
import formatNumeral from './utilities/formatNumeral';
import watchMainMenu from './menuToggle';
import watchHeaderCondense from './components/headerCondense';
import {
  DEFAULT_THRESHOLD,
  SMALL_MAX,
  THRESHOLDS,
  TIERS,
  TOTAL_BANDS,
  bandLabel,
  beeswarmLayout,
  cumulativeSeries,
  halfwayDate,
  largestRemainder,
  medianRatio,
  share,
  spelledCurrency,
  toNumber,
} from './utilities/donorTiers';

// Mesma razão de candidato.js e painel.js: esta página carrega o próprio
// bundle enxuto em vez de scripts.html, então o menu compartilhado precisa
// ser ligado aqui também.
watchMainMenu();
watchHeaderCondense();

const API = window.appApiDomain || 'https://h72-api.appcivico.com/v1/';
const YEAR = window.appDonorsYear;
const LABELS = window.appDonorsLabels || {};
const TIMEOUT_MS = 12000;

// Quantos pontos a seção "duas eleições" desenha. 500 é o maior número em que
// o porte grande ainda aparece com mais de um ponto no recorte por pessoas
// (176 de 14.856 dão 6 pontos) sem transformar a seção em 1.000 nós de DOM.
const DOTS = 500;

// Quantas candidaturas cada lista mostra, e o piso de receita de pessoa
// física para entrar nelas. O piso existe para uma candidatura com R$ 900
// declarados e um doador só não encabeçar o ranking de dependência.
const LIST_RESULTS = 6;
const SMALL_LIST_FLOOR = 200000;
const DEPENDENT_LIST_FLOOR = 100000;
const RANKING_PAGE = 20;

// Geometria do beeswarm, em unidades do viewBox (estático no template, pela
// mesma razão do gráfico de inclinação: mude os dois juntos). O piso é o
// menor corte que a API entrega doador a doador; quando `min_total` voltar a
// funcionar, basta trocar SWARM_FLOOR por 10000 para a nuvem dos médios entrar.
const SWARM_WIDTH = 1000;
const SWARM_HEIGHT = 380;
const SWARM_FLOOR = THRESHOLDS[0];
const SWARM_RESULTS = 5000;

// Geometria do gráfico de inclinação, em unidades do viewBox. O viewBox é
// estático no template (in-DOM não preserva o "B" maiúsculo de um atributo
// ligado), então estes dois números são espelhados lá: mude os dois juntos.
const SLOPE_WIDTH = 1000;
const SLOPE_HEIGHT = 340;

// Quantas fatias os gráficos de partido e cargo mostram antes de agrupar o
// resto em "outros": a paleta é fixa e nunca ciclada, e uma lista de 28
// partidos deixa de ser comparação e vira tabela.
const PARTY_ROWS = 8;

/**
 * Uma requisição da API, com o ano da página e o corte já embutidos.
 * Timeout explícito porque um fetch pendurado deixaria a seção em "carregando"
 * para sempre, que é pior do que uma falha honesta.
 */
async function getJSON(path, params = {}) {
  const url = new URL(path, API);
  url.searchParams.set('year', YEAR);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function sumBy(rows, pick) {
  return (rows || []).reduce((total, row) => total + toNumber(pick(row)), 0);
}

window.$vueDoadores = Vue.createApp({
  data() {
    return {
      threshold: DEFAULT_THRESHOLD,
      thresholds: THRESHOLDS,
      smallMax: SMALL_MAX,
      labels: LABELS,
      summary: null,
      breakdown: null,
      concentration: null,
      timeline: null,
      ranking: [],
      rankingHasMore: false,
      rankingPage: 1,
      rankingLoading: false,
      smallLed: [],
      dependent: [],
      loading: true,
      error: false,
      dotMode: 'people',
      swarmDonors: [],
      swarmMode: 'tier',
      tip: null,
      bandChart: null,
      openDonorId: null,
      donorDetail: null,
      donorDetailLoading: false,
      // Toda resposta carrega o número do pedido que a disparou. O leitor
      // troca de corte mais rápido do que a rede responde, e sem isso a
      // resposta antiga de R$ 100 mil sobrescreve a nova de R$ 1 milhão.
      requestId: 0,
      timelineChart: null,
      // Os dois pisos aparecem na copy das listas; ficam no data para o
      // texto ler o mesmo número que a requisição usou.
      smallListFloor: SMALL_LIST_FLOOR,
      dependentListFloor: DEPENDENT_LIST_FLOOR,
    };
  },
  computed: {
    // Os três portes com os números já normalizados (a API mistura número e
    // string no mesmo campo) e o rótulo que a tabela e os gráficos usam.
    tiers({ summary, labels } = this) {
      const tiers = summary?.tiers;
      if (!tiers) return [];

      const individuals = toNumber(summary?.individuals?.value);
      const people = toNumber(summary?.individuals?.donors);

      return TIERS.map((key) => {
        const tier = tiers[key] || {};
        return {
          key,
          name: labels[key] || key,
          range: this.tierRange(key),
          donors: toNumber(tier.donors),
          value: toNumber(tier.value),
          transfers: toNumber(tier.transfers),
          meanTotal: toNumber(tier.mean_total),
          medianTotal: toNumber(tier.median_total),
          modeTransfer: toNumber(tier.mode_transfer),
          reached: toNumber(tier.candidacies_reached),
          singleShare: toNumber(tier.single_candidacy_share),
          peopleShare: share(tier.donors, people),
          valueShare: share(tier.value, individuals),
        };
      });
    },
    // As duas barras de 100% do topo da tabela: as mesmas pessoas repartidas
    // primeiro por cabeça, depois por dinheiro.
    tierBars({ tiers } = this) {
      if (!tiers.length) return [];
      return [
        { key: 'people', label: this.labels.people, pick: 'peopleShare' },
        { key: 'money', label: this.labels.money, pick: 'valueShare' },
      ].map((bar) => ({
        ...bar,
        parts: tiers.map((tier) => ({
          key: tier.key,
          name: tier.name,
          share: tier[bar.pick],
          detail: bar.key === 'people'
            ? `${formatNumeral(tier.donors)} ${this.labels.peopleWord}`
            : spelledCurrency(tier.value),
        })),
      }));
    },
    // Os 500 pontos, recolorido conforme o leitor troca de pergunta. É sempre
    // o mesmo conjunto de pontos: o que muda é o que cada um representa.
    dots({ tiers, dotMode } = this) {
      if (!tiers.length) return [];
      const weights = tiers.map((tier) => (dotMode === 'people' ? tier.donors : tier.value));
      const cells = largestRemainder(weights, DOTS);
      const out = [];
      cells.forEach((count, index) => {
        for (let i = 0; i < count; i += 1) out.push(tiers[index].key);
      });
      return out;
    },
    dotLegend({ tiers, dotMode, summary } = this) {
      if (!tiers.length) return [];
      const each = dotMode === 'people'
        ? toNumber(summary?.individuals?.donors) / DOTS
        : toNumber(summary?.individuals?.value) / DOTS;
      return tiers.map((tier) => ({
        key: tier.key,
        name: tier.name,
        range: tier.range,
        share: dotMode === 'people' ? tier.peopleShare : tier.valueShare,
        detail: dotMode === 'people'
          ? `${formatNumeral(tier.donors)} ${this.labels.peopleWord}`
          : spelledCurrency(tier.value),
        each,
      }));
    },
    dotEach({ dotMode, summary } = this) {
      if (!summary) return '';
      return dotMode === 'people'
        ? `${formatNumeral(Math.round(toNumber(summary.individuals.donors) / DOTS))} ${this.labels.peopleWord}`
        : spelledCurrency(toNumber(summary.individuals.value) / DOTS);
    },
    // Quantos pequenos doadores medianos cabem num grande doador mediano.
    scale({ summary } = this) {
      const ratio = medianRatio(summary?.tiers);
      if (!ratio) return null;
      return {
        ratio,
        big: toNumber(summary.tiers.big.median_total),
        small: toNumber(summary.tiers.small.median_total),
        // A grade desenha no máximo mil bonecos; acima disso a seção diz o
        // número e mostra a amostra, em vez de travar o navegador.
        drawn: Math.min(ratio, 1000),
        capped: ratio > 1000,
      };
    },
    // Waffles de 100 quadrados: para onde iriam 100 moedas de cada grupo de
    // doadores, e como seria se seguissem a proporção das candidaturas.
    waffles({ breakdown, tiers, threshold } = this) {
      const groups = breakdown?.intersection;
      if (!groups?.length) return [];

      const bigTier = tiers.find((tier) => tier.key === 'big');
      const smallTier = tiers.find((tier) => tier.key === 'small');

      const panels = [
        {
          key: 'big',
          title: this.labels.big,
          note: `${spelledCurrency(bigTier?.value || 0)} · ${this.labels.above} ${spelledCurrency(threshold)}`,
          weight: (group) => toNumber(group.big?.value),
        },
        {
          key: 'small',
          title: this.labels.small,
          note: `${spelledCurrency(smallTier?.value || 0)} · ${this.labels.upTo} ${spelledCurrency(SMALL_MAX)}`,
          weight: (group) => toNumber(group.small?.value),
        },
        {
          key: 'registered',
          title: this.labels.registered,
          note: `${formatNumeral(sumBy(groups, (group) => group.candidacies_registered))} ${this.labels.candidacies}`,
          weight: (group) => toNumber(group.candidacies_registered),
        },
      ];

      return panels.map((panel) => {
        const weights = groups.map(panel.weight);
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        const cells = largestRemainder(weights, 100);
        const rows = groups.map((group, index) => ({
          id: group.id,
          name: group.name,
          cells: cells[index],
          share: share(weights[index], total),
        }));
        const flat = [];
        rows.forEach((row) => {
          for (let i = 0; i < row.cells; i += 1) flat.push(row.id);
        });
        return { ...panel, rows, flat };
      });
    },
    // As três linhas do gráfico de inclinação, com a régua tracejada de cada
    // grupo (a fatia que ele tem entre as candidaturas registradas).
    slope({ breakdown } = this) {
      if (!breakdown) return null;

      const line = (rows, matches, key, name) => {
        if (!rows?.length) return null;
        const chosen = rows.filter(matches);
        return {
          key,
          name,
          points: TIERS.map((tier) => ({
            tier,
            share: share(
              sumBy(chosen, (row) => row[tier]?.value),
              sumBy(rows, (row) => row[tier]?.value),
            ),
          })),
          reference: share(
            sumBy(chosen, (row) => row.candidacies_registered),
            sumBy(rows, (row) => row.candidacies_registered),
          ),
        };
      };

      const lines = [
        line(breakdown.gender, (row) => row.id === 2, 'women', this.labels.women),
        line(breakdown.race, (row) => row.id === 4 || row.id === 5, 'black', this.labels.black),
        line(breakdown.intersection, (row) => row.id === 1, 'black-women', this.labels.blackWomen),
      ].filter(Boolean);

      if (!lines.length) return null;

      // O teto acompanha o dado (a maior fatia ou a maior régua), senão as
      // três linhas ficam espremidas no rodapé de um eixo de 60%.
      const top = Math.max(
        0.08,
        ...lines.map((entry) => Math.max(
          entry.reference,
          ...entry.points.map((point) => point.share),
        )),
      ) * 1.25;

      const width = SLOPE_WIDTH;
      const height = SLOPE_HEIGHT;
      const left = 190;
      const right = 250;
      const topPad = 26;
      const bottom = 54;
      const x = (index) => left + ((width - left - right) * index) / (TIERS.length - 1);
      const y = (value) => (height - bottom) - ((height - bottom - topPad) * (value / top));

      return {
        width,
        height,
        left,
        axisX: TIERS.map((tier, index) => ({ tier, x: x(index), name: this.labels[tier] })),
        baseline: height - bottom,
        topPad,
        lines: lines.map((entry) => ({
          ...entry,
          polyline: entry.points.map((point, index) => `${x(index)},${y(point.share)}`).join(' '),
          // Rótulo só nas pontas: com três linhas e três portes, um número
          // sobre cada ponto vira colisão no meio do gráfico. `anchor` joga o
          // primeiro para a direita do ponto (onde não bate na régua
          // tracejada) e o último para a esquerda (onde não bate no nome).
          dots: entry.points.map((point, index) => ({
            ...point,
            x: x(index),
            y: y(point.share),
            labelled: index === 0 || index === TIERS.length - 1,
            labelX: x(index) + (index === 0 ? 9 : -9),
            anchor: index === 0 ? 'start' : 'end',
          })),
          referenceY: y(entry.reference),
          endX: x(TIERS.length - 1),
          endY: y(entry.points[TIERS.length - 1].share),
        })),
      };
    },
    // Cada círculo é uma pessoa acima do piso; o x é o total doado em escala
    // logarítmica, o raio cresce com a raiz do total (área proporcional ao
    // dinheiro) e o y vem do layout de "dodge", que só afasta quem colide.
    swarm({ swarmDonors, threshold, swarmMode } = this) {
      if (!swarmDonors.length) return null;

      const left = 24;
      const right = 24;
      const top = 56;
      const bottom = 52;
      const plotWidth = SWARM_WIDTH - left - right;
      const plotHeight = SWARM_HEIGHT - top - bottom;
      const centerY = top + plotHeight / 2;

      const totals = swarmDonors.map((donor) => toNumber(donor.total_value));
      const min = SWARM_FLOOR;
      const max = Math.max(...totals) * 1.15;
      const logMin = Math.log10(min);
      const logSpan = Math.log10(max) - logMin || 1;
      const x = (value) => {
        const position = (Math.log10(Math.max(value, min)) - logMin) / logSpan;
        return left + position * plotWidth;
      };

      // Se a nuvem estourar a altura, os raios encolhem juntos até caber:
      // a proporção entre os círculos é o que importa, não o tamanho absoluto.
      let scale = 1;
      let placed = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const rMin = 3 * scale;
        const rMax = 26 * scale;
        placed = beeswarmLayout(swarmDonors.map((donor) => {
          const value = toNumber(donor.total_value);
          const t = Math.sqrt((value - min) / (max - min));
          return {
            donor,
            value,
            x: x(value),
            r: rMin + (rMax - rMin) * Math.min(1, Math.max(0, t)),
          };
        }), 1.2);
        const extent = Math.max(...placed.map((item) => Math.abs(item.y) + item.r));
        if (extent <= plotHeight / 2) break;
        scale *= 0.88;
      }

      const ticks = [50000, 100000, 250000, 500000, 1e6, 2.5e6, 5e6, 1e7, 2.5e7, 5e7]
        .filter((tick) => tick >= min && tick <= max)
        .map((tick) => ({ value: tick, x: x(tick), label: spelledCurrency(tick) }));

      const color = (item) => {
        if (swarmMode === 'concentration') {
          return toNumber(item.donor.candidacies_count) === 1 ? 'single' : 'many';
        }
        return item.value > threshold ? 'big' : 'medium';
      };

      const nodes = placed.map((item) => ({
        ...item,
        cy: centerY + item.y,
        tone: color(item),
      }));

      return {
        nodes,
        ticks,
        axisY: SWARM_HEIGHT - bottom + 8,
        cutX: threshold > SWARM_FLOOR ? x(threshold) : null,
        cutTop: top - 30,
        bigCount: nodes.filter((item) => item.value > threshold).length,
        mediumCount: nodes.filter((item) => item.value <= threshold).length,
        floor: SWARM_FLOOR,
      };
    },
    // Os números do bloco dos pequenos doadores. O "de N candidaturas" usa as
    // candidaturas com alguma receita de pessoa física, que o /breakdown
    // devolve por grupo e aqui são somadas.
    smallNumbers({ tiers, breakdown } = this) {
      const small = tiers.find((tier) => tier.key === 'small');
      const big = tiers.find((tier) => tier.key === 'big');
      if (!small || !big) return null;
      const gender = breakdown?.gender || [];
      const women = gender.filter((row) => row.id === 2);
      return {
        ...small,
        ratio: small.value > 0 ? big.value / small.value : null,
        candidaciesWithIndividuals: sumBy(gender, (row) => row.candidacies_registered),
        womenShare: share(
          sumBy(women, (row) => row.small?.value),
          sumBy(gender, (row) => row.small?.value),
        ),
        womenShareBig: share(
          sumBy(women, (row) => row.big?.value),
          sumBy(gender, (row) => row.big?.value),
        ),
      };
    },
    // As oito faixas de porte como "de cada 100 doadores" e "de cada R$ 100":
    // a mesma pergunta do histograma por doação, com as bordas que a API
    // confirma (o histograma por doação vem sem bordas e ficou de fora).
    bandRows({ summary } = this) {
      const bands = summary?.bands;
      if (!bands?.length) return [];
      const donors = sumBy(bands, (band) => band.donors);
      const value = sumBy(bands, (band) => band.value);
      return TOTAL_BANDS.map((entry) => {
        const row = bands.find((band) => Number(band.total_band) === entry.band) || {};
        return {
          band: entry.band,
          label: bandLabel(entry.band),
          donors: toNumber(row.donors),
          value: toNumber(row.value),
          donorsShare: share(row.donors, donors),
          valueShare: share(row.value, value),
        };
      });
    },
    // O /donors devolve as siglas do doador sem o nome do partido, e pelo
    // menos uma delas chega nula (o PSD, em 02/09/2026). O /breakdown traz id
    // e nome no mesmo objeto, então serve de dicionário para o ranking.
    partyNames({ breakdown } = this) {
      const names = new Map();
      (breakdown?.party || []).forEach((row) => {
        names.set(row.id, row.acronym || row.name);
      });
      return names;
    },
    partyRows({ breakdown } = this) {
      return this.compareRows(breakdown?.party, PARTY_ROWS);
    },
    positionRows({ breakdown } = this) {
      return this.compareRows(breakdown?.position, 0);
    },
    // Concentração: de cada 100 doadores do porte, quantos apoiaram uma, duas
    // ou muitas candidaturas. A API entrega contagem de doadores por balde
    // (não o dinheiro), então a leitura de dinheiro fica com single_share.
    concentrationRows({ concentration, tiers } = this) {
      if (!concentration) return [];
      return tiers.map((tier) => {
        const buckets = concentration[tier.key] || [];
        const total = sumBy(buckets, (bucket) => bucket.donors);
        return {
          key: tier.key,
          name: tier.name,
          range: tier.range,
          singleShare: tier.singleShare,
          buckets: buckets.map((bucket) => ({
            bucket: bucket.bucket,
            donors: toNumber(bucket.donors),
            share: share(bucket.donors, total),
          })),
        };
      });
    },
    // Uma parte das declarações traz data futura (erro de preenchimento na
    // prestação de contas). Elas esticavam o eixo do gráfico até outubro com
    // uma linha reta em 100%, então ficam fora daqui e são contadas na
    // legenda, em vez de sumirem sem aviso.
    timelineDays({ timeline } = this) {
      const today = new Date().toLocaleDateString('en-CA');
      return (timeline?.days || []).filter((row) => row.date <= today);
    },
    futureDays({ timeline, timelineDays } = this) {
      return (timeline?.days || []).length - timelineDays.length;
    },
    // A data da doação mais recente que já aparece nas declarações. Não é a
    // data da coleta (o /donors/summary não devolve uma), e a diferença
    // importa: o texto diz "declarada até", nunca "atualizado em".
    lastDeclared({ timelineDays } = this) {
      if (!timelineDays.length) return null;
      return timelineDays.reduce(
        (latest, row) => (row.date > latest ? row.date : latest),
        timelineDays[0].date,
      );
    },
    // O dia em que cada porte passou da metade do próprio dinheiro. Saía como
    // três marcas dentro do gráfico, que caem em datas próximas e viravam
    // três rótulos empilhados por cima das linhas.
    halfwayDates({ timelineDays, tiers } = this) {
      if (!timelineDays.length || !tiers.length) return [];
      const series = cumulativeSeries(timelineDays);
      return tiers
        .map((tier) => ({ key: tier.key, name: tier.name, date: halfwayDate(series[tier.key]) }))
        .filter((entry) => entry.date);
    },
  },
  methods: {
    formatNumeral,
    spelledCurrency,
    formatCurrencyNoAbbr,
    share,
    toNumber,
    formatPercent(value, digits = 0) {
      return `${formatNumeral((toNumber(value) * 100), digits)}%`;
    },
    formatPoints(value) {
      const points = toNumber(value) * 100;
      const sign = points > 0 ? '+' : '';
      return `${sign}${formatNumeral(points, 0)} p.p.`;
    },
    formatDate(iso) {
      if (!iso) return '';
      const date = new Date(`${iso}T12:00:00Z`);
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
    },
    // A faixa em reais de cada porte, como o leitor lê no cabeçalho da
    // tabela: o pequeno tem teto fixo, o grande depende do corte escolhido,
    // e o médio é o intervalo entre os dois.
    tierRange(key) {
      const { labels } = this;
      if (key === 'small') return `${labels.upTo} ${spelledCurrency(SMALL_MAX)}`;
      if (key === 'big') return `${labels.above} ${spelledCurrency(this.threshold)}`;
      return `${spelledCurrency(SMALL_MAX)} ${labels.to} ${spelledCurrency(this.threshold)}`;
    },
    partyLabel(row) {
      // O PSD chega com acronym null na API; o nome longo é o que sobra.
      return row.acronym || row.name;
    },
    // Sigla de um partido citado só por id (as tags do ranking).
    partyTag(party) {
      return party.acronym || this.partyNames.get(party.id) || '';
    },
    // Plural só quando é plural: "1 candidaturas" numa lista de doadores que
    // apostam em um nome só é justamente o caso mais comum da página.
    countLabel(count, one, many) {
      const number = toNumber(count);
      return `${formatNumeral(number)} ${number === 1 ? one : many}`;
    },
    // Duas barras por linha (grandes e pequenos), cada uma como fatia do
    // próprio porte, mais a diferença em pontos percentuais. É a comparação
    // que a seção existe para fazer: os dois grupos financiam o mesmo país?
    compareRows(rows, limit) {
      if (!rows?.length) return [];

      const totalBig = sumBy(rows, (row) => row.big?.value);
      const totalSmall = sumBy(rows, (row) => row.small?.value);

      let mapped = rows.map((row) => ({
        id: row.id,
        label: this.partyLabel(row),
        big: share(row.big?.value, totalBig),
        small: share(row.small?.value, totalSmall),
        bigValue: toNumber(row.big?.value),
        smallValue: toNumber(row.small?.value),
      })).sort((a, b) => b.big - a.big);

      if (limit && mapped.length > limit) {
        const head = mapped.slice(0, limit);
        const rest = mapped.slice(limit);
        head.push({
          id: 'rest',
          label: `${this.labels.others} (${rest.length})`,
          big: rest.reduce((sum, row) => sum + row.big, 0),
          small: rest.reduce((sum, row) => sum + row.small, 0),
          bigValue: rest.reduce((sum, row) => sum + row.bigValue, 0),
          smallValue: rest.reduce((sum, row) => sum + row.smallValue, 0),
        });
        mapped = head;
      }

      const max = Math.max(...mapped.map((row) => Math.max(row.big, row.small)), 0.01);
      return mapped.map((row) => ({
        ...row,
        bigWidth: (row.big / max) * 100,
        smallWidth: (row.small / max) * 100,
        delta: row.big - row.small,
      }));
    },
    showTip(event, node) {
      const { donor } = node;
      this.tip = {
        x: Math.min(event.clientX + 14, window.innerWidth - 280),
        y: event.clientY + 14,
        name: donor.name || this.labels.unnamed,
        total: spelledCurrency(node.value),
        candidacies: this.countLabel(
          donor.candidacies_count,
          this.labels.candidacy,
          this.labels.candidacies,
        ),
      };
    },
    hideTip() {
      this.tip = null;
    },
    // Todo mundo acima do piso, uma vez só: o beeswarm não depende do corte
    // escolhido (o corte só recolore os círculos e move a linha).
    async loadSwarm() {
      try {
        const data = await getJSON('donors', {
          threshold: SWARM_FLOOR,
          fields: 'light',
          results: SWARM_RESULTS,
        });
        this.swarmDonors = data.donors || [];
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    },
    // Duas colunas por faixa de porte, as duas em porcentagem do próprio
    // total, no mesmo eixo: quantas pessoas caem ali e quanto dinheiro.
    renderBandChart() {
      const container = document.getElementById('js-doadores-bands');
      if (!container || typeof Highcharts === 'undefined' || !this.bandRows.length) return;

      Highcharts.setOptions(chartTheme);
      if (this.bandChart) this.bandChart.destroy();
      this.bandChart = Highcharts.chart('js-doadores-bands', {
        chart: { type: 'column', height: 360 },
        title: { text: null },
        xAxis: {
          categories: this.bandRows.map((row) => row.label),
          labels: { style: { fontSize: '11px' } },
        },
        yAxis: {
          title: { text: null },
          min: 0,
          max: 100,
          labels: { format: '{value}%' },
        },
        tooltip: {
          shared: true,
          valueDecimals: 1,
          valueSuffix: '%',
        },
        plotOptions: {
          column: {
            borderRadius: 3,
            pointPadding: 0.06,
            groupPadding: 0.12,
            dataLabels: {
              enabled: true,
              // eslint-disable-next-line object-shorthand, func-names
              formatter: function () {
                // Dois doadores em 14.856 são 0,01%: "0,0%" leria como zero.
                if (this.y < 0.05) return '<0,1%';
                return this.y >= 1 ? `${formatNumeral(this.y, 0)}%` : `${formatNumeral(this.y, 1)}%`;
              },
              style: { fontSize: '11px', fontWeight: '600', textOutline: 'none' },
            },
          },
        },
        series: [
          {
            name: this.labels.ofPeople,
            color: '#7a7488',
            data: this.bandRows.map((row) => row.donorsShare * 100),
          },
          {
            name: this.labels.ofMoney,
            color: '#b45309',
            data: this.bandRows.map((row) => row.valueShare * 100),
          },
        ],
      });
    },
    selectThreshold(value) {
      if (value === this.threshold) return;
      this.threshold = value;
      this.openDonorId = null;
      this.donorDetail = null;
      this.rankingPage = 1;
      this.loadThresholdData();
    },
    async loadThresholdData() {
      this.requestId += 1;
      const ticket = this.requestId;
      const { threshold } = this;

      try {
        const [
          summary, breakdown, concentration, timeline, ranking, dependent,
        ] = await Promise.all([
          getJSON('donors/summary', { threshold }),
          getJSON('donors/breakdown', {
            threshold,
            by: 'party,position,gender,race,intersection',
            tiers: 'small,medium,big',
          }),
          getJSON('donors/concentration', { threshold }),
          getJSON('donors/timeline', { threshold }),
          getJSON('donors', { threshold, results: RANKING_PAGE, page: 1 }),
          getJSON('donors/candidacies', {
            metric: 'top_donor_share',
            threshold,
            min_individuals: DEPENDENT_LIST_FLOOR,
            results: LIST_RESULTS,
          }),
        ]);

        if (ticket !== this.requestId) return;

        this.summary = summary;
        this.breakdown = breakdown;
        this.concentration = concentration;
        this.timeline = timeline;
        this.ranking = ranking.donors || [];
        this.rankingHasMore = Boolean(ranking.has_more);
        this.dependent = dependent.candidacies || [];
        this.error = false;
      } catch (err) {
        if (ticket !== this.requestId) return;
        // eslint-disable-next-line no-console
        console.error(err);
        this.error = true;
      } finally {
        if (ticket === this.requestId) {
          this.loading = false;
          this.$nextTick(() => {
            this.renderTimeline();
            this.renderBandChart();
          });
        }
      }
    },
    // A lista das candidaturas mais sustentadas por pequenos doadores não
    // depende do corte, então é buscada uma vez só.
    async loadSmallLed() {
      try {
        const data = await getJSON('donors/candidacies', {
          metric: 'small_share',
          min_individuals: SMALL_LIST_FLOOR,
          results: LIST_RESULTS,
        });
        this.smallLed = data.candidacies || [];
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    },
    async loadMoreDonors() {
      if (this.rankingLoading || !this.rankingHasMore) return;
      this.rankingLoading = true;
      const nextPage = this.rankingPage + 1;
      try {
        const data = await getJSON('donors', {
          threshold: this.threshold,
          results: RANKING_PAGE,
          page: nextPage,
        });
        this.ranking = this.ranking.concat(data.donors || []);
        this.rankingHasMore = Boolean(data.has_more);
        this.rankingPage = nextPage;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        this.rankingLoading = false;
      }
    },
    async toggleDonor(donorId) {
      if (this.openDonorId === donorId) {
        this.openDonorId = null;
        return;
      }

      this.openDonorId = donorId;
      this.donorDetail = null;
      this.donorDetailLoading = true;

      try {
        const data = await getJSON(`donors/${donorId}`, {});
        if (this.openDonorId !== donorId) return;
        this.donorDetail = data;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (this.openDonorId === donorId) this.donorDetailLoading = false;
      }
    },
    // Quanto do dinheiro de cada porte já havia sido declarado a cada dia.
    // Uma linha que sobe cedo é um grupo que decide antes da campanha.
    renderTimeline() {
      const container = document.getElementById('js-doadores-timeline');
      if (!container || typeof Highcharts === 'undefined') return;

      const series = cumulativeSeries(this.timelineDays);
      const keys = TIERS.filter((tier) => series[tier]?.length);
      if (!keys.length) return;

      const colors = { small: categorical[1], medium: '#a9a3b4', big: categorical[0] };

      Highcharts.setOptions(chartTheme);
      if (this.timelineChart) this.timelineChart.destroy();
      this.timelineChart = Highcharts.chart('js-doadores-timeline', {
        chart: { type: 'spline', height: 380 },
        title: { text: null },
        legend: { enabled: true },
        xAxis: {
          type: 'datetime',
          labels: { format: '{value:%e %b}' },
        },
        yAxis: {
          title: { text: null },
          min: 0,
          max: 100,
          labels: { format: '{value}%' },
        },
        tooltip: {
          shared: true,
          xDateFormat: '%e de %B',
          valueDecimals: 1,
          valueSuffix: '%',
        },
        plotOptions: { spline: { marker: { enabled: false }, lineWidth: 2.5 } },
        series: keys.map((tier) => ({
          name: this.labels[tier],
          color: colors[tier],
          data: series[tier].map((point) => [
            Date.parse(`${point.date}T12:00:00Z`),
            point.share * 100,
          ]),
        })),
      });
    },
  },
  mounted() {
    this.loadThresholdData();
    this.loadSmallLed();
    this.loadSwarm();
  },
}).mount('#vueDoadores');
