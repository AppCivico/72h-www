// Slug is cosmetic only — readability/SEO, not the lookup key (person
// names aren't unique). Strips accents via NFD normalization + stripping
// combining marks, e.g. "MÁRCIO FRANÇA" -> "marcio-franca".
export function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// person_id is stable across every election a person ever runs in —
// unlike candidate_id (TSE's SQ_CANDIDATO), which is reissued each
// election and can't be used to follow the same person across years.
// One URL now covers a person's whole history instead of needing a
// different URL per candidacy.
export default function personUrl(person) {
  return `/candidato/${slugify(person.name)}-${person.id}/`;
}
