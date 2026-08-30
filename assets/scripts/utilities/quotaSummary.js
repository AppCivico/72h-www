/**
 * Retrato da cota de gênero no Fundo Eleitoral, partido a partido.
 *
 * Por que existe: a home e o /partidos/painel/ respondem à mesma pergunta
 * legal, e antes cada um carregava a sua cópia das constantes. Duas cópias já
 * eram frágeis (o comentário em painel.js pedia "se um mudar, mude o outro");
 * uma terceira, na home, seria a garantia de divergirem. Aqui fica a régua, e
 * painel.js importa daqui.
 *
 * A base é sempre o FEFC, e só ele. O piso legal incide sobre os fundos, não
 * sobre tudo que a candidatura arrecadou, então misturar doação de pessoa
 * física no denominador produziria uma acusação com a conta errada.
 *
 * Linguagem: nada aqui afirma descumprimento. Prestação de contas ainda não
 * aconteceu, o repasse pode continuar até o fim do prazo, e o que os números
 * suportam é "abaixo do piso até aqui", nunca "violou a lei".
 */

// Abaixo deste valor de FEFC declarado o partido sai do ranking: com R$ 50 mil
// movimentados, uma única transferência vira 100% ou 0% e o partido lideraria
// qualquer uma das duas pontas por acidente aritmético.
export const RANKING_FLOOR = 250000;

// O piso de referência da lei, usado quando não conhecemos o piso proporcional
// do partido.
export const FLOOR_SHARE = 30;

// Quantos partidos a frase nomeia. Três cabem numa linha e ainda são uma
// afirmação verificável; a lista inteira é o que o painel serve.
export const NAMED_PARTIES = 3;

export function foldAcronym(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

/**
 * @param {Array} parties linhas do painel: { acronym, name, fefc: { total, female } }
 * @param {Array} candidacies partidos de data/candidaturas2026.json, com female_floor
 * @returns {object|null} null quando não há base para afirmar nada
 */
export default function quotaSummary(parties, candidacies) {
  const rows = Array.isArray(parties) ? parties : [];
  const floors = new Map(
    (Array.isArray(candidacies) ? candidacies : [])
      .map((party) => [foldAcronym(party.acronym), party]),
  );

  let declared = 0;
  let female = 0;
  const ranked = [];

  rows.forEach((party) => {
    const total = Number(party?.fefc?.total) || 0;
    const toWomen = Number(party?.fefc?.female) || 0;
    if (total <= 0) return;

    declared += total;
    female += toWomen;

    // Fora do ranking, mas dentro do agregado: o dinheiro é real, o que não
    // se sustenta é a porcentagem de um volume pequeno demais.
    if (total < RANKING_FLOOR) return;

    const known = floors.get(foldAcronym(party.acronym))
      || floors.get(foldAcronym(party.name));
    const floor = known ? Number(known.female_floor) : FLOOR_SHARE;
    const share = (toWomen / total) * 100;

    ranked.push({
      acronym: party.acronym || party.name,
      total,
      share,
      floor,
      floorKnown: Boolean(known),
      // A distância até o piso DELE, que é o que torna os partidos
      // comparáveis entre si: o piso é proporcional às candidaturas de
      // mulheres que cada um registrou, não 30% para todos.
      gap: share - floor,
      // A mesma distância em reais. É por ela que as duas listas são
      // ordenadas, e não pela diferença percentual, porque a frase fala do
      // CONJUNTO: um partido com R$ 1,5 milhão e 100% para mulheres tem a
      // maior folga percentual da tabela e mesmo assim quase não move o
      // agregado, enquanto o maior do fundo, seis pontos abaixo do próprio
      // piso, move sozinho dezenas de milhões. Ordenar por porcentagem
      // colocaria o primeiro no lugar do segundo.
      weight: (total * (share - floor)) / 100,
    });
  });

  if (declared <= 0 || ranked.length === 0) return null;

  const byWeight = [...ranked].sort((a, b) => a.weight - b.weight);
  const below = byWeight.filter((party) => party.gap < 0);
  const above = byWeight.filter((party) => party.gap >= 0);
  const share = (female / declared) * 100;

  return {
    declared,
    female,
    share,
    meetsFloor: share >= FLOOR_SHARE,
    floorShare: FLOOR_SHARE,
    ranked: ranked.length,
    belowCount: below.length,
    aboveCount: above.length,
    // Os mais distantes do próprio piso, e os que mais o superam.
    worst: below.slice(0, NAMED_PARTIES).map((party) => party.acronym),
    best: [...above].reverse().slice(0, NAMED_PARTIES).map((party) => party.acronym),
  };
}
