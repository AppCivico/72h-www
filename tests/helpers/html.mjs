/**
 * Leitura de HTML por regex, de propósito: o smoke roda sobre o HTML que
 * o Hugo realmente escreveu, e um parser tolerante "conserta" markup
 * quebrado justamente no caso que o teste existe para pegar. Sem
 * dependência nova também significa que o smoke roda em CI em segundos.
 */

const TAG_RE = (name) => new RegExp(`<${name}\\b[^>]*>`, 'gi');

/**
 * O atributo estático — nunca o binding do Vue. O site usa templates
 * in-DOM, então `:href="url"` e `href="/2026/"` convivem no mesmo HTML e
 * só o segundo é uma referência que precisa existir em disco.
 */
export function attr(tag, name) {
  const match = tag.match(new RegExp(`(?<![:@\\w-])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  if (!match) return null;
  return match[2] ?? match[3] ?? '';
}

export function tags(html, name) {
  return html.match(TAG_RE(name)) || [];
}

export function title(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}

/** <meta name="x"> ou <meta property="x"> — o site usa os dois no mesmo tag. */
export function meta(html, key) {
  for (const tag of tags(html, 'meta')) {
    if ([attr(tag, 'name'), attr(tag, 'property'), attr(tag, 'itemprop')].includes(key)) {
      return attr(tag, 'content');
    }
  }
  return null;
}

export function canonical(html) {
  for (const tag of tags(html, 'link')) {
    if ((attr(tag, 'rel') || '').toLowerCase() === 'canonical') return attr(tag, 'href');
  }
  return null;
}

export function htmlLang(html) {
  const tag = tags(html, 'html')[0];
  return tag ? attr(tag, 'lang') : null;
}

export function countTag(html, name) {
  return tags(html, name).length;
}

/** Todas as referências que precisam existir em disco ou responder 200. */
export function references(html) {
  const out = [];
  const push = (kind, tag, name) => {
    const value = attr(tag, name);
    if (value) out.push({ kind, value, tag });
  };

  tags(html, 'a').forEach((tag) => push('link', tag, 'href'));
  tags(html, 'script').forEach((tag) => push('script', tag, 'src'));
  tags(html, 'img').forEach((tag) => push('image', tag, 'src'));
  tags(html, 'source').forEach((tag) => push('image', tag, 'src'));
  tags(html, 'link').forEach((tag) => {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    if (['stylesheet', 'icon', 'apple-touch-icon', 'mask-icon', 'manifest', 'preload'].includes(rel)) {
      push('asset', tag, 'href');
    }
  });

  return out;
}

export function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = re.exec(html);
  while (match) {
    blocks.push(match[1]);
    match = re.exec(html);
  }
  return blocks;
}
