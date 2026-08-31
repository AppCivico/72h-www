/**
 * Recortes de gênero e cor/raça de "O que os dados mostram", montados a
 * partir dos big_numbers FILTRADOS do /index — a MESMA base que o
 * /partidos/painel/ e a chamada da cota usam.
 *
 * Por que existe: a fonte anterior era o accumulated.pie_charts, que infla
 * (1,76× em 30/08/2026) e distorce a forma da distribuição — era ele que
 * punha "21,6% feminino" na barra ao lado de um texto dizendo que o FEFC já
 * repassou 31,55% às mulheres. Os big_numbers filtrados fecham com o total
 * que a própria resposta declara, então gênero e cor/raça deixam de carregar
 * a ressalva de não fechar (que fica restrita ao recorte de partido, ainda
 * servido pelo pie_charts).
 *
 * O preço é uma requisição por categoria de cor/raça (a API não devolve o
 * breakdown por raça em uma chamada só) — 7 chamadas por tipo de
 * financiamento, com cache por ano+tipo em home.js.
 */

// Ids na API (/filters): 2 = Fundo Especial (FEFC), 1 = Fundo Partidário.
// "Outros recursos" é o resto (Outros Recursos, Financiamento Coletivo,
// Doação Direta, Auto Financiamento) — o mesmo agrupamento que o
// otherFundsWarning do i18n descreve.
export const FEFC_FUND_ID = 2;
export const PARTY_FUND_ID = 1;

export const FUND_GROUP_KEYS = ['all', 'fefc', 'fp', 'others'];

// Usados quando o /filters do ano ainda não chegou. Os ids e nomes são os
// que a API publica hoje; quando o /filters responde, ele é a fonte.
const FALLBACK_FUND_IDS = [1, 2, 3, 4, 5, 6];

export const FALLBACK_RACES = [
  { id: 1, name: 'Amarela' },
  { id: 2, name: 'Branca' },
  { id: 3, name: 'Indígena' },
  { id: 4, name: 'Parda' },
  { id: 5, name: 'Preta' },
  { id: 6, name: 'Sem Informação' },
];

const GENDER_NAMES = { female: 'Feminino', male: 'Masculino' };

/**
 * Quais fund_type_id um chip representa. 'all' devolve TODOS os ids
 * explícitos, não "sem filtro": o /index sem filtro é servido de um snapshot
 * que envelhece em outra cadência do que o caminho filtrado (observado em
 * 31/08/2026: sem filtro o total era R$ 2,391 bi; somando os tipos,
 * R$ 2,557 bi), e os quatro chips têm que ser comparáveis entre si.
 */
export function fundGroupIds(key, fundTypes) {
  const ids = (Array.isArray(fundTypes) && fundTypes.length
    ? fundTypes.map((type) => Number(type.id))
    : FALLBACK_FUND_IDS
  ).filter((id) => Number.isFinite(id) && id > 0);

  if (key === 'fefc') return [FEFC_FUND_ID];
  if (key === 'fp') return [PARTY_FUND_ID];
  if (key === 'others') return ids.filter((id) => id !== FEFC_FUND_ID && id !== PARTY_FUND_ID);
  return ids;
}

/**
 * As URLs de um lote: uma chamada sem race_id (gênero + total declarado do
 * recorte) e uma por categoria de cor/raça. days=all sempre — a seção é
 * "Total acumulado", independente do seletor de período dos filtros abaixo.
 */
export function introBreakdownRequests({
  domain, year, fundIds, races,
}) {
  const base = `${domain}index?year=${year}&days=all`;
  const fundQS = (fundIds || []).map((id) => `&fund_type_id[]=${id}`).join('');
  const raceList = Array.isArray(races) && races.length ? races : FALLBACK_RACES;

  return {
    gender: `${base}${fundQS}`,
    races: raceList.map((race) => ({
      id: race.id,
      name: race.name,
      url: `${base}${fundQS}&race_id[]=${race.id}`,
    })),
  };
}

/**
 * Monta os dois recortes no formato que handleBarData (home.js) espera:
 * { type, total, data: [{ name, y }] }. `total` é o total_amount que a API
 * declara para o recorte — handleBarData o guarda como apiTotal e compara
 * com a soma das fatias, então a régua de "não fecha" continua vigiando
 * esta fonte também.
 */
export function shapeIntroBreakdowns({ bigNumbers, raceRows, fundLabel = '' }) {
  const female = Number.parseFloat(bigNumbers?.amount_female) || 0;
  const male = Number.parseFloat(bigNumbers?.amount_male) || 0;
  const declared = Number.parseFloat(bigNumbers?.total_amount) || 0;

  const ethnicityData = (Array.isArray(raceRows) ? raceRows : [])
    .map((row) => ({ name: row.name, y: Number.parseFloat(row.total) || 0 }))
    .filter((point) => point.y > 0);

  const genderData = female > 0 || male > 0
    ? [
      { name: GENDER_NAMES.female, y: female },
      { name: GENDER_NAMES.male, y: male },
    ]
    : [];

  // Ordem de exibição da seção: cor/raça, depois gênero (partido, do
  // pie_charts, entra depois em composeIntroCharts).
  return [
    {
      type: 'ethnicity', total: declared, data: ethnicityData, fundLabel,
    },
    {
      type: 'gender', total: declared, data: genderData, fundLabel,
    },
  ];
}
