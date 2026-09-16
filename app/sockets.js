// sockets.js
const diagramsRepository = require('./repositories/diagramsRepository');
const mutations = require('./diagramMutations');
const { roomName } = mutations;
const { runDiagramAgent } = require('./ai/diagramAgent');

// Presencia en memoria: shareToken -> Map<socketId, {userId, userName}>
const presenceByRoom = new Map();

// Edición en vivo en memoria: shareToken -> Map<elementId, {userId, userName, socketId}>
const editingByRoom = new Map();

function getPresenceList(shareToken) {
  const room = presenceByRoom.get(shareToken);
  if (!room) return [];
  return Array.from(room.values());
}

function getActiveEditors(shareToken) {
  const room = editingByRoom.get(shareToken);
  if (!room) return {};
  const result = {};
  room.forEach((value, elementId) => {
    result[elementId] = { userId: value.userId, userName: value.userName };
  });
  return result;
}

function attachSockets(io, sessionMiddleware) {
  io.engine.use(sessionMiddleware);

  io.use((socket, next) => {
    const session = socket.request.session;
    if (!session || !session.userId) {
      return next(new Error('No autenticado'));
    }
    next();
  });

  io.on('connection', (socket) => {
    const session = socket.request.session;
    const userId = session.userId;
    const userName = session.userName;
    let currentShareToken = null;
    let currentDiagramId = null;

    function buildCtx(excludeSocket) {
      return {
        shareToken: currentShareToken,
        diagramId: currentDiagramId,
        userId,
        userName,
        excludeSocket: excludeSocket ? socket : null,
      };
    }

    socket.on('room:join', async ({ shareToken }) => {
      try {
        const diagram = await diagramsRepository.findByToken(shareToken);
        if (!diagram) {
          socket.emit('error:validation', { message: 'Sala no encontrada' });
          return;
        }
        currentShareToken = shareToken;
        currentDiagramId = diagram.id;
        socket.join(roomName(shareToken));

        if (!presenceByRoom.has(shareToken)) {
          presenceByRoom.set(shareToken, new Map());
        }
        presenceByRoom.get(shareToken).set(socket.id, { userId, userName });

        const lastEditors = await diagramsRepository.getLastEditors(diagram.id);

        socket.emit('room:state', {
          graphJson: diagram.graph_data,
          users: getPresenceList(shareToken),
          lastEditors,
          activeEditors: getActiveEditors(shareToken),
        });

        io.to(roomName(shareToken)).emit('presence:update', {
          users: getPresenceList(shareToken),
        });
      } catch (err) {
        console.error(err.message);
        socket.emit('error:validation', { message: 'Error al unirse a la sala' });
      }
    });

    socket.on('class:add', async (data) => {
      if (!currentShareToken) return;
      const result = await mutations.applyClassAdd(io, buildCtx(true), data);
      if (!result.ok) socket.emit('error:validation', { message: result.message });
    });

    socket.on('class:update', async (data) => {
      if (!currentShareToken) return;
      const result = await mutations.applyClassUpdate(io, buildCtx(true), data);
      if (!result.ok) socket.emit('error:validation', { message: result.message });
    });

    socket.on('class:remove', async (data) => {
      if (!currentShareToken) return;
      await mutations.applyClassRemove(io, buildCtx(true), data);
    });

    socket.on('link:add', async (data) => {
      if (!currentShareToken) return;
      const result = await mutations.applyLinkAdd(io, buildCtx(true), data);
      if (!result.ok) socket.emit('error:validation', { message: result.message });
    });

    socket.on('link:update', async (data) => {
      if (!currentShareToken) return;
      const result = await mutations.applyLinkUpdate(io, buildCtx(true), data);
      if (!result.ok) socket.emit('error:validation', { message: result.message });
    });

    socket.on('link:remove', async (data) => {
      if (!currentShareToken) return;
      await mutations.applyLinkRemove(io, buildCtx(true), data);
    });

    socket.on('ai:command', async ({ text, context }) => {
      if (!currentShareToken) return;
      try {
        const { reply, operations } = await runDiagramAgent(text, context);
        const skipped = [];
        for (const op of operations) {
          const result = await applyAiOperation(io, buildCtx(false), op, context);
          if (!result.ok) skipped.push(result.message);
        }
        socket.emit('ai:result', { reply, skipped });
      } catch (err) {
        console.error(err.message);
        socket.emit('ai:result', { reply: 'Ocurrió un error al procesar tu instrucción con la IA.', skipped: [] });
      }
    });

    socket.on('graph:save', async ({ graphJson }, ack) => {
      if (!currentDiagramId || !graphJson) return;
      try {
        await diagramsRepository.updateGraphData(currentDiagramId, graphJson);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        console.error(err.message);
        if (typeof ack === 'function') ack({ ok: false });
      }
    });

    socket.on('element:editing:start', ({ elementId }) => {
      if (!currentShareToken || !elementId) return;
      if (!editingByRoom.has(currentShareToken)) {
        editingByRoom.set(currentShareToken, new Map());
      }
      editingByRoom.get(currentShareToken).set(elementId, { userId, userName, socketId: socket.id });
      socket.to(roomName(currentShareToken)).emit('element:editing:started', { elementId, userId, userName });
    });

    socket.on('element:editing:end', ({ elementId }) => {
      if (!currentShareToken || !elementId) return;
      const room = editingByRoom.get(currentShareToken);
      if (room) room.delete(elementId);
      socket.to(roomName(currentShareToken)).emit('element:editing:ended', { elementId, userId, userName });
    });

    socket.on('disconnect', () => {
      if (!currentShareToken) return;
      const room = presenceByRoom.get(currentShareToken);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) {
          presenceByRoom.delete(currentShareToken);
        }
      }
      io.to(roomName(currentShareToken)).emit('presence:update', {
        users: getPresenceList(currentShareToken),
      });

      const editingRoom = editingByRoom.get(currentShareToken);
      if (editingRoom) {
        editingRoom.forEach((editor, elementId) => {
          if (editor.socketId === socket.id) {
            editingRoom.delete(elementId);
            io.to(roomName(currentShareToken)).emit('element:editing:ended', { elementId, userId, userName });
          }
        });
      }
    });
  });
}

