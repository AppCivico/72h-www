/**
 * Peças puras do coletor de doações aos diretórios partidários (DivulgaSPCA).
 *
 * O DivulgaSPCA é o outro sistema do TSE: enquanto o DivulgaCandContas
 * mostra o dinheiro que vai para as CANDIDATURAS, este mostra o dinheiro
 * que entra nos DIRETÓRIOS dos partidos, na prestação de contas anual.
 * No ano da eleição a prestação fica aberta e o TSE republica os dados
 * todo dia de madrugada, então dá para acompanhar em quase tempo real.
 *
 * A API não é documentada. O contrato abaixo foi levantado observando o
 * tráfego do próprio site em 04/09/2026:
 *
 *   GET /rest/partidos/{exercicio}/{uf}            lista de partidos (uf=BR: nacionais)
 *   GET /rest/unidades-eleitorais/{uf}             municípios e zonas da UF
 *   GET /rest/{ex}/prestador-contas/nacional/{numeroPartido}
 *   GET /rest/{ex}/prestador-contas/estadual/{uf}/{numeroPartido}
 *   GET /rest/{ex}/prestador-contas/municipal/{uf}/{codigoUE}/{numeroPartido}
 *   GET /rest/{ex}/{codPrestador}/receitas/total-receitas
 *   GET /rest/{ex}/{codPrestador}/receitas/ranking?page=&size=&sort=
 *   GET /rest/{ex}/{codPrestador}/receitas/detalhe/{cpfCnpj}
 *
 * Três armadilhas que o código abaixo trata:
 *
 * 1. As respostas vêm em windows-1252, não em UTF-8. Ler com response.json()
 *    devolve "DEMOCR�TICA". Por isso tudo passa por decodificarCorpo.
 * 2. O ranking agrega por doador e vem SEM data. A data só existe no
 *    detalhe, uma chamada por doador. Não há endpoint em massa: qualquer
 *    caminho sob /receitas/ que não seja ranking ou detalhe devolve [].
 * 3. Prestador inexistente responde 500 com corpo "{}", não 404. E 503 é
 *    o que a API devolve quando a ROTA não casa, então 503 costuma ser bug
 *    nosso de montagem de URL, não indisponibilidade.
 */

// SPCA_API_BASE existe para apontar o coletor inteiro para um servidor de
// mentira nos testes de integração. Em uso normal fica vazia.
export const API_BASE = process.env.SPCA_API_BASE
  || 'https://prestcontasanualex.tse.jus.br/divulga-spca/rest';

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

export const ESFERAS = ['nacional', 'estadual', 'municipal'];

// A API corta qualquer size acima disso e devolve 100 por página.
export const TAMANHO_MAXIMO_PAGINA = 100;

/**
 * Duas ordenações, não uma. A paginação do ranking é instável: a ordenação
 * por valor tem muitos empates e o banco devolve os empatados em ordem
 * arbitrária a cada requisição, então páginas se sobrepõem e outras somem.
 * Paginar só por vrReceita no PT nacional trouxe 5.138 doadores de 6.257 e
 * perdeu R$ 47 mil. Varrer as duas ordenações e unir por documento fechou
 * no centavo. Ordenações válidas conhecidas: vrReceita e nmDoador.
 */
export const ORDENACOES_RANKING = ['vrReceita,desc', 'nmDoador,asc'];

/* ------------------------------------------------------------------ URLs */

function exigir(valor, nome) {
  if (valor === undefined || valor === null || valor === '') {
    throw new Error(`spcaDonors: ${nome} é obrigatório`);
  }
  return valor;
}

export function urlPartidos(exercicio, uf = 'BR') {
  return `${API_BASE}/partidos/${exigir(exercicio, 'exercicio')}/${exigir(uf, 'uf')}`;
}

export function urlUnidadesEleitorais(uf) {
  return `${API_BASE}/unidades-eleitorais/${exigir(uf, 'uf')}`;
}

