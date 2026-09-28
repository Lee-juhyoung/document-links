import { parseLink, importLinkKey, decryptAsset, validateManifest } from './crypto.mjs?v=20260928-compat-1';
let pdfjs;

const documentView = document.getElementById('document');
const message = document.getElementById('message');
const messageText = document.getElementById('message-text');
const retry = document.getElementById('retry');
const nativePdf = document.getElementById('open-pdf');
const pages = [];
const nearby = new Set();
let key, pdf, observer, activeRender, loading, verifiedFile, verifiedBytes, nativePdfUrl;
let rendering = false;
let layoutWidth = 0;
let layoutVersion = 0;

async function fetchEncrypted(id, manifest = false) {
  const response = await fetch('./assets/' + id + '.bin', {
    credentials: 'omit', referrerPolicy: 'no-referrer',
    ...(manifest ? { cache: 'no-store' } : {}),
  });
  if (!response.ok) throw new Error('Document unavailable');
  return decryptAsset(id, await response.arrayBuffer(), key);
}

async function verifiedPdfBytes(file) {
  const bytes = await fetchEncrypted(file.id);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== file.sha256 || bytes.byteLength !== file.bytes) throw new Error('Document integrity failed');
  return bytes;
}

async function prepareNativePdf() {
  if (!verifiedFile) return;
  try {
    const bytes = verifiedBytes?.byteLength ? verifiedBytes : await verifiedPdfBytes(verifiedFile);
    nativePdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    nativePdf.href = nativePdfUrl;
    nativePdf.download = verifiedFile.name;
    nativePdf.hidden = false;
    messageText.textContent = '이 브라우저에서 미리보기를 표시하지 못했습니다. PDF 파일을 내려받아 열어주세요.';
  } catch { /* Keep the retry option when the original cannot be fetched. */ }
}

function releasePage(entry) {
  if (entry === activeRender?.entry) {
    activeRender.task.cancel();
    return;
  }
  if (entry.canvas) {
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.canvas.remove();
    entry.canvas = null;
  }
  entry.element.dataset.ready = 'false';
  entry.renderedWidth = 0;
  entry.page.cleanup();
}

function showPageError(entry) {
  entry.failed = true;
  const box = document.createElement('div');
  box.className = 'page-error';
  box.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.textContent = '이 페이지를 표시하지 못했습니다.';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '다시 시도';
  button.addEventListener('click', () => {
    box.remove();
    entry.failed = false;
    renderNearby();
  });
  box.append(text, button);
  entry.element.append(box);
}

function nextPage() {
  const center = innerHeight / 2;
  return [...nearby]
    .filter(entry => !entry.failed && entry.renderedWidth !== layoutWidth)
    .sort((a, b) => {
      const ar = a.element.getBoundingClientRect();
      const br = b.element.getBoundingClientRect();
      const distance = rect => rect.bottom < center ? center - rect.bottom : Math.max(0, rect.top - center);
      return distance(ar) - distance(br) || a.number - b.number;
    })[0];
}

async function renderNearby() {
  if (rendering || !layoutWidth) return;
  rendering = true;
  try {
    let entry;
    while ((entry = nextPage())) {
      const version = layoutVersion;
      const width = layoutWidth;
      releasePage(entry);
      const viewport = entry.page.getViewport({ scale: width / entry.base.width, rotation: entry.rotation });
      const resolution = Math.min(
        devicePixelRatio || 1, 2,
        Math.sqrt(5_000_000 / (viewport.width * viewport.height)),
        8192 / Math.max(viewport.width, viewport.height),
      );
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width * resolution));
      canvas.height = Math.max(1, Math.floor(viewport.height * resolution));
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', entry.number + ' / ' + pdf.numPages + ' 페이지');
      canvas.hidden = true;
      entry.canvas = canvas;
      entry.element.append(canvas);
      try {
        const task = entry.page.render({
          canvasContext: canvas.getContext('2d'), viewport,
          transform: resolution === 1 ? null : [resolution, 0, 0, resolution, 0, 0],
        });
        activeRender = { entry, task };
        await task.promise;
        activeRender = null;
        if (version !== layoutVersion || !nearby.has(entry)) {
          releasePage(entry);
          continue;
        }
        canvas.hidden = false;
        entry.renderedWidth = width;
        entry.element.dataset.ready = 'true';
      } catch (error) {
        activeRender = null;
        releasePage(entry);
        if (error.name !== 'RenderingCancelledException') showPageError(entry);
      }
    }
  } finally {
    rendering = false;
  }
}

