/**
 * Teste de integração do coletor do DivulgaSPCA. Sobe um servidor de mentira
 * que imita as manias da API do TSE (windows-1252 no corpo, 500 com "{}" para
 * prestador inexistente, 503 transitório, ranking paginado de 100 em 100) e
 * roda o CLI de verdade contra ele.
 *
 * Vale o incômodo de um child_process: os erros que doem neste coletor não
 * estão nas funções puras, estão na costura entre descoberta, retomada e
 * exportação.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const pastaScripts = dirname(fileURLToPath(import.meta.url));
const cli = join(pastaScripts, 'scrape-spca-donors.mjs');

const PARTIDOS = [
  { numero: 13, sigla: 'PT', nome: 'PARTIDO DOS TRABALHADORES' },
  { numero: 99, sigla: 'FANTASMA', nome: 'PARTIDO SEM PRESTACAO' },
];
const UNIDADES = [{ codigoUE: '71072', nome: 'SÃO PAULO' }, { codigoUE: '61018', nome: 'ADAMANTINA' }];
const DOADORES = Array.from({ length: 150 }, (_, i) => ({
  cpfCnpjDoador: String(65175484320 + i),
  nomeRazaoDoador: `DOADOR ${i} JOSÉ AÇÃO`,
  quantidadeTotal: 2,
  valorTotalReceita: 100 + i,
  porcentagem: 1,
}));
const TOTAL_NACIONAL = DOADORES.reduce((s, d) => s + d.valorTotalReceita, 0);
const TOTAL_ESTADUAL = DOADORES.slice(0, 2).reduce((s, d) => s + d.valorTotalReceita, 0);
const RENDIMENTOS = 12345.67;

const doadoresDe = (codigo) => (codigo === 123 ? DOADORES : (codigo === 232 ? DOADORES.slice(0, 2) : []));
const totalDe = (codigo) => ({
  123: TOTAL_NACIONAL + RENDIMENTOS,
  232: TOTAL_ESTADUAL,
}[codigo] || 0);

function responder(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(Buffer.from(JSON.stringify(corpo), 'latin1'));
}

function criarMock() {
  let jaFalhou = false;
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rota = url.pathname.replace(/^\/rest/, '');

    if (rota === '/partidos/2026/BR' || rota === '/partidos/2026/SP') return responder(res, 200, PARTIDOS);
    if (rota === '/unidades-eleitorais/SP') return responder(res, 200, UNIDADES);

    if (rota === '/2026/prestador-contas/nacional/13') {
      if (!jaFalhou) { jaFalhou = true; return responder(res, 503, {}); }
      return responder(res, 200, {
        codigoPrestador: 123, cnpj: '00676262000170', esfera: 'Nacional',
        partido: PARTIDOS[0], estado: { sigla: 'BR', nome: 'NACIONAL' }, situacaoPrestacao: 'Aberta',
      });
    }
    if (rota === '/2026/prestador-contas/estadual/SP/13') {
      return responder(res, 200, {
        codigoPrestador: 232, cnpj: '07794600000118', esfera: 'Estadual',
        partido: PARTIDOS[0], estado: { sigla: 'SP', nome: 'SÃO PAULO' }, situacaoPrestacao: 'Aberta',
      });
    }
    if (rota === '/2026/prestador-contas/estadual/SP/99') {
      return responder(res, 200, {
        cnpj: '11111111000111', esfera: 'Estadual', partido: PARTIDOS[1], estado: { sigla: 'SP', nome: 'SÃO PAULO' },
      });
    }
    if (rota === '/2026/prestador-contas/municipal/SP/71072/13') {
      return responder(res, 200, {
        codigoPrestador: 234, cnpj: '09066506000178', esfera: 'Municipal', partido: PARTIDOS[0],
        estado: { sigla: 'SP', nome: 'SÃO PAULO' }, localidade: { codigoUE: '71072', nome: 'SÃO PAULO' },
        situacaoPrestacao: 'Aberta',
      });
    }
    if (rota.startsWith('/2026/prestador-contas/')) return responder(res, 500, {});

    if (rota.match(/^\/2026\/\d+\/prestador-divulgacao\/totalizadores$/)) {
      const codigo = Number(rota.split('/')[2]);
      return responder(res, 200, {
        codigoPrestador: codigo,
        valorTotalReceita: totalDe(codigo),
        // Rendimentos de aplicação não entram no detalhamento de receitas:
        // é a diferença que o coletor precisa descontar antes de reclamar.
        valorReceitaRendimentosAplicacoesFinanceiras: codigo === 123 ? RENDIMENTOS : 0,
        valorReceitaOutrasReceitas: 0,
      });
    }

    const receitas = rota.match(/^\/2026\/(\d+)\/receitas\/(.+)$/);
    if (receitas) {
      const codigo = Number(receitas[1]);
      const caminho = receitas[2];
      if (caminho === 'total-receitas') {
        return responder(res, 200, { codigoPrestador: codigo, exercicio: 2026, totalReceita: totalDe(codigo) });
      }
      if (caminho === 'ranking') {
        const lista = doadoresDe(codigo);
        // A instabilidade do TSE, de propósito: sob vrReceita o servidor
        // "perde" um doador a cada sete, e só a outra ordenação traz todos.
        const ordenacao = url.searchParams.get('sort') || '';
        const efetiva = ordenacao.startsWith('vrReceita')
          ? lista.filter((_, i) => i % 7 !== 3)
          : lista;
        const pagina = Number(url.searchParams.get('page') || 0);
        const tamanho = Number(url.searchParams.get('size') || 100);
        return responder(res, 200, {
          content: efetiva.slice(pagina * tamanho, (pagina + 1) * tamanho),
          totalElements: efetiva.length,
          last: (pagina + 1) * tamanho >= efetiva.length,
        });
      }
      if (caminho.startsWith('detalhe/')) {
        const documento = caminho.slice('detalhe/'.length);
        const doador = DOADORES.find((d) => d.cpfCnpjDoador === documento);
        if (!doador) return responder(res, 200, []);
        return responder(res, 200, [0, 1].map((i) => ({
          sqOrigemRecurso: Number(documento) + i,
          dataEntrada: `2026-0${i + 1}-15`,
          nomeRazaoDoador: doador.nomeRazaoDoador,
          nomeRazaoDoadorReceita: doador.nomeRazaoDoador,
          cpfCnpjDoador: documento,
          especieRecurso: 'Transferência eletrônica',
          fonteRecurso: 'Outros Recursos',
          classificacaoReceita: 'CONTRIBUIÇÕES - De filiados',
          numeroDocumento: '1',
          reciboDoacao: '-',
          naturezaRecurso: 'Financeiro',
          valorReceita: doador.valorTotalReceita / 2,
          doadoresOriginarios: [{}],
          listaArquivos: [],
        })));
      }
    }
    return responder(res, 503, {});
  });
}

describe('coletor do DivulgaSPCA de ponta a ponta', () => {
  let servidor;
  let base;
  let pasta;

  before(async () => {
    servidor = criarMock();
    await new Promise((pronto) => { servidor.listen(0, '127.0.0.1', pronto); });
    base = `http://127.0.0.1:${servidor.address().port}/rest`;
    pasta = mkdtempSync(join(tmpdir(), 'spca-'));
  });

  after(() => {
    servidor.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  const rodar = (args) => new Promise((resolve) => {
    const filho = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, SPCA_API_BASE: base },
    });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.on('close', (codigo) => resolve({ codigo, saida }));
  });

  const arquivo = (nome, sub = 'colheita') => readFileSync(join(pasta, sub, '2026', nome), 'utf8');
  const linhas = (nome, sub) => arquivo(nome, sub).trim().split('\n');

  it('descobre, coleta, reconcilia e exporta numa corrida só', async () => {
    const { codigo, saida } = await rodar(['--saida', join(pasta, 'colheita'), '--ufs', 'SP', '--concorrencia', '4']);
    assert.equal(codigo, 0, saida);

    const prestadores = linhas('prestadores.ndjson').map((l) => JSON.parse(l));
    assert.equal(prestadores.length, 3);
    assert.deepEqual(prestadores.map((p) => p.esfera).sort(), ['estadual', 'municipal', 'nacional']);
    assert.ok(
      !prestadores.some((p) => p.siglaPartido === 'FANTASMA'),
      'diretório sem codigoPrestador não pode entrar no cache',
    );
    assert.equal(
      prestadores.find((p) => p.esfera === 'municipal').municipio,
      'SÃO PAULO',
      'o acento tem que sobreviver ao windows-1252',
    );

    const resumo = JSON.parse(arquivo('resumo.json'));
    assert.equal(resumo.doadores, 152, '150 no nacional e 2 no estadual');
    assert.equal(resumo.lancamentos, 304, 'dois lançamentos por doador');
    assert.equal(resumo.prestadores_com_receita, 2, 'o municipal está zerado e fica de fora');
    assert.equal(resumo.prestadores_com_divergencia, 0, 'a soma do detalhe fecha com o ranking');
    assert.equal(
      resumo.prestadores_com_ranking_incompleto, 0,
      'unir as duas ordenações tem que recuperar os doadores que uma delas esconde',
    );
    assert.ok(resumo.repeticoes >= 1, 'o 503 transitório tinha que ter sido repetido');

    const doadoresCsv = arquivo('doadores.csv');
    assert.ok(
      doadoresCsv.includes('DOADOR 3 JOSÉ AÇÃO'),
      'o doador que a ordenação por valor esconde precisa aparecer mesmo assim',
    );

    const csv = linhas('doacoes.csv');
    assert.equal(csv.length, 305, 'cabeçalho mais um lançamento por linha');
    assert.ok(csv.some((l) => l.includes('JOSÉ AÇÃO')));
    assert.ok(csv.some((l) => l.includes('2026-01-15')), 'a data precisa chegar ao CSV');
  });

  it('retoma sem recoletar nem duplicar', async () => {
    const { codigo, saida } = await rodar(['--saida', join(pasta, 'colheita'), '--ufs', 'SP']);
    assert.equal(codigo, 0, saida);
    assert.equal(linhas('doacoes.ndjson').length, 304);
    assert.equal(linhas('prestadores.ndjson').length, 3);
    assert.match(saida, /0 prestadores pendentes/);
  });

  it('mascara o CPF e sabe parar no agregado', async () => {
    const { codigo, saida } = await rodar([
      '--saida', join(pasta, 'mascarada'), '--ufs', 'SP', '--mascarar-cpf', '--sem-detalhe',
    ]);
    assert.equal(codigo, 0, saida);
    const doadores = arquivo('doadores.csv', 'mascarada');
    assert.ok(doadores.includes('***.'));
    assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(doadores), 'nenhum CPF inteiro pode sobrar');
    assert.equal(JSON.parse(arquivo('resumo.json', 'mascarada')).lancamentos, 0);
  });
});
