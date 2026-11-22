// Multi-file Monaco Editor Manager with dirty state tracking & zoom controls

import { monaco as defaultMonaco } from './monaco-setup.js';

export const DEFAULT_LANGUAGE_MAP = Object.freeze({
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.py': 'python',
  '.pyw': 'python',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescript',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.sql': 'sql',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.svg': 'xml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.txt': 'plaintext',
});

/**
 * Resolve Monaco language ID from a file path using optional custom resolver and merged extension maps.
 */
export function resolveLanguageForPath(path, options = {}) {
  if (!path) return 'plaintext';

  if (typeof options.languageResolver === 'function') {
    const custom = options.languageResolver(path);
    if (custom) return custom;
  }

  const baseName = path.split('/').pop() || '';
  const lowerBase = baseName.toLowerCase();
  const mergedMap = options.languageMap
    ? { ...DEFAULT_LANGUAGE_MAP, ...options.languageMap }
    : DEFAULT_LANGUAGE_MAP;

  if (Object.prototype.hasOwnProperty.call(mergedMap, lowerBase)) {
    return mergedMap[lowerBase];
  }
  if (lowerBase === 'makefile' || lowerBase === 'gnumakefile') {
    return 'makefile';
  }
  if (lowerBase === 'dockerfile') {
    return 'dockerfile';
  }

  const dotIdx = lowerBase.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = lowerBase.slice(dotIdx);
    if (Object.prototype.hasOwnProperty.call(mergedMap, ext)) {
      return mergedMap[ext];
    }
  }

  return 'plaintext';
}

function decodeContent(raw) {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array || ArrayBuffer.isView(raw)) {
    return new TextDecoder().decode(raw);
  }
  return '';
}

