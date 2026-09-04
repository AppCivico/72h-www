import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cabecalhoCsv, celulaCsv, comLimite, decodificarCorpo, extrairDoadorOriginario,
  formatarDocumento, lerJson, linhaCsv, mascararDocumento, normalizarAgregado,
  normalizarPrestador, normalizarReceita, parseArgs, prestadorColetavel, tipoDocumento,
  urlDetalhe, urlPartidos, urlPrestador, urlRanking, urlTotalReceitas, urlUnidadesEleitorais,
  COLUNAS_DOACOES, ORDENACOES_RANKING, receitaEsperadaNoRanking,
} from './spcaDonors.mjs';

const RAIZ = 'https://prestcontasanualex.tse.jus.br/divulga-spca/rest';

describe('URLs', () => {
  it('monta a lista de partidos, com BR para os nacionais', () => {
    assert.equal(urlPartidos(2026), `${RAIZ}/partidos/2026/BR`);
    assert.equal(urlPartidos(2026, 'SP'), `${RAIZ}/partidos/2026/SP`);
  });

  it('monta a lista de unidades eleitorais', () => {
    assert.equal(urlUnidadesEleitorais('SP'), `${RAIZ}/unidades-eleitorais/SP`);
  });

  it('monta o prestador nas três esferas', () => {
    assert.equal(
      urlPrestador(2026, 'nacional', { numeroPartido: 13 }),
      `${RAIZ}/2026/prestador-contas/nacional/13`,
    );
    assert.equal(
      urlPrestador(2026, 'estadual', { uf: 'SP', numeroPartido: 10 }),
      `${RAIZ}/2026/prestador-contas/estadual/SP/10`,
    );
    assert.equal(
      urlPrestador(2026, 'municipal', { uf: 'SP', codigoUE: '71072', numeroPartido: 10 }),
      `${RAIZ}/2026/prestador-contas/municipal/SP/71072/10`,
    );
  });

  it('recusa esfera desconhecida e parâmetro faltando', () => {
    assert.throws(() => urlPrestador(2026, 'regional', { numeroPartido: 13 }), /esfera desconhecida/);
    assert.throws(() => urlPrestador(2026, 'estadual', { numeroPartido: 13 }), /uf é obrigatório/);
  });

  it('limita o tamanho da página ao teto de 100 que a API impõe', () => {
    assert.equal(
      urlRanking(2026, 123, { pagina: 2, tamanho: 5000 }),
      `${RAIZ}/2026/123/receitas/ranking?page=2&size=100&sort=vrReceita,desc`,
    );
  });

  it('aceita outra ordenação, que é como se recuperam os doadores perdidos', () => {
    assert.ok(ORDENACOES_RANKING.length >= 2, 'uma ordenação só perde doadores em empates de valor');
    assert.equal(
      urlRanking(2026, 123, { ordenacao: 'nmDoador,asc' }),
      `${RAIZ}/2026/123/receitas/ranking?page=0&size=100&sort=nmDoador,asc`,
    );
  });

  it('monta total de receitas e detalhe por documento', () => {
    assert.equal(urlTotalReceitas(2026, 123), `${RAIZ}/2026/123/receitas/total-receitas`);
    assert.equal(urlDetalhe(2026, 123, '65175484320'), `${RAIZ}/2026/123/receitas/detalhe/65175484320`);
  });
});

describe('decodificação', () => {
  it('lê windows-1252, que é o que a API devolve', () => {
    // "PARTIDO DEMOCRÁTICO" com o Á em 0xC1, como vem do TSE.
    const bytes = new Uint8Array([0x44, 0x45, 0x4d, 0x4f, 0x43, 0x52, 0xc1, 0x54, 0x49, 0x43, 0x4f]);
    assert.equal(decodificarCorpo(bytes), 'DEMOCRÁTICO');
  });

  it('devolve null para corpo vazio', () => {
    assert.equal(lerJson(new Uint8Array([])), null);
  });
});

describe('documentos', () => {
  it('separa pessoa física de jurídica pelo tamanho', () => {
    assert.equal(tipoDocumento('65175484320'), 'PF');
    assert.equal(tipoDocumento('00509018000113'), 'PJ');
    assert.equal(tipoDocumento('123'), 'INDEFINIDO');
  });

  it('formata CPF e CNPJ', () => {
    assert.equal(formatarDocumento('65175484320'), '651.754.843-20');
    assert.equal(formatarDocumento('00509018000113'), '00.509.018/0001-13');
  });

  it('mascara CPF preservando o miolo e deixa CNPJ inteiro', () => {
    assert.equal(mascararDocumento('65175484320'), '***.754.843-**');
    assert.equal(mascararDocumento('00509018000113'), '00.509.018/0001-13');
  });
});

