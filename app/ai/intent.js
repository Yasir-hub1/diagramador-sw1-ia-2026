const MODIFY =
  /\b(agrega|agregá|añade|anade|añadí|crea|creá|borra|borrá|elimina|quita|cambia|cambiá|modifica|renombra|relaciona|une|conecta|actualiza|pon|mete|saca|hereda|comp[oó]n|corrige|arregla|aplica|pasa a|convierte)\b/i;
const REVIEW =
  /\b(revisa|revisá|revisión|revision|analiza|analizá|análisis|analisis|evalúa|evalua|valida|errores|incoheren|mejora|sugerencia|está bien|esta bien|qué tal|que tal)\b/i;
const QUESTION = /(\?|^\s*(qué|que|cuál|cual|cómo|como|dónde|donde|quién|quien|cuánt|cuant|por qué|porque|explica|explícame|explicame)\b)/i;

function classifyIntent(text, options = {}) {
  const value = String(text || '').trim();
  if (options.hasImage && (!value || !MODIFY.test(value))) return 'sketch';
  if (MODIFY.test(value)) return 'modify';
  if (REVIEW.test(value)) return 'review';
  if (QUESTION.test(value)) return 'question';
  if (!value) return 'question';
  return 'modify';
}

function shouldProposeChanges(intent, text) {
  if (!intent || intent === 'modify' || intent === 'sketch') return true;
  if (intent === 'review' && MODIFY.test(String(text || ''))) return true;
  return false;
}

module.exports = { classifyIntent, shouldProposeChanges };
