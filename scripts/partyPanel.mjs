/**
 * Pure functions behind the party equity panel (/partidos/painel/) plus the
 * fetch helper that pulls one party's numbers from the API. Everything here
 * is deterministic and covered by partyPanel.test.mjs; the I/O shell lives
 * in build-party-panel.mjs, mirroring the candidateSitemap split.
 *
 * The panel measures the Fundo Eleitoral (FEFC, fund_type 2) and ONLY it.
 * The quota rules of art. 17, §§ 8º e 9º of the Constitution also reach the
 * Fundo Partidário, but the table's denominator is each party's FEFC quota,
 * so keeping the numerator on the same fund is what makes the percentage
 * mean what it says. Fundo Partidário (fund_type 1) is fetched once, as a
 * whole-election total, purely to disclose how much money this page leaves
 * out -- it never enters a share, a ranking or the R$ 250 mil cut.
 *
 * Race ids 4 (parda) and 5 (preta) follow the TSE's own buckets and EC
 * 133/2024's "pessoas pretas e pardas".
 */

export const FEFC_FUND_TYPE = 2;
export const PARTY_FUND_TYPE = 1;
export const BLACK_RACE_IDS = [4, 5];

// Below this much Fundo Eleitoral declared as received, the percentages still
// reflect a handful of transfers and may not represent how the party will
// distribute money over the campaign, so the page lists these parties
// separately as "quase nada distribuído" -- which, early on, is the finding.
export const RANKING_FLOOR = 250000;

/**
 * Parties the panel must not score. The API's /filters list is historical:
 * it still carries legends that no longer exist in 2026, and a 2026 record
 * attached to one of them points at a classification or party-history
 * problem in the source data rather than at a real party.
 *
 * PSC was incorporated into Podemos on 15 June 2023 (TSE decision) and does
 * not run in 2026. Its handful of 2026 transfers is deliberately NOT moved
 * to Podemos: the origin of those records has to be identified first.
 */
export const EXCLUDED_ACRONYMS = ['PSC'];

/** False for parties that must stay out of the panel entirely. */
export function isPanelParty(party) {
  const label = foldAcronym(party?.acronym || party?.name || '');
  return !EXCLUDED_ACRONYMS.some((acronym) => foldAcronym(acronym) === label);
}

/** /v1/index URL for one party's Fundo Eleitoral, optionally Black-only. */
export function buildIndexUrl(apiBase, year, partyId, { black = false } = {}) {
  const url = new URL('index', apiBase);
  url.searchParams.set('year', String(year));
  url.searchParams.append('party_id[]', String(partyId));
  url.searchParams.append('fund_type_id[]', String(FEFC_FUND_TYPE));
  if (black) {
    BLACK_RACE_IDS.forEach((id) => url.searchParams.append('race_id[]', String(id)));
  }
  return url.toString();
}

/** /v1/index URL for one fund's whole-election total, across all parties. */
export function buildFundTotalUrl(apiBase, year, fundTypeId) {
  const url = new URL('index', apiBase);
  url.searchParams.set('year', String(year));
  url.searchParams.append('fund_type_id[]', String(fundTypeId));
  return url.toString();
}

/**
 * The filtered /index chart is an object keyed by ISO date, each value
 * carrying that day's transfers split as {F, M}. Normalize to a sorted,
 * compact array of daily deltas; zero-only days are dropped (the API pads
 * the range with empty days).
 *
 * `until` (ISO date) drops days after the collection date. Declarations do
 * carry dates in the future: on 29/08/2026 the panel held four of them, in
 * 26/09, 24/10, 26/10 and 24/11, the largest R$ 90 mil. They are almost
 * certainly typos, and the effect on the thermometer chart is out of all
 * proportion to the money involved, since the axis stretches three months
 * past the last real transfer and the lines get squeezed into a corner. The
 * totals on the table do NOT come from this series (they come from
 * big_numbers), so dropping the day here never moves a party's share.
 */
export function toDailySeries(chart, { until = null } = {}) {
  if (!chart || typeof chart !== 'object') return [];
  return Object.entries(chart)
    .map(([date, split]) => ({
      d: date,
      f: Number(split?.F) || 0,
      m: Number(split?.M) || 0,
    }))
    .filter((day) => day.f > 0 || day.m > 0)
    .filter((day) => !until || day.d <= until)
    .sort((a, b) => (a.d < b.d ? -1 : 1));
}

/**
 * The declarations `toDailySeries` left out for carrying a date after the
 * collection: how many and how much. The panel publishes this instead of
 * silently dropping them, so "the chart stops on the 27th" has a stated
 * reason and the size of what was set aside is on the record.
 */
