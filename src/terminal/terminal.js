// xterm.js Terminal Emulator Wrapper & Command Injection Bridge

import * as xtermModule from '@xterm/xterm';
import * as fitModule from '@xterm/addon-fit';

const DefaultTerminal = xtermModule.Terminal || xtermModule.default?.Terminal || xtermModule.default;
const DefaultFitAddon = fitModule.FitAddon || fitModule.default?.FitAddon || fitModule.default;

const DEFAULT_THEME = Object.freeze({
  background: '#181818',
  foreground: '#cccccc',
  cursor: '#ffffff',
  selectionBackground: 'rgba(255, 255, 255, 0.3)',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
});

export class TerminalManager {
  constructor(containerElement, onInputOrOptions = () => {}, onInterrupt = () => {}, extraOptions = {}) {
    let opts;
    if (typeof onInputOrOptions === 'object' && onInputOrOptions !== null) {
      opts = onInputOrOptions;
    } else {
      opts = {
        ...extraOptions,
        onInput: onInputOrOptions,
        onInterrupt,
      };
    }

    const TerminalCtor = opts.Terminal || DefaultTerminal;
    const FitAddonCtor = opts.FitAddon || DefaultFitAddon;

    this.container = containerElement;
    this.onInput = typeof opts.onInput === 'function' ? opts.onInput : () => {};
    this.onInterrupt = typeof opts.onInterrupt === 'function' ? opts.onInterrupt : () => {};
    this.onFontSizeChange = typeof opts.onFontSizeChange === 'function' ? opts.onFontSizeChange : null;
    this.onDimensionsChange = typeof opts.onDimensionsChange === 'function' ? opts.onDimensionsChange : null;

    this.fontSizeStorageKey = opts.fontSizeStorageKey || 'web_ide_term_font_size';
    this.defaultFontSize = Number.isFinite(opts.defaultFontSize) ? opts.defaultFontSize : 13;
    this.minFontSize = Number.isFinite(opts.minFontSize) ? opts.minFontSize : 9;
    this.maxFontSize = Number.isFinite(opts.maxFontSize) ? opts.maxFontSize : 36;

    this.isDetached = false;
    this.fixedGrid = false;

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

    this.term = new TerminalCtor({
      cursorBlink: true,
      fontSize: this.fontSize,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      theme: opts.theme || DEFAULT_THEME,
      convertEol: true,
      ...(opts.xtermOptions || {}),
    });

    this.fitAddon = new FitAddonCtor();
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.container);
    this.fit();

    if (typeof this.term.attachCustomKeyEventHandler === 'function') {
      this.term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && (e.ctrlKey || e.metaKey)) {
          if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
            this.zoomIn();
            e.preventDefault();
            return false;
          }
          if (e.key === '-' || e.code === 'NumpadSubtract') {
            this.zoomOut();
            e.preventDefault();
            return false;
          }
          if (e.key === '0') {
            this.resetFontSize();
            e.preventDefault();
            return false;
          }
        }
        return true;
      });
    }

    if (typeof this.term.onResize === 'function') {
      this.term.onResize(({ cols, rows }) => {
        if (typeof this.onDimensionsChange === 'function') {
          this.onDimensionsChange(cols, rows);
        }
      });
    }

    this._resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        try {
          if (!this.fixedGrid) {
            this.fitAddon.fit();
          }
          if (typeof this.onDimensionsChange === 'function') {
            this.onDimensionsChange(this.term.cols, this.term.rows);
          }
        } catch {}
      });
      this._resizeObserver.observe(this.container);
    }

    this.term.onData((data) => {
      if (data === '\x03') {
        this.onInterrupt();
        return;
      }
      this.onInput(data);
    });
  }

  fit() {
    try {
      this.fitAddon.fit();
      if (typeof this.onDimensionsChange === 'function') {
        this.onDimensionsChange(this.term.cols, this.term.rows);
      }
    } catch {}
  }

  getGridDimensions() {
    return { cols: this.term.cols, rows: this.term.rows };
  }

  setGridDimensions(cols, rows) {
    const targetCols = Math.max(10, Math.min(240, Math.round(cols)));
    const targetRows = Math.max(5, Math.min(100, Math.round(rows)));
    try {
      this.term.resize(targetCols, targetRows);
    } catch {}
    if (typeof this.onDimensionsChange === 'function') {
      this.onDimensionsChange(this.term.cols, this.term.rows);
    }
    return { cols: this.term.cols, rows: this.term.rows };
  }

  setFixedGrid(cols, rows) {
    this.fixedGrid = true;
    return this.setGridDimensions(cols, rows);
  }

  clearFixedGrid() {
    this.fixedGrid = false;
    this.fit();
  }

  computeCellDimensions() {
    const dims = this.term._core?._renderService?.dimensions;
    if (dims && dims.actualCellWidth > 0 && dims.actualCellHeight > 0) {
      return { width: dims.actualCellWidth, height: dims.actualCellHeight };
    }
    const screen = this.container?.querySelector?.('.xterm-screen');
    if (screen && this.term.cols > 0 && this.term.rows > 0 && screen.clientWidth > 0 && screen.clientHeight > 0) {
      return {
        width: screen.clientWidth / this.term.cols,
        height: screen.clientHeight / this.term.rows,
      };
    }
    return {
      width: Math.max(6, Math.round(this.fontSize * 0.60)),
      height: Math.max(12, Math.round(this.fontSize * 1.25)),
    };
  }

  computeContainerSizeForGrid(cols = 80, rows = 24) {
    const cell = this.computeCellDimensions();
    const padX = 16;
    const padY = 12;
    const headerH = 28;
    return {
      width: Math.ceil(cols * cell.width) + padX,
      height: Math.ceil(rows * cell.height) + headerH + padY,
    };
  }

  getFontSize() {
    return this.fontSize;
  }

  setFontSize(size) {
    const clamped = Math.min(this.maxFontSize, Math.max(this.minFontSize, Math.round(size)));
    this.fontSize = clamped;
    this.term.options.fontSize = clamped;
    try {
      this.fitAddon.fit();
    } catch {}
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.fontSizeStorageKey, String(clamped));
      }
    } catch {}
    if (typeof this.onFontSizeChange === 'function') {
      this.onFontSizeChange(clamped);
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

  write(data) {
    this.term.write(data);
  }

  writeln(data) {
    this.term.writeln(data);
  }

  clear() {
    this.term.clear();
  }

  focus() {
    this.term.focus();
  }

  injectCommand(cmd) {
    this.focus();
    for (let i = 0; i < cmd.length; i++) {
      this.onInput(cmd[i]);
    }
    this.onInput('\r');
  }

  dispose() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this.term && typeof this.term.dispose === 'function') {
      this.term.dispose();
    }
  }
}
