# Plano de indicadores para /candidato/{slug}

Versão navegável, com fundamentação, exemplos de redação e fontes:
<https://claude.ai/code/artifact/b83109f4-b5ee-4b0f-ba79-6501504bcbd0>

Este arquivo é o recorte operacional: inventário de campos, tarefas por fase e os
achados de verificação. Levantado em 22/08/2026; revisado no mesmo dia.

**Decisão de escopo (Thiago, 22/08/2026):** sem indicadores relativos ao prazo de
72 horas — não fazem sentido na prática. Prioridades: teto legal de gastos,
compreensão da origem (composição + concentração), percentil além da mediana, e
quando o dinheiro chegou (timing).

---

## 1. Campos que já estão no banco e não estão na tela

| Campo | Habilita | Nota |
|---|---|---|
| `revenue.value` (distribuição) | Fatia do maior repassador, top-5, Gini, faixas de valor | Só agregação. O indicador mais forte possível com receita apenas |
| `revenue.cpf` vs `cnpj` | Nº de doadores PF distintos, ticket mediano, PF vs PJ | Agregar server-side; documento nunca sai da API |
| `revenue.date` (série) | Curva acumulada, latência do 1º repasse, fatia das 2 primeiras semanas | `revenue_accumulated` existe mas é por eleição, não por candidatura |
| `candidate.revenue_from_candidates_percent` | % da receita vinda de outros candidatos | Já coletado (`percentualReceitaOutCand`), **nunca exposto** |
| `candidate.votes_first_round` / `votes_second_round` | Receita por voto, decil × taxa de sucesso | Populado em eleições encerradas |
| `candidate.election_status` | Eleitos vs não eleitos na mesma disputa | — |
| `candidate.reelection` | Grupo de comparação estreante vs reeleição | — |
| `candidate.gender_id`, `race_id`, `schooling_id` | Medianas por gênero/raça no mesmo partido/cargo/UF | Vantagem comparativa: as bases estrangeiras não têm isso |
| `revenue.deleted`, `deleted_at`, `deleted_times` | Repasses retificados/excluídos pelo TSE | Loader marca após 2 coletas sem o registro |
| `revenue.electoral_receipt`, `cod` | Conciliação com o total oficial e dedup correta | Ver seção 4 |

## 2. Campos que o scraper já recebe do TSE e descarta

Nenhum exige requisição nova — são as mesmas respostas que o spider já baixa.

**Detalhe do candidato** (`/candidatura/buscar/{ano}/{uf}/{id_eleicao}/candidato/{id}`):

- `gastoCampanha1T` / `gastoCampanha2T` → **limite legal de gastos do cargo** — a régua
  universal ("já arrecadou 63% do teto legal"). Verificado idêntico entre 5 candidatos ao
  mesmo cargo/UF e variando por cargo; nas contas de 2022 o mesmo número aparece como
  `limiteDeGasto1T`/`valorLimiteDeGastos`. Dep. federal 2026: R$ 3.176.572,53; dep.
  estadual: R$ 1.270.629,01 (nacionais e únicos). Habilita também autofinanciamento sobre
  o limite legal (10% do teto, Lei 9.504/97 art. 23 §2º-A).
  **`gastoCampanha` (sem sufixo) é 0.0 sempre — campo morto, não usar.**
- `bens[]` (`ordem`, `descricao`, `descricaoDeTipoDeBem`, `valor`, `dataUltimaAtualizacao`)
  e `totalDeBens` → patrimônio declarado e variação entre eleições. Verificado: o total
  fecha com a soma em 2022 e 2026, e a série por pessoa sai de graça via `person_id`.
- `ocupacao`, `dataDeNascimento`, `nomeColigacao`, `composicaoColigacao`,
  `descricaoSituacaoCandidato`, `isCandidatoInapto`, `processosCassacao`.

**Prestador** (`/prestador/consulta/{id_eleicao}/{ano}/{uf}/{cargo}/{nr_partido}/{nr_cand}/{id}`):

- `dadosConsolidados` → decomposição **por tipo de doador** (`totalReceitaPF`,
  `totalReceitaPJ`, `totalPartidos`, `totalProprios`, `totalReceitaOutCand`,
  `totalDoacaoFcc`, com qtd e %), mais `totalRecebido` para conciliação. Hoje só
  `percentualReceitaOutCand` é aproveitado. Corrige a taxonomia da barra de fontes:
  `fonteOrigem` descreve a origem do recurso, não o tipo de quem repassou — por isso
  doação de PF cai em "Outros Recursos" hoje.
- `rankingDoadores` → top doadores já calculados pelo TSE.
- `historicoEntregas` (`dataEntrega`, `tipo`, `retificadora`, `idEntrega`) → medidor de
  completude por candidato ("prestações coletadas: N de N esperadas · última em DD/MM").

