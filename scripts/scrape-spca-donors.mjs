#!/usr/bin/env node
/**
 * Coleta quem doa para os DIRETÓRIOS partidários, a partir do DivulgaSPCA
 * do TSE (https://divulgaspca.tse.jus.br). Complementa o scraper do
 * DivulgaCandContas, que só enxerga o dinheiro das candidaturas.
 *
 * Saída: doador, valor e data de cada lançamento, por diretório.
 *
 * O trabalho tem duas fases, porque a API não tem endpoint em massa:
 *
 *   1. DESCOBERTA. Não existe rota que liste prestadores; a única forma de
 *      saber que o PP de Adamantina tem prestação é perguntar por ele.
 *      São ~162 mil perguntas para varrer o país inteiro (30 partidos x
 *      ~5.400 municípios e zonas, mais estaduais e nacionais), das quais
 *      ~33 mil respondem. Por isso o resultado fica em cache no disco e as
 *      execuções seguintes pulam esta fase.
 *   2. COLETA. Para cada prestador com receita: uma chamada de ranking a
 *      cada 100 doadores e uma chamada de detalhe por doador, que é onde
 *      mora a data. Quem só quer o agregado usa --sem-detalhe.
 *
 * Tudo é retomável: os arquivos são NDJSON append-only e o coletor relê
 * concluidos.ndjson antes de começar. Pode matar no meio e rodar de novo.
 *
 * Uso:
 *   node scripts/scrape-spca-donors.mjs --exercicio 2026 --esferas nacional,estadual
 *   node scripts/scrape-spca-donors.mjs --ufs SP --so-descoberta
 *   node scripts/scrape-spca-donors.mjs --so-exportar
 *
 * Opções: --exercicio --esferas --ufs --saida --concorrencia --tentativas
 *         --min-receita --mascarar-cpf --sem-detalhe --so-descoberta
 *         --so-coleta --so-exportar --recomecar --ajuda
 *
 * Aviso: a API pública do TSE não é alcançável de dentro de sandboxes com
 * egress restrito. Rode na sua máquina.
 */

import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COLUNAS_DOACOES, COLUNAS_DOADORES, cabecalhoCsv, comLimite, formatarReais, lerJson,
  linhaCsv, normalizarAgregado, normalizarPrestador, normalizarReceita, ORDENACOES_RANKING,
  parseArgs, prestadorColetavel, receitaEsperadaNoRanking, TAMANHO_MAXIMO_PAGINA, urlDetalhe,
  urlPartidos, urlPrestador, urlRanking, urlTotalizadores, urlTotalReceitas, urlUnidadesEleitorais,
} from './spcaDonors.mjs';

const raizProjeto = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTE = '72horas.org/coletor-spca (+https://72horas.org)';

const AJUDA = `
Coletor de doações aos diretórios partidários (DivulgaSPCA / TSE)

  --exercicio N       ano da prestação (padrão 2026)
  --esferas LISTA     nacional,estadual,municipal (padrão: as três)
  --ufs LISTA         siglas separadas por vírgula (padrão: todas as 27)
  --saida DIR         pasta de saída (padrão spca-out)
  --concorrencia N    requisições simultâneas (padrão 8)
  --tentativas N      tentativas por requisição (padrão 4)
  --min-receita N     ignora prestadores abaixo desse total (padrão 0)
  --mascarar-cpf      grava ***.123.456-** no lugar do CPF inteiro
  --sem-detalhe       só o agregado por doador, sem datas (bem mais rápido)
  --so-descoberta     para depois de mapear os prestadores
  --so-coleta         pula a descoberta e usa o cache
  --so-exportar       só regera os CSV a partir do que já foi baixado
  --recomecar         apaga a saída anterior antes de começar
`;

/* ------------------------------------------------------------------- rede */

const espera = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const contadores = { requisicoes: 0, repeticoes: 0, falhas: 0 };

/**
 * 500 com corpo "{}" é como a API diz "não existe" (não é 404), então isso
 * volta como { ausente: true } e não vira erro. 503 é rota que não casou,
 * o que em produção significa bug de URL: repetimos poucas vezes e desistimos.
 */
