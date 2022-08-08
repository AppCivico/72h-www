/* global Vue */
import dayjs from 'dayjs';
import 'dayjs/locale/pt-br';
import duration from 'dayjs/plugin/duration';
import Highcharts from 'highcharts';
import HighchartsExportData from 'highcharts/modules/export-data';
import HighchartsExport from 'highcharts/modules/exporting';
import MicroModal from 'micromodal';
import numeral from 'numeral';
import listBox from './components/listBox.js';
import TransitionExpand from './components/TransitionExpand.js';
import config from './config';
import colorsPerTypeOfData from './utilities/colorsPerTypeOfData';
import formatCurrencyNoAbbr from './utilities/formatCurrencyNoAbbr';

HighchartsExport(Highcharts);
HighchartsExportData(Highcharts);

dayjs.extend(duration);
dayjs.locale('pt-br');

numeral.register('locale', 'pt-br', {
  delimiters: {
    thousands: '.',
    decimal: '.',
  },
  abbreviations: {
    thousand: '<span>Mil</span>',
    million: '<span>Milhões</span>',
    billion: '<span>Bilhões<span>',
    trillion: '<span>Trilhões</span>',
  },
  ordinal: () => 'º',
  currency: {
    symbol: 'R$',
  },
});

numeral.locale('pt-br');

const uri = window.location.search.substring(1);
const params = new URLSearchParams(uri);

