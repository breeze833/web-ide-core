// Reusable IDE Workbench Layout Manager
// Unifies collapsible slim-rail sidebar, editor/terminal split resizer, and detached VT100 terminal windowing

const DEFAULT_SELECTORS = Object.freeze({
  sidebar: '.sidebar',
  sidebarResizer: '#sidebar-resizer',
  btnSidebarToggle: '#btn-sidebar-toggle',
  sidebarCollapsedStrip: '#sidebar-collapsed-strip',
  terminalSection: '.terminal-section',
  terminalHeader: '.terminal-header',
  splitResizer: '#split-resizer',
  btnTermDetach: '#btn-term-detach',
  btnTermMin: '#btn-term-min',
  dimBadge: '#term-dimension-badge',
});

const DEFAULT_GRID_PRESETS = Object.freeze([
  { cols: 80, rows: 24, label: '80x24' },
  { cols: 80, rows: 25, label: '80x25' },
  { cols: 100, rows: 30, label: '100x30' },
  { cols: 120, rows: 40, label: '120x40' },
  { cols: 132, rows: 24, label: '132x24' },
]);

const DETACH_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 1a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V9a.5.5 0 0 0-1 0v5H2V2h5a.5.5 0 0 0 0-1H1.5z"/>
      <path d="M10 .5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0V1.707L8.854 7.854a.5.5 0 1 1-.708-.708L14.293 1H10.5a.5.5 0 0 1-.5-.5z"/>
    </svg>`;

const DOCK_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M14.5 15a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5h-13a.5.5 0 0 0-.5.5V7a.5.5 0 0 0 1 0V2h12v12H9a.5.5 0 0 0 0 1h5.5z"/>
      <path d="M6 15.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 1 0v3.793l6.146-6.147a.5.5 0 1 1 .708.708L1.707 15H5.5a.5.5 0 0 1 .5.5z"/>
    </svg>`;

const MIN_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 13a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 13z"/>
    </svg>`;

const MAX_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 3h10v10H3V3zm1.5 1.5v7h7v-7h-7z"/>
    </svg>`;

function resolveEl(key, elements, selectors, doc) {
  if (elements && elements[key]) return elements[key];
  const sel = selectors[key];
  if (!sel || !doc) return null;
  if (sel.startsWith('#') && typeof doc.getElementById === 'function') {
    return doc.getElementById(sel.slice(1)) || doc.querySelector?.(sel) || null;
  }
  return doc.querySelector ? doc.querySelector(sel) : null;
}

export class LayoutManager {
  constructor(options = {}) {
    this.doc = options.document || (typeof document !== 'undefined' ? document : null);
    this.win = options.window || (typeof window !== 'undefined' ? window : null);
    this.storagePrefix = options.storagePrefix || 'web_ide_';
    this.editorManager = options.editorManager || null;
    this.terminal = options.terminalManager || options.terminal || null;
    this.sidebarMinWidth = Number.isFinite(options.sidebarMinWidth) ? options.sidebarMinWidth : 160;
    this.sidebarMaxWidth = Number.isFinite(options.sidebarMaxWidth) ? options.sidebarMaxWidth : 600;
    this.sidebarDefaultWidth = Number.isFinite(options.sidebarDefaultWidth) ? options.sidebarDefaultWidth : 240;
    this.sidebarCollapsedWidth = Number.isFinite(options.sidebarCollapsedWidth) ? options.sidebarCollapsedWidth : 36;
    this.gridPresets =
      Array.isArray(options.gridPresets) && options.gridPresets.length > 0
        ? options.gridPresets.map((p) => ({
            cols: p.cols,
            rows: p.rows,
            label: p.label || `${p.cols}x${p.rows}`,
          }))
        : DEFAULT_GRID_PRESETS;
    this.shortcuts = options.shortcuts !== false;

    const selectors = { ...DEFAULT_SELECTORS, ...(options.selectors || {}) };
    const elements = options.elements || {};
    this.els = {};
    for (const key of Object.keys(DEFAULT_SELECTORS)) {
      this.els[key] = resolveEl(key, elements, selectors, this.doc);
    }

    this.sidebarWidth = this.sidebarDefaultWidth;
    this.sidebarCollapsed = false;
    this._isDetached = false;
    this._isMinimized = false;
    this._cleanups = [];

    if (options.autoInit !== false) {
      this.init();
    }
  }

