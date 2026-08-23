/* global Vue, Highcharts */
import chartTheme, { categorical, compactCurrency } from './utilities/chartTheme';
import formatCurrencyNoAbbr from './utilities/formatCurrencyNoAbbr';
import formatNumeral from './utilities/formatNumeral';
import { QUOTA_DEADLINES } from './utilities/electoralFund';
import watchMainMenu from './menuToggle';
import watchHeaderCondense from './components/headerCondense';

// Same reason as candidato.js: this page loads its own lean bundle instead of
// scripts.html, so the shared menu needs wiring here too.
watchMainMenu();
watchHeaderCondense();

// Below this much public money moved, percentage rankings are noise, so those
// parties go to the "quase nada distribuído" list instead. Mirrors
// RANKING_FLOOR in scripts/partyPanel.mjs -- change both together.
const RANKING_FLOOR = 250000;

// O piso legal, em pontos percentuais: 30% para candidaturas de pessoas
// pretas e pardas (EC 133/2024) e 30% para mulheres (Consulta TSE 2018 e
// EC 117/2022).
const FLOOR_SHARE = 30;

// How many parties the thermometer draws: the five biggest FEFC quotas, one
// line per categorical color -- more than that turns into spaghetti and the
// palette (deliberately fixed, never cycled) runs out.
const THERMO_PARTIES = 5;

const CAMPAIGN_START = '2026-08-16';
const FIRST_ROUND = '2026-10-04';

function parseDay(iso) {
  return Date.parse(`${iso}T12:00:00Z`);
}

// Cumulative share of a group in a party's public money, day by day -- the
// JSON carries raw daily deltas so this stays a display concern. `groupDaily`
// is null when tracking women, whose split already lives in the F/M fields.
function cumulativeShare(publicDaily, groupDaily) {
  const groupByDate = groupDaily
    ? new Map(groupDaily.map((day) => [day.d, day.f + day.m]))
    : null;
  let total = 0;
  let group = 0;
  return publicDaily.map((day) => {
    total += day.f + day.m;
    group += groupByDate ? (groupByDate.get(day.d) || 0) : day.f;
    return [parseDay(day.d), total > 0 ? (group / total) * 100 : null];
  });
}

