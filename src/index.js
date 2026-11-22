// Core backend-agnostic exports for web-ide-core

export { monaco, configureMonacoEnvironment } from './editor/monaco-setup.js';
export { EditorManager, DEFAULT_LANGUAGE_MAP, resolveLanguageForPath } from './editor/editor.js';
export { TabsUI } from './editor/tabs.js';
export { TerminalManager } from './terminal/terminal.js';
export { BootProgress } from './terminal/boot-progress.js';
export { FileTreeUI } from './ui/filetree.js';
export { showToast, createToastManager } from './ui/toast.js';
export { LayoutManager } from './layout/layout.js';
export {
  createWorkspaceStorage,
  openDatabase,
  saveWorkspace,
  loadWorkspace,
  clearWorkspace,
  seedDefaultWorkspace,
  setupAutoSync,
} from './workspace/storage.js';
export { exportWorkspaceZip, importWorkspaceZip } from './workspace/archive.js';
