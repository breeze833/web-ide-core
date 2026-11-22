// Tab bar component rendering open file tabs and dirty markers

export class TabsUI {
  constructor(containerElement, editorManager, options = {}) {
    this.container = containerElement;
    this.editorManager = editorManager;
    this.showDirtyMarker = options.showDirtyMarker !== false;
    this.onTabSelect = typeof options.onTabSelect === 'function' ? options.onTabSelect : null;
    this.onTabClose = typeof options.onTabClose === 'function' ? options.onTabClose : null;
  }

  render() {
    this.container.innerHTML = '';
    const openFiles = this.editorManager.getOpenFiles();
    const activePath = this.editorManager.getActivePath();

    for (const path of openFiles) {
      const isDirty = this.editorManager.isDirty(path);
      const isActive = path === activePath;
      const fileName = path.split('/').pop();

      const tab = document.createElement('div');
      tab.className = `tab-item ${isActive ? 'active' : ''}`.trim();
      tab.title = path;

      const titleSpan = document.createElement('span');
      titleSpan.textContent = fileName;
      tab.appendChild(titleSpan);

      if (this.showDirtyMarker && isDirty) {
        const dirtyMarker = document.createElement('span');
        dirtyMarker.className = 'tab-dirty-marker';
        dirtyMarker.title = 'Unsaved changes';
        tab.appendChild(dirtyMarker);
      }

      const closeBtn = document.createElement('span');
      closeBtn.className = 'tab-close-btn';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Close tab';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.editorManager.closeFile(path);
        this.render();
        if (this.onTabClose) this.onTabClose(path);
      });
      tab.appendChild(closeBtn);

      tab.addEventListener('click', () => {
        if (!isActive) {
          this.editorManager.setActiveFile(path);
          this.render();
          if (this.onTabSelect) this.onTabSelect(path);
        }
      });

      this.container.appendChild(tab);
    }
  }
}
