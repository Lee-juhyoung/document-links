const MAGIC = new TextEncoder().encode('QLNK01');
export function parseLink(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const group = params.get('g');
  const token = params.get('k');
  if (!/^[a-f0-9]{32}$/.test(group || '') || !/^[A-Za-z0-9_-]{43}$/.test(token || '')) return null;
  const bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
  return bytes.length === 32 ? { group, bytes } : null;
}
export async function importLinkKey(bytes) {
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
}
export async function decryptAsset(id, bytes, key) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid document identifier');
  const data = new Uint8Array(bytes);
  if (data.length < 34 || !MAGIC.every((value, index) => data[index] === value)) throw new Error('Invalid document format');
  return crypto.subtle.decrypt({
    name: 'AES-GCM', iv: data.slice(6, 18), tagLength: 128,
    additionalData: new TextEncoder().encode('qlink-v1:' + id),
  }, key, data.slice(18));
}
export function validateManifest(value) {
  if (value?.version !== 1 || typeof value.title !== 'string' || !Array.isArray(value.files) || !value.files.length || value.files.length > 100) throw new Error('Invalid document list');
  for (const file of value.files) {
    if (!/^[a-f0-9]{32}$/.test(file.id) || typeof file.name !== 'string' || !['application/pdf', 'image/jpeg'].includes(file.mime) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 100_000_000) throw new Error('Invalid document entry');
    if (Object.prototype.hasOwnProperty.call(file, 'pageRotations')) {
      const rotations = file.pageRotations;
      if (!rotations || typeof rotations !== 'object' || Object.getPrototypeOf(rotations) !== Object.prototype) throw new Error('Invalid page rotations');
      for (const [page, rotation] of Object.entries(rotations)) {
        if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) || ![0, 90, 180, 270].includes(rotation)) throw new Error('Invalid page rotation');
      }
    }
  }
  if (!value.files.some(file => file.id === value.representative)) throw new Error('Missing representative document');
  return value;
}
