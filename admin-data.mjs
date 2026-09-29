const ID = /^[a-f0-9]{32}$/;
const SHA = /^[a-f0-9]{64}$/;
const PNG = [137,80,78,71,13,10,26,10];
function text(value, limit) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
}
function filename(value, suffix) {
  return text(value, 120) && value.endsWith(suffix) && !/[<>:"/\\|?*]/.test(value) && !value.startsWith('.');
}
function size(value, max) { return Number.isSafeInteger(value) && value > 0 && value <= max; }
function archive(value, count) {
  if (!value || !ID.test(value.id) || !filename(value.name, '.zip') || !size(value.bytes, 30000000) || !SHA.test(value.sha256) || value.count !== count) throw new Error('Invalid archive');
}
function documentUrl(value, id, siteUrl) {
  if (typeof value !== 'string' || value.length > 2048 || !siteUrl) throw new Error('Invalid document link');
  const url = new URL(value), base = new URL('.', siteUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== base.origin || url.pathname !== base.pathname || url.username || url.password || url.search) throw new Error('Invalid document location');
  const parts = new URLSearchParams(url.hash.slice(1));
  if ([...parts].length !== 2 || parts.getAll('g').length !== 1 || parts.getAll('k').length !== 1 || parts.get('g') !== id || !/^[A-Za-z0-9_-]{43}$/.test(parts.get('k') || '')) throw new Error('Invalid document fragment');
  const key = parts.get('k');
  const bytes = Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/') + '='), c=>c.charCodeAt(0));
  if (bytes.length !== 32 || btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') !== key) throw new Error('Invalid document key');
}
export function validateAdmin(value, siteUrl = globalThis.location?.href) {
  if (!value || value.version !== 1 || !text(value.scope, 50) || !Array.isArray(value.groups) || !value.groups.length || value.groups.length > 20) throw new Error('Invalid list');
  if (value.documentLinksVersion !== undefined && value.documentLinksVersion !== 1) throw new Error('Invalid document links version');
  const groups = new Set(), archives = new Set(), itemIds = new Set();
  let total = 0;
  for (const group of value.groups) {
    if (!group || !/^[a-z][a-z0-9-]{0,39}$/.test(group.id) || groups.has(group.id) || !text(group.title, 60) || !Array.isArray(group.items) || group.items.length > 100) throw new Error('Invalid group');
    groups.add(group.id);
    const ids = new Set(), names = new Set();
    for (const item of group.items) {
      if (!item || !ID.test(item.id) || ids.has(item.id) || names.has(item.name) || !text(item.title, 90) || !filename(item.name, '.png') || !size(item.bytes, 5000000) || !SHA.test(item.sha256) || typeof item.data !== 'string' || item.data.length > 7000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) throw new Error('Invalid QR');
      // Older encrypted manifests remain usable during a cached deployment transition.
      if (value.documentLinksVersion === 1 || item.documentUrl !== undefined) documentUrl(item.documentUrl, item.id, siteUrl);
      if (item.status !== undefined && item.status !== 'pending') throw new Error('Invalid document status');
      ids.add(item.id); itemIds.add(item.id); names.add(item.name); total++;
    }
    if (group.items.length) {
      archive(group.archive, group.items.length);
      if (archives.has(group.archive.id)) throw new Error('Duplicate archive');
      archives.add(group.archive.id);
    } else if (group.archive !== null) throw new Error('Unexpected archive');
  }
  if (!total || total > 200 || value.count !== total || value.uniqueCount !== itemIds.size) throw new Error('Invalid count');
  archive(value.archive, total);
  if (archives.has(value.archive.id)) throw new Error('Duplicate archive');
  archives.add(value.archive.id);
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > 20) throw new Error('Missing pages');
  const pageIds = new Set(), covered = new Set();
  for (const page of value.pages) {
    if (!page || !/^[a-z][a-z0-9-]{0,39}$/.test(page.id) || pageIds.has(page.id) || !text(page.title,60) || !Array.isArray(page.groupIds) || !page.groupIds.length) throw new Error('Invalid page');
    pageIds.add(page.id);
    let count = 0;
    for (const id of page.groupIds) {
      if (!groups.has(id) || covered.has(id)) throw new Error('Invalid page group');
      covered.add(id); count += value.groups.find(g=>g.id===id).items.length;
    }
    if (page.count !== count || !count) throw new Error('Invalid page count');
    archive(page.archive,count);
    const original = value.groups.find(g=>g.id===page.groupIds[0]).archive;
    if (page.groupIds.length === 1 && page.archive.id === original.id) {
      if (['id','name','bytes','sha256','count'].some(k=>page.archive[k]!==original[k])) throw new Error('Invalid page archive');
    } else {
      if (archives.has(page.archive.id)) throw new Error('Duplicate page archive');
      archives.add(page.archive.id);
    }
  }
  if (covered.size !== groups.size) throw new Error('Missing page group');
  return value;
}
export async function verifyBytes(bytes, entry, kind) {
  const signature = kind === 'png' ? PNG : [80,75,3,4];
  if (bytes.length !== entry.bytes || !signature.every((v,i) => bytes[i] === v)) throw new Error('Invalid file');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
  if (digest !== entry.sha256) throw new Error('Invalid integrity');
  return bytes;
}
export function decodePng(item) {
  const bytes = Uint8Array.from(atob(item.data), c => c.charCodeAt(0));
  return verifyBytes(bytes, item, 'png');
}