export function urlPrestador(exercicio, esfera, { uf, codigoUE, numeroPartido } = {}) {
  exigir(exercicio, 'exercicio');
  exigir(numeroPartido, 'numeroPartido');
  const raiz = `${API_BASE}/${exercicio}/prestador-contas`;
  if (esfera === 'nacional') return `${raiz}/nacional/${numeroPartido}`;
  if (esfera === 'estadual') return `${raiz}/estadual/${exigir(uf, 'uf')}/${numeroPartido}`;
  if (esfera === 'municipal') {
    return `${raiz}/municipal/${exigir(uf, 'uf')}/${exigir(codigoUE, 'codigoUE')}/${numeroPartido}`;
  }
  throw new Error(`spcaDonors: esfera desconhecida "${esfera}"`);
}

export function urlTotalReceitas(exercicio, codigoPrestador) {
  return `${API_BASE}/${exigir(exercicio, 'exercicio')}/${exigir(codigoPrestador, 'codigoPrestador')}/receitas/total-receitas`;
}

export function urlTotalizadores(exercicio, codigoPrestador) {
  return `${API_BASE}/${exigir(exercicio, 'exercicio')}/${exigir(codigoPrestador, 'codigoPrestador')}/prestador-divulgacao/totalizadores`;
}

export function urlRanking(exercicio, codigoPrestador, {
  pagina = 0, tamanho = TAMANHO_MAXIMO_PAGINA, ordenacao = ORDENACOES_RANKING[0],
} = {}) {
  exigir(exercicio, 'exercicio');
  exigir(codigoPrestador, 'codigoPrestador');
  const size = Math.min(tamanho, TAMANHO_MAXIMO_PAGINA);
  return `${API_BASE}/${exercicio}/${codigoPrestador}/receitas/ranking?page=${pagina}&size=${size}&sort=${ordenacao}`;
}

export function urlDetalhe(exercicio, codigoPrestador, documento) {
  exigir(exercicio, 'exercicio');
  exigir(codigoPrestador, 'codigoPrestador');
  return `${API_BASE}/${exercicio}/${codigoPrestador}/receitas/detalhe/${encodeURIComponent(exigir(documento, 'documento'))}`;
}

/* ------------------------------------------------------------ decodificação */

const decodificador = new TextDecoder('windows-1252');

export function decodificarCorpo(buffer) {
  return decodificador.decode(buffer);
}

export function lerJson(buffer) {
  const texto = decodificarCorpo(buffer).trim();
  if (!texto) return null;
  return JSON.parse(texto);
}

/* ---------------------------------------------------------------- documentos */

export function apenasDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

export function tipoDocumento(valor) {
  const digitos = apenasDigitos(valor);
  if (digitos.length === 11) return 'PF';
  if (digitos.length === 14) return 'PJ';
  return 'INDEFINIDO';
}

