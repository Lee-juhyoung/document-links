import { parseLink, importLinkKey, decryptAsset, validateManifest } from './crypto.mjs?v=20260928-pages-1';

const documentView = document.getElementById('document');
const message = document.getElementById('message');
const messageText = document.getElementById('message-text');
const retry = document.getElementById('retry');
const nativePdf = document.getElementById('open-pdf');
const pages = [];
let key, originalFile, observer, nativePdfUrl, cleanupWatch;
let active = 0;

async function fetchEncrypted(id, manifest, signal) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const cancel = () => { if (controller) controller.abort(); };
  if (signal) signal.addEventListener('abort', cancel);
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch('./assets/' + id + '.bin', {
          credentials: 'omit', referrerPolicy: 'no-referrer', cache: manifest ? 'no-store' : 'default',
          signal: controller ? controller.signal : undefined,
        });
        if (!response.ok) throw new Error('Document unavailable');
        return decryptAsset(id, await response.arrayBuffer(), key);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { cancel(); reject(new Error('Document request timeout')); }, 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', cancel);
  }
}

async function verifiedBytes(file, signal) {
  const bytes = await fetchEncrypted(file.id, false, signal);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== file.sha256 || bytes.byteLength !== file.bytes) throw new Error('Document integrity failed');
  return bytes;
}

async function prepareNativePdf() {
  if (!originalFile) return;
  try {
    const bytes = await verifiedBytes(originalFile);
    nativePdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    nativePdf.href = nativePdfUrl;
    nativePdf.download = originalFile.name;
    nativePdf.hidden = false;
    messageText.textContent = '문서 미리보기를 불러오지 못했습니다. 다시 시도하거나 PDF 파일을 내려받아 열어주세요.';
  } catch { /* The retry option remains available when the connection fails. */ }
}

function release(entry) {
  entry.generation++;
  if (entry.controller) entry.controller.abort();
  if (entry.cancelImage) entry.cancelImage();
  if (entry.image) { entry.image.remove(); entry.image = null; }
  if (entry.url) { URL.revokeObjectURL(entry.url); entry.url = null; }
  entry.element.dataset.ready = 'false';
}

function showPageError(entry) {
  entry.failed = true;
  const box = document.createElement('div');
  box.className = 'page-error'; box.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.textContent = '이 페이지를 불러오지 못했습니다.';
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = '다시 시도';
  button.addEventListener('click', () => {
    box.remove(); entry.failed = false; pump();
  });
  box.append(text, button); entry.element.append(box);
}

async function loadPage(entry) {
  const generation = ++entry.generation;
  entry.loading = true;
  entry.controller = typeof AbortController === 'function' ? new AbortController() : null;
  try {
    const bytes = await verifiedBytes(entry.file, entry.controller ? entry.controller.signal : undefined);
    if (generation !== entry.generation) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    entry.url = url;
    const image = document.createElement('img');
    image.alt = entry.number + ' / ' + pages.length + ' 페이지';
    image.width = entry.file.width; image.height = entry.file.height;
    image.hidden = true; entry.image = image;
    entry.element.append(image);
    await new Promise((resolve, reject) => {
      entry.cancelImage = () => reject(new Error('Page no longer visible'));
      image.onload = resolve;
      image.onerror = () => reject(new Error('Page image failed'));
      image.src = url;
    });
    if (generation !== entry.generation) return;
    image.hidden = false;
    entry.element.dataset.ready = 'true';
  } catch (error) {
    if (generation === entry.generation) throw error;
  } finally {
    entry.loading = false; entry.cancelImage = null; entry.controller = null;
  }
}

function pump() {
  const center = innerHeight / 2;
  const candidates = pages.filter(p => p.wanted && !p.loading && !p.failed && p.element.dataset.ready !== 'true');
  candidates.sort((a,b) => {
    const distance = e => { const r=e.element.getBoundingClientRect(); return r.bottom < center ? center-r.bottom : Math.max(0,r.top-center); };
    return distance(a)-distance(b) || a.number-b.number;
  });
  while (active < 2 && candidates.length) {
    const entry = candidates.shift(); active++;
    loadPage(entry).catch(() => {
      if (entry.wanted) { release(entry); showPageError(entry); }
    }).finally(() => { active--; pump(); });
  }
}

