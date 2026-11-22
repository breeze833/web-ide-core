// IndexedDB Persistence Layer for Virtual Workspace Directories

function normalizeRoot(rootPath) {
  const clean = `/${String(rootPath || '/workspace').replace(/^\/+|\/+$/g, '')}`;
  return clean === '/' ? '/workspace' : clean;
}

export function createWorkspaceStorage(options = {}) {
  const dbName = options.dbName || 'web_ide_db';
  const dbVersion = Number.isFinite(options.dbVersion) ? options.dbVersion : 1;
  const storeName = options.storeName || 'workspace_files';
  const rootPath = normalizeRoot(options.rootPath || '/workspace');
  const defaultDebounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : 600;
  const getIDB = () => options.indexedDB || globalThis.indexedDB;

  let syncTimeout = null;
  let unsubscribe = null;

  function openDatabase() {
    const idb = getIDB();
    if (!idb) {
      return Promise.reject(new Error('IndexedDB is not available'));
    }
    return new Promise((resolve, reject) => {
      const request = idb.open(dbName, dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'path' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveWorkspace(vfs) {
    const db = await openDatabase();
    const files = vfs.getAllFiles(rootPath);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      store.clear();

      for (const file of files) {
        store.put({
          path: file.path,
          isDir: file.isDir,
          content: file.isDir ? null : file.content,
          mtime: file.mtime,
        });
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  function seedDefaultWorkspace(vfs, defaultFiles = {}) {
    vfs.mkdir(rootPath, true);
    if (!defaultFiles || typeof defaultFiles !== 'object') return;

    const entries = defaultFiles instanceof Map
      ? Array.from(defaultFiles.entries())
      : Object.entries(defaultFiles);

    for (const [relOrAbsPath, content] of entries) {
      const normalized = relOrAbsPath.startsWith('/')
        ? relOrAbsPath
        : `${rootPath}/${relOrAbsPath.replace(/^\/+/, '')}`;
      const slashIdx = normalized.lastIndexOf('/');
      if (slashIdx > 0) {
        const parentDir = normalized.slice(0, slashIdx);
        vfs.mkdir(parentDir, true);
      }
      if (content === null) {
        vfs.mkdir(normalized, true);
      } else {
        vfs.writeFile(normalized, content);
      }
    }
  }

  async function loadWorkspace(vfs, defaultFilesOrOptions = {}) {
    const opts =
      defaultFilesOrOptions &&
      typeof defaultFilesOrOptions === 'object' &&
      ('defaultFiles' in defaultFilesOrOptions)
        ? defaultFilesOrOptions
        : { defaultFiles: defaultFilesOrOptions };

    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = async () => {
        try {
          const records = request.result || [];
          if (records.length === 0) {
            seedDefaultWorkspace(vfs, opts.defaultFiles || {});
            await saveWorkspace(vfs);
            resolve(false);
          } else {
            const dirs = records.filter((r) => r.isDir).sort((a, b) => a.path.length - b.path.length);
            const files = records.filter((r) => !r.isDir);

            for (const dir of dirs) {
              vfs.mkdir(dir.path, true);
            }
            for (const file of files) {
              vfs.writeFile(file.path, file.content, file.mtime);
            }
            resolve(true);
          }
        } catch (err) {
          reject(err);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async function clearWorkspace() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  function setupAutoSync(vfs, debounceMs = defaultDebounceMs) {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    const prefixWithSlash = `${rootPath}/`;
    unsubscribe = vfs.subscribe((event) => {
      if (event?.path && (event.path === rootPath || event.path.startsWith(prefixWithSlash))) {
        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
          saveWorkspace(vfs).catch((err) => console.error('IndexedDB sync error:', err));
        }, debounceMs);
      }
    });
    return () => {
      if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
  }

  return {
    rootPath,
    openDatabase,
    saveWorkspace,
    loadWorkspace,
    clearWorkspace,
    seedDefaultWorkspace,
    setupAutoSync,
  };
}

let defaultStorage = null;
function getDefaultStorage() {
  if (!defaultStorage) {
    defaultStorage = createWorkspaceStorage();
  }
  return defaultStorage;
}

export function openDatabase() {
  return getDefaultStorage().openDatabase();
}

export function saveWorkspace(vfs) {
  return getDefaultStorage().saveWorkspace(vfs);
}

export function loadWorkspace(vfs, defaultFilesOrOptions = {}) {
  return getDefaultStorage().loadWorkspace(vfs, defaultFilesOrOptions);
}

export function clearWorkspace() {
  return getDefaultStorage().clearWorkspace();
}

export function seedDefaultWorkspace(vfs, defaultFiles = {}) {
  return getDefaultStorage().seedDefaultWorkspace(vfs, defaultFiles);
}

export function setupAutoSync(vfs, debounceMs = 600) {
  return getDefaultStorage().setupAutoSync(vfs, debounceMs);
}
