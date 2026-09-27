import { parseLink, importLinkKey, decryptAsset } from './crypto.mjs';

const status = document.querySelector('#status');
const base = new URL('./', location.href);
const link = parseLink(location.hash);
const urls = [];
function element(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text) value.textContent = text;
  return value;
}
async function read(id, key) {
  const response = await fetch(new URL('assets/' + id + '.bin', base), { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!response.ok) throw new Error('Download failed');
  return decryptAsset(id, await response.arrayBuffer(), key);
}
function blobUrl(bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  urls.push(url);
  return url;
}
async function prepareDownload(file, key, mime) {
  const bytes = await read(file.id, key);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== file.bytes || hash !== file.sha256) throw new Error('Download verification failed');
  return blobUrl(bytes, mime);
}
function validate(value) {
  if (value?.version !== 1 || !Array.isArray(value.items) || value.items.length !== 21) throw new Error('Invalid list');
  if (!Array.isArray(value.pdfs) || value.pdfs.length !== 6) throw new Error('Invalid PDF list');
  for (const a of [value.archive, ...value.pdfs]) {
    if (!/^[a-f0-9]{32}$/.test(a?.id) || !/^[a-f0-9]{64}$/.test(a?.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes < 1 || a.bytes > 20_000_000 || typeof a.name !== 'string') throw new Error('Invalid download');
  }
  for (const [i, item] of value.items.entries()) {
    const url = new URL(item.url);
    if (item.number !== i + 1 || url.origin !== base.origin || url.pathname !== base.pathname || url.search || !parseLink(url.hash)) throw new Error('Invalid document link');
    if (typeof item.title !== 'string' || typeof item.name !== 'string' || !Number.isInteger(item.files) || item.files < 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.png) || item.png.length > 1_000_000) throw new Error('Invalid QR');
  }
  return value;
}
async function start() {
  if (!link) return;
  status.textContent = 'QR 목록을 여는 중입니다…';
  try {
    const key = await importLinkKey(link.bytes);
    link.bytes.fill(0);
    const list = validate(JSON.parse(new TextDecoder().decode(await read(link.group, key))));
    const requestedPdf = new URLSearchParams(location.search).get('pdf');
    if (requestedPdf !== null) {
      if (!/^[0-5]$/.test(requestedPdf)) throw new Error('Invalid PDF selection');
      const file = list.pdfs[Number(requestedPdf)];
      document.title = file.name;
      document.querySelector('header .tag').hidden = true;
      document.querySelector('h1').textContent = file.label + ' QR PDF';
      status.textContent = 'PDF 다운로드를 준비하고 있습니다…';
      const download = element('a', 'button', file.label + ' PDF 다운로드');
      download.href = await prepareDownload(file, key, 'application/pdf');
      download.download = file.name;
      status.replaceChildren(element('span', '', '다운로드가 시작되지 않으면 눌러주세요. '), download);
      download.click();
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of list.items) {
      const number = String(item.number).padStart(2, '0');
      const card = element('article');
      const top = element('div', 'card-top');
      top.append(element('span', 'number', number), element('span', 'count', item.vessel + ' · 문서 ' + item.files + '개'));
      const image = element('img');
      const png = Uint8Array.from(atob(item.png), c => c.charCodeAt(0));
      image.src = blobUrl(png, 'image/png');
      image.alt = number + '번 ' + item.title + ' QR';
      image.width = 220; image.height = 220;
      const actions = element('div', 'card-actions');
      const open = element('a', 'button', '문서 열기 ↗');
      open.href = item.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
      const save = element('a', 'button secondary', 'QR 저장 ↓');
      save.href = image.src; save.download = number + '.png';
      actions.append(open, save);
      card.append(top, element('h2', '', item.title), image, element('p', 'filename', item.name), actions);
      fragment.append(card);
    }
    document.querySelector('#cards').replaceChildren(fragment);
    document.querySelector('#actions').hidden = false;
    document.querySelector('#footnote').hidden = false;
    status.textContent = 'QR 21개 · 대표 PDF 21개 · 전체 문서 78개';
    document.querySelector('#print').addEventListener('click', () => window.print());
    function attachDownload(button, file, mime) {
      button.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      const label = button.textContent;
      button.textContent = '다운로드 준비 중…';
      try {
        const anchor = element('a');
        anchor.href = await prepareDownload(file, key, mime);
        anchor.download = file.name;
        document.body.append(anchor); anchor.click(); anchor.remove();
        status.textContent = file.name + ' 다운로드를 시작했습니다.';
      } catch {
        status.textContent = '다운로드하지 못했습니다. 페이지를 새로고침한 뒤 다시 눌러주세요.';
      } finally {
        button.disabled = false; button.textContent = label;
      }
      });
    }
    attachDownload(document.querySelector('#download-all'), list.archive, 'application/zip');
    const pdfs = document.querySelector('#pdf-downloads');
    for (const file of list.pdfs) {
      const button = element('button', 'secondary', file.label + ' PDF ↓');
      attachDownload(button, file, 'application/pdf');
      pdfs.append(button);
    }
  } catch {
    for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    document.querySelector('#cards').replaceChildren();
    status.textContent = '목록을 열 수 없습니다. 전달받은 전체 링크와 인터넷 연결을 확인해 주세요.';
  }
}
window.addEventListener('pagehide', () => { for (const url of urls.splice(0)) URL.revokeObjectURL(url); });
start();
