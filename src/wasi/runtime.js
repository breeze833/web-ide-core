// Execution Runtime Host Manager
// Coordinates dedicated WASI worker with SharedArrayBuffer stdin, canvas input, and optional audio receiver

import { InputCoordinator } from 'canvas-wasi';
import { LineEditor } from 'ansi-line-editor';
import { StdinHost } from 'stdin-wasi/host';

function deleteFromVfs(vfs, path) {
  if (!vfs || !vfs.exists(path)) return;
  if (typeof vfs.unlink === 'function') {
    vfs.unlink(path);
  } else if (typeof vfs.remove === 'function') {
    vfs.remove(path);
  }
}

export class RuntimeManager {
  constructor(terminal, options = {}) {
    this.terminal = terminal;
    this.graphicsWindow = options.graphicsWindow || null;
    this.audioReceiver = options.audioReceiver || null;
    this.workerUrl = options.workerUrl || null;
    this.createWorker = typeof options.createWorker === 'function' ? options.createWorker : null;
    this.workspaceRoot = options.workspaceRoot || '/workspace';
    this.stdinBufferSize = Number.isFinite(options.stdinBufferSize) ? options.stdinBufferSize : 8192;
    this.inputBufferSize = Number.isFinite(options.inputBufferSize) ? options.inputBufferSize : 512;

    this.worker = null;
    this.isRunning = false;
    this.isWaitingForStdin = false;
    this.lineEditor = new LineEditor({
      write: (str) => this.terminal.write(str),
      historyContext: 'default',
    });
    this.currentResolve = null;
    this.currentReject = null;
    this.currentOptions = null;

    const canUseSAB =
      typeof SharedArrayBuffer !== 'undefined' &&
      (typeof window === 'undefined' || window.crossOriginIsolated);

    if (canUseSAB && options.crossOriginIsolated !== false) {
      this.stdinHost = new StdinHost({ bufferSize: this.stdinBufferSize });
      this.sharedBuffer = this.stdinHost.getSharedBuffer();
      this.sharedInt32 = this.stdinHost.sharedInt32;
      this.sharedUint8 = this.stdinHost.sharedUint8;

      this.inputSharedBuffer = new SharedArrayBuffer(this.inputBufferSize);
      this.raylibSharedBuffer = this.inputSharedBuffer;
      this.inputCoordinator = new InputCoordinator({
        sharedBuffer: this.inputSharedBuffer,
        width: options.width || 800,
        height: options.height || 450,
      });
    } else {
      this.stdinHost = null;
      this.sharedBuffer = null;
      this.sharedInt32 = null;
      this.sharedUint8 = null;
      this.inputSharedBuffer = null;
      this.raylibSharedBuffer = null;
      this.inputCoordinator = new InputCoordinator({
        sharedBuffer: null,
        width: options.width || 800,
        height: options.height || 450,
      });
    }

    if (this.graphicsWindow && typeof this.graphicsWindow.setInputCoordinator === 'function') {
      this.graphicsWindow.setInputCoordinator(this.inputCoordinator);
    }

    if (this.inputCoordinator) {
      this.inputCoordinator.addListener((event) => {
        if (this.worker && this.isRunning) {
          try {
            this.worker.postMessage({ type: 'input_event', event });
          } catch (_) {}
        }
      });
    }
  }

  _spawnWorker() {
    if (this.createWorker) {
      return this.createWorker();
    }
    if (this.workerUrl) {
      return new Worker(this.workerUrl, { type: 'module' });
    }
    throw new Error('RuntimeManager requires options.createWorker or options.workerUrl');
  }

  setGraphicsWindow(graphicsWindow) {
    this.graphicsWindow = graphicsWindow;
    if (this.inputCoordinator && this.graphicsWindow && typeof this.graphicsWindow.setInputCoordinator === 'function') {
      this.graphicsWindow.setInputCoordinator(this.inputCoordinator);
    }
  }

  get stdinLineBuffer() {
    return this.lineEditor ? this.lineEditor.getBuffer() : '';
  }

  set stdinLineBuffer(val) {
    if (this.lineEditor) {
      if (!val) {
        this.lineEditor.reset();
      } else {
        this.lineEditor.setBuffer(val);
      }
    }
  }

