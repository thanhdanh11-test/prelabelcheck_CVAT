// Password-encrypted cache. Never persists passwords or CryptoKeys.
(() => {
  'use strict';
  const LOCK = 'cvat-cache-lock:v1', HEADER = 'cvat-cache-vault:v1', PREFIX = 'cvat-encrypted-origins:v1:', LEGACY = 'cvat-track-origins:v1:';
  const ITERATIONS = 600000, encoder = new TextEncoder(), decoder = new TextDecoder();
  const toBase64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };
  const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const fail = () => new Error('Cache đang khóa hoặc đã đổi ở tab khác. Mở khóa lại để tiếp tục.');
  function create({ storage = globalThis.localStorage, crypto = globalThis.crypto,
    locks = globalThis.navigator?.locks, origin = globalThis.location?.origin } = {}) {
    let key = null, headerRaw = null, header = null, generation = 0, lockToken = null;
    const lock = () => { generation++; key = header = headerRaw = lockToken = null; };
    function check(epoch) {
      if (!key || epoch !== generation || storage.getItem(HEADER) !== headerRaw || storage.getItem(LOCK) !== lockToken) { lock(); throw fail(); }
    }
    function aad(id, name) { return encoder.encode(JSON.stringify(['cvat-cache', 1, origin, id, name])); }
    async function encrypt(k, id, name, bytes) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(id, name), tagLength: 128 }, k, bytes);
      return { version: 1, iv: Array.from(iv), data: toBase64(new Uint8Array(data)) };
    }
    async function decrypt(k, id, name, value) {
      const valid = a => Array.isArray(a) && a.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
      if (value?.version !== 1 || !valid(value.iv) || value.iv.length !== 12 || typeof value.data !== 'string' || value.data.length < 24) throw Error('Dữ liệu cache mã hóa không hợp lệ.');
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv),
        additionalData: aad(id, name), tagLength: 128 }, k, fromBase64(value.data));
    }
    async function unlock(password, { transfer = false } = {}) {
      if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw Error('Mật khẩu cache cần 12–1024 ký tự.');
      if (!crypto?.subtle || !locks?.request) throw Error('Trình duyệt không hỗ trợ mã hóa/Web Locks; chỉ dùng RAM.');
      lock(); const epoch = generation, initialLock = storage.getItem(LOCK);
      return locks.request(HEADER, async () => {
        const raw = storage.getItem(HEADER);
        const config = raw ? JSON.parse(raw) : { version: 1, iterations: ITERATIONS,
          id: crypto.randomUUID(), salt: Array.from(crypto.getRandomValues(new Uint8Array(16))) };
        if (config.version !== 1 || config.iterations !== ITERATIONS || typeof config.id !== 'string' ||
            !Array.isArray(config.salt) || config.salt.length !== 16 || !config.salt.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw Error('Cấu hình cache không hợp lệ; không tự ghi đè.');
        const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
        password = '';
        const derived = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new Uint8Array(config.salt), iterations: ITERATIONS, hash: 'SHA-256' },
          material, { name: 'AES-GCM', length: 256 }, transfer, ['encrypt', 'decrypt']);
        if (raw) {
          try {
            const text = decoder.decode(await decrypt(derived, config.id, 'verifier', config.verifier));
            if (text !== 'CVAT cache vault v1') throw Error();
          } catch { throw Error('Sai mật khẩu hoặc cache đã hỏng. Không có dữ liệu nào bị xóa.'); }
        } else config.verifier = await encrypt(derived, config.id, 'verifier', encoder.encode('CVAT cache vault v1'));
        if (epoch !== generation || storage.getItem(HEADER) !== raw || storage.getItem(LOCK) !== initialLock) throw fail();
        const serialized = raw || JSON.stringify(config);
        if (!raw) storage.setItem(HEADER, serialized);
        if (transfer) {
          const exported = new Uint8Array(await crypto.subtle.exportKey('raw', derived));
          try { return { header: serialized, rawKey: Array.from(exported) }; }
          finally { exported.fill(0); }
        }
        key = derived; header = config; headerRaw = serialized; lockToken = initialLock;
      });
    }
    async function acceptUnlock(proof, expectedHeader, expectedLock) {
      lock(); const epoch = generation;
      if (!locks?.request || !crypto?.subtle) throw Error('Trình duyệt không hỗ trợ mã hóa/Web Locks.');
      try {
        return await locks.request(HEADER, async () => {
          if (storage.getItem(HEADER) !== expectedHeader || storage.getItem(LOCK) !== expectedLock || epoch !== generation) throw fail();
          if (typeof proof?.header !== 'string' || !Array.isArray(proof.rawKey) || proof.rawKey.length !== 32 ||
              !proof.rawKey.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw Error('Khóa từ popup không hợp lệ.');
          if (expectedHeader != null && proof.header !== expectedHeader) throw fail();
          const config = JSON.parse(proof.header);
          if (config.version !== 1 || config.iterations !== ITERATIONS || typeof config.id !== 'string' ||
              !Array.isArray(config.salt) || config.salt.length !== 16) throw Error('Cấu hình cache không hợp lệ.');
          const bytes = new Uint8Array(proof.rawKey);
          let imported;
          try { imported = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
          finally { bytes.fill(0); proof.rawKey.fill(0); }
          const verifier = decoder.decode(await decrypt(imported, config.id, 'verifier', config.verifier));
          if (verifier !== 'CVAT cache vault v1') throw fail();
          if (epoch !== generation || storage.getItem(HEADER) !== expectedHeader || storage.getItem(LOCK) !== expectedLock) throw fail();
          if (expectedHeader == null) storage.setItem(HEADER, proof.header);
          key = imported; header = config; headerRaw = proof.header; lockToken = expectedLock;
        });
      } finally { if (Array.isArray(proof?.rawKey)) proof.rawKey.fill(0); }
    }
    function lockAll() {
      // Each operation checks this token, including tabs that have not received storage events yet.
      try { storage.setItem(LOCK, crypto.randomUUID()); } finally { lock(); }
    }
    async function seal(name, bytes) {
      const epoch = generation; check(epoch);
      const encrypted = await encrypt(key, header.id, name, bytes); check(epoch); return encrypted;
    }
    async function open(name, value) {
      const epoch = generation; check(epoch);
      const bytes = await decrypt(key, header.id, name, value); check(epoch); return bytes;
    }
    const encryptedName = name => PREFIX + name.slice(LEGACY.length);
    async function readOrigins(name) {
      check(generation);
      const raw = storage.getItem(encryptedName(name));
      return raw == null ? null : decoder.decode(await open(name, JSON.parse(raw)));
    }
    async function writeOrigins(name, raw) {
      const epoch = generation, value = await seal(name, encoder.encode(raw)); check(epoch);
      storage.setItem(encryptedName(name), JSON.stringify(value));
    }
    async function migrateOrigins() {
      return locks.request(HEADER, async () => {
      check(generation);
      const names = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(n => n?.startsWith(LEGACY));
      for (const name of names) {
        const original = storage.getItem(name);
        if (original == null) continue;
        // A stale old tab may have written plaintext after migration. Do not overwrite a newer encrypted copy.
        const existing = await readOrigins(name);
        if (existing != null && existing !== original) throw Error('Nguồn item cũ và mã hóa khác nhau. Đóng tab tool cũ; chưa xóa bản nào.');
        if (existing == null) await writeOrigins(name, original);
        if (await readOrigins(name) !== original || storage.getItem(name) !== original) throw Error('Nguồn item đã đổi khi chuyển mã hóa. Thử lại sau khi đóng tab cũ.');
        storage.removeItem(name);
      }
      });
    }
    function wrapStore(store) {
      let epoch = 0;
      return {
        async get(name, metadataOnly = false) {
          if (!api.unlocked) return null;
          const version = epoch, value = await store.get(name, metadataOnly);
          if (version !== epoch) throw fail();
          if (!value || metadataOnly) return value;
          const bytes = await open(name, JSON.parse(decoder.decode(value)));
          if (version !== epoch || bytes.byteLength % 12) throw Error('Point cloud mã hóa không hợp lệ.');
          return new Float32Array(bytes);
        },
        async put(name, scope, xyz, protect = false) {
          if (!api.unlocked) return false;
          const version = epoch, generationBefore = generation;
          const value = await seal(name, new Uint8Array(xyz.buffer, xyz.byteOffset, xyz.byteLength));
          if (version !== epoch) return false;
          check(generationBefore);
          return store.put(name, scope, encoder.encode(JSON.stringify(value)), protect);
        },
        async count(scope) { return api.unlocked ? store.count(scope) : 0; },
        async clear() { epoch++; return store.clear(); },
      };
    }
    async function reset(clearCloud = async () => {}) {
      lockAll();
      if (!locks?.request) throw Error('Không hỗ trợ Web Locks.');
      await locks.request(HEADER, async () => {
        const names = Array.from({ length: storage.length }, (_, i) => storage.key(i));
        for (const name of names) if (name?.startsWith(PREFIX) || name?.startsWith(LEGACY)) storage.removeItem(name);
        storage.removeItem(HEADER);
        await clearCloud();
      });
    }
    const api = { acceptUnlock, lockAll, describe: () => ({ header: storage.getItem(HEADER), lockToken: storage.getItem(LOCK) }), withLock: action => locks.request(HEADER, action), unlock, lock, seal, open, readOrigins, writeOrigins, migrateOrigins, wrapStore, reset,
      get exists() { return storage.getItem(HEADER) != null; },
      get unlocked() { if (!key) return false; try { check(generation); return true; } catch { return false; } } };
    return api;
  }
  // Version bump fences old version-1 cloud writers. Never delete an entire site's databases.
  function retireLegacy({ indexedDB = globalThis.indexedDB, name = 'cvat-track-resizer-clouds-v1' } = {}) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 2); let failed = false;
      request.onblocked = () => { failed = true; reject(Error('Đóng các tab CVAT cũ để dọn cache chưa mã hóa, rồi mở khóa lại.')); };
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        for (const name of ['frames', 'meta']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (failed) { db.close(); return; }
        const tx = db.transaction(['frames', 'meta'], 'readwrite');
        tx.objectStore('frames').clear(); tx.objectStore('meta').clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }
  async function prepareUnlock(password, rawHeader, origin, { crypto = globalThis.crypto } = {}) {
    // Runs only in the extension popup. Temporary storage never touches the CVAT page.
    const values = new Map(rawHeader == null ? [] : [[HEADER, rawHeader]]);
    const storage = { getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value) };
    const vault = create({ storage, crypto, origin, locks: { request: (_name, fn) => fn() } });
    try { return await vault.unlock(password, { transfer: true }); }
    finally { password = ''; vault.lock(); values.clear(); }
  }
  globalThis.CvatCacheVault = { create, prepareUnlock, retireLegacy, HEADER, LOCK };
})();
