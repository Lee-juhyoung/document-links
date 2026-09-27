import { parseLink, importLinkKey, decryptAsset, validateManifest } from './crypto.mjs';
import * as pdfjs from './vendor/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
let manifest, key, pdf, renderTask, currentFile, downloadUrl, imageUrl;
let pageNumber = 1, zoom = 1, rotation = 0, loadSequence = 0;
let renderQueue = Promise.resolve();
let renderedPage = 0;
const MiB = bytes => (bytes / 1048576).toFixed(1) + ' MB';

async function fetchEncrypted(id) {
  const response = await fetch('./assets/' + id + '.bin', { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('Document unavailable');
  return decryptAsset(id, await response.arrayBuffer(), key);
}
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function pageControls() {
  const count = pdf?.numPages || 1;
  $('page-number').value = pageNumber;
  $('page-number').max = count;
  $('page-number').disabled = !pdf;
  $('page-count').textContent = '/ ' + count;
  $('previous').disabled = !pdf || pageNumber <= 1;
  $('next').disabled = !pdf || pageNumber >= count;
  for (const id of ['zoom-in', 'zoom-out', 'fit-width', 'rotate']) $(id).disabled = !pdf;
}
async function renderPage() {
  if (!pdf) return;
  const activePdf = pdf;
  const requestedPage = pageNumber;
  const sequence = loadSequence;
  const page = await activePdf.getPage(requestedPage);
  if (sequence !== loadSequence || activePdf !== pdf) return;
  const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const stage = $('paper-stage');
  const availableWidth = Math.max(240, stage.clientWidth - (innerWidth < 680 ? 18 : 46));
  const viewport = page.getViewport({ scale: (availableWidth / base.width) * zoom, rotation: (page.rotate + rotation) % 360 });
  const resolution = Math.min(devicePixelRatio || 1, 2, 6500 / Math.max(viewport.width, viewport.height));
  const canvas = $('pdf-canvas');
  canvas.width = Math.floor(viewport.width * resolution);
  canvas.height = Math.floor(viewport.height * resolution);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  canvas.hidden = false;
  renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: resolution === 1 ? null : [resolution, 0, 0, resolution, 0, 0] });
  await renderTask.promise;
  renderTask = null;
  if (sequence !== loadSequence) return;
  canvas.setAttribute('aria-label', currentFile.name + ', ' + requestedPage + ' / ' + activePdf.numPages + ' 페이지');
  canvas.dataset.page = String(requestedPage);
  canvas.dataset.ready = 'true';
  status(requestedPage + ' / ' + activePdf.numPages + ' 페이지 · ' + Math.round(zoom * 100) + '%');
  if (renderedPage !== requestedPage) stage.scrollTo(0, 0);
  renderedPage = requestedPage;
  pageControls();
}
function scheduleRender() {
  renderQueue = renderQueue.catch(() => {}).then(renderPage).catch(error => {
    if (error.name !== 'RenderingCancelledException') status('페이지 표시가 지연되고 있습니다. 다시 선택하거나 현재 문서를 저장해 열어주세요.', true);
  });
  return renderQueue;
}
async function openFile(id) {
  const sequence = ++loadSequence;
  const file = manifest.files.find(item => item.id === id);
  if (!file) return;
  $('download').disabled = true;
  $('pdf-canvas').hidden = true;
  $('pdf-canvas').dataset.ready = 'false';
  $('image-page').hidden = true;
  $('file-info').textContent = (file.pages ? file.pages + '쪽 · ' : '') + MiB(file.bytes);
  status('문서를 여는 중입니다…');
  try {
  const oldPdf = pdf; pdf = null;
  pageControls();
  if (renderTask) renderTask.cancel();
  await renderQueue.catch(() => {});
  if (oldPdf) await oldPdf.loadingTask.destroy();
  if (sequence !== loadSequence) return;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  downloadUrl = null; imageUrl = null;
    const bytes = await fetchEncrypted(file.id);
    if (sequence !== loadSequence) return;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (sequence !== loadSequence) return;
    if (digest !== file.sha256 || bytes.byteLength !== file.bytes) throw new Error('Document integrity failed');
    currentFile = file;
    downloadUrl = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
    $('download').disabled = false;
    pageNumber = 1; zoom = 1; rotation = 0; renderedPage = 0;
    if (file.mime === 'application/pdf') {
      const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, enableXfa: false, cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href, cMapPacked: true, standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href, wasmUrl: new URL('./vendor/wasm/', import.meta.url).href });
      const nextPdf = await loading.promise;
      if (sequence !== loadSequence) { await nextPdf.loadingTask.destroy(); return; }
      pdf = nextPdf;
      await scheduleRender();
    } else {
      imageUrl = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
      $('image-page').src = imageUrl;
      $('image-page').alt = file.name;
      await $('image-page').decode();
      if (sequence !== loadSequence) return;
      $('image-page').hidden = false;
      pageControls();
      status('이미지 문서 · ' + MiB(file.bytes));
    }
  } catch {
    if (sequence !== loadSequence) return;
    $('download').disabled = !downloadUrl;
    status('문서를 열지 못했습니다. 인터넷 연결을 확인한 뒤 문서를 다시 선택해 주세요.', true);
  }
}
async function boot() {
  let link;
  try { link = parseLink(location.hash); } catch { return; }
  if (!link) return;
  $('gate-title').textContent = '문서를 확인하고 있습니다';
  $('gate-description').textContent = '잠시만 기다려 주세요.';
  try {
    if (!crypto.subtle) throw new Error('Secure browser required');
    key = await importLinkKey(link.bytes);
    link.bytes.fill(0);
    manifest = validateManifest(JSON.parse(new TextDecoder().decode(await fetchEncrypted(link.group))));
    $('group-title').textContent = manifest.title;
    $('group-summary').textContent = '대표 문서부터 표시합니다. 이 묶음의 문서는 ' + manifest.files.length + '개입니다.';
    const sorted = [...manifest.files].sort((a, b) => Number(b.id === manifest.representative) - Number(a.id === manifest.representative));
    for (const file of sorted) {
      const option = document.createElement('option');
      option.value = file.id;
      option.textContent = (file.id === manifest.representative ? '대표 · ' : '') + file.name;
      $('document-select').append(option);
    }
    $('gate').hidden = true;
    $('workspace').hidden = false;
    await openFile(manifest.representative);
  } catch {
    $('workspace').hidden = true;
    $('gate').hidden = false;
    $('gate-title').textContent = '문서를 열 수 없습니다';
    $('gate-description').textContent = '전달받은 전체 링크인지 확인해 주세요. 연결이 끊겼다면 다시 시도해 주세요.';
    $('retry').hidden = false;
  }
}
$('retry').addEventListener('click', () => location.reload());
$('document-select').addEventListener('change', event => openFile(event.target.value));
$('previous').addEventListener('click', () => { if (pdf && pageNumber > 1) { pageNumber--; scheduleRender(); } });
$('next').addEventListener('click', () => { if (pdf && pageNumber < pdf.numPages) { pageNumber++; scheduleRender(); } });
function jumpToPage() {
  if (!pdf) return;
  pageNumber = Math.min(pdf.numPages, Math.max(1, Number.parseInt($('page-number').value, 10) || 1));
  scheduleRender();
}
$('page-number').addEventListener('change', jumpToPage);
$('page-number').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); jumpToPage(); } });
$('zoom-in').addEventListener('click', () => { zoom = Math.min(3, zoom + .25); scheduleRender(); });
$('zoom-out').addEventListener('click', () => { zoom = Math.max(.5, zoom - .25); scheduleRender(); });
$('fit-width').addEventListener('click', () => { zoom = 1; scheduleRender(); });
$('rotate').addEventListener('click', () => { rotation = (rotation + 90) % 360; scheduleRender(); });
$('download').addEventListener('click', () => {
  if (!downloadUrl || !currentFile) return;
  const anchor = document.createElement('a'); anchor.href = downloadUrl; anchor.download = currentFile.name; anchor.rel = 'noreferrer'; anchor.click();
});
let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(scheduleRender, 160); });
addEventListener('hashchange', () => location.reload());
boot();
