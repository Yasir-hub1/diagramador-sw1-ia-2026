// diagramMutations.js
// Lógica de mutación del diagrama compartida por los eventos de socket
// disparados por botones (con eco evitado vía excludeSocket) y por el
// asistente de IA (sin excludeSocket, porque el solicitante no aplicó
// nada localmente de antemano y también debe recibir el cambio).
const diagramsRepository = require('./repositories/diagramsRepository');
const validators = require('../public/uml-validators');
const graphStore = require('./diagramGraph');

function roomName(shareToken) {
  return 'diagram:' + shareToken;
}

function broadcast(io, ctx, event, payload) {
  const emitter = ctx.excludeSocket ? ctx.excludeSocket.to(roomName(ctx.shareToken)) : io.to(roomName(ctx.shareToken));
  emitter.emit(event, payload);
}

async function recordActivity(io, ctx, actionType, elementId, elementLabel, payload) {
  try {
    await diagramsRepository.logActivity({
      diagramId: ctx.diagramId,
      userId: ctx.userId,
      userName: ctx.userName,
      actionType,
      elementId,
      elementLabel,
      payload,
    });
    io.to(roomName(ctx.shareToken)).emit('activity:editor', {
      elementId,
      userName: ctx.userName,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err.message);
  }
}

function validateClassPayload(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.elementId) return false;
  if (data.stereotype && !validators.validateStereotype(data.stereotype)) return false;
  const attributes = data.attributes || [];
  const methods = data.methods || [];
  if (!Array.isArray(attributes) || !attributes.every(validators.validateAttribute)) return false;
  if (!Array.isArray(methods) || !methods.every(validators.validateMethod)) return false;
  return true;
}

function validateLinkPayload(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.linkId || !data.sourceId || !data.targetId) return false;
  if (!validators.validateRelationType(data.type)) return false;
  if (data.sourceMultiplicity && !validators.validateMultiplicity(data.sourceMultiplicity)) return false;
  if (data.targetMultiplicity && !validators.validateMultiplicity(data.targetMultiplicity)) return false;
  return true;
}

async function persistOrFail(ctx, mutate) {
  try {
    return { ok: true, graphJson: await graphStore.persistMutation(ctx.diagramId, mutate) };
  } catch (error) {
    return { ok: false, message: error.message || 'No se pudo persistir el diagrama.' };
  }
}

async function applyClassAdd(io, ctx, data) {
  if (!validateClassPayload(data)) return { ok: false, message: 'Clase inválida' };
  const persisted = await persistOrFail(ctx, (graph) => graphStore.addClassCell(graph, data));
  if (!persisted.ok) return persisted;
  broadcast(io, ctx, 'class:added', { ...data, userId: ctx.userId, userName: ctx.userName });
  await recordActivity(io, ctx, 'class:add', data.elementId, data.name, data);
  return persisted;
}

async function applyClassUpdate(io, ctx, data) {
  if (!data || !data.elementId) return { ok: false, message: 'Clase inválida' };
  const patch = data.patch || {};
  if (patch.attributes && !patch.attributes.every(validators.validateAttribute)) {
    return { ok: false, message: 'Atributo con formato UML inválido' };
  }
  if (patch.methods && !patch.methods.every(validators.validateMethod)) {
    return { ok: false, message: 'Método con formato UML inválido' };
  }
  if (patch.stereotype && !validators.validateStereotype(patch.stereotype)) {
    return { ok: false, message: 'Estereotipo inválido' };
  }
  const persisted = await persistOrFail(ctx, (graph) => graphStore.updateClassCell(graph, data));
  if (!persisted.ok) return persisted;
  broadcast(io, ctx, 'class:updated', { ...data, userId: ctx.userId, userName: ctx.userName });
  await recordActivity(io, ctx, 'class:update', data.elementId, patch.name, data);
  return persisted;
}

async function applyClassRemove(io, ctx, data) {
  if (!data || !data.elementId) return { ok: false, message: 'Clase inválida' };
  const persisted = await persistOrFail(ctx, (graph) => graphStore.removeCell(graph, data.elementId));
  if (!persisted.ok) return persisted;
  broadcast(io, ctx, 'class:removed', { ...data, userId: ctx.userId, userName: ctx.userName });
  await recordActivity(io, ctx, 'class:remove', data.elementId, null, data);
  return persisted;
}

async function applyLinkAdd(io, ctx, data) {
  if (!validateLinkPayload(data)) return { ok: false, message: 'Relación inválida' };
  const persisted = await persistOrFail(ctx, (graph) => graphStore.addLinkCell(graph, data));
  if (!persisted.ok) return persisted;
  broadcast(io, ctx, 'link:added', { ...data, userId: ctx.userId, userName: ctx.userName });
  await recordActivity(io, ctx, 'link:add', data.linkId, data.type, data);
  return persisted;
}

async function applyLinkUpdate(io, ctx, data) {
  if (!data || !data.linkId) return { ok: false, message: 'Relación inválida' };
  const patch = data.patch || {};
  if (patch.sourceMultiplicity && !validators.validateMultiplicity(patch.sourceMultiplicity)) {
    return { ok: false, message: 'Multiplicidad inválida' };
  }
  if (patch.targetMultiplicity && !validators.validateMultiplicity(patch.targetMultiplicity)) {
    return { ok: false, message: 'Multiplicidad inválida' };
  }
  const persisted = await persistOrFail(ctx, (graph) => graphStore.updateLinkCell(graph, data));
  if (!persisted.ok) return persisted;
  broadcast(io, ctx, 'link:updated', { ...data, userId: ctx.userId, userName: ctx.userName });
  await recordActivity(io, ctx, 'link:update', data.linkId, null, data);
  return persisted;
}

async function applyLinkRemove(io, ctx, data) {
  if (!data || !data.linkId) return { ok: false, message: 'Relación inválida' };
  const persisted = await persistOrFail(ctx, (graph) => graphStore.removeCell(graph, data.linkId));
  if (!persisted.ok) return persisted;
  broadcast(io, ctx, 'link:removed', { ...data, userId: ctx.userId, userName: ctx.userName });
  await recordActivity(io, ctx, 'link:remove', data.linkId, null, data);
  return persisted;
}

module.exports = {
  roomName,
  validateClassPayload,
  validateLinkPayload,
  applyClassAdd,
  applyClassUpdate,
  applyClassRemove,
  applyLinkAdd,
  applyLinkUpdate,
  applyLinkRemove,
};
