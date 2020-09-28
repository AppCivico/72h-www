export default {
  api: {
    domain: (window.location.hostname.indexOf('72horas.org') === -1
      ? 'https://dev-h72-api.appcivico.com/v1/'
      : 'https://h72-api.appcivico.com/v1/'),
  },
};
