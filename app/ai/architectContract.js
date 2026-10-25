const { interpretModelPayload } = require('./operationPlan');

const NODE_LIMIT = 80;
const EDGE_LIMIT = 120;
const MAX_NEW_NODES = 20;

const NODE_TYPE_TO_STEREOTYPE = {
  class: 'none',
  interface: 'interface',
  abstract_class: 'abstract',
  enum: 'none',
};

const STEREOTYPE_TO_NODE_TYPE = {
  none: 'class',
  interface: 'interface',
  abstract: 'abstract_class',
};

const EDGE_TYPE_TO_TRAZO = {
  association: 'association',
  aggregation: 'aggregation',
  composition: 'composition',
  generalization: 'inheritance',
  inheritance: 'inheritance',
  realization: 'realization',
  dependency: 'dependency',
};

const TRAZO_EDGE_TO_ARCHITECT = {
  association: 'association',
  aggregation: 'aggregation',
  composition: 'composition',
  inheritance: 'generalization',
  realization: 'realization',
  dependency: 'dependency',
};

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function visibilityMark(value) {
  const text = asText(value);
  if (/^[+\-#~]$/.test(text)) return text;
  return '+';
}

function parseAttributeLine(line) {
  const text = String(line || '').trim();
  const match = text.match(/^([+\-#~])\s*([^:]+):\s*(.+)$/);
  if (!match) {
    return { visibility: '-', name: text.replace(/^[+\-#~]\s*/, ''), type: 'String' };
  }
  return { visibility: match[1], name: match[2].trim(), type: match[3].trim() };
}

function parseMethodLine(line) {
  const text = String(line || '').trim();
  const match = text.match(/^([+\-#~])\s*([^(]+)\((.*)\)\s*:\s*(.+)$/);
  if (!match) {
    return { visibility: '+', name: text.replace(/^[+\-#~]\s*/, '').replace(/\(.*$/, ''), params: [], returnType: 'void' };
  }
  const params = match[3].trim()
    ? match[3].split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  return { visibility: match[1], name: match[2].trim(), params, returnType: match[4].trim() };
}

function formatAttribute(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  const name = asText(item.name);
  if (!name) return '';
  return visibilityMark(item.visibility || '-') + ' ' + name + ': ' + (asText(item.type) || 'String');
}

function formatParam(param) {
  if (typeof param === 'string') return param;
  if (!param || typeof param !== 'object') return '';
  const name = asText(param.name);
  if (!name) return '';
  const type = asText(param.type);
  return type ? name + ': ' + type : name;
}

function formatMethod(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  const name = asText(item.name);
  if (!name) return '';
  const call = name.includes('(')
    ? name
    : name + '(' + asList(item.params).map(formatParam).filter(Boolean).join(', ') + ')';
  return visibilityMark(item.visibility) + ' ' + call + ': ' + (asText(item.returnType) || 'void');
}

function inferTask(userRequest, snapshot) {
  const text = String(userRequest || '').toLowerCase();
  if (/\b(explica|explícame|explicame|qué hace|que hace|describe)\b/.test(text)) return 'explain';
  if (/\b(sugiere|sugerí|mejora|recomienda)\b/.test(text)) return 'suggest';
  if (/\b(corrige|arregla|repara|valida)\b/.test(text)) return 'fix';
  if (!snapshot.classes.length) return 'create';
  return 'modify';
}

function snapshotToCurrentDiagram(snapshot) {
  const nodes = snapshot.classes.slice(0, NODE_LIMIT).map((item) => ({
    id: item.id,
    type: STEREOTYPE_TO_NODE_TYPE[item.stereotype] || 'class',
    label: item.name,
    attributes: asList(item.attributes).map(parseAttributeLine),
    methods: asList(item.methods).map(parseMethodLine),
    position: item.position || { x: 0, y: 0 },
  }));
  const edges = snapshot.relations.slice(0, EDGE_LIMIT).map((item) => ({
    id: item.id,
    type: TRAZO_EDGE_TO_ARCHITECT[item.type] || item.type,
    source: item.sourceId,
    target: item.targetId,
    label: '',
    sourceMultiplicity: item.sourceMultiplicity || '',
    targetMultiplicity: item.targetMultiplicity || '',
  }));
  return {
    currentDiagram: { nodes, edges },
    truncated: snapshot.classes.length > nodes.length || snapshot.relations.length > edges.length,
  };
}

function buildArchitectRequest({ text, snapshot, imageNotes }) {
  const mapped = snapshotToCurrentDiagram(snapshot);
  const userRequest = imageNotes
    ? [asText(text), 'Notas de la imagen:', imageNotes].filter(Boolean).join('\n')
    : asText(text);
  return {
    envelope: {
      task: inferTask(text, snapshot),
      diagram_type: 'class',
      user_request: userRequest,
      current_diagram: mapped.currentDiagram,
      selection: [],
      constraints: {
        language: 'es',
        max_new_nodes: MAX_NEW_NODES,
        naming_convention: 'PascalCase para clases, camelCase para atributos y métodos',
      },
    },
    truncated: mapped.truncated,
  };
}

function looksLikeTrazoOperations(payload) {
  const operations = asList(payload && payload.operations);
  if (!operations.length) return false;
  return operations.some((item) => item && typeof item.op === 'string' && item.op.includes(':'));
}

function looksLikeArchitectPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (payload.task && payload.current_diagram && !payload.status) return false;
  return Boolean(payload.status) || Boolean(payload.version) || asList(payload.operations).some((item) => {
    return item && typeof item.op === 'string' && !item.op.includes(':');
  });
}

function emptyResult({ reply, warnings, status, needsClarification }) {
  return {
    reply,
    warnings: asList(warnings).filter(Boolean).slice(0, 8),
    prepared: [],
    status: status || 'ok',
    needsClarification: Boolean(needsClarification),
  };
}

function idIndexFromSnapshot(snapshot) {
  const nodes = new Map();
  const edges = new Map();
  snapshot.classes.forEach((item) => {
    const copy = { ...item };
    nodes.set(item.id, copy);
    nodes.set(item.name.trim().toLowerCase(), copy);
  });
  snapshot.relations.forEach((item) => edges.set(item.id, { ...item }));
  return { nodes, edges };
}

function resolveNode(index, token) {
  const key = asText(token);
  if (!key) return null;
  return index.nodes.get(key) || index.nodes.get(key.toLowerCase()) || null;
}

function rememberNode(index, id, classBox) {
  index.nodes.set(id, classBox);
  index.nodes.set(classBox.name.trim().toLowerCase(), classBox);
}

function translateAddNode(operation, index, warnings) {
  const node = operation.node && typeof operation.node === 'object' ? operation.node : {};
  const label = asText(node.label);
  if (!label) return { ok: false, message: 'Falta el nombre de una clase nueva.' };
  const nodeType = asText(node.type) || 'class';
  if (nodeType === 'enum') warnings.push('TRAZO no dibuja enumeraciones: ' + label + ' se propone como clase.');
  if (!NODE_TYPE_TO_STEREOTYPE[nodeType] && nodeType !== 'enum') {
    return { ok: false, message: 'Tipo de nodo no soportado: ' + nodeType };
  }
  const classBox = { id: asText(node.id) || label, name: label };
  rememberNode(index, classBox.id, classBox);
  return {
    ok: true,
    value: {
      op: 'class:add',
      className: label,
      stereotype: NODE_TYPE_TO_STEREOTYPE[nodeType] || 'none',
      attributes: asList(node.attributes).map(formatAttribute).filter(Boolean),
      methods: asList(node.methods).map(formatMethod).filter(Boolean),
    },
  };
}

function translateAddEdge(operation, index) {
  const edge = operation.edge && typeof operation.edge === 'object' ? operation.edge : {};
  const source = resolveNode(index, edge.source);
  const target = resolveNode(index, edge.target);
  if (!source || !target) return { ok: false, message: 'Una relación apunta a una clase que aún no existe.' };
  const architectType = asText(edge.type) || 'association';
  const relationType = EDGE_TYPE_TO_TRAZO[architectType];
  if (!relationType) return { ok: false, message: 'Tipo de relación no soportado: ' + architectType };
  return {
    ok: true,
    value: {
      op: 'link:add',
      className: source.name,
      targetClassName: target.name,
      relationType,
      sourceMultiplicity: asText(edge.sourceMultiplicity) || undefined,
      targetMultiplicity: asText(edge.targetMultiplicity) || undefined,
    },
  };
}

function translateUpdateNode(operation, index) {
  const found = resolveNode(index, operation.id);
  if (!found) return { ok: false, message: 'No encontré el nodo a actualizar.' };
  const changes = operation.changes && typeof operation.changes === 'object' ? operation.changes : {};
  const nextName = asText(changes.label) || found.name;
  const nodeType = asText(changes.type);
  const mapped = {
    op: 'class:update',
    className: found.name,
  };
  if (nextName !== found.name) mapped.newClassName = nextName;
  if (nodeType && NODE_TYPE_TO_STEREOTYPE[nodeType]) mapped.stereotype = NODE_TYPE_TO_STEREOTYPE[nodeType];
  if (changes.attributes) mapped.attributes = asList(changes.attributes).map(formatAttribute).filter(Boolean);
  if (changes.methods) mapped.methods = asList(changes.methods).map(formatMethod).filter(Boolean);
  found.name = nextName;
  rememberNode(index, found.id, found);
  return { ok: true, value: mapped };
}

function translateUpdateEdge(operation, index) {
  const found = index.edges.get(asText(operation.id));
  if (!found) return { ok: false, message: 'No encontré la relación a actualizar.' };
  const changes = operation.changes && typeof operation.changes === 'object' ? operation.changes : {};
  const architectType = asText(changes.type);
  const nextType = architectType ? EDGE_TYPE_TO_TRAZO[architectType] : found.type;
  if (!nextType) return { ok: false, message: 'Tipo de relación no soportado: ' + architectType };
  const source = resolveNode(index, found.sourceId);
  const target = resolveNode(index, found.targetId);
  if (!source || !target) return { ok: false, message: 'La relación a actualizar perdió sus clases.' };
  const sourceMultiplicity = asText(changes.sourceMultiplicity) || found.sourceMultiplicity || undefined;
  const targetMultiplicity = asText(changes.targetMultiplicity) || found.targetMultiplicity || undefined;
  const previousType = found.type;
  found.type = nextType;
  found.sourceMultiplicity = sourceMultiplicity || found.sourceMultiplicity;
  found.targetMultiplicity = targetMultiplicity || found.targetMultiplicity;
  if (nextType !== previousType) {
    return {
      ok: true,
      values: [
        { op: 'link:remove', className: source.name, targetClassName: target.name, relationType: previousType },
        {
          op: 'link:add',
          className: source.name,
          targetClassName: target.name,
          relationType: nextType,
          sourceMultiplicity,
          targetMultiplicity,
        },
      ],
    };
  }
  return {
    ok: true,
    value: {
      op: 'link:update',
      className: source.name,
      targetClassName: target.name,
      relationType: nextType,
      sourceMultiplicity,
      targetMultiplicity,
    },
  };
}

function translateRemoveNode(operation, index) {
  const found = resolveNode(index, operation.id);
  if (!found) return { ok: false, message: 'No encontré la clase a eliminar.' };
  return { ok: true, value: { op: 'class:remove', className: found.name } };
}

function translateRemoveEdge(operation, index) {
  const found = index.edges.get(asText(operation.id));
  if (!found) return { ok: false, message: 'No encontré la relación a eliminar.' };
  const source = resolveNode(index, found.sourceId);
  const target = resolveNode(index, found.targetId);
  if (!source || !target) return { ok: false, message: 'La relación a eliminar perdió sus clases.' };
  return {
    ok: true,
    value: {
      op: 'link:remove',
      className: source.name,
      targetClassName: target.name,
      relationType: found.type,
    },
  };
}

function translateOperation(operation, index, warnings) {
  const op = asText(operation && operation.op);
  if (op === 'add_node') return translateAddNode(operation, index, warnings);
  if (op === 'add_edge') return translateAddEdge(operation, index);
  if (op === 'update_node') return translateUpdateNode(operation, index);
  if (op === 'update_edge') return translateUpdateEdge(operation, index);
  if (op === 'remove_node') return translateRemoveNode(operation, index);
  if (op === 'remove_edge') return translateRemoveEdge(operation, index);
  return { ok: false, message: 'Operación desconocida: ' + op.slice(0, 40) };
}

function translatedOps(translated) {
  if (!translated.ok) return translated;
  return { ok: true, values: translated.values || [translated.value] };
}

function architectToTrazo(payload, snapshot) {
  const warnings = asList(payload.warnings).filter((item) => typeof item === 'string' && item.trim());
  const operations = [];
  const index = idIndexFromSnapshot(snapshot);
  asList(payload.operations).forEach((operation) => {
    const translated = translatedOps(translateOperation(operation, index, warnings));
    if (!translated.ok) {
      warnings.push(translated.message);
      return;
    }
    translated.values.forEach((step) => operations.push(step));
  });
  return {
    message: asText(payload.explanation) || asText(payload.message),
    operations,
    warnings,
  };
}

function interpretArchitectPayload(payload, snapshot, options) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return emptyResult({
      reply: 'La IA local devolvió una respuesta que no se pudo leer.',
      status: 'error',
    });
  }
  const status = asText(payload.status) || 'ok';
  const question = asText(payload.clarification_question);
  if (status === 'needs_clarification') {
    return emptyResult({
      reply: question || asText(payload.explanation) || 'Necesito un dato más para cambiar el diagrama.',
      warnings: payload.warnings,
      status,
      needsClarification: true,
    });
  }
  if (status === 'error') {
    return emptyResult({
      reply: asText(payload.explanation) || 'Esa petición no se puede convertir en un diagrama de clases.',
      warnings: payload.warnings,
      status,
    });
  }
  const mapped = looksLikeTrazoOperations(payload)
    ? { message: asText(payload.message) || asText(payload.explanation), operations: payload.operations, warnings: payload.warnings }
    : architectToTrazo(payload, snapshot);
  const result = interpretModelPayload(mapped, snapshot, options);
  result.status = status;
  result.needsClarification = false;
  return result;
}

module.exports = {
  MAX_NEW_NODES,
  buildArchitectRequest,
  inferTask,
  interpretArchitectPayload,
  looksLikeArchitectPayload,
  snapshotToCurrentDiagram,
};
