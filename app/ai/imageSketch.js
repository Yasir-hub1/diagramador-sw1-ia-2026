const { interpretModelPayload, normalizeAttribute, normalizeMethod } = require('./operationPlan');

const SKETCH_SYSTEM = [
  'Lees una imagen de un diagrama UML de clases o un boceto.',
  'Antes de responder, identifica en silencio cada caja, su nombre, atributos, métodos, el tipo de línea y las multiplicidades.',
  'Devuelve JSON con message, classes, relationships y warnings.',
  'No uses Markdown. No copies un diagrama JointJS. No uses la clave operations.',
  'classes: [{ "name": "Cliente", "stereotype": "none", "attributes": ["+ id: int"], "methods": ["+ guardar(): void"] }]',
  'relationships: [{ "from": "Cliente", "to": "Pedido", "type": "association", "sourceMultiplicity": "1", "targetMultiplicity": "0..*" }]',
  'stereotype: none, interface o abstract. Si no se ve, usa none.',
  'type: association, dependency, aggregation, composition, inheritance, realization.',
  'Si un tipo no se lee, usa string en atributos y void en métodos, y anótalo en warnings.',
  'Si un texto no se lee, no lo inventes. Pon la duda en warnings.',
  'message: dos frases en español sobre lo que viste.',
].join('\n');

const SKETCH_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    classes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          stereotype: { type: 'string' },
          attributes: { type: 'array', items: { type: 'string' } },
          methods: { type: 'array', items: { type: 'string' } },
        },
        required: ['name'],
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          type: { type: 'string' },
          sourceMultiplicity: { type: 'string' },
          targetMultiplicity: { type: 'string' },
        },
        required: ['from', 'to', 'type'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['message', 'classes', 'relationships', 'warnings'],
};

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item !== undefined && item !== null);
}

function memberToLine(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  if (item.signature) return String(item.signature);
  const name = String(item.name || '').trim();
  if (!name) return '';
  const type = String(item.type || item.returnType || item.return || '').trim();
  const params = item.params || item.parameters;
  const looksLikeMethod = Array.isArray(params) || name.includes('(') || /^void$/i.test(type);
  if (looksLikeMethod) {
    const paramText = Array.isArray(params)
      ? params.map((param) => (typeof param === 'string' ? param : param && param.name ? param.name : '')).filter(Boolean).join(', ')
      : '';
    const call = name.includes('(') ? name : name + '(' + paramText + ')';
    return '+ ' + call + ': ' + (type || 'void');
  }
  if (type) return '+ ' + name + ': ' + type;
  return name;
}

function splitMembers(attributes, methods) {
  const attrLines = [];
  const methodLines = [];
  for (const item of asList(attributes).concat(asList(methods))) {
    const text = memberToLine(item);
    if (!text.trim()) continue;
    if (text.includes('(')) {
      const method = normalizeMethod(text);
      if (method) methodLines.push(method);
      continue;
    }
    const attribute = normalizeAttribute(text);
    if (attribute) attrLines.push(attribute);
  }
  return { attributes: attrLines, methods: methodLines };
}

function parentName(item) {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.inheritance === 'string') return item.inheritance.trim();
  if (typeof item.extends === 'string') return item.extends.trim();
  if (typeof item.parent === 'string') return item.parent.trim();
  return '';
}

function classFromSketch(item) {
  if (typeof item === 'string') return { name: item.trim(), stereotype: 'none', attributes: [], methods: [] };
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name || item.className || '').trim();
  if (!name) return null;
  const members = splitMembers(item.attributes, item.methods);
  return {
    name,
    stereotype: item.stereotype,
    attributes: members.attributes,
    methods: members.methods,
    parent: parentName(item),
  };
}

function relationFromSketch(item) {
  if (!item || typeof item !== 'object') return null;
  const from = String(item.from || item.className || item.source || '').trim();
  const to = String(item.to || item.targetClassName || item.target || '').trim();
  const type = String(item.type || item.relationType || 'association').trim();
  if (!from || !to) return null;
  return {
    from,
    to,
    type,
    sourceMultiplicity: item.sourceMultiplicity,
    targetMultiplicity: item.targetMultiplicity,
  };
}

function hasSameName(snapshot, name) {
  const target = name.trim().toLowerCase();
  return snapshot.classes.some((item) => item.name.trim().toLowerCase() === target);
}

