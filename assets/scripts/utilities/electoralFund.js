// External per-cycle constants about the public campaign funds -- not TSE-scraped:
// each is announced once per election and doesn't exist in our database.
//
// FEFC totals: the TSE announces the Fundo Especial de Financiamento de Campanha as an
// approximate figure ("aproximadamente R$ 4,9 bilhões", 03/06/2026) -- the constant
// mirrors that public number, and the home block's source line says "aproximadamente".
// A ±1% imprecision moves the displayed share by less than the rounding shown.
//
// Quota deadlines: the legal date by which parties must have distributed the MINIMUM
// amounts reserved for women's, Black and Indigenous candidacies -- NOT a deadline for
// distributing the whole fund. For 2026 the TSE moved it from Aug 30 to Sep 8
// (plenary decision of Aug/2026 adjusting Res. 23.607/2019). The i18n copy that
// renders alongside spells out this exact scope; keep them in sync.
//
// Years absent from these maps simply don't render the home's public-funds block --
// municipal cycles would need their own vetted constants, never a guess.
export const FEFC_TOTALS = {
  2026: 4900000000,
};

export const QUOTA_DEADLINES = {
  2026: '2026-09-08',
};
