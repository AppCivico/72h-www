import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BLACK_RACE_IDS,
  buildFundTotalUrl,
  buildIndexUrl,
  buildPartyEntry,
  isPanelParty,
  cumulativeFemaleShareSeries,
  cumulativeShareSeries,
  deriveShares,
  futureDatedDays,
  quotaFor,
  splitForRanking,
  toDailySeries,
} from './partyPanel.mjs';

const API = 'https://h72-api.appcivico.com/v1/';

test('buildIndexUrl carries year, party and the Fundo Eleitoral alone', () => {
  const url = new URL(buildIndexUrl(API, 2026, 30));
  assert.equal(url.pathname, '/v1/index');
  assert.equal(url.searchParams.get('year'), '2026');
  assert.deepEqual(url.searchParams.getAll('party_id[]'), ['30']);
  // The whole point of the FEFC-only basis: fund_type 1 (Fundo Partidario)
  // must never reach a number the panel divides by an FEFC quota.
  assert.deepEqual(url.searchParams.getAll('fund_type_id[]'), ['2']);
  assert.deepEqual(url.searchParams.getAll('race_id[]'), []);
});

test('buildFundTotalUrl asks for one fund across every party', () => {
  const url = new URL(buildFundTotalUrl(API, 2026, 1));
  assert.equal(url.searchParams.get('year'), '2026');
  assert.deepEqual(url.searchParams.getAll('fund_type_id[]'), ['1']);
  assert.deepEqual(url.searchParams.getAll('party_id[]'), []);
});

test('isPanelParty keeps live parties and drops the extinct PSC record', () => {
  assert.equal(isPanelParty({ id: 13, acronym: 'PT', name: 'Partido dos Trabalhadores' }), true);
  assert.equal(isPanelParty({ id: 19, acronym: null, name: 'Podemos' }), true);
  assert.equal(isPanelParty({ id: 20, acronym: 'PSC', name: 'Partido Social Cristao' }), false);
  // Acronym drift must not smuggle it back in through the name fallback.
  assert.equal(isPanelParty({ id: 20, acronym: null, name: 'psc' }), false);
});

test('buildIndexUrl adds both Black race ids when asked', () => {
  const url = new URL(buildIndexUrl(API, 2026, 30, { black: true }));
  assert.deepEqual(url.searchParams.getAll('race_id[]'), BLACK_RACE_IDS.map(String));
});

test('toDailySeries sorts by date and drops empty padding days', () => {
  const series = toDailySeries({
    '2026-08-17': { F: 1650000, M: 2275000 },
    '2026-08-11': { F: 0, M: 0 },
    '2026-08-10': { F: 600000, M: 750000 },
  });
  assert.deepEqual(series, [
    { d: '2026-08-10', f: 600000, m: 750000 },
    { d: '2026-08-17', f: 1650000, m: 2275000 },
  ]);
});

test('toDailySeries survives a missing or malformed chart', () => {
  assert.deepEqual(toDailySeries(null), []);
  assert.deepEqual(toDailySeries('not-a-chart'), []);
});

test('toDailySeries drops days declared after the collection date', () => {
  // Real shape of the 29/08/2026 panel: three weeks of campaign plus one
  // transfer typed as 24/11, which alone stretched the axis by three months.
  const chart = {
    '2026-08-24': { F: 171295763.64, M: 415619172.84 },
    '2026-08-27': { F: 26963060.69, M: 43010169.17 },
    '2026-11-24': { F: 0, M: 90000 },
  };
  assert.deepEqual(toDailySeries(chart, { until: '2026-08-29' }).map((day) => day.d), [
    '2026-08-24', '2026-08-27',
  ]);
  // The collection day itself is inside the cut, not after it.
  assert.deepEqual(toDailySeries(chart, { until: '2026-08-27' }).map((day) => day.d), [
    '2026-08-24', '2026-08-27',
  ]);
  // No cutoff means the old behaviour, unchanged.
  assert.equal(toDailySeries(chart).length, 3);
});

test('futureDatedDays counts and sums what the cutoff left out', () => {
  const chart = {
    '2026-08-27': { F: 26963060.69, M: 43010169.17 },
    '2026-09-26': { F: 0, M: 137500 },
    '2026-10-24': { F: 17500, M: 0 },
    '2026-11-24': { F: 0, M: 90000 },
    // Padding day after the cutoff with no money: not a declaration, so it
    // must not inflate the count the page shows.
    '2026-10-30': { F: 0, M: 0 },
  };
  assert.deepEqual(futureDatedDays(chart, '2026-08-29'), { count: 3, value: 245000 });
});

test('futureDatedDays is silent without a cutoff or a chart', () => {
  assert.deepEqual(futureDatedDays(null, '2026-08-29'), { count: 0, value: 0 });
  assert.deepEqual(futureDatedDays({ '2026-11-24': { F: 0, M: 1 } }, null), { count: 0, value: 0 });
});

