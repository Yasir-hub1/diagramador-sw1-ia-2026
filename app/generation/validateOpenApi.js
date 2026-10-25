function validateOpenApi(document) {
  const errors = [];
  if (!document || document.openapi !== '3.0.3') errors.push('El contrato OpenAPI debe ser 3.0.3.');
  if (!document.info || !document.info.title) errors.push('Falta info.title en OpenAPI.');
  if (!document.paths || !Object.keys(document.paths).length) errors.push('OpenAPI no tiene paths.');
  if (!document.components || !document.components.schemas || !Object.keys(document.components.schemas).length) {
    errors.push('OpenAPI no tiene schemas.');
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

module.exports = { validateOpenApi };
