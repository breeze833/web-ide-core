// Minimal pure-JS test mocks for duck-typed VFS, DOM, localStorage, IndexedDB, Monaco, and xterm

export function createMemoryVFS(initialRoot = '/workspace') {
  const dirs = new Set(['/', initialRoot]);
  const files = new Map(); // path -> { content: Uint8Array, mtime: number }
  const listeners = new Set();

  function norm(p) {
    if (!p) return '/';
    const parts = String(p).split('/').filter((s) => s && s !== '.');
    const stack = [];
    for (const part of parts) {
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return '/' + stack.join('/');
  }

  function notify(ev) {
    for (const fn of listeners) fn(ev);
  }

  return {
    exists(path) {
      const p = norm(path);
      return dirs.has(p) || files.has(p);
    },
    mkdir(path) {
      const p = norm(path);
      const parts = p.split('/').filter(Boolean);
      let cur = '';
      for (const part of parts) {
        cur += '/' + part;
        dirs.add(cur);
      }
      notify({ type: 'mkdir', path: p });
    },
    writeFile(path, content, mtime = Date.now()) {
      const p = norm(path);
      const parent = p.slice(0, p.lastIndexOf('/')) || '/';
      this.mkdir(parent);
      const bytes =
        typeof content === 'string'
          ? new TextEncoder().encode(content)
          : content instanceof Uint8Array
            ? content
            : new Uint8Array(content || []);
      files.set(p, { content: bytes, mtime });
      notify({ type: 'write', path: p });
    },
    readFile(path, asText = true) {
      const p = norm(path);
      const entry = files.get(p);
      if (!entry) throw new Error(`ENOENT: ${p}`);
      return asText ? new TextDecoder().decode(entry.content) : entry.content;
    },
    readDir(path) {
      const p = norm(path);
      if (!dirs.has(p)) throw new Error(`ENOENT: ${p}`);
      const prefix = p === '/' ? '/' : p + '/';
      const seen = new Map();
      for (const d of dirs) {
        if (d !== p && d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          const name = rest.split('/')[0];
          if (!rest.includes('/')) {
            seen.set(name, { name, isDir: true });
          }
        }
      }
      for (const f of files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          if (!rest.includes('/')) {
            seen.set(rest, { name: rest, isDir: false });
          }
        }
      }
      return Array.from(seen.values()).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    },
    getAllFiles(prefix = '/workspace') {
      const base = norm(prefix);
      const basePrefix = base === '/' ? '/' : base + '/';
      const out = [];
      for (const d of Array.from(dirs).sort()) {
        if (d === base || d.startsWith(basePrefix)) {
          out.push({ path: d, isDir: true, mtime: 1000 });
        }
      }
      for (const [p, entry] of Array.from(files.entries()).sort()) {
        if (p === base || p.startsWith(basePrefix)) {
          out.push({ path: p, isDir: false, content: entry.content, mtime: entry.mtime });
        }
      }
      return out;
    },
    remove(path, recursive = false) {
      const p = norm(path);
      if (files.has(p)) {
        files.delete(p);
        notify({ type: 'remove', path: p });
        return;
      }
      if (dirs.has(p)) {
        const subPrefix = p + '/';
        if (!recursive) {
          for (const d of dirs) if (d.startsWith(subPrefix)) throw new Error(`ENOTEMPTY: ${p}`);
          for (const f of files.keys()) if (f.startsWith(subPrefix)) throw new Error(`ENOTEMPTY: ${p}`);
        }
        for (const d of Array.from(dirs)) if (d === p || d.startsWith(subPrefix)) dirs.delete(d);
        for (const f of Array.from(files.keys())) if (f.startsWith(subPrefix)) files.delete(f);
        notify({ type: 'remove', path: p });
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function createMockLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

export function createMockIndexedDB() {
  const dbs = new Map();
  return {
    open(name) {
      const req = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        let stores = dbs.get(name);
        const needsUpgrade = !stores;
        if (!stores) {
          stores = new Map();
          dbs.set(name, stores);
        }
        const db = {
          objectStoreNames: {
            contains: (s) => stores.has(s),
          },
          createObjectStore(s, opts = {}) {
            const map = new Map();
            stores.set(s, { map, keyPath: opts.keyPath || null });
          },
          transaction(storeName) {
            const tx = {
              oncomplete: null,
              onerror: null,
              objectStore() {
                const entry = stores.get(storeName);
                const map = entry.map;
                return {
                  clear() {
                    const r = { onsuccess: null, onerror: null };
                    map.clear();
                    queueMicrotask(() => r.onsuccess?.());
                    return r;
                  },
                  put(val, explicitKey) {
                    const key = explicitKey !== undefined ? explicitKey : val[entry.keyPath];
                    map.set(key, val);
                    const r = { onsuccess: null, onerror: null };
                    queueMicrotask(() => r.onsuccess?.());
                    return r;
                  },
                  get(key) {
                    const r = { result: map.get(key), onsuccess: null, onerror: null };
                    queueMicrotask(() => r.onsuccess?.());
                    return r;
                  },
                  getAll() {
                    const r = { result: Array.from(map.values()), onsuccess: null, onerror: null };
                    queueMicrotask(() => r.onsuccess?.());
                    return r;
                  },
                  delete(key) {
                    map.delete(key);
                    const r = { onsuccess: null, onerror: null };
                    queueMicrotask(() => r.onsuccess?.());
                    return r;
                  },
                };
              },
            };
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
          },
        };
        req.result = db;
        if (needsUpgrade && req.onupgradeneeded) {
          req.onupgradeneeded({ target: { result: db } });
        }
        req.onsuccess?.({ target: { result: db } });
      });
      return req;
    },
  };
}

class MockClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...names) {
    for (const n of names) this.set.add(n);
    this.el._className = Array.from(this.set).join(' ');
  }
  remove(...names) {
    for (const n of names) this.set.delete(n);
    this.el._className = Array.from(this.set).join(' ');
  }
  contains(n) {
    return this.set.has(n);
  }
}