// ---------- Resolución de operaciones de la IA (nombres -> IDs) ----------

function generateId(prefix) {
  return prefix + '_' + Math.random().toString(36).substr(2, 9);
}

function findClassByName(context, name) {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  return (context.classes || []).find((c) => c.name.trim().toLowerCase() === target) || null;
}

function findLinkByNames(context, relationType, sourceName, targetName) {
  const source = findClassByName(context, sourceName);
  const target = findClassByName(context, targetName);
  if (!source || !target) return null;
  return (context.relations || []).find(
    (r) => r.type === relationType && r.sourceId === source.id && r.targetId === target.id
  ) || null;
}

async function applyAiOperation(io, ctx, op, context) {
  switch (op.op) {
    case 'class:add': {
      if (!op.className) return { ok: false, message: 'La IA no indicó el nombre de la clase a crear.' };
      const data = {
        elementId: generateId('class'),
        name: op.className,
        stereotype: op.stereotype || 'none',
        attributes: op.attributes || [],
        methods: op.methods || [],
        position: { x: 80 + Math.round(Math.random() * 300), y: 60 + Math.round(Math.random() * 300) },
      };
      const result = await mutations.applyClassAdd(io, ctx, data);
      return result.ok ? result : { ok: false, message: `No pude crear "${op.className}": ${result.message}` };
    }
    case 'class:update': {
      const existing = findClassByName(context, op.className);
      if (!existing) return { ok: false, message: `No encontré la clase "${op.className}".` };
      const patch = {};
      if (op.newClassName) patch.name = op.newClassName;
      if (op.stereotype) patch.stereotype = op.stereotype;
      if (op.attributes) patch.attributes = op.attributes;
      if (op.methods) patch.methods = op.methods;
      const result = await mutations.applyClassUpdate(io, ctx, { elementId: existing.id, patch });
      return result.ok ? result : { ok: false, message: `No pude actualizar "${op.className}": ${result.message}` };
    }
    case 'class:remove': {
      const existing = findClassByName(context, op.className);
      if (!existing) return { ok: false, message: `No encontré la clase "${op.className}" para eliminar.` };
      return mutations.applyClassRemove(io, ctx, { elementId: existing.id });
    }
    case 'link:add': {
      const source = findClassByName(context, op.className);
      const target = findClassByName(context, op.targetClassName);
      if (!source || !target) {
        return { ok: false, message: `No pude crear la relación: clase(s) "${op.className}"/"${op.targetClassName}" no encontradas.` };
      }
      const data = {
        linkId: generateId('link'),
        type: op.relationType,
        sourceId: source.id,
        targetId: target.id,
        sourceMultiplicity: op.sourceMultiplicity,
        targetMultiplicity: op.targetMultiplicity,
      };
      const result = await mutations.applyLinkAdd(io, ctx, data);
      return result.ok ? result : { ok: false, message: `No pude crear la relación: ${result.message}` };
    }
    case 'link:update': {
      const link = findLinkByNames(context, op.relationType, op.className, op.targetClassName);
      if (!link) return { ok: false, message: `No encontré la relación ${op.relationType} entre "${op.className}" y "${op.targetClassName}".` };
      const patch = {};
      if (op.sourceMultiplicity !== undefined) patch.sourceMultiplicity = op.sourceMultiplicity;
      if (op.targetMultiplicity !== undefined) patch.targetMultiplicity = op.targetMultiplicity;
      return mutations.applyLinkUpdate(io, ctx, { linkId: link.id, patch });
    }
    case 'link:remove': {
      const link = findLinkByNames(context, op.relationType, op.className, op.targetClassName);
      if (!link) return { ok: false, message: `No encontré la relación ${op.relationType} entre "${op.className}" y "${op.targetClassName}" para eliminar.` };
      return mutations.applyLinkRemove(io, ctx, { linkId: link.id });
    }
    default:
      return { ok: false, message: `Operación desconocida: ${op.op}` };
  }
}

module.exports = attachSockets;
