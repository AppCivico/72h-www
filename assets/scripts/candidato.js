/* global Vue, Highcharts */
import MicroModal from 'micromodal';
import chartTheme, { categorical, compactCurrency } from './utilities/chartTheme';
import config from './config';
import formatCurrencyNoAbbr from './utilities/formatCurrencyNoAbbr';
import formatNumeral from './utilities/formatNumeral';
import personUrl, { slugify } from './utilities/personUrl';
import spendingLimit, { SELF_FUNDING_FRACTION } from './utilities/spendingLimits';
import watchMainMenu from './menuToggle';
import watchHeaderCondense from './components/headerCondense';

// The hamburger button + menu (.js-menu-toggle/.js-menu-area) live in
// siteNav.html, shared by every page, but wiring them up is normally left
// to whichever entry script the page loads (index.js for the home page,
// content-page.js for generic content pages) — this page doesn't load
// either (see the scripts.html comment near the bottom), so without this
// call the button renders but does nothing.
watchMainMenu();
watchHeaderCondense();

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

// 'YYYY-MM-DD' -> the Monday of that ISO week, also 'YYYY-MM-DD'. Mirrors the
// DATE_TRUNC('week', ...) the breakdown endpoint uses, so the client-side fallback
// buckets transfers into exactly the same weeks the API would.
function mondayOfWeek(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const shift = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}

