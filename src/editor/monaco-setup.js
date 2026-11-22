// Monaco Editor worker environment setup & re-export

import * as monaco from 'monaco-editor';

/**
 * Configure global MonacoEnvironment worker factory if not already defined.
 * Hosts using custom bundler worker loaders (e.g. Vite `?worker`) can pass `{ getWorker, force: true }`.
 */
export function configureMonacoEnvironment(options = {}) {
  const g = typeof self !== 'undefined' ? self : globalThis;
  if (!g.MonacoEnvironment || options.force) {
    g.MonacoEnvironment = {
      getWorker:
        options.getWorker ||
        function (_workerId, _label) {
          return new Worker(
            new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
            { type: 'module' }
          );
        },
    };
  }
  return g.MonacoEnvironment;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  configureMonacoEnvironment();
}

export { monaco };
