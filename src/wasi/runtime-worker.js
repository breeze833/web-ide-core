// Generic WASI Execution Worker Handler
// Coordinates WasiHost, StdinReader, canvas-wasi offscreen imports, and injected domain import hooks

import { createGraphicsImports } from 'canvas-wasi/worker';
import { createStdinReader } from 'stdin-wasi/worker';
import { OverlayVFS } from 'vfs-wasi';
import { WasiHost, ProcExit, normalizePath } from 'wasi-host';

export { ProcExit, normalizePath };

export async function runWasmBinary(wasmBytes, runtimeOpts = {}, workerOpts = {}) {
  const {
    argv = ['./a.out'],
    environ = {},
    stdinBytes = null,
    sharedBuffer = null,
    inputSharedBuffer = null,
    raylibSharedBuffer = null,
    files: initialFiles = {},
    sharedSysrootBuffer = null,
  } = runtimeOpts;

  const {
    cwd = '/workspace',
    envDefaults = { USER: 'user', HOME: '/workspace', PWD: '/workspace' },
    preopens = [
      { fd: 3, path: '/workspace', name: '.' },
      { fd: 4, path: '/', name: '/' },
    ],
    systemDirs = [],
    vfsFactory = () => new OverlayVFS({ workingDir: '/' }),
    enableGraphics = true,
    resolveCustomImports = null,
    postMessage = (data, transfer) => globalThis.self?.postMessage?.(data, transfer),
    onGraphicsHostChange = null,
  } = workerOpts;

  let memoryInstance = null;
  function memU8() {
    return new Uint8Array(memoryInstance.buffer);
  }
  function memU32() {
    return new Uint32Array(memoryInstance.buffer);
  }

  const readStdin = createStdinReader({
    sharedBuffer,
    stdinBytes,
    getMemory: () => memoryInstance,
    notifyHost: () => postMessage({ type: 'stdin_request' }),
  });

  const vfs = vfsFactory();
  if (sharedSysrootBuffer && typeof vfs.setSharedSysroot === 'function') {
    vfs.setSharedSysroot(sharedSysrootBuffer);
  }
  for (const [k, v] of Object.entries(initialFiles || {})) {
    const norm = normalizePath(k);
    const u8 =
      typeof v === 'string'
        ? new TextEncoder().encode(v)
        : v instanceof Uint8Array
          ? v
          : new Uint8Array(v);
    vfs.writeFile(norm, u8, Date.now(), true);
  }

  const wasiHost = new WasiHost({
    vfs,
    cwd,
    argv: argv || ['./a.out'],
    environ: { ...envDefaults, ...(environ || {}) },
    preopens,
    systemDirs,
    stdin: readStdin,
    stdout: (text) => postMessage({ type: 'stdout', data: text }),
    stderr: (text) => postMessage({ type: 'stdout', data: text }),
    getMemory: () => memoryInstance,
    onFileSync: (path, data) => {
      try {
        postMessage({ type: 'file_sync', path, data });
      } catch (_) {}
    },
    onFileDelete: (path) => {
      try {
        postMessage({ type: 'file_delete', path });
      } catch (_) {}
    },
  });

  const wasi = wasiHost.getImports();

  const env = {
    getcwd(buf, size) {
      if (!buf || size <= 0) return 0;
      const len = Math.min(size - 1, cwd.length);
      for (let i = 0; i < len; i++) {
        memU8()[buf + i] = cwd.charCodeAt(i);
      }
      memU8()[buf + len] = 0;
      return buf;
    },
    chdir() {
      return 0;
    },
    time(time_out) {
      const sec = Math.floor(Date.now() / 1000);
      if (time_out) {
        memU32()[time_out >> 2] = sec;
      }
      return sec;
    },
    __assert_fail() {
      return 0;
    },
  };

  const envProxy = new Proxy(env, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => 0;
    },
  });

  const module = await WebAssembly.compile(wasmBytes);
  const importsList = WebAssembly.Module.imports(module);

  const importObject = {
    wasi_snapshot_preview1: wasi,
    wasi_unstable: wasi,
    env: envProxy,
  };

  const resolvedInputBuffer = inputSharedBuffer ?? raylibSharedBuffer;
  let graphicsHost = null;

  if (enableGraphics) {
    graphicsHost = createGraphicsImports({
      getMemory: () => memoryInstance,
      sharedBuffer: resolvedInputBuffer,
      postMessage: (data, transfer) => postMessage(data, transfer),
    });
    const genericGraphics = graphicsHost.env;

    importObject.graphics = new Proxy(genericGraphics, {
      get(t, p) {
        if (p in t) return t[p];
        return () => 0;
      },
    });
    importObject.fb = importObject.graphics;
    importObject.canvas = importObject.graphics;

    for (const [name, fn] of Object.entries(genericGraphics)) {
      env[name] = fn;
    }
  }

  let customHooks = null;
  if (typeof resolveCustomImports === 'function') {
    customHooks = await resolveCustomImports({
      module,
      importsList,
      importObject,
      wasiHost,
      getMemory: () => memoryInstance,
      vfs,
      sharedBuffer,
      inputSharedBuffer: resolvedInputBuffer,
      postMessage,
    });
  }

  if (typeof onGraphicsHostChange === 'function') {
    onGraphicsHostChange({
      handleInputEvent(ev) {
        if (graphicsHost && typeof graphicsHost.handleInputEvent === 'function') {
          graphicsHost.handleInputEvent(ev);
        }
        if (customHooks && typeof customHooks.handleInputEvent === 'function') {
          customHooks.handleInputEvent(ev);
        }
      },
    });
  }

  const instance = await WebAssembly.instantiate(module, importObject);
  memoryInstance = instance.exports.memory;
  if (customHooks && typeof customHooks.onInstance === 'function') {
    customHooks.onInstance(instance);
  }

  try {
    if (typeof instance.exports._start === 'function') {
      instance.exports._start();
    } else if (typeof instance.exports.main === 'function') {
      instance.exports.main();
    }
  } finally {
    if (customHooks && typeof customHooks.cleanup === 'function') {
      try {
        customHooks.cleanup();
      } catch (_) {}
    }
    if (typeof onGraphicsHostChange === 'function') {
      onGraphicsHostChange(null);
    }
  }

  return { changedFiles: wasiHost.changedFiles, deletedFiles: wasiHost.deletedFiles };
}

