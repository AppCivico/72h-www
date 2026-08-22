// Legal campaign-spending caps (1st round) for the 2022 and 2026 general elections —
// external data, not TSE-scraped: the API exposes these per candidate, but the backend
// doesn't store them, and the whole table fits in a page of JS.
//
// Source: annex table of Portaria TSE nº 449/2026 (published 21/07/2026), which kept the
// 2026 caps at exactly the 2022 values — so one table serves both elections. Cross-checked
// against the TSE's own DivulgaCandContas API (gastoCampanha1T) for SP and RO and against
// the national fixed values for the two chamber offices.
//
// Deputado Federal and Deputado Estadual/Distrital have a single national cap; Governador
// and Senador vary with the state's electorate. Presidente is one national race.
// Second-round caps are half of these and are not needed by the page.
//
// IMPORTANT: these are caps on SPENDING, not on fundraising. The page compares revenue
// against them ("raised the equivalent of X% of what the law allows to be spent") — the
// wording in pt.yaml keeps that distinction and must keep it if edited.

const GOVERNADOR = {
  AC: 3557761.23,
  AL: 7115522.46,
  AM: 7115522.46,
  AP: 3557761.23,
  BA: 17788806.16,
  CE: 11562724.00,
  DF: 7115522.46,
  ES: 7115522.46,
  GO: 11562724.00,
  MA: 11562724.00,
  MG: 17788806.16,
  MS: 6226082.16,
  MT: 7115522.46,
  PA: 11562724.00,
  PB: 7115522.46,
  PE: 11562724.00,
  PI: 7115522.46,
  PR: 11562724.00,
  RJ: 17788806.16,
  RN: 7115522.46,
  RO: 6226082.16,
  RR: 3557761.23,
  RS: 11562724.00,
  SC: 11562724.00,
  SE: 6226082.16,
  SP: 26683209.24,
  TO: 6226082.16,
};

const SENADOR = {
  AC: 3176572.53,
  AL: 3811887.03,
  AM: 3811887.03,
  AP: 3176572.53,
  BA: 5336641.85,
  CE: 4447201.54,
  DF: 3811887.03,
  ES: 3811887.03,
  GO: 4447201.54,
  MA: 4447201.54,
  MG: 5336641.85,
  MS: 3176572.53,
  MT: 3811887.03,
  PA: 4447201.54,
  PB: 3811887.03,
  PE: 4447201.54,
  PI: 3811887.03,
  PR: 4447201.54,
  RJ: 5336641.85,
  RN: 3811887.03,
  RO: 3176572.53,
  RR: 3176572.53,
  RS: 4447201.54,
  SC: 4447201.54,
  SE: 3176572.53,
  SP: 7115522.46,
  TO: 3176572.53,
};

const PRESIDENTE = 88944030.80;
const DEPUTADO_FEDERAL = 3176572.53;
const DEPUTADO_ESTADUAL = 1270629.01; // also Distrital

// The API's region objects carry name but not acronym on this page's payloads, so the
// lookup goes by name. Keys are lowercased, accents intact — they come from the TSE via
// our own region table and are stable.
const UF_BY_REGION_NAME = {
  acre: 'AC',
  alagoas: 'AL',
  amazonas: 'AM',
  amapá: 'AP',
  bahia: 'BA',
  ceará: 'CE',
  'distrito federal': 'DF',
  'espírito santo': 'ES',
  goiás: 'GO',
  maranhão: 'MA',
  'minas gerais': 'MG',
  'mato grosso do sul': 'MS',
  'mato grosso': 'MT',
  pará: 'PA',
  paraíba: 'PB',
  pernambuco: 'PE',
  piauí: 'PI',
  paraná: 'PR',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  rondônia: 'RO',
  roraima: 'RR',
  'rio grande do sul': 'RS',
  'santa catarina': 'SC',
  sergipe: 'SE',
  'são paulo': 'SP',
  tocantins: 'TO',
};

// Self-funding is capped at 10% of the office's spending cap (Lei 9.504/97,
// art. 23, §2º-A) — derived, not a separate table.
export const SELF_FUNDING_FRACTION = 0.10;

// The general elections this table is valid for. Municipal elections (2020, 2024) have
// per-municipality caps we don't carry — the page must show nothing rather than a wrong
// number for those.
const VALID_YEARS = [2022, 2026];

// The 1st-round spending cap for a candidacy, or null when the table doesn't cover it
// (municipal elections, unknown office, unknown state). `position` and `regionName` are
// the API's own strings (position.name, city.region.name).
export default function spendingLimit(year, position, regionName) {
  if (!VALID_YEARS.includes(Number(year))) return null;

  const office = (position || '').toLowerCase();
  if (office === 'presidente') return PRESIDENTE;
  if (office === 'deputado federal') return DEPUTADO_FEDERAL;
  if (office === 'deputado estadual' || office === 'deputado distrital') return DEPUTADO_ESTADUAL;

  const uf = UF_BY_REGION_NAME[(regionName || '').toLowerCase()];
  if (!uf) return null;
  if (office === 'governador') return GOVERNADOR[uf] || null;
  if (office === 'senador') return SENADOR[uf] || null;

  return null;
}
