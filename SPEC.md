# Technical Specification: `web-ide-core`

## 1. Overview & Purpose

`web-ide-core` is a modular, backend-agnostic browser IDE workbench library extracted from `wasm-c-ide`. It provides the reusable frontend shell—Monaco editor integration, multi-tab management, file tree explorer, xterm.js terminal wrapper, progressive boot status renderer, resizable/collapsible workbench layout (including a detached VT100 floating terminal), IndexedDB workspace persistence, and Zip project import/export—with zero assumptions about programming language, compiler, or execution runtime.

Future browser IDEs (C/C++ via WebAssembly/WASI, Python via Pyodide, JavaScript/TypeScript via Web Workers or WebContainers, or remote containers via WebSocket) share the exact same UI workbench (`web-ide-core`) while plugging in their own execution backend.

For WASI-based IDEs specifically, `web-ide-core/wasi` provides an **optional** adapter layer coordinating `SharedArrayBuffer`/`Atomics` stdin, multi-worker POSIX `ash` shell orchestration, sandboxed WASI program execution, offscreen canvas input/frame messaging, and IndexedDB WebAssembly binary caching—without coupling the core UI or dragging WASI dependencies into non-WASI consumers.

---

## 2. Core Architectural Invariants

1. **Backend-Agnostic Core Exports**:
   - Subpaths `.`, `./editor`, `./terminal`, `./workspace`, `./layout`, `./ui`, and `./style.css` MUST NOT import or depend on any Wasm/WASI packages (`wasi-host`, `vfs-wasi`, `busybox-wasi`, `stdin-wasi`, `canvas-wasi`, `ansi-line-editor`, `clang-wasi`, `raylib-wasi`, `make-wasi`, `sqlite-wasi`).
2. **Duck-Typed VFS Contract**:
   - Core modules interact with workspaces through a minimal VFS interface compatible with `vfs-wasi`'s `OverlayVFS` as well as arbitrary lightweight implementations:
     - `exists(path): boolean`
     - `readFile(path, asTextOrBinary?): string | Uint8Array`
     - `writeFile(path, content, mtime?, isInternal?): void`
     - `mkdir(path, options?): void`
     - `remove(path, options?): void`
     - `readDir(path): string[]` (or entry names)
     - `getAllFiles(prefix?): Map<string, Uint8Array | string> | Array<{ path, content }>`
     - `subscribe(listener): () => void`
3. **Zero Consumer-Specific Globals or Storage Keys**:
   - No `window.__ideApp` globals, no hardcoded `wasm_ide_*` `localStorage` keys, no hardcoded `wasm_c_ide_db` IndexedDB names, no hardcoded `/workspace/src/main.c` seed files, and no hardcoded `Sysroot setup notice:` error prefixes.
   - All storage keys, DB names, root paths, initial expanded directories, notice strings, and sidebar/layout toggles are explicitly configurable via constructor/factory options with sensible `web_ide_*` defaults.
4. **Domain Neutrality in `./wasi`**:
   - `web-ide-core/wasi` depends ONLY on generic runtime primitives (`wasi-host`, `vfs-wasi`, `busybox-wasi`, `stdin-wasi`, `canvas-wasi`, `ansi-line-editor`) declared as optional `peerDependencies`.
   - Domain-specific toolchains and libraries (`clang-wasi`, `raylib-wasi`, `make-wasi`, `sqlite-wasi`, `libturtle`) MUST NOT appear in `web-ide-core`. Instead, consumers inject custom Wasm module imports (`resolveCustomImports`, `audioReceiver`), shell command hooks (`toolchainCommands`, `onCommandDispatch`), and system directories (`systemDirs`) from outside.
5. **Backward-Compatible Ergonomics**:
   - Constructors preserve clean ergonomics so migrating `wasm-c-ide` requires minimal churn (e.g., `EditorManager(container, vfs, optionsOrOnDirtyChange)` accepts either an options object or a legacy `onDirtyChange` callback).

---

## 3. Package Topology & Subpath Exports

### 3.1 Directory Structure