test('buildPartyEntry keeps future-dated money in the totals, out of the series', () => {
  const chart = {
    '2026-08-27': { F: 100, M: 300 },
    '2026-11-24': { F: 0, M: 90000 },
  };
  const entry = buildPartyEntry(
    { id: 10, acronym: 'PL', name: 'PL' },
    { big_numbers: { total_amount: 90400, amount_female: 100 }, chart },
    { big_numbers: {}, chart: {} },
    { PL: 881657477.34 },
    { until: '2026-08-29' },
  );
  // The table's number comes from big_numbers and is untouched by the cut.
  assert.equal(entry.fefc.total, 90400);
  assert.deepEqual(entry.fefc.daily.map((day) => day.d), ['2026-08-27']);
});

test('quotaFor matches across acronym spelling drift and misses honestly', () => {
  const quotas = { PCdoB: 60531914.25, UNIÃO: 526242858.11 };
  assert.equal(quotaFor('PC do B', quotas), 60531914.25);
  assert.equal(quotaFor('uniao', quotas), 526242858.11);
  assert.equal(quotaFor('PARTIDO NOVO DEMAIS', quotas), null);
  assert.equal(quotaFor('PT', null), null);
});

test('a null acronym from /filters falls back to the name, for label and quota alike', () => {
  const entry = buildPartyEntry(
    { id: 10, acronym: null, name: 'Republicanos' },
    { big_numbers: { total_amount: 1000 }, chart: {} },
    { big_numbers: { total_amount: 0 }, chart: {} },
    { REPUBLICANOS: 348587815.77 },
  );
  assert.equal(entry.acronym, 'Republicanos');
  assert.equal(entry.fefc_quota, 348587815.77);
});

test('deriveShares computes the three equity shares and quota usage', () => {
  const entry = buildPartyEntry(
    { id: 30, acronym: 'NOVO', name: 'Partido Novo' },
    {
      big_numbers: {
        total_amount: 6906000, amount_female: 2504000, count_all: 76, count_female: 24,
      },
      chart: { '2026-08-10': { F: 600000, M: 750000 } },
    },
    {
      big_numbers: { total_amount: 470000, amount_female: 5000, count_all: 12 },
      chart: { '2026-08-17': { F: 5000, M: 445000 } },
    },
    { NOVO: 37044203.26 },
  );
  const shares = deriveShares(entry);
  assert.ok(Math.abs(shares.femaleShare - 36.258) < 0.01);
  assert.ok(Math.abs(shares.blackShare - 6.805) < 0.01);
  assert.ok(Math.abs(shares.blackFemaleShare - 0.0724) < 0.001);
  assert.ok(Math.abs(shares.quotaUsed - 18.642) < 0.01);
});

test('deriveShares yields nulls, never zeros, for a party without money', () => {
  const entry = buildPartyEntry(
    { id: 99, acronym: 'XX', name: 'X' },
    { big_numbers: { total_amount: 0 } },
    { big_numbers: { total_amount: 0 } },
    {},
  );
  assert.deepEqual(deriveShares(entry), {
    femaleShare: null, blackShare: null, blackFemaleShare: null, quotaUsed: null,
  });
});

test('splitForRanking applies the floor and sorts the dormant by quota size', () => {
  const make = (acronym, total, quota) => ({
    acronym, fefc: { total }, fefc_quota: quota,
  });
  const { ranked, dormant } = splitForRanking([
    make('A', 5000000, 100),
    make('B', 10, 900),
    make('C', 0, 5000),
    make('D', 250000, 1),
  ]);
  assert.deepEqual(ranked.map((entry) => entry.acronym), ['A', 'D']);
  assert.deepEqual(dormant.map((entry) => entry.acronym), ['C', 'B']);
});

test('cumulativeShareSeries tracks the running share of the group', () => {
  const fefcDaily = [
    { d: '2026-08-10', f: 0, m: 100 },
    { d: '2026-08-11', f: 0, m: 100 },
    { d: '2026-08-12', f: 0, m: 200 },
  ];
  const blackDaily = [
    { d: '2026-08-11', f: 0, m: 100 },
  ];
  const series = cumulativeShareSeries(fefcDaily, blackDaily);
  assert.deepEqual(series.map((point) => Math.round(point.share)), [0, 50, 25]);
});

test('cumulativeFemaleShareSeries reads the share straight from the F/M split', () => {
  const series = cumulativeFemaleShareSeries([
    { d: '2026-08-10', f: 30, m: 70 },
    { d: '2026-08-11', f: 70, m: 30 },
  ]);
  assert.deepEqual(series.map((point) => Math.round(point.share)), [30, 50]);
});
