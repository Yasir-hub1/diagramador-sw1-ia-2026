const diagramsRepository = require('../repositories/diagramsRepository');
const { snapshotFromGraph, fingerprintOf } = require('../../public/diagram-snapshot');
const { runDiagramAgent } = require('./diagramAgent');
const proposalStore = require('./proposalStore');
const { LocalAiError } = require('./errors');
const { MAX_INSTRUCTION_LENGTH, assertDiagramProvider } = require('./settings');
const { classifyIntent } = require('./intent');
const roomChat = require('./roomChat');

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

function displayText(text, imageBase64, source) {
  const instruction = String(text || '').trim();
  if (imageBase64 && instruction) return instruction + '\n[imagen adjunta]';
  if (imageBase64) return 'Imagen de diagrama adjunta.';
  if (source === 'voice' && instruction) return instruction;
  return instruction;
}

async function createDiagramProposal({ userId, userName, shareToken, text, imageBase64, source }) {
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
  const intent = classifyIntent(instruction, { hasImage: Boolean(imageBase64) });
  const previous = await roomChat.listMessages(diagram.id);
  const userMessage = await roomChat.appendMessage(diagram, {
    role: 'user',
    userId,
    userName: userName || 'Integrante',
    text: displayText(instruction, imageBase64, source),
    kind: imageBase64 ? 'image' : source === 'voice' ? 'voice' : 'text',
  });

  let interpreted;
  try {
    interpreted = await runDiagramAgent({
      text: instruction || IMAGE_INSTRUCTION,
      snapshot,
      imageBase64,
      history: roomChat.formatHistoryForPrompt(previous),
      intent,
    });
  } catch (error) {
    const failed = await roomChat.appendMessage(diagram, {
      role: 'system',
      userId: null,
      userName: 'TRAZO',
      text: error instanceof LocalAiError ? error.message : 'No se pudo completar la consulta de IA.',
      kind: 'error',
    });
    error.roomMessages = [userMessage, failed];
    throw error;
  }

  const assistantMessage = await roomChat.appendMessage(diagram, {
    role: 'assistant',
    userId: null,
    userName: 'TRAZO',
    text: interpreted.reply,
    kind: interpreted.prepared && interpreted.prepared.length ? 'proposal' : intent,
  });

  if (!interpreted.prepared || interpreted.prepared.length === 0) {
    return {
      proposal: null,
      reply: interpreted.reply,
      warnings: interpreted.warnings,
      needsClarification: Boolean(interpreted.needsClarification),
      intent,
      userMessage,
      assistantMessage,
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
    intent,
    userMessage,
    assistantMessage,
  };
}

module.exports = { createDiagramProposal, loadReadableDiagram, displayText };