```
web-ide-core/
├── SPEC.md
├── README.md
├── AGENTS.md
├── LICENSE
├── package.json
├── .gitignore
├── src/
│   ├── index.js                  # Barrel export for core backend-agnostic modules
│   ├── style.css                 # Workbench dark-theme stylesheet & CSS variables
│   ├── editor/
│   │   ├── monaco-setup.js       # Worker setup + re-exported monaco instance
│   │   ├── editor.js             # EditorManager + extensible language detection
│   │   └── tabs.js               # TabsUI tab bar + dirty indicator management
│   ├── terminal/
│   │   ├── terminal.js           # TerminalManager wrapping @xterm/xterm + FitAddon
│   │   └── boot-progress.js      # BootProgress braille spinner & ASCII progress bar
│   ├── ui/
│   │   ├── filetree.js           # FileTreeUI explorer, inline/prompt actions & drag/context hooks
│   │   └── toast.js              # Non-blocking showToast / ToastManager
│   ├── layout/
│   │   └── layout.js             # LayoutManager (sidebar collapse/resize, split resizer, detached VT100 terminal)
│   ├── workspace/
│   │   ├── storage.js            # IndexedDB workspace persistence factory & seeding helpers
│   │   └── archive.js            # JSZip exportWorkspaceZip / importWorkspaceZip utilities
│   └── wasi/
│       ├── index.js              # Barrel export for optional WASI adapters
│       ├── wasm-cache.js         # IndexedDB compiled/raw WebAssembly binary cache
│       ├── runtime.js            # RuntimeManager (Atomics stdin, LineEditor, InputCoordinator, worker bridge)
│       ├── shell-worker.js       # createShellWorkerHandler (BusyBox ash + LineEditor + StdinReader)
│       └── runtime-worker.js     # createRuntimeWorkerHandler (WasiHost + StdinReader + canvas-wasi + custom import hooks)
├── test/
│   └── *.test.js                 # Node native test runner suite (`node --test`)
└── .github/
    └── workflows/
        └── release.yml           # CI tests + `v*`-only GitHub Releases + rolling `latest` tag
```

### 3.2 `package.json` Subpath Exports & Dependencies

- **Package**: `"name": "web-ide-core"`, `"version": "0.1.0"`, `"type": "module"`, `"license": "MIT"`.
- **Exports**:
  - `.` -> `./src/index.js`
  - `./editor` -> `./src/editor/editor.js`
  - `./editor/monaco-setup` -> `./src/editor/monaco-setup.js`
  - `./editor/tabs` -> `./src/editor/tabs.js`
  - `./terminal` -> `./src/terminal/terminal.js`
  - `./terminal/boot-progress` -> `./src/terminal/boot-progress.js`
  - `./ui` -> `./src/ui/filetree.js` (and `src/index.js` exports `FileTreeUI`, `showToast`, `createToastManager`)
  - `./ui/filetree` -> `./src/ui/filetree.js`
  - `./ui/toast` -> `./src/ui/toast.js`
  - `./layout` -> `./src/layout/layout.js`
  - `./workspace` -> `./src/workspace/storage.js`
  - `./workspace/archive` -> `./src/workspace/archive.js`
  - `./style.css` -> `./src/style.css`
  - `./wasi` -> `./src/wasi/index.js`
  - `./wasi/cache` -> `./src/wasi/wasm-cache.js`
  - `./wasi/runtime` -> `./src/wasi/runtime.js`
  - `./wasi/shell-worker` -> `./src/wasi/shell-worker.js`
  - `./wasi/runtime-worker` -> `./src/wasi/runtime-worker.js`

- **`dependencies`** (Core UI & Archive):
  - `@xterm/xterm`
  - `@xterm/addon-fit`
  - `jszip`
  - `monaco-editor`

- **`peerDependencies` & `peerDependenciesMeta` (`optional: true`)** (Required only if consumer imports `web-ide-core/wasi*`; also declared in `devDependencies` pointing to GitHub Release tarballs for standalone `web-ide-core` CI testing):
  - `ansi-line-editor`: `*` (`optional: true`)
  - `busybox-wasi`: `>=1.38.0-build1` (`optional: true`)
  - `canvas-wasi`: `*` (`optional: true`)
  - `stdin-wasi`: `*` (`optional: true`)
  - `vfs-wasi`: `>=0.2.0` (`optional: true`)
  - `wasi-host`: `>=0.1.1` (`optional: true`)