// TSE race labels arrive UPPERCASE ('PARDA', 'SEM INFORMAÇÃO'); the page
// speaks lowercase. 'SEM INFORMAÇÃO' is treated as absence by the callers,
// never as a declaration (and never as a "change").
function formatRace(name) {
  return (name || '').toLowerCase();
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
      breakdown: null,
      breakdownLoading: true,
      // The complete transfers extract, when it fits the fetch budget (see
      // loadFullExtract). null = over budget or still loading: the table then stays in
      // its classic API-paginated, newest-first mode and the donor filters never render.
      fullTransfers: null,
      fullExtractPromise: null,
      donorFilter: 'all',
      extractVisible: 20,
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
          // The API returns null — not 0 — when nobody in the group has
          // declared revenue yet (documented in its OpenAPI). Coercing that
          // to 0 would state "a mediana é R$ 0", which reads as a measured
          // value instead of an absent one.
          median: group.data.median === null || group.data.median === undefined
            ? null
            : Number(group.data.median),
          count: group.data.count,
          // How many of the group actually declared receiving anything —
          // the median is computed over these, not over `count`.
          declaredCount: group.data.declared_count,
          rank: group.data.rank,
        }));
      const maxValue = Math.max(myValue, ...groups.map((group) => group.median || 0), 1);
      // A candidate can be two orders of magnitude above the median, which
      // renders the reference bar sub-pixel — indistinguishable from "no
      // value". Floor it at a visible sliver, but only for real values.
      const withWidth = (value) => (value > 0 ? Math.max((value / maxValue) * 100, 0.8) : 0);
      return {
        mine: { value: myValue, widthPercent: withWidth(myValue) },
        groups: groups.map((group) => ({ ...group, widthPercent: withWidth(group.median) })),
      };
    },
    // Verbal funding profile for the concentration block. Thresholds follow the published
    // scale (>= 90 / 70-90 / 40-70 / < 40 of public-fund money: FEFC + Fundo Partidário)
    // and the label always renders next to the raw numbers, never alone -- the raw figures
    // are what make the label credible.
    fundingProfile({ fundBreakdown } = this) {
      const labels = window.appFundingProfiles || {};
      if (!fundBreakdown) return null;
      const publicPercent = fundBreakdown.fefc.percent + fundBreakdown.partidario.percent;
      let label = labels.mostlyPrivate;
      if (publicPercent >= 90) label = labels.almostAllPublic;
      else if (publicPercent >= 70) label = labels.mostlyPublic;
      else if (publicPercent >= 40) label = labels.mixed;
      return label ? { label, publicPercent } : null;
    },
    // Top payers and person-donor stats from the breakdown endpoint. Percentages are
    // computed against the breakdown's own total (not core.total_value) so the shares
    // always sum coherently even if the two fetches raced a scraper run.
    concentration({ breakdown } = this) {
      if (!breakdown || !breakdown.top_payers?.length) return null;
      const total = Number(breakdown.total_value);
      if (!(total > 0)) return null;
      const payers = breakdown.top_payers.map((payer) => ({
        name: payer.name,
        isPerson: payer.is_person,
        value: Number(payer.value),
        transfers: payer.transfers,
        percent: (Number(payer.value) / total) * 100,
      }));
      return {
        payers,
        top: payers[0],
        personPayers: breakdown.person_payers_count,
        ticketMedian: breakdown.person_ticket_median == null
          ? null
          : Number(breakdown.person_ticket_median),
      };
    },
    // All five fixed bands in order, including empty ones -- an absent band is information
    // ("nothing above R$ 50 mil"), not noise. Band bounds live in the API's SQL; the
    // labels (window.appCandidateBands) must describe the same bounds.
    valueBands({ breakdown } = this) {
      if (!breakdown || !breakdown.value_bands?.length) return null;
      const labels = window.appCandidateBands || [];
      const total = breakdown.value_bands.reduce((sum, band) => sum + Number(band.value), 0);
      if (!(total > 0)) return null;
      return [1, 2, 3, 4, 5].map((n) => {
        const band = breakdown.value_bands.find((candidate) => candidate.band === n);
        const value = band ? Number(band.value) : 0;
        return {
          band: n,
          label: labels[n - 1] || '',
          transfers: band ? band.transfers : 0,
          value,
          // Same sub-pixel floor as the comparison bars: a real value must never render
          // indistinguishable from zero.
          widthPercent: value > 0 ? Math.max((value / total) * 100, 1.2) : 0,
        };
      });
    },
    // Spending-cap gauge. The cap limits SPENDING; the page compares REVENUE against it,
    // and the i18n copy keeps that distinction explicit. null when the local table has no
    // cap for this election/office (municipal years have per-city caps we don't carry) --
    // the block then hides entirely: never a wrong number, never R$ 0.
    spendingCap({ current, core } = this) {
      if (!current) return null;
      const limit = spendingLimit(current.year, current.position?.name, current.city?.region?.name);
      if (!limit) return null;
      const raised = Number(current.total_value) || 0;
      const selfValue = Number(core?.by_fund_type?.self_funding?.value || 0);
      const selfLimit = limit * SELF_FUNDING_FRACTION;
      return {
        limit,
        raised,
        usedPercent: (raised / limit) * 100,
        barPercent: Math.min((raised / limit) * 100, 100),
        overLimit: raised > limit,
        selfValue,
        selfLimit,
        selfPercent: (selfValue / selfLimit) * 100,
        selfOverLimit: selfValue > selfLimit,
      };
    },
    // "Among the top X% of the party's candidates in the state" -- derived from the rank
    // the comparison endpoint already returns (rank = strictly-richer candidates + 1, so
    // ceil() keeps the claim true under ties). Tiny groups are skipped: a percentile over
    // a dozen people reads as false precision when the rank line above already says it.
    partyPercentile({ comparison } = this) {
      const rank = comparison?.party_uf?.rank;
      const count = comparison?.party_uf?.count;
      if (!rank || !count || count < 10) return null;
      return Math.max(1, Math.ceil((rank / count) * 100));
    },
    // Total given by each payer across the whole extract, keyed by case-folded name.
    // Donor size is judged on this TOTAL, not on the individual transfer: a donor who
    // gave three R$ 5.000 transfers is one large donor, not three medium ones.
    donorTotals({ fullTransfers } = this) {
      if (!fullTransfers || !fullTransfers.length) return null;
      const totals = new Map();
      fullTransfers.forEach((transfer) => {
        const key = (transfer.name || '').trim().toLowerCase();
        totals.set(key, (totals.get(key) || 0) + (Number(transfer.value) || 0));
      });
      return totals;
    },
    // What the extract table renders when the full extract fits the fetch budget:
    // rows filtered by the donor's size tier and ranked biggest donor first (then by
    // transfer value within the same donor), per the editorial call that the extract
    // should read as a donor ranking. Thresholds match the value bands: large above
    // R$ 100 mil (super), R$ 10-100 mil (large), R$ 2-10 mil (medium), up to R$ 2 mil
    // (small) -- change them together
    // with the donorFilter* labels in pt.yaml. null = keep the API's newest-first
    // paginated table and hide the filters.
    extractView({
      fullTransfers, donorTotals, donorFilter, extractVisible,
    } = this) {
      if (!fullTransfers || !fullTransfers.length || !donorTotals) return null;

      const keyOf = (transfer) => (transfer.name || '').trim().toLowerCase();
      const tierOf = (total) => {
        if (total > 100000) return 'super';
        if (total > 10000) return 'large';
        if (total > 2000) return 'medium';
        return 'small';
      };

      const rows = fullTransfers
        .filter((transfer) => donorFilter === 'all'
          || tierOf(donorTotals.get(keyOf(transfer))) === donorFilter)
        .sort((a, b) => {
          const totalA = donorTotals.get(keyOf(a));
          const totalB = donorTotals.get(keyOf(b));
          if (totalB !== totalA) return totalB - totalA;
          const keyA = keyOf(a);
          const keyB = keyOf(b);
          if (keyA !== keyB) return keyA < keyB ? -1 : 1;
          return (Number(b.value) || 0) - (Number(a.value) || 0);
        });

      return {
        rows: rows.slice(0, extractVisible),
        count: rows.length,
        sum: rows.reduce((sum, transfer) => sum + (Number(transfer.value) || 0), 0),
        hasMore: rows.length > extractVisible,
      };
    },
    // Self-declared color/race per candidacy, oldest first, ignoring entries
    // without the field (API not yet updated) and 'SEM INFORMAÇÃO' (absence,
    // not a declaration). Drives the trajectory table column and the
    // change note below.
    raceDeclarations({ elections } = this) {
      return [...elections]
        .filter((election) => {
          const name = election.race?.name;
          return name && name.toUpperCase() !== 'SEM INFORMAÇÃO';
        })
        .sort((a, b) => a.year - b.year)
        .map((election) => ({ year: election.year, race: formatRace(election.race.name) }));
    },
    // Oldest vs newest declaration, when they differ. Rendered descriptively
    // ("parda em 2022, preta em 2026") -- changing a self-declaration is
    // often legitimate, and the note's copy carries that framing; this
    // computed only states the two endpoints.
    raceChange({ raceDeclarations } = this) {
      if (raceDeclarations.length < 2) return null;
      const first = raceDeclarations[0];
      const last = raceDeclarations[raceDeclarations.length - 1];
      if (first.race === last.race) return null;
      return {
        fromRace: first.race,
        fromYear: first.year,
        toRace: last.race,
        toYear: last.year,
      };
    },
    hasRaceData({ raceDeclarations } = this) {
      return raceDeclarations.length > 0;
    },
    // What THIS candidacy declared to the TSE, for the hero line. Gender ids
    // follow the scraper's mapping (1 = masculino, 2 = feminino); race skips
    // 'SEM INFORMAÇÃO'. null hides the line entirely -- including on APIs
    // that don't expose the fields yet.
    currentDeclaration({ current } = this) {
      if (!current) return null;
      const raceName = current.race?.name;
      const race = raceName && raceName.toUpperCase() !== 'SEM INFORMAÇÃO'
        ? formatRace(raceName)
        : null;
      const gender = { 1: 'homem', 2: 'mulher' }[current.gender_id] || null;
      if (!race && !gender) return null;
      return { race, gender };
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
    formatRace,
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
      this.breakdown = null;
      this.fullTransfers = null;
      this.fullExtractPromise = null;
      this.donorFilter = 'all';
      this.extractVisible = 20;
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
      //
      // The full-extract fetch is memoized as a promise because it has two consumers
      // with different timing: the donor-size filters on the extract table, and the
      // /breakdown 404 fallback. Neither should trigger a second crawl of the pages.
      this.fullExtractPromise = this.loadFullExtract();
      this.loadCore();
      this.loadComparison();
      this.loadBreakdown();
      this.loadTransfers();
    },
    async loadFullExtract() {
      const candidateId = this.selectedCandidateId;
      try {
        const transfers = await this.fetchAllTransfers(candidateId);
        if (candidateId !== this.selectedCandidateId) return null;
        this.fullTransfers = transfers;
        return transfers;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        return null;
      }
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
    async loadBreakdown() {
      const candidateId = this.selectedCandidateId;
      this.breakdownLoading = true;
      try {
        const response = await fetch(`${config.api.domain}candidates/${candidateId}/breakdown`);
        if (response.status === 404) {
          // The endpoint isn't deployed yet (the page's own /people fetch already proved
          // the candidate exists). Fall back to aggregating the transfers extract right
          // here in the client -- same buckets, same bands, so the page looks identical
          // and simply stops using the fallback the day the API catches up.
          const synthetic = await this.buildBreakdownFromTransfers(candidateId);
          if (candidateId !== this.selectedCandidateId) return;
          this.breakdown = synthetic;
        } else {
          if (!response.ok) {
            throw new Error(`breakdown fetch failed: ${response.status}`);
          }
          const data = await response.json();
          if (candidateId !== this.selectedCandidateId) return;
          this.breakdown = data;
        }
        // The timing chart's container only enters the DOM once `breakdown` renders its
        // v-if -- same reason MicroModal.init() waits for $nextTick in mounted().
        await this.$nextTick();
        this.renderTimingChart();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (candidateId === this.selectedCandidateId) {
          this.breakdownLoading = false;
        }
      }
    },
    // The WHOLE transfers extract (pages of 100, at most 10 requests = 1.000 rows), or
    // null when the candidacy is bigger than that budget. All or nothing, never
    // partial: the extract comes newest-first, so a truncated set would misrepresent
    // both a cumulative curve and a donor ranking. Campaigns over the budget (a 2022
    // presidential has 387k rows) keep the classic paginated table and no filters --
    // hidden beats wrong.
    async fetchAllTransfers(candidateId) {
      const pageSize = 100; // the API's documented maximum for `results`
      const maxRequests = 10;
      let transfers = [];
      for (let page = 1; page <= maxRequests; page += 1) {
        // Sequential on purpose: each page tells us whether another is needed, and the
        // API rate-limits per IP -- a parallel burst would be both wasteful and rude.
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(`${config.api.domain}candidates/${candidateId}/transfers?page=${page}&results=${pageSize}`);
        if (!response.ok) {
          throw new Error(`transfers fallback fetch failed: ${response.status}`);
        }
        // eslint-disable-next-line no-await-in-loop
        const data = await response.json();
        if (candidateId !== this.selectedCandidateId) return null;
        transfers = transfers.concat(Array.isArray(data.transfers) ? data.transfers : []);
        if (!data.has_more) {
          return transfers;
        }
      }
      return null;
    },
    // Frontend-only stand-in for /breakdown: aggregate the full extract client-side.
    // Reuses the memoized fetch from loadCandidacyDetails instead of crawling again.
    async buildBreakdownFromTransfers(candidateId) {
      const transfers = await (this.fullExtractPromise
        || this.fetchAllTransfers(candidateId));
      if (candidateId !== this.selectedCandidateId) return null;
      if (!transfers) return null;
      return this.aggregateTransfers(transfers);
    },
    // Client-side twin of the CandidateBreakdown SQL: same payer grouping idea, same
    // band bounds, same Monday-start weeks. Two honest downgrades, both handled by the
    // template already: the extract masks documents, so payers group by case-folded
    // name only, and person-donor stats can't be told apart (person_payers_count 0
    // hides that line; is_person stays null and is never displayed).
    aggregateTransfers(transfers) {
      if (!transfers.length) return null;

      const payersByKey = new Map();
      const bandsByNumber = new Map();
      const weeksByStart = new Map();
      let total = 0;

      transfers.forEach((transfer) => {
        const value = Number(transfer.value) || 0;
        total += value;

        const displayName = (transfer.name || '').trim();
        const key = displayName.toLowerCase();
        const payer = payersByKey.get(key)
          || {
            name: displayName, is_person: null, value: 0, transfers: 0,
          };
        payer.value += value;
        payer.transfers += 1;
        payersByKey.set(key, payer);

        let band = 5;
        if (value <= 500) band = 1;
        else if (value <= 2000) band = 2;
        else if (value <= 10000) band = 3;
        else if (value <= 50000) band = 4;
        const bandEntry = bandsByNumber.get(band) || { band, transfers: 0, value: 0 };
        bandEntry.transfers += 1;
        bandEntry.value += value;
        bandsByNumber.set(band, bandEntry);

        const weekStart = mondayOfWeek(transfer.date);
        const weekEntry = weeksByStart.get(weekStart)
          || { week_start: weekStart, transfers: 0, value: 0 };
        weekEntry.transfers += 1;
        weekEntry.value += value;
        weeksByStart.set(weekStart, weekEntry);
      });

      return {
        total_value: total,
        payers_count: payersByKey.size,
        person_payers_count: 0,
        person_ticket_median: null,
        top_payers: [...payersByKey.values()]
          .sort((a, b) => b.value - a.value)
          .slice(0, 5),
        value_bands: [...bandsByNumber.values()].sort((a, b) => a.band - b.band),
        weekly_series: [...weeksByStart.values()]
          .sort((a, b) => (a.week_start < b.week_start ? -1 : 1)),
      };
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
    // Switching tiers resets the local pagination -- the count restarts from the top
    // of the new ranking, same as any filter change elsewhere on the site.
    setDonorFilter(filter) {
      this.donorFilter = filter;
      this.extractVisible = 20;
    },
    showMoreExtract() {
      this.extractVisible += 20;
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
    // Cumulative revenue by ISO week -- answers "when did the money arrive": all at
    // once, early, spread out. Rendered as a right-step area because between weekly
    // buckets the accumulated total genuinely holds still; a smooth slope would invent
    // movement the data doesn't have. A dashed plot line marks the campaign's legal
    // start for election years where that date is a fixed known constant; 2020's
    // postponed calendar is deliberately absent rather than approximated.
    renderTimingChart() {
      const container = document.getElementById('js-candidato-timing-chart');
      if (!container || !this.breakdown?.weekly_series?.length) return;

      let running = 0;
      const data = this.breakdown.weekly_series.map((week) => {
        running += Number(week.value);
        return [Date.parse(`${week.week_start}T12:00:00Z`), running];
      });

      // The x axis spans the WHOLE electoral period (campaign start to 1st round), not
      // just the weeks with data -- that's what lets the fixed cap line read as "the
      // ceiling for the entire race" and shows how much runway is left. 2020's postponed
      // calendar is deliberately absent rather than approximated.
      const electoralPeriods = {
        2022: { start: '2022-08-16', election: '2022-10-02' },
        2024: { start: '2024-08-16', election: '2024-10-06' },
        2026: { start: '2026-08-16', election: '2026-10-04' },
      };
      const period = electoralPeriods[this.current?.year];
      // labelX pulls the text to the given side of the line -- the election line sits
      // on the chart's right edge, where the default placement clips the label.
      const verticalLine = (iso, text, labelX = 4) => ({
        value: Date.parse(`${iso}T12:00:00Z`),
        color: '#8c8577',
        dashStyle: 'Dash',
        width: 1,
        zIndex: 3,
        label: { text, x: labelX, style: { color: '#565064', fontSize: '11px' } },
      });
      const plotLines = period ? [
        verticalLine(period.start, window.appTimingChart?.campaignStartLabel || ''),
        verticalLine(period.election, window.appTimingChart?.electionDayLabel || '', -14),
      ] : [];

      // The second, fixed line: the legal spending cap, flat across the whole period.
      // It deliberately compresses small campaigns against the floor -- being far from
      // the ceiling IS the finding, not a rendering problem. Absent when the cap table
      // doesn't cover this election/office (same rule as the cap section).
      const cap = this.spendingCap?.limit;
      const capLine = cap ? [{
        value: cap,
        color: '#b45309',
        dashStyle: 'ShortDash',
        width: 2,
        zIndex: 3,
        label: {
          text: window.appTimingChart?.capLineLabel || '',
          align: 'right',
          x: -4,
          style: { color: '#b45309', fontSize: '11px', fontWeight: '600' },
        },
      }] : [];

      Highcharts.setOptions(chartTheme);

      this.timingChart = Highcharts.chart('js-candidato-timing-chart', {
        chart: {
          type: 'area',
          backgroundColor: 'transparent',
          height: 300,
          spacingTop: 16,
          // Same top margin as the history chart below: without it the subtitle sits
          // on top of the highest y-axis label.
          marginTop: 84,
        },
        title: {
          text: window.appTimingChart?.title || '',
        },
        subtitle: {
          text: window.appTimingChart?.subtitle || '',
        },
        legend: {
          enabled: false,
        },
        xAxis: {
          type: 'datetime',
          plotLines,
          // Soft bounds: the axis always covers the whole electoral period (so the cap
          // line spans the race even when data stops in August), but still stretches
          // for real data outside it -- crowdfunding money lands before the period
          // starts, and final accounting lands after the 1st round. Hard min/max would
          // clip those rows.
          softMin: period ? Date.parse(`${period.start}T00:00:00Z`) : undefined,
          softMax: period ? Date.parse(`${period.election}T12:00:00Z`) : undefined,
        },
        yAxis: {
          title: { text: null },
          min: 0,
          // Headroom above the cap line so its label never clips; without a cap the
          // axis just fits the data as before.
          softMax: cap ? cap * 1.08 : undefined,
          plotLines: capLine,
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
                <div style="margin-bottom:.25rem;font-weight:600">${Highcharts.dateFormat('%d/%m/%Y', this.x)}</div>
                <div>${window.appTimingChart?.tooltipLabel || ''} <b>${formatCurrencyNoAbbr(this.y)}</b></div>
              </div>`;
          },
        },
        plotOptions: {
          area: {
            step: 'right',
            fillOpacity: 0.18,
            lineWidth: 2,
            marker: { enabled: this.breakdown.weekly_series.length < 20, radius: 3 },
          },
        },
        series: [{
          name: 'Total',
          data,
          color: categorical[0],
        }],
      });

      // Same container-resize handling (and the same next-frame deferral, for the same
      // resize-loop reason) as renderHistoryChart() below.
      if (!this.timingChartResizeObserver) {
        this.timingChartResizeObserver = new ResizeObserver(() => {
          window.requestAnimationFrame(() => {
            this.timingChart?.reflow();
          });
        });
      }
      this.timingChartResizeObserver.disconnect();
      this.timingChartResizeObserver.observe(container);
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
