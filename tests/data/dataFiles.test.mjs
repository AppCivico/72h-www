/**
 * Os JSON de data/ são números externos (TSE, IBGE, Câmara) digitados ou
 * convertidos por nós, e o site os apresenta como fatos. Um erro aqui não
 * quebra build nenhum: ele publica um número errado com cara de oficial.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLACK_RACE_IDS, FEFC_FUND_TYPE, PARTY_FUND_TYPE } from '../../scripts/partyPanel.mjs';
import { exists, readJson } from '../helpers/paths.mjs';

const fefc = readJson('data', 'fefc2026.json');
const representacao = readJson('data', 'representacao2026.json');
const candidaturas = readJson('data', 'candidaturas2026.json');
const historico = readJson('data', 'declaracaoHistorico.json');
const geral = readJson('data', 'filters', 'general.json').filters;
const municipal = readJson('data', 'filters', 'municipal.json').filters;

test('fefc2026: a tabela oficial fecha com o total divulgado', () => {
  const soma = Object.values(fefc.quotas).reduce((total, value) => total + value, 0);
  // A própria tabela do TSE arredonda: a soma fecha em ...776,99 contra
  // ...777,00 divulgado. Mais de um real de diferença é erro nosso.
  assert.ok(Math.abs(soma - fefc.total) <= 1, `soma ${soma.toFixed(2)} contra total ${fefc.total}`);
});

test('fefc2026: 30 partidos, nenhum zerado, nenhum repetido', () => {
  const siglas = Object.keys(fefc.quotas);
  assert.equal(siglas.length, 30);
  assert.equal(new Set(siglas.map((s) => s.toUpperCase())).size, siglas.length);
  siglas.forEach((sigla) => {
    assert.ok(fefc.quotas[sigla] > 0, `${sigla} com cota <= 0`);
    assert.ok(Number.isFinite(fefc.quotas[sigla]), `${sigla} não é número`);
  });
});

test('fefc2026: nenhum partido leva mais de 20% do fundo', () => {
  // Régua de sanidade contra dígito a mais: o maior (PL) fica em ~17,8%.
  for (const [sigla, valor] of Object.entries(fefc.quotas)) {
    assert.ok(valor / fefc.total < 0.2, `${sigla} com ${((valor / fefc.total) * 100).toFixed(1)}% do fundo`);
  }
});

test('todo número externo cita URL de origem', () => {
  // Regra editorial do site: dado de terceiro sem link de origem não entra.
  // (declaracaoHistorico vem da nossa própria API e é checado abaixo.)
  for (const [nome, arquivo] of Object.entries({
    fefc2026: fefc, representacao2026: representacao, candidaturas2026: candidaturas,
  })) {
    const fonte = JSON.stringify([
      arquivo._source, arquivo._sources, arquivo.source, arquivo.source_url,
    ].filter(Boolean));
    assert.ok(fonte.length > 20, `${nome} sem _source`);
    assert.match(fonte, /https?:\/\//, `${nome} sem URL na fonte`);
  }

  // O histórico é leitura da nossa API: o que precisa estar escrito é o
  // endpoint e a data, para alguém conseguir reler os mesmos campos.
  assert.match(historico._source, /\/v1\/index/);
  assert.match(historico._source, /\d{4}-\d{2}-\d{2}/);
});

test('representacao2026: percentuais dentro de 0–100 e coerentes entre si', () => {
  const { waffle, ipu } = representacao;
  for (const [campo, valor] of Object.entries(waffle)) {
    if (typeof valor !== 'number') continue;
    const teto = campo.endsWith('_pct') ? 100 : 100;
    assert.ok(valor >= 0 && valor <= teto, `waffle.${campo} = ${valor}`);
  }
  // O waffle é a mesma informação em duas unidades: cadeira de 100 tem que
  // ser o percentual arredondado, senão o desenho contradiz o texto.
  assert.equal(waffle.chamber_women_seats_of_100, Math.round(waffle.chamber_women_pct));
  assert.equal(waffle.population_women_seats_of_100, Math.round(waffle.population_women_pct));
  assert.equal(waffle.chamber_black_seats_of_100, Math.round(waffle.chamber_black_pct));
  assert.ok(ipu.brazil_rank > 0 && ipu.brazil_rank < 200);
});

test('representacao2026: a série de eleitas cobre eleições reais e cresce até 2022', () => {
  const { series } = representacao.women_elected_chamber;
  assert.ok(Array.isArray(series) && series.length > 5, 'série de deputadas eleitas ausente');

  series.forEach((ponto, indice) => {
    assert.ok(ponto.year >= 1932 && ponto.year <= 2026, `ano fora de faixa: ${ponto.year}`);
    assert.ok(ponto.count >= 0 && ponto.count <= 513, `${ponto.year}: ${ponto.count} deputadas em 513 cadeiras`);
    if (indice > 0) {
      assert.ok(ponto.year > series[indice - 1].year, `a série volta no tempo em ${ponto.year}`);
    }
  });

  const ultima = series[series.length - 1];
  assert.equal(ultima.year, 2022);
  assert.equal(ultima.count, 91, 'a bancada feminina de 2022 foi de 91 deputadas');
});

test('representacao2026: o funil de 2022 não inventa mais eleitos do que a Câmara tem', () => {
  const { groups } = representacao.funnel_2022_chamber;
  assert.ok(groups.length >= 3, 'funil sem grupos');

  groups.forEach((grupo) => {
    assert.ok(grupo.elected <= grupo.candidacies, `${grupo.key}: mais eleitos do que candidaturas`);
    assert.ok(grupo.elected <= 513, `${grupo.key}: mais eleitos do que cadeiras`);
    // rate_pct e one_in são a mesma taxa em duas formas; o texto usa as duas
    // na mesma frase ("2,6% — 1 em cada 38").
    const taxa = (grupo.elected / grupo.candidacies) * 100;
    assert.ok(Math.abs(taxa - grupo.rate_pct) < 0.1, `${grupo.key}: rate_pct ${grupo.rate_pct} contra ${taxa.toFixed(2)}`);
    assert.equal(grupo.one_in, Math.round(grupo.candidacies / grupo.elected), `${grupo.key}: one_in fora da conta`);
  });

  // bar_pct é comprimento de barra: 100 é o grupo de maior taxa.
  const melhor = groups.reduce((a, b) => (a.rate_pct > b.rate_pct ? a : b));
  assert.equal(melhor.bar_pct, 100, `a barra cheia devia ser ${melhor.key}`);

  const mulheres = groups.find((grupo) => grupo.key === 'women');
  assert.equal(mulheres.elected, 91, 'a bancada feminina de 2022 foi de 91 deputadas');
});

test('candidaturas2026: percentuais por partido são percentuais', () => {
  const partidos = Object.entries(candidaturas.parties);
  assert.ok(partidos.length >= 20, `só ${partidos.length} partidos`);
  for (const [sigla, dados] of partidos) {
    for (const [campo, valor] of Object.entries(dados)) {
      if (!/pct|percent/i.test(campo) || typeof valor !== 'number') continue;
      assert.ok(valor >= 0 && valor <= 100, `${sigla}.${campo} = ${valor}`);
    }
  }
});

test('declaracaoHistorico: guarda contagem, não porcentagem pronta', () => {
  // Quem divide é o template — assim a conta não envelhece escrita à mão.
  const ciclos = Object.entries(historico.cycles);
  assert.ok(ciclos.length >= 2, 'nenhum ciclo encerrado registrado');

  for (const [ano, ciclo] of ciclos) {
    assert.ok(Number.isInteger(ciclo.received) && Number.isInteger(ciclo.candidates), `${ano} sem contagem inteira`);
    assert.ok(ciclo.received > 0 && ciclo.received <= ciclo.candidates, `${ano}: ${ciclo.received} de ${ciclo.candidates}`);
    assert.ok(['municipal', 'general'].includes(ciclo.type), `${ano} sem tipo de eleição`);
    assert.equal(Number(ano) % 4 === 0 ? 'municipal' : 'general', ciclo.type, `${ano} com tipo trocado`);
  }
});

test('declaracaoHistorico: cada ano só é comparado com ciclo do mesmo tipo', () => {
  // Municipal já variou de 37,6% a 69,8%: cruzar geral com municipal
  // produziria uma régua falsa embaixo da manchete.
  for (const [ano, referencia] of Object.entries(historico.benchmarkFor)) {
    const ciclo = historico.cycles[referencia];
    assert.ok(ciclo, `${ano} aponta para o ciclo inexistente ${referencia}`);
    assert.equal(
      Number(ano) % 4 === 0 ? 'municipal' : 'general',
      ciclo.type,
      `${ano} (${Number(ano) % 4 === 0 ? 'municipal' : 'geral'}) comparado com ${referencia} (${ciclo.type})`,
    );
    assert.ok(Number(referencia) < Number(ano), `${ano} comparado com um ciclo futuro`);
  }
  assert.ok(historico.heroLeadMaxPercent > 0 && historico.heroLeadMaxPercent < 100);
});

test('filters: o snapshot de fallback cobre os 27 estados, com SP no id 24', () => {
  // É este id que vai em region_id[] quando alguém filtra por São Paulo —
  // e é o snapshot que salva o build quando a API está fora do ar.
  assert.equal(geral.regions.length, 27);
  assert.equal(new Set(geral.regions.map((r) => r.id)).size, 27);
  const sp = geral.regions.find((region) => region.name === 'SÃO PAULO');
  assert.equal(sp.id, 24);
  assert.ok(geral.regions.some((region) => region.id === 0), 'o id 0 (ACRE) precisa sobreviver');
});

test('filters: municipal e geral trazem os cargos do seu tipo de eleição', () => {
  const cargos = (filtros) => filtros.offices.map((office) => office.name);
  assert.ok(cargos(municipal).includes('Vereador'));
  assert.ok(!cargos(municipal).includes('Deputado Federal'));
  assert.ok(cargos(geral).includes('Deputado Federal'));
  assert.ok(!cargos(geral).includes('Vereador'));
});

test('filters: os ids que o painel usa continuam apontando para o que ele acha', () => {
  // partyPanel.mjs manda fund_type_id[]=2 e race_id[]=4,5 na API. Se o
  // catálogo trocar os ids, o painel some do ar dividindo por FEFC errado.
  const fundo = (id) => geral.fund_types.find((tipo) => tipo.id === id)?.name;
  assert.match(fundo(FEFC_FUND_TYPE), /Especial/);
  assert.match(fundo(PARTY_FUND_TYPE), /Partidário/);

  const racas = BLACK_RACE_IDS.map((id) => geral.races.find((raca) => raca.id === id)?.name).sort();
  assert.deepEqual(racas, ['Parda', 'Preta']);
});

test('filters: os cinco partidos sem sigla continuam sem sigla (o painel depende disso)', () => {
  const semSigla = geral.parties.filter((party) => !party.acronym).map((party) => party.name).sort();
  assert.deepEqual(semSigla, ['Avante', 'Cidadania', 'Patriota', 'Republicanos', 'Solidariedade']);
});

test('partyPanel.json: quando existe, tem a forma que a página espera', { skip: !exists('data', 'partyPanel.json') && 'gerado pelo prebuild (npm run panel:parties)' }, () => {
  const painel = readJson('data', 'partyPanel.json');
  assert.ok(Array.isArray(painel.parties) && painel.parties.length > 0);
  assert.ok(!Number.isNaN(Date.parse(painel.generated_at)));

  for (const partido of painel.parties) {
    assert.ok(partido.acronym, 'partido sem sigla no painel');
    for (const [campo, valor] of Object.entries(partido)) {
      if (!/share|pct/i.test(campo) || typeof valor !== 'number') continue;
      assert.ok(valor >= 0 && valor <= 100, `${partido.acronym}.${campo} = ${valor}`);
    }
  }
});
