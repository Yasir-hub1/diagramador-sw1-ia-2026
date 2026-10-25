const validators = require('../../public/uml-validators');
const { maxOperations } = require('./settings');

const ALLOWED_KEYS = {
  'class:add': new Set(['op', 'className', 'stereotype', 'attributes', 'methods', 'position']),
  'class:update': new Set(['op', 'className', 'newClassName', 'stereotype', 'attributes', 'methods']),
  'class:remove': new Set(['op', 'className']),
  'link:add': new Set(['op', 'className', 'targetClassName', 'relationType', 'sourceMultiplicity', 'targetMultiplicity']),
  'link:update': new Set(['op', 'className', 'targetClassName', 'relationType', 'sourceMultiplicity', 'targetMultiplicity']),
  'link:remove': new Set(['op', 'className', 'targetClassName', 'relationType']),
};

const STEREOTYPE_ALIASES = {
  none: 'none',
  ninguno: 'none',
  interface: 'interface',
  interfaz: 'interface',
  abstract: 'abstract',
  abstracta: 'abstract',
  abstracto: 'abstract',
  abstract_class: 'abstract',
};

const RELATION_ALIASES = {
  association: 'association',
  asociacion: 'association',
  asociación: 'association',
  related: 'association',
  relacion: 'association',
  relación: 'association',
  onetomany: 'association',
  onetoone: 'association',
  manytomany: 'association',
  has: 'association',
  dependency: 'dependency',
  dependencia: 'dependency',
  depends: 'dependency',
  usa: 'dependency',
  uses: 'dependency',
  aggregation: 'aggregation',
  agregacion: 'aggregation',
  agregación: 'aggregation',
  contains: 'aggregation',
  contiene: 'aggregation',
  composition: 'composition',
  composicion: 'composition',
  composición: 'composition',
  owns: 'composition',
  inheritance: 'inheritance',
  herencia: 'inheritance',
  generalization: 'inheritance',
  generalizacion: 'inheritance',
  generalización: 'inheritance',
  extends: 'inheritance',
  realization: 'realization',
  realizacion: 'realization',
  realización: 'realization',
};

const RELATION_LABEL = {
  association: 'asociación',
  dependency: 'dependencia',
  aggregation: 'agregación',
  composition: 'composición',
  inheritance: 'herencia',
  realization: 'realización',
};

function quoted(name) {
  return '«' + name + '»';
}

function applyVisibility(text) {
  return text
    .replace(/^(público|publico|public)\b/i, '+')
    .replace(/^(privado|private)\b/i, '-')
    .replace(/^(protegido|protected)\b/i, '#')
    .replace(/^(paquete|package)\b/i, '~');
}