function sketchToOperations(sketch, snapshot) {
  const classes = asList(sketch && (sketch.classes || sketch.classBoxes))
    .map(classFromSketch)
    .filter(Boolean);
  const relationships = asList(sketch && (sketch.relationships || sketch.relations))
    .map(relationFromSketch)
    .filter(Boolean);
  const operations = [];
  const warnings = asList(sketch && sketch.warnings).filter((item) => typeof item === 'string');

  for (const classBox of classes) {
    if (hasSameName(snapshot, classBox.name)) {
      warnings.push('La clase «' + classBox.name + '» ya está en el diagrama; no la volví a crear.');
    } else {
      operations.push({
        op: 'class:add',
        className: classBox.name,
        stereotype: classBox.stereotype,
        attributes: classBox.attributes,
        methods: classBox.methods,
      });
    }
    if (classBox.parent) {
      relationships.push({
        from: classBox.name,
        to: classBox.parent,
        type: 'inheritance',
      });
    }
  }

  for (const relation of relationships) {
    operations.push({
      op: 'link:add',
      className: relation.from,
      targetClassName: relation.to,
      relationType: relation.type,
      sourceMultiplicity: relation.sourceMultiplicity,
      targetMultiplicity: relation.targetMultiplicity,
    });
  }

  const message = typeof (sketch && sketch.message) === 'string' && sketch.message.trim()
    ? sketch.message.trim()
    : 'Esto es lo que leí en la imagen.';
  return interpretModelPayload({ message, operations, warnings }, snapshot);
}

function looksLikeSketch(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return Array.isArray(payload.classes)
    || Array.isArray(payload.relationships)
    || Array.isArray(payload.relations);
}

function addClass(classes, name) {
  const existing = classes.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const created = { name, attributes: [], methods: [], stereotype: 'none' };
  classes.push(created);
  return created;
}

function addRelation(relationships, from, to, type, sourceMultiplicity, targetMultiplicity) {
  if (!from || !to) return;
  const duplicate = relationships.some(
    (item) => item.from === from && item.to === to && item.type === type
  );
  if (duplicate) return;
  relationships.push({ from, to, type, sourceMultiplicity, targetMultiplicity });
}

function sketchFromNotes(raw) {
  const text = String(raw || '');
  const classes = [];
  const relationships = [];
  let current = null;
  let section = '';

  for (const line of text.split(/\n/)) {
    const classHit = line.match(/(?:clase|class)\s+`([A-Za-z_][\w]*)`/i)
      || line.match(/(?:clase|class)\s+\*\*`?([A-Z][A-Za-z0-9_]+)`?\*\*/i)
      || line.match(/\b(?:clase|class)\s+([A-Z][A-Za-z0-9_]+)/);
    if (classHit) {
      current = addClass(classes, classHit[1]);
      section = '';
      continue;
    }
    if (/atribut/i.test(line)) section = 'attributes';
    if (/m[eé]todo/i.test(line)) section = 'methods';
    const member = line.match(/`\s*([+\-#~][^`]+)`/);
    if (member && current) {
      const body = member[1].trim();
      if (body.includes('(') || section === 'methods') current.methods.push(body);
      else current.attributes.push(body);
    }
    const assoc = line.match(/asociaci[oó]n con `([A-Za-z_][\w]*)`/i);
    if (assoc && current) {
      addClass(classes, assoc[1]);
      addRelation(relationships, current.name, assoc[1], 'association');
    }
    const inherit = line.match(/hereda(?:n)? de `([A-Za-z_][\w]*)`/i)
      || line.match(/inherit\w* from `([A-Za-z_][\w]*)`/i);
    if (inherit && current) {
      addClass(classes, inherit[1]);
      addRelation(relationships, current.name, inherit[1], 'inheritance');
    }
  }

  const pairInherit = [...text.matchAll(/`([A-Za-z_][\w]*)`\s+y\s+`([A-Za-z_][\w]*)`[^.\n]{0,40}hered/gi)];
  for (const match of pairInherit) {
    const parent = text.match(/de `([A-Za-z_][\w]*)`/i);
    if (!parent) continue;
    addClass(classes, match[1]);
    addClass(classes, match[2]);
    addRelation(relationships, match[1], parent[1], 'inheritance');
    addRelation(relationships, match[2], parent[1], 'inheritance');
  }

  return {
    message: classes.length ? 'Leí las clases y relaciones visibles en la imagen.' : 'No reconocí clases en la imagen.',
    classes,
    relationships,
    warnings: [],
  };
}

module.exports = {
  SKETCH_SYSTEM,
  SKETCH_SCHEMA,
  memberToLine,
  sketchToOperations,
  sketchFromNotes,
  looksLikeSketch,
};
