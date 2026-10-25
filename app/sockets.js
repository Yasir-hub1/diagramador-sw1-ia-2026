// sockets.js
const diagramsRepository = require('./repositories/diagramsRepository');
const mutations = require('./diagramMutations');
const { roomName } = mutations;
const { createDiagramProposal } = require('./ai/createProposal');
const proposalStore = require('./ai/proposalStore');
const { applyPreparedSteps } = require('./ai/applyPrepared');
const { snapshotFromGraph, fingerprintOf } = require('../public/diagram-snapshot');
const { LocalAiError } = require('./ai/errors');

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

    function emitAiFailure(generation, error) {
      const reply = error instanceof LocalAiError
        ? error.message
        : 'Ocurrió un error al procesar tu instrucción con la IA.';
      if (!(error instanceof LocalAiError)) {
        console.error(String(error && error.message || 'error').slice(0, 180));
      }
      socket.emit('ai:result', { reply, skipped: [], warnings: [], appliedCount: 0, generation });
    }

    socket.on('ai:command', async ({ text, generation }) => {
      if (!currentShareToken) return;
      try {
        const result = await createDiagramProposal({
          userId,
          shareToken: currentShareToken,
          text,
        });
        if (!result.proposal) {
          socket.emit('ai:result', {
            reply: result.reply,
            skipped: [],
            warnings: result.warnings,
            appliedCount: 0,
            generation,
            needsClarification: Boolean(result.needsClarification),
          });
          return;
        }
        socket.emit('ai:proposal', { ...result.proposal, generation });
      } catch (error) {
        emitAiFailure(generation, error);
      }
    });

    socket.on('ai:apply', async ({ proposalId, fingerprint, generation }) => {
      if (!currentShareToken) return;
      try {
        if (typeof fingerprint !== 'string' || !fingerprint) {
          socket.emit('ai:result', {
            reply: 'No pude comprobar la versión del diagrama. Vuelve a pedir el análisis.',
            skipped: [],
            warnings: [],
            appliedCount: 0,
            generation,
          });
          return;
        }
        const pending = proposalStore.read(proposalId, userId, currentShareToken);
        if (!pending) {
          socket.emit('ai:result', {
            reply: 'La propuesta ya no está disponible. Pide el análisis otra vez.',
            skipped: [],
            warnings: [],
            appliedCount: 0,
            generation,
          });
          return;
        }
        const diagram = await diagramsRepository.findByToken(currentShareToken);
        const currentFingerprint = diagram ? fingerprintOf(snapshotFromGraph(diagram.graph_data)) : '';
        if (currentFingerprint !== pending.fingerprint || fingerprint !== pending.fingerprint) {
          proposalStore.discard(proposalId, userId, currentShareToken);
          socket.emit('ai:result', {
            reply: 'El diagrama cambió mientras se preparaba la propuesta. Vuelve a pedir el análisis.',
            skipped: [],
            warnings: [],
            appliedCount: 0,
            generation,
          });
          return;
        }
        const proposal = proposalStore.take(proposalId, userId, currentShareToken);
        if (!proposal) {
          socket.emit('ai:result', {
            reply: 'La propuesta ya no está disponible. Pide el análisis otra vez.',
            skipped: [],
            warnings: [],
            appliedCount: 0,
            generation,
          });
          return;
        }
        const authorAlsoReceives = buildCtx(false);
        const applied = await applyPreparedSteps(io, authorAlsoReceives, proposal.prepared);
        const stoppedEarly = applied.skipped.length > 0;
        const reply = stoppedEarly
          ? 'Se aplicaron ' + applied.appliedCount + ' cambios y el resto se detuvo.'
          : 'Apliqué ' + applied.appliedCount + ' cambios en la sala.';
        socket.emit('ai:result', {
          reply,
          skipped: applied.skipped,
          warnings: [],
          appliedCount: applied.appliedCount,
          generation,
        });
      } catch (error) {
        emitAiFailure(generation, error);
      }
    });

    socket.on('ai:cancel', ({ proposalId }) => {
      if (!currentShareToken || !proposalId) return;
      proposalStore.discard(proposalId, userId, currentShareToken);
    });

    socket.on('graph:save', async ({ graphJson }, ack) => {
      if (!currentDiagramId || !graphJson) return;
      try {
        await diagramsRepository.updateGraphData(currentDiagramId, graphJson);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        console.error(err.message);
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'No se pudo guardar el diagrama en la base de datos.' });
        }
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
