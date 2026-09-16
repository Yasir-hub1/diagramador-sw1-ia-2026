// uml-validators.js
// Reglas de formato UML 2.5 para atributos, métodos, multiplicidad y relaciones.
// Se usa tanto en el navegador (validación del formulario) como en el
// servidor (revalidación antes de aceptar un evento de socket), para que
// nunca diverjan las reglas entre cliente y servidor.
(function (root) {
  const VISIBILITY_CHARS = ['+', '-', '#', '~'];

  // + nombre: tipo | - nombre: tipo | # nombre: tipo | ~ nombre: tipo
  const ATTRIBUTE_RE = /^([+\-#~])\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w<>[\],\s]*)$/;

  // + nombre(params): tipoRetorno
  const METHOD_RE = /^([+\-#~])\s*([A-Za-z_]\w*)\((.*)\)\s*:\s*([A-Za-z_][\w<>[\],\s]*)$/;

  // 1 | 0..1 | * | 0..* | 1..* | n..m
  const MULTIPLICITY_RE = /^(\d+|\*)(\.\.(\d+|\*))?$/;

  const STEREOTYPES = ['none', 'interface', 'abstract'];

  const RELATION_TYPES = [
    'association',
    'dependency',
    'aggregation',
    'composition',
    'inheritance',
    'realization',
  ];

  function validateAttribute(text) {
    return ATTRIBUTE_RE.test(String(text || '').trim());
  }

  function validateMethod(text) {
    return METHOD_RE.test(String(text || '').trim());
  }

  function validateMultiplicity(text) {
    return MULTIPLICITY_RE.test(String(text || '').trim());
  }

  function validateStereotype(value) {
    return STEREOTYPES.includes(value);
  }

  function validateRelationType(value) {
    return RELATION_TYPES.includes(value);
  }

  const api = {
    VISIBILITY_CHARS,
    STEREOTYPES,
    RELATION_TYPES,
    ATTRIBUTE_RE,
    METHOD_RE,
    MULTIPLICITY_RE,
    validateAttribute,
    validateMethod,
    validateMultiplicity,
    validateStereotype,
    validateRelationType,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.UMLValidators = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
