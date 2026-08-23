/**
 * Pure functions behind the party equity panel (/partidos/painel/) plus the
 * fetch helper that pulls one party's numbers from the API. Everything here
 * is deterministic and covered by partyPanel.test.mjs; the I/O shell lives
 * in build-party-panel.mjs, mirroring the candidateSitemap split.
 *
 * The panel measures PUBLIC money only (fund_type 1 = Fundo Partidário,
 * 2 = FEFC), because that is the money the quota rules regulate. The two
 * are always summed: the origin label in early deliveries is unreliable
 * (FEFC money arrives tagged as party fund), so the sum is the conservative
 * reading. Race ids 4 (parda) and 5 (preta) follow the TSE's own buckets
 * and EC 133/2024's "pessoas pretas e pardas".
 */

export const PUBLIC_FUND_TYPES = [1, 2];
export const BLACK_RACE_IDS = [4, 5];

// Below this much public money transferred, percentage rankings are noise
// (a party at R$ 50k with one female candidate would "lead" with 100%), so
// the page lists these parties separately as "quase nada distribuído" --
// which, early in the campaign, is itself the finding.
export const RANKING_FLOOR = 250000;

/** /v1/index URL for one party, optionally restricted to Black candidacies. */
export function buildIndexUrl(apiBase, year, partyId, { black = false } = {}) {
  const url = new URL('index', apiBase);
  url.searchParams.set('year', String(year));
  url.searchParams.append('party_id[]', String(partyId));
  PUBLIC_FUND_TYPES.forEach((id) => url.searchParams.append('fund_type_id[]', String(id)));
  if (black) {
    BLACK_RACE_IDS.forEach((id) => url.searchParams.append('race_id[]', String(id)));
  }
  return url.toString();
}

/**
 * The filtered /index chart is an object keyed by ISO date, each value
 * carrying that day's transfers split as {F, M}. Normalize to a sorted,
 * compact array of daily deltas; zero-only days are dropped (the API pads
 * the range with empty days).
 */
export function toDailySeries(chart) {
  if (!chart || typeof chart !== 'object') return [];
  return Object.entries(chart)
    .map(([date, split]) => ({
      d: date,
      f: Number(split?.F) || 0,
      m: Number(split?.M) || 0,
    }))
    .filter((day) => day.f > 0 || day.m > 0)
    .sort((a, b) => (a.d < b.d ? -1 : 1));
}

/** One party's panel entry from its two /index responses. */
export function buildPartyEntry(party, publicData, blackData, fefcQuotas) {
  const bigPublic = publicData?.big_numbers || {};
  const bigBlack = blackData?.big_numbers || {};
  return {
    id: party.id,
    // Five 2026 parties come from /filters with acronym: null (Republicanos,
    // Cidadania, Solidariedade, Avante, Patriota) -- their name IS the short
    // form, so it doubles as the display label and the quota-matching key.
    acronym: party.acronym || party.name,
    name: party.name,
    fefc_quota: quotaFor(party.acronym, fefcQuotas) ?? quotaFor(party.name, fefcQuotas),
    public: {
      total: Number(bigPublic.total_amount) || 0,
      female: Number(bigPublic.amount_female) || 0,
      count_all: Number(bigPublic.count_all) || 0,
      count_female: Number(bigPublic.count_female) || 0,
      daily: toDailySeries(publicData?.chart),
    },
    black: {
      total: Number(bigBlack.total_amount) || 0,
      female: Number(bigBlack.amount_female) || 0,
      count_all: Number(bigBlack.count_all) || 0,
      daily: toDailySeries(blackData?.chart),
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
 * when the party has no public money yet -- "no data" must never render
 * as "0%", which would read as a measured violation.
 */
export function deriveShares(entry) {
  const { total } = entry.public;
  if (!(total > 0)) {
    return {
      femaleShare: null, blackShare: null, blackFemaleShare: null, quotaUsed: null,
    };
  }
  return {
    femaleShare: (entry.public.female / total) * 100,
    blackShare: (entry.black.total / total) * 100,
    blackFemaleShare: (entry.black.female / total) * 100,
    quotaUsed: entry.fefc_quota ? (total / entry.fefc_quota) * 100 : null,
  };
}

/**
 * Splits entries into the ranked list (>= floor of public money, sorted by
 * the chosen share, best first) and the "quase nada distribuído" list
 * (sorted by FEFC quota, biggest pot first -- the bigger the pot sitting
 * still, the more newsworthy the stillness).
 */
export function splitForRanking(entries, { floor = RANKING_FLOOR } = {}) {
  const ranked = [];
  const dormant = [];
  entries.forEach((entry) => {
    (entry.public.total >= floor ? ranked : dormant).push(entry);
  });
  dormant.sort((a, b) => (b.fefc_quota || 0) - (a.fefc_quota || 0));
  return { ranked, dormant };
}

/**
 * Cumulative share-over-time for the thermometer chart: for each day the
 * party moved money, the share of its cumulative public total that had
 * gone to the tracked group by then. A party planning to comply only at
 * the deadline draws a line crawling under 30% until September.
 */
export function cumulativeShareSeries(publicDaily, groupDaily) {
  const groupByDate = new Map(groupDaily.map((day) => [day.d, day.f + day.m]));
  let total = 0;
  let group = 0;
  return publicDaily.map((day) => {
    total += day.f + day.m;
    group += groupByDate.get(day.d) || 0;
    return { d: day.d, share: total > 0 ? (group / total) * 100 : null };
  });
}

/** Same shape, but tracking the female share directly from the F/M split. */
export function cumulativeFemaleShareSeries(publicDaily) {
  let total = 0;
  let female = 0;
  return publicDaily.map((day) => {
    total += day.f + day.m;
    female += day.f;
    return { d: day.d, share: total > 0 ? (female / total) * 100 : null };
  });
}
