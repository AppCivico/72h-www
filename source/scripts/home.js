/* global Vue */
import config from './config';

if (window.location.href.indexOf('/') > -1) {
  window.$vueHome = new Vue({
    el: '#vueHome',
    data: {
      homeLoading: true,
      filterOpen: true,

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
    async mounted() {
      // await this.getInfoGraphic();
    },
    methods: {
      toggleFilter() {
        this.filterOpen = !this.filterOpen;
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
