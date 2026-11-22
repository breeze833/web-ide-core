// Workspace File Tree Component

import { exportWorkspaceZip, importWorkspaceZip } from '../workspace/archive.js';

function normalizeRoot(rootPath) {
  const clean = `/${String(rootPath || '/workspace').replace(/^\/+|\/+$/g, '')}`;
  return clean === '/' ? '/workspace' : clean;
}

export class FileTreeUI {
  constructor(containerElement, vfs, optionsOrOnSelectFile = () => {}) {
    const opts =
      typeof optionsOrOnSelectFile === 'function'
        ? { onSelectFile: optionsOrOnSelectFile }
        : (optionsOrOnSelectFile || {});

    this.container = containerElement;
    this.vfs = vfs;
    this.rootPath = normalizeRoot(opts.rootPath || '/workspace');
    this.onSelectFile = typeof opts.onSelectFile === 'function' ? opts.onSelectFile : () => {};
    this.confirmDelete =
      typeof opts.confirmDelete === 'function'
        ? opts.confirmDelete
        : (msg) => (typeof globalThis.confirm === 'function' ? globalThis.confirm(msg) : true);
    this.promptName =
      typeof opts.promptName === 'function'
        ? opts.promptName
        : (msg, def = '') => (typeof globalThis.prompt === 'function' ? globalThis.prompt(msg, def) : null);
    this.onError =
      typeof opts.onError === 'function'
        ? opts.onError
        : (msg) => {
            if (typeof globalThis.alert === 'function') globalThis.alert(msg);
          };
    this.onSaveWorkspace = typeof opts.onSave === 'function' ? opts.onSave : null;
    this.zipFilename = opts.zipFilename || 'workspace.zip';
    this.selectedPath = null;

    const initialExpanded = Array.isArray(opts.expandedDirs) ? opts.expandedDirs : [this.rootPath];
    this.expandedDirs = new Set(initialExpanded);

    this._unsubscribe =
      typeof this.vfs.subscribe === 'function'
        ? this.vfs.subscribe(() => {
            this.render();
          })
        : null;
  }

  setSelectedPath(path) {
    this.selectedPath = path;
    this.render();
  }

  expandDir(dirPath) {
    this.expandedDirs.add(dirPath);
    this.render();
  }

  collapseDir(dirPath) {
    this.expandedDirs.delete(dirPath);
    this.render();
  }

  render() {
    this.container.innerHTML = '';
    const rootList = document.createElement('div');
    rootList.className = 'tree-root';

    this._renderDirectory(this.rootPath, rootList);
    this.container.appendChild(rootList);
  }

