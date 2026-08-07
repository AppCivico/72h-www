export default (value) => {
  const formatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const numericValue = Number(value);
  return formatter.format(Number.isFinite(numericValue) ? numericValue : 0);
};
