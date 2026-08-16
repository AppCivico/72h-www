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
  renderDonutCenter,
  sequentialRamp,
} from './utilities/chartTheme';
import formatCurrencyNoAbbr from './utilities/formatCurrencyNoAbbr';
import formatNumeral from './utilities/formatNumeral';
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
        totalArray: [],
        femaleArray: [],
        maleArray: [],
        chartDates: [],

        mainData: null,
        epochFromParam: null,
        useEpoch: false,
        introCharts: [],
        pieColors: [
          '#dc5b64',
          '#4e79e6',
          '#3399b6',
          '#edc437',
        ],

        candidates: null,
        candidates_page: 1,

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
          { label: 'ignorar', value: 'all' },
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
      epoch() {
        return this.mainData?.epoch;
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

      amountFemale({ mainData: { big_numbers: bigNumbers } = {} } = this) {
        return !bigNumbers?.amount_female ? 0 : Number.parseFloat(bigNumbers?.amount_female) || 0;
      },
      amountMale({ mainData: { big_numbers: bigNumbers } = {} } = this) {
        return !bigNumbers?.amount_male ? 0 : Number.parseFloat(bigNumbers?.amount_male) || 0;
      },
      amountAll({ mainData: { big_numbers: bigNumbers } = {} } = this) {
        return !bigNumbers?.total_amount ? 0 : Number.parseFloat(bigNumbers?.total_amount) || 0;
      },
      countAll({ mainData: { big_numbers: bigNumbers } } = this) {
        return !bigNumbers?.count_all ? 0 : Number.parseInt(bigNumbers?.count_all, 10) || 0;
      },
      countFemale({ mainData: { big_numbers: bigNumbers } = {} } = this) {
        return !bigNumbers?.count_female ? 0 : Number.parseInt(bigNumbers?.count_female, 10) || 0;
      },
      countMale({ mainData: { big_numbers: bigNumbers } = {} } = this) {
        return !bigNumbers?.count_male ? 0 : Number.parseInt(bigNumbers?.count_male, 10) || 0;
      },

      formatChartSeries() {
        // Colour follows the entity, never its rank: Total keeps the brand
        // hue, and the gender split reuses the same pair as the pie.
        return [{
          name: 'Total',
          data: this.totalArray,
          color: categorical[0],
          zIndex: 3,
        }, {
          name: 'Mulheres',
          data: this.femaleArray,
          color: binary[0],
          zIndex: 2,
        }, {
          name: 'Homens',
          data: this.maleArray,
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
        if (this.useEpoch) {
          mountedURL += `&epoch=${this.epoch}`;
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
      selectedState() {
        // when a state is unselected, we need to remove its cities from selection
        // as well. However, we keep cities in case of empty states to save the
        // user from select everything again on an bad state selection
        if (this.selectedCity.length) {
          this.selectedCity = this.selectedCity.filter((x) => this.citiesById[x]);
        }
      },
    },
    async mounted() {
      const cleanUri = `${window.location.protocol}//${window.location.host + window.location.pathname}`;

      await this.populateParams();
      this.getData();
      this.getCandidates();
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
        const epoch = Number(params.get('epoch') || 0);

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
        if (epoch) {
          this.epochFromParam = Number(params.get('epoch'));
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
      epochToHuman(date) {
        return dayjs.unix(date).format('DD [de] MMMM [de] YYYY [às] hh[h]mm[m]ss[s]');
      },
      setChartOptions() {
        Highcharts.setOptions(chartTheme);
      },
      handleData() {
        const entries = typeof this.mainData?.chart === 'object' ? Object.entries(this.mainData.chart) : [];
        // this.epoch = this.mainData.epoch;

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

        // The series is an accumulated total (not a daily delta), so the
        // first days of the period are usually near-zero until spending
        // ramps up — trim that leading flat stretch so the chart starts
        // where there's actually something to show. All four arrays are
        // trimmed together, by the same index, so they stay aligned
        // (plano-de-execucao.md item 11).
        // Real bug found: trimming at the first value strictly > 0 doesn't
        // work — real data has tiny non-zero entries (a single R$500
        // donation) from day one, against an eventual peak in the tens of
        // millions, so the line still reads as flat for months. Trim
        // against a threshold relative to the period's own peak instead —
        // 1% of the max was checked against three real years (2020, 2022,
        // 2024) and lands right where the visible ramp-up actually starts
        // in all three, not just past a technical zero.
        const maxTotal = Math.max(...totalArray, 0);
        const threshold = maxTotal * 0.01;
        const firstMeaningful = totalArray.findIndex((value) => value > threshold);
        // maxTotal === 0 means every value is zero (e.g. an election with
        // no data yet) — empties all four arrays, and the chart renders
        // with no series instead of a flat zero line.
        const start = firstMeaningful === -1 ? totalArray.length : firstMeaningful;

        this.totalArray = totalArray.slice(start);
        this.maleArray = maleArray.slice(start);
        this.femaleArray = femaleArray.slice(start);
        this.chartDates = dates.slice(start)
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
      handlePieData(item) {
        const newItem = item;
        newItem.chartType = 'pie';
        newItem.total = (newItem.data || []).reduce((sum, point) => sum + point.y, 0);

        // Two-category breakdowns get the binary pair; everything else a
        // single-hue sequential ramp, so magnitude reads off lightness.
        if (item.type === 'gender') {
          newItem.colors = binary;
        } else if (newItem.data && newItem.data.length <= categorical.length) {
          newItem.colors = categorical.slice(0, newItem.data.length);
        } else {
          newItem.colors = sequentialRamp((newItem.data || []).length);
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
      formatPercent(value) {
        return value === 0
          ? `${numeral(value).format()}%`
          : `${numeral(value).format('0.00').replace('.', ',')}%`;
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
        document.querySelector('#js-main-chart').scrollIntoView();
      },
      getData() {
        this.loadingBigNumbers = true;
        this.loadingChartData = true;
        this.loadingIntroCharts = true;

        if (this.chart) {
          this.chart.showLoading();
        }

        this.dataAbortController?.abort();
        this.dataAbortController = new AbortController();
        const { signal } = this.dataAbortController;

        let url = `${config.api.domain}index?year=${this.selectedYear}&days=${this.selectedDay}${this.filtersAsQueryString}`;

        if (this.epochFromParam) {
          url += `&epoch=${this.epochFromParam}`;
        }

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
            const pieCharts = ['ethnicity', 'gender'];
            this.mainData = response;

            // Always reassign (not just when there's something to show) —
            // a year/filter combo with no pie_charts (e.g. an election
            // with no data yet) must clear introCharts, or the previous
            // year's charts stay stuck on screen.
            this.introCharts = Array.isArray(response?.accumulated?.pie_charts)
              // eslint-disable-next-line max-len
              ? response.accumulated.pie_charts.map((x) => (pieCharts.indexOf(x.type) > -1 ? this.handlePieData(x) : this.handleColumnData(x)))
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
            if (error.name === 'AbortError') {
              return;
            }
            // eslint-disable-next-line no-console
            console.error(error);
          });
      },
      getCandidates(page = false) {
        this.loadingCandidates = true;

        let url = `${config.api.domain}candidates?year=${this.selectedYear}&results=9&days=${this.selectedDay}${this.filtersAsQueryString}`;

        if (this.epochFromParam) {
          url += `&epoch=${this.epochFromParam}`;
        }

        if (page) {
          url += `&page=${page}`;
          document.querySelector('#js-candidate-box').scrollIntoView();
        }

        if (page === false) {
          if (this.candidates?.candidates) {
            this.candidates.candidates = [];
          }
        }

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

              return `<div style="min-width:11rem"><div style="margin-bottom:.35rem;font-weight:600">${this.x}</div>${rows}</div>`;
            },
          },
          plotOptions: {
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

          const isPie = chart.chartType === 'pie';
          const label = window.appDictionary[chart.type];
          const total = chart.total
            || chart.data.reduce((sum, point) => sum + (point.y || 0), 0);

          Highcharts.chart(`js-chart__${chart.type}`, {
            chart: {
              type: chart.chartType,
              backgroundColor: 'transparent',
              plotBackgroundColor: null,
              plotBorderWidth: null,
              plotShadow: false,
              height: isPie ? 340 : 360,
              spacingTop: 16,
              marginTop: 84,
              events: isPie ? {
                render() {
                  renderDonutCenter(this, compactCurrency(total), 'no total');
                },
              } : {},
            },
            xAxis: chart.xAxis,
            yAxis: isPie ? undefined : {
              title: { text: null },
              labels: {
                // eslint-disable-next-line object-shorthand, func-names
                formatter: function () {
                  return compactCurrency(this.value, 0);
                },
              },
            },
            title: {
              text: `Repasses por ${label.toLowerCase()}`,
            },
            subtitle: {
              text: 'Valor acumulado declarado ao TSE',
            },
            tooltip: {
              // eslint-disable-next-line object-shorthand, func-names
              formatter: function () {
                const share = total ? ((this.y / total) * 100) : 0;
                const name = this.key || this.point.category || label;

                return `<div style="min-width:9rem">
                    <div style="margin-bottom:.25rem;font-weight:600">${name}</div>
                    <div><b>${window.$vueHome.formatCurrencyNoAbbr(this.y)}</b></div>
                    <div style="color:#CFC9DE">${share.toFixed(1).replace('.', ',')}% do total</div>
                  </div>`;
              },
            },
            accessibility: {
              point: { valueSuffix: '%' },
            },
            plotOptions: {
              pie: {
                innerSize: '72%',
                size: '84%',
                allowPointSelect: true,
                cursor: 'pointer',
                colors: chart.colors,
                dataLabels: {
                  enabled: true,
                  // Only label slices with room for a legible number; the
                  // legend carries identity for the rest.
                  // eslint-disable-next-line object-shorthand, func-names
                  formatter: function () {
                    return this.percentage >= 4
                      ? `${this.percentage.toFixed(1).replace('.', ',')}%`
                      : null;
                  },
                },
                showInLegend: true,
              },
              column: {
                colors: chart.colors,
                colorByPoint: true,
                cursor: 'pointer',
                dataLabels: {
                  enabled: true,
                  // eslint-disable-next-line object-shorthand, func-names
                  formatter: function () {
                    const share = total ? ((this.y / total) * 100) : 0;
                    return share >= 3 ? `${share.toFixed(0)}%` : null;
                  },
                  style: {
                    fontSize: '12px', fontWeight: '600', color: '#565064', textOutline: 'none',
                  },
                },
              },
            },
            legend: {
              enabled: isPie,
            },
            series: [{
              name: label,
              data: chart.data,
              showInLegend: isPie,
            }],
          });
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

  window.$vueHome = vueApp.mount('#vueHome');
}
