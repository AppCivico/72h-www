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

export function formatarReais(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}
