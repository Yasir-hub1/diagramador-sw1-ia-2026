const diagramsRepository = require('../repositories/diagramsRepository');
const { snapshotFromGraph, fingerprintOf } = require('../../public/diagram-snapshot');
const { runDiagramAgent } = require('./diagramAgent');
const proposalStore = require('./proposalStore');
const { LocalAiError } = require('./errors');
const { MAX_INSTRUCTION_LENGTH, assertDiagramProvider } = require('./settings');

const SHARE_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_INSTRUCTION = [
  'Analiza la imagen de un diagrama UML de clases o un boceto.',
  'Identifica solo lo que se lea: clases, estereotipos, atributos, métodos, relaciones y multiplicidades.',
  'Si un texto no se lee, no lo completes. Propón operaciones TRAZO para reflejar lo visible.',
].join(' ');

async function loadReadableDiagram(shareToken, userId) {
  if (!SHARE_TOKEN_RE.test(String(shareToken || ''))) {
    throw new LocalAiError('not_found', 'Sala no encontrada.');
  }
  const diagram = await diagramsRepository.findByToken(shareToken);
  if (!diagram) throw new LocalAiError('not_found', 'Sala no encontrada.');
  const allowed = await diagramsRepository.userCanAccess(diagram.id, diagram.owner_id, userId);
  if (!allowed) throw new LocalAiError('forbidden', 'No tienes acceso a esta sala.');
  return diagram;
}

async function createDiagramProposal({ userId, shareToken, text, imageBase64 }) {
  assertDiagramProvider();
  const instruction = String(text || '').trim();
  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw new LocalAiError('too_long', 'La instrucción supera el límite de 2000 caracteres.');
  }
  if (!instruction && !imageBase64) {
    throw new LocalAiError('rejected', 'Escribe una instrucción o adjunta una imagen.');
  }

  const diagram = await loadReadableDiagram(shareToken, userId);
  const snapshot = snapshotFromGraph(diagram.graph_data);
  const interpreted = await runDiagramAgent({
    text: instruction || IMAGE_INSTRUCTION,
    snapshot,
    imageBase64,
  });
  if (!interpreted.prepared || interpreted.prepared.length === 0) {
    return {
      proposal: null,
      reply: interpreted.reply,
      warnings: interpreted.warnings,
      needsClarification: Boolean(interpreted.needsClarification),
    };
  }

  const proposal = proposalStore.save({
    userId,
    shareToken: diagram.share_token,
    fingerprint: fingerprintOf(snapshot),
    message: interpreted.reply,
    warnings: interpreted.warnings,
    typeNotes: interpreted.typeNotes || [],
    prepared: interpreted.prepared,
  });
  return {
    proposal: proposalStore.toClient(proposal),
    reply: interpreted.reply,
    warnings: interpreted.warnings,
    needsClarification: false,
  };
}

module.exports = { createDiagramProposal, loadReadableDiagram };
