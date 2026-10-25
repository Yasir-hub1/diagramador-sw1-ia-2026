const JAVA_NAME = /^[A-Z][A-Za-z0-9_]*$/;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateUmlModel(model) {
  const errors = [];
  const warnings = [];
  const names = new Set();

  if (!model.classes.length) {
    errors.push('El diagrama no tiene clases. Dibuja al menos una para generar el backend.');
  }

  model.classes.forEach((item) => {
    if (!item.name) {
      errors.push('Hay una clase sin nombre.');
      return;
    }
    if (!JAVA_NAME.test(item.name)) {
      errors.push('«' + item.name + '» no es un nombre de clase Java válido. Usa PascalCase.');
    }
    if (names.has(item.name.toLowerCase())) {
      errors.push('Hay más de una clase llamada «' + item.name + '».');
    }
    names.add(item.name.toLowerCase());
    if (item.stereotype === 'interface') {
      warnings.push('«' + item.name + '» es interfaz: no se persistirá como tabla.');
    }
    const fields = new Set();
    item.attributes.forEach((attribute) => {
      if (!FIELD_NAME.test(attribute.name)) {
        errors.push('Atributo inválido en «' + item.name + '»: ' + attribute.name);
      }
      if (fields.has(attribute.name.toLowerCase())) {
        errors.push('«' + item.name + '» repite el atributo ' + attribute.name + '.');
      }
      fields.add(attribute.name.toLowerCase());
    });
    if (item.idWasAdded) {
      warnings.push('«' + item.name + '» no tenía id. TRAZO añadió - id: Long para JPA.');
    }
  });

  model.relationships.forEach((relation) => {
    if (!relation.sourceName || !relation.targetName) {
      errors.push('Hay una relación sin extremos nombrados.');
    }
    if (relation.type === 'dependency') {
      warnings.push('La dependencia de «' + relation.sourceName + '» a «' + relation.targetName + '» no se persiste.');
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateUmlModel };
