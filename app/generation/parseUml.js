const validators = require('../../public/uml-validators');
const { mapJavaType } = require('./types');
const semantics = require('../../public/attribute-semantics');

function defaultIdAttribute() {
  return { name: 'id', type: 'Long', required: true, primaryKey: true, visibility: '-' };
}

function parseAttribute(line) {
  const text = String(line || '').trim();
  let match = text.match(validators.ATTRIBUTE_RE);
  if (!match) {
    match = text.match(/^([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w<>[\],\s]*)$/);
    if (!match) return null;
    const name = match[1];
    return {
      name,
      type: mapJavaType(match[2]),
      visibility: /^id$/i.test(name) ? '-' : '+',
      required: /^id$/i.test(name),
      primaryKey: /^id$/i.test(name),
    };
  }
  const name = match[2];
  return {
    name,
    type: mapJavaType(match[3]),
    visibility: match[1],
    required: /^id$/i.test(name),
    primaryKey: /^id$/i.test(name),
  };
}

function ensureClassIdentifier(item) {
  if (item.stereotype === 'interface') return item;
  if (item.attributes.some((attribute) => attribute.primaryKey)) return item;
  return {
    ...item,
    attributes: [defaultIdAttribute(), ...item.attributes],
    idWasAdded: true,
  };
}

function parseMethod(line) {
  const text = String(line || '').trim();
  const match = text.match(validators.METHOD_RE);
  if (!match) return null;
  return {
    name: match[2],
    params: match[3].trim(),
    returnType: mapJavaType(match[4]),
    visibility: match[1],
  };
}

function manySide(multiplicity) {
  const text = String(multiplicity || '1').replace(/\s+/g, '');
  return text === '*' || text.endsWith('..*') || text === '0..*' || text === '1..*';
}

function relationKind(sourceMultiplicity, targetMultiplicity) {
  const sourceMany = manySide(sourceMultiplicity);
  const targetMany = manySide(targetMultiplicity);
  if (!sourceMany && !targetMany) return 'ONE_TO_ONE';
  if (!sourceMany && targetMany) return 'ONE_TO_MANY';
  if (sourceMany && !targetMany) return 'MANY_TO_ONE';
  return 'MANY_TO_MANY';
}

function parseUmlModel(snapshot, diagramId) {
  const classes = (snapshot.classes || []).map((item) => ({
    id: item.id,
    name: String(item.name || '').trim(),
    stereotype: item.stereotype || 'none',
    attributes: (item.attributes || []).map(parseAttribute).filter(Boolean),
    methods: (item.methods || []).map(parseMethod).filter(Boolean),
  })).map(ensureClassIdentifier);
  const relationships = (snapshot.relations || []).map((item) => ({
    id: item.id,
    type: item.type,
    sourceId: item.sourceId,
    targetId: item.targetId,
    sourceName: item.sourceName,
    targetName: item.targetName,
    sourceMultiplicity: item.sourceMultiplicity || '1',
    targetMultiplicity: item.targetMultiplicity || '1',
    kind: relationKind(item.sourceMultiplicity, item.targetMultiplicity),
  }));
  const uml = { diagramId: String(diagramId || ''), classes, relationships };
  uml.typeNotes = semantics.applySemanticsToUml(uml);
  return uml;
}

module.exports = { parseUmlModel, parseAttribute, relationKind, defaultIdAttribute };
