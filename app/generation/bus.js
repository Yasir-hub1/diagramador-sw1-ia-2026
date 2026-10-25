const { roomName } = require('../diagramMutations');

let io = null;

function attachGenerationIo(serverIo) {
  io = serverIo;
}

function emitGeneration(shareToken, event, payload) {
  if (!io) return;
  io.to(roomName(shareToken)).emit(event, payload);
}

module.exports = { attachGenerationIo, emitGeneration };