if (window.location.href.indexOf('/') > -1) {
  window.$vueHome = new Vue({
    el: '#vueHome',
    components: {
      'list-box': listBox,
      'transition-expand': TransitionExpand,
    },
    data: {
      loadingBigNumbers: true,
      loadingCandidates: true,
      loadingChartData: true,

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
      selectedParty: [],
      selectedFund: [],
      selectedRace: [],

      days: [{label: 'todos', value: 'all'}, 7, 15, 30, 60, 90],
      selectedDay: 'all',

      previouslyUsedFiltersAsQueryString: '',
    },
    computed: {
      dataIsOutdated: {
        get: function () {
          return this.mainData?.is_outdated;
        },
        set: function (value) {
          this.mainData.is_outdated = value;
        },
      },
      epoch() {
        return this.mainData?.epoch;
      },
      states() {
        return window.appFilters.regions.sort((a, b) => a.name.localeCompare(b.name));
      },
      statesById({states}=this) {
        return states.reduce((acc,cur)=>{return {...acc,[cur.id]: cur} },{});
      },
      cities() {
        return window.appFilters.cities
          .filter(city => this.selectedState?.includes(String(city.region_id)))
          .map((x) => { return { ...x, label: x.name, helper: this.statesById[x.region_id].acronym};})
          .sort((a, b) => a.name.localeCompare(b.name));
      },
      citiesById({cities}=this) {
        return cities.reduce((acc,cur)=>{return {...acc,[cur.id]: cur} },{});
      },
      parties() {
        return window.appFilters.parties.sort((a, b) => a.name.localeCompare(b.name));
      },
      partiesById({ parties } = this) {
        return parties.reduce((acc,cur)=>{return {...acc,[cur.id]: cur} },{});
      },
      fund_types() {
        return window.appFilters.fund_types.sort((a, b) => a.name.localeCompare(b.name));
      },
      fundTypesById({fund_types}=this) {
        return fund_types.reduce((acc,cur)=>{return {...acc,[cur.id]: cur} },{});
      },
      races() {
        return window.appFilters.races.sort((a, b) => a.name.localeCompare(b.name));
      },
      racesById({ races } = this) {
        return races.reduce((acc,cur)=>{return {...acc,[cur.id]: cur} },{});
      },
      chartDates() {
        const datesArr = Object.keys(this.mainData.chart);
        return datesArr.map(date => dayjs(`${date} 10:00`).format('DD [de] MMM'));
      },
      chartTotal() {
        return this.totalArray.reduce((a, b) => a + b, 0);
      },
      chartMale() {
        return this.maleArray.reduce((a, b) => a + b, 0);
      },
      chartFemale() {
        return this.femaleArray.reduce((a, b) => a + b, 0);
      },
      formatChartSeries() {
        return [{
          name: 'Total',
          data: this.totalArray,
        }, {
          name: 'Mulheres',
          data: this.femaleArray,
        }, {
          name: 'Homens',
          data: this.maleArray,
        }];
      },
      shareURL() {
        let url = `${window.location.href}?days=${this.selectedDay}${this.filtersAsQueryString}`;
        url += `#${this.sharingFrom}`;
        return url;
      },

      isFilterableChartOutdated({ previouslyUsedFiltersAsQueryString, filtersAsQueryString} = this ) {
        return previouslyUsedFiltersAsQueryString !== filtersAsQueryString;
      },

      filtersAsQueryString() {
        let mountedURL = '';

        if (this.selectedParty?.length) {
          mountedURL += Array.isArray(this.selectedParty)
            ? '&' + this.selectedParty.map(x => `party_id[]=${x}`).join('&')
            : `&party_id=${this.selectedParty}`;
        }
        if (this.selectedFund?.length) {
          mountedURL += Array.isArray(this.selectedFund)
            ? '&' + this.selectedFund.map(x => `fund_type_id[]=${x}`).join('&')
            : `&fund_type_id=${this.selectedFund}`;
        }
        if (this.selectedRace?.length) {
          mountedURL += Array.isArray(this.selectedRace)
            ? '&' + this.selectedRace.map(x => `race_id[]=${x}`).join('&')
            : `&race_id=${this.selectedRace}`;
        }
        if (this.selectedState?.length) {
          mountedURL += Array.isArray(this.selectedState)
            ? '&' + this.selectedState.map(x => `region_id[]=${x}`).join('&')
            : `&region_id=${this.selectedState}`;

            // to prevent a submission of a city by mistake, we require a state
            // to be selected as well
            if (this.selectedCity?.length) {
              mountedURL += Array.isArray(this.selectedCity)
                ? '&' + this.selectedCity.map(x => `city_id[]=${x}`).join('&')
                : `&city_id=${this.selectedCity}`;
            }
        }
        if (this.useEpoch) {
          mountedURL += `&epoch=${this.epoch}`;
        }

        return mountedURL;
      }
    },
    watch: {
      async mainData() {
        await this.handleData();
        await this.generateChart();
        await this.generateIntroCharts();
      },
    },
    mounted() {
      const cleanUri = `${window.location.protocol}//${window.location.host + window.location.pathname}`;

      this.populateParams();
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
      populateParams() {
        const regionId = params.get('region_id')?.split(',').map(x => Number(x));
        const cityId = params.get('city_id')?.split(',').map(x => Number(x));
        const partyId = params.get('party_id')?.split(',').map(x => Number(x));
        const fundTypeId = params.get('fund_type_id')?.split(',').map(x => Number(x));
        const raceId = params.get('race_id')?.split(',').map(x => Number(x));
        const days = params.get('days');
        const epoch = Number(params.get('epoch') || 0);

        if (regionId?.length) {
          this.selectedState = window.appFilters.regions.filter(region => regionId.includes(region.id));
        }
        if (cityId?.length) {
          this.selectedCity = window.appFilters.cities.filter(city => cityId.includes(city.id));
        }
        if (partyId?.length) {
          this.selectedParty = window.appFilters.parties.filter(party => partyId.includes(party.id));
        }
        if (fundTypeId?.length) {
          this.selectedFund = window.appFilters.fund_types.filter(fund => fundTypeId.includes(fund.id));
        }
        if (raceId?.length) {
          this.selectedRace = window.appFilters.races.filter(race => raceId.includes(race.id));
        }
        if (days) {
          this.selectedDay = params.get('days');
        }
        if (epoch) {
          this.epochFromParam = Number(params.get('epoch'));
        }
      },
      updateLocaleText() {
        if (this.selectedState?.length && !this.selectedCity?.length) {
          this.selectedLocaleText = this.selectedState.map(x => x.name).join(', ');
        } else if (this.selectedState?.length && this.selectedCity?.length) {
          this.selectedLocaleText = `${this.selectedCity.map(x => x.name).join(', ')}/${this.selectedState.map((x) => x.acronym).join(', ')}`;
        } else {
          this.selectedLocaleText = 'Brasil';
        }
      },
      updateFilterText() {
        const {
          filterText, selectedState, selectedCity, selectedParty, selectedFund,
          selectedRace, selectedDay, statesById, citiesById, partiesById,
          fundTypesById, racesById
        } = this;

        filterText.selectedState = selectedState?.map(x => statesById[x].name).join(', ');

        filterText.selectedCity = selectedState.length > 1
          ? selectedCity?.map(x => citiesById[x].name + ' (' + citiesById[x].helper + ')').join(', ')
        : selectedCity?.map(x => citiesById[x].name).join(', ');

        filterText.selectedParty = selectedParty?.map(x => partiesById[x].name).join(', ');
        filterText.selectedFund = selectedFund?.map(x => fundTypesById[x].name).join(', ');
        filterText.selectedRace = selectedRace?.map(x => racesById[x].name).join(', ');
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
        Highcharts.setOptions({
          colors: ['#DC3236', '#22B1A7', '#620ED9', '#DDDF00', '#24CBE5', '#64E572', '#FF9655', '#FFF263', '#6AF9C4'],
          chart: {
            style: {
              fontFamily: 'Montserrat',
            },
          },
          lang: {
            viewFullscreen: 'Ver em tela cheia',
            printChart: 'Imprimir gráfico',
            downloadPNG: 'Baixar em PNG',
            downloadJPEG: 'Baixar em JPG',
            downloadPDF: 'Baixar em PDF',
            downloadSVG: 'Baixar em SVG',

            resetZoom: 'Resetar zoom',
            loading: 'Carregando...',
          },
          navigation: {
            menuItemStyle: {
              fontSize: 11,
            },
          },
          exporting: {
            buttons: {
              contextButton: {
                menuItems: [
                  'viewFullscreen',
                  'printChart',
                  'separator',
                  'downloadPNG',
                  'downloadJPEG',
                  'downloadPDF',
                  'downloadSVG',
                ],
              },
            },
          },
        });
      },
      handleData() {
        const entries = Object.values(this.mainData.chart);
        this.totalArray = [];
        this.maleArray = [];
        this.femaleArray = [];
        // this.epoch = this.mainData.epoch;

        entries.forEach((entry) => {
          const total = entry.F + entry.M;
          const male = entry.M;
          const female = entry.F;

          this.totalArray.push(total);
          this.maleArray.push(male);
          this.femaleArray.push(female);
          return true;
        });
      },
      handleColumnData(item) {
        const newItem = item;

        newItem.chartType = 'column';

        newItem.xAxis = {
          categories: [],
        };

        newItem.total = 0;

        newItem.data.sort((a, b) => a.name.localeCompare(b.name));

        for (let i = 0; i < newItem.data.length; i+= 1) {
          newItem.data[i].color = colorsPerTypeOfData[item.type]?.[i];
          newItem.xAxis.categories.push(newItem.data[i].name);
          newItem.data[i].name = null;
          newItem.total += newItem.data[i].y;
        }
        return newItem;
      },
      handlePieData(item) {
        const newItem = item;
        newItem.chartType = 'pie';
        if (item.type === 'state') {
          newItem.colors = ['#DC5B64', '#DD6367', '#DD6B6A', '#DE746D', '#DE7C70', '#DF8473', '#DF8977', '#E08E7A', '#E0937E', '#E09982', '#E19E85', '#E1A389', '#E1A88F', '#E2AD94', '#E2B39A', '#E2B89F', '#E3BDA4', '#E3C2AA', '#E4C6B0', '#E4CAB6', '#E5CEBC', '#E5D2C2', '#E6D6C8', '#E6DACE', '#E7DED4', '#E8E0D7', '#E8E2DB', '#E9E3DE', '#E9E5E1', '#E9E7E5', '#EAE9E8', '#ECEBEB', '#EDEDED'];
        }
        if (item.type === 'party') {
          newItem.colors = ['#4E79E6', '#537DE7', '#5780E7', '#5C84E8', '#6187E8', '#658BE9', '#6F92EA', '#7396EA', '#789AEB', '#7D9DEC', '#81A1EC', '#86A4ED', '#8BA8ED', '#8FACEE', '#94AFEE', '#99B3EF', '#86B2F2', '#8CB6F2', '#92BAF3', '#92BAF3', '#9BC0F3', '#9EC2F4', '#A7C7F4', '#AAC9F4', '#B3CFF5', '#BAD3F5', '#C0D7F6', '#C9DDF7', '#E1ECF8', '#E4EEF8', '#E7F0F9', '#EAF2F9', '#EDF4F9'];
        }
        if (item.type === 'gender') {
          newItem.colors = ['#EDC437', '#F1D060', '#F2D675', '#F5DF92', '#F6E3A2', '#F7E7AE', '#F9EDC3'];
        }
        if (item.type === 'ethnicity') {
          newItem.colors = ['#1B78A4', '#3C8EB1', '#5EA3BF', '#7FB9CC', '#A0CED9', '#C2E3E7', '#E3F9F4'];
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
      formatNumeral(value) {
        return numeral(value).format();
      },
      formatDateTime(value) {
        return dayjs(value).format('DD/MM/YYYY [às] HH[h]MM[min]');
      },
      toggleFilter() {
        this.filterOpen = !this.filterOpen;
      },
      updateData() {
        this.candidates_page = 1;

        this.getData();
        this.getCandidates();
        this.updateLocaleText();
        this.updateFilterText();
        document.querySelector('#js-main-chart').scrollIntoView();
      },
      getData() {
        this.loadingChartData = true;

        if (this.chart) {
          this.chart.showLoading();
        }

        let url = `${config.api.domain}index?election_id=${config.run[2022]}&days=${this.selectedDay}${this.filtersAsQueryString}`;

        if (this.epochFromParam) {
          url += `&epoch=${this.epochFromParam}`;
        }

        fetch(url, {
          method: 'GET',
        })
          .then(response => response.json())
          .then((response) => {
            const pieCharts = ['ethnicity', 'gender'];
            this.mainData = response;

            if (Array.isArray(response?.accumulated?.pie_charts)) {
              this.introCharts = response.accumulated.pie_charts
                .map((x) => pieCharts.indexOf(x.type) > -1 ? this.handlePieData(x) : this.handleColumnData(x));
            }

            return true;
          })
          .then(() => {
            this.loadingBigNumbers = false;
            this.loadingChartData = false;
            if (this.chart) {
              this.chart.hideLoading();
            }

            this.previouslyUsedFiltersAsQueryString = this.filtersAsQueryString;

            return true;
          })
          // eslint-disable-next-line no-console
          .catch(error => console.error(error));
      },
      getCandidates(page = false) {
        this.loadingCandidates = true;

        let url = `${config.api.domain}candidates?election_id=${config.run[2022]}&results=9&days=${this.selectedDay}${this.filtersAsQueryString}`;

        if (this.epochFromParam) {
          url += `&epoch=${this.epochFromParam}`;
        }

        if (page) {
          url += `&page=${page}`;
          document.querySelector('#js-candidate-box').scrollIntoView();
        }

        fetch(url, {
          method: 'GET',
        })
          .then(response => response.json())
          .then((response) => {
            this.candidates = response;
            return true;
          })
          .then(() => {
            this.loadingCandidates = false;
            if (page) {
              this.candidates_page = page;
            }
            return true;
          })
          // eslint-disable-next-line no-console
          .catch(error => console.error(error));
      },
      generateChart() {
        this.chart = Highcharts.chart('js-main-chart', {
          chart: {
            type: 'line',
            backgroundColor: 'transparent',
          },
          title: {
            text: 'Repasses Realizados',
          },
          subtitle: {
            text: document.querySelector('.js-filter-text').textContent,
          },
          xAxis: {
            categories: this.chartDates,
            // ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
          },
          yAxis: {
            title: {
              text: 'valor (R$)',
            },
          },
          tooltip: {
            // eslint-disable-next-line object-shorthand, func-names
            pointFormatter: function () {
              return `${this.series.name}: <b>${window.$vueHome.formatCurrencyNoAbbr(this.y)}</b>`;
            },
          },
          plotOptions: {
            line: {
              dataLabels: {
                enabled: false,
              },
              enableMouseTracking: true,
            },
          },
          series: this.formatChartSeries,
        });
        return true;
      },
      generateIntroCharts() {
        this.introCharts.forEach((chart) => {
          Highcharts.chart(`js-chart__${chart.type}`, {
            chart: {
              plotBackgroundColor: null,
              plotBorderWidth: null,
              plotShadow: false,
              type: chart.chartType,
            },
            xAxis: chart.xAxis,
            yAxis: chart.chartType === 'pie' ? undefined : {
              title: {
                text: 'valor (R$)',
              },
            },
            title: {
              useHTML: true,
              align: 'center',
              // x: -10,
              style: {
                fontSize: '1.26562em',
                textTransform: 'uppercase',
              },
              text: `por <span style="color: ${chart.data[0].color}">${window.appDictionary[chart.type]}</span>`,
            },
            credits: {
              enabled: false,
            },
            tooltip: {
              pointFormatter: function () {
                return window.$vueHome.formatCurrencyNoAbbr(this.y);
              },
            },
            accessibility: {
              point: {
                valueSuffix: '%',
              },
            },
            navigation: {
              buttonOptions: {
                x: -30,
              },
            },
            plotOptions: {
              [chart.chartType]: {
                allowPointSelect: true,
                cursor: 'pointer',
                colors: chart.colors,
                dataLabels: {
                  enabled: true,
                  pointFormatter: function () {
                    return `${Number(this.y / chart.total * 100).toFixed(2)}%`;
                  },
                },
              },
            },
            series: [{
              name: window.appDictionary[chart.type],
              data: chart.data,
              showInLegend: chart.chartType === 'pie'
            }],
          });
        });
      },
    },
  });
}
