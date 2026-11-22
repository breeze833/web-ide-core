// Generic POSIX Shell Worker Handler powered by busybox-wasi (ash) & ansi-line-editor

import { LineEditor } from 'ansi-line-editor';
import { createStdinReader } from 'stdin-wasi/worker';
import { OverlayVFS, normalizePath } from 'vfs-wasi';
import { WasiHost, ProcExit } from 'wasi-host';
import { createBusyboxHostOptions } from 'busybox-wasi/host';
import { createWasmCache } from './wasm-cache.js';

const CONTROL_IDX = 0; // 0 = idle, 1 = waiting, 2 = done
const RESULT_IDX = 1; // exitCode

const SCRIPT_PREAMBLE =
  `_DIR_STACK=""; pushd() { if [ -z "$1" ]; then echo "pushd: no other directory" >&2; return 1; fi; _DIR_STACK="$(pwd)|\${_DIR_STACK}"; cd "$1" || return 1; dirs; }; popd() { if [ -z "$_DIR_STACK" ]; then echo "popd: directory stack empty" >&2; return 1; fi; _TARGET="\${_DIR_STACK%%|*}"; _DIR_STACK="\${_DIR_STACK#*|}"; cd "$_TARGET" || return 1; dirs; }; dirs() { _res="$(pwd)"; _rest="$_DIR_STACK"; while [ -n "$_rest" ]; do _d="\${_rest%%|*}"; _rest="\${_rest#*|}"; if [ -n "$_d" ]; then _res="$_res $_d"; fi; done; echo "$_res"; };`;

const DEFAULT_SHELL_BUILTINS = new Set([
  'cd',
  'pushd',
  'popd',
  'dirs',
  'alias',
  'unalias',
  'type',
  'help',
  'exit',
  'return',
  'exec',
  'eval',
  '.',
  'source',
  'set',
  'export',
  'unset',
]);

function getShellPreamble(stack) {
  return `_DIR_STACK="${stack}"; _save_dstack() { __host_update_dstack "$_DIR_STACK"; }; pushd() { if [ -z "$1" ]; then echo "pushd: no other directory" >&2; return 1; fi; _DIR_STACK="$(pwd)|\${_DIR_STACK}"; _save_dstack; cd "$1" || return 1; dirs; }; popd() { if [ -z "$_DIR_STACK" ]; then echo "popd: directory stack empty" >&2; return 1; fi; _TARGET="\${_DIR_STACK%%|*}"; _DIR_STACK="\${_DIR_STACK#*|}"; _save_dstack; cd "$_TARGET" || return 1; dirs; }; dirs() { _res="$(pwd)"; _rest="$_DIR_STACK"; while [ -n "$_rest" ]; do _d="\${_rest%%|*}"; _rest="\${_rest#*|}"; if [ -n "$_d" ]; then _res="$_res $_d"; fi; done; echo "$_res"; };`;
}

export function findHeredocs(line) {
  const heredocs = [];
  let inSingle = false;
  let inDouble = false;
  let isEscaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === '\\' && !inSingle) {
      isEscaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
      if (ch === '<' && line[i + 1] === '<' && line[i + 2] !== '<' && (i === 0 || line[i - 1] !== '<')) {
        let idx = i + 2;
        let stripTabs = false;
        if (line[idx] === '-') {
          stripTabs = true;
          idx++;
        }
        while (idx < line.length && (line[idx] === ' ' || line[idx] === '\t')) idx++;
        let word = '';
        while (idx < line.length && !/[\s;|<>&()]/.test(line[idx])) {
          word += line[idx];
          idx++;
        }
        const cleanDelim = word.replace(/^(['"])(.*)\1$/, '$2').replace(/^\\/, '');
        if (cleanDelim.length > 0) heredocs.push({ delim: cleanDelim, stripTabs });
        i = idx - 1;
      }
    }
  }
  return heredocs;
}

export function getPendingHeredocs(lines) {
  const pending = [];
  for (const line of lines) {
    if (pending.length > 0) {
      const cur = pending[0];
      const checkLine = cur.stripTabs ? line.replace(/^\t+/, '') : line;
      if (checkLine === cur.delim) {
        pending.shift();
      }
    } else {
      const found = findHeredocs(line);
      for (const h of found) pending.push(h);
    }
  }
  return pending;
}

export function closePendingHeredocs(lines) {
  const pending = getPendingHeredocs(lines);
  if (pending.length === 0) {
    return lines.join('\n');
  }
  const result = [...lines];
  for (const h of pending) {
    result.push(h.delim);
  }
  return result.join('\n');
}

export function hasUnquotedShellOperators(line) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let isEscaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === '\\' && !inSingleQuote) return true;
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if ('|&;<>$`*?!(){}\n'.includes(ch)) {
        return true;
      }
    } else if (inDoubleQuote) {
      if (ch === '$' || ch === '`') {
        return true;
      }
    }
  }
  return false;
}

