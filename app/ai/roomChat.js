const diagramsRepository = require('../repositories/diagramsRepository');

const HISTORY_LIMIT = 16;
const LOAD_LIMIT = 80;

function toClient(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const role =
    payload.role ||
    (row.action_type === 'ai:user' ? 'user' : row.action_type === 'ai:assistant' ? 'assistant' : 'system');
  return {
    id: String(row.id),
    role,
    authorId: row.user_id,
    authorName: payload.authorName || row.user_name,
    text: String(payload.text || ''),
    kind: payload.kind || 'text',
    createdAt: row.created_at,
  };
}

async function listMessages(diagramId) {
  const rows = await diagramsRepository.listAiMessages(diagramId, LOAD_LIMIT);
  return rows.map(toClient);
}

async function appendMessage(diagram, { role, userId, userName, text, kind }) {
  const actionType = role === 'user' ? 'ai:user' : role === 'assistant' ? 'ai:assistant' : 'ai:system';
  const row = await diagramsRepository.logActivity({
    diagramId: diagram.id,
    userId,
    userName: userName || 'TRAZO',
    actionType,
    elementId: null,
    elementLabel: role,
    payload: {
      role,
      authorName: userName || 'TRAZO',
      text: String(text || '').slice(0, 4000),
      kind: kind || 'text',
    },
  });
  if (row) return toClient(row);
  return {
    id: actionType + ':' + Date.now(),
    role,
    authorId: userId || null,
    authorName: userName || 'TRAZO',
    text: String(text || ''),
    kind: kind || 'text',
    createdAt: new Date().toISOString(),
  };
}

function formatHistoryForPrompt(messages) {
  const lines = (messages || []).slice(-HISTORY_LIMIT).map((item) => {
    const who = item.role === 'assistant' ? 'TRAZO' : item.authorName || 'Integrante';
    return who + ': ' + String(item.text || '').replace(/\s+/g, ' ').trim().slice(0, 360);
  });
  if (!lines.length) return '';
  return ['Conversación de la sala:'].concat(lines).join('\n');
}

module.exports = { listMessages, appendMessage, formatHistoryForPrompt, toClient };
