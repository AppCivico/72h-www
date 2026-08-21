const years = [
  2026,
  2024,
  2022,
  2020,
];

export default {
  years,
  initialLoadingYear: 2026,
  api: {
    domain: 'https://h72-api.appcivico.com/v1/',
    // Past this, the page stops waiting and says so — an indefinite
    // loading state is worse than an honest failure.
    timeoutMs: 12000,
    // Result list ordering (API accepts total_value | total_transfers,
    // asc | desc).
    candidatesOrderBy: 'total_value',
    candidatesOrder: 'desc',
  },
};