export function tokenizeSimpleCommand(line) {
  const tokens = [];
  let current = '';
  let inQuote = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

export function createShellWorkerHandler(options = {}) {
  const postMsg = options.postMessage || ((data, transfer) => globalThis.self?.postMessage?.(data, transfer));
  const workspaceRoot = options.workspaceRoot || '/workspace';
  const cacheKey = options.cacheKey || 'busybox-1.38.0-build1';
  const wasmCache = options.wasmCache || createWasmCache();
  const systemDirs = Array.isArray(options.systemDirs) ? options.systemDirs : [];
  const binCommandsSet = new Set(options.binCommands || []);
  const hostCommandsSet = new Set(options.toolchainCommands || options.hostCommands || []);
  const extraBuiltins = options.extraBuiltins || {};
  const mountSysroot = typeof options.mountSysroot === 'function' ? options.mountSysroot : null;
  const vfs = options.vfs || (options.vfsFactory ? options.vfsFactory() : new OverlayVFS({ workingDir: '/' }));
  const onCommandDispatch = typeof options.onCommandDispatch === 'function' ? options.onCommandDispatch : null;

  let cwd = options.cwd || workspaceRoot;
  let isExecuting = false;
  let isInitialized = false;
  let termRows = 24;
  let termCols = 80;
  let multiLineBuffer = [];
  let dirStackStr = '';
  let busyboxModule = options.busyboxModule || null;
  let sharedInt32 = null;

  const shellEnviron = {
    USER: 'user',
    HOME: workspaceRoot,
    PWD: cwd,
    PATH: `/bin:/usr/bin:${workspaceRoot}`,
    ...(options.envDefaults || {}),
  };

  let readStdin = createStdinReader({
    sharedBuffer: null,
    notifyHost: () => postMsg({ type: 'stdin_request' }),
  });

  function write(str) {
    postMsg({ type: 'term_write', data: str });
  }

  function writeln(str = '') {
    postMsg({ type: 'term_write', data: str + '\r\n' });
  }

  const shellEditor = new LineEditor({
    write: (str) => write(str),
    historyContext: 'shell',
  });

  const promptFormatter =
    typeof options.promptFormatter === 'function'
      ? options.promptFormatter
      : ({ cwd: curCwd }) => {
          const displayCwd = curCwd === workspaceRoot ? '~' : curCwd.replace(new RegExp(`^${workspaceRoot}`), '~');
          return `\x1b[1;32mide\x1b[0m:\x1b[1;34m${displayCwd}\x1b[0m$ `;
        };

  function getActivePrompt() {
    return multiLineBuffer.length > 0 ? '> ' : promptFormatter({ cwd, env: shellEnviron });
  }

  function showPrompt() {
    shellEditor.reset();
    write(getActivePrompt());
  }

  function resolvePath(p, currentCwd = cwd) {
    if (!p) return currentCwd;
    const target = p.startsWith('/') ? p : `${currentCwd}/${p}`;
    return normalizePath(target);
  }

  function getWorkspaceSnapshot() {
    const fileMap = new Map();
    const dirSet = new Set();
    const all = vfs.getAllFiles(workspaceRoot);
    for (const f of all) {
      if (!f.isDir) {
        fileMap.set(f.path, {
          mtime: f.mtime,
          length: f.content ? f.content.length : 0,
        });
      } else {
        dirSet.add(f.path);
      }
    }
    return { fileMap, dirSet };
  }

  function getWorkspaceDiff(beforeSnapshot) {
    const changedFiles = {};
    const deletedFiles = [];
    const createdDirs = [];
    const deletedDirs = [];
    const currentFiles = new Set();
    const currentDirs = new Set();

    const all = vfs.getAllFiles(workspaceRoot);
    for (const f of all) {
      if (!f.isDir) {
        currentFiles.add(f.path);
        const before = beforeSnapshot.fileMap.get(f.path);
        if (!before || before.mtime !== f.mtime || before.length !== (f.content ? f.content.length : 0)) {
          changedFiles[f.path] = { content: f.content, mtime: f.mtime };
        }
      } else {
        currentDirs.add(f.path);
        if (!beforeSnapshot.dirSet.has(f.path)) {
          createdDirs.push(f.path);
        }
      }
    }

    for (const p of beforeSnapshot.fileMap.keys()) {
      if (!currentFiles.has(p)) {
        deletedFiles.push(p);
      }
    }
    for (const p of beforeSnapshot.dirSet) {
      if (!currentDirs.has(p)) {
        deletedDirs.push(p);
      }
    }

    return { changedFiles, deletedFiles, createdDirs, deletedDirs };
  }

  function syncWorkspaceDiff(beforeSnapshot) {
    const { changedFiles, deletedFiles, createdDirs, deletedDirs } = getWorkspaceDiff(beforeSnapshot);
    if (
      Object.keys(changedFiles).length > 0 ||
      deletedFiles.length > 0 ||
      createdDirs.length > 0 ||
      deletedDirs.length > 0
    ) {
      postMsg({
        type: 'vfs_sync',
        changedFiles,
        deletedFiles,
        createdDirs,
        deletedDirs,
      });
    }
  }

  function execHostCommandSync(payload) {
    if (onCommandDispatch) {
      const handled = onCommandDispatch(payload, { vfs, cwd, environ: shellEnviron, write, writeln });
      if (typeof handled === 'number') return handled;
    }

    if (sharedInt32) {
      Atomics.store(sharedInt32, RESULT_IDX, 0);
      Atomics.store(sharedInt32, CONTROL_IDX, 1);
      postMsg({ type: 'host_spawn_request', payload });

      while (Atomics.load(sharedInt32, CONTROL_IDX) === 1) {
        Atomics.wait(sharedInt32, CONTROL_IDX, 1, 100);
      }
      return Atomics.load(sharedInt32, RESULT_IDX);
    }

    postMsg({ type: 'host_spawn_request', payload });
    return 0;
  }

  async function loadBusyboxBinary(basePath) {
    if (busyboxModule) return busyboxModule;

    try {
      const cached = await wasmCache.getWasmModule(cacheKey);
      if (typeof WebAssembly !== 'undefined' && cached instanceof WebAssembly.Module) {
        return cached;
      }
    } catch (_) {}

    const url =
      typeof options.wasmUrl === 'function'
        ? options.wasmUrl(basePath)
        : options.wasmUrl || `${basePath}/busybox.wasm`;
    let arrayBuf = null;

    if (typeof fetch === 'function') {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res && (res.ok || typeof res.ok === 'undefined')) {
          arrayBuf = await res.arrayBuffer();
        }
      } catch (_) {}
    }

    if (!arrayBuf && vfs.exists('/bin/busybox')) {
      const bytes = vfs.readFile('/bin/busybox', false);
      if (bytes && bytes.length > 0) {
        arrayBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    }

    if (!arrayBuf) {
      throw new Error(`Failed to load busybox.wasm from ${url}`);
    }

    const mod = await WebAssembly.compile(arrayBuf);
    wasmCache.saveWasmModule(cacheKey, arrayBuf).catch(() => {});
    return mod;
  }

  function createShellWasiHost(hostOpts) {
    return new WasiHost(
      createBusyboxHostOptions({
        systemDirs,
        ...hostOpts,
      })
    );
  }

  function checkSyntaxEof(fullText) {
    if (!busyboxModule) return false;
    let err = '';
    let code = 0;
    const host = createShellWasiHost({
      vfs,
      cwd,
      argv: ['busybox', 'sh', '-n', '-c', fullText],
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    const inst = new WebAssembly.Instance(busyboxModule, host.createImportObject());
    host.getMemory = () => inst.exports.memory;
    try {
      inst.exports._start();
    } catch (e) {
      code = e && typeof e.code === 'number' ? e.code : 0;
    }
    return code !== 0 && (err.includes('unexpected end of file') || err.includes('unterminated quoted string'));
  }

  function isCommandIncomplete(lines) {
    if (lines.length === 0) return false;
    if (getPendingHeredocs(lines).length > 0) return true;

    const lastLine = lines[lines.length - 1];
    let backslashes = 0;
    for (let i = lastLine.length - 1; i >= 0 && lastLine[i] === '\\'; i--) {
      backslashes++;
    }
    if (backslashes % 2 === 1) return true;
    if (/(?:\||\|\||&&)\s*$/.test(lastLine)) return true;

    return checkSyntaxEof(lines.join('\n'));
  }

  function isHostBuiltin(name) {
    if (
      name === '__host_update_pwd' ||
      name === '__host_update_dstack' ||
      name === '__host_exec' ||
      name === 'time' ||
      name === 'clear' ||
      hostCommandsSet.has(name) ||
      Object.prototype.hasOwnProperty.call(extraBuiltins, name) ||
      name.startsWith('./') ||
      name.startsWith('/') ||
      vfs.exists(`${cwd}/${name}`) ||
      vfs.exists(`${workspaceRoot}/${name}`) ||
      vfs.exists(`/usr/bin/${name}`)
    ) {
      return 1;
    }
    return 0;
  }

  function handleHostBuiltinRun({ cwd: runCwd, argv, envp }, defaultEnviron) {
    let cmd = argv[0];
    let args = argv.slice(1);

    if (cmd === '__host_update_pwd') {
      const newPwd = args[0] ? args[0].trim() : '';
      if (newPwd && newPwd !== cwd && (vfs.exists(newPwd) || newPwd === '/')) {
        cwd = newPwd;
        shellEnviron.PWD = cwd;
        postMsg({ type: 'cwd_changed', cwd });
      }
      return 0;
    }

    if (cmd === '__host_update_dstack') {
      dirStackStr = args[0] || '';
      return 0;
    }

    if (cmd === '__host_exec') {
      cmd = args[0];
      args = args.slice(1);
    }

    if (cmd === 'clear') {
      write('\x1b[2J\x1b[H');
      return 0;
    }

    const runEnviron = { ...(defaultEnviron || shellEnviron), PWD: runCwd || cwd };
    if (Array.isArray(envp)) {
      for (const entry of envp) {
        if (typeof entry === 'string') {
          const eqIdx = entry.indexOf('=');
          if (eqIdx !== -1) {
            runEnviron[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
          }
        }
      }
    } else if (envp && typeof envp === 'object') {
      Object.assign(runEnviron, envp);
    }

    if (Object.prototype.hasOwnProperty.call(extraBuiltins, cmd)) {
      const res = extraBuiltins[cmd](args, { vfs, cwd: runCwd || cwd, environ: runEnviron, write, writeln });
      return typeof res === 'number' ? res : 0;
    }

    if (cmd === 'time') {
      const subCmd = args[0];
      if (!subCmd) {
        write('time: missing command\r\n');
        return 1;
      }
      const timeStart = performance.now();
      let targetCmd = subCmd;
      let targetArgs = args.slice(1);
      if (targetCmd === '__host_exec') {
        targetCmd = targetArgs[0];
        targetArgs = targetArgs.slice(1);
      }
      const code = execHostCommandSync({
        cmd: targetCmd,
        args: targetArgs,
        cwd: runCwd || cwd,
        environ: runEnviron,
      });
      const elapsed = ((performance.now() - timeStart) / 1000).toFixed(3);
      write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
      return code;
    }

    if (cmd.startsWith('./') || cmd.startsWith('/')) {
      const targetPath = resolvePath(cmd, runCwd || cwd);
      if (!vfs.exists(targetPath)) {
        write(`${cmd}: not found\r\n`);
        return 127;
      }
    }

    return execHostCommandSync({
      cmd,
      args,
      cwd: runCwd || cwd,
      environ: runEnviron,
    });
  }

  async function runScriptFile(scriptPath, args, environ, isTimed, beforeMap) {
    const t0 = performance.now();
    const wasiHost = createShellWasiHost({
      vfs,
      cwd,
      argv: ['busybox', 'sh', '-c', `cd "$1" || exit 1; shift; ${SCRIPT_PREAMBLE} . "$@"`, 'sh', cwd, scriptPath, ...args],
      environ,
      stdin: readStdin,
      stdout: (str) => write(str),
      stderr: (str) => write(str),
      rows: termRows,
      cols: termCols,
      hostBuiltinLookup: (name) => isHostBuiltin(name),
      hostBuiltinRun: (params) => handleHostBuiltinRun(params, environ),
    });

    const imports = wasiHost.createImportObject();
    const instance = new WebAssembly.Instance(busyboxModule, imports);
    wasiHost.getMemory = () => instance.exports.memory;

    let exitCode = 0;
    try {
      instance.exports._start();
    } catch (err) {
      if (err instanceof ProcExit) {
        exitCode = err.code;
      } else {
        writeln(`\x1b[31mScript error: ${err.message || String(err)}\x1b[0m`);
        exitCode = 1;
      }
    }

    if (isTimed) {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
      write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
    }

    syncWorkspaceDiff(beforeMap);
    return exitCode;
  }

  function wrapHostExecutables(cmdLine) {
    const lines = cmdLine.split('\n');
    const pending = [];
    const resultLines = [];

    for (const line of lines) {
      if (pending.length > 0) {
        resultLines.push(line);
        const cur = pending[0];
        const checkLine = cur.stripTabs ? line.replace(/^\t+/, '') : line;
        if (checkLine === cur.delim) {
          pending.shift();
        }
      } else {
        const wrappedLine = line.replace(/(^|[;&|\n]\s*|\btime\s+)(\.{1,2}\/[^\s;&|<>]+|\/[^\s;&|<>]+)/g, (match, prefix, target) => {
          const resolved = resolvePath(target);
          if (vfs.exists(resolved)) {
            const bytes = vfs.readFile(resolved, false);
            if (bytes && bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) {
              return match;
            }
          }
          return `${prefix}__host_exec ${target}`;
        });
        resultLines.push(wrappedLine);

        const found = findHeredocs(line);
        for (const h of found) {
          pending.push(h);
        }
      }
    }

    return resultLines.join('\n');
  }

  async function executeCommandLine(toExecute) {
    const beforeMap = getWorkspaceSnapshot();
    const trimmed = toExecute.trim();
    if (!trimmed) return 0;

    const isTimed = /^\s*time(\s+|$)/.test(trimmed);
    const actualCmd = isTimed ? trimmed.replace(/^\s*time\s*/, '').trim() : trimmed;
    if (!actualCmd) {
      if (isTimed) {
        write('time: missing command\r\n');
      }
      return 0;
    }

    const hasShellConstructs = hasUnquotedShellOperators(actualCmd);

    if (!hasShellConstructs) {
      const tokens = tokenizeSimpleCommand(actualCmd);
      let tokenIdx = 0;
      const envOverrides = {};
      const envAssignRegex = /^[A-Za-z_][A-Za-z0-9_]*=/;

      while (tokenIdx < tokens.length && envAssignRegex.test(tokens[tokenIdx])) {
        const token = tokens[tokenIdx];
        const eqIdx = token.indexOf('=');
        envOverrides[token.slice(0, eqIdx)] = token.slice(eqIdx + 1);
        tokenIdx++;
      }

      if (tokenIdx === tokens.length) {
        Object.assign(shellEnviron, envOverrides);
        shellEnviron.PWD = cwd;
        return 0;
      }

      const cmd = tokens[tokenIdx];
      const args = tokens.slice(tokenIdx + 1);

      if (cmd === 'export') {
        if (args.length === 0 || (args.length === 1 && args[0] === '-p')) {
          const keys = Object.keys(shellEnviron).sort();
          for (const key of keys) {
            const escapedVal = String(shellEnviron[key]).replace(/'/g, "'\\''");
            write(`export ${key}='${escapedVal}'\r\n`);
          }
          return 0;
        }
        for (const arg of args) {
          if (arg === '-p') continue;
          const eqIdx = arg.indexOf('=');
          if (eqIdx !== -1) {
            shellEnviron[arg.slice(0, eqIdx)] = arg.slice(eqIdx + 1);
          } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) {
            if (!(arg in shellEnviron)) shellEnviron[arg] = '';
          }
        }
        shellEnviron.PWD = cwd;
        return 0;
      }

      if (cmd === 'unset') {
        for (const arg of args) {
          delete shellEnviron[arg];
        }
        return 0;
      }

      const effectiveEnviron = {
        ...shellEnviron,
        ...envOverrides,
        PWD: cwd,
      };

      if (cmd === 'clear') {
        write('\x1b[2J\x1b[H');
        return 0;
      }

      if (Object.prototype.hasOwnProperty.call(extraBuiltins, cmd)) {
        const res = await extraBuiltins[cmd](args, { vfs, cwd, environ: effectiveEnviron, write, writeln });
        syncWorkspaceDiff(beforeMap);
        return typeof res === 'number' ? res : 0;
      }

      if (hostCommandsSet.has(cmd)) {
        const t0 = performance.now();
        const code = execHostCommandSync({
          cmd,
          args,
          cwd,
          environ: effectiveEnviron,
        });
        if (isTimed) {
          const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
          write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
        }
        syncWorkspaceDiff(beforeMap);
        return code;
      }

      if ((cmd === 'sh' || cmd === 'ash') && args.length > 0 && !args[0].startsWith('-')) {
        const scriptPath = resolvePath(args[0]);
        if (vfs.exists(scriptPath)) {
          if (!busyboxModule) {
            writeln('sh: busybox binary not initialized');
            return 1;
          }
          return await runScriptFile(scriptPath, args.slice(1), effectiveEnviron, isTimed, beforeMap);
        }
      }

      if (cmd.startsWith('./') || cmd.startsWith('/') || cmd.startsWith('../')) {
        const targetPath = resolvePath(cmd);
        if (!vfs.exists(targetPath)) {
          writeln(`${cmd}: not found`);
          if (isTimed) {
            write(`\r\nreal\t0m0.000s\r\nuser\t0m0.000s\r\nsys\t0m0.000s\r\n`);
          }
          return 127;
        }

        const bytes = vfs.readFile(targetPath, false);
        const isScript = (bytes && bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) || cmd.endsWith('.sh');
        if (isScript) {
          if (!busyboxModule) {
            writeln('sh: busybox binary not initialized');
            return 1;
          }
          return await runScriptFile(targetPath, args, effectiveEnviron, isTimed, beforeMap);
        } else {
          const t0 = performance.now();
          const code = execHostCommandSync({
            cmd: targetPath,
            args,
            cwd,
            environ: effectiveEnviron,
          });
          if (isTimed) {
            const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
            write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
          }
          syncWorkspaceDiff(beforeMap);
          return code;
        }
      }

      if (!binCommandsSet.has(cmd) && !DEFAULT_SHELL_BUILTINS.has(cmd)) {
        const workspaceCandidate = resolvePath(cmd);
        if (vfs.exists(workspaceCandidate)) {
          const bytes = vfs.readFile(workspaceCandidate, false);
          const isScript = (bytes && bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) || cmd.endsWith('.sh');
          if (isScript) {
            if (!busyboxModule) {
              writeln('sh: busybox binary not initialized');
              return 1;
            }
            return await runScriptFile(workspaceCandidate, args, effectiveEnviron, isTimed, beforeMap);
          } else {
            const t0 = performance.now();
            const code = execHostCommandSync({
              cmd: workspaceCandidate,
              args,
              cwd,
              environ: effectiveEnviron,
            });
            if (isTimed) {
              const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
              write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
            }
            syncWorkspaceDiff(beforeMap);
            return code;
          }
        }

        if (!vfs.exists(`/usr/bin/${cmd}`) && !vfs.exists(`/bin/${cmd}`)) {
          writeln(`${cmd}: command not found`);
          if (isTimed) {
            write(`\r\nreal\t0m0.000s\r\nuser\t0m0.000s\r\nsys\t0m0.000s\r\n`);
          }
          return 127;
        }
      }
    }

    if (!busyboxModule) {
      writeln('sh: busybox binary not initialized');
      return 1;
    }

    const effectiveEnviron = {
      ...shellEnviron,
      PWD: cwd,
    };

    const closedCmd = closePendingHeredocs(actualCmd.split('\n'));
    const wrapped = wrapHostExecutables(closedCmd);
    const t0 = performance.now();

    const preamble = getShellPreamble(dirStackStr);
    const wrappedCmd = `cd "${cwd}"; ${preamble}\n${wrapped}\n__rc=$?; __host_update_pwd "$(pwd)"; exit $__rc`;

    const wasiHost = createShellWasiHost({
      vfs,
      cwd,
      argv: ['busybox', 'sh', '-c', wrappedCmd],
      environ: effectiveEnviron,
      stdin: readStdin,
      stdout: (str) => write(str),
      stderr: (str) => write(str),
      rows: termRows,
      cols: termCols,
      hostBuiltinLookup: (name) => isHostBuiltin(name),
      hostBuiltinRun: (params) => handleHostBuiltinRun(params, effectiveEnviron),
    });

    const imports = wasiHost.createImportObject();
    const instance = new WebAssembly.Instance(busyboxModule, imports);
    wasiHost.getMemory = () => instance.exports.memory;

    let exitCode = 0;
    try {
      instance.exports._start();
    } catch (err) {
      if (err instanceof ProcExit) {
        exitCode = err.code;
      } else {
        writeln(`\x1b[31mShell error: ${err.message || String(err)}\x1b[0m`);
        exitCode = 1;
      }
    }

    if (isTimed) {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
      write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
    }

    syncWorkspaceDiff(beforeMap);
    return exitCode;
  }

  async function handleTabCompletion() {
    const currentLine = shellEditor.getBuffer();
    const tokens = currentLine.trim().split(/\s+/);
    const lastToken = tokens.length > 0 && !currentLine.endsWith(' ') ? tokens[tokens.length - 1] : '';

    let searchDir = cwd;
    let prefix = lastToken;

    if (lastToken.includes('/')) {
      const slashIdx = lastToken.lastIndexOf('/');
      const dirPart = lastToken.substring(0, slashIdx);
      prefix = lastToken.substring(slashIdx + 1);
      searchDir = resolvePath(dirPart);
    }

    try {
      if (!vfs.exists(searchDir)) return;
      const items = vfs.readDir(searchDir);
      const matches = items.filter((it) => it.name.startsWith(prefix));

      if (matches.length === 1) {
        const match = matches[0];
        const completion = match.name.substring(prefix.length) + (match.isDir ? '/' : ' ');
        shellEditor.feed(completion);
      } else if (matches.length > 1) {
        writeln('');
        writeln(matches.map((m) => m.name + (m.isDir ? '/' : '')).join('  '));
        write(getActivePrompt() + shellEditor.getBuffer());
        if (shellEditor.getCursor() < shellEditor.getBuffer().length) {
          write('\b'.repeat(shellEditor.getBuffer().length - shellEditor.getCursor()));
        }
      }
    } catch (_) {}
  }

  async function handleKey(key) {
    if (isExecuting) return;

    if (key === '\r' || key === '\n') {
      writeln('');
      const line = shellEditor.getBuffer();
      shellEditor.reset();

      if (multiLineBuffer.length === 0 && line.trim().length === 0) {
        showPrompt();
        return;
      }

      multiLineBuffer.push(line);

      if (isCommandIncomplete(multiLineBuffer)) {
        write('> ');
        return;
      }

      const toExecute = multiLineBuffer.join('\n').trim();
      multiLineBuffer = [];

      if (toExecute.length > 0) {
        shellEditor.commitHistory(toExecute);
        isExecuting = true;
        try {
          await executeCommandLine(toExecute);
        } catch (err) {
          if (err.message !== 'Interrupted') {
            writeln(`Error: ${err.message}`);
          }
        } finally {
          isExecuting = false;
          postMsg({ type: 'command_done' });
          showPrompt();
        }
        return;
      }

      showPrompt();
      return;
    }

    if (key === '\t') {
      await handleTabCompletion();
      return;
    }

    if (key === '\x03') {
      multiLineBuffer = [];
      writeln('^C');
      showPrompt();
      return;
    }

    if (key === '\x04') {
      if (shellEditor.getBuffer().length === 0) {
        if (multiLineBuffer.length > 0) {
          writeln('');
          const toExecute = closePendingHeredocs(multiLineBuffer).trim();
          multiLineBuffer = [];
          if (toExecute.length > 0) {
            shellEditor.commitHistory(toExecute);
            isExecuting = true;
            try {
              await executeCommandLine(toExecute);
            } catch (err) {
              if (err.message !== 'Interrupted') {
                writeln(`Error: ${err.message}`);
              }
            } finally {
              isExecuting = false;
              postMsg({ type: 'command_done' });
              showPrompt();
            }
            return;
          }
        } else {
          writeln('exit');
          showPrompt();
        }
      }
      return;
    }

    shellEditor.feed(key);
  }

  async function onmessage(event) {
    const msg = event?.data;
    if (!msg) return;

    if (msg.type === 'init') {
      cwd = msg.cwd || cwd;
      shellEnviron.PWD = cwd;
      if (msg.rows) termRows = msg.rows;
      if (msg.cols) termCols = msg.cols;
      if (msg.sharedBuffer) {
        sharedInt32 = new Int32Array(msg.sharedBuffer);
      }
      if (msg.stdinSharedBuffer) {
        readStdin.updateSharedBuffer(msg.stdinSharedBuffer);
      }

      if (msg.sharedSysrootBuffer && typeof vfs.setSharedSysroot === 'function') {
        vfs.setSharedSysroot(msg.sharedSysrootBuffer);
      } else if (mountSysroot) {
        mountSysroot(vfs);
      }

      if (msg.dirs) {
        for (const d of msg.dirs) {
          try {
            vfs.mkdir(normalizePath(d), true, true);
          } catch (_) {}
        }
      }

      if (msg.files) {
        for (const [p, item] of Object.entries(msg.files)) {
          const norm = normalizePath(p);
          const content = item && item.content !== undefined ? item.content : item;
          const mtime = item && item.mtime !== undefined ? item.mtime : Date.now();
          const u8 =
            typeof content === 'string'
              ? new TextEncoder().encode(content)
              : content instanceof Uint8Array
                ? content
                : new Uint8Array(content);
          vfs.writeFile(norm, u8, mtime, true);
        }
      }

      try {
        const basePath = msg.basePath || '/sysroot/wasm';
        busyboxModule = await loadBusyboxBinary(basePath);
        isInitialized = true;
      } catch (err) {
        if (options.onLoadError) {
          options.onLoadError(err);
        } else {
          console.warn('Failed to load busybox binary:', err);
        }
      }

      if (typeof options.welcomeBanner === 'function') {
        options.welcomeBanner({ write, writeln });
      } else if (typeof options.welcomeBanner === 'string' && options.welcomeBanner.length > 0) {
        write(options.welcomeBanner);
      } else if (msg.welcomeBanner) {
        write(msg.welcomeBanner);
      }
      showPrompt();
      return;
    }

    if (msg.type === 'term_resize') {
      if (msg.rows) termRows = msg.rows;
      if (msg.cols) termCols = msg.cols;
      return;
    }

    if (msg.type === 'input') {
      const inputData = msg.data;
      if (inputData.length > 1 && (inputData.includes('\r') || inputData.includes('\n'))) {
        let i = 0;
        while (i < inputData.length) {
          if (inputData[i] === '\x1b') {
            let j = i + 1;
            while (j < inputData.length && !/[a-zA-Z~]/.test(inputData[j])) {
              j++;
            }
            if (j < inputData.length) j++;
            await handleKey(inputData.substring(i, j));
            i = j;
          } else {
            await handleKey(inputData[i]);
            i++;
          }
        }
      } else {
        await handleKey(inputData);
      }
      return;
    }

    if (msg.type === 'file_changed') {
      const norm = normalizePath(msg.path);
      const u8 =
        typeof msg.content === 'string'
          ? new TextEncoder().encode(msg.content)
          : msg.content instanceof Uint8Array
            ? msg.content
            : new Uint8Array(msg.content);
      vfs.writeFile(norm, u8, msg.mtime || Date.now(), true);
      return;
    }

    if (msg.type === 'dir_created') {
      const norm = normalizePath(msg.path);
      try {
        vfs.mkdir(norm, true, true);
      } catch (_) {}
      return;
    }

    if (msg.type === 'file_deleted') {
      const norm = normalizePath(msg.path);
      if (vfs.exists(norm)) {
        try {
          vfs.remove(norm, true, true);
        } catch (_) {}
      }
      return;
    }

    if (msg.type === 'interrupt') {
      multiLineBuffer = [];
      if (isExecuting) {
        isExecuting = false;
        postMsg({ type: 'command_done' });
        writeln('\r\n\x1b[31m[Process interrupted]\x1b[0m');
        showPrompt();
      } else {
        writeln('^C');
        showPrompt();
      }
    }
  }

  return {
    onmessage,
    executeCommandLine,
    handleKey,
    getVfs: () => vfs,
    getCwd: () => cwd,
    getEnv: () => ({ ...shellEnviron }),
    isInitialized: () => isInitialized,
  };
}

export function attachShellWorker(options = {}) {
  const target = options.selfObj || globalThis.self || globalThis;
  const handler = createShellWorkerHandler({
    ...options,
    postMessage: options.postMessage || ((data, transfer) => target.postMessage(data, transfer)),
  });
  target.onmessage = handler.onmessage;
  return handler;
}
