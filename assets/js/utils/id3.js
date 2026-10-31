function syncSafeSize(bytes) {
  return ((bytes[0] & 0x7f) << 21) | ((bytes[1] & 0x7f) << 14) | ((bytes[2] & 0x7f) << 7) | (bytes[3] & 0x7f);
}

function decodeText(bytes) {
  if (!bytes.length) return '';
  const encoding = bytes[0];
  const body = bytes.subarray(1);
  let decoder;
  if (encoding === 1) decoder = new TextDecoder('utf-16');
  else if (encoding === 2) decoder = new TextDecoder('utf-16be');
  else if (encoding === 3) decoder = new TextDecoder('utf-8');
  else decoder = new TextDecoder('windows-1252');
  return decoder.decode(body).replace(/[\u0000\uFFFE\uFFFF]+/g, '').trim();
}

export async function readAudioTags(file) {
  const tags = {};
  if (!file || !/^audio\//i.test(file.type)) return tags;
  const buffer = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || String.fromCharCode(...bytes.subarray(0, 3)) !== 'ID3') return tags;

  const version = bytes[3];
  if (version < 3 || version > 4) return tags;
  const tagSize = Math.min(syncSafeSize(bytes.subarray(6, 10)), bytes.length - 10);
  let offset = 10;
  const map = { TIT2: 'title', TPE1: 'artist', TALB: 'album', TCON: 'genre', TDRC: 'year', TYER: 'year' };
  while (offset + 10 <= 10 + tagSize) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(id) || id === '\u0000\u0000\u0000\u0000') break;
    const frameBytes = bytes.subarray(offset + 4, offset + 8);
    const size = version === 4 ? syncSafeSize(frameBytes) : new DataView(frameBytes.buffer, frameBytes.byteOffset, 4).getUint32(0);
    if (!size || size > tagSize || offset + 10 + size > bytes.length) break;
    if (map[id]) tags[map[id]] = decodeText(bytes.subarray(offset + 10, offset + 10 + size)).slice(0, 250);
    offset += 10 + size;
  }
  return tags;
}

export function titleFromFileName(name) {
  return String(name || 'Canción').replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim() || 'Canción';
}