function tidyMember(raw) {
  let text = applyVisibility(String(raw).trim());
  text = text.replace(/^([+\-#~])(?=\S)/, '$1 ');
  if (!/^[+\-#~]\s/.test(text)) text = '+ ' + text;
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeAttribute(raw) {
  if (typeof raw !== 'string') return null;
  let text = tidyMember(raw);
  text = text.replace(/\s*=\s*[^:]+$/, '');
  text = text.replace(/\s*:\s*/, ': ');
  if (!text.includes(':')) text += ': string';
  return validators.validateAttribute(text) ? text : null;
}

function normalizeMethod(raw) {
  if (typeof raw !== 'string') return null;
  let text = tidyMember(raw);
  if (!text.includes('(')) {
    const parts = text.split(' ');
    const name = parts.pop();
    text = parts.concat([name + '()']).join(' ');
  }
  text = text.replace(/\s+\(/, '(');
  text = text.replace(/\)\s*:\s*/, '): ');
  if (!/\):\s/.test(text)) text = text.replace(/\)\s*$/, '): void');
  return validators.validateMethod(text) ? text : null;
}

function normalizeMembers(values, normalizeOne, label) {
  if (values === undefined) return { ok: true, values: undefined };
  if (!Array.isArray(values)) return { ok: false, message: label + ' debe ser una lista.' };
  if (values.length > 40) return { ok: false, message: label + ' supera el límite de 40.' };
  const normalized = [];
  for (const value of values) {
    const line = normalizeOne(value);
    if (!line) {
      return { ok: false, message: 'Formato UML inválido: ' + String(value).slice(0, 80) };
    }
    normalized.push(line);
  }
  return { ok: true, values: normalized };
}

function cleanClassName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) return null;
  return name;
}

function normalizeStereotype(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim().toLowerCase().replace(/[«»<>]/g, '');
  if (!Object.prototype.hasOwnProperty.call(STEREOTYPE_ALIASES, text)) return null;
  return STEREOTYPE_ALIASES[text];
}

function normalizeRelationType(value) {
  if (value === undefined || value === null || value === '') return 'association';
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  const compact = text.replace(/[\s_\-:/]+/g, '');
  return RELATION_ALIASES[text] || RELATION_ALIASES[compact] || 'association';
}

function normalizeMultiplicity(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim().replace(/\s+/g, '');
  if (!validators.validateMultiplicity(text)) return null;
  return text;
}

function cleanPosition(value) {
  if (value === undefined) return { ok: true, position: undefined };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  if (Object.keys(value).some((key) => key !== 'x' && key !== 'y')) return { ok: false };
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false };
  return {
    ok: true,
    position: {
      x: Math.max(0, Math.min(4000, Math.round(x))),
      y: Math.max(0, Math.min(4000, Math.round(y))),
    },
  };
}

function cloneSnapshot(snapshot) {
  return {
    classes: (snapshot.classes || []).map((item) => ({
      ...item,
      attributes: [...(item.attributes || [])],
      methods: [...(item.methods || [])],
      position: { ...(item.position || { x: 0, y: 0 }) },
    })),
    relations: (snapshot.relations || []).map((item) => ({ ...item })),
  };
}

function findClassesByName(snapshot, name) {
  const target = name.toLowerCase();
  return snapshot.classes.filter((item) => item.name.trim().toLowerCase() === target);
}

function requireOneClass(snapshot, name) {
  const found = findClassesByName(snapshot, name);
  if (found.length === 0) return { ok: false, message: 'No encontré la clase ' + quoted(name) + '.' };
  if (found.length > 1) {
    return { ok: false, message: 'Hay más de una clase llamada ' + quoted(name) + '. Aclara cuál es.' };
  }
  return { ok: true, classBox: found[0] };
}

function nextPosition(snapshot) {
  const index = snapshot.classes.length;
  return { x: 80 + (index % 4) * 280, y: 80 + Math.floor(index / 4) * 200 };
}

function generateId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 11);
}

function memberCount(attributes, methods) {
  const parts = [];
  if (attributes.length) parts.push(attributes.length + (attributes.length === 1 ? ' atributo' : ' atributos'));
  if (methods.length) parts.push(methods.length + (methods.length === 1 ? ' método' : ' métodos'));
  return parts.length ? ' con ' + parts.join(' y ') : '';
}

function rememberClass(snapshot, classBox) {
  snapshot.classes.push(classBox);
}

function renameInSnapshot(snapshot, classBox, nextName) {
  const taken = findClassesByName(snapshot, nextName).filter((item) => item.id !== classBox.id);
  if (taken.length) return { ok: false, message: 'Ya existe una clase llamada ' + quoted(nextName) + '.' };
  classBox.name = nextName;
  snapshot.relations.forEach((relation) => {
    if (relation.sourceId === classBox.id) relation.sourceName = nextName;
    if (relation.targetId === classBox.id) relation.targetName = nextName;
  });
  return { ok: true };
}

function removeFromSnapshot(snapshot, classId) {
  snapshot.classes = snapshot.classes.filter((item) => item.id !== classId);
  snapshot.relations = snapshot.relations.filter((item) => item.sourceId !== classId && item.targetId !== classId);
}

