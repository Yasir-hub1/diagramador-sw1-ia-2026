// sockets.js
const diagramsRepository = require('./repositories/diagramsRepository');
const mutations = require('./diagramMutations');
const { roomName } = mutations;
const { createDiagramProposal } = require('./ai/createProposal');
const proposalStore = require('./ai/proposalStore');
const { applyPreparedSteps } = require('./ai/applyPrepared');
const roomChat = require('./ai/roomChat');
const { emitGeneration } = require('./generation/bus');
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
        socket.emit('ai:history', { messages: await roomChat.listMessages(diagram.id) });

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

    function broadcastAi(event, payload) {
      if (!currentShareToken) return;
      emitGeneration(currentShareToken, event, payload);
    }

    async function emitAiFailure(generation, error) {
      const reply = error instanceof LocalAiError
        ? error.message
        : 'Ocurrió un error al procesar tu instrucción con la IA.';
      if (!(error instanceof LocalAiError)) {
        console.error(String(error && error.message || 'error').slice(0, 180));
      }
      (error.roomMessages || []).forEach((message) => broadcastAi('ai:message', message));
      if (!error.roomMessages) {
        broadcastAi('ai:result', { reply, skipped: [], warnings: [], appliedCount: 0, generation });
      } else {
        broadcastAi('ai:result', { reply, skipped: [], warnings: [], appliedCount: 0, generation });
      }
      broadcastAi('ai:idle', {});
    }

    socket.on('ai:command', async ({ text, generation, source }) => {
      if (!currentShareToken) return;
      broadcastAi('ai:busy', { authorName: userName });
      try {
        const result = await createDiagramProposal({
          userId,
          userName,
          shareToken: currentShareToken,
          text,
          source,
        });
        broadcastAi('ai:message', result.userMessage);
        broadcastAi('ai:message', result.assistantMessage);
        if (result.proposal) {
          broadcastAi('ai:proposal', { ...result.proposal, generation, authorName: userName });
        } else {
          broadcastAi('ai:result', {
            reply: result.reply,
            skipped: [],
            warnings: result.warnings,
            appliedCount: 0,
            generation,
            needsClarification: Boolean(result.needsClarification),
          });
        }
      } catch (error) {
        await emitAiFailure(generation, error);
      } finally {
        broadcastAi('ai:idle', {});
      }
    });

    socket.on('ai:apply', async ({ proposalId, fingerprint, generation }) => {
      if (!currentShareToken) return;
      try {
        if (typeof fingerprint !== 'string' || !fingerprint) {
          broadcastAi('ai:result', {
            reply: 'No pude comprobar la versión del diagrama. Vuelve a pedir el análisis.',
            skipped: [],
            warnings: [],
            appliedCount: 0,
            generation,
          });
          return;
        }
        const pending = proposalStore.read(proposalId, currentShareToken);
        if (!pending) {
          broadcastAi('ai:result', {
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
          proposalStore.discard(proposalId, currentShareToken);
          broadcastAi('ai:result', {
            reply: 'El diagrama cambió mientras se preparaba la propuesta. Vuelve a pedir el análisis.',
            skipped: [],
            warnings: [],
            appliedCount: 0,
            generation,
          });
          return;
        }
        const proposal = proposalStore.take(proposalId, currentShareToken);
        if (!proposal) {
          broadcastAi('ai:result', {
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
          ? userName + ' aplicó ' + applied.appliedCount + ' cambios y el resto se detuvo.'
          : userName + ' aplicó ' + applied.appliedCount + ' cambios en la sala.';
        if (diagram) {
          const note = await roomChat.appendMessage(diagram, {
            role: 'system',
            userId,
            userName,
            text: reply,
            kind: 'applied',
          });
          broadcastAi('ai:message', note);
        }
        broadcastAi('ai:result', {
          reply,
          skipped: applied.skipped,
          warnings: [],
          appliedCount: applied.appliedCount,
          generation,
        });
      } catch (error) {
        await emitAiFailure(generation, error);
      }
    });

    socket.on('ai:cancel', async ({ proposalId }) => {
      if (!currentShareToken || !proposalId) return;
      proposalStore.discard(proposalId, currentShareToken);
      const diagram = currentDiagramId ? { id: currentDiagramId } : null;
      if (diagram) {
        const note = await roomChat.appendMessage(diagram, {
          role: 'system',
          userId,
          userName,
          text: userName + ' canceló la propuesta.',
          kind: 'cancel',
        });
        broadcastAi('ai:message', note);
      }
      broadcastAi('ai:result', { reply: '', skipped: [], warnings: [], appliedCount: 0 });
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