describe('normalização do prestador', () => {
  const municipal = {
    codigoPrestador: 234,
    cnpj: '09066506000178',
    esfera: 'Municipal',
    partido: { numero: 10, sigla: 'REPUBLICANOS', nome: 'REPUBLICANOS' },
    estado: { sigla: 'SP', nome: 'SÃO PAULO' },
    localidade: { codigoUE: '71072', nome: 'SÃO PAULO' },
    dataAtualizacao: '22/07/2026 05:00:00',
    situacaoPrestacao: 'Aberta',
  };

  it('achata o município e a esfera', () => {
    const p = normalizarPrestador(municipal, { esfera: 'municipal', uf: 'SP', codigoUE: '71072' });
    assert.equal(p.esfera, 'municipal');
    assert.equal(p.municipio, 'SÃO PAULO');
    assert.equal(p.codigoUE, '71072');
    assert.equal(p.siglaPartido, 'REPUBLICANOS');
    assert.equal(p.codigoPrestador, 234);
  });

  it('deixa município nulo fora da esfera municipal', () => {
    const estadual = { ...municipal, esfera: 'Estadual', localidade: undefined };
    const p = normalizarPrestador(estadual, { esfera: 'estadual', uf: 'SP' });
    assert.equal(p.municipio, null);
  });

  it('marca como não coletável o diretório que nunca abriu a prestação', () => {
    const semCodigo = { ...municipal, codigoPrestador: undefined };
    assert.equal(prestadorColetavel(normalizarPrestador(semCodigo, { esfera: 'municipal', uf: 'SP' })), false);
    assert.equal(prestadorColetavel(normalizarPrestador(municipal, { esfera: 'municipal', uf: 'SP' })), true);
  });
});

describe('doador originário', () => {
  it('trata [{}] como ausência', () => {
    assert.deepEqual(extrairDoadorOriginario([{}]), { nome: null, documento: null, valor: null });
    assert.deepEqual(extrairDoadorOriginario(undefined), { nome: null, documento: null, valor: null });
  });

  it('acha os campos por forma, não por nome exato', () => {
    const achado = extrairDoadorOriginario([
      { nomeDoadorOriginario: 'FULANO', cpfDoadorOriginario: '65175484320', valorDoacaoOriginaria: 10.5 },
    ]);
    assert.equal(achado.nome, 'FULANO');
    assert.equal(achado.documento, '65175484320');
    assert.equal(achado.valor, 10.5);
  });
});

describe('normalização da receita', () => {
  const prestador = {
    exercicio: 2026,
    esfera: 'nacional',
    uf: 'BR',
    municipio: null,
    codigoUE: null,
    numeroPartido: 13,
    siglaPartido: 'PT',
    nomePartido: 'PARTIDO DOS TRABALHADORES',
    cnpjPrestador: '00676262000170',
    codigoPrestador: 123,
  };
  const receita = {
    sqOrigemRecurso: 5190047,
    dataEntrada: '2026-02-25',
    nomeRazaoDoador: 'FLAVIO RODRIGUES NOGUEIRA JUNIOR',
    nomeRazaoDoadorReceita: 'FLAVIO RODRIGUES NOGUEIRA JUNIOR',
    cpfCnpjDoador: '65175484320',
    especieRecurso: 'Transferência eletrônica',
    fonteRecurso: 'Outros Recursos',
    classificacaoReceita: 'CONTRIBUIÇÕES - De parlamentares',
    numeroDocumento: '1059280',
    reciboDoacao: 'P13000200000BR1059280',
    naturezaRecurso: 'Financeiro',
    valorReceita: 136498.31,
    doadoresOriginarios: [{}],
  };

  it('guarda doador, valor e data, que é o que a página pede', () => {
    const linha = normalizarReceita(receita, prestador);
    assert.equal(linha.doador_nome, 'FLAVIO RODRIGUES NOGUEIRA JUNIOR');
    assert.equal(linha.valor, 136498.31);
    assert.equal(linha.data, '2026-02-25');
    assert.equal(linha.partido_sigla, 'PT');
    assert.equal(linha.doador_documento, '651.754.843-20');
    assert.equal(linha.doador_tipo, 'PF');
  });

  it('mascara o CPF quando pedido, sem tocar no CNPJ', () => {
    const pf = normalizarReceita(receita, prestador, { mascararCpf: true });
    assert.equal(pf.doador_documento, '***.754.843-**');
    const pj = normalizarReceita(
      { ...receita, cpfCnpjDoador: '00509018000113' }, prestador, { mascararCpf: true },
    );
    assert.equal(pj.doador_documento, '00.509.018/0001-13');
  });

  it('trata o recibo "-" do Fundo Partidário como ausente', () => {
    const linha = normalizarReceita({ ...receita, reciboDoacao: '-' }, prestador);
    assert.equal(linha.recibo, null);
  });

  it('cobre todas as colunas do CSV', () => {
    const linha = normalizarReceita(receita, prestador);
    for (const coluna of COLUNAS_DOACOES) {
      assert.ok(coluna in linha, `coluna ausente na normalização: ${coluna}`);
    }
  });
});

