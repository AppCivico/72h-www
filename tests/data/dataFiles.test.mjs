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
const spca = readJson('data', 'spcaDoadoresPartidos2026.json');
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

/**
 * spcaDoadoresPartidos2026.json alimenta /doadores/partidos/ inteira e não é
 * regerado no build: é um retrato datado, digitado a partir do DivulgaSPCA.
 * As identidades abaixo são as mesmas que o coletor confere contra a API, e
 * é aqui que elas param de depender de alguém rodar o coletor de novo.
 */
const perto = (a, b, folga = 1) => Math.abs(a - b) <= folga;

test('spca: a soma dos partidos fecha com o total declarado', () => {
  const soma = spca.partidos.reduce((total, party) => total + party.total, 0);
  assert.ok(perto(soma, spca.totais.total_declarado), `${soma} contra ${spca.totais.total_declarado}`);
});

test('spca: a soma do dinheiro de doador fecha por partido, por faixa e por classificação', () => {
  const alvo = spca.totais.doadores_privados;
  const porPartido = spca.partidos.reduce((total, party) => total + party.privado, 0);
  const porFaixa = spca.faixas_doador.reduce((total, faixa) => total + faixa.valor, 0);
  const porClasse = spca.classes_privadas.reduce((total, linha) => total + linha[1], 0);
  assert.ok(perto(porPartido, alvo), `partidos: ${porPartido}`);
  assert.ok(perto(porFaixa, alvo), `faixas: ${porFaixa}`);
  assert.ok(perto(porClasse, alvo, 0.01), `classificações: ${porClasse}`);
});

test('spca: receita pública, privada e rendimentos somam o total', () => {
  const t = spca.totais;
  const soma = t.fundo_partidario_detalhado + t.doadores_privados
    + t.rendimentos_aplicacoes + t.outras_receitas + t.origem_nao_identificada;
  assert.ok(perto(soma, t.total_declarado, 0.01), `${soma.toFixed(2)} contra ${t.total_declarado}`);
});

test('spca: as faixas cobrem todos os doadores, sem sobra nem repetição', () => {
  const soma = spca.faixas_doador.reduce((total, faixa) => total + faixa.doadores, 0);
  assert.equal(soma, spca.totais.doadores);
  // As bordas encaixam: o topo de uma faixa é o piso da seguinte.
  spca.faixas_doador.forEach((faixa, i) => {
    if (i === 0) return assert.equal(faixa.de, 0);
    return assert.equal(faixa.de, spca.faixas_doador[i - 1].ate);
  });
  assert.equal(spca.faixas_doador.at(-1).ate, null, 'a última faixa tem que ser aberta');
});

test('spca: a escada de concentração só cresce e cabe no total de doadores', () => {
  const c = spca.concentracao;
  const degraus = [c.p10, c.p25, c.p50, c.p75, c.p90];
  degraus.forEach((n, i) => {
    assert.ok(n >= 1, `degrau ${i} com ${n} doadores`);
    if (i) assert.ok(n >= degraus[i - 1], `degrau ${i} menor que o anterior`);
  });
  assert.ok(c.p90 <= c.doadores);
  assert.equal(c.doadores, spca.totais.doadores);
});

test('spca: os 25 maiores estão em ordem e cabem no total', () => {
  assert.equal(spca.top_doadores.length, 25);
  spca.top_doadores.forEach((linha, i) => {
    const [posicao, nome, valor, doacoes] = linha;
    assert.equal(posicao, i + 1);
    assert.ok(nome && nome.length > 3, `nome suspeito na posição ${posicao}`);
    assert.ok(doacoes >= 1);
    if (i) assert.ok(valor <= spca.top_doadores[i - 1][2], `fora de ordem na posição ${posicao}`);
  });
  const soma = spca.top_doadores.reduce((total, linha) => total + linha[2], 0);
  assert.ok(soma < spca.totais.doadores_privados, 'os 25 maiores não podem passar do total privado');
});

test('spca: nenhum CPF ou CNPJ no arquivo', () => {
  // O TSE publica o CPF inteiro de quem doa a partido. A regra da casa é não
  // repetir: se um documento entrar aqui, ele vai parar no HTML publicado.
  const bruto = JSON.stringify(spca);
  const documentos = bruto.match(/\b\d{11}\b|\b\d{14}\b|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g);
  assert.equal(documentos, null, `documentos encontrados: ${documentos}`);
});

test('spca: o estado das contas de 2025 é coerente', () => {
  const s = spca.status_2025;
  assert.ok(s.nacionais_entregues <= s.nacionais_total);
  assert.ok(s.estaduais_entregues <= s.estaduais_com_diretorio);
  assert.equal(s.estaduais_sem_entrega.length, s.estaduais_com_diretorio - s.estaduais_entregues);
  for (const censo of [s.censo_municipal_RR, s.censo_municipal_AP]) {
    assert.ok(censo.entregues <= censo.com_diretorio);
  }
  const painel = s.painel_tse;
  assert.equal(painel.entregues + painel.em_preenchimento + painel.nao_iniciadas, painel.total);
});

test('spca: todo partido com doador tem valor, e todo valor tem doador', () => {
  for (const party of spca.partidos) {
    assert.equal(
      party.doadores > 0, party.privado > 0,
      `${party.sigla}: ${party.doadores} doadores e ${party.privado} em doação`,
    );
    assert.ok(party.privado <= party.total, `${party.sigla} recebeu mais de doador do que declarou`);
  }
});
