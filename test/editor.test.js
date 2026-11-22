import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  EditorManager,
  DEFAULT_LANGUAGE_MAP,
  resolveLanguageForPath,
} from '../src/editor/editor.js';
import { TabsUI } from '../src/editor/tabs.js';
import {
  createMemoryVFS,
  createMockDOM,
  createMockElement,
  createMockLocalStorage,
  createMockMonaco,
} from './helpers/mocks.js';

describe('EditorManager & TabsUI', () => {
  let prevDoc;
  let prevLS;

  beforeEach(() => {
    prevDoc = globalThis.document;
    prevLS = globalThis.localStorage;
    const { doc } = createMockDOM();
    globalThis.document = doc;
    globalThis.localStorage = createMockLocalStorage();
  });

  afterEach(() => {
    globalThis.document = prevDoc;
    globalThis.localStorage = prevLS;
  });

  it('resolves languages across multiple ecosystems and supports custom overrides', () => {
    assert.equal(resolveLanguageForPath('/workspace/main.c'), 'c');
    assert.equal(resolveLanguageForPath('/workspace/app.py'), 'python');
    assert.equal(resolveLanguageForPath('/workspace/lib.rs'), 'rust');
    assert.equal(resolveLanguageForPath('/workspace/main.ts'), 'typescript');
    assert.equal(resolveLanguageForPath('/workspace/Makefile'), 'makefile');
    assert.equal(resolveLanguageForPath('/workspace/Dockerfile'), 'dockerfile');
    assert.equal(resolveLanguageForPath('/workspace/unknown.xyz'), 'plaintext');
    assert.equal(
      resolveLanguageForPath('/workspace/custom.dsl', {
        languageMap: { '.dsl': 'yaml' },
      }),
      'yaml'
    );
    assert.equal(
      resolveLanguageForPath('/workspace/special.txt', {
        languageResolver: (p) => (p.endsWith('special.txt') ? 'markdown' : null),
      }),
      'markdown'
    );
    assert.ok(DEFAULT_LANGUAGE_MAP['.py'] === 'python');
  });

  it('tracks open files, dirty state, save, close, custom zoom storage, and onToggleSidebar', () => {
    const vfs = createMemoryVFS();
    vfs.writeFile('/workspace/main.py', 'print(1)\n');
    vfs.writeFile('/workspace/app.js', 'console.log(2);\n');

    const dirtyEvents = [];
    let sidebarToggled = 0;
    const monaco = createMockMonaco();
    const container = createMockElement('div');

    const editor = new EditorManager(container, vfs, {
      monaco,
      fontSizeStorageKey: 'custom_ide_editor_font',
      defaultFontSize: 14,
      onDirtyChange: (path, dirty) => dirtyEvents.push([path, dirty]),
      onToggleSidebar: () => {
        sidebarToggled++;
      },
    });

    assert.equal(editor.getFontSize(), 14);
    assert.equal(editor.setFontSize(50), 36);
    assert.equal(editor.setFontSize(4), 9);
    assert.equal(editor.resetFontSize(), 14);
    assert.equal(globalThis.localStorage.getItem('custom_ide_editor_font'), '14');

    editor.openFile('/workspace/main.py');
    assert.equal(editor.getActivePath(), '/workspace/main.py');
    assert.deepEqual(editor.getOpenFiles(), ['/workspace/main.py']);

    const model = editor.openTabs.get('/workspace/main.py').model;
    assert.equal(model.language, 'python');
    model.setValue('print(42)\n');
    assert.equal(editor.isDirty('/workspace/main.py'), true);
    assert.equal(editor.hasAnyDirtyFiles(), true);

    editor.saveActiveFile();
    assert.equal(editor.isDirty('/workspace/main.py'), false);
    assert.equal(vfs.readFile('/workspace/main.py'), 'print(42)\n');
    assert.deepEqual(dirtyEvents, [
      ['/workspace/main.py', true],
      ['/workspace/main.py', false],
    ]);

    // Trigger Ctrl+B via mock command registry
    editor.editor._triggerCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB);
    assert.equal(sidebarToggled, 1);

    editor.openFile('/workspace/app.js');
    const tabsContainer = createMockElement('div');
    const tabsUI = new TabsUI(tabsContainer, editor);
    tabsUI.render();
    assert.equal(tabsContainer.children.length, 2);
    assert.ok(tabsContainer.children[1].classList.contains('active'));

    // Close active tab via close button
    const closeBtn = tabsContainer.children[1].querySelector('.tab-close-btn');
    closeBtn.click();
    assert.deepEqual(editor.getOpenFiles(), ['/workspace/main.py']);
    assert.equal(editor.getActivePath(), '/workspace/main.py');
  });
});
