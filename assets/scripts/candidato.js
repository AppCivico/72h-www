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
//
// Falls back to ?id= when the path has none -- the Netlify rewrite that
// makes the path form work at all isn't available on a bare `hugo
// server`, so this is what makes /candidato/?id=250001615891 a real,
// working local-dev URL without needing Netlify or a console script.
// Once real data loads, mounted()'s replaceState still rewrites the
// address bar to the canonical slug+id path either way.
function candidateIdFromPath() {
  const segment = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const match = segment.match(/(\d+)$/);
  if (match) {
    return Number(match[1]);
  }

  const queryId = new URLSearchParams(window.location.search).get('id');
  return queryId && /^\d+$/.test(queryId) ? Number(queryId) : null;
}

// "YYYY-MM-DD" -> "DD/MM/YYYY". Transfer dates are date-only, no time
// component — a small string split avoids pulling in dayjs (unlike
// home.js, this bundle stays lean) for something this simple.
function formatDateBR(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

window.$vueCandidato = Vue.createApp({
  data() {
    return {
      candidateId: candidateIdFromPath(),
      loading: true,
      error: '',
      elections: [],
      core: null,
      comparison: null,
      transfers: [],
      transfersPage: 1,
      transfersHasMore: false,
      transfersLoading: false,
      picture: '/assets/images/no-picture.svg',
    };
  },
  computed: {
    current({ elections, candidateId } = this) {
      return elections.find((election) => election.candidate_id === candidateId) || null;
    },
    // by_fund_type has 6 fine-grained categories (same ones used
    // site-wide, see i18n accumulatedCrowdfunding/accumulatedDirectDonation/
    // etc.) — the candidate page only needs the 3-bucket split from the
    // prototype: special_fund is FEFC, party_fund is Fundo Partidário, and
    // "Outros" is everything else summed (matches otherFundsWarning's own
    // definition: doação direta + financiamento coletivo + autofinanciamento,
    // here also including any other_resources bucket).
    fundBreakdown({ core } = this) {
      if (!core?.by_fund_type) return null;
      const f = core.by_fund_type;
      const fefc = Number(f.special_fund?.value || 0);
      const partidario = Number(f.party_fund?.value || 0);
      const outros = ['crowdfunding', 'direct_donation', 'self_funding', 'other_resources']
        .reduce((sum, key) => sum + Number(f[key]?.value || 0), 0);
      const total = fefc + partidario + outros;
      if (total <= 0) return null;
      const pct = (value) => (value / total) * 100;
      return {
        total,
        fefc: { value: fefc, percent: pct(fefc) },
        partidario: { value: partidario, percent: pct(partidario) },
        outros: { value: outros, percent: pct(outros) },
      };
    },
    // Bars are all scaled against the same max (candidate's own value vs
    // the 3 medians), so "mine" and "groups" are computed together here
    // rather than as separate computeds that would each need to know the
    // others' values.
    comparisonChart({ comparison, current } = this) {
      if (!comparison) return null;
      const myValue = Number(comparison.my_value ?? current?.total_value ?? 0);
      const groups = [
        { key: 'party_uf', data: comparison.party_uf },
        { key: 'position_uf', data: comparison.position_uf },
        { key: 'position_national', data: comparison.position_national },
      ]
        .filter((group) => group.data)
        .map((group) => ({
          key: group.key,
          median: Number(group.data.median),
          count: group.data.count,
          rank: group.data.rank,
        }));
      const maxValue = Math.max(myValue, ...groups.map((group) => group.median), 1);
      const withWidth = (value) => (value / maxValue) * 100;
      return {
        mine: { value: myValue, widthPercent: withWidth(myValue) },
        groups: groups.map((group) => ({ ...group, widthPercent: withWidth(group.median) })),
      };
    },
  },
  async mounted() {
    if (!this.candidateId) {
      this.loading = false;
      this.error = 'Candidatura não encontrada.';
      return;
    }

    try {
      const historyResponse = await fetch(`${config.api.domain}candidates/${this.candidateId}/history`);
      if (!historyResponse.ok) {
        const message = historyResponse.status === 404
          ? 'Candidatura não encontrada.'
          : `Network response was not OK. Status: ${historyResponse.status}`;
        throw new Error(message);
      }

      const historyData = await historyResponse.json();
      this.elections = Array.isArray(historyData.elections) ? historyData.elections : [];

      if (this.current) {
        document.title = `${this.current.name} · ${this.current.position.name} · 72Horas`;

        // Landed via a bare id, a stale slug (name changed between
        // elections), or a mismatched one someone hand-typed — replace
        // the address bar with the real canonical slug+id, same pattern
        // already used for changeYear()/shareURL() on the home page
        // (keep the URL bar honest about current state). replaceState,
        // not pushState — this isn't a new navigation, just correcting
        // the one that got us here.
        //
        // Skipped on localhost: the slug path only resolves through
        // Netlify's catch-all rewrite (netlify.toml), which a bare `hugo
        // server` doesn't apply. Rewriting to it there would leave the
        // address bar on a URL that 404s the moment hot-reload (or a
        // manual refresh) re-requests it -- staying on ?id= keeps local
        // dev actually reloadable.
        const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const canonicalPath = candidateUrl(this.current);
        if (!isLocalhost && window.location.pathname !== canonicalPath) {
          window.history.replaceState({}, document.title, canonicalPath);
        }
      }

      if (this.elections.length > 1) {
        await this.$nextTick();
        this.renderHistoryChart();
      }

      // core/comparison/transfers are enhancements on top of the required
      // /history call above — if one of them fails, log it and let the
      // rest of the page render anyway (v-if guards on core/comparison
      // hide the sections that depend on them), rather than blanking the
      // whole page over a single flaky endpoint.
      await Promise.all([
        this.loadCore(),
        this.loadComparison(),
        this.loadTransfers(),
      ]);
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
    formatDateBR,
    candidateUrl,
    async loadCore() {
      try {
        const response = await fetch(`${config.api.domain}candidates/${this.candidateId}`);
        if (!response.ok) {
          throw new Error(`core fetch failed: ${response.status}`);
        }
        this.core = await response.json();
        this.picture = this.core.picture || this.picture;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    },
    async loadComparison() {
      try {
        const response = await fetch(`${config.api.domain}candidates/${this.candidateId}/comparison`);
        if (!response.ok) {
          throw new Error(`comparison fetch failed: ${response.status}`);
        }
        this.comparison = await response.json();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    },
    // Confirmed by direct testing against the real API: pagination is via
    // ?page=N (offset/skip params are silently ignored), default page
    // size 20. Some candidates have hundreds of thousands of transfers
    // (Bolsonaro: 387k) — fetch is one page at a time, on demand, never
    // all pages at once.
    async loadTransfers(page = 1) {
      if (this.transfersLoading) return;
      this.transfersLoading = true;
      try {
        const response = await fetch(`${config.api.domain}candidates/${this.candidateId}/transfers?page=${page}`);
        if (!response.ok) {
          throw new Error(`transfers fetch failed: ${response.status}`);
        }
        const data = await response.json();
        const items = Array.isArray(data.transfers) ? data.transfers : [];
        this.transfers = page === 1 ? items : this.transfers.concat(items);
        this.transfersHasMore = !!data.has_more;
        this.transfersPage = page;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        this.transfersLoading = false;
      }
    },
    loadMoreTransfers() {
      this.loadTransfers(this.transfersPage + 1);
    },
    // Same grouping as loadCandidateHistory()'s chart on the homepage
    // candidate cards (home.js): a person can hold two candidacies in the
    // same election (Deputado Federal + Senador), so group by year and
    // sum; label each bar with the office only when it varies across the
    // history, so a candidate who always ran for the same office doesn't
    // get it repeated on every bar.
    renderHistoryChart() {
      const container = document.getElementById('js-candidato-history-chart');
      if (!container) return;

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
