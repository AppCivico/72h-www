const productionDomains = [
  // '72horas.org',
  // 'quirky-lamport-b80cd2.netlify.app',
  // '2020.72horas.org',
];

export default {
  run: {
    2020: '2030402020',
    2022: '2040602022',
    2024: '2045202024'
  },
  api: {
    domain: (productionDomains.indexOf(window.location.hostname) > -1
      ? 'https://h72-api.appcivico.com/v1/'
      : 'https://dev-h72-api.appcivico.com/v1/'),
  },
};