function planClassAdd(operation, snapshot) {
  const className = cleanClassName(operation.className);
  if (!className) return { ok: false, message: 'La clase nueva no tiene un nombre válido.' };
  if (findClassesByName(snapshot, className).length) {
    return { ok: false, message: 'La clase ' + quoted(className) + ' ya existe. Pide actualizarla si quieres cambiarla.' };
  }
  const stereotype = normalizeStereotype(operation.stereotype);
  if (stereotype === null) return { ok: false, message: 'Estereotipo inválido para ' + quoted(className) + '.' };
  const attributes = normalizeMembers(operation.attributes, normalizeAttribute, 'Los atributos');
  if (!attributes.ok) return attributes;
  const methods = normalizeMembers(operation.methods, normalizeMethod, 'Los métodos');
  if (!methods.ok) return methods;
  const position = cleanPosition(operation.position);
  if (!position.ok) return { ok: false, message: 'La posición de ' + quoted(className) + ' no es válida.' };

  const classBox = {
    id: generateId('class'),
    name: className,
    stereotype: stereotype || 'none',
    attributes: attributes.values || [],
    methods: methods.values || [],
    position: position.position || nextPosition(snapshot),
  };
  rememberClass(snapshot, classBox);
  return {
    ok: true,
    value: {
      event: 'class:add',
      preview: 'Crear clase ' + quoted(className) + memberCount(classBox.attributes, classBox.methods),
      data: {
        elementId: classBox.id,
        name: classBox.name,
        stereotype: classBox.stereotype,
        attributes: classBox.attributes,
        methods: classBox.methods,
        position: classBox.position,
      },
    },
  };
}

function planClassUpdate(operation, snapshot) {
  const className = cleanClassName(operation.className);
  if (!className) return { ok: false, message: 'Falta el nombre de la clase a actualizar.' };
  const found = requireOneClass(snapshot, className);
  if (!found.ok) return found;
  const classBox = found.classBox;
  const patch = {};
  const changed = [];

  if (operation.newClassName !== undefined) {
    const nextName = cleanClassName(operation.newClassName);
    if (!nextName) return { ok: false, message: 'El nombre nuevo de ' + quoted(className) + ' no es válido.' };
    if (nextName !== classBox.name) {
      const renamed = renameInSnapshot(snapshot, classBox, nextName);
      if (!renamed.ok) return renamed;
      patch.name = nextName;
      changed.push('nombre');
    }
  }

  if (operation.stereotype !== undefined) {
    const stereotype = normalizeStereotype(operation.stereotype);
    if (!stereotype) return { ok: false, message: 'Estereotipo inválido para ' + quoted(className) + '.' };
    classBox.stereotype = stereotype;
    patch.stereotype = stereotype;
    changed.push('estereotipo');
  }

  const attributes = normalizeMembers(operation.attributes, normalizeAttribute, 'Los atributos');
  if (!attributes.ok) return attributes;
  if (attributes.values) {
    classBox.attributes = attributes.values;
    patch.attributes = attributes.values;
    changed.push('atributos');
  }

  const methods = normalizeMembers(operation.methods, normalizeMethod, 'Los métodos');
  if (!methods.ok) return methods;
  if (methods.values) {
    classBox.methods = methods.values;
    patch.methods = methods.values;
    changed.push('métodos');
  }

  if (!changed.length) return { ok: false, message: 'La actualización de ' + quoted(className) + ' no trae cambios.' };
  return {
    ok: true,
    value: {
      event: 'class:update',
      preview: 'Actualizar clase ' + quoted(className) + ': ' + changed.join(', '),
      data: { elementId: classBox.id, patch },
    },
  };
}

function planClassRemove(operation, snapshot) {
  const className = cleanClassName(operation.className);
  if (!className) return { ok: false, message: 'Falta el nombre de la clase a eliminar.' };
  const found = requireOneClass(snapshot, className);
  if (!found.ok) return found;
  removeFromSnapshot(snapshot, found.classBox.id);
  return {
    ok: true,
    value: {
      event: 'class:remove',
      preview: 'Eliminar clase ' + quoted(className),
      data: { elementId: found.classBox.id },
    },
  };
}

function multiplicityPair(operation) {
  const sourceMultiplicity = normalizeMultiplicity(operation.sourceMultiplicity);
  if (sourceMultiplicity === null) return { ok: false, message: 'La multiplicidad de origen no es válida.' };
  const targetMultiplicity = normalizeMultiplicity(operation.targetMultiplicity);
  if (targetMultiplicity === null) return { ok: false, message: 'La multiplicidad de destino no es válida.' };
  return { ok: true, sourceMultiplicity, targetMultiplicity };
}

