// Private extension messaging boundary. Never registers a page-window message listener.
(() => {
  'use strict';
  function install({ runtime = globalThis.chrome?.runtime, getState, unlock, lockAll,
    randomUUID = () => crypto.randomUUID(), now = () => Date.now() }) {
    let pending = null;
    const invalidate = () => { pending = null; };
    if (!runtime?.onMessage) return { invalidate };
    runtime.onMessage.addListener((message, sender, respond) => {
      if (sender.id !== runtime.id || sender.tab || sender.url !== runtime.getURL('cache-popup.html') ||
          message?.channel !== 'cvat-cache-private-v1') return false;
      if (!['status', 'unlock', 'lock-all'].includes(message.type)) return false;
      (async () => {
        const state = getState();
        if (!state.jobId) throw Error('Mở job CVAT trước khi dùng cache.');
        if (message.type === 'lock-all') { invalidate(); return { ok: true, message: await lockAll() }; }
        if (state.busy) throw Error('Chờ tác vụ hiện tại kết thúc rồi mở lại popup.');
        if (message.type === 'status') {
          pending = { ...state, nonce: randomUUID(), expires: now() + 120000 };
          return { ok: true, ...state, nonce: pending.nonce };
        }
        const issued = pending; invalidate(); // a challenge is consumed even on failure
        if (!issued || message.nonce !== issued.nonce || now() > issued.expires || state.origin !== issued.origin ||
            state.jobId !== issued.jobId || state.header !== issued.header || state.lockToken !== issued.lockToken) {
          throw Error('Yêu cầu mở khóa đã hết hạn hoặc cache đã khóa/đổi. Mở lại popup.');
        }
        return { ok: true, message: await unlock(message.proof, issued) };
      })().then(respond, error => respond({ ok: false, error: error.message || 'Không xử lý được cache.' }));
      return true; // callback API works on the minimum supported Chrome version
    });
    return { invalidate };
  }
  globalThis.CvatCacheChannel = { install };
})();