export function futureDatedDays(chart, until) {
  if (!chart || typeof chart !== 'object' || !until) return { count: 0, value: 0 };
  return Object.entries(chart)
    .filter(([date]) => date > until)
    .reduce((acc, [, split]) => {
      const value = (Number(split?.F) || 0) + (Number(split?.M) || 0);
      return value > 0 ? { count: acc.count + 1, value: acc.value + value } : acc;
    }, { count: 0, value: 0 });
}

/**
 * One party's panel entry from its two /index responses. `until` is the
 * collection date: days declared after it stay out of the plotted series
 * (see toDailySeries) but remain inside the totals, which come from
 * big_numbers.
 */
export function buildPartyEntry(party, fefcData, blackData, fefcQuotas, { until = null } = {}) {
  const bigFefc = fefcData?.big_numbers || {};
  const bigBlack = blackData?.big_numbers || {};
  return {
    id: party.id,
    // Five 2026 parties come from /filters with acronym: null (Republicanos,
    // Cidadania, Solidariedade, Avante, Patriota) -- their name IS the short
    // form, so it doubles as the display label and the quota-matching key.
    acronym: party.acronym || party.name,
    name: party.name,
    fefc_quota: quotaFor(party.acronym, fefcQuotas) ?? quotaFor(party.name, fefcQuotas),
    fefc: {
      total: Number(bigFefc.total_amount) || 0,
      female: Number(bigFefc.amount_female) || 0,
      count_all: Number(bigFefc.count_all) || 0,
      count_female: Number(bigFefc.count_female) || 0,
      daily: toDailySeries(fefcData?.chart, { until }),
    },
    black: {
      total: Number(bigBlack.total_amount) || 0,
      female: Number(bigBlack.amount_female) || 0,
      count_all: Number(bigBlack.count_all) || 0,
      daily: toDailySeries(blackData?.chart, { until }),
    },
  };
}

/**
 * FEFC quota lookup tolerant to acronym drift between our party table and
 * the TSE's fund table ("PC do B" vs "PCdoB", case, accents). Returns null
 * for parties without a 2026 quota (new or unregistered ones) -- the page
 * then omits the "share of quota" figure instead of showing a wrong zero.
 */
export function quotaFor(acronym, quotas) {
  if (!acronym || !quotas) return null;
  const wanted = foldAcronym(acronym);
  const hit = Object.keys(quotas).find((key) => foldAcronym(key) === wanted);
  return hit === undefined ? null : quotas[hit];
}

function foldAcronym(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

/**
 * Derived, display-ready numbers for one entry. Shares are null (not 0)
 * when the party has no Fundo Eleitoral declared yet -- "no data" must never
 * render as "0%", which would read as a measured violation.
 */
export function deriveShares(entry) {
  const { total } = entry.fefc;
  if (!(total > 0)) {
    return {
      femaleShare: null, blackShare: null, blackFemaleShare: null, quotaUsed: null,
    };
  }
  return {
    femaleShare: (entry.fefc.female / total) * 100,
    blackShare: (entry.black.total / total) * 100,
    blackFemaleShare: (entry.black.female / total) * 100,
    quotaUsed: entry.fefc_quota ? (total / entry.fefc_quota) * 100 : null,
  };
}

/**
 * Splits entries into the ranked list (>= floor of Fundo Eleitoral, sorted by
 * the chosen share, best first) and the "quase nada distribuído" list
 * (sorted by FEFC quota, biggest quota first).
 */
export function splitForRanking(entries, { floor = RANKING_FLOOR } = {}) {
  const ranked = [];
  const dormant = [];
  entries.forEach((entry) => {
    (entry.fefc.total >= floor ? ranked : dormant).push(entry);
  });
  dormant.sort((a, b) => (b.fefc_quota || 0) - (a.fefc_quota || 0));
  return { ranked, dormant };
}

/**
 * Cumulative share-over-time for the thermometer chart: for each day the
 * party moved money, the share of its cumulative Fundo Eleitoral that had
 * reached the tracked group by then. The later a party concentrates its
 * transfers, the longer its line stays under the 30% reference.
 */
export function cumulativeShareSeries(fefcDaily, groupDaily) {
  const groupByDate = new Map(groupDaily.map((day) => [day.d, day.f + day.m]));
  let total = 0;
  let group = 0;
  return fefcDaily.map((day) => {
    total += day.f + day.m;
    group += groupByDate.get(day.d) || 0;
    return { d: day.d, share: total > 0 ? (group / total) * 100 : null };
  });
}

/** Same shape, but tracking the female share directly from the F/M split. */
export function cumulativeFemaleShareSeries(fefcDaily) {
  let total = 0;
  let female = 0;
  return fefcDaily.map((day) => {
    total += day.f + day.m;
    female += day.f;
    return { d: day.d, share: total > 0 ? (female / total) * 100 : null };
  });
}
