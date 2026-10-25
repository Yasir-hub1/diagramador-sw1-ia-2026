const { interpretModelPayload } = require('./operationPlan');
const { interpretArchitectPayload, looksLikeArchitectPayload } = require('./architectContract');
const { sketchToOperations, looksLikeSketch, memberToLine } = require('./imageSketch');

function asList(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [];
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function flattenMembers(value) {
  return asList(value).map(memberToLine).filter(Boolean);
}

function coerceOperation(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const op = asText(item.op);
  if (op.startsWith('class:') || op.startsWith('link:')) {
    const mapped = { ...item, op };
    if (item.attributes) mapped.attributes = flattenMembers(item.attributes);
    if (item.methods) mapped.methods = flattenMembers(item.methods);
    return mapped;
  }
  if (op.startsWith('add_') || op.startsWith('update_') || op.startsWith('remove_')) return item;

  const name = asText(item.className || item.name || item.label);
  const kind = asText(item.type).toLowerCase();
  if (name && (kind === 'class' || kind === 'interface' || kind === 'abstract_class' || item.attributes || item.methods)) {
    return {
      op: 'class:add',
      className: name,
      stereotype: item.stereotype || (kind === 'interface' ? 'interface' : kind === 'abstract_class' ? 'abstract' : 'none'),
      attributes: flattenMembers(item.attributes),
      methods: flattenMembers(item.methods),
    };
  }
  const from = asText(item.from || item.source || item.className);
  const to = asText(item.to || item.target || item.targetClassName);
  if (from && to && from !== to) {
    return {
      op: 'link:add',
      className: from,
      targetClassName: to,
      relationType: item.relationType || item.type || 'association',
      sourceMultiplicity: item.sourceMultiplicity,
      targetMultiplicity: item.targetMultiplicity,
    };
  }
  return null;
}

function unreadResult() {
  return {
    reply: 'La IA local devolvió una respuesta que no se pudo leer.',
    warnings: [],
    prepared: null,
    status: 'error',
    needsClarification: false,
  };
}

function interpretReply(payload, snapshot, options) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return unreadResult();

  const status = asText(payload.status) || 'ok';
  const operations = asList(payload.operations).map(coerceOperation).filter(Boolean);
  const hasArchitectOp = operations.some((item) => {
    const op = asText(item.op);
    return op.startsWith('add_') || op.startsWith('update_') || op.startsWith('remove_');
  });

  if (status === 'needs_clarification' && operations.length === 0) {
    return interpretArchitectPayload(payload, snapshot, options);
  }
  if (hasArchitectOp) {
    return interpretArchitectPayload({ ...payload, operations: asList(payload.operations) }, snapshot, options);
  }
  if (operations.length === 0 && looksLikeSketch(payload)) {
    return sketchToOperations(payload, snapshot);
  }
  if (operations.length === 0 && looksLikeArchitectPayload(payload)) {
    return interpretArchitectPayload(payload, snapshot, options);
  }

  const result = interpretModelPayload(
    {
      message: asText(payload.message) || asText(payload.explanation),
      operations,
      warnings: payload.warnings,
    },
    snapshot,
    options
  );
  result.status = status;
  result.needsClarification = false;
  return result;
}

module.exports = { coerceOperation, interpretReply };
