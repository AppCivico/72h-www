# Diagnóstico de UI, legibilidade e experiência de conteúdo — 72horas.org

**Data:** 16/08/2026 · **Base:** código do repositório `72h-www` (Hugo + Vue + SCSS) e o site em produção (https://72horas.org, eleição 2026).

---

## Sumário executivo

O 72horas.org tem uma base técnica muito boa — SSR dos números para crawlers, `aria-busy`, micromodal, `visually-hidden`, grid de breakpoints bem definido — mas a **camada visual não faz jus ao conteúdo**. Os problemas se concentram em quatro raízes:

1. **Tipografia sem hierarquia real**: a escala modular usa ratio 1.125 com base 16px, o que produz tamanhos muito próximos entre si (títulos de seção com ~20–23px, corpo 16px) e extremos ilegíveis (texto de apoio a 12,6px e rótulos a **6,2px**). Quase tudo importante está em CAIXA ALTA, o que reduz a velocidade de leitura.
2. **Contraste reprovado nos elementos mais usados**: o cinza de apoio (`gray/medium`) e os botões teal com texto branco ficam abaixo do mínimo WCAG AA — justamente os textos informativos dos cards de candidatura e os CTAs principais.
3. **A página inicial é um bloco contínuo de densidade uniforme**: números, gráficos, 11 filtros, lista de candidaturas, vídeo e parceiros se sucedem sem ritmo visual, sem fundo alternado, sem âncoras de navegação — o olho não tem onde descansar nem por onde se orientar.
4. **Semântica de headings quebrada**: há ~9 `<h1>` por página (um dentro de `<button>`), o que prejudica leitores de tela e SEO.

Nada disso exige redesign: são correções de sistema (tokens de cor, escala tipográfica, espaçamento) mais o redesenho de dois componentes (painel de filtros e card de candidatura).

---

## 1. Legibilidade e tipografia

### 1.1 Escala tipográfica achatada e com extremos ilegíveis — **crítico**

A escala modular está configurada com `base: 1em, ratio: 1.125` (`abstracts/_variables.scss:94-98`). Na prática:

| Uso | Tamanho computado | Problema |
|---|---|---|
| `ms(-8)` — rótulo dentro do número grande (`_big-numbers.scss:166`) | **~6,2px** | Ilegível em qualquer tela, ainda por cima em uppercase |
| `ms(-3)` — `small` dos números (`_big-numbers.scss:160`) | ~11,2px | Abaixo do mínimo confortável (14px) |
| `ms(-2)` — botões, infos do candidato, avisos, textos dos filtros | ~12,6px | O tamanho mais usado do site para conteúdo informativo |
| `ms(0)` — corpo | 16px | ok |
| `ms(2)` / `ms(3)` — títulos de seção | ~20 / ~23px | Pouca diferença em relação ao corpo; hierarquia fraca |
| `ms(5)` — h1 do jumbotron | ~29px | Modesto para o título principal de um site de dados |

**Recomendação:** subir o ratio para ~1.2–1.25 (ou adotar escala manual), estabelecer piso de 14px para qualquer texto visível e eliminar os usos de `ms(-3)`/`ms(-8)`.

### 1.2 Caixa alta generalizada — **alto**

`h1` global é uppercase (`base/_typography.scss:75-78`), e o padrão se repete em `.border-title`, `.big-numbers h1`, `.filters__toggle h1`, `.candidates h1` e em **todos os botões** (`_buttons.scss:16`). Títulos longos como "CANDIDATURAS QUE RECEBERAM RECURSOS" em uppercase + Montserrat (fonte larga) leem-se ~10–15% mais devagar e ocupam mais linhas no mobile. Recomendação: reservar uppercase para micro-rótulos (eyebrows) e usar sentence case nos títulos e botões.

### 1.3 Peso de fonte inexistente é carregado errado — **médio**

O site carrega Montserrat apenas nos pesos **400 e 800** (`partials/head.html:25`), mas o mapa `$font-weights` define `bold: 600` e `heading: 600` (`_variables.scss:52-56`). Resultado: todo heading/bold pede 600 e o navegador entrega 800 — tudo que é "seminegrito" vira extra-bold, engordando a página inteira. Ou se carrega o 600, ou se declara 700/800 de fato. (Bônus: a folha do Google Fonts é carregada sem `display=swap`, causando FOIT.)

### 1.4 Números grandes com layout de "divisão" confuso — **médio**

O box "candidaturas que receberam" renderiza dividendo ÷ divisor = quociente empilhados (`bigNumbers.html:30-44`, `_big-numbers.scss:135-248`), com o símbolo ÷ em vermelho (`quaternary`). É uma metáfora matemática que o leitor precisa decifrar; um padrão "valor grande + contexto em texto" ("72 de 16.890 candidaturas · 0,43%") comunica o mesmo em um olhar.

### 1.5 Texto centralizado no jumbotron — **baixo**

O bloco de introdução (`.Content`) herda `text-align: center` do `.jumbotron` (`_jumbotron.scss:6-16`) numa coluna de até 60rem — parágrafos centrados largos são difíceis de escanear. Alinhar à esquerda com `max-width` de ~65ch.

---

## 2. Cor e contraste (transversal a legibilidade e acessibilidade)

Cálculos WCAG feitos sobre a paleta de `abstracts/_variables.scss:107-242`:

| Combinação em uso | Ratio | Exigido (AA) | Onde aparece |
|---|---|---|---|
| `gray/medium` rgb(145,142,144) sobre branco | **3,2:1** | 4,5:1 | Infos dos candidatos, subtítulos, textos dos filtros, `small` dos big numbers — quase todo texto secundário do site |
| Branco sobre `secondary` teal rgb(34,177,167) | **2,7:1** | 4,5:1 | **Todos os botões padrão** (`.button`, `_buttons.scss:13-20`), a 12,6px uppercase |
| Branco sobre `tertiary` amarelo (usos pontuais) | ~1,6:1 | — | evitar texto sobre o amarelo |
| Branco sobre `primary` roxo rgb(98,14,217) | 8,1:1 ✓ | — | ok — o roxo é um ótimo cavalo de batalha |

Além do contraste, a paleta tem **~60 cores declaradas** com muitos one-offs (laranja para links `.simple-link`, roxo diferente para `.big-text`, verdes/azuis não usados no fluxo principal), sem camada semântica (`text-secondary`, `surface`, `border`...). Isso torna qualquer ajuste global trabalhoso e explica a inconsistência visual entre seções.

**Recomendação:** criar ~12 tokens semânticos (idealmente como CSS custom properties), escurecer o cinza de apoio para algo ≥ rgb(100,100,100) e escurecer o teal dos botões (ou usar o roxo como cor primária de ação, que já passa AA com folga).

---

## 3. Filtros e exploração de dados

### 3.1 Painel de filtros: 11 controles de peso igual — **crítico**

O formulário tem 11 fieldsets multi-select (`partials/app.html:85-209`) apresentados de uma vez, todos com o mesmo peso visual. Problemas encadeados:

- Não há distinção entre filtros primários (UF, cargo, partido, tipo de fundo) e secundários (escolaridade, reeleição, faixa de votos, intervalo de dias);
- Depois de aplicar, **não há representação visível do estado ativo** (chips removíveis do tipo "SP ×", "PT ×") — o usuário precisa reabrir o painel para lembrar o que filtrou. O `filterText` gera uma frase corrida, que não é acionável;
- Não há botão "limpar filtros";
- O botão "Aplicar" fica no fim do formulário — no mobile, a metros de distância do primeiro filtro (sem sticky);
- Sem contagem de resultados antecipada ("~340 candidaturas") antes de aplicar.

**Recomendação:** dividir em filtros primários sempre visíveis + "mais filtros" recolhido; chips de filtros ativos acima dos resultados; barra de ação (aplicar/limpar + contagem) sticky no mobile.

### 3.2 Card de candidatura sobrecarregado — **alto**

Cada card (`app.html:259-327`) empilha nome + partido + cargo numa única linha de texto, 3–5 linhas de metadados em cinza 12,6px reprovado em contraste, e **até 3 botões de peso igual** ("carregar histórico", "ver página da eleição", "ver no TSE"). A foto 48×64px compete com nada — não há hierarquia. O dado mais importante (valor total recebido) está no meio da pilha, no mesmo estilo do CEP visual.

**Recomendação:** hierarquia de card com nome em destaque, valor total como número proeminente, metadados em uma linha compacta, uma ação primária (página da candidatura) e as demais como links discretos. Considerar `<a>` no card inteiro.

### 3.3 Paginação sem contexto — **médio**

Só "anterior/próxima" (`app.html:340-354`), sem "página X de Y" nem total de resultados. Sem opção de ordenação (por valor recebido, nome, votos) — ordenar é metade da exploração num dataset assim.

### 3.4 Gráficos sem títulos-síntese e sem alternativa textual — **médio**

Os contêineres de gráfico (`js-chart__*`, `js-main-chart`) entram sob um único título genérico. Boas práticas de dataviz jornalístico pedem: título que afirma o achado ("Fundo eleitoral concentrado em candidaturas brancas"), subtítulo com a métrica, fonte e uma tabela acessível (`visually-hidden` ou `<details>`) como fallback. As cores dos gráficos vêm de outro conjunto (`graph_inequality`) desconectado da paleta da UI.

### 3.5 Duplicação do bloco de big numbers — **baixo**

Os "big numbers" aparecem duas vezes (topo estático + versão filtrada), com visual quase idêntico — o usuário não percebe que o segundo bloco responde aos filtros. Diferenciar visualmente (fundo, borda ou rótulo "com filtros aplicados").

---

## 4. Experiência mobile

- **Iframe do vídeo com largura fixa** de 560px (`app.html:362`): estoura a viewport em telas < 590px, gerando scroll horizontal na página inteira — o defeito mobile mais visível. Corrigir com `aspect-ratio: 16/9; width: 100%`. — **crítico**
- **11 filtros empilhados** ocupam várias telas de altura antes do usuário chegar a qualquer resultado; o "Aplicar" some do viewport. — **alto** (resolvido junto com 3.1)
- **Menu hambúrguer só existe abaixo de 64em**, mas os links do header são botões que abrem em `target="_blank"` — navegação interna abrindo nova aba desorienta no mobile (e no desktop). `header.html:16-20` aplica `target="_blank"` a *todos* os itens do menu, sem distinguir link externo. — **alto**
- **Alvos de toque pequenos**: botões com `padding: 0.2rem 1.2rem` e fonte 12,6px (`_buttons.scss:8`) ficam com ~28px de altura — abaixo dos 44px recomendados. — **médio**
- Cards de candidatura a 50% da largura já no breakpoint `tablet` (768px) espremem texto + 3 botões em ~350px. — **médio**

---

## 5. Acessibilidade (WCAG 2.1 AA)

- **Múltiplos `<h1>` por página** (~9 na home): jumbotron, cada box de big number (`bigNumbers.html:21,33` + 3 fund boxes), intro-charts, filtros e candidaturas. Leitores de tela perdem o mapa da página. Deve haver 1 `<h1>`; seções com `<h2>`/`<h3>`. — **crítico**
- **`<h1>` dentro de `<button>`** no toggle de filtros (`app.html:69-81`): heading não é conteúdo válido/esperado de botão; inverta (button dentro do heading) ou use `<span>` estilizado. — **alto**
- **Contraste** — ver seção 2 (texto secundário 3,2:1; botões 2,7:1). — **crítico**
- **Estados de foco**: não há estilo de foco visível customizado para `.button`, `.list-box` e selects — usuários de teclado dependem do default do navegador, que some sobre o teal. — **médio**
- Sem **skip link** ("pular para o conteúdo/resultados") numa página longa. — **médio**
- Pontos positivos a preservar: `aria-busy` nos carregamentos, `visually-hidden` no label do seletor de ano, micromodal com `aria-hidden`/`role="dialog"`, imagens com `alt`, fallback SSR dos números.

---

## 6. Priorização sugerida

| # | Ação | Impacto | Esforço |
|---|---|---|---|
| 1 | Corrigir contrastes (cinza de apoio + botões) via tokens | Alto | Baixo |
| 2 | Consertar iframe do vídeo no mobile | Alto | Trivial |
| 3 | Hierarquia de headings (1 `<h1>`, seções `<h2>`) | Alto | Baixo |
| 4 | Piso de 14px + eliminar `ms(-8)`/`ms(-3)`; carregar peso 600 ou declarar 800 | Alto | Baixo |
| 5 | Remover `target="_blank"` de links internos do menu | Médio | Trivial |
| 6 | Nova escala tipográfica (ratio ~1.2) + reduzir uppercase | Alto | Médio |
| 7 | Redesenho do painel de filtros (primários/secundários, chips, sticky) | Muito alto | Alto |
| 8 | Redesenho do card de candidatura + ordenação e paginação com contexto | Muito alto | Alto |
| 9 | Ritmo visual da home (fundos alternados, espaçamento entre seções, âncoras) | Alto | Médio |
| 10 | Títulos-síntese e tabelas acessíveis nos gráficos; unificar paleta de dataviz | Médio | Médio |

Itens 1–5 são um lote de *quick wins* executável em uma única rodada, sem risco visual — bom candidato a primeira entrega. Itens 6–9 formariam a fase seguinte (o "refinamento incremental"), e podem ser feitos componente a componente sem big bang.

---

*Diagnóstico gerado a partir de: `layouts/partials/app.html`, `head.html`, `header.html`, `footer.html`, `bigNumbers.html`; `assets/stylesheets/abstracts/_variables.scss`; `base/_typography.scss`; `components/_big-numbers.scss`, `_buttons.scss`, `_filters.scss`, `_candidates.scss`, `_jumbotron.scss`; e inspeção do site em produção.*
