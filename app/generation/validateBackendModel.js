const JAVA_NAME = /^[A-Z][A-Za-z0-9_]*$/;

function validateBackendModel(model) {
  const errors = [];
  const warnings = [];
  const endpoints = new Set();
  const names = new Set();

  if (!model.entities.length) {
    errors.push('No hay entidades persistibles. Las interfaces no generan tablas.');
  }

  model.entities.forEach((entity) => {
    if (!JAVA_NAME.test(entity.name)) errors.push('Entidad inválida: ' + entity.name);
    if (names.has(entity.name)) errors.push('Entidad duplicada: ' + entity.name);
    names.add(entity.name);
    if (!entity.attributes.some((item) => item.primaryKey)) {
      errors.push('«' + entity.name + '» no tiene identificador.');
    }
    entity.endpoints.forEach((route) => {
      const key = route.method + ' ' + route.path;
      if (endpoints.has(key)) errors.push('Endpoint duplicado: ' + key);
      endpoints.add(key);
    });
  });

  model.relationships.forEach((relation) => {
    if (!names.has(relation.source) || !names.has(relation.target)) {
      warnings.push('Relación ignorada: falta «' + relation.source + '» o «' + relation.target + '».');
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateBackendModel };
