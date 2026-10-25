function classKey(item) {
  return String(item.name || '').trim();
}

function attrKey(item) {
  return item.name + ':' + item.type;
}

function relationKey(item) {
  return [item.type, item.sourceName, item.targetName, item.kind].join('|');
}

function indexBy(list, keyOf) {
  const map = new Map();
  list.forEach((item) => map.set(keyOf(item), item));
  return map;
}

function diffUml(previous, current) {
  const changes = [];
  if (!previous) return changes;

  const before = indexBy(previous.classes || [], classKey);
  const after = indexBy(current.classes || [], classKey);

  after.forEach((cls, name) => {
    if (!before.has(name)) {
      changes.push({ type: 'ADD_CLASS', entity: name });
      return;
    }
    const prevAttrs = new Set((before.get(name).attributes || []).map(attrKey));
    const nextAttrs = new Set((cls.attributes || []).map(attrKey));
    nextAttrs.forEach((key) => {
      if (!prevAttrs.has(key)) changes.push({ type: 'ADD_ATTRIBUTE', entity: name, attribute: key });
    });
    prevAttrs.forEach((key) => {
      if (!nextAttrs.has(key)) changes.push({ type: 'REMOVE_ATTRIBUTE', entity: name, attribute: key });
    });
  });

  before.forEach((_cls, name) => {
    if (!after.has(name)) changes.push({ type: 'REMOVE_CLASS', entity: name });
  });

  const beforeLinks = new Set((previous.relationships || []).map(relationKey));
  const afterLinks = new Set((current.relationships || []).map(relationKey));
  afterLinks.forEach((key) => {
    if (!beforeLinks.has(key)) {
      const [type, source, target, kind] = key.split('|');
      changes.push({ type: 'ADD_RELATIONSHIP', umlType: type, source, target, kind });
    }
  });
  beforeLinks.forEach((key) => {
    if (!afterLinks.has(key)) {
      const [type, source, target, kind] = key.split('|');
      changes.push({ type: 'REMOVE_RELATIONSHIP', umlType: type, source, target, kind });
    }
  });

  return changes;
}

module.exports = { diffUml };
