// JSZip Import & Export routines for virtual workspaces

import JSZip from 'jszip';

function normalizeRoot(rootPath) {
  const clean = `/${String(rootPath || '/workspace').replace(/^\/+|\/+$/g, '')}`;
  return clean === '/' ? '/workspace' : clean;
}

export async function exportWorkspaceZip(vfs, filename = 'workspace.zip', options = {}) {
  const rootPath = normalizeRoot(options.rootPath || '/workspace');
  const rootPrefixRegex = new RegExp(`^${rootPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?`);
  const zip = new JSZip();
  const files = vfs.getAllFiles(rootPath);

  for (const file of files) {
    const relPath = file.path.replace(rootPrefixRegex, '');
    if (!relPath) continue;

    if (file.isDir) {
      zip.folder(relPath);
    } else {
      zip.file(relPath, file.content);
    }
  }

  const outputType = options.type || (typeof Blob !== 'undefined' ? 'blob' : 'uint8array');
  const data = await zip.generateAsync({ type: outputType, compression: 'DEFLATE' });

  if (options.download !== false && typeof document !== 'undefined' && typeof URL !== 'undefined') {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return data;
}

export async function importWorkspaceZip(vfs, fileBlob, clearExisting = false, options = {}) {
  const rootPath = normalizeRoot(options.rootPath || '/workspace');
  const zip = await JSZip.loadAsync(fileBlob);

  if (clearExisting && vfs.exists(rootPath)) {
    const existing = vfs.readDir(rootPath);
    for (const item of existing) {
      vfs.remove(`${rootPath}/${item.name}`, true);
    }
  }

  const entries = Object.keys(zip.files);
  for (const entryName of entries) {
    const entry = zip.files[entryName];
    const cleanRelPath = entryName.replace(/^(\/|\\)+/, '').replace(/\\/g, '/');
    const segments = cleanRelPath.split('/').filter(Boolean);
    if (segments.includes('..') || cleanRelPath.startsWith('/')) {
      console.warn(`Skipping potentially unsafe zip entry: ${entryName}`);
      continue;
    }

    const fullPath = `${rootPath}/${cleanRelPath}`.replace(/\/+$/, '');
    if (!fullPath || fullPath === rootPath) continue;

    if (entry.dir) {
      vfs.mkdir(fullPath, true);
    } else {
      const parts = fullPath.split('/');
      parts.pop();
      const parentDir = parts.join('/') || rootPath;
      vfs.mkdir(parentDir, true);

      const content = await entry.async('uint8array');
      vfs.writeFile(fullPath, content);
    }
  }

  if (typeof options.onSave === 'function') {
    await options.onSave(vfs);
  }
}