function watchPages() {
  if (observer) observer.disconnect();
  if (cleanupWatch) { cleanupWatch(); cleanupWatch = null; }
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(changes => {
      for (const change of changes) {
        const entry = pages[Number(change.target.dataset.page)-1];
        entry.wanted = change.isIntersecting;
        if (!entry.wanted && (entry.image || entry.loading)) release(entry);
      }
      pump();
    }, { rootMargin: '1000px 0px' });
    pages.forEach(entry => observer.observe(entry.element));
  } else {
    let queued = false;
    const update = () => {
      queued = false;
      pages.forEach(entry => {
        const rect = entry.element.getBoundingClientRect();
        entry.wanted = rect.bottom >= -1000 && rect.top <= innerHeight + 1000;
        if (!entry.wanted && (entry.image || entry.loading)) release(entry);
      });
      pump();
    };
    const schedule = () => { if (!queued) { queued=true; requestAnimationFrame(update); } };
    addEventListener('scroll', schedule, { passive:true });
    addEventListener('resize', schedule);
    cleanupWatch = () => { removeEventListener('scroll',schedule); removeEventListener('resize',schedule); };
    update();
  }
}

async function boot() {
  let link;
  try { link = parseLink(location.hash); } catch { return; }
  if (!link) return;
  messageText.textContent = '문서를 여는 중입니다…';
  try {
    if (!crypto.subtle) throw new Error('Secure browser required');
    key = await importLinkKey(link.bytes); link.bytes.fill(0);
    const manifest = validateManifest(JSON.parse(new TextDecoder().decode(await fetchEncrypted(link.group,true))));
    const file = manifest.files.find(item => item.id === manifest.representative);
    if (!file || file.mime !== 'application/pdf') throw new Error('PDF unavailable');
    originalFile = file;
    if (!file.previewPages) throw new Error('Document pages unavailable');
    const fragment = document.createDocumentFragment();
    file.previewPages.forEach((preview,index) => {
      const element = document.createElement('section');
      element.className = 'pdf-page'; element.dataset.page = String(index+1); element.dataset.ready='false';
      element.style.paddingTop = (preview.height/preview.width*100) + '%';
      element.style.aspectRatio = preview.width + ' / ' + preview.height;
      element.setAttribute('aria-label',(index+1)+' / '+file.previewPages.length+' 페이지');
      pages.push({number:index+1,file:preview,element,generation:0,wanted:index===0,loading:false,failed:false});
      fragment.append(element);
    });
    document.title = manifest.title;
    documentView.setAttribute('aria-label',manifest.title);
    documentView.append(fragment);
    await loadPage(pages[0]);
    message.hidden = true; documentView.hidden = false;
    watchPages();
  } catch {
    if (observer) observer.disconnect();
    pages.forEach(release);
    documentView.hidden = true; message.hidden = false;
    messageText.textContent = '문서를 열 수 없습니다. 전체 링크와 인터넷 연결을 확인해 주세요.';
    retry.hidden = false;
    await prepareNativePdf();
  }
}

retry.addEventListener('click', () => location.reload());
addEventListener('hashchange', () => location.reload());
addEventListener('pagehide', () => {
  if (observer) observer.disconnect();
  if (cleanupWatch) { cleanupWatch(); cleanupWatch = null; }
  pages.forEach(entry => { entry.wanted=false; release(entry); });
  if (nativePdfUrl) URL.revokeObjectURL(nativePdfUrl);
});
addEventListener('pageshow', event => {
  if (!event.persisted) return;
  if (pages.length && !documentView.hidden) watchPages();
  else if (originalFile) prepareNativePdf();
});
boot();
