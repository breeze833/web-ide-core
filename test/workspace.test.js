import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createWorkspaceStorage } from '../src/workspace/storage.js';
import { exportWorkspaceZip, importWorkspaceZip } from '../src/workspace/archive.js';
import { createMemoryVFS, createMockIndexedDB } from './helpers/mocks.js';

describe('Workspace Storage & Zip Archive', () => {
  it('persists and restores files cleanly using isolated dbName and empty neutral default seeding', async () => {
    const indexedDB = createMockIndexedDB();
    const storage = createWorkspaceStorage({
      dbName: 'test_ide_db_1',
      storeName: 'files',
      rootPath: '/proj',
      indexedDB,
    });

    const vfs1 = createMemoryVFS('/proj');
    // Fresh DB with empty defaultFiles creates ONLY the root directory (zero C templates!)
    const restoredFirst = await storage.loadWorkspace(vfs1);
    assert.equal(restoredFirst, false);
    assert.deepEqual(vfs1.readDir('/proj'), []);

    vfs1.writeFile('/proj/main.py', 'print("saved")\n');
    await storage.saveWorkspace(vfs1);

    // Reload into fresh VFS instance
    const vfs2 = createMemoryVFS('/proj');
    const restoredSecond = await storage.loadWorkspace(vfs2);
    assert.equal(restoredSecond, true);
    assert.equal(vfs2.readFile('/proj/main.py'), 'print("saved")\n');
  });

  it('seeds caller-supplied defaultFiles when DB is initially empty', async () => {
    const indexedDB = createMockIndexedDB();
    const storage = createWorkspaceStorage({
      dbName: 'test_ide_db_2',
      rootPath: '/workspace',
      indexedDB,
    });

    const vfs = createMemoryVFS('/workspace');
    await storage.loadWorkspace(vfs, {
      'src/app.js': 'export const ok = true;\n',
      emptyDir: null,
    });

    assert.equal(vfs.readFile('/workspace/src/app.js'), 'export const ok = true;\n');
    assert.equal(vfs.exists('/workspace/emptyDir'), true);
  });

  it('exports and imports workspace archives while blocking .. traversal entries', async () => {
    const vfs = createMemoryVFS('/custom');
    vfs.writeFile('/custom/hello.txt', 'world');
    vfs.writeFile('/custom/nested/mod.py', 'x = 1');

    const zipBytes = await exportWorkspaceZip(vfs, 'out.zip', {
      rootPath: '/custom',
      type: 'uint8array',
      download: false,
    });

    const zip = await JSZip.loadAsync(zipBytes);
    zip.file('../../etc/passwd', 'evil');
    const mutatedZip = await zip.generateAsync({ type: 'uint8array' });

    const vfsDest = createMemoryVFS('/custom');
    let onSaveCalled = 0;
    await importWorkspaceZip(vfsDest, mutatedZip, true, {
      rootPath: '/custom',
      onSave: () => {
        onSaveCalled++;
      },
    });

    assert.equal(onSaveCalled, 1);
    assert.equal(vfsDest.readFile('/custom/hello.txt'), 'world');
    assert.equal(vfsDest.readFile('/custom/nested/mod.py'), 'x = 1');
    assert.equal(vfsDest.exists('/etc/passwd'), false);
  });
});
