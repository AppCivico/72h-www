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

// Below this much Fundo Eleitoral declared as received, the percentages still
// reflect a handful of transfers and may not represent how the party will
// distribute money over the campaign, so those parties go to the "quase nada
// distribuído" list instead. Mirrors RANKING_FLOOR in scripts/partyPanel.mjs
// -- change both together.
const RANKING_FLOOR = 250000;

// O piso fixo, em pontos percentuais: 30% do Fundo Eleitoral para
// candidaturas de pessoas pretas e pardas (art. 17, § 9º, da Constituição),
// independentemente de quantas candidaturas negras o partido tenha. Para
// mulheres, 30% é só o mínimo: a obrigação acompanha a proporção de
// candidatas do partido (art. 17, § 8º), e é ela que vale abaixo.
const FLOOR_SHARE = 30;

// Normaliza sigla para casar nossa tabela de partidos com a do TSE
// ("PC do B" vs "PCDOB", caixa, acento). Gêmeo de foldAcronym em
// scripts/partyPanel.mjs -- se um mudar, mude o outro.
function foldAcronym(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

// Piso proporcional de mulheres por partido, calculado das candidaturas
// registradas e divulgadas pelo TSE. Ausente = partido fora daquela tabela
// (extinto, ou sem candidatura aceita), e aí a régua volta a ser o mínimo.
const femaleFloors = new Map(
  (window.appCandidacies?.parties || []).map((party) => [
    foldAcronym(party.acronym), party,
  ]),
);

// How many parties the thermometer draws: the five biggest Fundo Eleitoral
// quotas, one line per categorical color -- more than that turns into
// spaghetti and the palette (deliberately fixed, never cycled) runs out.
const THERMO_PARTIES = 5;

const CAMPAIGN_START = '2026-08-16';
const FIRST_ROUND = '2026-10-04';

function parseDay(iso) {
  return Date.parse(`${iso}T12:00:00Z`);
}

// Cumulative share of a group in a party's Fundo Eleitoral, day by day -- the
// JSON carries raw daily deltas so this stays a display concern. `groupDaily`
// is null when tracking women, whose split already lives in the F/M fields.
function cumulativeShare(fefcDaily, groupDaily) {
  const groupByDate = groupDaily
    ? new Map(groupDaily.map((day) => [day.d, day.f + day.m]))
    : null;
  let total = 0;
  let group = 0;
  return fefcDaily.map((day) => {
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
      // Lowest share first by default: the page exists to show where the
      // earmarked money has not arrived yet -- the reader can flip it.
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
        const { total } = party.fefc;
        const candidacies = femaleFloors.get(foldAcronym(party.acronym))
          || femaleFloors.get(foldAcronym(party.name));
        const floor = candidacies ? candidacies.female_floor : FLOOR_SHARE;
        return {
          ...party,
          femaleShare: total > 0 ? (party.fefc.female / total) * 100 : null,
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
          // Aqui a régua é a do próprio partido, não os 30% de todo mundo:
          // um partido com 40% de candidatas deve 40% do Fundo Eleitoral, e
          // comparar com 30% mostraria como cumprindo quem já deveria estar
          // repassando mais.
          belowFemale: total > 0 && (party.fefc.female / total) * 100 < floor,
          femaleFloor: floor,
          femaleFloorKnown: Boolean(candidacies),
          candidacies: candidacies || null,
        };
      });
    },
    rankedRows({
      entries, sortBy, sortAsc, onlyBelow,
    } = this) {
      const key = { black: 'blackShare', female: 'femaleShare', quota: 'quotaUsed' }[sortBy];
      return entries
        .filter((entry) => entry.fefc.total >= RANKING_FLOOR)
        // O filtro pega quem está abaixo de 30% em QUALQUER uma das duas
        // réguas: é o recorte de fiscalização, não a média das duas.
        .filter((entry) => !onlyBelow || entry.belowBlack || entry.belowFemale)
        .sort((a, b) => {
          // Sem dado vai sempre para o fim, nas duas direções: um partido sem
          // cota casada não é "o pior" da régua, é ausência de régua.
          if (a[key] === null && b[key] === null) return b.fefc.total - a.fefc.total;
          if (a[key] === null) return 1;
          if (b[key] === null) return -1;
          if (a[key] !== b[key]) return sortAsc ? a[key] - b[key] : b[key] - a[key];
          return b.fefc.total - a.fefc.total;
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
        .filter((entry) => entry.fefc.total < RANKING_FLOOR)
        .filter((entry) => entry.fefc_quota !== null || entry.fefc.total > 0)
        .sort((a, b) => (b.fefc_quota || 0) - (a.fefc_quota || 0));
    },
    // Quantos partidos do placar estão abaixo do piso em cada régua. Sempre
    // sobre TODOS os partidos elegíveis ao placar, nunca sobre a lista já
    // filtrada -- senão o número mudaria ao ligar o próprio filtro.
    belowCounts({ entries } = this) {
      const eligible = entries.filter((entry) => entry.fefc.total >= RANKING_FLOOR);
      if (!eligible.length) return null;
      return {
        total: eligible.length,
        black: eligible.filter((entry) => entry.belowBlack).length,
        female: eligible.filter((entry) => entry.belowFemale).length,
        either: eligible.filter((entry) => entry.belowBlack || entry.belowFemale).length,
      };
    },
    maxDormantQuota({ dormantRows } = this) {
      return dormantRows.reduce((max, row) => Math.max(max, row.fefc_quota || 0), 0);
    },
    boardTotals({ entries } = this) {
      return {
        received: entries.reduce((sum, entry) => sum + entry.fefc.total, 0),
      };
    },
    // Que fração do fundo inteiro já apareceu nas declarações. É o número que
    // resume a página, então mora no cartão de abertura.
    fundShare({ panel, boardTotals } = this) {
      if (!panel?.fefc_total || !boardTotals.received) return null;
      return (boardTotals.received / panel.fefc_total) * 100;
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
    // O tamanho da base sobre a qual as fatias são calculadas. Enquanto os
    // partidos repassaram ~1% das próprias cotas, um único repasse grande
    // vira a fatia de cabeça para baixo -- dizer isso é obrigação, e o número
    // se atualiza sozinho em vez de envelhecer no texto.
    baseWarning({ entries } = this) {
      const used = entries
        .filter((entry) => entry.fefc.total >= RANKING_FLOOR && entry.quotaUsed !== null)
        .map((entry) => entry.quotaUsed);
      if (!used.length) return null;
      return { maxUsed: Math.max(...used) };
    },
    // Um arquivo de dados gerado antes da migração para Fundo Eleitoral puro
    // somava os dois fundos públicos. Se ele estiver no ar (a API caiu e o
    // gerador manteve a última cópia), a página tem de dizer isso em vez de
    // rotular a soma como Fundo Eleitoral.
    legacyBasis({ panel } = this) {
      return Boolean(panel) && panel.basis !== 'fefc';
    },
    // Quanto de Fundo Partidário as candidaturas declararam receber. Não
    // entra em nenhuma conta desta página: serve para dizer, em reais, o que
    // a escolha de acompanhar só o Fundo Eleitoral deixa de fora.
    partyFundDeclared({ panel } = this) {
      const value = panel?.party_fund_declared;
      return typeof value === 'number' && value > 0 ? value : null;
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
    // Duas casas para os bilhões do fundo: com uma, R$ 4,96 bi arredondaria
    // para "R$ 5 bi" e o cartão de abertura mentiria por R$ 40 milhões.
    formatCurrencyBig(value) {
      return compactCurrency(value, 2);
    },
    // Antes de 8/09 estar abaixo do piso é ritmo, não infração, e o selo diz
    // "abaixo do piso"; depois do prazo ele endurece para "fora do piso". A
    // troca é automática. QUAL das duas réguas ficou abaixo não vai no selo:
    // é a barra âmbar da coluna que diz, e um selo que precisava nomear a
    // régua ficava comprido e quebrava linha no meio da tabela.
    badgeFor(row) {
      const labels = window.appPanelBadges || {};
      if (!(row.belowBlack || row.belowFemale)) return '';
      return this.countdown && this.countdown.passed ? labels.after : labels.before;
    },
    // Barra proporcional à maior cota parada da lista, com um mínimo visível
    // para que os partidos pequenos não desapareçam.
    dormantBarWidth(row) {
      const max = this.maxDormantQuota;
      if (!max || !row.fefc_quota) return 0;
      return Math.max(1.5, (row.fefc_quota / max) * 100);
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
        .filter((entry) => entry.fefc.daily.length)
        .sort((a, b) => (b.fefc_quota || 0) - (a.fefc_quota || 0))
        .slice(0, THERMO_PARTIES);

      const series = parties.map((party, index) => ({
        name: party.acronym || party.name,
        color: categorical[index % categorical.length],
        data: this.thermoGroup === 'black'
          ? cumulativeShare(party.fefc.daily, party.black.daily)
          : cumulativeShare(party.fefc.daily, null),
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
          // Termina alguns dias depois do prazo das cotas, não no 1º turno:
          // esticar até outubro deixava mais de um mês de gráfico vazio à
          // direita, e o prazo é o que este gráfico existe para mostrar.
          softMax: parseDay(QUOTA_DEADLINES[window.appPanelYear] || FIRST_ROUND)
            + (3 * 86400000),
          plotLines: [
            verticalLine(CAMPAIGN_START, window.appPainelCharts?.campaignStartLabel || ''),
            verticalLine(QUOTA_DEADLINES[window.appPanelYear] || '2026-09-08', window.appPainelCharts?.deadlineLabel || ''),
          ],
        },
        yAxis: {
          title: { text: null },
          min: 0,
          // Uma fatia é no máximo 100%. Sem o teto, um partido que no
          // primeiro dia repassou tudo a um único grupo levava o eixo a 150%
          // e achatava todas as outras linhas contra o zero.
          max: 100,
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
