/* global Vue, Highcharts */
import MicroModal from 'micromodal';
import chartTheme, { categorical, compactCurrency } from './utilities/chartTheme';
import config from './config';
import formatCurrencyNoAbbr from './utilities/formatCurrencyNoAbbr';
import formatNumeral from './utilities/formatNumeral';
import personUrl, { slugify } from './utilities/personUrl';
import watchMainMenu from './menuToggle';

// The hamburger button + menu (.js-menu-toggle/.js-menu-area) live in
// siteNav.html, shared by every page, but wiring them up is normally left
// to whichever entry script the page loads (index.js for the home page,
// content-page.js for generic content pages) — this page doesn't load
// either (see the scripts.html comment near the bottom), so without this
// call the button renders but does nothing.
watchMainMenu();

// /candidato/{slug}-{id}/ all resolve to the same static shell
// (netlify.toml catch-all), since Hugo can't pre-generate one page per
// person at this scale (800k+ candidacies). Only the trailing number is
// the real lookup key — extracted from the end of the last path segment
// regardless of what's in front of it.
//
// Falls back to ?id= when the path has none -- the Netlify rewrite that
// makes the path form work at all isn't available on a bare `hugo
// server`, so this is what makes /candidato/?id=260327 a real, working
// local-dev URL without needing Netlify or a console script. Once real
// data loads, mounted()'s replaceState still rewrites the address bar to
// the canonical slug+id path either way.
function personIdFromPath() {
  const segment = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const match = segment.match(/(\d+)$/);
  if (match) {
    return Number(match[1]);
  }

  const queryId = new URLSearchParams(window.location.search).get('id');
  return queryId && /^\d+$/.test(queryId) ? Number(queryId) : null;
}

// The name portion of the URL's slug, if any — e.g. "marcio-franca" from
// /candidato/marcio-franca-260327/. Empty string for bare-id URLs
// (/candidato/260327/) or the ?id= query fallback, which are
// intentionally still valid (local dev, old-style links) and have no
// name to check against.
function slugNameFromPath() {
  const segment = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const match = segment.match(/^(.*)-\d+$/);
  return match ? match[1] : '';
}

