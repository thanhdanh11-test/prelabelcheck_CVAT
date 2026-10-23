// Extension-origin UI only. Password and transferable key never enter the page DOM or postMessage.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let tabID = null, info = null, busy = false, epoch = 0;
  const clear = () => { $('password').value = $('confirm-password').value = ''; };
  function controls() {
    $('unlock').disabled = busy || !info || info.unlocked;
    $('lock-all').disabled = busy || !info;
    $('password').disabled = busy || !info || info.unlocked;
    $('confirm-password').disabled = busy;
  }
  async function request(type, extra = {}) {
    const response = await chrome.tabs.sendMessage(tabID, { channel: 'cvat-cache-private-v1', type, ...extra }, { frameId: 0 });
    if (!response?.ok) throw Error(response?.error || 'Không kết nối được tool. Reload extension và tab CVAT rồi thử lại.');
    return response;
  }
  async function refresh() {
    info = await request('status');
    $('server').textContent = `${info.origin} · Job ${info.jobId}`;
    $('confirm-row').hidden = info.header != null;
    $('status').textContent = info.unlocked ? 'Cache tab này đã mở khóa.' : 'Cache đang khóa. Mật khẩu chỉ xử lý trong extension.';
    controls();
  }
  $('unlock-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !info) return;
    if (info.header == null && $('password').value !== $('confirm-password').value) {
      $('status').textContent = 'Hai mật khẩu không khớp.'; return;
    }
    const owner = ++epoch, context = info;
    let password = $('password').value, proof;
    clear(); busy = true; controls(); $('status').textContent = 'Đang mở khóa…';
    try {
      // Obtain a fresh one-use challenge before deriving. A subsequent global lock invalidates it.
      const fresh = await request('status');
      if (fresh.origin !== context.origin || fresh.jobId !== context.jobId || fresh.header !== context.header) throw Error('Tab/kho đã đổi. Mở lại popup để kiểm tra.');
      proof = await CvatCacheVault.prepareUnlock(password, fresh.header, fresh.origin); password = '';
      if (epoch !== owner) return;
      const result = await request('unlock', { nonce: fresh.nonce, proof });
      if (epoch !== owner) return;
      await refresh(); $('status').textContent = result.message;
    } catch (error) { if (epoch === owner) $('status').textContent = error.message; }
    finally { password = ''; proof?.rawKey?.fill(0); clear(); busy = false; controls(); }
  });
  $('lock-all').addEventListener('click', async () => {
    if (busy || !info) return;
    busy = true; epoch++; clear(); controls();
    try { const result = await request('lock-all'); await refresh(); $('status').textContent = result.message; }
    catch (error) { $('status').textContent = error.message; }
    finally { busy = false; controls(); }
  });
  addEventListener('pagehide', () => { epoch++; clear(); info = null; });
  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:/.test(tab.url || '')) throw Error('Mở một job CVAT rồi bấm biểu tượng extension.');
      tabID = tab.id; await refresh();
      if (new URL(tab.url).origin !== info.origin) throw Error('Tab đã đổi địa chỉ; mở lại popup.');
    } catch (error) { info = null; $('status').textContent = error.message; controls(); }
  })();
})();
