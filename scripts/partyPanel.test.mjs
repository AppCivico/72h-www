import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BLACK_RACE_IDS,
  buildIndexUrl,
  buildPartyEntry,
  cumulativeFemaleShareSeries,
  cumulativeShareSeries,
  deriveShares,
  quotaFor,
  splitForRanking,
  toDailySeries,
} from './partyPanel.mjs';

const API = 'https://h72-api.appcivico.com/v1/';

test('buildIndexUrl carries year, party and both public fund types', () => {
  const url = new URL(buildIndexUrl(API, 2026, 30));
  assert.equal(url.pathname, '/v1/index');
  assert.equal(url.searchParams.get('year'), '2026');
  assert.deepEqual(url.searchParams.getAll('party_id[]'), ['30']);
  assert.deepEqual(url.searchParams.getAll('fund_type_id[]'), ['1', '2']);
  assert.deepEqual(url.searchParams.getAll('race_id[]'), []);
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

test('splitForRanking applies the floor and sorts the dormant by pot size', () => {
  const make = (acronym, total, quota) => ({
    acronym, public: { total }, fefc_quota: quota,
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
  const publicDaily = [
    { d: '2026-08-10', f: 0, m: 100 },
    { d: '2026-08-11', f: 0, m: 100 },
    { d: '2026-08-12', f: 0, m: 200 },
  ];
  const blackDaily = [
    { d: '2026-08-11', f: 0, m: 100 },
  ];
  const series = cumulativeShareSeries(publicDaily, blackDaily);
  assert.deepEqual(series.map((point) => Math.round(point.share)), [0, 50, 25]);
});

test('cumulativeFemaleShareSeries reads the share straight from the F/M split', () => {
  const series = cumulativeFemaleShareSeries([
    { d: '2026-08-10', f: 30, m: 70 },
    { d: '2026-08-11', f: 70, m: 30 },
  ]);
  assert.deepEqual(series.map((point) => Math.round(point.share)), [30, 50]);
});
