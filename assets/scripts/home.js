/* global Vue, Highcharts */
import dayjs from 'dayjs';
import 'dayjs/locale/pt-br';
import duration from 'dayjs/plugin/duration';
import MicroModal from 'micromodal';
import numeral from 'numeral';
import listBox from './components/listBox';
import TransitionExpand from './components/TransitionExpand';
import config from './config';
import chartTheme, {
  binary,
  categorical,
  compactCurrency,
  sequentialRamp,
} from './utilities/chartTheme';
import { liveHtml, liveText } from './directives/liveValue';
import formatCurrencyNoAbbr from './utilities/formatCurrencyNoAbbr';
import formatNumeral from './utilities/formatNumeral';
import { FEFC_TOTALS, QUOTA_DEADLINES } from './utilities/electoralFund';
import { implausibleValue } from './utilities/implausibleValue';
import personUrl from './utilities/personUrl';

dayjs.extend(duration);
dayjs.locale('pt-br');

// pt-br numeral locale is registered as a side effect of importing
// formatNumeral above (shared with candidato.js) — numeral is a global
// singleton, so it's already active here too by the time formatPercent
// (below) calls numeral() directly.

const uri = window.location.search.substring(1);
const params = new URLSearchParams(uri);

// Year lives in the URL's first path segment (/2022/), not the query
// string — filters remain query-string-based (see plano-de-execucao.md
// item 14). "/" alone has no year segment, so the app's own default
// (config.initialLoadingYear) applies.
function yearFromPath() {
  const segment = window.location.pathname.split('/').filter(Boolean)[0];
  const year = Number(segment);
  return segment && Number.isInteger(year) ? year : null;
}

// Single place that builds a URL carrying the full app state (year + days +
// filters) — used both for the share modal and for keeping the address bar
// in sync (item 10). Always writes the year explicitly into the pathname
// instead of reusing window.location's current one, so sharing/syncing from
// "/" (no year segment, config.initialLoadingYear applies) still produces a
// URL with the year in it.
function buildFilteredYearURL(year, day, filtersQueryString) {
  const url = new URL(window.location);
  url.pathname = `/${year}/`;
  url.search = `?days=${day}${filtersQueryString}`;
  return url;
}