// Which candidacy to open on load, if the URL says so — e.g. a link
// shared while looking at someone's 2022 run specifically, rather than
// their most recent one (the default). Absent/invalid falls through to
// the default, same as not being there at all.
//
// The value is still a candidate_id, not a year — a person can hold two
// candidacies within the same election (e.g. Deputado Federal + Senador
// in the same general election), so year alone wouldn't always pick one
// unambiguously. candidate_id always does.
function candidateIdFromQuery() {
  const value = new URLSearchParams(window.location.search).get('na_eleicao');
  return value && /^\d+$/.test(value) ? Number(value) : null;
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
      personId: personIdFromPath(),
      loading: true,
      error: '',
      person: null,
      elections: [],
      // Which of the person's candidacies is currently shown. Switching
      // this is a client-side selection, not a navigation — the URL is
      // scoped to the person (person_id) now, not to any one candidacy,
      // so there's no separate URL per election to link to anymore.
      selectedCandidateId: null,
      core: null,
      coreLoading: true,
      comparison: null,
      comparisonLoading: true,
      transfers: [],
      transfersPage: 1,
      transfersHasMore: false,
      // Starts false, not true: loadTransfers() guards against overlapping
      // calls with `if (this.transfersLoading) return;` at its very start
      // (needed so double-clicking "load more" can't fire two overlapping
      // fetches) — if this started true, that guard would trip on the
      // very first call too and the initial fetch would never run. It
      // flips to true synchronously inside loadTransfers() itself
      // (before any await), so the aria-busy state still shows almost
      // immediately.
      transfersLoading: false,
      picture: '/assets/images/no-picture.svg',
      shareURLCopied: false,
    };
  },
  computed: {
    current({ elections, selectedCandidateId } = this) {
      return elections.find((election) => election.candidate_id === selectedCandidateId) || null;
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
    // Same value the address bar itself gets synced to (urlForCandidateId,
    // via syncAddressBar) — reused here so sharing always points at
    // whichever candidacy is currently selected, not just the person's
    // default one. Turned absolute (vs. the relative path/query the
    // address bar uses) because social share links (Facebook/Twitter/
    // WhatsApp/Telegram) need a real, fetchable URL, not a path fragment.
    shareURL({ selectedCandidateId } = this) {
      if (!selectedCandidateId) return '';
      return window.location.origin + this.urlForCandidateId(selectedCandidateId);
    },
  },
  async mounted() {
    if (!this.personId) {
      this.loading = false;
      this.error = 'Candidatura não encontrada.';
      return;
    }

    try {
      const response = await fetch(`${config.api.domain}people/${this.personId}`);
      if (!response.ok) {
        const message = response.status === 404
          ? 'Candidatura não encontrada.'
          : `Network response was not OK. Status: ${response.status}`;
        throw new Error(message);
      }

      const data = await response.json();
      this.elections = Array.isArray(data.elections) ? data.elections : [];
      this.person = data.person || null;

      if (!this.elections.length || !this.person) {
        throw new Error('Candidatura não encontrada.');
      }

      // Reject a slug whose name doesn't belong to this person_id at
      // all — e.g. someone hand-editing the URL to attach an unrelated
      // name to a real id. Checked against every ballot name this person
      // has run under, across all their elections (confirmed against the
      // real API: person.name is always one of these already, since it's
      // derived from one of the linked candidacies, so it doesn't need
      // to be checked separately) — not just the currently selected
      // one, so a stale-but-real old slug still passes. A slug with no
      // name at all (bare /candidato/{id}/, or the ?id= query fallback)
      // has nothing to check and is left alone — those are intentionally
      // still valid.
      const slugName = slugNameFromPath();
      if (slugName) {
        const validNames = new Set(this.elections.map((election) => election.name));
        const validSlugNames = [...validNames].map((name) => slugify(name));
        if (!validSlugNames.includes(slugName)) {
          throw new Error('Candidatura não encontrada.');
        }
      }

      // Default to the most recent candidacy — elections[] comes back
      // newest-first (confirmed against the real API: a person running
      // again in 2026 has that year at elections[0], older years after).
      // A ?na_eleicao= in the URL (a link shared while looking at a
      // specific one) overrides that default, as long as it's actually
      // one of this person's candidacies.
      const defaultCandidateId = this.elections[0].candidate_id;
      const requestedCandidateId = candidateIdFromQuery();
      const requestedElection = this.elections
        .find((election) => election.candidate_id === requestedCandidateId);
      this.selectedCandidateId = requestedElection
        ? requestedElection.candidate_id
        : defaultCandidateId;
      this.picture = this.person.picture || this.picture;
      document.title = `${this.person.name} · ${this.current.position.name} · 72Horas`;
      this.syncAddressBar();
    } catch (err) {
      this.error = err.message;
      // eslint-disable-next-line no-console
      console.error(err);
      this.loading = false;
      return;
    }

    // Required data (the /people call above) is in — reveal the page now
    // rather than waiting on the 3 per-candidacy enhancement fetches
    // below too. Each of those loads independently and shows its own
    // aria-busy state while in flight (same pattern the homepage already
    // uses, e.g. :aria-busy="loadingIntroCharts"), instead of blocking
    // the whole page behind a shared Promise.all.
    //
    // This also matters for renderHistoryChart(): it needs
    // #js-candidato-history-chart to already exist in the DOM, which
    // only happens once `loading` flips false and the v-if wrapper
    // around it renders.
    this.loading = false;

    // The share button only enters the DOM once the `v-if` above this
    // point re-renders (loading flipped false) — MicroModal.init() scans
    // for `[data-micromodal-trigger]` elements at call time, so it has to
    // run after that render, not during mounted()'s first tick, or it
    // binds to nothing and the button silently does nothing on click.
    await this.$nextTick();
    MicroModal.init();

    if (this.elections.length > 1) {
      this.renderHistoryChart();
    }

    this.loadCandidacyDetails();
  },
  methods: {
    formatCurrencyNoAbbr,
    formatNumeral,
    formatDateBR,
    personUrl,
    // The real, working URL for viewing a specific candidacy — used both
    // for the pills' :href (so they're genuine links: middle/ctrl-click
    // opens a new tab, right-click offers "copy link", hover shows the
    // target, screen readers get real link semantics — none of which a
    // <button> gives you) and by syncAddressBar() to keep the address
    // bar matching the current selection. Omits ?na_eleicao= entirely
    // for the default (most recent) candidacy, keeping that common
    // case's URL clean.
    //
    // The slug path itself is only corrected on production — it only
    // resolves through Netlify's catch-all rewrite (netlify.toml), which
    // a bare `hugo server` doesn't apply; rewriting it there would leave
    // pills pointing at a URL that 404s the moment they're followed, so
    // localhost keeps whatever path got here, e.g. /candidato/?id=.
    urlForCandidateId(candidateId) {
      const defaultCandidateId = this.elections[0]?.candidate_id;
      const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      const url = new URL(window.location.href);
      if (!isLocalhost) {
        url.pathname = personUrl(this.person);
      }
      if (candidateId === defaultCandidateId) {
        url.searchParams.delete('na_eleicao');
      } else {
        url.searchParams.set('na_eleicao', candidateId);
      }
      return url.pathname + url.search;
    },
    // Plain click switches candidacies in place, without a page reload —
    // preventDefault() stops the pill's real href from navigating.
    // Anything else (a modifier key held, or a non-primary mouse button,
    // i.e. middle-click) is left alone so the browser can do its normal
    // thing — open a new tab, etc. — against that real href.
    onElectionLinkClick(event, election) {
      if (event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      this.selectElection(election);
    },
    // Switching which of the person's candidacies is displayed — purely
    // client-side (no page reload) for a plain click, though the pill is
    // a real link underneath. Resets and re-fetches the 3 per-candidacy
    // sections for the newly selected one.
    selectElection(election) {
      if (election.candidate_id === this.selectedCandidateId) return;
      this.selectedCandidateId = election.candidate_id;
      document.title = `${this.person.name} · ${election.position.name} · 72Horas`;
      this.syncAddressBar();
      this.core = null;
      this.comparison = null;
      this.transfers = [];
      this.transfersPage = 1;
      this.transfersHasMore = false;
      this.loadCandidacyDetails();
    },
    // Keeps the address bar honest about current state after a
    // selectElection() switch — same pattern already used for
    // changeYear()/shareURL() on the home page. replaceState, not
    // pushState: switching candidacies isn't a new navigation a user
    // would expect Back to step through, just a correction/reflection of
    // what's currently shown.
    syncAddressBar() {
      if (!this.elections.length) return;
      const targetHref = this.urlForCandidateId(this.selectedCandidateId);
      const currentHref = window.location.pathname + window.location.search;
      if (targetHref !== currentHref) {
        window.history.replaceState({}, document.title, targetHref);
      }
    },
    loadCandidacyDetails() {
      // Fire-and-forget — each tracks its own loading flag and updates
      // the page reactively as it resolves, on its own schedule.
      this.loadCore();
      this.loadComparison();
      this.loadTransfers();
    },
    async loadCore() {
      const candidateId = this.selectedCandidateId;
      this.coreLoading = true;
      try {
        const response = await fetch(`${config.api.domain}candidates/${candidateId}`);
        if (!response.ok) {
          throw new Error(`core fetch failed: ${response.status}`);
        }
        const data = await response.json();
        // The user can switch candidacies again before this resolves —
        // don't let a stale response for a no-longer-selected candidacy
        // overwrite whatever's current by then.
        if (candidateId !== this.selectedCandidateId) return;
        this.core = data;
        this.picture = data.picture || this.picture;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (candidateId === this.selectedCandidateId) {
          this.coreLoading = false;
        }
      }
    },
    async loadComparison() {
      const candidateId = this.selectedCandidateId;
      this.comparisonLoading = true;
      try {
        const response = await fetch(`${config.api.domain}candidates/${candidateId}/comparison`);
        if (!response.ok) {
          throw new Error(`comparison fetch failed: ${response.status}`);
        }
        const data = await response.json();
        if (candidateId !== this.selectedCandidateId) return;
        this.comparison = data;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (candidateId === this.selectedCandidateId) {
          this.comparisonLoading = false;
        }
      }
    },
    // Confirmed by direct testing against the real API: pagination is via
    // ?page=N (offset/skip params are silently ignored), default page
    // size 20. Some candidates have hundreds of thousands of transfers
    // (Bolsonaro: 387k) — fetch is one page at a time, on demand, never
    // all pages at once.
    async loadTransfers(page = 1) {
      if (this.transfersLoading) return;
      const candidateId = this.selectedCandidateId;
      this.transfersLoading = true;
      try {
        const response = await fetch(`${config.api.domain}candidates/${candidateId}/transfers?page=${page}`);
        if (!response.ok) {
          throw new Error(`transfers fetch failed: ${response.status}`);
        }
        const data = await response.json();
        if (candidateId !== this.selectedCandidateId) return;
        const items = Array.isArray(data.transfers) ? data.transfers : [];
        this.transfers = page === 1 ? items : this.transfers.concat(items);
        this.transfersHasMore = !!data.has_more;
        this.transfersPage = page;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (candidateId === this.selectedCandidateId) {
          this.transfersLoading = false;
        }
      }
    },
    loadMoreTransfers() {
      this.loadTransfers(this.transfersPage + 1);
    },
    // Same pattern as the home page's copyShareURL (home.js).
    copyShareURL() {
      document.querySelector('#js-share-url').select();
      document.execCommand('copy');
      this.shareURLCopied = true;
    },
    // Same grouping as loadCandidateHistory()'s chart on the homepage
    // candidate cards (home.js): a person can hold two candidacies in the
    // same election (Deputado Federal + Senador), so group by year and
    // sum; label each bar with the office only when it varies across the
    // history, so a candidate who always ran for the same office doesn't
    // get it repeated on every bar. Unaffected by selectElection() — this
    // always covers the person's whole history, not just the selected
    // candidacy.
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

      Highcharts.setOptions(chartTheme);

      this.historyChart = Highcharts.chart('js-candidato-history-chart', {
        chart: {
          type: 'column',
          backgroundColor: 'transparent',
          height: 300,
          spacingTop: 16,
          marginTop: 84,
        },
        title: {
          text: window.appCandidateChart?.title || '',
        },
        subtitle: {
          text: window.appCandidateChart?.subtitle || '',
        },
        legend: {
          enabled: false,
        },
        xAxis: {
          categories,
        },
        yAxis: {
          title: { text: null },
          labels: {
            // eslint-disable-next-line object-shorthand, func-names
            formatter: function () {
              return compactCurrency(this.value, 1);
            },
          },
        },
        tooltip: {
          // eslint-disable-next-line object-shorthand, func-names
          formatter: function () {
            return `<div style="min-width:9rem">
                <div style="margin-bottom:.25rem;font-weight:600">${this.key}</div>
                <div><b>${formatCurrencyNoAbbr(this.y)}</b></div>
              </div>`;
          },
        },
        plotOptions: {
          column: {
            borderRadius: 4,
            pointPadding: 0.08,
            groupPadding: 0.12,
            dataLabels: {
              enabled: true,
              // eslint-disable-next-line object-shorthand, func-names
              formatter: function () {
                return compactCurrency(this.y, 1);
              },
              style: {
                fontSize: '12px', fontWeight: '600', color: '#565064', textOutline: 'none',
              },
            },
          },
        },
        series: [{
          name: 'Total',
          data: values,
          color: categorical[0],
        }],
      });

      // Highcharts already reflows on window resize by default, but that
      // misses width changes caused by the container itself, e.g. the
      // fund-sources/comparison/transfers sections above it revealing
      // content as their own fetches resolve, which can shift this
      // chart's width without the window ever resizing. Watching the
      // container directly catches both cases through one listener.
      //
      // reflow() is deferred to the next frame rather than called
      // synchronously in the observer callback — reflow can itself alter
      // the container's box (e.g. redrawn axis labels changing height),
      // and doing that inside the notification that triggered it is what
      // causes browsers to flag a resize loop and silently stop
      // delivering further notifications to this observer.
      if (!this.historyChartResizeObserver) {
        this.historyChartResizeObserver = new ResizeObserver(() => {
          window.requestAnimationFrame(() => {
            this.historyChart?.reflow();
          });
        });
      }
      this.historyChartResizeObserver.disconnect();
      this.historyChartResizeObserver.observe(container);
    },
  },
}).mount('#vueCandidato');