export function createMockElement(tagName = 'div', attrs = {}) {
  const el = {
    tagName: tagName.toUpperCase(),
    id: attrs.id || '',
    _className: '',
    children: [],
    parentElement: null,
    style: {},
    attrs: {},
    _textContent: '',
    _innerHTML: '',
    listeners: new Map(),
    clientWidth: attrs.clientWidth || 240,
    clientHeight: attrs.clientHeight || 240,
    title: '',
    accept: '',
    type: '',
    value: '',
    files: [],
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return this.attrs[k] ?? null;
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      child.parentElement = null;
    },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev) {
      const event = {
        preventDefault() {},
        stopPropagation() {},
        target: this,
        ...ev,
      };
      for (const fn of this.listeners.get(event.type) || []) {
        fn(event);
      }
    },
    contains(target) {
      if (target === this) return true;
      return this.children.some((c) => c.contains?.(target));
    },
    closest() {
      return null;
    },
    getBoundingClientRect() {
      return {
        left: parseInt(this.style.left || '0', 10) || 100,
        top: parseInt(this.style.top || '0', 10) || 100,
        width: this.clientWidth,
        height: this.clientHeight,
      };
    },
    querySelector(selector) {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        for (const c of this.children) {
          if (c.classList?.contains(cls)) return c;
          const found = c.querySelector?.(selector);
          if (found) return found;
        }
      }
      if (selector.startsWith('#')) {
        const id = selector.slice(1);
        for (const c of this.children) {
          if (c.id === id) return c;
          const found = c.querySelector?.(selector);
          if (found) return found;
        }
      }
      return null;
    },
    querySelectorAll(selector) {
      const out = [];
      const cls = selector.startsWith('.') ? selector.slice(1) : null;
      for (const c of this.children) {
        if (cls && c.classList?.contains(cls)) out.push(c);
        if (c.querySelectorAll) out.push(...c.querySelectorAll(selector));
      }
      return out;
    },
    click() {
      this.dispatchEvent({ type: 'click', target: this });
    },
  };
  el.classList = new MockClassList(el);
  Object.defineProperty(el, 'className', {
    get: () => el._className,
    set: (v) => {
      el._className = String(v || '');
      el.classList.set = new Set(el._className.split(/\s+/).filter(Boolean));
    },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => el._innerHTML,
    set: (v) => {
      el._innerHTML = String(v);
      if (v === '') el.children = [];
    },
  });
  Object.defineProperty(el, 'textContent', {
    get: () => el._textContent,
    set: (v) => {
      el._textContent = String(v);
    },
  });
  return el;
}

