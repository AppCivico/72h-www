/* global Vue */
import Highcharts from 'highcharts';
import numeral from 'numeral';
import config from './config';

Highcharts.setOptions({
  lang: {
    printChart: 'Imprimir gráfico',
    resetZoom: 'Resetar zoom',
    loading: 'Carregando...',
  },
  // tooltip: {
  //   formatter() {
  //     return `${this.point.options.city} - ${this.point.options.state}`;
  //   },
  // },
});

numeral.register('locale', 'pt-br', {
  delimiters: {
    thousands: '.',
    decimal: ',',
  },
  abbreviations: {
    thousand: '<i>Mil</i>',
    million: '<i>Milhões</i>',
    billion: '<i>Bilhões<i>',
    trillion: '<i>Trilhões</i>',
  },
  ordinal: () => 'º',
  currency: {
    symbol: 'R$',
  },
});


numeral.locale('pt-br');

if (window.location.href.indexOf('/') > -1) {
  window.$vueHome = new Vue({
    el: '#vueHome',
    data: {
      loadingBigNumbers: true,
      loadingCandidates: true,
      loadingChartData: true,

      homeLoading: true,
      filterOpen: true,

      chart: null,
      totalArray: [],
      femaleArray: [],
      maleArray: [],

      mainData: null,
      candidates: null,
      candidates_page: 1,

      states: window.appFilters.regions,
      selectedState: null,

      parties: window.appFilters.parties,
      selectedParty: null,

      fund_types: window.appFilters.fund_types,
      selectedFund: null,

      races: window.appFilters.races,
      selectedRace: null,

      selectedCity: null,
    },
    computed: {
      cities() {
        return window.appFilters.cities.filter(city => city.region_id === this.selectedState);
      },
      chartDates() {
        const datesArr = Object.keys(this.mainData.chart.filtered[0]);
        return datesArr.map(date => new Date(`${date} 10:00`)
          .toLocaleString('pt-BR', { month: 'short', day: 'numeric' }))
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
        }]
      },
    },
    watch: {
      async mainData() {
        await this.handleData();
        await this.generateChart();
      },
    },
    mounted() {
      this.getData();
      this.getCandidates();
    },
    methods: {
      handleData() {
        const entries = Object.values(this.mainData.chart.filtered[0]);
        this.totalArray = [];
        this.maleArray = [];
        this.femaleArray = [];

        entries.forEach((entry) => {
          let total = 0;
          let male = 0;
          let female = 0;
          if (entry) {
            entry.forEach((item) => {
              total += item.value;
              if (item.gender_id === 1) {
                male += item.value;
              }
              if (item.gender_id === 2) {
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
        return numeral(value).format('$0.00 a');
      },
      toggleFilter() {
        this.filterOpen = !this.filterOpen;
      },
      updateData() {
        this.getData();
        this.getCandidates();
      },
      getData() {
        this.loadingChartData = true;
        if (this.chart) {
          this.chart.showLoading();
        }
        fetch(`${config.api.domain}index`, {
          method: 'GET',
        })
          .then(response => response.json())
          .then((response) => {
            this.mainData = response;
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
          .catch((error) => {
            return console.error(error);
          });
      },
      getCandidates(nextPage = false) {
        this.loadingCandidates = true;
        let url = `${config.api.domain}candidates?results=9`;

        if (this.selectedParty) {
          url += `&party_id=${this.selectedParty}`;
        }
        if (this.selectedRace) {
          url += `&race_id=${this.selectedRace}`;
        }
        if (this.selectedState) {
          url += `&region_id=${this.selectedState}`;
        }
        if (this.selectedCity) {
          url += `&city_id=${this.selectedCity}`;
        }
        if (nextPage) {
          url += `&page=${this.candidates_page}`;
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
            this.candidates_page = this.candidates_page + 1;
            return true;
          })
          .catch((error) => {
            console.error(error);
          });
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
            text: 'Estes dados são com base no sistema oficial do TSE.',
          },
          xAxis: {
            categories: this.chartDates,
            // ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
          },
          yAxis: {
            title: {
              text: 'valor (R$)',
            }
          },
          plotOptions: {
            line: {
              dataLabels: {
                enabled: false
              },
              enableMouseTracking: true
            }
          },
          series: this.formatChartSeries,
        });
        return true;
      },
    },
  });
}
