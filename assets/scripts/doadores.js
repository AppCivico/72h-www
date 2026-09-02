/* global Vue, Highcharts */
import chartTheme, { categorical, compactCurrency } from './utilities/chartTheme';
import formatCurrencyNoAbbr from './utilities/formatCurrencyNoAbbr';
import formatNumeral from './utilities/formatNumeral';
import watchMainMenu from './menuToggle';
import watchHeaderCondense from './components/headerCondense';
import {
  DEFAULT_THRESHOLD,
  SMALL_MAX,
  THRESHOLDS,
  TIERS,
  cumulativeSeries,
  halfwayDate,
  largestRemainder,
  medianRatio,
  share,
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
            : compactCurrency(tier.value),
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
          : compactCurrency(tier.value),
        each,
      }));
    },
    dotEach({ dotMode, summary } = this) {
      if (!summary) return '';
      return dotMode === 'people'
        ? `${formatNumeral(Math.round(toNumber(summary.individuals.donors) / DOTS))} ${this.labels.peopleWord}`
        : compactCurrency(toNumber(summary.individuals.value) / DOTS);
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
          note: `${compactCurrency(bigTier?.value || 0)} · ${this.labels.above} ${compactCurrency(threshold)}`,
          weight: (group) => toNumber(group.big?.value),
        },
        {
          key: 'small',
          title: this.labels.small,
          note: `${compactCurrency(smallTier?.value || 0)} · ${this.labels.upTo} ${compactCurrency(SMALL_MAX)}`,
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
    // A data da doação mais recente que já aparece nas declarações. Não é a
    // data da coleta (o /donors/summary não devolve uma), e a diferença
    // importa: o texto diz "declarada até", nunca "atualizado em".
    lastDeclared({ timeline } = this) {
      const days = timeline?.days;
      if (!days?.length) return null;
      return days.reduce((latest, row) => (row.date > latest ? row.date : latest), days[0].date);
    },
  },
  methods: {
    formatNumeral,
    compactCurrency,
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
      if (key === 'small') return `${labels.upTo} ${compactCurrency(SMALL_MAX)}`;
      if (key === 'big') return `${labels.above} ${compactCurrency(this.threshold)}`;
      return `${compactCurrency(SMALL_MAX)} ${labels.to} ${compactCurrency(this.threshold)}`;
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
          this.$nextTick(() => this.renderTimeline());
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

      const series = cumulativeSeries(this.timeline?.days);
      const keys = TIERS.filter((tier) => series[tier]?.length);
      if (!keys.length) return;

      const colors = { small: categorical[1], medium: '#a9a3b4', big: categorical[0] };

      const plotLines = keys.map((tier) => {
        const day = halfwayDate(series[tier]);
        if (!day) return null;
        return {
          value: Date.parse(`${day}T12:00:00Z`),
          color: colors[tier],
          dashStyle: 'Dash',
          width: 1,
          zIndex: 3,
          label: {
            text: `${this.labels[tier]}: ${this.labels.halfway} ${this.formatDate(day)}`,
            rotation: 0,
            // Escalonado por porte: as três marcas caem em datas próximas e
            // os rótulos se sobrepõem se saírem todos na mesma altura.
            y: 16 + TIERS.indexOf(tier) * 16,
            style: { color: '#565064', fontSize: '11px' },
          },
        };
      }).filter(Boolean);

      Highcharts.setOptions(chartTheme);
      if (this.timelineChart) this.timelineChart.destroy();
      this.timelineChart = Highcharts.chart('js-doadores-timeline', {
        chart: { type: 'spline', height: 380 },
        title: { text: null },
        legend: { enabled: true },
        xAxis: {
          type: 'datetime',
          plotLines,
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
  },
}).mount('#vueDoadores');
