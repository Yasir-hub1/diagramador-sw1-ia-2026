function resolveDatabase(value) {
  if (value === 'postgresql' || value === 'mongodb') return value;
  return 'h2';
}

module.exports = { resolveDatabase };