function relationEnds(operation, snapshot) {
  const sourceName = cleanClassName(operation.className);
  const targetName = cleanClassName(operation.targetClassName);
  if (!sourceName || !targetName) return { ok: false, message: 'La relación necesita clase de origen y de destino.' };
  const relationType = normalizeRelationType(operation.relationType);
  if (!relationType) return { ok: false, message: 'El tipo de relación no está permitido.' };
  const source = requireOneClass(snapshot, sourceName);
  if (!source.ok) return source;
  const target = requireOneClass(snapshot, targetName);
  if (!target.ok) return target;
  return { ok: true, sourceName, targetName, relationType, source: source.classBox, target: target.classBox };
}

function findRelations(snapshot, relationType, sourceId, targetId) {
  return snapshot.relations.filter(
    (item) => item.type === relationType && item.sourceId === sourceId && item.targetId === targetId
  );
}

function multiplicityPreview(sourceMultiplicity, targetMultiplicity) {
  if (!sourceMultiplicity && !targetMultiplicity) return '';
  return ' (' + (sourceMultiplicity || '—') + ' — ' + (targetMultiplicity || '—') + ')';
}

function planLinkAdd(operation, snapshot) {
  const ends = relationEnds(operation, snapshot);
  if (!ends.ok) return ends;
  const multiplicity = multiplicityPair(operation);
  if (!multiplicity.ok) return multiplicity;
  const relation = {
    id: generateId('link'),
    type: ends.relationType,
    sourceId: ends.source.id,
    targetId: ends.target.id,
    sourceName: ends.source.name,
    targetName: ends.target.name,
    sourceMultiplicity: multiplicity.sourceMultiplicity || '',
    targetMultiplicity: multiplicity.targetMultiplicity || '',
  };
  snapshot.relations.push(relation);
  const data = {
    linkId: relation.id,
    type: relation.type,
    sourceId: relation.sourceId,
    targetId: relation.targetId,
  };
  if (multiplicity.sourceMultiplicity) data.sourceMultiplicity = multiplicity.sourceMultiplicity;
  if (multiplicity.targetMultiplicity) data.targetMultiplicity = multiplicity.targetMultiplicity;
  const label = RELATION_LABEL[ends.relationType];
  return {
    ok: true,
    value: {
      event: 'link:add',
      preview:
        'Crear ' +
        label +
        ' de ' +
        quoted(ends.sourceName) +
        ' a ' +
        quoted(ends.targetName) +
        multiplicityPreview(multiplicity.sourceMultiplicity, multiplicity.targetMultiplicity),
      data,
    },
  };
}

function planLinkUpdate(operation, snapshot) {
  const ends = relationEnds(operation, snapshot);
  if (!ends.ok) return ends;
  const multiplicity = multiplicityPair(operation);
  if (!multiplicity.ok) return multiplicity;
  if (!multiplicity.sourceMultiplicity && !multiplicity.targetMultiplicity) {
    return { ok: false, message: 'La actualización de la relación no trae multiplicidades.' };
  }
  const found = findRelations(snapshot, ends.relationType, ends.source.id, ends.target.id);
  if (found.length === 0) {
    return { ok: false, message: 'No encontré esa relación entre ' + quoted(ends.sourceName) + ' y ' + quoted(ends.targetName) + '.' };
  }
  if (found.length > 1) {
    return { ok: false, message: 'Hay varias relaciones iguales entre ' + quoted(ends.sourceName) + ' y ' + quoted(ends.targetName) + '.' };
  }
  const patch = {};
  if (multiplicity.sourceMultiplicity) {
    found[0].sourceMultiplicity = multiplicity.sourceMultiplicity;
    patch.sourceMultiplicity = multiplicity.sourceMultiplicity;
  }
  if (multiplicity.targetMultiplicity) {
    found[0].targetMultiplicity = multiplicity.targetMultiplicity;
    patch.targetMultiplicity = multiplicity.targetMultiplicity;
  }
  return {
    ok: true,
    value: {
      event: 'link:update',
      preview: 'Actualizar ' + RELATION_LABEL[ends.relationType] + ' de ' + quoted(ends.sourceName) + ' a ' + quoted(ends.targetName),
      data: { linkId: found[0].id, patch },
    },
  };
}

