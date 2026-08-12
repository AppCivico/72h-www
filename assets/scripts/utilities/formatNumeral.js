import numeral from 'numeral';

numeral.register('locale', 'pt-br', {
  delimiters: {
    thousands: '.',
    decimal: '.',
  },
  abbreviations: {
    thousand: '<span>Mil</span>',
    million: '<span>Milhões</span>',
    billion: '<span>Bilhões<span>',
    trillion: '<span>Trilhões</span>',
  },
  ordinal: () => 'º',
  currency: {
    symbol: 'R$',
  },
});

numeral.locale('pt-br');

export default function formatNumeral(value, decimalPlaces = 0) {
  let decimal = '';
  for (let i = 0; i < decimalPlaces; i += 1) {
    decimal += '0';
  }

  return decimalPlaces
    ? numeral(value).format(`0.${decimal}`).replace('.', ',')
    : numeral(value).format();
}