---

## 4. Core Module Specifications

### 4.1 Editor Subsystem (`src/editor/`)

#### `monaco-setup.js`
- Configures `self.MonacoEnvironment` with a `getWorker` factory only if not already defined by the host application (preserving host overrides).
- Exports `monaco` and `configureMonacoEnvironment(options)`.

#### `EditorManager` (`src/editor/editor.js`)
- **Constructor**: `new EditorManager(containerElement, vfs, optionsOrOnDirtyChange)`
  - Accepts either a legacy callback `onDirtyChange(path, isDirty)` or an options object:
    - `onDirtyChange?: (path: string, isDirty: boolean) => void`
    - `onToggleSidebar?: () => void` (replaces `window.__ideApp.toggleSidebar`; bound to `Ctrl+B` / `Cmd+B`)
    - `languageResolver?: (path: string) => string | null` (optional override before built-in extension lookup)
    - `languageMap?: Record<string, string>` (merges with built-in multi-language table)
    - `fontSizeStorageKey?: string` (default `'web_ide_editor_font_size'`)
    - `defaultFontSize?: number` (default `13`)
    - `minFontSize?: number` (default `9`)
    - `maxFontSize?: number` (default `36`)
    - `theme?: string` (default `'vs-dark'`)
    - `monacoOptions?: object` (extra Monaco editor creation overrides)
- **Built-in Language Map (`DEFAULT_LANGUAGE_MAP`)**:
  - Supports common source and config extensions cleanly out of the box: `.c`/`.h` (`c`), `.cpp`/`.cc`/`.cxx`/`.hpp`/`.hh` (`cpp`), `.py` (`python`), `.js`/`.mjs`/`.cjs` (`javascript`), `.ts`/`.tsx` (`typescript`), `.rs` (`rust`), `.go` (`go`), `.java` (`java`), `.html`/`.htm` (`html`), `.css`/`.scss` (`css`/`scss`), `.json` (`json`), `.md`/`.markdown` (`markdown`), `.sh`/`.bash` (`shell`), `.sql` (`sql`), `.yaml`/`.yml` (`yaml`), `.xml`/`.svg` (`xml`), `Makefile`/`makefile` (`makefile`), fallback `'plaintext'`.
- **Public Methods**:
  - `openFile(path)` / `setActiveFile(path)` / `closeFile(path)`
  - `saveFile(path)` / `saveActiveFile()`
  - `isDirty(path)` / `hasAnyDirtyFiles()`
  - `getActivePath()` / `getOpenFiles()`
  - `getFontSize()` / `setFontSize(size)` / `zoomIn()` / `zoomOut()` / `resetZoom()`
  - `onFontSizeChange(cb)` / `layout()` / `refreshOpenModelsFromVfs()` (optional helper to sync external edits cleanly)

#### `TabsUI` (`src/editor/tabs.js`)
- **Constructor**: `new TabsUI(containerElement, editorManager, options)`
  - Options: `{ showDirtyMarker?: boolean, onTabSelect?: (path) => void, onTabClose?: (path) => void }`
- Renders `.tab-item`, filename label, dirty marker (`*` / `.tab-dirty-marker`), close button (`.tab-close-btn`), and syncs with `EditorManager` events cleanly without polling.

### 4.2 Terminal Subsystem (`src/terminal/`)

#### `TerminalManager` (`src/terminal/terminal.js`)
- **Constructor**: `new TerminalManager(containerElement, onInputOrOptions, onInterrupt)`
  - Supports either `(container, onInput, onInterrupt)` or `(container, { onInput, onInterrupt, fontSizeStorageKey, defaultFontSize, minFontSize, maxFontSize, xtermOptions, theme })` so existing callers work cleanly while new consumers can customize storage keys and themes.
  - Defaults: `fontSizeStorageKey = 'web_ide_term_font_size'`, `defaultFontSize = 13`, `minFontSize = 9`, `maxFontSize = 36`.
