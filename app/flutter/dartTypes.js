function snakeCase(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
}

function camelCase(name) {
  const text = String(name || '');
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function dartType(javaType) {
  if (javaType === 'Integer' || javaType === 'Long') return 'int';
  if (javaType === 'Double' || javaType === 'Float') return 'double';
  if (javaType === 'Boolean') return 'bool';
  return 'String';
}

function dartFormValue(javaType, textExpr) {
  if (javaType === 'Integer' || javaType === 'Long') return 'int.tryParse(' + textExpr + '.trim())';
  if (javaType === 'Double' || javaType === 'Float') {
    return 'double.tryParse(' + textExpr + '.trim().replaceAll(\',\', \'.\'))';
  }
  if (javaType === 'Boolean') {
    return '(' + textExpr + '.trim() == \'true\' || ' + textExpr + '.trim() == \'1\')';
  }
  return textExpr + '.trim().isEmpty ? null : ' + textExpr + '.trim()';
}

function titleField(entity) {
  const preferred = ['name', 'nombre', 'title', 'titulo', 'email'];
  const found = entity.attributes.find((item) => preferred.includes(item.name.toLowerCase()));
  return found ? found.name : entity.attributes.find((item) => !item.primaryKey)?.name || 'id';
}

function subtitleField(entity) {
  const title = titleField(entity);
  const extra = entity.attributes.find((item) => !item.primaryKey && item.name !== title);
  return extra ? extra.name : '';
}

module.exports = { snakeCase, camelCase, dartType, dartFormValue, titleField, subtitleField };