async function buscar(url, { tentativas, esperado404 = false } = {}) {
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      contadores.requisicoes += 1;
      const resposta = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': AGENTE },
      });
      if (resposta.status === 500 && esperado404) {
        await resposta.arrayBuffer();
        return { ausente: true, dados: null };
      }
      if (resposta.status === 429 || resposta.status >= 500) {
        throw new Error(`HTTP ${resposta.status}`);
      }
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      return { ausente: false, dados: lerJson(await resposta.arrayBuffer()) };
    } catch (erro) {
      ultimoErro = erro;
      if (tentativa < tentativas) {
        contadores.repeticoes += 1;
        await espera(500 * 2 ** (tentativa - 1));
      }
    }
  }
  contadores.falhas += 1;
  throw new Error(`falhou ${url}: ${ultimoErro?.message}`);
}

/* ------------------------------------------------------------------ arquivos */

async function lerNdjson(caminho) {
  if (!existsSync(caminho)) return [];
  const linhas = createInterface({ input: createReadStream(caminho), crlfDelay: Infinity });
  const registros = [];
  for await (const linha of linhas) {
    const texto = linha.trim();
    if (texto) registros.push(JSON.parse(texto));
  }
  return registros;
}

async function anexarNdjson(caminho, registros) {
  if (registros.length === 0) return;
  await appendFile(caminho, `${registros.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

function registrar(mensagem) {
  process.stderr.write(`${mensagem}\n`);
}

/* ---------------------------------------------------------------- descoberta */

async function partidosDaUf(exercicio, uf, opcoes) {
  const { dados } = await buscar(urlPartidos(exercicio, uf), { tentativas: opcoes.tentativas });
  return Array.isArray(dados) ? dados : [];
}

async function unidadesDaUf(uf, opcoes) {
  const { dados } = await buscar(urlUnidadesEleitorais(uf), { tentativas: opcoes.tentativas });
  return Array.isArray(dados) ? dados : [];
}

async function descobrirCombinacoes(combinacoes, opcoes, arquivos, rotulo) {
  let achados = 0;
  let vistos = 0;
  const encontrados = [];
  await comLimite(combinacoes, opcoes.concorrencia, async (combo) => {
    const { ausente, dados } = await buscar(
      urlPrestador(opcoes.exercicio, combo.esfera, combo),
      { tentativas: opcoes.tentativas, esperado404: true },
    );
    vistos += 1;
    if (vistos % 2000 === 0) {
      registrar(`  ${rotulo}: ${vistos}/${combinacoes.length} consultados, ${achados} com prestação`);
    }
    if (ausente || !dados) return;
    const prestador = normalizarPrestador(dados, combo);
    if (!prestadorColetavel(prestador)) return;
    achados += 1;
    encontrados.push({ ...prestador, exercicio: opcoes.exercicio });
  });
  await anexarNdjson(arquivos.prestadores, encontrados);
  registrar(`  ${rotulo}: ${achados} prestadores com prestação aberta em ${combinacoes.length} consultas`);
  return achados;
}

async function descobrir(opcoes, arquivos, estado) {
  registrar(`Descoberta de prestadores do exercício de ${opcoes.exercicio}`);
  if (opcoes.esferas.includes('municipal')) {
    // ~5.400 municípios e zonas x ~29 partidos. Vale dizer o tamanho do buraco
    // antes de entrar nele: a fase leva perto de uma hora na primeira vez e
    // fica em cache, mas quem só queria testar prefere saber agora.
    registrar(`  a esfera municipal em ${opcoes.ufs.length} UFs custa dezenas de milhares de consultas`);
    registrar('  (só na primeira vez: o resultado fica em prestadores.ndjson)');
  }

  if (opcoes.esferas.includes('nacional') && !estado.descoberta.nacional) {
    const partidos = await partidosDaUf(opcoes.exercicio, 'BR', opcoes);
    const combos = partidos.map((p) => ({ esfera: 'nacional', numeroPartido: p.numero, uf: 'BR' }));
    await descobrirCombinacoes(combos, opcoes, arquivos, 'nacional');
    estado.descoberta.nacional = true;
    await salvarEstado(arquivos, estado);
  }

  for (const uf of opcoes.ufs) {
    const precisaEstadual = opcoes.esferas.includes('estadual') && !estado.descoberta.estadual.includes(uf);
    const precisaMunicipal = opcoes.esferas.includes('municipal') && !estado.descoberta.municipal.includes(uf);
    if (!precisaEstadual && !precisaMunicipal) continue;

    const partidos = await partidosDaUf(opcoes.exercicio, uf, opcoes);

    if (precisaEstadual) {
      const combos = partidos.map((p) => ({ esfera: 'estadual', uf, numeroPartido: p.numero }));
      await descobrirCombinacoes(combos, opcoes, arquivos, `estadual ${uf}`);
      estado.descoberta.estadual.push(uf);
      await salvarEstado(arquivos, estado);
    }

    if (precisaMunicipal) {
      const unidades = await unidadesDaUf(uf, opcoes);
      const combos = [];
      for (const unidade of unidades) {
        for (const partido of partidos) {
          combos.push({
            esfera: 'municipal', uf, codigoUE: unidade.codigoUE, numeroPartido: partido.numero,
          });
        }
      }
      await descobrirCombinacoes(combos, opcoes, arquivos, `municipal ${uf}`);
      estado.descoberta.municipal.push(uf);
      await salvarEstado(arquivos, estado);
    }
  }
}

/* -------------------------------------------------------------------- coleta */

/**
 * Varre o ranking em todas as ordenações e une por documento. Uma ordenação
 * só não basta: os empates de valor fazem o banco devolver ordem arbitrária,
 * e páginas inteiras se perdem. Ver ORDENACOES_RANKING.
 */
async function rankingCompleto(prestador, opcoes) {
  const porDocumento = new Map();
  for (const ordenacao of ORDENACOES_RANKING) {
    let pagina = 0;
    for (;;) {
      const { dados } = await buscar(
        urlRanking(opcoes.exercicio, prestador.codigoPrestador, {
          pagina, tamanho: TAMANHO_MAXIMO_PAGINA, ordenacao,
        }),
        { tentativas: opcoes.tentativas },
      );
      const conteudo = dados?.content || [];
      for (const item of conteudo) porDocumento.set(item.cpfCnpjDoador, item);
      if (dados?.last || conteudo.length === 0 || pagina > 5000) break;
      pagina += 1;
    }
  }
  return [...porDocumento.values()];
}

async function coletarPrestador(prestador, opcoes) {
  const { dados: total } = await buscar(
    urlTotalReceitas(opcoes.exercicio, prestador.codigoPrestador),
    { tentativas: opcoes.tentativas },
  );
  const totalReceita = total?.totalReceita ?? 0;
  if (!(totalReceita > opcoes.minReceita)) {
    return {
      totalReceita, agregados: [], doacoes: [], somaDetalhe: 0, somaRanking: 0, esperadoRanking: 0,
    };
  }

  const { dados: totalizadores } = await buscar(
    urlTotalizadores(opcoes.exercicio, prestador.codigoPrestador),
    { tentativas: opcoes.tentativas },
  );
  const esperadoRanking = receitaEsperadaNoRanking(totalizadores) ?? totalReceita;

  const brutos = await rankingCompleto(prestador, opcoes);
  const agregados = brutos.map((item) => normalizarAgregado(item, prestador, opcoes));
  const somaRanking = brutos.reduce((soma, item) => soma + (item.valorTotalReceita || 0), 0);

  if (opcoes.semDetalhe) {
    return { totalReceita, agregados, doacoes: [], somaDetalhe: 0, somaRanking, esperadoRanking };
  }

  const porDoador = await comLimite(brutos, opcoes.concorrencia, async (item) => {
    const { dados } = await buscar(
      urlDetalhe(opcoes.exercicio, prestador.codigoPrestador, item.cpfCnpjDoador),
      { tentativas: opcoes.tentativas },
    );
    return Array.isArray(dados) ? dados : [];
  });

  const doacoes = porDoador.flat().map((receita) => normalizarReceita(receita, prestador, opcoes));
  const somaDetalhe = doacoes.reduce((soma, d) => soma + (d.valor || 0), 0);
  return { totalReceita, agregados, doacoes, somaDetalhe, somaRanking, esperadoRanking };
}

async function coletar(opcoes, arquivos) {
  const prestadores = (await lerNdjson(arquivos.prestadores))
    .filter((p) => opcoes.esferas.includes(p.esfera))
    .filter((p) => p.esfera === 'nacional' || opcoes.ufs.includes(p.uf));
  const concluidos = new Set((await lerNdjson(arquivos.concluidos)).map((c) => c.codigoPrestador));
  const pendentes = prestadores.filter((p) => !concluidos.has(p.codigoPrestador));

  registrar(`Coleta: ${pendentes.length} prestadores pendentes de ${prestadores.length} conhecidos`);

  let feitos = 0;
  for (const prestador of pendentes) {
    const resultado = await coletarPrestador(prestador, opcoes);
    await anexarNdjson(arquivos.doacoes, resultado.doacoes);
    await anexarNdjson(arquivos.doadores, resultado.agregados);
    const divergencia = opcoes.semDetalhe
      ? null
      : Number((resultado.somaDetalhe - resultado.somaRanking).toFixed(2));
    // Faltou doador: o ranking não alcançou o total declarado menos
    // rendimentos e outras receitas. É o sinal de paginação incompleta.
    const faltaNoRanking = resultado.totalReceita > 0
      ? Number((resultado.esperadoRanking - resultado.somaRanking).toFixed(2))
      : 0;
    await anexarNdjson(arquivos.concluidos, [{
      codigoPrestador: prestador.codigoPrestador,
      esfera: prestador.esfera,
      uf: prestador.uf,
      partido: prestador.siglaPartido,
      municipio: prestador.municipio,
      totalReceita: resultado.totalReceita,
      doadores: resultado.agregados.length,
      lancamentos: resultado.doacoes.length,
      divergencia,
      faltaNoRanking,
      em: new Date().toISOString(),
    }]);
    feitos += 1;
    if (feitos % 25 === 0 || resultado.agregados.length > 500) {
      registrar(`  ${feitos}/${pendentes.length} prestadores, ${contadores.requisicoes} requisições`);
    }
  }
}

/* ---------------------------------------------------------------- exportação */

async function exportarCsv(origem, destino, colunas) {
  if (!existsSync(origem)) return 0;
  // O arquivo destino é zerado ANTES de abrir a leitura: o readline começa a
  // emitir linhas assim que a interface existe, e qualquer await entre uma
  // coisa e outra faz o iterador perder as primeiras linhas de arquivos curtos.
  await writeFile(destino, '');
  const linhas = createInterface({ input: createReadStream(origem), crlfDelay: Infinity });
  const pedacos = [cabecalhoCsv(colunas)];
  let total = 0;
  for await (const linha of linhas) {
    const texto = linha.trim();
    if (!texto) continue;
    pedacos.push(linhaCsv(JSON.parse(texto), colunas));
    total += 1;
    if (pedacos.length >= 5000) {
      await appendFile(destino, `${pedacos.join('\n')}\n`);
      pedacos.length = 0;
    }
  }
  if (pedacos.length > 0) await appendFile(destino, `${pedacos.join('\n')}\n`);
  return total;
}

async function exportar(opcoes, arquivos) {
  const lancamentos = await exportarCsv(arquivos.doacoes, arquivos.doacoesCsv, COLUNAS_DOACOES);
  const agregados = await exportarCsv(arquivos.doadores, arquivos.doadoresCsv, COLUNAS_DOADORES);
  const concluidos = await lerNdjson(arquivos.concluidos);

  const comReceita = concluidos.filter((c) => c.totalReceita > 0);
  const divergentes = concluidos.filter((c) => c.divergencia !== null && Math.abs(c.divergencia) > 0.01);
  const incompletos = concluidos.filter((c) => Math.abs(c.faltaNoRanking || 0) > 0.01);
  const porPartido = new Map();
  for (const c of comReceita) {
    const atual = porPartido.get(c.partido) || { prestadores: 0, total: 0 };
    atual.prestadores += 1;
    atual.total += c.totalReceita;
    porPartido.set(c.partido, atual);
  }

  const resumo = {
    exercicio: opcoes.exercicio,
    gerado_em: new Date().toISOString(),
    fonte: 'https://divulgaspca.tse.jus.br',
    esferas: opcoes.esferas,
    ufs: opcoes.ufs.length === 27 ? 'todas' : opcoes.ufs,
    cpf_mascarado: opcoes.mascararCpf,
    detalhe_por_doador: !opcoes.semDetalhe,
    prestadores_conhecidos: (await lerNdjson(arquivos.prestadores)).length,
    prestadores_coletados: concluidos.length,
    prestadores_com_receita: comReceita.length,
    doadores: agregados,
    lancamentos,
    total_declarado: Number(comReceita.reduce((s, c) => s + c.totalReceita, 0).toFixed(2)),
    prestadores_com_divergencia: divergentes.length,
    prestadores_com_ranking_incompleto: incompletos.length,
    requisicoes: contadores.requisicoes,
    repeticoes: contadores.repeticoes,
    falhas: contadores.falhas,
    por_partido: Object.fromEntries(
      [...porPartido.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([sigla, v]) => [sigla, { prestadores: v.prestadores, total: Number(v.total.toFixed(2)) }]),
    ),
  };
  await writeFile(arquivos.resumo, `${JSON.stringify(resumo, null, 2)}\n`);

  registrar('');
  registrar(`Prestadores com receita: ${resumo.prestadores_com_receita}`);
  registrar(`Doadores (por prestador): ${agregados}`);
  registrar(`Lançamentos com data:     ${lancamentos}`);
  registrar(`Total declarado:          ${formatarReais(resumo.total_declarado)}`);
  if (divergentes.length > 0) {
    registrar(`Atenção: ${divergentes.length} prestadores em que a soma do detalhe não fecha com o ranking.`);
  }
  if (incompletos.length > 0) {
    registrar(`Atenção: ${incompletos.length} prestadores cujo ranking não alcançou o total declarado.`);
  }
  registrar(`Arquivos em ${arquivos.pasta}`);
}

/* --------------------------------------------------------------------- estado */

async function salvarEstado(arquivos, estado) {
  await writeFile(arquivos.estado, `${JSON.stringify(estado, null, 2)}\n`);
}

async function carregarEstado(arquivos, opcoes) {
  const vazio = {
    exercicio: opcoes.exercicio,
    descoberta: { nacional: false, estadual: [], municipal: [] },
  };
  if (!existsSync(arquivos.estado)) return vazio;
  try {
    const estado = JSON.parse(await readFile(arquivos.estado, 'utf8'));
    if (estado.exercicio !== opcoes.exercicio) return vazio;
    return estado;
  } catch {
    return vazio;
  }
}

/* ---------------------------------------------------------------------- main */

async function principal() {
  let opcoes;
  try {
    opcoes = parseArgs(process.argv.slice(2));
  } catch (erro) {
    registrar(erro.message);
    registrar(AJUDA);
    process.exitCode = 1;
    return;
  }
  if (opcoes.ajuda) {
    process.stdout.write(`${AJUDA}\n`);
    return;
  }

  const raizSaida = isAbsolute(opcoes.saida) ? opcoes.saida : join(raizProjeto, opcoes.saida);
  const pasta = join(raizSaida, String(opcoes.exercicio));
  if (opcoes.recomecar && existsSync(pasta)) await rm(pasta, { recursive: true, force: true });
  await mkdir(pasta, { recursive: true });

  const arquivos = {
    pasta,
    estado: join(pasta, 'estado.json'),
    prestadores: join(pasta, 'prestadores.ndjson'),
    concluidos: join(pasta, 'concluidos.ndjson'),
    doacoes: join(pasta, 'doacoes.ndjson'),
    doadores: join(pasta, 'doadores.ndjson'),
    doacoesCsv: join(pasta, 'doacoes.csv'),
    doadoresCsv: join(pasta, 'doadores.csv'),
    resumo: join(pasta, 'resumo.json'),
  };

  const inicio = Date.now();

  if (opcoes.soExportar) {
    await exportar(opcoes, arquivos);
    return;
  }

  const estado = await carregarEstado(arquivos, opcoes);

  if (!opcoes.soColeta) {
    await descobrir(opcoes, arquivos, estado);
    if (opcoes.soDescoberta) {
      const total = (await lerNdjson(arquivos.prestadores)).length;
      registrar(`Descoberta concluída: ${total} prestadores em cache.`);
      return;
    }
  }

  await coletar(opcoes, arquivos);
  await exportar(opcoes, arquivos);
  registrar(`Tempo total: ${Math.round((Date.now() - inicio) / 1000)}s`);
}

principal().catch((erro) => {
  registrar(`erro: ${erro.stack || erro.message}`);
  process.exitCode = 1;
});