**Lista de receitas** — 16 chaves, das quais o scraper usa 8. Faltam:
`cpfCnpjDoadorOriginario`, `nomeDoadorOriginario` (quem pagou por trás do repasse do
partido), `especieRecurso` (PIX/TED/cheque), `stFinanciamentoColetivo`, `nrDocumento`.

**Despesas**: `/prestador/consulta/despesas/{id_eleicao}/{idPrestador}/{idEntrega}` funciona
**sem** o sufixo `/lista` (com `/lista` dá 404). Devolve item a item para eleições
fechadas; em 2026 ainda volta `[]`.

## 3. Fases

### Fase 1 — só com o que já está gravado
- [ ] Migration sqitch `NNNN-candidate-indicators`: estender `candidate_group_stats` com
      P25/P75/P90 e com os escopos `reelection_position_uf` e `gender_race_party_uf`
      (linhas novas no `UNION ALL`; manter o índice único, o refresh é `CONCURRENTLY`).
- [ ] View virtual `CandidateConcentration`: maior fatia, top-5, `COUNT(DISTINCT cpf)`,
      ticket mediano, faixas de valor. Usa o índice `revenue_candidate_deleted_date_idx`.
- [ ] View de série semanal por candidatura sobre `revenue.date`: curva acumulada,
      latência do 1º repasse (vs 16/08), fatia das 2 primeiras semanas — com a mediana do
      cargo/UF como referência.
- [ ] Expor `revenue_from_candidates_percent` no allow-list de
      `ResultSet::View::CandidateDetail::build_row`.
- [ ] Acrescentar percentil (não só rank) à resposta de `/candidates/{id}/comparison`.
- [ ] Front: percentil no big number de comparação ("recebeu mais que 87% dos 1.243");
      bloco "de quem veio" com rótulo verbal + números crus + faixas de valor; gráfico
      "quando o dinheiro chegou". Textos em `i18n/pt.yaml` com `%s`.

### Fase 2 — persistir o que o scraper descarta
- [ ] `candidate.spending_limit_1t/2t` (de `gastoCampanha1T/2T`) → fatia do teto no front.
- [ ] `candidate.total_assets` + tabela `candidate_asset` → patrimônio e variação
      (deflacionar entra na fase 3).
- [ ] Tabela para `dadosConsolidados` (por candidatura e entrega) + conciliação automática
      contra `totalRecebido`; corrigir a barra de fontes para tipo de doador.
- [ ] Tabela de entregas (`historicoEntregas`) → medidor de completude.
- [ ] 4 campos extras na lista de receitas.

### Fase 3 — dado externo e pós-eleição
- [ ] Cota FEFC por partido (planilha por ciclo) → cotas de gênero/raça e fatia individual.
- [ ] IPCA para deflacionar patrimônio.
- [ ] Eleitorado apto por circunscrição → receita por eleitor.
- [ ] Despesas item a item → custo por voto real, % em comunicação, decil × taxa de sucesso.

## 4. Achados de verificação (fora do escopo, mas relevantes)

1. **Nosso total não fecha com o do TSE.** Na candidatura de teste (`250002530167`), a nossa
   API devolve R$ 2.002.500 em 14 repasses; o `dadosConsolidados` do TSE devolve
   R$ 2.018.500 em 14 receitas. Pode ser defasagem de coleta — só a conciliação distingue
   defasagem de perda.
2. **`_delete_duplicated_revenues` tem brecha de maiúsculas.** Particiona por `name`, e o TSE
   reemite o mesmo repasse com grafia diferente. No extrato ao vivo apareceram
   "ROBERTO JAFET RIZK" e "Roberto Jafet Rizk" — mesmo valor, mesma data, **mesmo
   `electoral_receipt`**, dois registros ativos. A chave natural é `electoral_receipt`.
3. **Regras de cota mudaram de natureza.** Raça é piso **fixo** de 30% (EC 133/2024,
   confirmada pelo STF nas ADI 7706/7707 em 26/06/2026), não mais proporcional às
   candidaturas. Gênero segue proporcional com piso de 30% (Consulta TSE 0600252).
   Em 2026 o prazo de distribuição das cotas foi prorrogado para **8 de setembro**.

## 5. Régua editorial (resumo)

Frase antes do número · "não temos" nunca é R$ 0,00 · rótulo verbal sempre com o dado cru ao
lado · sinalizadores factuais em vez de nota composta · espaço de resposta da candidatura ·
medidor de completude por candidato · "repasse recebido", não "doação" · notas de anomalia no
ponto onde a anomalia aparece · nenhum indicador de eficiência apresentado como mérito
(a causalidade é nos dois sentidos: expectativa de vitória atrai dinheiro).
