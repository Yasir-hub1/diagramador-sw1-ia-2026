const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const proposals = new Map();

function prune(now) {
  for (const [id, proposal] of proposals) {
    if (proposal.expiresAt <= now) proposals.delete(id);
  }
  while (proposals.size > 100) {
    const oldestId = proposals.keys().next().value;
    proposals.delete(oldestId);
  }
}

function matches(proposal, shareToken) {
  return proposal.shareToken === shareToken;
}

function save({ userId, shareToken, fingerprint, message, warnings, prepared, typeNotes }) {
  const now = Date.now();
  prune(now);
  const proposal = {
    id: crypto.randomUUID(),
    userId: String(userId),
    shareToken,
    fingerprint,
    message,
    warnings,
    typeNotes: typeNotes || [],
    prepared,
    expiresAt: now + TTL_MS,
  };
  proposals.set(proposal.id, proposal);
  return proposal;
}

function read(id, shareToken) {
  prune(Date.now());
  const proposal = proposals.get(id);
  if (!proposal || !matches(proposal, shareToken)) return null;
  return proposal;
}

function take(id, shareToken) {
  const proposal = read(id, shareToken);
  if (!proposal) return null;
  proposals.delete(id);
  return proposal;
}

function discard(id, shareToken) {
  const proposal = read(id, shareToken);
  if (proposal) proposals.delete(id);
}

function toClient(proposal) {
  return {
    proposalId: proposal.id,
    message: proposal.message,
    warnings: proposal.warnings,
    typeNotes: proposal.typeNotes || [],
    preview: proposal.prepared.map((step) => step.preview),
    expiresAt: new Date(proposal.expiresAt).toISOString(),
  };
}

module.exports = { save, read, take, discard, toClient };
