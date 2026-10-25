const mutations = require('../diagramMutations');

function runStep(io, ctx, step) {
  if (step.event === 'class:add') return mutations.applyClassAdd(io, ctx, step.data);
  if (step.event === 'class:update') return mutations.applyClassUpdate(io, ctx, step.data);
  if (step.event === 'class:remove') return mutations.applyClassRemove(io, ctx, step.data);
  if (step.event === 'link:add') return mutations.applyLinkAdd(io, ctx, step.data);
  if (step.event === 'link:update') return mutations.applyLinkUpdate(io, ctx, step.data);
  if (step.event === 'link:remove') return mutations.applyLinkRemove(io, ctx, step.data);
  return Promise.resolve({ ok: false, message: 'Operación desconocida.' });
}

async function applyPreparedSteps(io, ctx, steps) {
  const skipped = [];
  let appliedCount = 0;
  for (const step of steps) {
    const result = await runStep(io, ctx, step);
    if (!result.ok) {
      skipped.push(result.message || 'No se pudo aplicar un cambio.');
      break;
    }
    appliedCount += 1;
  }
  return { appliedCount, skipped };
}

module.exports = { applyPreparedSteps };