export function createRuntimeWorkerHandler(options = {}) {
  const postMsg = options.postMessage || ((data, transfer) => globalThis.self?.postMessage?.(data, transfer));
  let activeInputTarget = null;

  async function onmessage(event) {
    const msg = event?.data;
    if (!msg) return;

    if (msg.type === 'input_event' && msg.event) {
      if (activeInputTarget && typeof activeInputTarget.handleInputEvent === 'function') {
        activeInputTarget.handleInputEvent(msg.event);
      }
      return;
    }

    if (msg.type === 'run') {
      try {
        const res = await runWasmBinary(msg.wasmBytes, msg, {
          ...options,
          postMessage: postMsg,
          onGraphicsHostChange: (target) => {
            activeInputTarget = target;
          },
        });
        const changes = {};
        if (res && res.changedFiles) {
          for (const [k, v] of res.changedFiles.entries()) {
            changes[k] = v;
          }
        }
        const del = res && res.deletedFiles ? Array.from(res.deletedFiles) : [];
        postMsg({ type: 'done', exitCode: 0, changedFiles: changes, deletedFiles: del });
      } catch (err) {
        if (
          err instanceof ProcExit ||
          (err && err.code !== undefined && err.message && err.message.startsWith('Exited with code'))
        ) {
          const changes = {};
          if (err.changedFiles) {
            for (const [k, v] of err.changedFiles.entries()) {
              changes[k] = v;
            }
          }
          const del = err.deletedFiles ? Array.from(err.deletedFiles) : [];
          postMsg({ type: 'done', exitCode: err.code, changedFiles: changes, deletedFiles: del });
        } else {
          postMsg({ type: 'error', error: err.message, stack: err.stack });
        }
      }
    }
  }

  return { onmessage };
}

export function attachRuntimeWorker(options = {}) {
  const target = options.selfObj || globalThis.self || globalThis;
  const handler = createRuntimeWorkerHandler({
    ...options,
    postMessage: options.postMessage || ((data, transfer) => target.postMessage(data, transfer)),
  });
  target.onmessage = handler.onmessage;
  return handler;
}
