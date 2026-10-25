const { positiveInt } = require('./settings');

const MAX_EDGE = 8192;

function maxImageBytes() {
  return positiveInt('AI_MAX_IMAGE_BYTES', 5 * 1024 * 1024);
}

function imageKind(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

function readPngSize(buffer) {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegSize(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) return null;
    const isFrame = marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && marker >= 0xc0 && marker <= 0xcf;
    if (isFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpSize(buffer) {
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function readSize(kind, buffer) {
  if (kind === 'png') return readPngSize(buffer);
  if (kind === 'jpeg') return readJpegSize(buffer);
  return readWebpSize(buffer);
}

function imageBufferFromBase64(value) {
  const text = String(value || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, '').replace(/\s/g, '');
  if (!text) return Buffer.alloc(0);
  return Buffer.from(text, 'base64');
}

function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, message: 'No se recibió una imagen.' };
  }
  if (buffer.length > maxImageBytes()) {
    return { ok: false, message: 'La imagen supera el tamaño permitido.' };
  }
  const kind = imageKind(buffer);
  if (!kind) return { ok: false, message: 'La imagen debe ser PNG, JPEG o WebP.' };
  const size = readSize(kind, buffer);
  if (size && (size.width > MAX_EDGE || size.height > MAX_EDGE || size.width < 1 || size.height < 1)) {
    return { ok: false, message: 'La imagen es demasiado grande en píxeles. Prueba con una captura más chica.' };
  }
  const mediaType = kind === 'jpeg' ? 'image/jpeg' : kind === 'png' ? 'image/png' : 'image/webp';
  return { ok: true, mediaType };
}

module.exports = { inspectImage, maxImageBytes, MAX_EDGE, imageBufferFromBase64 };
