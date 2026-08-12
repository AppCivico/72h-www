/* global Vue, Highcharts */
import config from './config';
import formatCurrencyNoAbbr from './utilities/formatCurrencyNoAbbr';
import formatNumeral from './utilities/formatNumeral';

// Slug is cosmetic only — readability/SEO, not the lookup key (candidate
// names aren't unique). Strips accents via NFD normalization + stripping
// combining marks, e.g. "MÁRCIO FRANÇA" -> "marcio-franca".
function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function candidateUrl(election) {
  return `/candidato/${slugify(election.name)}-${election.candidate_id}/`;
}

// candidate_id is per-candidacy (a different TSE id each election, per
// frontend-guide-cross-election.md) — /candidato/{slug}-{id}/ all resolve
// to the same static shell (netlify.toml catch-all), since Hugo can't
// pre-generate one page per candidate at this scale (800k+). Only the
// trailing number is the real lookup key — "-{id}" is extracted from the
// end of the last path segment regardless of what's in front of it, so
// both a bare old-style /candidato/250001615891/ and a slugged
// /candidato/marcio-franca-250001615891/ parse the same way.
function candidateIdFromPath() {
  const segment = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const match = segment.match(/(\d+)$/);
  return match ? Number(match[1]) : null;
}

window.$vueCandidato = Vue.createApp({
  data() {
    return {
      candidateId: candidateIdFromPath(),
      loading: true,
      error: '',
      elections: [],
      picture: '/assets/images/no-picture.svg',
    };
  },
  computed: {
    current({ elections, candidateId } = this) {
      return elections.find((election) => election.candidate_id === candidateId) || null;
    },
    // /candidates/{id}/history doesn't return divulgacand_url (unlike
    // /v1/candidates) — built from the URL shape documented in
    // frontend-guide-cross-election.md's /v1/candidates example.
    tseUrl({ current } = this) {
      if (!current || !current.city) {
        return '';
      }
      return `http://divulgacandcontas.tse.jus.br/divulga/#/candidato/${current.year}/${current.election_id}/${current.city.id}/${current.candidate_id}`;
    },
  },
  async mounted() {
    if (!this.candidateId) {
      this.loading = false;
      this.error = 'Candidatura não encontrada.';
      return;
    }

    try {
      const response = await fetch(`${config.api.domain}candidates/${this.candidateId}/history`);
      if (!response.ok) {
        const message = response.status === 404
          ? 'Candidatura não encontrada.'
          : `Network response was not OK. Status: ${response.status}`;
        throw new Error(message);
      }

      const data = await response.json();
      this.elections = Array.isArray(data.elections) ? data.elections : [];
      this.picture = data.candidate?.picture || this.picture;

      if (this.current) {
        document.title = `${this.current.name} · ${this.current.position.name} · 72Horas`;

        // Landed via a bare id, a stale slug (name changed between
        // elections), or a mismatched one someone hand-typed — replace
        // the address bar with the real canonical slug+id, same pattern
        // already used for changeYear()/shareURL() on the home page
        // (keep the URL bar honest about current state). replaceState,
        // not pushState — this isn't a new navigation, just correcting
        // the one that got us here.
        const canonicalPath = candidateUrl(this.current);
        if (window.location.pathname !== canonicalPath) {
          window.history.replaceState({}, document.title, canonicalPath);
        }
      }

      if (this.elections.length > 1) {
        await this.$nextTick();
        this.renderHistoryChart();
      }
    } catch (err) {
      this.error = err.message;
      // eslint-disable-next-line no-console
      console.error(err);
    } finally {
      this.loading = false;
    }
  },
  methods: {
    formatCurrencyNoAbbr,
    formatNumeral,
    candidateUrl,
    // Same grouping as loadCandidateHistory()'s chart on the homepage
    // candidate cards (home.js): a person can hold two candidacies in the
    // same election (Deputado Federal + Senador), so group by year and
    // sum; label each bar with the office only when it varies across the
    // history, so a candidate who always ran for the same office doesn't
    // get it repeated on every bar.
    renderHistoryChart() {
      const totalByYear = {};
      const officesByYear = {};
      const allOffices = new Set();
      this.elections.forEach((entry) => {
        totalByYear[entry.year] = (totalByYear[entry.year] || 0) + Number(entry.total_value);
        if (entry.position?.name) {
          officesByYear[entry.year] = officesByYear[entry.year] || new Set();
          officesByYear[entry.year].add(entry.position.name);
          allOffices.add(entry.position.name);
        }
      });

      const years = Object.keys(totalByYear).sort();
      const values = years.map((year) => totalByYear[year]);
      const officeVaries = allOffices.size > 1;
      const categories = years.map((year) => {
        if (!officeVaries || !officesByYear[year]?.size) {
          return year;
        }
        return `${year} (${[...officesByYear[year]].join(', ')})`;
      });

      Highcharts.chart('js-candidato-history-chart', {
        chart: {
          type: 'column',
          backgroundColor: 'transparent',
        },
        title: {
          text: null,
        },
        credits: {
          enabled: false,
        },
        legend: {
          enabled: false,
        },
        xAxis: {
          categories,
        },
        yAxis: {
          title: {
            text: 'valor (R$)',
          },
        },
        tooltip: {
          pointFormatter() {
            return formatCurrencyNoAbbr(this.y);
          },
        },
        series: [{
          name: 'Total',
          data: values,
          color: '#620ED9',
        }],
      });
    },
  },
}).mount('#vueCandidato');