  _renderDirectory(dirPath, parentElement) {
    let items = [];
    try {
      items = this.vfs.readDir(dirPath);
    } catch {
      return;
    }

    for (const item of items) {
      const itemPath = `${dirPath}/${item.name}`;
      const itemRow = document.createElement('div');
      itemRow.className = `tree-item ${item.isDir ? 'tree-dir' : 'tree-file'}`;

      const rowHeader = document.createElement('div');
      rowHeader.className = `tree-item-row${this.selectedPath === itemPath ? ' selected' : ''}`;

      if (item.isDir) {
        const isExpanded = this.expandedDirs.has(itemPath);

        const toggleDir = (e) => {
          e.stopPropagation();
          if (isExpanded) {
            this.expandedDirs.delete(itemPath);
          } else {
            this.expandedDirs.add(itemPath);
          }
          this.render();
        };

        const iconSpan = document.createElement('span');
        iconSpan.className = 'tree-icon';
        iconSpan.textContent = isExpanded ? '▾' : '▸';
        iconSpan.addEventListener('click', toggleDir);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'tree-label';
        labelSpan.textContent = `${item.name}/`;
        labelSpan.addEventListener('click', toggleDir);

        const actionsSpan = document.createElement('span');
        actionsSpan.className = 'tree-item-actions';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'tree-action-btn delete-btn';
        deleteBtn.title = 'Delete folder';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmed = await this.confirmDelete(`Delete folder ${itemPath}?`, itemPath, true);
          if (confirmed) {
            try {
              this.vfs.remove(itemPath, true);
            } catch (err) {
              this.onError(err.message, err);
            }
          }
        });

        actionsSpan.appendChild(deleteBtn);
        rowHeader.appendChild(iconSpan);
        rowHeader.appendChild(labelSpan);
        rowHeader.appendChild(actionsSpan);
        itemRow.appendChild(rowHeader);

        if (isExpanded) {
          const childrenContainer = document.createElement('div');
          childrenContainer.className = 'tree-children';
          this._renderDirectory(itemPath, childrenContainer);
          itemRow.appendChild(childrenContainer);
        }
      } else {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'tree-icon-file';
        iconSpan.textContent = '📄';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'tree-label';
        labelSpan.textContent = item.name;

        const actionsSpan = document.createElement('span');
        actionsSpan.className = 'tree-item-actions';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'tree-action-btn delete-btn';
        deleteBtn.title = 'Delete file';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmed = await this.confirmDelete(`Delete file ${itemPath}?`, itemPath, false);
          if (confirmed) {
            try {
              this.vfs.remove(itemPath);
            } catch (err) {
              this.onError(err.message, err);
            }
          }
        });

        actionsSpan.appendChild(deleteBtn);
        rowHeader.appendChild(iconSpan);
        rowHeader.appendChild(labelSpan);
        rowHeader.appendChild(actionsSpan);

        rowHeader.addEventListener('click', () => {
          this.selectedPath = itemPath;
          this.onSelectFile(itemPath);
        });

        itemRow.appendChild(rowHeader);
      }

      parentElement.appendChild(itemRow);
    }
  }

  attachToolbarButtons({ btnNewFile, btnNewFolder, btnExportZip, btnImportZip } = {}) {
    if (btnNewFile) {
      btnNewFile.addEventListener('click', async () => {
        const relPath = await this.promptName('Enter new file path:');
        if (!relPath) return;
        const fullPath = `${this.rootPath}/${relPath.replace(/^\/+/, '')}`;
        if (this.vfs.exists(fullPath)) {
          this.onError('File already exists!');
          return;
        }
        try {
          const parts = fullPath.split('/');
          parts.pop();
          const parentDir = parts.join('/');
          if (parentDir && parentDir !== this.rootPath) {
            this.vfs.mkdir(parentDir, true);
          }
          this.vfs.writeFile(fullPath, '');
          this.onSelectFile(fullPath);
        } catch (err) {
          this.onError(err.message, err);
        }
      });
    }

    if (btnNewFolder) {
      btnNewFolder.addEventListener('click', async () => {
        const folderName = await this.promptName('Enter new folder name:');
        if (!folderName) return;
        const fullPath = `${this.rootPath}/${folderName.replace(/^\/+/, '')}`;
        try {
          this.vfs.mkdir(fullPath, true);
          this.expandedDirs.add(fullPath);
          this.render();
        } catch (err) {
          this.onError(err.message, err);
        }
      });
    }

    if (btnExportZip) {
      btnExportZip.addEventListener('click', () => {
        exportWorkspaceZip(this.vfs, this.zipFilename, { rootPath: this.rootPath }).catch((err) =>
          this.onError(`Export failed: ${err.message}`, err)
        );
      });
    }

    if (btnImportZip && typeof document !== 'undefined') {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.zip';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const confirmed = await this.confirmDelete(
          `Import zip into ${this.rootPath}? This will merge with existing files.`,
          this.rootPath,
          true
        );
        if (confirmed) {
          try {
            await importWorkspaceZip(this.vfs, file, false, {
              rootPath: this.rootPath,
              onSave: this.onSaveWorkspace,
            });
            this.render();
          } catch (err) {
            this.onError(`Import error: ${err.message}`, err);
          }
        }
        fileInput.value = '';
      });

      btnImportZip.addEventListener('click', () => {
        fileInput.click();
      });
    }
  }

  dispose() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }
}
