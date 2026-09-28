import { parseLink, importLinkKey, decryptAsset } from './crypto.mjs';
import { validateAdmin, decodePng, verifyBytes } from './admin-data.mjs?v=20260928-1';

const status = document.querySelector('#status');
const downloadStatus = document.querySelector('#download-status');
const library = document.querySelector('#library');
const groups = document.querySelector('#groups');
const retry = document.querySelector('#retry');
const allButton = document.querySelector('#download-all');
const pageButton = document.querySelector('#download-page');
const navigation = document.querySelector('#page-nav');
const objectUrls = new Set();
const archiveUrls = new Map();
let key;
let busy = false;

function blobUrl(bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], {type:mime}));
  objectUrls.add(url);
  return url;
}
function clearUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear(); archiveUrls.clear();
}
async function fetchAsset(id, limit) {
  const response = await fetch('./assets/' + id + '.bin', {credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
  if (!response.ok) throw new Error('Unavailable');
  // Content-Length describes the compressed transfer when a CDN uses gzip.
  // The limit below applies to the decoded ciphertext returned by Fetch.
  const encoding = response.headers.get('content-encoding');
  if ((!encoding || encoding === 'identity') && Number(response.headers.get('content-length')) > limit) throw new Error('Too large');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > limit) throw new Error('Too large');
  return new Uint8Array(await decryptAsset(id, bytes, key));
}
async function downloadArchive(entry, button) {
  const label = button.textContent;
  button.disabled = true; button.textContent = '준비 중…';
  downloadStatus.textContent = '';
  try {
    let url = archiveUrls.get(entry.id);
    if (!url) {
      const bytes = await verifyBytes(await fetchAsset(entry.id, entry.bytes + 34), entry, 'zip');
      url = blobUrl(bytes, 'application/zip'); archiveUrls.set(entry.id, url);
    }
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = entry.name;
    anchor.textContent = entry.name + ' 다시 다운로드';
    downloadStatus.append('다운로드가 시작되지 않으면 ', anchor, '를 눌러주세요.');
    anchor.click();
  } catch {
    downloadStatus.textContent = '다운로드를 준비하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러주세요.';
  } finally {
    button.disabled = false; button.textContent = label;
  }
}
function setExpanded(button, expanded) {
  button.setAttribute('aria-expanded', String(expanded));
  document.getElementById(button.getAttribute('aria-controls')).hidden = !expanded;
}
function renderGroup(group, urls) {
  const section = document.createElement('section'); section.className = 'group';
  const heading = document.createElement('div'); heading.className = 'group-header';
  const h2 = document.createElement('h2');
  const toggle = document.createElement('button'); toggle.className = 'group-toggle';
  toggle.setAttribute('aria-expanded','true'); toggle.setAttribute('aria-controls', 'group-' + group.id);
  const title = document.createElement('span'); title.textContent = group.title;
  const count = document.createElement('span'); count.className = 'group-count'; count.textContent = group.items.length + '개';
  toggle.append(title, count); h2.append(toggle); heading.append(h2);
  if (group.archive) {
    const button = document.createElement('button'); button.className = 'secondary group-download';
    button.textContent = '전체 받기'; button.setAttribute('aria-label', group.title + ' 전체 다운로드');
    button.addEventListener('click', () => downloadArchive(group.archive, button)); heading.append(button);
  }
  const body = document.createElement('div'); body.className = 'group-body'; body.id = 'group-' + group.id;
  toggle.addEventListener('click', () => setExpanded(toggle, toggle.getAttribute('aria-expanded') !== 'true'));
  if (!group.items.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '등록된 QR이 없습니다.'; body.append(empty);
  } else {
    const cards = document.createElement('div'); cards.className = 'cards';
    for (const item of group.items) {
      const card = document.createElement('article'); card.className = 'qr-card';
      const img = document.createElement('img'); img.src = urls.get(item.sha256); img.alt = item.title + ' QR'; img.width = 1944; img.height = 1944;
      const name = document.createElement('h3'); name.textContent = item.title;
      const link = document.createElement('a'); link.className = 'download-png'; link.href = img.src; link.download = item.name; link.textContent = 'PNG 다운로드';
      link.setAttribute('aria-label', item.title + ' PNG 다운로드');
      card.append(img, name, link); cards.append(card);
    }
    body.append(cards);
  }
  section.append(heading, body); return section;
}
async function start() {
  if (busy) return;
  busy = true; retry.hidden = true; library.hidden = true; groups.textContent = ''; clearUrls();
  try {
    const link = parseLink(location.hash);
    if (!link) { status.textContent = '전달받은 관리자 링크 전체로 열어주세요.'; return; }
    status.textContent = 'QR을 불러오고 있습니다…';
    key = await importLinkKey(link.bytes); link.bytes.fill(0);
    const value = validateAdmin(JSON.parse(new TextDecoder().decode(await fetchAsset(link.group, 15000000))));
    const urls = new Map();
    for (const group of value.groups) for (const item of group.items) {
      const bytes = await decodePng(item);
      if (!urls.has(item.sha256)) urls.set(item.sha256, blobUrl(bytes, 'image/png'));
    }
    const requested = new URLSearchParams(location.search).get('vessel');
    const current = value.pages.find(page=>page.id===requested) || value.pages[0];
    navigation.textContent = '';
    for (const page of value.pages) {
      const link = document.createElement('a');
      link.href = '?v=20260928-4&vessel=' + encodeURIComponent(page.id) + location.hash;
      link.textContent = page.title;
      link.setAttribute('aria-label', page.title + ' 페이지');
      const count = document.createElement('small'); count.textContent = 'QR ' + page.count + '개'; link.append(count);
      if (page.id === current.id) link.setAttribute('aria-current','page');
      navigation.append(link);
    }
    document.title = current.title + ' · QR 관리';
    document.querySelector('#scope').textContent = current.title;
    document.querySelector('#count').textContent = 'QR ' + current.count + '개';
    pageButton.onclick = () => downloadArchive(current.archive, pageButton);
    pageButton.textContent = current.title + ' 전체 다운로드';
    allButton.textContent = '모든 QR ' + value.uniqueCount + '개 다운로드';
    allButton.onclick = () => downloadArchive(value.archive, allButton);
    for (const group of value.groups) if (current.groupIds.includes(group.id)) groups.append(renderGroup(group, urls));
    status.textContent = '선박을 선택하고 QR 이미지를 내려받으세요.';
    library.hidden = false;
  } catch {
    clearUrls(); groups.textContent = ''; library.hidden = true;
    status.textContent = 'QR 목록을 열 수 없습니다. 관리자 링크 전체와 인터넷 연결을 확인해 주세요.';
    retry.hidden = false;
  } finally { busy = false; }
}
document.querySelector('#expand-all').addEventListener('click', () => groups.querySelectorAll('.group-toggle').forEach(button => setExpanded(button, true)));
document.querySelector('#collapse-all').addEventListener('click', () => groups.querySelectorAll('.group-toggle').forEach(button => setExpanded(button, false)));
retry.addEventListener('click', start);
addEventListener('pagehide', clearUrls);
addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
addEventListener('hashchange', () => location.reload());
start();
