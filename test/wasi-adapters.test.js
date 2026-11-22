import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createWasmCache,
  RuntimeManager,
  createShellWorkerHandler,
  runWasmBinary,
  findHeredocs,
  getPendingHeredocs,
  closePendingHeredocs,
  hasUnquotedShellOperators,
  tokenizeSimpleCommand,
} from '../src/wasi/index.js';
import { createMockIndexedDB } from './helpers/mocks.js';

// Minimal valid WebAssembly module calling env.host_ping() from _start()
function buildPingWasmModule() {
  // Hand-assembled valid Wasm binary:
  // Section 1 (Type): () -> ()
  // Section 2 (Import): env.host_ping : type 0
  // Section 3 (Function): [type 0]
  // Section 5 (Memory): 1 page
  // Section 7 (Export): memory (mem 0), _start (func 1)
  // Section 10 (Code): call 0; end
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    // Type section (id 1): 1 type: () -> ()
    0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
    // Import section (id 2): "env" "host_ping" func 0
    0x02, 0x11, 0x01,
    0x03, 0x65, 0x6e, 0x76,
    0x09, 0x68, 0x6f, 0x73, 0x74, 0x5f, 0x70, 0x69, 0x6e, 0x67,
    0x00, 0x00,
    // Function section (id 3): 1 func of type 0
    0x03, 0x02, 0x01, 0x00,
    // Memory section (id 5): 1 mem min 1
    0x05, 0x03, 0x01, 0x00, 0x01,
    // Export section (id 7): "memory" mem 0, "_start" func 1
    0x07, 0x13, 0x02,
    0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
    0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x01,
    // Code section (id 10): body: call 0; end
    0x0a, 0x06, 0x01, 0x04, 0x00, 0x10, 0x00, 0x0b,
  ]);
}

describe('Core backend-agnostic boundary & Optional WASI Adapters', () => {
  it('ensures core source files do not import any WASI or domain-specific packages', () => {
    const coreFiles = [
      'src/index.js',
      'src/editor/editor.js',
      'src/editor/monaco-setup.js',
      'src/editor/tabs.js',
      'src/terminal/terminal.js',
      'src/terminal/boot-progress.js',
      'src/ui/filetree.js',
      'src/ui/toast.js',
      'src/layout/layout.js',
      'src/workspace/storage.js',
      'src/workspace/archive.js',
    ];
    const forbidden = [
      'wasi-host',
      'vfs-wasi',
      'busybox-wasi',
      'stdin-wasi',
      'canvas-wasi',
      'ansi-line-editor',
      'raylib-wasi',
      'clang-wasi',
      'make-wasi',
      'sqlite-wasi',
    ];
    for (const rel of coreFiles) {
      const src = fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
      for (const pkg of forbidden) {
        assert.equal(src.includes(pkg), false, `${rel} must not reference ${pkg}`);
      }
    }
  });

  it('stores and retrieves WebAssembly modules via createWasmCache', async () => {
    const indexedDB = createMockIndexedDB();
    const cache = createWasmCache({ dbName: 'wasi_test_cache', indexedDB });
    const bytes = buildPingWasmModule();

    assert.equal(await cache.saveWasmModule('ping-v1', bytes), true);
    const mod = await cache.getWasmModule('ping-v1');
    assert.ok(mod instanceof WebAssembly.Module);
    assert.equal(await cache.deleteWasmModule('ping-v1'), true);
    assert.equal(await cache.getWasmModule('ping-v1'), null);
  });

  it('executes binaries in runWasmBinary and supports injected resolveCustomImports', async () => {
    const bytes = buildPingWasmModule();
    let pingCount = 0;

    const result = await runWasmBinary(
      bytes,
      { argv: ['./ping.wasm'] },
      {
        postMessage: () => {},
        resolveCustomImports: ({ importObject }) => {
          importObject.env = {
            host_ping() {
              pingCount++;
            },
          };
        },
      }
    );

    assert.equal(pingCount, 1);
    assert.ok(result.changedFiles instanceof Map);
  });

  it('routes RuntimeManager worker lifecycle, injected audioReceiver, and Ctrl-D stdin', async () => {
    const outputs = [];
    const fakeTerm = {
      write: (s) => outputs.push(s),
      writeln: (s) => outputs.push(s + '\r\n'),
    };
    const posted = [];
    const audioMsgs = [];
    let fakeWorker = null;

    const mgr = new RuntimeManager(fakeTerm, {
      audioReceiver: {
        handleMessage: (m) => audioMsgs.push(m),
      },
      createWorker: () => {
        fakeWorker = {
          onmessage: null,
          onerror: null,
          postMessage: (m) => posted.push(m),
          terminate: () => {},
        };
        return fakeWorker;
      },
    });

    const runPromise = mgr.runBinary(new Uint8Array([0, 97, 115, 109]), ['./demo']);
    assert.equal(mgr.isRunning, true);
    assert.equal(posted[0].type, 'run');

    fakeWorker.onmessage({ data: { type: 'stdin_request' } });
    assert.equal(mgr.handleTerminalInput('a'), true);
    assert.equal(mgr.handleTerminalInput('\x04'), true);

    fakeWorker.onmessage({ data: { type: 'stdout', data: 'ok\n' } });
    fakeWorker.onmessage({ data: { type: 'audio_init' } });
    fakeWorker.onmessage({ data: { type: 'done', exitCode: 0 } });

    const code = await runPromise;
    assert.equal(code, 0);
    assert.equal(audioMsgs[0].type, 'audio_init');
    assert.equal(audioMsgs[1].type, 'audio_close'); // cleaned up cleanly
    assert.ok(outputs.join('').includes('ok\r\n'));
  });

  it('handles configurable shell command hooks, heredocs, and quoting cleanly', async () => {
    assert.deepEqual(tokenizeSimpleCommand('echo "a b" c'), ['echo', 'a b', 'c']);
    assert.equal(hasUnquotedShellOperators('echo "hello | world"'), false);
    assert.equal(hasUnquotedShellOperators('echo a | cat'), true);

    const lines = ['cat << EOF', 'hello'];
    assert.equal(findHeredocs(lines[0])[0].delim, 'EOF');
    assert.equal(getPendingHeredocs(lines).length, 1);
    assert.equal(closePendingHeredocs(lines), 'cat << EOF\nhello\nEOF');

    const messages = [];
    const dispatched = [];
    const shell = createShellWorkerHandler({
      postMessage: (m) => messages.push(m),
      toolchainCommands: ['custom-cc'],
      onCommandDispatch: (payload) => {
        dispatched.push(payload);
        return 0;
      },
      extraBuiltins: {
        greet: (args, ctx) => {
          ctx.writeln(`hi ${args[0] || ''}`);
          return 0;
        },
      },
    });

    await shell.executeCommandLine('custom-cc main.c -o out');
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].cmd, 'custom-cc');
    assert.deepEqual(dispatched[0].args, ['main.c', '-o', 'out']);

    await shell.executeCommandLine('greet world');
    assert.ok(messages.some((m) => m.type === 'term_write' && m.data.includes('hi world')));
  });
});
