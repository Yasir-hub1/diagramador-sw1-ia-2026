function stripThoughtMarks(raw) {
  return String(raw || '').replace(/<\/?think>/gi, '').trim();
}

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch (error) {
    return null;
  }
  return null;
}

function sliceBalancedObject(source, start) {
  if (source[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function collectJsonObjects(raw) {
  const withoutThoughts = stripThoughtMarks(raw);
  const fenced = withoutThoughts.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : withoutThoughts;
  const objects = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== '{') continue;
    const slice = sliceBalancedObject(source, index);
    if (!slice) continue;
    const parsed = parseObject(slice);
    if (parsed) objects.push(parsed);
    index += slice.length - 1;
  }
  return objects;
}

function sketchScore(payload) {
  if (!payload || typeof payload !== 'object') return -1;
  let score = 0;
  if (payload.version && payload.status) score += 60;
  if (Array.isArray(payload.operations)) score += 80 + Math.min(payload.operations.length, 20);
  if (typeof payload.explanation === 'string' && payload.explanation.trim()) score += 10;
  if (payload.clarification_question) score += 8;
  if (Array.isArray(payload.classes)) score += 40 + Math.min(payload.classes.length, 20) * 8;
  if (Array.isArray(payload.relationships) || Array.isArray(payload.relations)) score += 20;
  if (typeof payload.message === 'string' && payload.message.trim()) score += 5;
  return score;
}

function extractJsonObject(raw) {
  const objects = collectJsonObjects(raw);
  if (!objects.length) throw new Error('invalid json');
  return objects.reduce((best, item) => (sketchScore(item) >= sketchScore(best) ? item : best));
}

function tryExtractJsonObject(raw) {
  try {
    return extractJsonObject(raw);
  } catch (error) {
    return null;
  }
}

function hasOperationList(payload) {
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && Array.isArray(payload.operations));
}

function isInputEcho(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return Boolean(payload.task && payload.current_diagram && !payload.status && !payload.version);
}

function isDiagramEcho(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (hasOperationList(payload) || payload.status || payload.version) return false;
  if (payload.message || payload.warnings || payload.relationships || payload.explanation) return false;
  const classes = payload.classes;
  const relations = payload.relations;
  if (!Array.isArray(classes) || !Array.isArray(relations)) return false;
  return classes.length === 0 && relations.length === 0;
}

function pickContractPayload(content, thinking) {
  const fromContent = tryExtractJsonObject(content);
  if (fromContent && !isInputEcho(fromContent) && (hasOperationList(fromContent) || fromContent.status)) {
    return fromContent;
  }
  const fromThinking = tryExtractJsonObject(thinking);
  if (fromThinking && !isInputEcho(fromThinking) && (hasOperationList(fromThinking) || fromThinking.status)) {
    return fromThinking;
  }
  if (fromContent && isInputEcho(fromContent)) {
    return fromThinking && !isInputEcho(fromThinking) ? fromThinking : null;
  }
  if (fromContent && sketchScore(fromContent) >= sketchScore(fromThinking)) return fromContent;
  if (fromThinking && !isInputEcho(fromThinking)) return fromThinking;
  return fromContent && !isInputEcho(fromContent) ? fromContent : null;
}

module.exports = {
  extractJsonObject,
  tryExtractJsonObject,
  hasOperationList,
  isDiagramEcho,
  isInputEcho,
  pickContractPayload,
};