  runBinary(wasmBytes, argv = ['./a.out'], options = {}) {
    return new Promise((resolve, reject) => {
      if (this.isRunning) {
        this.kill();
      }

      this.currentResolve = resolve;
      this.currentReject = reject;
      this.currentOptions = options;

      this.isRunning = true;
      this.isWaitingForStdin = false;
      const progName = argv && argv[0] ? argv[0].split('/').pop().replace(/^\.\//, '') : 'default';
      this.lineEditor.setHistoryContext(progName || 'default');
      this.lineEditor.reset();
      let capturedStdout = '';

      if (this.stdinHost) {
        this.stdinHost.reset();
      }

      if (this.inputCoordinator) {
        this.inputCoordinator.reset();
      }
      if (this.inputSharedBuffer) {
        new Uint8Array(this.inputSharedBuffer).fill(0);
      }

      try {
        this.worker = this._spawnWorker();
      } catch (err) {
        this.currentResolve = null;
        this.currentReject = null;
        this.currentOptions = null;
        this.cleanUp();
        reject(err);
        return;
      }

      this.worker.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'stdout') {
          if (options.captureStdout) {
            capturedStdout += msg.data;
          }
          if (typeof options.onStdout === 'function') {
            options.onStdout(msg.data);
          } else if (!options.captureStdout) {
            this.terminal.write(msg.data.replace(/\r?\n/g, '\r\n'));
          }
        } else if (msg.type === 'stdin_request') {
          this.isWaitingForStdin = true;
        } else if (msg.type === 'graphics_init') {
          if (this.graphicsWindow) {
            this.graphicsWindow.open(msg.width, msg.height, msg.title);
          }
        } else if (msg.type === 'frame') {
          if (this.graphicsWindow) {
            this.graphicsWindow.renderFrame(msg.bitmap);
          }
        } else if (msg.type === 'frame_buffer') {
          if (this.graphicsWindow) {
            this.graphicsWindow.renderFrameBuffer(msg.buffer, msg.width, msg.height);
          }
        } else if (msg.type === 'fps') {
          if (this.graphicsWindow) {
            this.graphicsWindow.updateFPS(msg.fps);
          }
        } else if (msg.type === 'graphics_close') {
          if (this.graphicsWindow) {
            this.graphicsWindow.close();
          }
        } else if (msg.type && msg.type.startsWith('audio_')) {
          if (this.audioReceiver && typeof this.audioReceiver.handleMessage === 'function') {
            this.audioReceiver.handleMessage(msg);
          }
        } else if (msg.type === 'file_sync') {
          if (options.vfs && msg.path && msg.data !== undefined) {
            try {
              options.vfs.writeFile(msg.path, msg.data);
            } catch (_) {}
          }
        } else if (msg.type === 'file_delete') {
          if (options.vfs && msg.path) {
            try {
              deleteFromVfs(options.vfs, msg.path);
            } catch (_) {}
          }
        } else if (msg.type === 'done') {
          if (options.vfs) {
            if (msg.changedFiles) {
              for (const [path, data] of Object.entries(msg.changedFiles)) {
                try {
                  options.vfs.writeFile(path, data);
                } catch (_) {}
              }
            }
            if (Array.isArray(msg.deletedFiles)) {
              for (const path of msg.deletedFiles) {
                try {
                  deleteFromVfs(options.vfs, path);
                } catch (_) {}
              }
            }
          }
          const res = this.currentResolve;
          const opt = this.currentOptions;
          this.currentResolve = null;
          this.currentReject = null;
          this.currentOptions = null;
          this.cleanUp();
          if (res) {
            if (opt && opt.captureStdout) {
              res({ exitCode: msg.exitCode, stdout: capturedStdout });
            } else {
              res(msg.exitCode);
            }
          }
        } else if (msg.type === 'error') {
          const res = this.currentResolve;
          const opt = this.currentOptions;
          this.currentResolve = null;
          this.currentReject = null;
          this.currentOptions = null;
          this.cleanUp();
          this.terminal.writeln(`\r\n\x1b[31mRuntime Error: ${msg.error}\x1b[0m`);
          if (res) {
            if (opt && opt.captureStdout) {
              res({ exitCode: 1, stdout: capturedStdout });
            } else {
              res(1);
            }
          }
        }
      };

      this.worker.onerror = (err) => {
        const res = this.currentResolve;
        const opt = this.currentOptions;
        this.currentResolve = null;
        this.currentReject = null;
        this.currentOptions = null;
        this.cleanUp();
        this.terminal.writeln(`\r\n\x1b[31mRuntime Worker Error: ${err.message}\x1b[0m`);
        if (res) {
          if (opt && opt.captureStdout) {
            res({ exitCode: 1, stdout: capturedStdout });
          } else {
            res(1);
          }
        }
      };

      const stdinBytes = options.stdinBytes
        ? typeof options.stdinBytes === 'string'
          ? new TextEncoder().encode(options.stdinBytes)
          : options.stdinBytes
        : null;

      let filesSnapshot = options.files || {};
      if (options.vfs && Object.keys(filesSnapshot).length === 0) {
        filesSnapshot = {};
        const snapshotRoot = options.workspaceRoot || this.workspaceRoot;
        for (const f of options.vfs.getAllFiles(snapshotRoot)) {
          if (!f.isDir) {
            filesSnapshot[f.path] = options.vfs.readFile(f.path, false);
          }
        }
      }

      const sharedSysrootBuffer =
        options.vfs && options.vfs.sharedSysroot ? options.vfs.sharedSysroot.buffer : null;

      this.worker.postMessage({
        type: 'run',
        wasmBytes,
        sharedBuffer: this.sharedBuffer,
        inputSharedBuffer: this.inputSharedBuffer,
        raylibSharedBuffer: this.raylibSharedBuffer,
        sharedSysrootBuffer,
        argv,
        environ: options.environ || {},
        stdinBytes,
        files: filesSnapshot,
      });
    });
  }

  runProgram(wasmBytes, opts = {}) {
    const { argv = ['./a.out'], ...rest } = opts;
    return this.runBinary(wasmBytes, argv, rest);
  }

  handleTerminalInput(key) {
    if (!this.isRunning || !this.isWaitingForStdin) {
      return false;
    }

    if (key === '\x04') {
      const currentBuf = this.lineEditor.getBuffer();
      if (currentBuf.length > 0) {
        this.lineEditor.reset();
        if (this.stdinHost) {
          this.stdinHost.sendInput(currentBuf);
        }
        this.isWaitingForStdin = false;
        return true;
      }

      if (this.stdinHost) {
        this.stdinHost.sendEof();
      }
      this.isWaitingForStdin = false;
      return true;
    }

    if (key === '\r' || key === '\n') {
      this.terminal.writeln('');
      const lineText = this.lineEditor.getBuffer();
      this.lineEditor.commitHistory(lineText);
      this.lineEditor.reset();
      const lineWithNewline = lineText + '\n';

      if (this.stdinHost) {
        this.stdinHost.sendInput(lineWithNewline);
      }
      this.isWaitingForStdin = false;
      return true;
    }

    this.lineEditor.feed(key);
    return true;
  }

  kill() {
    if (!this.isRunning) return;

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.stdinHost) {
      this.stdinHost.sendEof();
    }

    if (this.graphicsWindow && typeof this.graphicsWindow.close === 'function') {
      this.graphicsWindow.close();
    }

    const res = this.currentResolve;
    const opt = this.currentOptions;
    this.currentResolve = null;
    this.currentReject = null;
    this.currentOptions = null;

    this.cleanUp();

    if (res) {
      if (opt && opt.captureStdout) {
        res({ exitCode: 130, stdout: '' });
      } else {
        res(130);
      }
    }
  }

  stop() {
    this.kill();
  }

  cleanUp() {
    this.isRunning = false;
    this.isWaitingForStdin = false;
    this.lineEditor.reset();
    if (this.inputCoordinator) {
      this.inputCoordinator.reset();
    }
    if (this.audioReceiver && typeof this.audioReceiver.handleMessage === 'function') {
      try {
        this.audioReceiver.handleMessage({ type: 'audio_close' });
      } catch (_) {}
    }
    if (this.graphicsWindow && typeof this.graphicsWindow.clearActivity === 'function') {
      this.graphicsWindow.clearActivity();
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  unlockAudio() {
    if (this.audioReceiver && typeof this.audioReceiver.resume === 'function') {
      return this.audioReceiver.resume();
    }
    return Promise.resolve();
  }
}
