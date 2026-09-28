import { parseLink, importLinkKey, decryptAsset } from './crypto.mjs';

const status = document.querySelector('#status');
const anchor = document.querySelector('#download');
let objectUrl;
async function start() {
  const link = parseLink(location.hash);
  if (!link) return;
  try {
    status.textContent = 'PNG 다운로드를 준비하고 있습니다…';
    const key = await importLinkKey(link.bytes);
    link.bytes.fill(0);
    const response = await fetch('./assets/' + link.group + '.bin', {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
    if (!response.ok) throw new Error('Unavailable');
    const value = JSON.parse(new TextDecoder().decode(await decryptAsset(link.group, await response.arrayBuffer(), key)));
    if (value?.version !== 1 || value.mime !== 'image/png' || typeof value.name !== 'string' ||
        !value.name.endsWith('.png') || value.name.length > 120 || /[<>:"/\\|?*\x00-\x1f]/.test(value.name) ||
        !Number.isSafeInteger(value.bytes) || value.bytes < 8 || value.bytes > 5_000_000 ||
        !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.data !== 'string' ||
        value.data.length > 7_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) throw new Error('Invalid file');
    const bytes = Uint8Array.from(atob(value.data), c => c.charCodeAt(0));
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (bytes.length !== value.bytes || digest !== value.sha256 || !signature.every((b, i) => bytes[i] === b)) throw new Error('Integrity check failed');
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    document.title = value.name;
    document.querySelector('h1').textContent = value.name;
    anchor.href = objectUrl;
    anchor.download = value.name;
    anchor.textContent = value.name + ' 다운로드';
    anchor.hidden = false;
    status.textContent = '다운로드가 시작되지 않으면 아래를 눌러주세요.';
    anchor.click();
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    anchor.hidden = true;
    status.textContent = '파일을 받을 수 없습니다. 전달받은 전체 링크와 인터넷 연결을 확인해 주세요.';
  }
}
addEventListener('pagehide', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
start();