export function createMockDOM() {
  const docListeners = new Map();
  const winListeners = new Map();
  const body = createMockElement('body');

  const doc = {
    body,
    createElement: (tag) => createMockElement(tag),
    getElementById: (id) => body.querySelector(`#${id}`),
    querySelector: (sel) => body.querySelector(sel),
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    },
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev) {
      const event = { preventDefault() {}, stopPropagation() {}, ...ev };
      for (const fn of winListeners.get(event.type) || []) {
        fn(event);
      }
    },
  };

  return { doc, win, body };
}

export function createMockMonaco() {
  const models = [];
  const commands = new Map();
  let lastOptions = {};

  return {
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49, Equal: 85, Minus: 87, Digit0: 21, KeyB: 32 },
    editor: {
      create(container, opts) {
        lastOptions = { ...opts };
        return {
          container,
          _model: null,
          _layoutCount: 0,
          _focused: false,
          updateOptions(patch) {
            Object.assign(lastOptions, patch);
          },
          addCommand(chord, handler) {
            commands.set(chord, handler);
          },
          layout() {
            this._layoutCount++;
          },
          setModel(model) {
            this._model = model;
          },
          focus() {
            this._focused = true;
          },
          dispose() {},
          _getOptions: () => lastOptions,
          _triggerCommand: (chord) => commands.get(chord)?.(),
        };
      },
      createModel(value, language) {
        let val = value;
        const changeCbs = [];
        const model = {
          language,
          disposed: false,
          getValue: () => val,
          setValue: (next) => {
            val = next;
            for (const cb of changeCbs) cb();
          },
          onDidChangeContent: (cb) => {
            changeCbs.push(cb);
            return { dispose() {} };
          },
          dispose() {
            this.disposed = true;
          },
        };
        models.push(model);
        return model;
      },
    },
    _models: models,
    _commands: commands,
  };
}

export function createMockXterm() {
  class MockTerminal {
    constructor(opts) {
      this.options = { ...opts };
      this.cols = 80;
      this.rows = 24;
      this.output = [];
      this.focused = false;
      this._dataListeners = [];
      this._resizeListeners = [];
      this._customKeyHandler = null;
    }
    loadAddon(addon) {
      this._fitAddon = addon;
    }
    open(container) {
      this.container = container;
    }
    attachCustomKeyEventHandler(fn) {
      this._customKeyHandler = fn;
    }
    onResize(cb) {
      this._resizeListeners.push(cb);
    }
    onData(cb) {
      this._dataListeners.push(cb);
    }
    emitData(data) {
      for (const cb of this._dataListeners) cb(data);
    }
    resize(cols, rows) {
      this.cols = cols;
      this.rows = rows;
      for (const cb of this._resizeListeners) cb({ cols, rows });
    }
    write(str) {
      this.output.push(str);
    }
    writeln(str) {
      this.output.push(str + '\r\n');
    }
    clear() {
      this.output = [];
    }
    focus() {
      this.focused = true;
    }
    dispose() {}
  }

  class MockFitAddon {
    constructor() {
      this.fitCount = 0;
    }
    fit() {
      this.fitCount++;
    }
  }

  return { Terminal: MockTerminal, FitAddon: MockFitAddon };
}
