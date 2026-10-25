function analyzeUml(umlModel) {
  const typeNotes = Array.isArray(umlModel.typeNotes) ? umlModel.typeNotes : [];
  return { warnings: [], suggestions: typeNotes, typeNotes };
}

module.exports = { analyzeUml };
