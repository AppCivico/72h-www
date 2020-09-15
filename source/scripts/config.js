export default {
  api: {
    domain: (window.location.hostname.indexOf('72h') !== -1
      ? 'https://dev-h72-api.appcivico.com/v1/'
      : 'https://dev-h72-api.appcivico.com/v1/'),
  },
};
