/* global Vue */
import numeral from 'numeral';
// import 'numeral/locales';
import config from './config';

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

      homeLoading: true,
      filterOpen: true,

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
      // loading() {
      //   return !this.locale;
      // },
    },
    mounted() {
      this.getData();
      this.getCandidates();
    },
    methods: {
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
          })
          .catch((error) => {
            console.error(error);
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
      // updateFile(event) {
      //   this.form.file = [event.target.files[0]];
      //   this.form.fileName = this.form.file[0].name;
      // },
      // sendPlan() {
      //   const data = new FormData();
      //   data.append('file', this.form.file[0]);
      //   data.append('name', this.form.name);
      //   data.append('message', this.form.message);
      //   data.append('email', this.form.email);
      //   this.formLoading = true;

      //   fetch(`${config.api.domain}upload_plan`, {
      //     method: 'POST',
      //     body: data,
      //   })
      //     .then((response) => {
      //       if (response.status === 200) {
      //         Swal.fire({
      //           title: 'Tudo Certo!',
      //           text: 'Seu plano foi enviado para avaliação',
      //           icon: 'success',
      //           confirmButtonText: 'Fechar',
      //         })
      //           .then(this.formLoading = false)
      //           .then(this.resetForm());
      //       } else {
      //         Swal.fire({
      //           title: 'Ops! Algo deu errado',
      //           text: 'Tivemos um problema no envio, por favor, tente novamente',
      //           icon: 'error',
      //           confirmButtonText: 'Fechar',
      //         })
      //           .then(this.formLoading = false);
      //       }
      //     })
      //     .catch(() => {
      //       Swal.fire({
      //         title: 'Ops! Algo deu errado',
      //         text: 'Tivemos um problema no envio, por favor, tente novamente',
      //         icon: 'error',
      //         confirmButtonText: 'Fechar',
      //       })
      //         .then(this.formLoading = false);
      //     });
      // },
    },
  });
}
