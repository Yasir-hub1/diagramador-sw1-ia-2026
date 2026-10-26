function validateFrontendModel(model) {
  const errors = [];
  if (!model || !Array.isArray(model.entities) || !model.entities.length) {
    errors.push('El modelo Flutter no tiene entidades.');
  }
  if (!model.backend || !model.backend.baseUrl) {
    errors.push('Falta la URL del backend para el cliente Flutter.');
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

module.exports = { validateFrontendModel };