function planLinkRemove(operation, snapshot) {
  const ends = relationEnds(operation, snapshot);
  if (!ends.ok) return ends;
  const found = findRelations(snapshot, ends.relationType, ends.source.id, ends.target.id);
  if (found.length === 0) {
    return { ok: false, message: 'No encontré esa relación entre ' + quoted(ends.sourceName) + ' y ' + quoted(ends.targetName) + '.' };
  }
  if (found.length > 1) {
    return { ok: false, message: 'Hay varias relaciones iguales entre ' + quoted(ends.sourceName) + ' y ' + quoted(ends.targetName) + '.' };
  }
  snapshot.relations = snapshot.relations.filter((item) => item.id !== found[0].id);
  return {
    ok: true,
    value: {
      event: 'link:remove',
      preview: 'Eliminar ' + RELATION_LABEL[ends.relationType] + ' de ' + quoted(ends.sourceName) + ' a ' + quoted(ends.targetName),
      data: { linkId: found[0].id },
    },
  };
}

function canonicalizeOperation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'Una operación de la propuesta no tiene el formato esperado.' };
  }
  const declaredOp = typeof raw.op === 'string' ? raw.op : '';
  const declaredType = typeof raw.type === 'string' ? raw.type : '';
  if (declaredOp && declaredType && declaredOp !== declaredType) {
    return { ok: false, message: 'La operación trae tipos contradictorios.' };
  }
  const op = declaredOp || declaredType;
  const nested = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : null;
  const source = nested && raw.className === undefined ? { ...nested, op } : { ...raw, op };
  delete source.type;
  delete source.data;
  return { ok: true, operation: source };
}

function planOperation(raw, snapshot) {
  const canonical = canonicalizeOperation(raw);
  if (!canonical.ok) return canonical;
  const operation = canonical.operation;
  const allowed = ALLOWED_KEYS[operation.op];
  if (!allowed) return { ok: false, message: 'Operación desconocida: ' + String(operation.op || '').slice(0, 40) };
  if (Object.keys(operation).some((key) => !allowed.has(key))) {
    return { ok: false, message: 'La propuesta incluye datos que TRAZO no acepta.' };
  }
  if (operation.op === 'class:add') return planClassAdd(operation, snapshot);
  if (operation.op === 'class:update') return planClassUpdate(operation, snapshot);
  if (operation.op === 'class:remove') return planClassRemove(operation, snapshot);
  if (operation.op === 'link:add') return planLinkAdd(operation, snapshot);
  if (operation.op === 'link:update') return planLinkUpdate(operation, snapshot);
  return planLinkRemove(operation, snapshot);
}

function cleanReply(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 800);
}

function cleanWarnings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim().slice(0, 240))
    .slice(0, 8);
}

function invalid(message, warnings) {
  return { reply: message, warnings, prepared: null };
}

function interpretModelPayload(payload, snapshot, options = {}) {
  const limit = options.maxOperations || maxOperations();
  const warnings = cleanWarnings(payload && payload.warnings);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('La IA local devolvió una respuesta que no se pudo leer.', warnings);
  }
  let operations = payload.operations;
  if (typeof operations === 'string') {
    try {
      operations = JSON.parse(operations);
    } catch (error) {
      return invalid('La IA local no entregó una lista de operaciones.', warnings);
    }
  }
  if (!Array.isArray(operations)) return invalid('La IA local no entregó una lista de operaciones.', warnings);
  if (operations.length > limit) {
    return invalid('La propuesta trae demasiadas operaciones. Pide un cambio más acotado.', warnings);
  }
  const reply = cleanReply(payload.message) || 'Revisa la propuesta antes de aplicarla en la sala.';
  if (operations.length === 0) return { reply, warnings, prepared: [] };

  const working = cloneSnapshot(snapshot);
  const prepared = [];
  for (const raw of operations) {
    const step = planOperation(raw, working);
    if (!step.ok) {
      warnings.push(step.message);
      continue;
    }
    prepared.push(step.value);
  }
  if (operations.length > 0 && prepared.length === 0) {
    return invalid(warnings[0] || 'No pude convertir la respuesta en cambios del diagrama.', warnings.slice(1));
  }
  return { reply, warnings: warnings.slice(0, 8), prepared };
}

module.exports = { interpretModelPayload, normalizeAttribute, normalizeMethod };
