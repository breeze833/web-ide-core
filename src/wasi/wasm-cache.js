// IndexedDB Persistent Cache for compiled WebAssembly.Module instances / ArrayBuffers

export function createWasmCache(options = {}) {
  const dbName = options.dbName || 'web-ide-wasm-cache';
  const dbVersion = Number.isFinite(options.dbVersion) ? options.dbVersion : 1;
  const storeName = options.storeName || 'wasm_modules';
  const getIDB = () => options.indexedDB || globalThis.indexedDB;

  function openWasmDb() {
    const idb = getIDB();
    if (!idb) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const req = idb.open(dbName, dbVersion);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function getWasmModule(key) {
    try {
      const db = await openWasmDb();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const req = store.get(key);
          req.onsuccess = () => {
            const val = req.result;
            if (typeof WebAssembly !== 'undefined' && val instanceof WebAssembly.Module) {
              resolve(val);
            } else if (val instanceof ArrayBuffer || ArrayBuffer.isView(val)) {
              if (typeof WebAssembly !== 'undefined' && typeof WebAssembly.compile === 'function') {
                WebAssembly.compile(val).then(resolve).catch(() => resolve(null));
              } else {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          };
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    } catch {
      return null;
    }
  }

  async function saveWasmModule(key, data) {
    if (!data) return false;
    const isModule = typeof WebAssembly !== 'undefined' && data instanceof WebAssembly.Module;
    const isBuffer = data instanceof ArrayBuffer || ArrayBuffer.isView(data);
    if (!isModule && !isBuffer) return false;

    try {
      const db = await openWasmDb();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const req = store.put(data, key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  }

  async function deleteWasmModule(key) {
    try {
      const db = await openWasmDb();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const req = store.delete(key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  }

  async function clearWasmCache() {
    try {
      const db = await openWasmDb();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const req = store.clear();
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  }

  return {
    dbName,
    storeName,
    openWasmDb,
    getWasmModule,
    saveWasmModule,
    deleteWasmModule,
    clearWasmCache,
  };
}

let defaultCache = null;
function getDefaultCache() {
  if (!defaultCache) {
    defaultCache = createWasmCache();
  }
  return defaultCache;
}

export function getWasmModule(key) {
  return getDefaultCache().getWasmModule(key);
}

export function saveWasmModule(key, data) {
  return getDefaultCache().saveWasmModule(key, data);
}

export function deleteWasmModule(key) {
  return getDefaultCache().deleteWasmModule(key);
}

export function clearWasmCache() {
  return getDefaultCache().clearWasmCache();
}