describe('agregado por doador', () => {
  it('preserva quantidade e valor total vindos do ranking', () => {
    const linha = normalizarAgregado(
      {
        nomeRazaoDoador: 'TRIBUNAL SUPERIOR ELEITORAL',
        cpfCnpjDoador: '00509018000113',
        quantidadeTotal: 12,
        valorTotalReceita: 54826195.48,
        porcentagem: 96.28,
      },
      { exercicio: 2026, esfera: 'nacional', uf: 'BR', municipio: null, numeroPartido: 13, siglaPartido: 'PT', codigoPrestador: 123 },
    );
    assert.equal(linha.quantidade_doacoes, 12);
    assert.equal(linha.valor_total, 54826195.48);
    assert.equal(linha.doador_tipo, 'PJ');
  });
});

describe('CSV', () => {
  it('escapa aspas, vírgulas e quebras de linha', () => {
    assert.equal(celulaCsv('ACME, LTDA'), '"ACME, LTDA"');
    assert.equal(celulaCsv('diz "oi"'), '"diz ""oi"""');
    assert.equal(celulaCsv(null), '');
    assert.equal(celulaCsv(0), '0');
  });

  it('escreve a linha na ordem do cabeçalho', () => {
    const colunas = ['a', 'b', 'c'];
    assert.equal(cabecalhoCsv(colunas), 'a,b,c');
    assert.equal(linhaCsv({ c: 3, a: 1 }, colunas), '1,,3');
  });
});

describe('pool de concorrência', () => {
  it('respeita o limite e devolve na ordem de entrada', async () => {
    let emVoo = 0;
    let pico = 0;
    const resultado = await comLimite([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => { setTimeout(r, 5); });
      emVoo -= 1;
      return n * 2;
    });
    assert.deepEqual(resultado, [2, 4, 6, 8, 10, 12, 14]);
    assert.ok(pico <= 3, `pico de ${pico} passou do limite`);
  });

  it('aceita lista vazia', async () => {
    assert.deepEqual(await comLimite([], 4, async () => 1), []);
  });
});

describe('argumentos', () => {
  it('usa os padrões quando não recebe nada', () => {
    const o = parseArgs([]);
    assert.equal(o.exercicio, 2026);
    assert.equal(o.ufs.length, 27);
    assert.deepEqual(o.esferas, ['nacional', 'estadual', 'municipal']);
  });

  it('aceita --chave valor e --chave=valor', () => {
    assert.equal(parseArgs(['--exercicio', '2022']).exercicio, 2022);
    assert.equal(parseArgs(['--exercicio=2022']).exercicio, 2022);
  });

  it('normaliza listas de UF e esfera', () => {
    const o = parseArgs(['--ufs', 'sp, rj', '--esferas', 'Nacional']);
    assert.deepEqual(o.ufs, ['SP', 'RJ']);
    assert.deepEqual(o.esferas, ['nacional']);
  });

  it('recusa entrada inválida em vez de varrer o país por engano', () => {
    assert.throws(() => parseArgs(['--ufs', 'XX']), /UF desconhecida/);
    assert.throws(() => parseArgs(['--esferas', 'galactica']), /esfera desconhecida/);
    assert.throws(() => parseArgs(['--exercicio', '1500']), /exercício inválido/);
    assert.throws(() => parseArgs(['--turbo']), /opção desconhecida/);
  });
});

describe('receita esperada no ranking', () => {
  it('desconta rendimentos e outras receitas, que o detalhamento não inclui', () => {
    assert.equal(receitaEsperadaNoRanking({
      valorTotalReceita: 77698227.05,
      valorReceitaRendimentosAplicacoesFinanceiras: 9464211.23,
      valorReceitaOutrasReceitas: 1214.58,
    }), 68232801.24);
  });

  it('sem rendimentos, o esperado é o total', () => {
    assert.equal(receitaEsperadaNoRanking({ valorTotalReceita: 100 }), 100);
    assert.equal(receitaEsperadaNoRanking(null), null);
  });
});
