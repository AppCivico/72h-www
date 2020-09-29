/* global Vue */
import HighchartsExport from 'highcharts/modules/exporting';
import HighchartsExportData from 'highcharts/modules/export-data';
import Highcharts from 'highcharts';
import MicroModal from 'micromodal';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import 'dayjs/locale/pt-br';
import numeral from 'numeral';
import config from './config';

HighchartsExport(Highcharts);
HighchartsExportData(Highcharts);

dayjs.extend(duration);
dayjs.locale('pt-br');
window.dayjs = dayjs;

numeral.register('locale', 'pt-br', {
  delimiters: {
    thousands: '.',
    decimal: ',',
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
    data: {
      loadingBigNumbers: true,
      loadingCandidates: true,
      loadingChartData: true,

      timerStart: 0,
      timerEnd: 0,

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

      candidates: null,
      candidates_page: 1,

      states: window.appFilters.regions,
      selectedState: null,

      selectedCity: null,

      parties: window.appFilters.parties,
      selectedParty: null,

      fund_types: window.appFilters.fund_types,
      selectedFund: null,

      races: window.appFilters.races,
      selectedRace: null,

      days: [7, 15, 30, 60, 90],
      selectedDay: 7,
    },
    computed: {
      timer() {
        const actualDate = dayjs(this.timerStart);
        const endDate = dayjs(this.timerEnd);
        const diff = endDate.diff(actualDate);

        const timeDuration = dayjs.duration(diff).asMilliseconds();
        let seconds = Math.floor(timeDuration / 1000);
        let minutes = Math.floor(seconds / 60);
        let hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        hours -= (days * 24);
        minutes = minutes - (days * 24 * 60) - (hours * 60);
        seconds = seconds - (days * 24 * 60 * 60) - (hours * 60 * 60) - (minutes * 60);

        return {
          seconds,
          minutes,
          hours,
          days,
        };
      },
      dataIsOutdated: {
        // eslint-disable-next-line object-shorthand, func-names
        get: function () {
          return this.mainData?.is_outdated;
        },
        // eslint-disable-next-line object-shorthand, func-names
        set: function (value) {
          this.mainData.is_outdated = value;
        },
      },
      epoch() {
        return this.mainData?.epoch;
      },
      cities() {
        return window.appFilters.cities
          .filter(city => city.region_id === this.selectedState?.id)
          .sort((a, b) => a.name.localeCompare(b.name));
      },
      chartDates() {
        const datesArr = Object.keys(this.mainData.chart[0]);
        return datesArr.map(date => dayjs(`${date} 10:00`).format('DD [de] MMM'));
      },
      chartTotal() {
        return this.formatCurrency(this.totalArray.reduce((a, b) => a + b, 0));
      },
      chartMale() {
        return this.formatCurrency(this.maleArray.reduce((a, b) => a + b, 0));
      },
      chartFemale() {
        return this.formatCurrency(this.femaleArray.reduce((a, b) => a + b, 0));
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
        let url = this.mountURL(`${window.location.href}?days=${this.selectedDay}`);
        url += `#${this.sharingFrom}`;
        return url;
      },
    },
    watch: {
      async mainData() {
        await this.handleData();
        await this.generateChart();
      },
      timerStart: {
        handler() {
          if (dayjs(this.timerStart) < dayjs(this.timerEnd)) {
            setTimeout(() => {
              this.timerStart = dayjs(this.timerStart).add(1, 'second');
            }, 1000);
          }
        },
        immediate: true,
      },
    },
    mounted() {
      const cleanUri = `${window.location.protocol}//${window.location.host + window.location.pathname}`;

      this.populateParams();
      this.getData();
      this.getCandidates();
      this.setChartOptions();
      this.updateFilterText();

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
        if (params.get('region_id')) {
          this.selectedState = window.appFilters.regions.find(region => region.id === Number(params.get('region_id')));
        }
        if (params.get('city_id')) {
          this.selectedCity = window.appFilters.cities.find(city => city.id === Number(params.get('city_id')));
        }
        if (params.get('party_id')) {
          this.selectedParty = window.appFilters.parties.find(party => party.id === Number(params.get('party_id')));
        }
        if (params.get('fund_type_id')) {
          this.selectedFund = window.appFilters.fund_types.find(fund => fund.id === Number(params.get('fund_type_id')));
        }
        if (params.get('race_id')) {
          this.selectedRace = window.appFilters.races.find(race => race.id === Number(params.get('race_id')));
        }
        if (params.get('days')) {
          this.selectedDay = Number(params.get('days'));
        }
        if (params.get('epoch')) {
          this.epochFromParam = Number(params.get('epoch'));
        }
      },
      updateLocaleText() {
        if (this.selectedState && !this.selectedCity) {
          this.selectedLocaleText = this.selectedState.name;
        } else if (this.selectedState && this.selectedCity) {
          this.selectedLocaleText = `${this.selectedCity.name}/${this.selectedState.acronym}`;
        } else {
          this.selectedLocaleText = 'Brasil';
        }
      },
      updateFilterText() {
        this.filterText.selectedState = this.selectedState?.name;
        this.filterText.selectedCity = this.selectedCity?.name;
        this.filterText.selectedParty = this.selectedParty?.name;
        this.filterText.selectedFund = this.selectedFund?.name;
        this.filterText.selectedRace = this.selectedRace?.name;
        this.filterText.selectedDay = this.selectedDay;
      },
      mountURL(url) {
        let mountedURL = url;

        if (this.selectedParty) {
          mountedURL += `&party_id=${this.selectedParty.id}`;
        }
        if (this.selectedFund) {
          mountedURL += `&fund_type_id=${this.selectedFund.id}`;
        }
        if (this.selectedRace) {
          mountedURL += `&race_id=${this.selectedRace.id}`;
        }
        if (this.selectedState) {
          mountedURL += `&region_id=${this.selectedState.id}`;
        }
        if (this.selectedCity) {
          mountedURL += `&city_id=${this.selectedCity.id}`;
        }
        if (this.useEpoch) {
          mountedURL += `&epoch=${this.epoch}`;
        }
        return mountedURL;
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
        const entries = Object.values(this.mainData.chart[0]);
        this.totalArray = [];
        this.maleArray = [];
        this.femaleArray = [];
        // this.epoch = this.mainData.epoch;

        entries.forEach((entry) => {
          let total = 0;
          let male = 0;
          let female = 0;
          if (entry) {
            entry.forEach((item) => {
              total += item.value;
              if (item.candidate.gender_id === 1) {
                male += item.value;
              }
              if (item.candidate.gender_id === 2) {
                female += item.value;
              }
            });
          }
          this.totalArray.push(total);
          this.maleArray.push(male);
          this.femaleArray.push(female);
          return true;
        });
      },
      formatCurrency(value) {
        return numeral(value).format('$0.[00] a').replace('.', ',');
      },
      formatCurrencyNoAbbr(value) {
        // return numeral(value).format('$0.0,[00]');
        const formatter = new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        return formatter.format(value);
      },
      formatNumeral(value) {
        return numeral(value).format();
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

        const url = `${config.api.domain}index?days=${this.selectedDay}`;
        let mountedURL = this.mountURL(url);

        if (this.epochFromParam) {
          mountedURL += `&epoch=${this.epochFromParam}`;
        }

        fetch(mountedURL, {
          method: 'GET',
        })
          .then(response => response.json())
          .then((response) => {
            this.mainData = response;
            this.timerStart = this.mainData.now;
            this.timerEnd = this.mainData.election.end_at;
            return true;
          })
          .then(() => {
            this.loadingBigNumbers = false;
            this.loadingChartData = false;
            if (this.chart) {
              this.chart.hideLoading();
            }
            return true;
          })
          // eslint-disable-next-line no-console
          .catch(error => console.error(error));
      },
      getCandidates(page = false) {
        this.loadingCandidates = true;

        const url = `${config.api.domain}candidates?results=9`;
        let mountedURL = this.mountURL(url);

        if (this.epochFromParam) {
          mountedURL += `&epoch=${this.epochFromParam}`;
        }

        if (page) {
          mountedURL += `&page=${page}`;
          document.querySelector('#js-candidate-box').scrollIntoView();
        }

        fetch(mountedURL, {
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
            // eslint-disable-next-line object-shorthand, func-names
            // formatter: function () {
            //   return 'The value for <b>' + this.x +
            //     '</b> is <b>' + this.y + '</b>';
            // },
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
    },
  });
}