export class EditorManager {
  constructor(containerElement, vfs, optionsOrOnDirtyChange = {}) {
    const opts =
      typeof optionsOrOnDirtyChange === 'function'
        ? { onDirtyChange: optionsOrOnDirtyChange }
        : (optionsOrOnDirtyChange || {});

    this.container = containerElement;
    this.vfs = vfs;
    this.monaco = opts.monaco || defaultMonaco;
    this.onDirtyChange = typeof opts.onDirtyChange === 'function' ? opts.onDirtyChange : () => {};
    this.onToggleSidebar = typeof opts.onToggleSidebar === 'function' ? opts.onToggleSidebar : null;
    this.languageResolver = typeof opts.languageResolver === 'function' ? opts.languageResolver : null;
    this.languageMap = opts.languageMap || null;

    this.fontSizeStorageKey = opts.fontSizeStorageKey || 'web_ide_editor_font_size';
    this.defaultFontSize = Number.isFinite(opts.defaultFontSize) ? opts.defaultFontSize : 13;
    this.minFontSize = Number.isFinite(opts.minFontSize) ? opts.minFontSize : 9;
    this.maxFontSize = Number.isFinite(opts.maxFontSize) ? opts.maxFontSize : 36;

    this.openTabs = new Map(); // path -> { model, isDirty }
    this.activePath = null;
    this._fontSizeListeners = new Set();
    if (typeof opts.onFontSizeChange === 'function') {
      this._fontSizeListeners.add(opts.onFontSizeChange);
    }

    let initialFontSize = this.defaultFontSize;
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = parseInt(localStorage.getItem(this.fontSizeStorageKey), 10);
        if (Number.isFinite(saved) && saved >= this.minFontSize && saved <= this.maxFontSize) {
          initialFontSize = saved;
        }
      }
    } catch {}
    this.fontSize = initialFontSize;

    this.editor = this.monaco.editor.create(this.container, {
      value: '',
      language: 'plaintext',
      theme: opts.theme || 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: this.fontSize,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      ...(opts.monacoOptions || {}),
    });

    const KeyMod = this.monaco.KeyMod || {};
    const KeyCode = this.monaco.KeyCode || {};

    // Bind Ctrl+S / Cmd+S to save active file
    if (typeof this.editor.addCommand === 'function' && KeyMod.CtrlCmd && KeyCode.KeyS) {
      this.editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => {
        this.saveActiveFile();
      });

      // Bind Font Zoom Shortcuts (Ctrl+=, Ctrl+-, Ctrl+0)
      if (KeyCode.Equal) {
        this.editor.addCommand(KeyMod.CtrlCmd | KeyCode.Equal, () => {
          this.zoomIn();
        });
      }
      if (KeyCode.Minus) {
        this.editor.addCommand(KeyMod.CtrlCmd | KeyCode.Minus, () => {
          this.zoomOut();
        });
      }
      if (KeyCode.Digit0) {
        this.editor.addCommand(KeyMod.CtrlCmd | KeyCode.Digit0, () => {
          this.resetFontSize();
        });
      }

      // Bind Ctrl+B / Cmd+B to toggle sidebar via callback
      if (KeyCode.KeyB) {
        this.editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyB, () => {
          if (typeof this.onToggleSidebar === 'function') {
            this.onToggleSidebar();
          }
        });
      }
    }
  }

  set onFontSizeChange(cb) {
    if (typeof cb === 'function') {
      this._fontSizeListeners.add(cb);
    }
  }

  addFontSizeListener(cb) {
    if (typeof cb === 'function') {
      this._fontSizeListeners.add(cb);
      return () => this._fontSizeListeners.delete(cb);
    }
    return () => {};
  }

  getFontSize() {
    return this.fontSize;
  }

  setFontSize(size) {
    const clamped = Math.min(this.maxFontSize, Math.max(this.minFontSize, Math.round(size)));
    this.fontSize = clamped;
    this.editor.updateOptions({ fontSize: clamped });
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.fontSizeStorageKey, String(clamped));
      }
    } catch {}
    for (const cb of this._fontSizeListeners) {
      cb(clamped);
    }
    return clamped;
  }

  zoomIn(delta = 1) {
    return this.setFontSize(this.fontSize + delta);
  }

  zoomOut(delta = 1) {
    return this.setFontSize(this.fontSize - delta);
  }

  resetFontSize() {
    return this.setFontSize(this.defaultFontSize);
  }

  layout() {
    if (this.editor && typeof this.editor.layout === 'function') {
      this.editor.layout();
    }
  }

  openFile(path) {
    if (!this.vfs.exists(path)) return;

    if (this.openTabs.has(path)) {
      this.setActiveFile(path);
      return;
    }

    const diskContent = decodeContent(this.vfs.readFile(path));
    const lang = resolveLanguageForPath(path, {
      languageResolver: this.languageResolver,
      languageMap: this.languageMap,
    });
    const model = this.monaco.editor.createModel(diskContent, lang);

    const tabState = {
      model,
      isDirty: false,
    };

    model.onDidChangeContent(() => {
      const currentVal = model.getValue();
      const savedVal = this.vfs.exists(path) ? decodeContent(this.vfs.readFile(path)) : '';
      const isDirty = currentVal !== savedVal;

      if (tabState.isDirty !== isDirty) {
        tabState.isDirty = isDirty;
        this.onDirtyChange(path, isDirty);
      }
    });

    this.openTabs.set(path, tabState);
    this.setActiveFile(path);
  }

  setActiveFile(path) {
    const tabState = this.openTabs.get(path);
    if (!tabState) return;

    this.activePath = path;
    this.editor.setModel(tabState.model);
    if (typeof this.editor.focus === 'function') {
      this.editor.focus();
    }
  }

  closeFile(path) {
    const tabState = this.openTabs.get(path);
    if (!tabState) return;

    if (typeof tabState.model.dispose === 'function') {
      tabState.model.dispose();
    }
    this.openTabs.delete(path);

    if (this.activePath === path) {
      const remaining = Array.from(this.openTabs.keys());
      if (remaining.length > 0) {
        this.setActiveFile(remaining[remaining.length - 1]);
      } else {
        this.activePath = null;
        this.editor.setModel(null);
      }
    }
  }

  saveFile(path) {
    const tabState = this.openTabs.get(path);
    if (!tabState) return;

    const content = tabState.model.getValue();
    this.vfs.writeFile(path, content);
    tabState.isDirty = false;
    this.onDirtyChange(path, false);
  }

  saveActiveFile() {
    if (this.activePath) {
      this.saveFile(this.activePath);
    }
  }

  isDirty(path) {
    const tabState = this.openTabs.get(path);
    return tabState ? tabState.isDirty : false;
  }

  hasAnyDirtyFiles() {
    for (const tabState of this.openTabs.values()) {
      if (tabState.isDirty) return true;
    }
    return false;
  }

  getActivePath() {
    return this.activePath;
  }

  getOpenFiles() {
    return Array.from(this.openTabs.keys());
  }

  dispose() {
    for (const tabState of this.openTabs.values()) {
      if (typeof tabState.model?.dispose === 'function') {
        tabState.model.dispose();
      }
    }
    this.openTabs.clear();
    if (this.editor && typeof this.editor.dispose === 'function') {
      this.editor.dispose();
    }
  }
}