export function formatarDocumento(valor) {
  const d = apenasDigitos(valor);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

/**
 * O TSE publica o CPF inteiro de quem doa a partido. Nós não precisamos
 * repetir isso: mascarar preserva o miolo, que basta para cruzar o mesmo
 * doador entre partidos, e descarta o que identifica a pessoa sozinho.
 */
export function mascararDocumento(valor) {
  const d = apenasDigitos(valor);
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  return formatarDocumento(d);
}

/* -------------------------------------------------------------- normalização */

export function normalizarPrestador(json, { esfera, uf, codigoUE, numeroPartido } = {}) {
  if (!json || typeof json !== 'object') return null;
  const codigoPrestador = json.codigoPrestador ?? null;
  const partido = json.partido || {};
  const localidade = json.localidade || {};
  return {
    esfera: (json.esfera || esfera || '').toLowerCase(),
    uf: uf || json.estado?.sigla || null,
    codigoUE: localidade.codigoUE || codigoUE || null,
    municipio: esfera === 'municipal' ? (localidade.nome || json.estado?.nome || null) : null,
    numeroPartido: partido.numero ?? numeroPartido ?? null,
    siglaPartido: partido.sigla || null,
    nomePartido: partido.nome || null,
    cnpjPrestador: json.cnpj || null,
    codigoPrestador,
    situacao: json.situacaoPrestacao || null,
    atualizadoEm: json.dataAtualizacao || null,
  };
}

/**
 * Um prestador só é coletável quando tem codigoPrestador. Diretório que
 * nunca abriu a prestação responde 200 sem esse campo.
 */
export function prestadorColetavel(prestador) {
  return Boolean(prestador && prestador.codigoPrestador);
}

/**
 * doadoresOriginarios vem como [{}] quando não há nenhum, e o TSE não
 * documenta as chaves. Em vez de apostar num nome, procuramos por forma.
 */
export function extrairDoadorOriginario(lista) {
  const entradas = (Array.isArray(lista) ? lista : []).filter((o) => o && Object.keys(o).length > 0);
  if (entradas.length === 0) return { nome: null, documento: null, valor: null };
  const bruto = entradas[0];
  const acharPor = (regex, tipo) => {
    const chave = Object.keys(bruto).find((k) => regex.test(k) && (tipo ? typeof bruto[k] === tipo : true));
    return chave ? bruto[chave] : null;
  };
  return {
    nome: acharPor(/nome|razao/i, 'string'),
    documento: acharPor(/cpf|cnpj|documento/i),
    valor: acharPor(/valor/i, 'number'),
  };
}

export function normalizarReceita(receita, prestador, { mascararCpf = false } = {}) {
  const documento = apenasDigitos(receita.cpfCnpjDoador);
  const originario = extrairDoadorOriginario(receita.doadoresOriginarios);
  const mostrar = (doc) => (mascararCpf && tipoDocumento(doc) === 'PF'
    ? mascararDocumento(doc)
    : formatarDocumento(doc));
  return {
    exercicio: prestador.exercicio,
    esfera: prestador.esfera,
    uf: prestador.uf,
    municipio: prestador.municipio,
    codigo_ue: prestador.codigoUE,
    partido_numero: prestador.numeroPartido,
    partido_sigla: prestador.siglaPartido,
    partido_nome: prestador.nomePartido,
    cnpj_prestador: formatarDocumento(prestador.cnpjPrestador),
    codigo_prestador: prestador.codigoPrestador,
    doador_nome: receita.nomeRazaoDoador || null,
    doador_nome_receita_federal: receita.nomeRazaoDoadorReceita || null,
    doador_documento: mostrar(documento),
    doador_tipo: tipoDocumento(documento),
    data: receita.dataEntrada || null,
    valor: receita.valorReceita ?? null,
    natureza: receita.naturezaRecurso || null,
    especie: receita.especieRecurso || null,
    fonte: receita.fonteRecurso || null,
    classificacao: receita.classificacaoReceita || null,
    numero_documento: receita.numeroDocumento || null,
    recibo: receita.reciboDoacao && receita.reciboDoacao !== '-' ? receita.reciboDoacao : null,
    doador_originario_nome: originario.nome,
    doador_originario_documento: originario.documento ? mostrar(originario.documento) : null,
    doador_originario_valor: originario.valor,
    sq_origem_recurso: receita.sqOrigemRecurso ?? null,
  };
}

export function normalizarAgregado(item, prestador, { mascararCpf = false } = {}) {
  const documento = apenasDigitos(item.cpfCnpjDoador);
  return {
    exercicio: prestador.exercicio,
    esfera: prestador.esfera,
    uf: prestador.uf,
    municipio: prestador.municipio,
    partido_numero: prestador.numeroPartido,
    partido_sigla: prestador.siglaPartido,
    codigo_prestador: prestador.codigoPrestador,
    doador_nome: item.nomeRazaoDoador || null,
    doador_documento: mascararCpf && tipoDocumento(documento) === 'PF'
      ? mascararDocumento(documento)
      : formatarDocumento(documento),
    doador_tipo: tipoDocumento(documento),
    quantidade_doacoes: item.quantidadeTotal ?? null,
    valor_total: item.valorTotalReceita ?? null,
    percentual_do_prestador: item.porcentagem ?? null,
  };
}

/* ---------------------------------------------------------------------- CSV */

export const COLUNAS_DOACOES = [
  'exercicio', 'esfera', 'uf', 'municipio', 'codigo_ue',
  'partido_numero', 'partido_sigla', 'partido_nome',
  'cnpj_prestador', 'codigo_prestador',
  'doador_nome', 'doador_nome_receita_federal', 'doador_documento', 'doador_tipo',
  'data', 'valor', 'natureza', 'especie', 'fonte', 'classificacao',
  'numero_documento', 'recibo',
  'doador_originario_nome', 'doador_originario_documento', 'doador_originario_valor',
  'sq_origem_recurso',
];

export const COLUNAS_DOADORES = [
  'exercicio', 'esfera', 'uf', 'municipio',
  'partido_numero', 'partido_sigla', 'codigo_prestador',
  'doador_nome', 'doador_documento', 'doador_tipo',
  'quantidade_doacoes', 'valor_total', 'percentual_do_prestador',
];

export function celulaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function linhaCsv(registro, colunas) {
  return colunas.map((coluna) => celulaCsv(registro[coluna])).join(',');
}

export function cabecalhoCsv(colunas) {
  return colunas.join(',');
}

/* --------------------------------------------------------------- concorrência */

/**
 * Pool de tamanho fixo que preserva a ordem dos resultados. Sem dependência
 * externa de propósito: este script precisa rodar num clone limpo do repo.
 */
export async function comLimite(itens, limite, tarefa) {
  const lista = [...itens];
  const resultados = new Array(lista.length);
  let proximo = 0;
  const trabalhador = async () => {
    for (;;) {
      const indice = proximo;
      proximo += 1;
      if (indice >= lista.length) return;
      resultados[indice] = await tarefa(lista[indice], indice);
    }
  };
  const trabalhadores = Array.from(
    { length: Math.max(1, Math.min(limite, lista.length)) },
    () => trabalhador(),
  );
  await Promise.all(trabalhadores);
  return resultados;
}

/* ------------------------------------------------------------------ argumentos */

export const PADROES = {
  exercicio: 2026,
  esferas: ['nacional', 'estadual', 'municipal'],
  ufs: UFS,
  saida: 'spca-out',
  concorrencia: 8,
  tentativas: 4,
  mascararCpf: false,
  semDetalhe: false,
  soDescoberta: false,
  soColeta: false,
  soExportar: false,
  atualizar: false,
  painel: null,
  recomecar: false,
  minReceita: 0,
};

export function parseArgs(argv) {
  const opcoes = { ...PADROES, esferas: [...PADROES.esferas], ufs: [...PADROES.ufs] };
  const lista = [...argv];
  const listaDe = (valor) => String(valor).split(',').map((x) => x.trim()).filter(Boolean);
  while (lista.length > 0) {
    const arg = lista.shift();
    const [chave, embutido] = arg.split('=');
    const valor = () => (embutido !== undefined ? embutido : lista.shift());
    switch (chave) {
      case '--exercicio': opcoes.exercicio = Number(valor()); break;
      case '--esferas': opcoes.esferas = listaDe(valor()).map((e) => e.toLowerCase()); break;
      case '--ufs': opcoes.ufs = listaDe(valor()).map((u) => u.toUpperCase()); break;
      case '--saida': opcoes.saida = valor(); break;
      case '--concorrencia': opcoes.concorrencia = Number(valor()); break;
      case '--tentativas': opcoes.tentativas = Number(valor()); break;
      case '--min-receita': opcoes.minReceita = Number(valor()); break;
      case '--mascarar-cpf': opcoes.mascararCpf = true; break;
      case '--sem-detalhe': opcoes.semDetalhe = true; break;
      case '--so-descoberta': opcoes.soDescoberta = true; break;
      case '--so-coleta': opcoes.soColeta = true; break;
      case '--so-exportar': opcoes.soExportar = true; break;
      case '--atualizar': opcoes.atualizar = true; break;
      case '--painel': opcoes.painel = valor(); break;
      case '--recomecar': opcoes.recomecar = true; break;
      case '--ajuda':
      case '-h': opcoes.ajuda = true; break;
      default:
        throw new Error(`spcaDonors: opção desconhecida "${chave}"`);
    }
  }
  const esferaInvalida = opcoes.esferas.find((e) => !ESFERAS.includes(e));
  if (esferaInvalida) throw new Error(`spcaDonors: esfera desconhecida "${esferaInvalida}"`);
  const ufInvalida = opcoes.ufs.find((u) => !UFS.includes(u));
  if (ufInvalida) throw new Error(`spcaDonors: UF desconhecida "${ufInvalida}"`);
  if (!Number.isInteger(opcoes.exercicio) || opcoes.exercicio < 2017) {
    throw new Error(`spcaDonors: exercício inválido "${opcoes.exercicio}"`);
  }
  return opcoes;
}

/**
 * O detalhamento de receitas do TSE não inclui rendimentos de aplicações
 * financeiras nem outras receitas de descontos obtidos: o próprio site avisa
 * isso em letra miúda. Então o ranking nunca soma o total declarado, e sim o
 * total menos essas duas linhas. Conferido nos 23 diretórios nacionais com
 * movimento em 2026: todos fecham ao centavo com esta conta.
 */
export function receitaEsperadaNoRanking(totalizadores) {
  if (!totalizadores) return null;
  const total = totalizadores.valorTotalReceita || 0;
  const rendimentos = totalizadores.valorReceitaRendimentosAplicacoesFinanceiras || 0;
  const outras = totalizadores.valorReceitaOutrasReceitas || 0;
  return Number((total - rendimentos - outras).toFixed(2));
}

/* ------------------------------------------------------ painel da página */

/**
 * As faixas em que a página agrupa doador, pela soma do que a pessoa deu no
 * ano. A borda de cima de uma é o piso da seguinte, e a última é aberta:
 * tests/data/dataFiles.test.mjs cobra esse encaixe.
 */
export const FAIXAS_DOADOR = [
  [0, 200], [200, 1000], [1000, 10000], [10000, 50000], [50000, 200000], [200000, null],
];

/** Doação e contribuição de gente, ou seja, tudo que não é repasse do TSE. */
const ehPrivado = (lancamento) => lancamento.fonte !== 'Fundo Partidário';

const somar = (lista, campo) => lista.reduce((total, item) => total + (item[campo] || 0), 0);
const arredondar = (valor) => Number(valor.toFixed(2));

function mediana(valores) {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.floor(ordenados.length / 2)];
}

