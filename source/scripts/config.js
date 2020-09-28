const productionDomains = ['72horas.org', 'quirky-lamport-b80cd2.netlify.app'];

export default {
  api: {
    domain: (window.location.hostname.indexOf(productionDomains) === -1
      ? 'https://dev-h72-api.appcivico.com/v1/'
      : 'https://h72-api.appcivico.com/v1/'),
  },
};
