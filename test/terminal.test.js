import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalManager } from '../src/terminal/terminal.js';
import { BootProgress } from '../src/terminal/boot-progress.js';
import { createMockElement, createMockLocalStorage, createMockXterm } from './helpers/mocks.js';

describe('TerminalManager & BootProgress', () => {
  let prevLS;

  beforeEach(() => {
    prevLS = globalThis.localStorage;
    globalThis.localStorage = createMockLocalStorage();
  });

  afterEach(() => {
    globalThis.localStorage = prevLS;
  });

  it('manages font zoom persistence, grid sizing, injectCommand, and Ctrl-C interrupt', () => {
    const { Terminal, FitAddon } = createMockXterm();
    const container = createMockElement('div');
    const inputs = [];
    let interrupts = 0;

    const term = new TerminalManager(container, {
      Terminal,
      FitAddon,
      fontSizeStorageKey: 'custom_term_font',
      defaultFontSize: 15,
      onInput: (d) => inputs.push(d),
      onInterrupt: () => {
        interrupts++;
      },
    });

    assert.equal(term.getFontSize(), 15);
    assert.equal(term.zoomIn(3), 18);
    assert.equal(globalThis.localStorage.getItem('custom_term_font'), '18');
    assert.equal(term.setFontSize(99), 36);
    assert.equal(term.setFontSize(2), 9);
    assert.equal(term.resetFontSize(), 15);

    term.setFixedGrid(100, 30);
    assert.equal(term.fixedGrid, true);
    assert.deepEqual(term.getGridDimensions(), { cols: 100, rows: 30 });

    const box = term.computeContainerSizeForGrid(80, 24);
    assert.ok(box.width > 400 && box.height > 200);

    term.injectCommand('ls');
    assert.deepEqual(inputs, ['l', 's', '\r']);

    term.term.emitData('\x03');
    assert.equal(interrupts, 1);

    term.dispose();
  });

  it('formats BootProgress stages and uses configurable noticePrefix without C-specific copy', () => {
    const writes = [];
    const fakeTerm = { write: (s) => writes.push(s) };
    const boot = new BootProgress(fakeTerm, { noticePrefix: 'Setup notice' });

    boot.start('Loading runtime');
    boot.update(50, '1.2 MB');
    boot.completeCurrent('cached');
    boot.fail('offline fallback');
    boot.finish('Ready\r\n');

    const output = writes.join('');
    assert.ok(output.includes('Loading runtime'));
    assert.ok(output.includes('50%'));
    assert.ok(output.includes('cached'));
    assert.ok(output.includes('Setup notice: offline fallback'));
    assert.ok(!output.includes('Sysroot'));
    assert.ok(output.endsWith('Ready\r\n'));
  });
});