/**
 * Monta o JSON que /doadores/partidos/ lê no build. Só aritmética: tudo que
 * é juízo editorial (o marco legal, o estado das contas de 2025, quais
 * partidos ficam fora da série mensal) vive em data/spcaContexto.json e é
 * escrito à mão. Um job diário não pode reescrever sozinho uma frase sobre
 * a lei nem decidir qual partido distorce um gráfico.
 */
export function montarPainel({
  exercicio, lancamentos, prestadores, partidosDoExercicio = [],
  mesesExcluir = [], fefcTotal = null, atualizacaoTse = null, geradoEm = null,
}) {
  const comMovimento = prestadores.filter((p) => (p.totalReceita || 0) > 0);
  const privados = lancamentos.filter(ehPrivado);

  const ultimoPorSigla = new Map();
  for (const l of lancamentos) {
    const atual = ultimoPorSigla.get(l.partido_sigla);
    if (l.data && (!atual || l.data > atual)) ultimoPorSigla.set(l.partido_sigla, l.data);
  }

  const privadoPorSigla = new Map();
  const doadoresPorSigla = new Map();
  for (const l of privados) {
    privadoPorSigla.set(l.partido_sigla, (privadoPorSigla.get(l.partido_sigla) || 0) + (l.valor || 0));
    if (!doadoresPorSigla.has(l.partido_sigla)) doadoresPorSigla.set(l.partido_sigla, new Set());
    doadoresPorSigla.get(l.partido_sigla).add(l.doador_documento);
  }

  const partidos = comMovimento
    .map((p) => ({
      sigla: p.partido,
      total: Math.round(p.totalReceita || 0),
      privado: Math.round(privadoPorSigla.get(p.partido) || 0),
      doadores: (doadoresPorSigla.get(p.partido) || new Set()).size,
      repasses: Math.round(p.repasses || 0),
      ultimo: ultimoPorSigla.get(p.partido) || null,
    }))
    .sort((a, b) => b.total - a.total);

  // Doador é a pessoa, não o par pessoa-e-partido: quem doou para dois
  // diretórios conta uma vez na faixa, na escada e no ranking.
  const porDoador = new Map();
  for (const l of privados) {
    const chave = l.doador_documento;
    const atual = porDoador.get(chave) || {
      nome: '', tipo: l.doador_tipo, valor: 0, doacoes: 0, partidos: new Set(),
    };
    atual.valor += l.valor || 0;
    atual.doacoes += 1;
    atual.partidos.add(l.partido_sigla);
    if ((l.doador_nome || '').length > atual.nome.length) atual.nome = l.doador_nome;
    porDoador.set(chave, atual);
  }
  const doadores = [...porDoador.values()].sort((a, b) => b.valor - a.valor);
  const totalPrivado = somar(privados, 'valor');

  const faixas = FAIXAS_DOADOR.map(([de, ate]) => {
    const dentro = doadores.filter((d) => d.valor >= de && (ate === null || d.valor < ate));
    return {
      de, ate, doadores: dentro.length, valor: Math.round(somar(dentro, 'valor')),
    };
  });

  const quantosPara = (alvo) => {
    let soma = 0;
    for (let i = 0; i < doadores.length; i += 1) {
      soma += doadores[i].valor;
      if (soma / totalPrivado >= alvo) return i + 1;
    }
    return doadores.length;
  };

  const porClasse = new Map();
  for (const l of privados) porClasse.set(l.classificacao, (porClasse.get(l.classificacao) || 0) + (l.valor || 0));

  const pj = doadores.filter((d) => d.tipo === 'PJ');

  const excluir = new Set(mesesExcluir);
  const porMes = new Map();
  for (const l of privados) {
    if (excluir.has(l.partido_sigla) || !l.data) continue;
    const mes = l.data.slice(0, 7);
    const atual = porMes.get(mes) || { valor: 0, lancamentos: 0 };
    atual.valor += l.valor || 0;
    atual.lancamentos += 1;
    porMes.set(mes, atual);
  }

  const siglasComPrestacao = new Set(prestadores.map((p) => p.partido));
  const siglasComMovimento = new Set(comMovimento.map((p) => p.partido));

  return {
    _gerado_em: geradoEm || new Date().toISOString(),
    _exercicio: exercicio,
    _atualizacao_tse: atualizacaoTse,
    totais: {
      diretorios_nacionais: partidosDoExercicio.length,
      com_prestacao_aberta: prestadores.length,
      com_movimento: comMovimento.length,
      total_declarado: arredondar(somar(prestadores, 'totalReceita')),
      fundo_partidario_detalhado: arredondar(somar(lancamentos.filter((l) => !ehPrivado(l)), 'valor')),
      doadores_privados: arredondar(totalPrivado),
      rendimentos_aplicacoes: arredondar(somar(prestadores, 'rendimentos')),
      outras_receitas: arredondar(somar(prestadores, 'outrasReceitas')),
      origem_nao_identificada: arredondar(somar(prestadores, 'roni')),
      despesa_total: arredondar(somar(prestadores, 'despesa')),
      repassado_a_candidatos_e_partidos: arredondar(somar(prestadores, 'repasses')),
      lancamentos: lancamentos.length,
      lancamentos_privados: privados.length,
      doadores: doadores.length,
      mediana_por_doador: arredondar(mediana(doadores.map((d) => d.valor))),
      fefc_2026_para_campanhas: fefcTotal,
    },
    partidos,
    sem_prestacao_aberta: partidosDoExercicio
      .filter((p) => !siglasComPrestacao.has(p.sigla)).map((p) => p.sigla).sort(),
    sem_movimento_declarado: partidosDoExercicio
      .filter((p) => siglasComPrestacao.has(p.sigla) && !siglasComMovimento.has(p.sigla))
      .map((p) => p.sigla).sort(),
    classes_privadas: [...porClasse.entries()]
      .sort((a, b) => b[1] - a[1]).map(([nome, valor]) => [nome, arredondar(valor)]),
    faixas_doador: faixas,
    concentracao: {
      p10: quantosPara(0.1),
      p25: quantosPara(0.25),
      p50: quantosPara(0.5),
      p75: quantosPara(0.75),
      p90: quantosPara(0.9),
      doadores: doadores.length,
    },
    // Sem documento: o TSE publica o CPF inteiro, e esta página não repete.
    top_doadores: doadores.slice(0, 25).map((d, i) => [
      i + 1, d.nome, arredondar(d.valor), d.doacoes, [...d.partidos].sort().join(', '),
    ]),
    pagadores_pj: { quantos: pj.length, valor: arredondar(somar(pj, 'valor')) },
    meses_privado: [...porMes.entries()].sort()
      .map(([mes, o]) => [mes, arredondar(o.valor), o.lancamentos]),
    meses_excluidos: [...excluir].sort(),
  };
}

export function formatarReais(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}
