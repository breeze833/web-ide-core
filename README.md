# web-ide-core

A modular, **backend-agnostic** browser IDE workbench library providing Monaco multi-file editing, tab management, file tree explorer, xterm.js terminal emulator, detached floating VT100 terminal windowing, collapsible/resizable workbench layout, IndexedDB workspace persistence, and Zip project import/export—plus an **optional** `./wasi` adapter subpath for multi-worker WebAssembly/WASI IDEs.

Designed as the shared frontend workbench layer extracted from [wasm-c-ide](https://github.com/breeze833/wasm-c-ide), `web-ide-core` keeps its core UI, storage, and layout completely independent of any compiler, runtime, or programming language (supporting WASI, Pyodide, JS Web Workers, WebContainers, or remote WebSocket runtimes alike).

---

## Architecture: Backend-Agnostic Core vs Optional `./wasi`

```
web-ide-core (Core Workbench - Zero WASI/Toolchain Dependencies)
├── . / ./editor / ./terminal / ./ui / ./layout / ./workspace / ./style.css
│   └── Depends only on @xterm/xterm, @xterm/addon-fit, jszip, monaco-editor
│       Works with any duck-typed VFS & any execution backend
│
└── web-ide-core/wasi (Optional WASI Multi-Worker Adapters)
    ├── ./wasi/cache          -> IndexedDB WebAssembly binary cache
    ├── ./wasi/runtime        -> RuntimeManager (SharedArrayBuffer stdin + LineEditor + canvas input)
    ├── ./wasi/shell-worker   -> Parameterized BusyBox ash POSIX shell worker handler
    └── ./wasi/runtime-worker -> Parameterized WasiHost + canvas-wasi execution worker handler
```

Non-WASI consumers importing `.`, `./editor`, `./terminal`, `./ui`, `./layout`, `./workspace`, or `./style.css` never load WASI runtime dependencies. WASI-based IDEs install the optional peer packages and plug domain-specific compilers or host libraries cleanly through explicit hooks (`audioReceiver`, `resolveCustomImports`, `toolchainCommands`, `onCommandDispatch`).

---

## Installation

Install directly from GitHub Releases in `package.json`:

```json
{
  "dependencies": {
    "web-ide-core": "https://github.com/breeze833/web-ide-core/releases/download/latest/web-ide-core-0.1.0.tgz"
  }
}
```

If your IDE uses the optional `web-ide-core/wasi*` subpaths, also include the compatible WASI peer packages (`wasi-host`, `vfs-wasi`, `busybox-wasi`, `stdin-wasi`, `canvas-wasi`, `ansi-line-editor`) in your application's `dependencies`.

---

## Subpath Exports & Quick Start

### 1. Core Workbench UI & Editor

```js
import 'web-ide-core/style.css';
import {
  EditorManager,
  TabsUI,
  TerminalManager,
  BootProgress,
  FileTreeUI,
  LayoutManager,
  showToast,
  createWorkspaceStorage,
  exportWorkspaceZip,
  importWorkspaceZip,
} from 'web-ide-core';
```

Or import submodules individually:
- `web-ide-core/editor` (`EditorManager`, `DEFAULT_LANGUAGE_MAP`, `resolveLanguageForPath`)
- `web-ide-core/editor/monaco-setup` (`monaco`, `configureMonacoEnvironment`)
- `web-ide-core/editor/tabs` (`TabsUI`)
- `web-ide-core/terminal` (`TerminalManager`)
- `web-ide-core/terminal/boot-progress` (`BootProgress`)
- `web-ide-core/ui` / `web-ide-core/ui/filetree` (`FileTreeUI`)
- `web-ide-core/ui/toast` (`showToast`, `createToastManager`)
- `web-ide-core/layout` (`LayoutManager`)
- `web-ide-core/workspace` (`createWorkspaceStorage`, `loadWorkspace`, `saveWorkspace`, `seedDefaultWorkspace`, `setupAutoSync`)
- `web-ide-core/workspace/archive` (`exportWorkspaceZip`, `importWorkspaceZip`)

#### Workspace Persistence & Seeding

```js
const storage = createWorkspaceStorage({
  dbName: 'my_python_ide_db',
  rootPath: '/workspace',
});

await storage.loadWorkspace(vfs, {
  defaultFiles: {
    'main.py': 'print("Hello from web-ide-core!")\n',
  },
});

const stopSync = storage.setupAutoSync(vfs);
```

#### Editor, Tabs, FileTree, Terminal & Layout

```js
const editor = new EditorManager(document.getElementById('editor-container'), vfs, {
  fontSizeStorageKey: 'my_ide_editor_font_size',
  onDirtyChange: () => tabs.render(),
  onToggleSidebar: () => layout.toggleSidebar(),
});

const tabs = new TabsUI(document.getElementById('tabs-bar'), editor);

const terminal = new TerminalManager(document.getElementById('terminal-container'), {
  fontSizeStorageKey: 'my_ide_term_font_size',
  onInput: (data) => backend.sendInput(data),
  onInterrupt: () => backend.interrupt(),
});

const fileTree = new FileTreeUI(document.getElementById('file-tree'), vfs, {
  rootPath: '/workspace',
  expandedDirs: ['/workspace'],
  confirmDelete: (msg) => window.confirm(msg),
  promptName: (msg) => window.prompt(msg),
  onError: (msg) => showToast(msg, 'error'),
  onSelectFile: (path) => {
    editor.openFile(path);
    tabs.render();
  },
});

const layout = new LayoutManager({
  storagePrefix: 'my_ide_',
  editorManager: editor,
  terminalManager: terminal,
});
```

---

### 2. Optional WASI & Multi-Worker Adapters (`web-ide-core/wasi`)

- `web-ide-core/wasi` (barrel export)
- `web-ide-core/wasi/cache` (`createWasmCache`)
- `web-ide-core/wasi/runtime` (`RuntimeManager`)
- `web-ide-core/wasi/shell-worker` (`createShellWorkerHandler`, `attachShellWorker`)
- `web-ide-core/wasi/runtime-worker` (`runWasmBinary`, `createRuntimeWorkerHandler`, `attachRuntimeWorker`)

#### Injecting Domain Hooks Without Coupling

```js
// In consumer runtime.worker.js
import { attachRuntimeWorker } from 'web-ide-core/wasi/runtime-worker';

attachRuntimeWorker({
  cwd: '/workspace',
  systemDirs: ['/usr', '/bin', '/lib'],
  resolveCustomImports: ({ module, importObject, wasiHost, inputSharedBuffer, postMessage }) => {
    // Wire consumer-specific WebAssembly imports (e.g. raylib-wasi or custom host bridges)
  },
});
```

```js
// In consumer shell.worker.js
import { attachShellWorker } from 'web-ide-core/wasi/shell-worker';

attachShellWorker({
  cacheKey: 'busybox-1.38.0-build1',
  wasmUrl: (basePath) => `${basePath}/busybox.wasm`,
  toolchainCommands: ['gcc', 'clang', 'make'],
  onCommandDispatch: (payload) => {
    // Optionally intercept host commands synchronously
  },
});
```

---

## Development & Testing

```bash
npm install --no-audit --no-fund
npm test
npm run pack:tgz
```

For full architectural contracts and module API specifications, see [SPEC.md](./SPEC.md).

## License

[MIT](./LICENSE) © 2026 breeze833
