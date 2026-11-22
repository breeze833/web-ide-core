// Optional WASI & Multi-Worker Adapter Barrel Exports for web-ide-core

export {
  createWasmCache,
  getWasmModule,
  saveWasmModule,
  deleteWasmModule,
  clearWasmCache,
} from './wasm-cache.js';

export { RuntimeManager } from './runtime.js';

export {
  createShellWorkerHandler,
  attachShellWorker,
  findHeredocs,
  getPendingHeredocs,
  closePendingHeredocs,
  hasUnquotedShellOperators,
  tokenizeSimpleCommand,
} from './shell-worker.js';

export {
  runWasmBinary,
  createRuntimeWorkerHandler,
  attachRuntimeWorker,
  ProcExit,
  normalizePath,
} from './runtime-worker.js';