window.$vuePainel = Vue.createApp({
  data() {
    return {
      panel: window.appPanel || null,
      waffleView: 'chamber',
      // Worst first by default: the page exists to show who is sitting on
      // public money that the law earmarks -- the reader can flip it.
      sortBy: 'black',
      sortAsc: true,
      onlyBelow: false,
      thermoGroup: 'black',
    };
  },
  computed: {
    countdown() {
      const deadlineISO = QUOTA_DEADLINES[window.appPanelYear];
      if (!deadlineISO) return null;
      const daysLeft = Math.ceil(
        (new Date(`${deadlineISO}T23:59:59-03:00`).getTime() - Date.now()) / 86400000,
      );
      return { daysLeft, passed: daysLeft <= 0 };
    },
    // Every party with display-ready shares. null shares (no money yet) never
    // reach the ranked table -- they land in the dormant list, where "no data"
    // is presented as absence, not as 0%.
    entries({ panel } = this) {
      if (!panel?.parties) return [];
      return panel.parties.map((party) => {
        const { total } = party.public;
        return {
          ...party,
          femaleShare: total > 0 ? (party.public.female / total) * 100 : null,
          blackShare: total > 0 ? (party.black.total / total) * 100 : null,
          blackFemaleShare: total > 0 ? (party.black.female / total) * 100 : null,
          quotaUsed: total > 0 && party.fefc_quota ? (total / party.fefc_quota) * 100 : null,
          // Marca a candidatura para o selo e o realce da linha, dizendo QUAL
          // régua ficou abaixo: a tabela ordena por UMA delas, então um selo
          // genérico fazia linhas marcadas aparecerem no meio de linhas sem
          // marca (um partido acima nos 30% de raça pode estar abaixo nos de
          // gênero) e a lista parecia fora de ordem. Um partido sem dinheiro
          // (share null) não é "fora do piso": é sem dado, e nem entra aqui.
          belowBlack: total > 0 && (party.black.total / total) * 100 < FLOOR_SHARE,
          belowFemale: total > 0 && (party.public.female / total) * 100 < FLOOR_SHARE,
        };
      });
    },
    rankedRows({
      entries, sortBy, sortAsc, onlyBelow,
    } = this) {
      const key = { black: 'blackShare', female: 'femaleShare', quota: 'quotaUsed' }[sortBy];
      return entries
        .filter((entry) => entry.public.total >= RANKING_FLOOR)
        // "Fora do piso" = abaixo de 30% em QUALQUER uma das duas réguas: é o
        // recorte de fiscalização, não a média das duas.
        .filter((entry) => !onlyBelow || entry.belowBlack || entry.belowFemale)
        .sort((a, b) => {
          // Sem dado vai sempre para o fim, nas duas direções: um partido sem
          // cota casada não é "o pior" da régua, é ausência de régua.
          if (a[key] === null && b[key] === null) return b.public.total - a.public.total;
          if (a[key] === null) return 1;
          if (b[key] === null) return -1;
          if (a[key] !== b[key]) return sortAsc ? a[key] - b[key] : b[key] - a[key];
          return b.public.total - a.public.total;
        });
    },
    // Biggest idle pot first: the bigger the quota sitting still, the more
    // newsworthy the stillness.
    //
    // Parties with neither a 2026 FEFC quota nor a single transfer are gone
    // from this election (the API's filter list still carries extinct and
    // merged ones: PSL, PTB, PSC, PROS, Patriota...). Listing them as
    // "quase nada distribuído" would blame them for not spending money they
    // never received.
    dormantRows({ entries } = this) {
      return entries
        .filter((entry) => entry.public.total < RANKING_FLOOR)
        .filter((entry) => entry.fefc_quota !== null || entry.public.total > 0)
        .sort((a, b) => (b.fefc_quota || 0) - (a.fefc_quota || 0));
    },
    // Quantos partidos do placar estão abaixo do piso em cada régua. Sempre
    // sobre TODOS os partidos elegíveis ao placar, nunca sobre a lista já
    // filtrada -- senão o número mudaria ao ligar o próprio filtro.
    belowCounts({ entries } = this) {
      const eligible = entries.filter((entry) => entry.public.total >= RANKING_FLOOR);
      if (!eligible.length) return null;
      return {
        total: eligible.length,
        black: eligible.filter((entry) => entry.belowBlack).length,
        female: eligible.filter((entry) => entry.belowFemale).length,
        either: eligible.filter((entry) => entry.belowBlack || entry.belowFemale).length,
      };
    },
    boardTotals({ entries } = this) {
      return {
        received: entries.reduce((sum, entry) => sum + entry.public.total, 0),
      };
    },
    // O eixo da cota não tem piso legal: ordenar por ele não é "pior/melhor",
    // é quem repassou menos. Rótulos e explicação seguem o eixo ativo.
    sortAxis({ sortBy } = this) {
      const labels = window.appPanelSort || {};
      if (sortBy === 'quota') {
        return { help: labels.helpQuota, asc: labels.ascQuota, desc: labels.descQuota };
      }
      return {
        help: sortBy === 'black' ? labels.helpBlack : labels.helpFemale,
        asc: labels.ascShare,
        desc: labels.descShare,
      };
    },
    generatedAtBR({ panel } = this) {
      if (!panel?.generated_at) return '';
      const date = new Date(panel.generated_at);
      const pad = (part) => String(part).padStart(2, '0');
      return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    },
  },
  async mounted() {
    await this.$nextTick();
    this.renderHistoryChart();
    this.renderThermoChart();
  },
  methods: {
    formatCurrencyNoAbbr,
    formatNumeral,
    formatCurrency(value) {
      return compactCurrency(value, 1);
    },
    setThermoGroup(group) {
      if (group === this.thermoGroup) return;
      this.thermoGroup = group;
      this.renderThermoChart();
    },
    // 1933 -> 2022: from one seat to ninety-one. Categories are only the
    // elections with a verified count (1994 is deliberately absent -- the
    // official series is incomplete there; see data/representacao2026.json).
    renderHistoryChart() {
      const container = document.getElementById('js-painel-history-chart');
      const series = window.appRepresentation?.women_elected_chamber?.series;
      if (!container || !series?.length) return;

      // 19 eleições não cabem legíveis num eixo de 360px: em telas estreitas
      // mostramos um rótulo a cada três, e o tooltip segue dando o ano exato.
      const labelStep = container.offsetWidth < 480 ? 3 : 1;

      Highcharts.setOptions(chartTheme);
      this.historyChart = Highcharts.chart('js-painel-history-chart', {
        chart: {
          type: 'column',
          backgroundColor: 'transparent',
          height: 320,
          spacingTop: 16,
          marginTop: 84,
        },
        title: { text: window.appPainelCharts?.historyTitle || '' },
        subtitle: { text: window.appPainelCharts?.historySubtitle || '' },
        legend: { enabled: false },
        xAxis: {
          categories: series.map((point) => String(point.year)),
          labels: { step: labelStep },
        },
        yAxis: { title: { text: null }, allowDecimals: false },
        tooltip: {
          // eslint-disable-next-line object-shorthand, func-names
          formatter: function () {
            return `<b>${this.key}</b>: ${this.y}`;
          },
        },
        plotOptions: {
          column: { borderRadius: 3, pointPadding: 0.05, groupPadding: 0.08 },
        },
        series: [{
          name: window.appPainelCharts?.historySeries || '',
          data: series.map((point) => point.count),
          color: categorical[0],
        }],
      });
    },
    // One line per party (the five biggest FEFC quotas): the share of its
    // cumulative public money that had reached the tracked group by each day.
    // A party planning to comply only at the deadline crawls under the 30%
    // line until September -- which is exactly what this chart exists to show.
    renderThermoChart() {
      const container = document.getElementById('js-painel-thermo-chart');
      if (!container || !this.entries.length) return;

      const parties = [...this.entries]
        .filter((entry) => entry.public.daily.length)
        .sort((a, b) => (b.fefc_quota || 0) - (a.fefc_quota || 0))
        .slice(0, THERMO_PARTIES);

      const series = parties.map((party, index) => ({
        name: party.acronym || party.name,
        color: categorical[index % categorical.length],
        data: this.thermoGroup === 'black'
          ? cumulativeShare(party.public.daily, party.black.daily)
          : cumulativeShare(party.public.daily, null),
        step: 'right',
        lineWidth: 2,
        marker: { enabled: false },
      }));

      const verticalLine = (iso, text) => ({
        value: parseDay(iso),
        color: '#8c8577',
        dashStyle: 'Dash',
        width: 1,
        zIndex: 3,
        label: { text, style: { color: '#565064', fontSize: '11px' } },
      });

      Highcharts.setOptions(chartTheme);
      this.thermoChart = Highcharts.chart('js-painel-thermo-chart', {
        chart: {
          type: 'line',
          backgroundColor: 'transparent',
          height: 360,
          spacingTop: 16,
          marginTop: 96,
        },
        title: { text: window.appPainelCharts?.thermoTitle || '' },
        subtitle: {
          text: this.thermoGroup === 'black'
            ? (window.appPainelCharts?.thermoSubtitleBlack || '')
            : (window.appPainelCharts?.thermoSubtitleFemale || ''),
        },
        legend: { enabled: true },
        xAxis: {
          type: 'datetime',
          softMin: parseDay(CAMPAIGN_START),
          softMax: parseDay(FIRST_ROUND),
          plotLines: [
            verticalLine(CAMPAIGN_START, window.appPainelCharts?.campaignStartLabel || ''),
            verticalLine(QUOTA_DEADLINES[window.appPanelYear] || '2026-09-08', window.appPainelCharts?.deadlineLabel || ''),
          ],
        },
        yAxis: {
          title: { text: null },
          min: 0,
          softMax: 60,
          labels: {
            // eslint-disable-next-line object-shorthand, func-names
            formatter: function () {
              return `${this.value}%`;
            },
          },
          plotLines: [{
            value: 30,
            color: '#b45309',
            dashStyle: 'ShortDash',
            width: 2,
            zIndex: 3,
            label: {
              text: window.appPainelCharts?.floorLabel || '',
              align: 'right',
              x: -4,
              style: { color: '#b45309', fontSize: '11px', fontWeight: '600' },
            },
          }],
        },
        tooltip: {
          // eslint-disable-next-line object-shorthand, func-names
          formatter: function () {
            return `<div style="min-width:9rem">
                <div style="margin-bottom:.25rem;font-weight:600">${this.series.name} · ${Highcharts.dateFormat('%d/%m/%Y', this.x)}</div>
                <div><b>${formatNumeral(this.y, 1)}%</b></div>
              </div>`;
          },
        },
        series,
      });
    },
  },
}).mount('#vuePainel');
