// Keep cached HTML that references app.mjs on the current page viewer.
let stylesheet = document.querySelector('link[rel="stylesheet"]');
if (!stylesheet) {
  stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  document.head.append(stylesheet);
}
stylesheet.href = './pages.css?v=20260929-pending-1';
import('./pages.mjs?v=20260929-pending-1').catch(() => {
  document.getElementById('message-text').textContent = '문서를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
  const retry = document.getElementById('retry');
  retry.hidden = false;
  retry.addEventListener('click', () => location.reload());
});