if (window.location.href.indexOf('/') > -1) {
  const vueApp = Vue.createApp({
    components: {
      'list-box': listBox,
      'transition-expand': TransitionExpand,
    },
    data() {
      return {
        loadingBigNumbers: true,
        loadingCandidates: true,
        loadingChartData: true,
        loadingIntroCharts: true,

        dataAbortController: null,
        candidatesAbortController: null,
        filtersAbortController: null,

        filters: {},

        errorMessages: {
          candidates: '',
        },

        shareURLCopied: false,
        sharingFrom: '',

        filterText: {},
        selectedLocaleText: 'Brasil',

        homeLoading: true,
        filterOpen: true,

        chart: null,
        // Série DIÁRIA crua, como a API entrega, depois de cortar o rabo de
        // dias vazios e a entrada sem movimento. O acumulado e o desconto dos
        // valores implausíveis são computed em cima dela: o /candidates chega
        // em outra requisição, então a correção tem de poder acontecer depois.
        rawDaily: [],
        chartDates: [],

        mainData: null,
        dataError: false,
        hasBuildFigures: document.querySelector('#vueHome')?.dataset.hasBuildFigures === 'true',
        introCharts: [],
        explainerOpen: false,
        pieColors: [
          '#dc5b64',
          '#4e79e6',
          '#3399b6',
          '#edc437',
        ],

        candidates: null,
        candidates_page: 1,
        pageFromParam: 0,

        selectedState: [],
        selectedCity: [],
        selectedOffices: [],
        selectedParty: [],
        selectedFund: [],
        selectedRace: [],
        selectedElectionStatuses: [],
        selectedRangeOfVotes: '',
        selectedSchooling: [],
        isReelectionSelected: '',

        days: [
          { label: 'todo o período', value: 'all' },
          { label: 'últimos 7 dias', value: 7 },
          { label: 'últimos 15 dias', value: 15 },
          { label: 'últimos 30 dias', value: 30 },
          { label: 'últimos 60 dias', value: 60 },
          { label: 'últimos 90 dias', value: 90 },
        ],
        selectedDay: 'all',

        years: config.years,
        selectedYear: config.initialLoadingYear,

        previousFiltersAsQueryString: '',
      };
    },
    computed: {
      dataIsOutdated: {
        get() {
          return this.mainData?.is_outdated;
        },
        set(value) {
          this.mainData.is_outdated = value;
        },
      },
      states() {
        return this.filters.regions?.sort((a, b) => a.name.localeCompare(b.name)) || [];
      },
      statesById({ states } = this) {
        return states.reduce((acc, cur) => ({ ...acc, [cur.id]: cur }), {});
      },
      cities() {
        return this.filters.cities
          ?.filter((city) => this.selectedState?.includes(String(city.region_id)))
          .map((x) => ({ ...x, label: x.name, helper: this.statesById[x.region_id].acronym }))
          .sort((a, b) => a.name.localeCompare(b.name)) || [];
      },
      citiesById({ cities } = this) {
        return cities.reduce((acc, cur) => ({ ...acc, [cur.id]: cur }), {});
      },
      offices() {
        return this.filters.offices?.sort((a, b) => a.id - b.id) || [];
      },
      officesById({ offices } = this) {
        return offices.reduce((acc, cur) => ({ ...acc, [cur.id]: cur }), {});
      },
      parties() {
        return this.filters.parties?.sort((a, b) => a.name.localeCompare(b.name)) || [];
      },
      partiesById({ parties } = this) {
        return parties.reduce((acc, cur) => ({ ...acc, [cur.id]: cur }), {});
      },
      fund_types() {
        return this.filters.fund_types?.sort((a, b) => a.name.localeCompare(b.name))
          // temporally filter types to save the back-end developer from burnout
          .filter((x) => x.id < 4 || x.id > 6) || [];
      },
      fundTypesById({ fund_types: fundTypes } = this) {
        return fundTypes.reduce((acc, cur) => ({ ...acc, [cur.id]: cur }), {});
      },
      reelection() {
        return this.filters
          .reelection?.sort((a, b) => (a.label || a.name).localeCompare((b.label || b.name))) || [];
      },
      races() {
        return this.filters.races?.sort((a, b) => a.name.localeCompare(b.name)) || [];
      },
      racesById({ races } = this) {
        return races.reduce((acc, cur) => ({ ...acc, [cur.id]: cur }), {});
      },
      rangeOfVotes() {
        return this.filters
          .votes?.sort((a, b) => (a.label || a.name).localeCompare((b.label || b.name))) || [];
      },
      schooling() {
        return this.filters.schooling?.sort((a, b) => a.name.localeCompare(b.name)) || [];
      },
      schoolingById({ schooling } = this) {
        return schooling.reduce((acc, cur) => ({ ...acc, [cur.id]: cur }), {});
      },
      electionStatuses() {
        return this.filters.election_status || [];
      },
      // generateIntroCharts() already skips any individual chart whose
      // .data is empty — this is true only when EVERY intro chart has
      // nothing to show, so the whole section can fall back to a
      // no-results message instead of a grid of blank containers.
      hasIntroCharts() {
        return this.introCharts.some((chart) => Array.isArray(chart.data) && chart.data.length > 0);
      },

      /**
       * The four states the summary figures can be in, in order of how
       * much we can honestly show:
       *   live      — the API answered; show it.
       *   build     — no answer yet, but this build captured real figures;
       *               show those and say we're fetching fresher ones.
       *   pending   — nothing anywhere; show skeletons, never zeros.
       *   error     — gave up waiting; say so and offer to retry.
       */
      figuresState({ mainData, dataError, hasBuildFigures } = this) {
        if (mainData) return 'live';
        if (dataError) return 'error';
        return hasBuildFigures ? 'build' : 'pending';
      },
      figuresPending({ figuresState } = this) {
        return figuresState === 'pending';
      },
      /**
       * True whenever there is no figure to show at all — while loading and
       * after giving up. Both cases must render a neutral placeholder: the
       * markup still carries the build's "0", and revealing it on failure
       * would put the false zero right back on screen.
       */
      figuresPlaceholder({ figuresState, hasBuildFigures } = this) {
        return figuresState === 'pending' || (figuresState === 'error' && !hasBuildFigures);
      },

      // `mainData` is null until the first response lands, and a nested
      // destructuring default (`= {}`) only covers `undefined` — on null it
      // throws, taking the whole render down with it. Optional chaining
      // covers both, so these read as 0 before any data arrives.
      amountFemale({ mainData } = this) {
        return Number.parseFloat(mainData?.big_numbers?.amount_female) || 0;
      },
      amountMale({ mainData } = this) {
        return Number.parseFloat(mainData?.big_numbers?.amount_male) || 0;
      },
      amountAll({ mainData } = this) {
        return Number.parseFloat(mainData?.big_numbers?.total_amount) || 0;
      },
      countAll({ mainData } = this) {
        return Number.parseInt(mainData?.big_numbers?.count_all, 10) || 0;
      },
      // Uma listagem vazia significa duas coisas muito diferentes, e a tela
      // precisa distingui-las: ou o recorte realmente não tem repasse, ou a
      // listagem falhou enquanto o resto da página carregou bem. Os números
      // grandes respondem aos MESMOS filtros que a listagem, então servem de
      // testemunha: se eles contam candidaturas e a lista voltou vazia, dizer
      // "não há repasses" seria afirmar o contrário do que a própria página
      // mostra alguns centímetros acima.
      //
      // Não é hipótese: foi exatamente o que o parâmetro `epoch` provocou. O
      // /index o ignorava e devolvia os números certos, o /candidates o
      // honrava e devolvia [], e a tela anunciava "não há repasses" com 98
      // candidaturas no card de cima. Num site de transparência, afirmar que
      // não houve repasse quando houve é o pior modo de falha disponível.
      // O epoch saiu, mas o guarda fica: ele vale para qualquer divergência
      // futura entre os dois endpoints.
      listingUnavailable({ candidates, countAll, loadingCandidates } = this) {
        if (loadingCandidates) return false;
        if (!candidates || !Array.isArray(candidates.candidates)) return false;
        if (candidates.candidates.length > 0) return false;
        return countAll > 0;
      },
      // "Só 42%" descreve bem um número baixo, e este sobe durante toda a
      // campanha: na eleição geral de 2022 fechou em 83,7%, e "Só 83,7%"
      // leria como erro de digitação. Então o advérbio é condicional, e o
      // limiar mora no data file junto com a régua histórica, para o Hugo
      // decidir igual no HTML servido e não haver troca de palavra quando
      // o Vue monta.
      heroLead({ heroPercent } = this) {
        const max = Number(window.appDeclarationHistory?.heroLeadMaxPercent);
        if (heroPercent === null || !Number.isFinite(max)) return '';
        return heroPercent < max ? (window.appHeroLead || '') : '';
      },
      // null enquanto não há as duas pontas: sem denominador não há índice, e
      // um zero aqui viraria "Só 0%", que é afirmação, não ausência de dado.
      heroPercent({ mainData } = this) {
        const received = Number(mainData?.accumulated?.total_candidates_who_received);
        const total = Number(mainData?.election?.candidate_count);
        if (!Number.isFinite(received) || !Number.isFinite(total) || total <= 0) return null;
        return (received / total) * 100;
      },
      // O ciclo encerrado que serve de régua para o ano selecionado, ou null
      // quando não existe par do MESMO tipo de eleição. Municipal já variou de
      // 37,6% (2020) a 69,8% (2024), então comparar geral com municipal daria
      // uma régua falsa: sem par, a linha simplesmente não aparece.
      declarationBenchmark({ selectedYear } = this) {
        const history = window.appDeclarationHistory;
        const key = history?.benchmarkFor?.[String(selectedYear)];
        const cycle = key ? history?.cycles?.[key] : null;
        if (!cycle || !(cycle.candidates > 0)) return null;
        return {
          label: cycle.label,
          percent: (cycle.received / cycle.candidates) * 100,
        };
      },
      countFemale({ mainData } = this) {
        return Number.parseInt(mainData?.big_numbers?.count_female, 10) || 0;
      },
      countMale({ mainData } = this) {
        return Number.parseInt(mainData?.big_numbers?.count_male, 10) || 0;
      },
      // The home's "Onde está o dinheiro?" block: Fundo Eleitoral money that has
      // reached candidacies vs the cycle's FEFC pot, plus the countdown to the
      // legal deadline for the quota minimums. FEFC ONLY, on both sides of the
      // division -- the same basis as /partidos/painel/, so the two pages can
      // never show different percentages for the same question. (This replaced
      // an earlier sum of both public funds; the Fundo Partidário is a
      // different pot with its own total, and mixing it into a percentage of
      // the FEFC quota made the number a ceiling, not a measure.)
      // `accumulated` is election-wide and ignores the page's filters, so the
      // block holds still while the list below is filtered. null (no constants
      // for the selected year, or data not in yet) hides the block entirely.
      publicFunds({ mainData, selectedYear } = this) {
        const fefcTotal = FEFC_TOTALS[selectedYear];
        const accumulated = mainData?.accumulated;
        if (!fefcTotal || !accumulated) return null;

        const received = Number.parseFloat(accumulated.value_special_fund) || 0;

        // End of the deadline day in Brasília time; visitors ahead of or behind BRT by
        // a few hours still see the flip within the right day.
        const deadlineISO = QUOTA_DEADLINES[selectedYear];
        const daysLeft = deadlineISO
          ? Math.ceil((new Date(`${deadlineISO}T23:59:59-03:00`).getTime() - Date.now()) / 86400000)
          : null;

        return {
          fefcTotal,
          received,
          daysLeft,
          deadlinePassed: daysLeft !== null && daysLeft <= 0,
        };
      },

      // Candidaturas cujo valor declarado passa de três vezes o teto legal de
      // gastos do cargo. A listagem vem ordenada do maior para o menor valor,
      // então um valor implausível está sempre na primeira página: é por isso
      // que olhar só a página carregada basta para achá-los.
      flaggedCandidates({ candidates, selectedYear } = this) {
        const list = Array.isArray(candidates?.candidates) ? candidates.candidates : [];
        return list
          .map((candidate) => {
            const flag = implausibleValue(candidate, selectedYear);
            return flag ? { ...flag, id: candidate.id, name: candidate.name } : null;
          })
          .filter(Boolean);
      },
      // Quanto dos números grandes vem de valor implausível. Os big numbers
      // filtrados (amountAll e companhia) e a listagem respondem aos MESMOS
      // filtros, e a listagem vem ordenada do maior para o menor valor: então
      // um valor implausível dentro daquele recorte está sempre na página
      // carregada, e esta soma não subestima.
      flaggedTotal({ flaggedCandidates } = this) {
        return flaggedCandidates.reduce((sum, flag) => sum + flag.value, 0);
      },
      // O acumulado do gráfico, com os valores implausíveis descontados.
      //
      // O gráfico soma todas as candidaturas por dia, sem quebra por
      // candidatura, então não há como subtrair um valor de "sua" linha. O que
      // dá para fazer com segurança: achar o dia em que aquele valor caiu (o
      // único dia cujo movimento, em um dos dois sexos, é grande o bastante
      // para contê-lo) e descontar dali. Descontar do sexo certo, e não do
      // total, é o que mantém Total = Mulheres + Homens.
      //
      // Quando o dia não é encontrado, nada é descontado e `located` fica
      // false: a tela então avisa que existe um valor implausível na série sem
      // alegar que o corrigiu.
      chartSeries({ rawDaily, flaggedCandidates } = this) {
        const days = rawDaily.map((day) => ({ ...day }));
        let discounted = 0;
        let located = true;

        flaggedCandidates.forEach(({ value }) => {
          const day = days.find((entry) => entry.m >= value || entry.f >= value);
          if (!day) {
            located = false;
            return;
          }
          if (day.m >= value) day.m -= value; else day.f -= value;
          discounted += value;
        });

        const total = [];
        const male = [];
        const female = [];
        let sumTotal = 0;
        let sumMale = 0;
        let sumFemale = 0;
        days.forEach((day) => {
          sumMale += day.m;
          sumFemale += day.f;
          sumTotal += day.m + day.f;
          total.push(sumTotal);
          male.push(sumMale);
          female.push(sumFemale);
        });

        return {
          total,
          male,
          female,
          daily: days.map((day) => day.m + day.f),
          discounted,
          located,
        };
      },
      formatChartSeries() {
        // Colour follows the entity, never its rank: Total keeps the brand
        // hue, and the gender split reuses the same pair as the pie.
        // O último ponto ganha rótulo: é o "quanto já chegou" de hoje, e sem
        // ele o leitor tem de passar o mouse na ponta da curva para saber
        // onde ela chegou.
        const { total, male, female } = this.chartSeries;
        const lastIndex = total.length - 1;
        const totalData = total.map((value, index) => (
          index === lastIndex
            ? { y: value, dataLabels: { enabled: true }, marker: { enabled: true, radius: 4 } }
            : value
        ));

        return [{
          name: 'Total',
          // Área só no Total: acumulação se lê como área preenchida, e o
          // preenchimento separa o total dos dois recortes, que seguem
          // linhas.
          type: 'areaspline',
          data: totalData,
          color: categorical[0],
          fillColor: {
            linearGradient: {
              x1: 0, y1: 0, x2: 0, y2: 1,
            },
            stops: [[0, 'rgba(109, 40, 217, 0.22)'], [1, 'rgba(109, 40, 217, 0)']],
          },
          lineWidth: 2.5,
          zIndex: 3,
        }, {
          name: 'Mulheres',
          data: female,
          color: binary[0],
          zIndex: 2,
        }, {
          name: 'Homens',
          data: male,
          color: binary[1],
          zIndex: 1,
        }];
      },
      shareURL() {
        const {
          selectedYear, selectedDay, filtersAsQueryString, sharingFrom,
        } = this;
        const url = buildFilteredYearURL(selectedYear, selectedDay, filtersAsQueryString);
        url.hash = sharingFrom;
        return url.toString();
      },

      isFilterableChartOutdated({ previousFiltersAsQueryString, filtersAsQueryString } = this) {
        return previousFiltersAsQueryString !== filtersAsQueryString;
      },

      filtersAsQueryString() {
        let mountedURL = '';

        if (this.selectedOffices?.length) {
          mountedURL += Array.isArray(this.selectedOffices)
            ? `&${this.selectedOffices.map((x) => `office_id[]=${x}`).join('&')}`
            : `&office_id=${this.selectedOffices}`;
        }
        if (this.selectedParty?.length) {
          mountedURL += Array.isArray(this.selectedParty)
            ? `&${this.selectedParty.map((x) => `party_id[]=${x}`).join('&')}`
            : `&party_id=${this.selectedParty}`;
        }
        if (this.selectedFund?.length) {
          mountedURL += Array.isArray(this.selectedFund)
            ? `&${this.selectedFund.map((x) => `fund_type_id[]=${x}`).join('&')}`
            : `&fund_type_id=${this.selectedFund}`;
        }
        if (this.selectedRace?.length) {
          mountedURL += Array.isArray(this.selectedRace)
            ? `&${this.selectedRace.map((x) => `race_id[]=${x}`).join('&')}`
            : `&race_id=${this.selectedRace}`;
        }
        if (this.selectedSchooling?.length) {
          mountedURL += Array.isArray(this.selectedSchooling)
            ? `&${this.selectedSchooling.map((x) => `schooling_id[]=${x}`).join('&')}`
            : `&schooling_id=${this.selectedSchooling}`;
        }
        if (this.selectedElectionStatuses?.length) {
          mountedURL += Array.isArray(this.selectedElectionStatuses)
            ? `&${this.selectedElectionStatuses.map((x) => `election_status[]=${encodeURIComponent(x)}`).join('&')}`
            : `&election_status=${encodeURIComponent(this.selectedElectionStatuses)}`;
        }
        if (this.selectedRangeOfVotes !== '') {
          mountedURL += `&votes=${this.selectedRangeOfVotes}`;
        }
        if (this.isReelectionSelected) {
          mountedURL += `&reelection=${this.isReelectionSelected}`;
        }
        if (this.selectedState?.length) {
          mountedURL += Array.isArray(this.selectedState)
            ? `&${this.selectedState.map((x) => `region_id[]=${x}`).join('&')}`
            : `&region_id=${this.selectedState}`;

          // to prevent a submission of a city by mistake, we require a state
          // to be selected as well
          if (this.selectedCity?.length) {
            mountedURL += Array.isArray(this.selectedCity)
              ? `&${this.selectedCity.map((x) => `city_id[]=${x}`).join('&')}`
              : `&city_id=${this.selectedCity}`;
          }
        }
        return mountedURL;
      },
    },
    watch: {
      async mainData() {
        await this.handleData();
        await this.generateChart();
        await this.generateIntroCharts();
      },
      // O /candidates chega em outra requisição, quase sempre depois do
      // /index. Sem isto, um valor implausível só sairia do gráfico na
      // próxima troca de filtro: a série é desenhada antes de sabermos que
      // ele existe.
      async flaggedCandidates() {
        if (this.chart) await this.generateChart();
        // As manchetes das roscas também dependem disto: sem redesenhá-las, a
        // primeira renderização (feita antes do /candidates responder) deixaria
        // a porcentagem afirmada na tela, ao lado de uma ressalva dizendo que
        // ela não fecha.
        await this.generateIntroCharts();
      },
      selectedState() {
        // when a state is unselected, we need to remove its cities from selection
        // as well. However, we keep cities in case of empty states to save the
        // user from select everything again on an bad state selection
        //
        // `selectedCity` may be null here (the states control resets it on
        // change); an unguarded `.length` threw inside Vue's flush, which
        // aborted the whole re-render — checkboxes froze in their previous
        // visual state and no result ever loaded.
        if (this.selectedCity?.length) {
          this.selectedCity = this.selectedCity.filter((x) => this.citiesById[x]);
        }
      },
    },
    async mounted() {
      const cleanUri = `${window.location.protocol}//${window.location.host + window.location.pathname}`;

      await this.populateParams();
      this.getData();
      this.getCandidates(this.pageFromParam || false);
      this.setChartOptions();
      this.updateFilterText();
      this.generateIntroCharts();

      MicroModal.init();

      this.scrollToElement();
      window.history.replaceState({}, document.title, cleanUri);
    },
    methods: {
      closeWarning() {
        this.dataIsOutdated = false;
      },
      refreshPage() {
        window.location.reload();
      },
      scrollToElement() {
        const hash = window.location.hash.split('?')[0];
        if (hash) {
          const el = document.querySelector(hash);
          el.scrollIntoView({ block: 'nearest', inline: 'start' });
        }
      },
      async populateParams() {
        const yearParam = yearFromPath();
        if (yearParam && this.years.includes(yearParam) && yearParam !== this.selectedYear) {
          this.selectedYear = yearParam;
        }
        await this.fetchFiltersForYear(this.selectedYear);

        const regionId = params.get('region_id')?.split(',').map((x) => Number(x));
        const cityId = params.get('city_id')?.split(',').map((x) => Number(x));
        const partyId = params.get('party_id')?.split(',').map((x) => Number(x));
        const officeId = params.get('office_id')?.split(',').map((x) => Number(x));
        const fundTypeId = params.get('fund_type_id')?.split(',').map((x) => Number(x));
        const raceId = params.get('race_id')?.split(',').map((x) => Number(x));
        const schoolingId = params.get('schooling_id')?.split(',').map((x) => Number(x));
        const electionStatuses = params.get('election_status')?.split(',').map((x) => decodeURIComponent(x));
        const reelection = params.get('reelection');
        const rangeOfVotes = params.get('votes');
        const days = params.get('days');

        if (regionId?.length && this.filters.regions) {
          this.selectedState = this.filters.regions
            .filter((region) => regionId.includes(region.id));
        }
        if (cityId?.length && this.filters.cities) {
          this.selectedCity = this.filters.cities
            .filter((city) => cityId.includes(city.id));
        }
        if (officeId?.length && this.filters.offices) {
          this.selectedOffices = this.filters.offices
            .filter((office) => officeId.includes(office.id));
        }
        if (partyId?.length && this.filters.parties) {
          this.selectedParty = this.filters.parties
            .filter((party) => partyId.includes(party.id));
        }
        if (fundTypeId?.length && this.filters.fund_types) {
          this.selectedFund = this.filters.fund_types
            .filter((fund) => fundTypeId.includes(fund.id));
        }
        if (raceId?.length && this.filters.races) {
          this.selectedRace = this.filters.races.filter((race) => raceId.includes(race.id));
        }
        if (schoolingId?.length && this.filters.schooling) {
          this.selectedSchooling = this.filters.schooling
            .filter((schooling) => schoolingId.includes(schooling.id));
        }
        if (electionStatuses?.length && this.filters.election_status) {
          this.selectedSchooling = this.filters.election_status
            .filter((status) => electionStatuses.includes(status));
        }
        if (rangeOfVotes !== '' && !Number.isNaN(Number.parseInt(rangeOfVotes, 10))) {
          this.selectedRangeOfVotes = rangeOfVotes;
        }
        if (reelection) {
          this.isReelectionSelected = reelection !== '0' ? 1 : 0;
        }
        if (days) {
          this.selectedDay = days;
        }
        // Pagination links carry a real ?page= now (crawlable anchors);
        // honouring it on load is what makes those URLs mean something.
        const page = Number.parseInt(params.get('page') || '1', 10);
        if (page > 1) {
          this.pageFromParam = page;
        }
      },
      updateLocaleText() {
        if (this.selectedState?.length && !this.selectedCity?.length) {
          this.selectedLocaleText = this.selectedState.map((x) => x.name).join(', ');
        } else if (this.selectedState?.length && this.selectedCity?.length) {
          this.selectedLocaleText = `${this.selectedCity.map((x) => x.name).join(', ')}/${this.selectedState.map((x) => x.acronym).join(', ')}`;
        } else {
          this.selectedLocaleText = 'Brasil';
        }
      },
      updateFilterText() {
        const {
          filterText, selectedState, selectedCity, selectedParty, selectedFund,
          selectedRace, selectedDay, statesById, citiesById, partiesById, selectedOffices,
          fundTypesById, officesById, racesById, schoolingById, isReelectionSelected,
          selectedSchooling,
          selectedElectionStatuses,
          selectedRangeOfVotes,
        } = this;

        filterText.selectedState = selectedState?.map((x) => statesById[x].name).join(', ');

        if (Object.keys(citiesById).length) {
          filterText.selectedCity = selectedState.length > 1
            ? selectedCity?.map((x) => `${citiesById[x].name} (${citiesById[x].helper})`).join(', ')
            : selectedCity?.map((x) => citiesById[x].name).join(', ');
        } else if (filterText.selectedCity) {
          delete filterText.selectedCity;
        }

        filterText.selectedOffices = selectedOffices?.map((x) => officesById[x].name).join(', ');
        filterText.selectedParty = selectedParty?.map((x) => partiesById[x].name).join(', ');
        filterText.selectedFund = selectedFund?.map((x) => fundTypesById[x].name).join(', ');
        filterText.selectedRace = selectedRace?.map((x) => racesById[x].name).join(', ');
        filterText.selectedSchooling = selectedSchooling?.map((x) => schoolingById[x].name).join(', ');
        filterText.selectedElectionStatuses = selectedElectionStatuses?.join(', ');

        if (isReelectionSelected) {
          filterText.isReelectionSelected = isReelectionSelected;
        } else if (filterText.isReelectionSelected) {
          delete filterText.isReelectionSelected;
        }

        if (selectedRangeOfVotes !== '') {
          filterText.selectedRangeOfVotes = selectedRangeOfVotes;
        } else if (filterText.selectedRangeOfVotes) {
          delete filterText.selectedRangeOfVotes;
        }

        filterText.selectedDay = selectedDay;
      },
      copyShareURL() {
        document.querySelector('#js-share-url').select();
        document.execCommand('copy');
        this.shareURLCopied = true;
      },
      // "R$ 1.000.009.300" tem 16 caracteres e não cabe no card do grid de
      // três colunas no corpo cheio. Os cortes saem da medida real: com a
      // Fraunces bold em --t-l, 13 caracteres é o que a coluna aguenta, e
      // acima de 16 nem --t-m serve.
      // O selo do card: devolve o diagnóstico daquela candidatura, ou null.
      // Método, e não uma marca gravada na lista, para o dado da API seguir
      // intocado — a sinalização é leitura nossa, não campo do TSE.
      flagFor(candidate) {
        return this.flaggedCandidates.find((flag) => flag.id === candidate.id) || null;
      },
      valueLengthClass(value) {
        const { length } = String(this.formatCurrencyNoAbbr(value) || '');
        if (length > 16) return 'candidates__total-value--xs';
        if (length > 13) return 'candidates__total-value--sm';
        return '';
      },
      epochToHuman(date) {
        return dayjs.unix(date).format('DD [de] MMMM [de] YYYY [às] hh[h]mm[m]ss[s]');
      },
      setChartOptions() {
        Highcharts.setOptions(chartTheme);
      },
      handleData() {
        const entries = typeof this.mainData?.chart === 'object' ? Object.entries(this.mainData.chart) : [];

        const totalArray = [];
        const maleArray = [];
        const femaleArray = [];
        const dates = [];

        entries.forEach(([date, entry]) => {
          const male = entry.M;
          const female = entry.F;

          totalArray.push(male + female);
          maleArray.push(male);
          femaleArray.push(female);
          dates.push(date);
        });

        // The API's `chart` is a DAILY series, not a running total. Proven
        // on real data: PP declares R$ 11.103.555 on 22/08 and R$ 100.000 on
        // 24/08, and PCdoB drops from R$ 12.047.320 to R$ 1.376.590 the next
        // day — an accumulated series cannot go down. The chart's subtitle
        // has always promised "valor acumulado", so we accumulate here
        // instead of plotting the deltas under the wrong label. It is also
        // the readable shape: one big transfer used to draw a spike that
        // crushed every other day against the zero line.
        //
        // The API pads the range to the end of the cycle with empty days, so
        // the tail is cut at the last day that actually moved money —
        // otherwise the line ran flat into November, two thirds of the plot
        // showing nothing.
        let lastMove = -1;
        totalArray.forEach((value, index) => {
          if (value > 0) lastMove = index;
        });
        const end = lastMove + 1;

        // A série crua, sem acumular: o acumulado, o desconto dos valores
        // implausíveis e o corte da entrada viraram computed, porque dependem
        // da listagem de candidaturas, que chega em outra requisição.
        //
        // Start on the first day that declared anything. The old rule was a
        // share of the period's peak, which a running total cannot use: one
        // huge late transfer makes 1% of the final total bigger than every
        // earlier day, and the whole early history gets trimmed away.
        // Verified with a fixture carrying a R$ 1 bi outlier — the chart came
        // out with a single point. First-movement is outlier-proof, and the
        // flat stretch it keeps is true: it is the period before the money
        // started arriving.
        const firstMove = totalArray.slice(0, end).findIndex((value) => value > 0);
        // -1 means nothing was declared in the period (e.g. an election with
        // no data yet) — empties every array, and the chart renders with no
        // series instead of a flat zero line.
        const start = firstMove === -1 ? end : firstMove;

        this.rawDaily = dates.slice(start, end).map((date, index) => ({
          d: date,
          f: femaleArray[start + index],
          m: maleArray[start + index],
        }));
        this.chartDates = dates.slice(start, end)
          .map((date) => dayjs(`${date} 10:00`).format('DD [de] MMM'));
      },
      handleColumnData(item) {
        const newItem = item;

        newItem.data = Array.isArray(newItem.data) ? newItem.data : [];
        newItem.chartType = 'column';

        newItem.xAxis = {
          categories: [],
        };

        newItem.total = 0;

        if (['party', 'state'].indexOf(item.type) > -1) {
          newItem.data.sort((a, b) => b.y - a.y);
        } else {
          newItem.data.sort((a, b) => a.name.localeCompare(b.name));
        }

        const ramp = sequentialRamp(newItem.data.length);

        for (let i = 0; i < newItem.data.length; i += 1) {
          newItem.data[i].color = ramp[i];
          newItem.xAxis.categories.push(newItem.data[i].name);
          newItem.data[i].name = null;
          newItem.total += newItem.data[i].y;
        }
        return newItem;
      },
      /**
       * Prepares a breakdown for a bar chart: ranked descending, one bar
       * per category, colours assigned by the kind of comparison rather
       * than by rank.
       */
      handleBarData(item) {
        const newItem = item;

        newItem.data = Array.isArray(newItem.data) ? newItem.data : [];
        newItem.chartType = 'bar';
        newItem.total = newItem.data.reduce((sum, point) => sum + (point.y || 0), 0);

        newItem.data.sort((a, b) => b.y - a.y);

        newItem.xAxis = { categories: [] };

        // Two-category breakdowns get the binary pair; a handful of
        // categories the fixed categorical order; long tails a single-hue
        // ramp, so magnitude reads off lightness instead of a rainbow.
        let palette;

        if (newItem.data.length === 2) {
          palette = binary;
        } else if (newItem.data.length <= categorical.length) {
          palette = categorical;
        } else {
          palette = sequentialRamp(newItem.data.length);
        }

        newItem.colors = palette.slice(0, newItem.data.length);

        for (let i = 0; i < newItem.data.length; i += 1) {
          newItem.xAxis.categories.push(newItem.data[i].name);
          newItem.data[i].color = newItem.colors[i];
          newItem.data[i].name = null;
        }

        return newItem;
      },
      generatePieChartColors(baseColor) {
        const colors = [];
        const base = baseColor;
        let i;

        for (i = 0; i < 33; i += 1) {
          // Start out with a darkened base color (negative brighten), and end
          // up with a much brighter color
          if (i === 0) {
            colors.push(Highcharts.color(base).get());
          }
          if (i < 6) {
            colors.push(Highcharts.color(base).brighten(i / 7).get());
          } else {
            colors.push(Highcharts.color(base).brighten(i / 34).get());
          }
        }
        return colors;
      },
      formatCurrency(value) {
        return numeral(value).format('$0[.]00 a').replace('.', ',');
      },
      formatCurrencyNoAbbr,
      personUrl,
      /**
       * Builds a chart headline that states the finding ("Candidaturas de
       * cor/raça Branca concentram 58% do valor repassado") from the
       * leading category, falling back to a neutral label when there is
       * no clear leader or no wording configured for the type.
       */
      chartHeadline(chart, total, label) {
        const templates = window.appChartTitles || {};
        const fallback = (templates.fallback || 'Repasses por %s').replace('%s', (label || '').toLowerCase());

        if (!total || !Array.isArray(chart.data) || !chart.data.length) {
          return fallback;
        }

        // handleColumnData() moves names into xAxis.categories and nulls
        // them on the points, so read the label back from there.
        const categories = chart.xAxis?.categories;
        const points = chart.data.map((point, i) => ({
          name: point.name || categories?.[i] || '',
          y: point.y || 0,
        }));
        const top = points.reduce((best, point) => (point.y > best.y ? point : best), points[0]);

        if (!top || !top.name) {
          return fallback;
        }

        // Com valor implausível dentro do recorte, a manchete nomeia a maior
        // fatia mas não crava a porcentagem. Quem está no topo resiste ao
        // desconto (o PL lidera com ou sem o valor); o número não resiste, e
        // era ele que a frase afirmava. A ressalva acima do bloco diz por quê.
        const flagged = this.flaggedTotal > 0;
        const template = flagged
          ? (templates.flagged || {})[chart.type]
          : templates[chart.type];

        if (!template) {
          return fallback;
        }

        if (flagged) {
          return template.replace('%s', top.name);
        }

        const share = `${((top.y / total) * 100).toFixed(0)}%`;

        return template.replace('%s', top.name).replace('%s', share);
      },
      /** Share of the period's total value, as a CSS length (dot decimal). */
      shareOfTotalCss(value) {
        const total = this.mainData?.accumulated?.total_value;

        if (!total || !value) {
          return '0%';
        }

        return `${((value / total) * 100).toFixed(1)}%`;
      },
      /** Same share, formatted for reading (pt-BR comma decimal). */
      shareOfTotal(value) {
        return this.shareOfTotalCss(value).replace('.', ',');
      },
      formatPercent(value) {
        return value === 0
          ? `${numeral(value).format()}%`
          : `${numeral(value).format('0.00').replace('.', ',')}%`;
      },

      /**
       * "Live" formatters, for the figures that Hugo also renders at build
       * time. They return null — not 0 — while the API hasn't answered, so
       * v-live-text/v-live-html leave the server-rendered figure in place
       * instead of flashing a zero that reads as a real measurement.
       * See assets/scripts/directives/liveValue.js.
       */
      liveNumeral(value) {
        return value === null || value === undefined ? null : formatNumeral(value);
      },
      liveCurrency(value) {
        return value === null || value === undefined ? null : formatCurrencyNoAbbr(value);
      },
      livePercent(numerator, denominator) {
        const hasBoth = numerator !== null && numerator !== undefined && Number(denominator);
        return hasBoth ? this.formatPercent((numerator / denominator) * 100) : null;
      },
      formatNumeral,
      formatDateTime(value) {
        return dayjs(value).format('DD/MM/YYYY [às] HH[h]MM[min]');
      },
      toggleFilter() {
        this.filterOpen = !this.filterOpen;
      },
      async fetchFiltersForYear(year) {
        this.filtersAbortController?.abort();
        this.filtersAbortController = new AbortController();
        const { signal } = this.filtersAbortController;

        try {
          const response = await fetch(`/filters/${year}.json`, { signal });
          const json = await response.json();
          this.filters = json.filters;
        } catch (error) {
          if (error.name === 'AbortError') {
            return;
          }
          // eslint-disable-next-line no-console
          console.error(error);
        }
      },
      changeYear(year) {
        this.selectedYear = year;

        this.loadingBigNumbers = true;
        this.loadingChartData = true;
        this.loadingIntroCharts = true;
        this.loadingCandidates = true;

        this.selectedState = [];
        this.selectedCity = [];
        this.selectedOffices = [];
        this.selectedParty = [];
        this.selectedFund = [];
        this.selectedRace = [];
        this.selectedElectionStatuses = [];
        this.selectedRangeOfVotes = '';
        this.selectedSchooling = [];
        this.isReelectionSelected = '';

        // filters were just reset above, so this writes a clean "/{year}/?days=..."
        // (no filters yet) — same helper applyFilters() uses once the user
        // picks new ones.
        this.syncURL();

        // `/filters` doesn't gate `/index`/`/candidates`: filtersAsQueryString only
        // reads the selectedX fields above (already reset), never `this.filters`.
        this.fetchFiltersForYear(year);
        this.updateData();
      },
      // Keeps the address bar in sync with year + days + filters (item 10) —
      // one pushState per meaningful change (year switch or "Aplicar" click),
      // not per checkbox, so the back button stays usable.
      syncURL() {
        const {
          selectedYear, selectedDay, filtersAsQueryString,
        } = this;
        const url = buildFilteredYearURL(selectedYear, selectedDay, filtersAsQueryString);
        window.history.pushState({}, '', url);
      },
      updateData() {
        this.candidates_page = 1;

        this.getData();
        this.getCandidates();
        this.updateLocaleText();
        this.updateFilterText();
      },
      applyFilters() {
        this.syncURL();
        this.updateData();

        // Only move the page when the chart is actually out of sight, and
        // smoothly — the old unconditional scrollIntoView() yanked readers
        // away from the filter column they were still using, which read as
        // "the page jumped to the bottom".
        const chart = document.querySelector('#js-main-chart');
        if (!chart) {
          return;
        }
        const rect = chart.getBoundingClientRect();
        const inView = rect.top >= 0 && rect.top <= window.innerHeight * 0.5;
        if (!inView) {
          chart.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      },
      getData() {
        this.loadingBigNumbers = true;
        this.loadingChartData = true;
        this.loadingIntroCharts = true;

        if (this.chart) {
          this.chart.showLoading();
        }

        this.dataError = false;

        this.dataAbortController?.abort();
        this.dataAbortController = new AbortController();
        const { signal } = this.dataAbortController;

        // Without a deadline a stalled API leaves the page loading forever:
        // whatever we show meanwhile (a figure from the build, a skeleton)
        // would never resolve into either data or an explanation.
        const timeoutId = window.setTimeout(
          () => this.dataAbortController?.abort(new Error('timeout')),
          config.api.timeoutMs,
        );

        const url = `${config.api.domain}index?year=${this.selectedYear}&days=${this.selectedDay}${this.filtersAsQueryString}`;

        fetch(url, {
          method: 'GET',
          signal,
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error('Network response was not OK');
            }
            return response;
          })
          .then((response) => response.json())
          .then((response) => {
            this.mainData = response;

            // Always reassign (not just when there's something to show) —
            // a year/filter combo with no pie_charts (e.g. an election
            // with no data yet) must clear introCharts, or the previous
            // year's charts stay stuck on screen.
            this.introCharts = Array.isArray(response?.accumulated?.pie_charts)
              // eslint-disable-next-line max-len
              ? response.accumulated.pie_charts.map((x) => this.handleBarData(x))
              : [];

            return true;
          })
          .then(() => {
            this.loadingBigNumbers = false;
            this.loadingChartData = false;
            this.loadingIntroCharts = false;
            if (this.chart) {
              this.chart.hideLoading();
            }

            this.previousFiltersAsQueryString = this.filtersAsQueryString;

            return true;
          })
          .catch((error) => {
            // A newer request superseded this one — the newer one owns the
            // loading state, so leave it alone. A timeout aborts too, but
            // carries our own reason, and does need reporting.
            const timedOut = signal.reason instanceof Error && signal.reason.message === 'timeout';
            if (error.name === 'AbortError' && !timedOut) {
              return;
            }

            this.dataError = true;
            this.loadingBigNumbers = false;
            this.loadingChartData = false;
            this.loadingIntroCharts = false;
            if (this.chart) {
              this.chart.hideLoading();
            }
            // eslint-disable-next-line no-console
            console.error(error);
          })
          .finally(() => window.clearTimeout(timeoutId));
      },
      getCandidates(page = false) {
        this.loadingCandidates = true;

        // Highest first. Both parameters go explicitly: the API documents
        // total_value/desc as the default, but it only sorts when at least
        // one of them is present — without them the order is arbitrary.
        // Sorting happens before pagination server-side (verified), so
        // page 2 really is the next nine largest.
        let url = `${config.api.domain}candidates?year=${this.selectedYear}&results=9&days=${this.selectedDay}`
          + `&order_by=${config.api.candidatesOrderBy}&order=${config.api.candidatesOrder}`
          + `${this.filtersAsQueryString}`;

        if (page) {
          url += `&page=${page}`;
          document.querySelector('#js-candidate-box').scrollIntoView();
        }

        // The previous results deliberately stay on screen while the new
        // ones load. Emptying the list here collapsed the card grid and
        // refilled it a moment later, which read as the page flickering
        // and jumping after Aplicar. The container is already dimmed
        // (outdated-chart) and aria-busy, so stale cards are never
        // mistaken for fresh ones.

        this.candidatesAbortController?.abort();
        this.candidatesAbortController = new AbortController();
        const { signal } = this.candidatesAbortController;

        fetch(url, {
          method: 'GET',
          signal,
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Network response was not OK. Status: ${response.status}`);
            }
            return response.json();
          })
          .then((response) => {
            if (!Array.isArray(response.candidates)) {
              throw new Error('Array of candidates is missing');
            }

            this.errorMessages.candidates = '';
            this.candidates = response;

            if (page) {
              this.candidates_page = page;
            }
            return true;
          })
          .catch((error) => {
            if (error.name === 'AbortError') {
              return;
            }
            this.errorMessages.candidates = error.message;
            // eslint-disable-next-line no-console
            console.error(error);
          })
          .finally(() => {
            this.loadingCandidates = false;
          });
      },
      // Lazy per-candidate fetch (item 12) — only called on click, never
      // for the whole listing at once. State lives on the candidate object
      // itself (historyLoading/historyLoaded/history/historyError); Vue 3's
      // proxy-based reactivity picks up properties added after the fact,
      // no Vue.set() needed.
      loadCandidateHistory(candidate) {
        const target = candidate;

        if (target.historyLoading || target.historyLoaded) {
          return;
        }

        target.historyLoading = true;
        target.historyError = '';

        fetch(`${config.api.domain}candidates/${target.id}/history`)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Network response was not OK. Status: ${response.status}`);
            }
            return response.json();
          })
          .then((response) => {
            // A 200 with elections: [] means this person hasn't been
            // matched across elections yet — not an error (frontend-guide-
            // cross-election.md). Render "no history", not a failure.
            target.history = Array.isArray(response.elections) ? response.elections : [];
            target.historyLoaded = true;
          })
          .catch((error) => {
            target.historyError = error.message;
            // eslint-disable-next-line no-console
            console.error(error);
          })
          .finally(() => {
            target.historyLoading = false;
            this.$nextTick(() => this.renderCandidateHistoryChart(target));
          });
      },
      // A person can hold two candidacies in the same election (e.g.
      // Deputado Federal + Senador) — elections has one entry per
      // candidacy, not per election. Group by year and sum so the chart
      // shows one bar per year, consistent with other_elections_count
      // (which counts elections, not candidacies).
      renderCandidateHistoryChart(candidate) {
        if (!candidate.history || !candidate.history.length) {
          return;
        }

        const totalByYear = {};
        const officesByYear = {};
        const allOffices = new Set();
        candidate.history.forEach((entry) => {
          totalByYear[entry.year] = (totalByYear[entry.year] || 0) + Number(entry.total_value);
          if (entry.position?.name) {
            officesByYear[entry.year] = officesByYear[entry.year] || new Set();
            officesByYear[entry.year].add(entry.position.name);
            allOffices.add(entry.position.name);
          }
        });

        const years = Object.keys(totalByYear).sort();
        const values = years.map((year) => totalByYear[year]);

        // Only label each bar with its office when it actually varies across
        // the candidate's history (e.g. Prefeito in 2020, Senador in 2022) —
        // if they always ran for the same office, the year alone is enough.
        // A single year can list more than one office if it holds two
        // candidacies (e.g. Deputado Federal + Senador in the same election).
        const officeVaries = allOffices.size > 1;
        const categories = years.map((year) => {
          if (!officeVaries || !officesByYear[year]?.size) {
            return year;
          }
          return `${year} (${[...officesByYear[year]].join(', ')})`;
        });

        Highcharts.chart(`js-candidate-history__${candidate.id}`, {
          chart: {
            type: 'column',
            backgroundColor: 'transparent',
          },
          title: {
            text: null,
          },
          credits: {
            enabled: false,
          },
          legend: {
            enabled: false,
          },
          xAxis: {
            categories,
          },
          yAxis: {
            title: {
              text: 'valor (R$)',
            },
          },
          tooltip: {
            pointFormatter() {
              return window.$vueHome.formatCurrencyNoAbbr(this.y);
            },
          },
          series: [{
            name: 'Total',
            data: values,
            color: '#620ED9',
          }],
        });
      },
      generateChart() {
        if (this.chart) {
          this.chart.destroy();
          this.chart = null;
        }

        this.chart = Highcharts.chart('js-main-chart', {
          chart: {
            type: 'spline',
            backgroundColor: 'transparent',
            spacingBottom: 8,
            spacingTop: 16,
            marginTop: 84,
          },
          title: {
            text: 'Evolução dos repasses',
          },
          subtitle: {
            text: 'Valor acumulado ao longo do período selecionado',
          },
          xAxis: {
            categories: this.chartDates,
            tickInterval: Math.max(1, Math.ceil(this.chartDates.length / 8)),
            crosshair: {
              width: 1,
              color: '#D8D3C6',
              dashStyle: 'Dash',
            },
          },
          yAxis: {
            title: { text: null },
            // Sem isto o eixo arredonda para a marca de cima e sobra metade
            // da altura vazia: com pico em R$ 1,04 bi ele ia até R$ 2 bi.
            endOnTick: false,
            maxPadding: 0.1,
            labels: {
              // eslint-disable-next-line object-shorthand, func-names
              formatter: function () {
                return compactCurrency(this.value, 0);
              },
            },
          },
          tooltip: {
            shared: true,
            // eslint-disable-next-line object-shorthand, func-names
            formatter: function () {
              const rows = this.points.map((point) => `<div style="display:flex;gap:.75rem;justify-content:space-between">
                  <span style="color:#CFC9DE">
                    <span style="color:${point.color}">\u25CF</span> ${point.series.name}
                  </span>
                  <b>${window.$vueHome.formatCurrencyNoAbbr(point.y)}</b>
                </div>`).join('');

              // O acumulado responde "quanto já chegou"; sem o valor do dia,
              // não há como saber se aquele degrau na curva foi um repasse
              // grande ou muitos pequenos.
              const dayValue = window.$vueHome.chartSeries.daily[this.points[0].point.index];
              const dayRow = dayValue > 0
                ? `<div style="margin-top:.35rem;padding-top:.35rem;border-top:1px solid rgba(255,255,255,.18);color:#CFC9DE;display:flex;gap:.75rem;justify-content:space-between">
                    <span>declarado nesse dia</span>
                    <b>${window.$vueHome.formatCurrencyNoAbbr(dayValue)}</b>
                  </div>`
                : '';

              return `<div style="min-width:11rem"><div style="margin-bottom:.35rem;font-weight:600">${this.x}</div>${rows}${dayRow}</div>`;
            },
          },
          plotOptions: {
            areaspline: {
              marker: { enabled: false },
              states: { hover: { lineWidthPlus: 0.5 } },
              dataLabels: {
                enabled: false,
                align: 'right',
                verticalAlign: 'bottom',
                y: -12,
                style: {
                  fontSize: '13px', fontWeight: '600', textOutline: '2px #FAF8F3',
                },
                // eslint-disable-next-line object-shorthand, func-names
                formatter: function () {
                  return compactCurrency(this.y, 1);
                },
              },
            },
            spline: {
              marker: {
                enabled: false,
                symbol: 'circle',
                radius: 3,
                states: { hover: { radius: 5, lineWidth: 2, lineColor: '#FFFFFF' } },
              },
              states: { hover: { lineWidthPlus: 0.5 } },
            },
          },
          series: this.formatChartSeries,
        });
        return true;
      },
      generateIntroCharts() {
        this.introCharts.forEach((chart) => {
          if (!Array.isArray(chart.data) || !chart.data.length) {
            return;
          }

          const label = window.appDictionary[chart.type];
          const total = chart.total
            || chart.data.reduce((sum, point) => sum + (point.y || 0), 0);
          const headline = this.chartHeadline(chart, total, label);
          // one row per category, plus room for the title block
          const height = 132 + (chart.data.length * 38);
          const containerId = `js-chart__${chart.type}`;

          // no-param-reassign: same alias-the-parameter workaround already
          // used by loadCandidateHistory() below.
          const target = chart;
          target.highchartsInstance = Highcharts.chart(containerId, {
            chart: {
              type: 'bar',
              backgroundColor: 'transparent',
              height,
              spacingTop: 16,
              marginTop: 84,
              marginRight: 24,
            },
            xAxis: {
              categories: chart.xAxis?.categories || [],
              lineWidth: 0,
              tickWidth: 0,
              labels: {
                style: {
                  fontSize: '13px', fontWeight: '500', color: '#1B1723',
                },
              },
            },
            yAxis: {
              title: { text: null },
              gridLineDashStyle: 'Dash',
              // room at the end of the longest bar for its direct label
              maxPadding: 0.16,
              tickPixelInterval: 130,
              labels: {
                // eslint-disable-next-line object-shorthand, func-names
                formatter: function () {
                  return compactCurrency(this.value, 1);
                },
              },
            },
            title: { text: headline },
            subtitle: {
              text: (window.appChartTitles && window.appChartTitles.subtitle) || '',
            },
            tooltip: {
              // eslint-disable-next-line object-shorthand, func-names
              formatter: function () {
                const share = total ? ((this.y / total) * 100) : 0;

                return `<div style="min-width:9rem">
                    <div style="margin-bottom:.25rem;font-weight:600">${this.key}</div>
                    <div><b>${window.$vueHome.formatCurrencyNoAbbr(this.y)}</b></div>
                    <div style="color:#CFC9DE">${share.toFixed(1).replace('.', ',')}% do total</div>
                  </div>`;
              },
            },
            legend: { enabled: false },
            plotOptions: {
              bar: {
                colorByPoint: true,
                colors: chart.colors,
                borderRadius: 4,
                pointPadding: 0.08,
                groupPadding: 0.06,
                cursor: 'pointer',
                dataLabels: {
                  enabled: true,
                  inside: false,
                  crop: false,
                  overflow: 'allow',
                  // share as a direct label at the end of each bar — no
                  // legend needed, identity is on the axis
                  // eslint-disable-next-line object-shorthand, func-names
                  formatter: function () {
                    const share = total ? ((this.y / total) * 100) : 0;

                    return `${share.toFixed(1).replace('.', ',')}%`;
                  },
                  style: {
                    fontSize: '12px', fontWeight: '600', color: '#565064', textOutline: 'none',
                  },
                },
              },
            },
            series: [{
              name: label,
              data: chart.data,
              showInLegend: false,
            }],
          });

          // Some intro-chart cards span the whole grid width
          // (.intro-charts__chart--party/--state, _intro-charts.scss).
          // Highcharts' own window-resize listener doesn't reliably
          // reflow every chart in this grid — observed live: ethnicity/
          // gender's SVGs reflowed correctly on resize, but party's could
          // stay frozen at its first-render width. Since that card spans
          // every column, its stale width drags the shared grid track (and
          // the whole page) wider than the viewport as it shrinks — the
          // charts look like they're "growing" relative to the narrowing
          // window. Watching each chart's own container directly, same
          // pattern as the candidate page's history chart
          // (renderHistoryChart(), candidato.js), sidesteps whatever's
          // inconsistent about the shared listener.
          const container = document.getElementById(containerId);
          if (container) {
            if (!target.resizeObserver) {
              target.resizeObserver = new ResizeObserver(() => {
                window.requestAnimationFrame(() => {
                  target.highchartsInstance?.reflow();
                });
              });
            }
            target.resizeObserver.disconnect();
            target.resizeObserver.observe(container);
          }
        });
      },
    },
  });

  // Vue's compiler flags v-text/v-html on an element that also has
  // content in the template — "will override element children" — as an
  // ERROR (not a warning) as of Vue 3.5.x, logged but not thrown by this
  // runtime-compile bridge (node_modules/vue/dist/vue.global.js's
  // compileToFunction: unhandled codes still fall through to onError
  // below, matching Vue's own default "log, don't crash" behavior — see
  // https://github.com/vuejs/core/issues/14048). That's the whole point
  // of the static+directive pattern used throughout bigNumbers.html/
  // app.html (real server-rendered value for crawlers/first paint,
  // replaced reactively once Vue mounts — plano-de-execucao.md item 14/
  // refino do v-text), not a mistake — silence just those two codes
  // (55 = v-html, 57 = v-text, both "with children").
  vueApp.config.compilerOptions.onError = (err) => {
    if (err.code === 55 || err.code === 57) {
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(`Template compilation error: ${err.message}`);
  };

  // Used wherever Hugo already rendered a real value into the element:
  // they hold that value until the API has a live one to replace it with.
  vueApp.directive('live-text', liveText);
  vueApp.directive('live-html', liveHtml);

  window.$vueHome = vueApp.mount('#vueHome');
}