  _listen(target, event, handler, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(event, handler, opts);
    this._cleanups.push(() => target.removeEventListener(event, handler, opts));
  }

  _layoutEditor() {
    if (this.editorManager && typeof this.editorManager.layout === 'function') {
      this.editorManager.layout();
    }
  }

  init() {
    this.setupSidebar();
    this.setupSplitResizer();
    this.setupTerminalWindowing();
  }

  isSidebarCollapsed() {
    return this.sidebarCollapsed;
  }

  isTerminalDetached() {
    return this._isDetached;
  }

  setupSidebar() {
    const { sidebar, sidebarResizer: resizer, btnSidebarToggle: toggleBtn, sidebarCollapsedStrip: collapsedStrip } = this.els;
    if (!sidebar || !resizer) return;

    const widthKey = `${this.storagePrefix}sidebar_width`;
    const collapsedKey = `${this.storagePrefix}sidebar_collapsed`;

    try {
      if (typeof localStorage !== 'undefined') {
        const savedWidth = parseInt(localStorage.getItem(widthKey), 10);
        if (Number.isFinite(savedWidth) && savedWidth >= this.sidebarMinWidth && savedWidth <= this.sidebarMaxWidth) {
          this.sidebarWidth = savedWidth;
        }
        if (localStorage.getItem(collapsedKey) === 'true') {
          this.sidebarCollapsed = true;
        }
      }
    } catch {}

    const applyState = () => {
      if (this.sidebarCollapsed) {
        sidebar.classList.add('collapsed');
        resizer.classList.add('hidden');
        sidebar.style.width = `${this.sidebarCollapsedWidth}px`;
        if (toggleBtn) {
          toggleBtn.title = 'Expand Sidebar (Ctrl+B)';
          toggleBtn.setAttribute('data-tooltip', 'Expand (Ctrl+B)');
          toggleBtn.setAttribute('aria-label', 'Expand Sidebar');
        }
      } else {
        sidebar.classList.remove('collapsed');
        resizer.classList.remove('hidden');
        sidebar.style.width = `${this.sidebarWidth}px`;
        if (toggleBtn) {
          toggleBtn.title = 'Collapse Sidebar (Ctrl+B)';
          toggleBtn.setAttribute('data-tooltip', 'Collapse (Ctrl+B)');
          toggleBtn.setAttribute('aria-label', 'Collapse Sidebar');
        }
      }
      this._layoutEditor();
    };

    applyState();

    this.toggleSidebar = (force) => {
      this.sidebarCollapsed = typeof force === 'boolean' ? force : !this.sidebarCollapsed;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(collapsedKey, String(this.sidebarCollapsed));
        }
      } catch {}
      applyState();
    };

    this._listen(toggleBtn, 'click', (e) => {
      e.stopPropagation();
      this.toggleSidebar();
    });

    this._listen(collapsedStrip, 'click', () => {
      if (this.sidebarCollapsed) {
        this.toggleSidebar(false);
      }
    });

    this._listen(sidebar, 'transitionend', (e) => {
      if (e.propertyName === 'width') {
        this._layoutEditor();
      }
    });

    if (this.shortcuts && this.win) {
      this._listen(this.win, 'keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          this.toggleSidebar();
        }
      });
    }

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    this._listen(resizer, 'mousedown', (e) => {
      if (this.sidebarCollapsed) return;
      isDragging = true;
      startX = e.clientX;
      startWidth = sidebar.clientWidth;
      sidebar.classList.add('resizing');
      resizer.classList.add('dragging');
      if (this.doc?.body) this.doc.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    this._listen(this.win, 'mousemove', (e) => {
      if (!isDragging || this.sidebarCollapsed) return;
      const deltaX = e.clientX - startX;
      const winW = this.win?.innerWidth || 1200;
      const maxW = Math.max(200, Math.min(this.sidebarMaxWidth, winW - 300));
      const newW = Math.max(this.sidebarMinWidth, Math.min(maxW, startWidth + deltaX));
      sidebar.style.width = `${newW}px`;
      this.sidebarWidth = newW;
      this._layoutEditor();
    });

    this._listen(this.win, 'mouseup', () => {
      if (isDragging) {
        isDragging = false;
        sidebar.classList.remove('resizing');
        resizer.classList.remove('dragging');
        if (this.doc?.body) this.doc.body.style.cursor = '';
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(widthKey, String(this.sidebarWidth));
          }
        } catch {}
        this._layoutEditor();
      }
    });

    this._listen(resizer, 'dblclick', () => {
      if (this.sidebarCollapsed) return;
      this.sidebarWidth = this.sidebarDefaultWidth;
      sidebar.style.width = `${this.sidebarDefaultWidth}px`;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(widthKey, String(this.sidebarDefaultWidth));
        }
      } catch {}
      this._layoutEditor();
    });
  }

  setupSplitResizer() {
    const { splitResizer: resizer, terminalSection } = this.els;
    if (!resizer || !terminalSection) return;

    let isDragging = false;
    let startY = 0;
    let startHeight = 0;

    this._listen(resizer, 'mousedown', (e) => {
      if (terminalSection.classList.contains('detached')) return;
      isDragging = true;
      startY = e.clientY;
      startHeight = terminalSection.clientHeight;
      if (this.doc?.body) this.doc.body.style.cursor = 'row-resize';
      e.preventDefault();
    });

    this._listen(this.win, 'mousemove', (e) => {
      if (!isDragging || terminalSection.classList.contains('detached')) return;
      const deltaY = startY - e.clientY;
      const winH = this.win?.innerHeight || 800;
      const newHeight = Math.max(100, Math.min(winH - 150, startHeight + deltaY));
      terminalSection.style.height = `${newHeight}px`;
      this._layoutEditor();
    });

    this._listen(this.win, 'mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (this.doc?.body) this.doc.body.style.cursor = '';
        this._layoutEditor();
      }
    });
  }

  setupTerminalWindowing() {
    const {
      terminalSection,
      terminalHeader: headerFromOpts,
      splitResizer: resizer,
      btnTermDetach: btnDetach,
      btnTermMin: btnMin,
      dimBadge,
    } = this.els;
    const terminalHeader = headerFromOpts || terminalSection?.querySelector?.('.terminal-header') || null;
    if (!terminalSection || !btnDetach || !this.terminal) return;

    let dockedHeight = terminalSection.clientHeight || 240;
    let preMinHeight = '';
    let isProgrammaticResize = false;
    let presetIdx = 0;
    const presets = this.gridPresets;

    const updateDimBadge = (cols, rows) => {
      if (!dimBadge) return;
      dimBadge.textContent = `${cols}x${rows}`;
      if (!this._isDetached) {
        dimBadge.title = `Terminal Dimensions: ${cols}x${rows} (Click to Detach 80x24)`;
        dimBadge.setAttribute('data-tooltip', 'Detach (80x24)');
      } else {
        const nextIdx = (presetIdx + 1) % presets.length;
        const next = presets[nextIdx];
        dimBadge.title = `Terminal Dimensions: ${cols}x${rows} (Click to switch to ${next.label})`;
        dimBadge.setAttribute('data-tooltip', `Switch to ${next.label}`);
      }
    };

    this.terminal.onDimensionsChange = (cols, rows) => {
      updateDimBadge(cols, rows);
    };

    const initialDims = this.terminal.getGridDimensions();
    updateDimBadge(initialDims.cols, initialDims.rows);

    const setDetachedFocus = (focused) => {
      if (!this._isDetached) return;
      if (focused) {
        terminalSection.classList.add('focused');
        terminalSection.style.zIndex = '1001';
        this.terminal.focus();
      } else {
        terminalSection.classList.remove('focused');
        terminalSection.style.zIndex = '1000';
      }
    };

    const toggleMinimize = () => {
      if (!this._isDetached) return;
      this._isMinimized = !this._isMinimized;
      if (this._isMinimized) {
        preMinHeight = terminalSection.style.height || `${terminalSection.clientHeight}px`;
        terminalSection.classList.add('minimized');
        if (btnMin) {
          btnMin.innerHTML = MAX_SVG;
          btnMin.title = 'Maximize Terminal';
          btnMin.setAttribute('data-tooltip', 'Maximize');
          btnMin.setAttribute('aria-label', 'Maximize Terminal');
        }
      } else {
        terminalSection.classList.remove('minimized');
        if (preMinHeight) {
          terminalSection.style.height = preMinHeight;
        }
        if (btnMin) {
          btnMin.innerHTML = MIN_SVG;
          btnMin.title = 'Minimize Terminal';
          btnMin.setAttribute('data-tooltip', 'Minimize');
          btnMin.setAttribute('aria-label', 'Minimize Terminal');
        }
        isProgrammaticResize = true;
        this.terminal.fit();
        setTimeout(() => { isProgrammaticResize = false; }, 60);
        setDetachedFocus(true);
      }
    };

    this.detachTerminal = (cols = 80, rows = 24) => {
      this._isDetached = true;
      this.terminal.isDetached = true;
      dockedHeight = terminalSection.clientHeight || dockedHeight;

      terminalSection.classList.add('detached');
      if (resizer) resizer.classList.add('hidden');
      if (btnMin) {
        btnMin.style.display = 'inline-flex';
        btnMin.innerHTML = MIN_SVG;
        btnMin.title = 'Minimize Terminal';
      }

      const winWViewport = this.win?.innerWidth || 1200;
      const winHViewport = this.win?.innerHeight || 800;
      const targetSize = this.terminal.computeContainerSizeForGrid(cols, rows);
      const winW = Math.min(winWViewport - 30, Math.max(480, targetSize.width));
      const winH = Math.min(winHViewport - 50, Math.max(260, targetSize.height));

      const left = Math.max(20, Math.round((winWViewport - winW) / 2));
      const top = Math.max(40, Math.round((winHViewport - winH) / 2));

      isProgrammaticResize = true;
      presetIdx = Math.max(
        0,
        presets.findIndex((p) => p.cols === cols && p.rows === rows)
      );
      terminalSection.style.position = 'fixed';
      terminalSection.style.left = `${left}px`;
      terminalSection.style.top = `${top}px`;
      terminalSection.style.width = `${winW}px`;
      terminalSection.style.height = `${winH}px`;
      terminalSection.style.zIndex = '1001';

      this.terminal.fixedGrid = true;
      this.terminal.setGridDimensions(cols, rows);
      updateDimBadge(cols, rows);
      setTimeout(() => { isProgrammaticResize = false; }, 80);

      btnDetach.innerHTML = DOCK_SVG;
      btnDetach.title = 'Dock Terminal (Ctrl+Shift+D)';
      btnDetach.setAttribute('data-tooltip', 'Dock Terminal');
      btnDetach.setAttribute('aria-label', 'Dock Terminal');

      this._layoutEditor();
      setDetachedFocus(true);
    };

    this.dockTerminal = () => {
      this._isDetached = false;
      this.terminal.isDetached = false;
      this.terminal.fixedGrid = false;
      if (this._isMinimized) {
        this._isMinimized = false;
        terminalSection.classList.remove('minimized');
      }

      terminalSection.classList.remove('detached');
      terminalSection.classList.remove('focused');
      if (resizer) resizer.classList.remove('hidden');
      if (btnMin) btnMin.style.display = 'none';

      terminalSection.style.position = '';
      terminalSection.style.left = '';
      terminalSection.style.top = '';
      terminalSection.style.width = '';
      terminalSection.style.height = `${dockedHeight}px`;
      terminalSection.style.zIndex = '';

      btnDetach.innerHTML = DETACH_SVG;
      btnDetach.title = 'Detach Terminal (Floating 80x24)';
      btnDetach.setAttribute('data-tooltip', 'Detach Terminal (80x24)');
      btnDetach.setAttribute('aria-label', 'Detach Terminal');

      this.terminal.fit();
      const dims = this.terminal.getGridDimensions();
      updateDimBadge(dims.cols, dims.rows);
      this._layoutEditor();
      this.terminal.focus();
    };

    this.toggleTerminalDetach = () => {
      if (this._isDetached) {
        this.dockTerminal();
      } else {
        this.detachTerminal(80, 24);
      }
    };

    this._listen(btnDetach, 'click', (e) => {
      e.preventDefault();
      this.toggleTerminalDetach();
    });

    this._listen(btnMin, 'mousedown', (e) => {
      e.preventDefault();
      setDetachedFocus(true);
    });

    this._listen(btnMin, 'click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMinimize();
    });

    this._listen(dimBadge, 'mousedown', (e) => {
      e.preventDefault();
      setDetachedFocus(true);
    });

    this._listen(dimBadge, 'click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDetachedFocus(true);
      if (!this._isDetached) {
        this.detachTerminal(80, 24);
        return;
      }
      if (this._isMinimized) {
        toggleMinimize();
      }
      presetIdx = (presetIdx + 1) % presets.length;
      const target = presets[presetIdx];
      isProgrammaticResize = true;
      this.terminal.fixedGrid = true;
      const winWViewport = this.win?.innerWidth || 1200;
      const winHViewport = this.win?.innerHeight || 800;
      const targetSize = this.terminal.computeContainerSizeForGrid(target.cols, target.rows);
      const winW = Math.min(winWViewport - 30, targetSize.width);
      const winH = Math.min(winHViewport - 50, targetSize.height);
      terminalSection.style.width = `${winW}px`;
      terminalSection.style.height = `${winH}px`;
      if (winW < targetSize.width || winH < targetSize.height) {
        this.terminal.fixedGrid = false;
        this.terminal.fit();
      } else {
        this.terminal.setGridDimensions(target.cols, target.rows);
      }
      const dims = this.terminal.getGridDimensions();
      updateDimBadge(dims.cols, dims.rows);
      setTimeout(() => {
        isProgrammaticResize = false;
        this.terminal.focus();
      }, 80);
    });

    this._listen(terminalSection, 'mousedown', () => {
      if (this._isDetached) {
        setDetachedFocus(true);
      }
    });

    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initLeft = 0;
    let initTop = 0;

    this._listen(terminalHeader, 'mousedown', (e) => {
      if (!this._isDetached) return;
      setDetachedFocus(true);
      if (e.target.closest?.('button') || e.target.closest?.('.terminal-dim-badge') || e.target.closest?.('.pane-zoom-controls')) {
        return;
      }
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = terminalSection.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;
      if (this.doc?.body) this.doc.body.style.cursor = 'move';
      e.preventDefault();
    });

    this._listen(this.win, 'mousemove', (e) => {
      if (!isDragging || !this._isDetached) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const maxL = (this.win?.innerWidth || 1200) - 80;
      const maxT = (this.win?.innerHeight || 800) - 40;
      terminalSection.style.left = `${Math.max(0, Math.min(maxL, initLeft + dx))}px`;
      terminalSection.style.top = `${Math.max(0, Math.min(maxT, initTop + dy))}px`;
    });

    this._listen(this.win, 'mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (this.doc?.body) this.doc.body.style.cursor = '';
      }
    });

    this._listen(this.win, 'mousedown', (e) => {
      if (this._isDetached && !terminalSection.contains(e.target)) {
        setDetachedFocus(false);
      }
    });

    if (this.terminal.term?.onFocus) {
      this.terminal.term.onFocus(() => {
        if (this._isDetached) setDetachedFocus(true);
      });
    }

    if (typeof ResizeObserver !== 'undefined') {
      let prevW = 0;
      let prevH = 0;
      const roFloating = new ResizeObserver((entries) => {
        if (!this._isDetached || this._isMinimized) return;
        for (const entry of entries) {
          const cr = entry.contentRect;
          if (!cr || cr.width === 0 || cr.height === 0) continue;
          if (isProgrammaticResize) {
            prevW = cr.width;
            prevH = cr.height;
            return;
          }
          if (Math.abs(cr.width - prevW) > 2 || Math.abs(cr.height - prevH) > 2) {
            prevW = cr.width;
            prevH = cr.height;
            presetIdx = -1;
            this.terminal.fixedGrid = false;
            this.terminal.fit();
            const dims = this.terminal.getGridDimensions();
            updateDimBadge(dims.cols, dims.rows);
          }
        }
      });
      roFloating.observe(terminalSection);
      this._cleanups.push(() => roFloating.disconnect());
    }

    if (this.shortcuts && this.win) {
      this._listen(this.win, 'keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
          e.preventDefault();
          this.toggleTerminalDetach();
        }
      });
    }
  }

  toggleSidebar() {}
  detachTerminal() {}
  dockTerminal() {}
  toggleTerminalDetach() {}

  destroy() {
    while (this._cleanups.length > 0) {
      const cleanup = this._cleanups.pop();
      try {
        cleanup();
      } catch {}
    }
  }
}
