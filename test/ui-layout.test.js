import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FileTreeUI } from '../src/ui/filetree.js';
import { showToast, createToastManager } from '../src/ui/toast.js';
import { LayoutManager } from '../src/layout/layout.js';
import { TerminalManager } from '../src/terminal/terminal.js';
import {
  createMemoryVFS,
  createMockDOM,
  createMockElement,
  createMockLocalStorage,
  createMockXterm,
} from './helpers/mocks.js';

describe('FileTreeUI, Toast, and LayoutManager', () => {
  let prevDoc;
  let prevWin;
  let prevLS;

  beforeEach(() => {
    prevDoc = globalThis.document;
    prevWin = globalThis.window;
    prevLS = globalThis.localStorage;
    const { doc, win } = createMockDOM();
    globalThis.document = doc;
    globalThis.window = win;
    globalThis.localStorage = createMockLocalStorage();
  });

  afterEach(() => {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.localStorage = prevLS;
  });

  it('renders FileTreeUI with custom rootPath, handles VFS updates and file selection', () => {
    const vfs = createMemoryVFS('/project');
    vfs.mkdir('/project/sub');
    vfs.writeFile('/project/sub/hello.py', 'print("hi")');
    vfs.writeFile('/project/README.md', '# Hi');

    const selected = [];
    const container = createMockElement('div');
    const tree = new FileTreeUI(container, vfs, {
      rootPath: '/project',
      expandedDirs: ['/project', '/project/sub'],
      onSelectFile: (p) => selected.push(p),
    });

    tree.render();
    const rows = container.querySelectorAll('.tree-item-row');
    assert.equal(rows.length, 3); // sub/, hello.py, README.md

    rows[1].click();
    assert.deepEqual(selected, ['/project/sub/hello.py']);

    // Mutate VFS externally -> auto-rerender
    vfs.writeFile('/project/extra.txt', 'hello');
    assert.equal(container.querySelectorAll('.tree-item-row').length, 4);
    tree.dispose();
  });

  it('creates toasts inside custom container via showToast and createToastManager', () => {
    const toastBox = createMockElement('div', { id: 'toast-container' });
    globalThis.document.body.appendChild(toastBox);

    showToast('Saved', 'success', 50);
    assert.equal(toastBox.children.length, 1);
    assert.ok(toastBox.children[0].classList.contains('toast-success'));

    const mgr = createToastManager(toastBox);
    mgr.showToast('Oops', 'error', 50);
    assert.equal(toastBox.children.length, 2);
  });

  it('manages collapsible sidebar, split resizer, and detached 80x24 terminal in LayoutManager', () => {
    const { Terminal, FitAddon } = createMockXterm();
    const termContainer = createMockElement('div');
    const terminal = new TerminalManager(termContainer, { Terminal, FitAddon });

    const sidebar = createMockElement('div', { clientWidth: 240 });
    const sidebarResizer = createMockElement('div');
    const btnSidebarToggle = createMockElement('button');
    const sidebarCollapsedStrip = createMockElement('div');
    const terminalSection = createMockElement('div', { clientHeight: 240 });
    const terminalHeader = createMockElement('div');
    const splitResizer = createMockElement('div');
    const btnTermDetach = createMockElement('button');
    const btnTermMin = createMockElement('button');
    const dimBadge = createMockElement('span');

    let layoutCalls = 0;
    const editorManager = { layout: () => { layoutCalls++; } };

    const layout = new LayoutManager({
      document: globalThis.document,
      window: globalThis.window,
      storagePrefix: 'app_test_',
      editorManager,
      terminalManager: terminal,
      elements: {
        sidebar,
        sidebarResizer,
        btnSidebarToggle,
        sidebarCollapsedStrip,
        terminalSection,
        terminalHeader,
        splitResizer,
        btnTermDetach,
        btnTermMin,
        dimBadge,
      },
    });

    assert.equal(layout.isSidebarCollapsed(), false);
    layout.toggleSidebar();
    assert.equal(layout.isSidebarCollapsed(), true);
    assert.ok(sidebar.classList.contains('collapsed'));
    assert.ok(sidebarResizer.classList.contains('hidden'));
    assert.equal(globalThis.localStorage.getItem('app_test_sidebar_collapsed'), 'true');

    // Expand again via Ctrl+B shortcut
    globalThis.window.dispatchEvent({ type: 'keydown', ctrlKey: true, key: 'b' });
    assert.equal(layout.isSidebarCollapsed(), false);
    assert.ok(!sidebar.classList.contains('collapsed'));

    // Detach terminal to 80x24
    layout.toggleTerminalDetach();
    assert.equal(layout.isTerminalDetached(), true);
    assert.ok(terminalSection.classList.contains('detached'));
    assert.ok(splitResizer.classList.contains('hidden'));
    assert.equal(dimBadge.textContent, '80x24');

    // Cycle preset via badge click -> next preset 80x25
    dimBadge.click();
    assert.equal(dimBadge.textContent, '80x25');

    // Dock back via Ctrl+Shift+D
    globalThis.window.dispatchEvent({ type: 'keydown', ctrlKey: true, shiftKey: true, key: 'D' });
    assert.equal(layout.isTerminalDetached(), false);
    assert.ok(!terminalSection.classList.contains('detached'));
    assert.ok(!splitResizer.classList.contains('hidden'));
    assert.ok(layoutCalls >= 4);

    layout.destroy();
    terminal.dispose();
  });
});