- **Public Methods & Properties**:
  - `write(text)` / `clear()` / `focus()` / `fit()`
  - `injectCommand(cmd)` (dispatches `cmd + '\r\n'` cleanly into `onInput`)
  - `setFixedGrid(cols, rows)` / `clearFixedGrid()` / `fixedGrid` flag respecting `ResizeObserver`
  - `setDimensions(cols, rows)` / `onDimensionsChange(cb)`
  - `getFontSize()` / `setFontSize(size)` / `zoomIn()` / `zoomOut()` / `resetZoom()` / `onFontSizeChange(cb)`
  - Built-in zoom keyboard shortcuts (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`) and `\x03` (`Ctrl+C`) -> `onInterrupt()`.

#### `BootProgress` (`src/terminal/boot-progress.js`)
- **Constructor**: `new BootProgress(terminal, options)`
  - Options: `{ noticePrefix?: string }` (default `'Notice'`, replacing hardcoded `'Sysroot setup notice:'`).
- **Public Methods**:
  - `start(label)` / `update(percent, detail)` / `completeCurrent(detail)` / `fail(detail)` / `finish(welcomeText)`
  - Single-line `\r\x1b[K` braille spinner (`80ms`) + Unicode block progress bar (`[███░░░]`).

### 4.3 UI Components (`src/ui/`)

#### `FileTreeUI` (`src/ui/filetree.js`)
- **Constructor**: `new FileTreeUI(containerElement, vfs, optionsOrOnSelectFile)`
  - Accepts either a callback `onSelectFile(path)` or options:
    - `onSelectFile: (path: string) => void`
    - `rootPath?: string` (default `'/workspace'`)
    - `expandedDirs?: string[]` (default `[rootPath]`)
    - `confirmDelete?: (path: string, isDir: boolean) => boolean | Promise<boolean>` (defaults to `globalThis.confirm?.(...) ?? true`)
    - `promptName?: (message: string, defaultValue?: string) => string | null` (defaults to `globalThis.prompt?.(...) ?? null`)
    - `onError?: (message: string, error?: Error) => void`
- **Public Methods**:
  - `render()` / `setSelectedPath(path)` / `expandDir(path)` / `collapseDir(path)` / `dispose()` (unsubscribes VFS listener).
- Subscribes to `vfs.subscribe(...)` to automatically re-render on VFS mutations within `rootPath`.

#### `Toast` (`src/ui/toast.js`)
- `createToastManager(containerSelectorOrEl = '#toast-container')` returning `{ showToast(message, type = 'info', durationMs = 3500) }`.
- Standalone `showToast(message, type, durationMs, container)` exported for drop-in usage.

### 4.4 Workspace Persistence & Zip Archive (`src/workspace/`)

#### `storage.js`
- **`createWorkspaceStorage(options)`**:
  - Options:
    - `dbName?: string` (default `'web_ide_db'`)
    - `storeName?: string` (default `'workspace_files'`)
    - `rootPath?: string` (default `'/workspace'`)
    - `debounceMs?: number` (default `500`)
  - Returns `{ openDatabase, saveWorkspace, loadWorkspace, clearWorkspace, setupAutoSync, seedDefaultWorkspace }`.
- **Neutral `seedDefaultWorkspace(vfs, defaultFiles = {})`**:
  - Ensures `rootPath` exists, and iterates over caller-supplied `defaultFiles` (`Record<string, string | Uint8Array>`) to populate files only when missing or workspace is empty—containing **zero hardcoded C/C++ template files**.
- Also exports top-level convenience functions (`openDatabase`, `saveWorkspace`, `loadWorkspace`, `setupAutoSync`, `seedDefaultWorkspace`) delegating to default config for simple consumers.

#### `archive.js`
- `exportWorkspaceZip(vfs, filename = 'project.zip', options = {})`:
  - `options.rootPath` (default `'/workspace'`): strips `rootPath` prefix cleanly when archiving.
- `importWorkspaceZip(vfs, fileBlob, clearExisting = false, options = {})`:
  - `options.rootPath` (default `'/workspace'`)
  - `options.onSave?: (vfs) => Promise<void> | void` (if omitted, optionally uses supplied `storage.saveWorkspace` rather than hardcoding a single global IndexedDB name)
  - Normalizes paths cleanly and rejects `..` path traversal entries.

### 4.5 Layout & Detached Terminal (`src/layout/layout.js` & `src/style.css`)

#### `LayoutManager` (`src/layout/layout.js`)
Unifies the workbench structural interactions currently embedded inside `wasm-c-ide`'s `main.js`:
- **Constructor**: `new LayoutManager(options)`
  - `elements` / `selectors`: `{ mainLayout, sidebar, sidebarResizer, btnSidebarToggle, editorSection, splitResizer, terminalSection, termTitlebar, termHeaderLabel, btnTermDetach, ... }`
  - `editorManager?: { layout(): void }`
  - `terminalManager?: { fit(): void, focus(): void, setFixedGrid(cols, rows): void, clearFixedGrid(): void }`
  - `storagePrefix?: string` (default `'web_ide_'`)
  - `sidebarMinWidth?: number` (default `160`), `sidebarMaxWidth?: number` (default `520`), `sidebarDefaultWidth?: number` (default `240`)
  - `gridPresets?: Array<{ cols: number, rows: number }>` (default `[{ cols: 80, rows: 24 }, { cols: 100, rows: 30 }, { cols: 120, rows: 36 }]`)
  - `shortcuts?: boolean` (default `true`: `Ctrl+B`/`Cmd+B` sidebar toggle, `Ctrl+Shift+D`/`Cmd+Shift+D` detach/dock terminal)
- **Responsibilities**:
  1. **Collapsible Slim-Rail Sidebar**: toggles `.collapsed` state on sidebar, hides/shows `#sidebar-resizer`, persists width & collapsed state under `${storagePrefix}sidebar_*`, drags smoothly with double-click width reset, triggers `editorManager.layout()` & `terminalManager.fit()`.
  2. **Editor/Terminal Split Resizer**: vertical drag resizing between editor and docked terminal section (disabled automatically while terminal is detached).
  3. **Detached Floating VT100 Terminal**:
     - Detaches `#terminal-section` into `.detached` floating overlay locked to a selected preset grid (`80x24`, `100x30`, `120x36`).
     - Draggable via `#term-titlebar` with viewport boundary clamping, focus/blur glow states (`.focused`), header badge updates (`Terminal (80x24)`), preset cycling, and clean dock-back restoration.
  4. **`destroy()`**: cleanly detaches window/document event listeners and `ResizeObserver`.

#### `style.css` (`src/style.css`)
- Defines semantic CSS custom properties (`--bg-primary`, `--bg-secondary`, `--bg-elevated`, `--fg-primary`, `--fg-muted`, `--accent-primary`, `--border-subtle`, `--danger`, etc.) and styles for:
  - Workbench grid/flex shell, collapsible slim-rail sidebar, `.sidebar-resizer`, `.split-resizer`
  - Editor tab bar, dirty markers, filetree rows & icons
  - Terminal pane + `.detached` floating 80×24 window framing
  - Non-blocking toast container & toast cards.
- Consumer-specific button color rules or compiler-drawer styles remain in the consumer's stylesheet importing `web-ide-core/style.css`.

---

## 5. Optional `./wasi` Execution & Worker Adapter Subpath

### 5.1 `createWasmCache` (`src/wasi/wasm-cache.js`)
- Parameterized IndexedDB raw `ArrayBuffer` store for caching Wasm binaries (`busybox.wasm`, compiler blobs, user-defined tools):
  - `createWasmCache({ dbName = 'web_ide_wasm_cache', storeName = 'wasm_modules' })`
  - Returns `{ openWasmDb, getWasmModule, saveWasmModule, deleteWasmModule, clearWasmCache }`.

### 5.2 `RuntimeManager` (`src/wasi/runtime.js`)
- Coordinates foreground program execution in a dedicated Web Worker with terminal UI, `StdinHost` (`stdin-wasi/host`), `LineEditor` (`ansi-line-editor`), and optional `InputCoordinator` (`canvas-wasi`):
  - **Constructor**: `new RuntimeManager(terminal, options)`
    - `workerUrl?: string | URL` OR `createWorker?: () => Worker` (consumer passes `new URL('./runtime.worker.js', import.meta.url)` or custom worker factory)
    - `shellWorkerUrl?: string | URL` / `createShellWorker?: () => Worker` (optional interactive shell lifecycle hooks if managed together, or handled independently by consumer)
    - `graphicsWindow?: GraphicsWindowUI` (optional `canvas-wasi` floating canvas UI)
    - `audioReceiver?: { handleMessage(msg): void, dispose?(): void }` (optional injected hook—e.g. `createAudioReceiver()` passed by consumers that use `raylib-wasi`, keeping `web-ide-core` free of `raylib-wasi`)
    - `inputBufferSize?: number` (default `512` bytes matching `canvas-wasi`)
    - `stdinBufferSize?: number` (default `4096` bytes)
- **Public Methods**:
  - `runProgram(wasmBytes, { argv, environ, stdinBytes, files, sharedSysrootBuffer })` -> `Promise<{ exitCode, changedFiles, deletedFiles }>`
  - `handleTerminalInput(data)` (routes keystrokes through `LineEditor`, supports `Ctrl-D` EOF `STATE_EOF`, and commits lines via `StdinHost`)
  - `stop()` / `isRunning()` / `resize(cols, rows)`

### 5.3 `createShellWorkerHandler` (`src/wasi/shell-worker.js`)
- Reusable Web Worker handler running POSIX `busybox-wasi` (`ash`) with `LineEditor` (`ansi-line-editor`), `createStdinReader` (`stdin-wasi/worker`), `VFS` (`vfs-wasi`), and `WasiHost` + `createBusyboxHostOptions`:
  - **Factory**: `createShellWorkerHandler(options)` returning `{ onmessage, runCommand, getVfs, destroy }` (plus auto-binding helper `attachShellWorker(options)`):
    - `wasmUrl: string`
    - `cacheKey: string`
    - `wasmCache?: WasmCache` (defaults to `createWasmCache()`)
    - `systemDirs?: string[]` (optional read-only/system directory list; defaults to `[]` or consumer-provided sysroot dirs)
    - `vfsFactory?: () => VFS` (defaults to `() => new VFS()`)
    - `envDefaults?: Record<string, string>` (default `{ USER: 'user', HOME: '/workspace', PWD: '/workspace', PATH: '/bin:/usr/bin:/workspace' }`)
    - `cwd?: string` (default `'/workspace'`)
    - `promptFormatter?: ({ cwd, env }) => string`
    - `toolchainCommands?: Set<string> | string[]` (commands intercepted and forwarded to host/main thread instead of running inside BusyBox—empty by default)
    - `onCommandDispatch?: (cmdName, args, ctx) => Promise<number | void> | number | void` (custom host/worker command hook)
    - `extraBuiltins?: Record<string, (args, ctx) => number | Promise<number>>` (custom in-shell builtins layered alongside `cd`, `pushd`, `popd`, `dirs`, `export`, etc.)
- Eliminates hardcoded C toolchain lists (`gcc`, `clang`, `make`, `sqlite3`) from `web-ide-core`; consumers pass `toolchainCommands` / `onCommandDispatch` in their thin wrapper worker (`src/workers/shell.worker.js`).

### 5.4 `createRuntimeWorkerHandler` (`src/wasi/runtime-worker.js`)
- Reusable Web Worker handler executing user WASI binaries with `WasiHost`, `createStdinReader` (`stdin-wasi/worker`), `createGraphicsImports` (`canvas-wasi/worker`), VFS overlay & `SharedSysroot` support, and bidirectional `file_sync` / `file_delete` notifications:
  - **Factory**: `createRuntimeWorkerHandler(options)` / `runWasmBinary(wasmBytes, opts)`:
    - `systemDirs?: string[]` (default `[]`)
    - `preopens?: Array<{ fd, path, name }>` (default `[{ fd: 3, path: '/workspace', name: '.' }, { fd: 4, path: '/', name: '/' }]`)
    - `cwd?: string` (default `'/workspace'`)
    - `envDefaults?: Record<string, string>`
    - `vfsFactory?: () => VFS`
    - `enableGraphics?: boolean` (default `true`; registers `canvas-wasi/worker` `graphics`, `fb`, `canvas`, and merged `env` functions)
    - `resolveCustomImports?: ({ module, importsList, importObject, getMemory, vfs, sharedBuffer, postMessage }) => { handleInputEvent?: (ev) => void, cleanup?: () => void } | void`
      - Allows `wasm-c-ide` (and future WASI IDEs) to attach `raylib-wasi` (`createRaylibHost`) or other domain host imports **only** inside the consumer's thin worker entry without bundling them into `web-ide-core`.

---

## 6. Verification Plan & CI/CD

### 6.1 Automated Test Suite (`npm test`)
Tests run headless under Node.js (`node --import ./test/setup-loader.mjs --test test/*.test.js`) using minimal pure-JS DOM, `localStorage`, and IndexedDB mocks:
1. **`test/editor.test.js`**: `EditorManager` dirty state transitions, multi-language resolver overrides (`DEFAULT_LANGUAGE_MAP` + custom `languageResolver`), configurable `fontSizeStorageKey` isolation, zoom clamping `[9..36]`, `onToggleSidebar` callback, `TabsUI` rendering/close/dirty asterisk sync.
2. **`test/terminal.test.js`**: `TerminalManager` zoom persistence, `injectCommand` newline dispatch, `fixedGrid` resize guard, `BootProgress` formatting & configurable `noticePrefix`.
3. **`test/ui-layout.test.js`**: `FileTreeUI` rendering with configurable `rootPath` & VFS subscription updates, `showToast` creation & dismissal, `LayoutManager` sidebar collapse/width persistence, split resizer skip when detached, detached terminal preset cycling (`80x24` -> `100x30` -> `120x36`), drag viewport clamping.
4. **`test/workspace.test.js`**: `createWorkspaceStorage` DB isolation (`dbName` customization), neutral `seedDefaultWorkspace` (no files created if empty `defaultFiles`), `exportWorkspaceZip` / `importWorkspaceZip` with custom `rootPath` and path-traversal rejection.
5. **`test/wasi-adapters.test.js`**: `createWasmCache` storage isolation, `createShellWorkerHandler` command hook injection & VFS dispatch, `createRuntimeWorkerHandler` `WasiHost` execution with mock VFS + `resolveCustomImports` injection & `file_sync`/`file_delete` emission (guarding that importing core subpaths `./editor`, `./terminal`, `./workspace`, `./layout`, `./ui` never evaluates WASI modules).

### 6.2 GitHub Actions Release Workflow (`.github/workflows/release.yml`)
- Trigger on `push` (`main`, `v*`) and `pull_request` (`main`).
- Run `npm install --no-audit --no-fund` + `npm test` across all triggers.
- Publish GitHub Releases **only** on `startsWith(github.ref, 'refs/tags/v')`:
  1. Create/update release for `${{ github.ref_name }}` with `make_latest: "true"` and auto-generated release notes.
  2. Update rolling `latest` tag (`git tag -f latest && git push origin latest --force`) and release with `make_latest: "false"`.

---

## 7. Planned Consumer Adoption (`wasm-c-ide`)

Once `web-ide-core@0.1.0` is verified and released on GitHub, `wasm-c-ide` will migrate onto it cleanly in a follow-up phase:
- `src/editor/*`, `src/components/filetree.js`, `src/components/toast.js`, `src/terminal/terminal.js`, `src/terminal/boot-progress.js`, `src/vfs/storage.js`, `src/vfs/archive.js`, `src/toolchain/wasm-cache.js`, `src/terminal/runtime.js`, and the generic workbench layout/detach code in `src/main.js` will delegate to `web-ide-core` and `web-ide-core/wasi`.
- C-specific modules (`src/components/examples-data.js`, `src/components/reference.js`, `src/components/settings.js`, `src/toolchain/compiler-client.js`, `src/toolchain/driver.js`, `src/toolchain/make.js`, `src/workers/compiler.worker.js`, and thin `shell.worker.js`/`runtime.worker.js` wrappers injecting `raylib-wasi` and compiler/make command hooks) remain cleanly owned by `wasm-c-ide`.
