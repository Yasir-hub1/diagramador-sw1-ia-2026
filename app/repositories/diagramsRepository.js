// repositories/diagramsRepository.js
const pool = require('../db');

async function findAccessibleByUser(userId) {
  const result = await pool.query(
    `SELECT DISTINCT d.id, d.name, d.share_token, d.owner_id, d.updated_at,
            (d.owner_id = $1) AS is_owner
       FROM diagrams d
       LEFT JOIN diagram_collaborators dc ON dc.diagram_id = d.id AND dc.user_id = $1
      WHERE d.owner_id = $1 OR dc.user_id = $1
      ORDER BY d.updated_at DESC`,
    [userId]
  );
  return result.rows;
}

async function create(name, ownerId) {
  const result = await pool.query(
    `INSERT INTO diagrams (name, owner_id) VALUES ($1, $2)
     RETURNING id, name, share_token, owner_id, graph_data, created_at, updated_at`,
    [name, ownerId]
  );
  return result.rows[0];
}

async function findByToken(token) {
  const result = await pool.query(
    `SELECT id, name, share_token, owner_id, graph_data, created_at, updated_at
       FROM diagrams WHERE share_token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

async function updateGraphData(diagramId, graphData) {
  await pool.query(
    `UPDATE diagrams SET graph_data = $1, updated_at = now() WHERE id = $2`,
    [graphData, diagramId]
  );
}

async function upsertCollaborator(diagramId, userId) {
  await pool.query(
    `INSERT INTO diagram_collaborators (diagram_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (diagram_id, user_id)
     DO UPDATE SET last_seen_at = now()`,
    [diagramId, userId]
  );
}

async function logActivity({ diagramId, userId, userName, actionType, elementId, elementLabel, payload }) {
  const result = await pool.query(
    `INSERT INTO diagram_activity (diagram_id, user_id, user_name, action_type, element_id, element_label, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, user_name, action_type, payload, created_at`,
    [diagramId, userId || null, userName, actionType, elementId || null, elementLabel || null, payload || null]
  );
  return result.rows[0] || null;
}

async function listAiMessages(diagramId, limit) {
  const result = await pool.query(
    `SELECT id, user_id, user_name, action_type, payload, created_at
       FROM diagram_activity
      WHERE diagram_id = $1 AND action_type IN ('ai:user', 'ai:assistant', 'ai:system')
      ORDER BY id DESC
      LIMIT $2`,
    [diagramId, limit || 80]
  );
  return result.rows.reverse();
}

async function userCanAccess(diagramId, ownerId, userId) {
  if (String(ownerId) === String(userId)) return true;
  const result = await pool.query(
    `SELECT 1 FROM diagram_collaborators WHERE diagram_id = $1 AND user_id = $2`,
    [diagramId, userId]
  );
  return result.rowCount > 0;
}

async function getLastEditors(diagramId) {
  const result = await pool.query(
    `SELECT DISTINCT ON (element_id) element_id, user_name, created_at
       FROM diagram_activity
      WHERE diagram_id = $1 AND element_id IS NOT NULL
      ORDER BY element_id, created_at DESC`,
    [diagramId]
  );
  const lastEditors = {};
  for (const row of result.rows) {
    lastEditors[row.element_id] = { userName: row.user_name, at: row.created_at };
  }
  return lastEditors;
}

module.exports = {
  findAccessibleByUser,
  create,
  findByToken,
  updateGraphData,
  upsertCollaborator,
  userCanAccess,
  logActivity,
  listAiMessages,
  getLastEditors,
};
