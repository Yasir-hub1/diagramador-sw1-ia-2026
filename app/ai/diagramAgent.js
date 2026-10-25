const { generateDiagramResponse } = require('./diagramModel');
const { pickContractPayload, isDiagramEcho, isInputEcho } = require('./jsonText');
const { sketchToOperations, sketchFromNotes } = require('./imageSketch');
const { SYSTEM_PROMPT, RESPONSE_SCHEMA } = require('./umlRole');
const { interpretReply } = require('./adaptReply');
const { usesOpenAiDiagrams } = require('./settings');

const CLASS_LIMIT = 80;
const RELATION_LIMIT = 120;

function compactSnapshot(snapshot) {
  const classes = snapshot.classes.slice(0, CLASS_LIMIT).map((item) => ({
    name: item.name,
    stereotype: item.stereotype,
    attributes: item.attributes,
    methods: item.methods,
  }));
  const relations = snapshot.relations.slice(0, RELATION_LIMIT).map((item) => ({
    type: item.type,
    from: item.sourceName,
    to: item.targetName,
    sourceMultiplicity: item.sourceMultiplicity,
    targetMultiplicity: item.targetMultiplicity,
  }));
  return {
    context: { classes, relations },
    truncated: snapshot.classes.length > classes.length || snapshot.relations.length > relations.length,
  };
}

function withTruncation(result, truncated) {
  if (!truncated) return result;
  result.warnings = [
    'El diagrama es muy grande: la IA solo vio las primeras clases y relaciones.',
    ...result.warnings,
  ].slice(0, 8);
  return result;
}

function unreadReply(hasImage) {
  return {
    reply: hasImage
      ? 'No pude interpretar el diagrama de la imagen. Prueba con una captura más nítida o añade una instrucción.'
      : 'La IA devolvió una respuesta que no se pudo leer.',
    warnings: [],
    prepared: null,
    status: 'error',
    needsClarification: false,
  };
}

function buildTextPrompt(text, snapshot) {
  const packed = compactSnapshot(snapshot);
  const empty = packed.context.classes.length === 0;
  return {
    prompt: [
      'Pedido:',
      text,
      '',
      empty ? 'Diagrama actual: vacío. Crea desde cero.' : 'Diagrama actual:',
      empty ? '' : JSON.stringify(packed.context),
      '',
      'Devuelve message, operations y warnings. Incluye class:add y, si hay que relacionar, link:add.',
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n'),
    truncated: packed.truncated,
  };
}

function buildImageNotesPrompt(text, snapshot, notes) {
  const packed = compactSnapshot(snapshot);
  return {
    prompt: [
      'Pedido:',
      text,
      '',
      'Notas de la imagen:',
      notes,
      '',
      packed.context.classes.length ? 'Diagrama actual:' : 'Diagrama actual: vacío.',
      packed.context.classes.length ? JSON.stringify(packed.context) : '',
      '',
      'Convierte lo visible en operations TRAZO. No inventes clases que no estén en las notas.',
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n'),
    truncated: packed.truncated,
  };
}

function notesFromReply(reply) {
  const content = String(reply.content || '').trim();
  if (content.length > 80) return content.slice(0, 6000);
  const thinking = String(reply.thinking || '').trim();
  return (thinking + '\n' + content).trim().slice(-4000);
}

function usableProposal(result) {
  if (!result) return null;
  if (result.prepared && result.prepared.length > 0) return result;
  if (Array.isArray(result.prepared) && result.prepared.length === 0 && result.reply) return result;
  return null;
}

function payloadFromReply(reply) {
  const payload = pickContractPayload(reply.content, reply.thinking);
  if (!payload || isInputEcho(payload) || isDiagramEcho(payload)) return null;
  return payload;
}

async function askTrazoJson({ prompt, imageBase64 }) {
  const local = !usesOpenAiDiagrams();
  return generateDiagramResponse({
    system: SYSTEM_PROMPT,
    prompt,
    imageBase64,
    format: RESPONSE_SCHEMA,
    prefill: local ? '{' : undefined,
    numPredict: 2500,
  });
}

async function observeImage({ text, imageBase64 }) {
  return generateDiagramResponse({
    system: 'Miras un diagrama UML de clases o un boceto. Lista solo lo visible: clases, atributos, métodos y relaciones.',
    prompt: ['Pedido de la persona:', text, '', 'Describe el diagrama de la imagen.'].join('\n'),
    imageBase64,
    prefill: 'Clases visibles:\n',
    numPredict: 1800,
  });
}

async function runTextAgent({ text, snapshot }) {
  const userPrompt = buildTextPrompt(text, snapshot);
  const reply = await askTrazoJson({ prompt: userPrompt.prompt });
  const payload = payloadFromReply(reply);
  if (!payload) return unreadReply(false);
  return withTruncation(interpretReply(payload, snapshot), userPrompt.truncated);
}

async function runOpenAiImageAgent({ text, snapshot, imageBase64 }) {
  const userPrompt = buildTextPrompt(text, snapshot);
  const reply = await askTrazoJson({
    prompt: [
      userPrompt.prompt,
      '',
      'Si hay imagen, extrae solo las clases y relaciones que se lean con claridad.',
    ].join('\n'),
    imageBase64,
  });
  const payload = payloadFromReply(reply);
  if (!payload) return unreadReply(true);
  return withTruncation(interpretReply(payload, snapshot), userPrompt.truncated);
}

async function runImageAgent({ text, snapshot, imageBase64 }) {
  if (usesOpenAiDiagrams()) return runOpenAiImageAgent({ text, snapshot, imageBase64 });
  const seen = await observeImage({ text, imageBase64 });
  const notes = notesFromReply(seen);
  const fromNotes = usableProposal(sketchToOperations(sketchFromNotes(notes), snapshot));
  if (fromNotes && fromNotes.prepared && fromNotes.prepared.length > 0) return fromNotes;
  if (notes.length < 40) return unreadReply(true);
  const jsonPrompt = buildImageNotesPrompt(text, snapshot, notes);
  const designed = await askTrazoJson({ prompt: jsonPrompt.prompt });
  const payload = payloadFromReply(designed);
  if (!payload) return unreadReply(true);
  return withTruncation(interpretReply(payload, snapshot), jsonPrompt.truncated);
}

async function runDiagramAgent({ text, snapshot, imageBase64 }) {
  if (imageBase64) return runImageAgent({ text, snapshot, imageBase64 });
  return runTextAgent({ text, snapshot });
}

module.exports = { runDiagramAgent };