function watchPages() {
  observer?.disconnect();
  nearby.clear();
  observer = new IntersectionObserver(changes => {
    for (const change of changes) {
      const entry = pages[Number(change.target.dataset.page) - 1];
      if (change.isIntersecting) {
        nearby.add(entry);
      } else {
        nearby.delete(entry);
        releasePage(entry);
      }
    }
    renderNearby();
  }, { rootMargin: innerHeight + 'px 0px' });
  for (const entry of pages) observer.observe(entry.element);
}

async function boot() {
  let link;
  try { link = parseLink(location.hash); } catch { return; }
  if (!link) return;
  messageText.textContent = '문서를 여는 중입니다…';
  try {
    if (!crypto.subtle) throw new Error('Secure browser required');
    key = await importLinkKey(link.bytes);
    link.bytes.fill(0);
    const manifest = validateManifest(JSON.parse(new TextDecoder().decode(await fetchEncrypted(link.group, true))));
    const file = manifest.files.find(item => item.id === manifest.representative);
    if (!file || file.mime !== 'application/pdf') throw new Error('PDF unavailable');
    const bytes = await verifiedPdfBytes(file);
    verifiedFile = file;
    verifiedBytes = bytes;
    pdfjs = await import('./vendor/pdf-legacy.mjs?v=6.3.289');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker-legacy.mjs?v=6.3.289', import.meta.url).href;
    loading = pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, enableXfa: false,
      cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
      wasmUrl: new URL('./vendor/wasm/', import.meta.url).href,
    });
    let loadingTimer;
    try {
      pdf = await Promise.race([loading.promise, new Promise((_, reject) => {
        loadingTimer = setTimeout(() => reject(new Error('PDF loading timeout')), 30000);
      })]);
    } finally { clearTimeout(loadingTimer); }
    verifiedBytes = null;
    const rotations = file.pageRotations || {};
    if (Object.keys(rotations).some(number => Number(number) > pdf.numPages)) throw new Error('Page rotation outside document');
    const fragment = document.createDocumentFragment();
    // Only page dimensions are read up front. Canvas memory is limited to nearby pages.
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const rotation = (page.rotate + (rotations[number] ?? 0)) % 360;
      const base = page.getViewport({ scale: 1, rotation });
      const element = document.createElement('section');
      element.className = 'pdf-page';
      element.dataset.page = String(number);
      element.dataset.ready = 'false';
      element.style.aspectRatio = base.width + ' / ' + base.height;
      element.setAttribute('aria-label', number + ' / ' + pdf.numPages + ' 페이지');
      pages.push({ number, page, base, rotation, element, canvas: null, renderedWidth: 0, failed: false });
      fragment.append(element);
    }
    document.title = file.name;
    documentView.setAttribute('aria-label', file.name);
    documentView.append(fragment);
    documentView.hidden = false;
    message.hidden = true;
    layoutWidth = documentView.clientWidth;
    watchPages();
    let resizeTimer;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const width = documentView.clientWidth;
        if (width !== layoutWidth) {
          layoutWidth = width;
          layoutVersion++;
          for (const entry of pages) releasePage(entry);
        }
        watchPages();
      }, 160);
    });
  } catch {
    observer?.disconnect();
    documentView.hidden = true;
    message.hidden = false;
    messageText.textContent = '문서를 열 수 없습니다. 전체 링크와 인터넷 연결을 확인해 주세요.';
    retry.hidden = false;
    try { await loading?.destroy(); } catch { /* A failed worker may already be gone. */ }
    await prepareNativePdf();
  }
}

retry.addEventListener('click', () => location.reload());
addEventListener('hashchange', () => location.reload());
addEventListener('pagehide', () => { if (nativePdfUrl) URL.revokeObjectURL(nativePdfUrl); });
boot();
