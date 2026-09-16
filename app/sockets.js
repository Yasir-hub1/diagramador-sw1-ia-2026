// sockets.js
const diagramsRepository = require('./repositories/diagramsRepository');
const validators = require('../public/uml-validators');

// Presencia en memoria: shareToken -> Map<socketId, {userId, userName}>
const presenceByRoom = new Map();

// Edición en vivo en memoria: shareToken -> Map<elementId, {userId, userName, socketId}>
const editingByRoom = new Map();

function roomName(shareToken) {
  return 'diagram:' + shareToken;
}

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

    async function recordActivity(actionType, elementId, elementLabel, payload) {
      if (!currentDiagramId) return;
      try {
        await diagramsRepository.logActivity({
          diagramId: currentDiagramId,
          userId,
          userName,
          actionType,
          elementId,
          elementLabel,
          payload,
        });
        io.to(roomName(currentShareToken)).emit('activity:editor', {
          elementId,
          userName,
          at: new Date().toISOString(),
        });
      } catch (err) {
        console.error(err.message);
      }
    }

    socket.on('class:add', (data) => {
      if (!currentShareToken || !validateClassPayload(data)) {
        return socket.emit('error:validation', { message: 'Clase inválida' });
      }
      socket.to(roomName(currentShareToken)).emit('class:added', { ...data, userId, userName });
      recordActivity('class:add', data.elementId, data.name, data);
    });

    socket.on('class:update', (data) => {
      if (!currentShareToken || !data || !data.elementId) {
        return socket.emit('error:validation', { message: 'Clase inválida' });
      }
      const patch = data.patch || {};
      if (patch.attributes && !patch.attributes.every(validators.validateAttribute)) {
        return socket.emit('error:validation', { message: 'Atributo con formato UML inválido' });
      }
      if (patch.methods && !patch.methods.every(validators.validateMethod)) {
        return socket.emit('error:validation', { message: 'Método con formato UML inválido' });
      }
      if (patch.stereotype && !validators.validateStereotype(patch.stereotype)) {
        return socket.emit('error:validation', { message: 'Estereotipo inválido' });
      }
      socket.to(roomName(currentShareToken)).emit('class:updated', { ...data, userId, userName });
      recordActivity('class:update', data.elementId, patch.name, data);
    });

    socket.on('class:remove', (data) => {
      if (!currentShareToken || !data || !data.elementId) return;
      socket.to(roomName(currentShareToken)).emit('class:removed', { ...data, userId, userName });
      recordActivity('class:remove', data.elementId, null, data);
    });

    socket.on('link:add', (data) => {
      if (!currentShareToken || !validateLinkPayload(data)) {
        return socket.emit('error:validation', { message: 'Relación inválida' });
      }
      socket.to(roomName(currentShareToken)).emit('link:added', { ...data, userId, userName });
      recordActivity('link:add', data.linkId, data.type, data);
    });

    socket.on('link:update', (data) => {
      if (!currentShareToken || !data || !data.linkId) return;
      const patch = data.patch || {};
      if (patch.sourceMultiplicity && !validators.validateMultiplicity(patch.sourceMultiplicity)) {
        return socket.emit('error:validation', { message: 'Multiplicidad inválida' });
      }
      if (patch.targetMultiplicity && !validators.validateMultiplicity(patch.targetMultiplicity)) {
        return socket.emit('error:validation', { message: 'Multiplicidad inválida' });
      }
      socket.to(roomName(currentShareToken)).emit('link:updated', { ...data, userId, userName });
      recordActivity('link:update', data.linkId, null, data);
    });

    socket.on('link:remove', (data) => {
      if (!currentShareToken || !data || !data.linkId) return;
      socket.to(roomName(currentShareToken)).emit('link:removed', { ...data, userId, userName });
      recordActivity('link:remove', data.linkId, null, data);
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

module.exports = attachSockets;
