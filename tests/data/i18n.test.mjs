/**
 * Todo o texto editorial do site vive em i18n/pt.yaml. O Hugo não falha
 * quando uma chave não existe: ele escreve string vazia (ou
 * "%!s(MISSING)" quando falta o argumento), e o texto some da página sem
 * ninguém perceber até alguém abrir o site.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { fromRoot, readText } from '../helpers/paths.mjs';

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = path.join(dir, entry);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

/**
 * pt.yaml é uma lista `- id: chave` com `translation:` ou, nas chaves que
 * o Hugo pluraliza a partir de um número, `one:`/`other:`.
 */
const parseCatalog = (yaml) => {
  const entries = [];
  let current = null;
  const clean = (value) => value.trim().replace(/^["']|["']$/g, '');

  yaml.split('\n').forEach((line, index) => {
    const id = line.match(/^-\s+id:\s*(.+?)\s*$/);
    if (id) {
      current = {
        id: clean(id[1]), line: index + 1, translation: null, plural: null,
      };
      entries.push(current);
      return;
    }
    if (!current) return;

    const translation = line.match(/^\s+translation:\s*(.*)$/);
    if (translation) { current.translation = clean(translation[1]); return; }

    const plural = line.match(/^\s+(one|other|zero|two|few|many):\s*(.*)$/);
    if (plural) {
      current.plural = { ...(current.plural || {}), [plural[1]]: clean(plural[2]) };
      current.translation = current.translation || clean(plural[2]);
    }
  });

  return entries;
};

const CATALOG = parseCatalog(readText('i18n', 'pt.yaml'));
const BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

const TEMPLATES = walk(fromRoot('layouts'))
  .filter((file) => file.endsWith('.html') || file.endsWith('.txt'))
  .map((file) => ({ file: path.relative(fromRoot(), file), source: readFileSync(file, 'utf8') }));

/** `{{ i18n "chave" $arg }}` — captura chave e o que vem depois dela. */
const usages = () => {
  const found = [];
  for (const { file, source } of TEMPLATES) {
    const re = /i18n\s+"([A-Za-z0-9_]+)"([^}|]*)/g;
    let match = re.exec(source);
    while (match) {
      found.push({ file, key: match[1], args: match[2].trim() });
      match = re.exec(source);
    }
  }
  return found;
};

const USAGES = usages();

test('o catálogo tem forma de catálogo', () => {
  assert.ok(CATALOG.length > 400, `só ${CATALOG.length} chaves — o parser ou o arquivo mudou`);
  assert.ok(USAGES.length > 300, `só ${USAGES.length} usos encontrados nos layouts`);
});

test('toda chave usada nos layouts existe em pt.yaml', () => {
  const faltando = [...new Set(USAGES.filter((use) => !BY_ID.has(use.key))
    .map((use) => `${use.key} (${use.file})`))];
  assert.deepEqual(faltando, [], `chaves usadas e não traduzidas:\n  ${faltando.join('\n  ')}`);
});

test('nenhuma chave duplicada', () => {
  const vistas = new Set();
  const duplicadas = [];
  CATALOG.forEach((entry) => {
    if (vistas.has(entry.id)) duplicadas.push(`${entry.id} (linha ${entry.line})`);
    vistas.add(entry.id);
  });
  // Em duplicata o Hugo fica com a última: o texto que você editou em cima
  // não é o que aparece na tela.
  assert.deepEqual(duplicadas, [], `ids repetidos: ${duplicadas.join(', ')}`);
});

test('nenhuma tradução vazia', () => {
  const vazias = CATALOG.filter((entry) => !entry.translation).map((entry) => entry.id);
  assert.deepEqual(vazias, [], `traduções vazias: ${vazias.join(', ')}`);
});

// Chaves cujo %s é substituído no cliente (o Hugo só emite o molde para
// dentro de um window.app*), e por isso saem do template sem argumento.
const MOLDES_PARA_JS = new Set(
  USAGES.filter((use) => use.file.endsWith('scripts.html')).map((use) => use.key),
);

test('chave com %s é sempre usada com argumento', () => {
  // Sem argumento o Hugo imprime "%!s(MISSING)" no meio da frase.
  const erradas = USAGES
    .filter((use) => (BY_ID.get(use.key)?.translation || '').includes('%s'))
    .filter((use) => use.args === '' && !MOLDES_PARA_JS.has(use.key))
    .map((use) => `${use.key} em ${use.file}`);
  assert.deepEqual(erradas, [], `faltou argumento:\n  ${erradas.join('\n  ')}`);
});

test('chave sem placeholder não recebe argumento', () => {
  // Plural (one/other) recebe número de propósito; o resto, não.
  const erradas = USAGES
    .filter((use) => BY_ID.has(use.key))
    .filter((use) => {
      const entry = BY_ID.get(use.key);
      return !entry.plural
        && !(entry.translation || '').includes('%')
        && use.args !== ''
        && !use.args.startsWith('}');
    })
    .map((use) => `${use.key} em ${use.file} (recebe "${use.args}")`);
  assert.deepEqual(erradas, [], `argumento ignorado pelo Hugo:\n  ${erradas.join('\n  ')}`);
});

test('chave plural tem as duas formas', () => {
  const incompletas = CATALOG
    .filter((entry) => entry.plural)
    .filter((entry) => !entry.plural.one || !entry.plural.other)
    .map((entry) => entry.id);
  assert.deepEqual(incompletas, [], `plural sem one/other: ${incompletas.join(', ')}`);
});

test('os títulos de gráfico têm o número de %s que o JS substitui', () => {
  // home.js faz template.replace('%s', nome).replace('%s', fatia): um %s a
  // menos deixa a frase truncada, um a mais deixa "%s" cru no título.
  const contar = (id) => ((BY_ID.get(id)?.translation || '').match(/%s/g) || []).length;

  for (const entry of CATALOG.filter((item) => /^chartTitle/.test(item.id))) {
    const esperado = /Flagged$/.test(entry.id) || entry.id === 'chartTitleFallback' ? 1 : 2;
    assert.equal(
      contar(entry.id),
      esperado,
      `${entry.id} tem ${contar(entry.id)} placeholder(s): "${entry.translation}"`,
    );
  }
});

test('o catálogo não acumula chaves órfãs demais', () => {
  // Órfã não quebra nada, mas um catálogo em que metade não é usada deixa
  // de servir como inventário do que está escrito no site.
  const usadas = new Set(USAGES.map((use) => use.key));
  const orfas = CATALOG.map((entry) => entry.id).filter((id) => !usadas.has(id));
  const proporcao = orfas.length / CATALOG.length;

  if (orfas.length) {
    process.stdout.write(`# ${orfas.length} chaves órfãs (${(proporcao * 100).toFixed(0)}%): ${orfas.slice(0, 12).join(', ')}${orfas.length > 12 ? '…' : ''}\n`);
  }
  assert.ok(proporcao < 0.5, `${orfas.length} de ${CATALOG.length} chaves não são usadas em lugar nenhum`);
});
