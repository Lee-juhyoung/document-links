import { parseLink, importLinkKey, decryptAsset } from './crypto.mjs';
import { validateAdmin, decodePng, verifyBytes } from './admin-data.mjs?v=20260929-3';

const status = document.querySelector('#status');
const downloadStatus = document.querySelector('#download-status');
const base = new URL('./', location.href);
const urls = new Set();
const archiveUrls = new Map();
const search = document.querySelector('#qr-search');
const searchResult = document.querySelector('#search-result');
const normalizeSearch = value => value.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, '');
function applySearch() {
  const query = normalizeSearch(search.value);
  let count = 0;
  for (const section of document.querySelectorAll('#library .vessel')) {
    let matches = 0;
    for (const card of section.querySelectorAll('.qr-card')) {
      card.hidden = !!query && !card.dataset.search.includes(query);
      if (!card.hidden) matches++;
    }
    section.hidden = !!query && matches === 0;
    for (const jump of document.querySelectorAll('#vessels button')) if (jump.dataset.section === section.id) jump.hidden = section.hidden;
    count += matches;
  }
  searchResult.hidden = !query;
  searchResult.textContent = count ? '검색 결과 QR ' + count + '개' : '검색 결과가 없습니다. 다른 장비명이나 번호로 검색해 주세요.';
}
search.addEventListener('input', applySearch);
document.querySelector('#clear-search').addEventListener('click', () => { search.blur(); search.value = ''; applySearch(); });
function element(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text) value.textContent = text;
  return value;
}
function clearUrls() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear(); archiveUrls.clear();
}
async function read(id, key) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid asset');
  const response = await fetch(new URL('assets/' + id + '.bin', base), {credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store'});
  if (!response.ok) throw new Error('Download failed');
  return decryptAsset(id, await response.arrayBuffer(), key);
}
function blobUrl(bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], {type}));
  urls.add(url); return url;
}
async function prepareDownload(file, key, mime) {
  if (!/^[a-f0-9]{32}$/.test(file?.id) || !/^[a-f0-9]{64}$/.test(file?.sha256)
      || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 20_000_000
      || typeof file.name !== 'string' || /[<>:"/\\|?*\x00-\x1f]/.test(file.name)) throw new Error('Invalid download');
  const bytes = await read(file.id, key);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if (bytes.byteLength !== file.bytes || hash !== file.sha256) throw new Error('Download verification failed');
  return blobUrl(bytes, mime);
}
function attachArchive(button, file, key) {
  button.addEventListener('click', async () => {
    const label = button.textContent; button.disabled = true; button.textContent = '준비 중…';
    downloadStatus.textContent = '';
    try {
      let href = archiveUrls.get(file.id);
      if (!href) {
        const bytes = await verifyBytes(new Uint8Array(await read(file.id,key)), file, 'zip');
        href = blobUrl(bytes,'application/zip'); archiveUrls.set(file.id,href);
      }
      const anchor = element('a','',file.name + ' 다시 다운로드');
      anchor.href = href; anchor.download = file.name;
      downloadStatus.append('다운로드가 시작되지 않으면 ',anchor,'를 눌러주세요.');
      anchor.click();
    } catch { downloadStatus.textContent = '다운로드를 준비하지 못했습니다. 다시 눌러주세요.'; }
    finally { button.disabled = false; button.textContent = label; }
  });
}
async function legacyDownload(list, key) {
  // Keep previously shared downloads available with their original scope.
  const params = new URLSearchParams(location.search);
  const pdf = params.get('pdf'), images = params.get('images');
  if (pdf === null && images === null) return false;
  if (pdf !== null && images !== null) throw new Error('Choose one download');
  const selection = pdf ?? images;
  if (!/^[0-5]$/.test(selection)) throw new Error('Invalid download selection');
  const isPdf = pdf !== null;
  const file = (isPdf ? list.pdfs : list.imageArchives)?.[Number(selection)];
  if (!file) throw new Error('Download unavailable');
  document.title = file.name;
  document.querySelector('h1').textContent = file.label + ' QR ' + (isPdf ? 'PDF' : 'ZIP');
  const anchor = element('a','button','다운로드');
  anchor.href = await prepareDownload(file,key,isPdf ? 'application/pdf' : 'application/zip');
  anchor.download = file.name;
  status.replaceChildren(element('span','','기존 장비 QR 모음입니다. '),anchor);
  anchor.click(); return true;
}
async function start() {
  const link = parseLink(location.hash);
  if (!link) return;
  status.textContent = '배포 자료를 불러오고 있습니다…';
  try {
    const key = await importLinkKey(link.bytes); link.bytes.fill(0);
    const list = JSON.parse(new TextDecoder().decode(await read(link.group,key)));
    if (list.version !== 1) throw new Error('Invalid list');
    if (await legacyDownload(list,key)) return;
    const library = validateAdmin(list.library,base.href);
    if (library.documentLinksVersion !== 1 || library.chatLinkId) throw new Error('Invalid distribution library');
    const numbers = new Map((list.items || []).map(item=>[parseLink(new URL(item.url).hash)?.group,item.number]));
    const images = new Map();
    for (const group of library.groups) for (const item of group.items) {
      const bytes = await decodePng(item);
      if (!images.has(item.sha256)) images.set(item.sha256,blobUrl(bytes,'image/png'));
    }
    const fragment = document.createDocumentFragment();
    const navigation = document.querySelector('#vessels'); navigation.replaceChildren();
    for (const page of library.pages) {
      const section = element('section','vessel'); section.id = 'vessel-' + page.id;
      const heading = element('div','vessel-heading');
      const title = element('h2','',page.title);
      title.append(element('span','count','QR ' + page.count + '개'));
      const download = element('button','secondary',page.title + ' QR 다운로드');
      attachArchive(download,page.archive,key); heading.append(title,download); section.append(heading);
      const jump = element('button','secondary',page.title);
      jump.dataset.section = section.id;
      jump.addEventListener('click',()=>section.scrollIntoView({behavior:'smooth',block:'start'})); navigation.append(jump);
      const cards = element('div','cards');
      for (const group of library.groups.filter(group=>page.groupIds.includes(group.id))) for (const item of group.items) {
        const card = element('article','qr-card');
        const number = numbers.get(item.id);
        card.dataset.search = normalizeSearch([page.title, group.title, item.title, item.name, number ? 'QR ' + String(number).padStart(2,'0') : ''].join(' '));
        if (number) card.append(element('span','number','QR ' + String(number).padStart(2,'0')));
        const image = element('img'); image.src = images.get(item.sha256); image.alt = item.title + ' QR'; image.width = 220; image.height = 220;
        const actions = element('div','card-actions');
        const save = element('a','button secondary','PNG 다운로드');
        save.href = image.src; save.download = item.name; save.setAttribute('aria-label',item.title + ' PNG 다운로드');
        const open = element('a','button','문서 열람');
        open.href = item.documentUrl; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.setAttribute('aria-label',item.title + ' 문서 열람');
        actions.append(save,open); card.append(element('h3','',item.title),image);
        if (item.status === 'pending') card.append(element('p','pending-note','서류 등록 예정'));
        card.append(actions); cards.append(card);
      }
      section.append(cards); fragment.append(section);
    }
    document.querySelector('#library').replaceChildren(fragment);
    document.querySelector('#library').hidden = false;
    applySearch();
    document.querySelector('#actions').hidden = false;
    document.querySelector('#footnote').hidden = false;
    status.textContent = '전체 QR ' + library.uniqueCount + '개 · 선박별로 다운로드하거나 문서를 열람하세요.';
    document.querySelector('#download-all').textContent = '전체 QR ' + library.uniqueCount + '개 다운로드';
    attachArchive(document.querySelector('#download-all'),library.archive,key);
  } catch {
    clearUrls(); document.querySelector('#library').replaceChildren();
    document.querySelector('#library').hidden = true; document.querySelector('#actions').hidden = true;
    status.textContent = '배포 자료를 열 수 없습니다. 전달받은 전체 링크와 인터넷 연결을 확인해 주세요.';
  }
}
document.querySelector('#print').addEventListener('click',()=>window.print());
addEventListener('pagehide',clearUrls);
addEventListener('pageshow',event=>{if(event.persisted) location.reload();});
addEventListener('hashchange',()=>location.reload());
start();
