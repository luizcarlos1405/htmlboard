// HtmlBoard Canvas & Explorer Engine
class HtmlBoardExplorer {
  constructor() {
    this.manifest = null;
    this.artboards = [];
    this.currentCategory = 'all';
    this.searchQuery = '';
    this.activeArtboardId = null;

    // Canvas Transform State
    this.panX = 80;
    this.panY = 80;
    this.scale = 0.85;
    this.minScale = 0.05;
    this.maxScale = 3.0;

    // Interaction State
    this.isPanning = false;
    this.isSpaceDown = false;
    this.startX = 0;
    this.startY = 0;
    this.initialPanX = 0;
    this.initialPanY = 0;

    this.cacheBustCounter = 1;
    this.eventSource = null;

    this.initDOMElements();
    this.attachEventListeners();
    this.connectLiveReload();
    this.loadManifest();
  }

  initDOMElements() {
    this.viewport = document.getElementById('canvas-viewport');
    this.stage = document.getElementById('canvas-stage');
    this.content = document.getElementById('canvas-content');
    this.grid = document.getElementById('canvas-grid');
    this.shield = document.getElementById('pointer-shield');
    this.sidebar = document.getElementById('sidebar');
    this.sidebarTree = document.getElementById('sidebar-tree');
    this.artboardCountEl = document.getElementById('artboard-count');
    this.projectTitleEl = document.getElementById('project-title');
    this.zoomLevelEl = document.getElementById('zoom-level');
    this.hudCoordsEl = document.getElementById('hud-coordinates');
    this.liveIndicator = document.getElementById('live-indicator');
    this.shortcutsModal = document.getElementById('shortcuts-modal');
    this.searchInput = document.getElementById('search-input');
    this.filterTabs = document.getElementById('filter-tabs');

    this.btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    this.btnZoomIn = document.getElementById('btn-zoom-in');
    this.btnZoomOut = document.getElementById('btn-zoom-out');
    this.btnZoomFit = document.getElementById('btn-zoom-fit');
    this.btnShortcuts = document.getElementById('btn-shortcuts');
    this.btnCloseModal = document.getElementById('btn-close-modal');
  }

  attachEventListeners() {
    // Window Resize
    window.addEventListener('resize', () => this.updateHUD());

    // Sidebar Toggle
    this.btnToggleSidebar.addEventListener('click', () => {
      this.sidebar.classList.toggle('collapsed');
    });

    // Zoom Buttons
    this.btnZoomIn.addEventListener('click', () => this.zoomRelative(1.2));
    this.btnZoomOut.addEventListener('click', () => this.zoomRelative(0.8));
    this.btnZoomFit.addEventListener('click', () => this.fitAll());
    this.zoomLevelEl.addEventListener('click', () => this.setZoom(1.0));

    // Shortcuts Modal
    this.btnShortcuts.addEventListener('click', () => this.openShortcutsModal());
    this.btnCloseModal.addEventListener('click', () => this.closeShortcutsModal());
    this.shortcutsModal.addEventListener('click', (e) => {
      if (e.target === this.shortcutsModal) this.closeShortcutsModal();
    });

    // Category Filter Tabs
    this.filterTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.filter-tab');
      if (!tab) return;
      this.filterTabs.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      this.currentCategory = tab.dataset.category;
      this.renderCanvas();
      this.renderSidebar();
    });

    // Search Input
    this.searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.renderCanvas();
      this.renderSidebar();
    });

    // Canvas Pan & Zoom Mouse Events
    this.viewport.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
    this.viewport.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  // --- Canvas Navigation ---

  applyTransform() {
    this.stage.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    this.zoomLevelEl.textContent = `${Math.round(this.scale * 100)}%`;
    this.updateHUD();
  }

  updateHUD() {
    if (this.hudCoordsEl) {
      this.hudCoordsEl.textContent = `X: ${Math.round(this.panX)} Y: ${Math.round(this.panY)}`;
    }
  }

  zoomRelative(factor, focalX = null, focalY = null) {
    const rect = this.viewport.getBoundingClientRect();
    const cx = focalX !== null ? focalX - rect.left : rect.width / 2;
    const cy = focalY !== null ? focalY - rect.top : rect.height / 2;

    const oldScale = this.scale;
    let newScale = oldScale * factor;
    newScale = Math.min(Math.max(newScale, this.minScale), this.maxScale);

    if (newScale === oldScale) return;

    const ratio = newScale / oldScale;
    this.panX = cx - ratio * (cx - this.panX);
    this.panY = cy - ratio * (cy - this.panY);
    this.scale = newScale;

    this.applyTransform();
  }

  setZoom(targetScale) {
    const rect = this.viewport.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const ratio = targetScale / this.scale;

    this.panX = cx - ratio * (cx - this.panX);
    this.panY = cy - ratio * (cy - this.panY);
    this.scale = targetScale;

    this.applyTransform();
  }

  fitAll() {
    const visibleCards = this.content.querySelectorAll('.artboard-frame');
    if (!visibleCards || visibleCards.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const viewportRect = this.viewport.getBoundingClientRect();

    visibleCards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      // Calculate coordinates relative to unscaled canvas content (the pan is relative to the viewport)
      const cardX = (rect.left - viewportRect.left - this.panX) / this.scale;
      const cardY = (rect.top - viewportRect.top - this.panY) / this.scale;
      const cardW = rect.width / this.scale;
      const cardH = rect.height / this.scale;

      if (cardX < minX) minX = cardX;
      if (cardY < minY) minY = cardY;
      if (cardX + cardW > maxX) maxX = cardX + cardW;
      if (cardY + cardH > maxY) maxY = cardY + cardH;
    });

    if (minX === Infinity) return;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    const padding = 80;
    const availWidth = viewportRect.width - padding * 2;
    const availHeight = viewportRect.height - padding * 2;

    const scaleX = availWidth / contentWidth;
    const scaleY = availHeight / contentHeight;
    let fitScale = Math.min(scaleX, scaleY, 1.0);
    fitScale = Math.max(fitScale, this.minScale);

    this.scale = fitScale;
    this.panX = (viewportRect.width - contentWidth * this.scale) / 2 - minX * this.scale;
    this.panY = (viewportRect.height - contentHeight * this.scale) / 2 - minY * this.scale;

    this.applyTransform();
  }

  focusArtboard(artboardId) {
    this.activeArtboardId = artboardId;
    const frame = document.getElementById(`frame-${artboardId}`);
    if (!frame) return;

    // Highlight active card
    document.querySelectorAll('.artboard-frame').forEach((f) => f.classList.remove('focused'));
    frame.classList.add('focused');

    document.querySelectorAll('.sidebar-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.id === artboardId);
    });

    // Frame position in unscaled canvas coordinates (the pan is relative to the viewport, not the page)
    const viewportRect = this.viewport.getBoundingClientRect();
    const rect = frame.getBoundingClientRect();
    const frameContentX = (rect.left - viewportRect.left - this.panX) / this.scale;
    const frameContentY = (rect.top - viewportRect.top - this.panY) / this.scale;
    const frameW = rect.width / this.scale;
    const frameH = rect.height / this.scale;

    const targetScale = Math.min(Math.max((viewportRect.height * 0.8) / frameH, 0.4), 1.0);

    this.scale = targetScale;
    this.panX = viewportRect.width / 2 - (frameContentX + frameW / 2) * this.scale;
    this.panY = viewportRect.height / 2 - (frameContentY + frameH / 2) * this.scale;

    this.applyTransform();
  }

  // --- Mouse & Pan Handlers ---

  onMouseDown(e) {
    // If clicking a button, input or link, do not pan
    if (e.target.closest('button, input, a, .filter-tab')) return;

    // Middle click, Space key down, or clicking on background / shield
    if (e.button === 1 || this.isSpaceDown || e.target === this.viewport || e.target === this.grid || e.target === this.shield || e.target === this.content) {
      this.isPanning = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.initialPanX = this.panX;
      this.initialPanY = this.panY;
      this.viewport.classList.add('panning');
      this.shield.classList.add('active');
      e.preventDefault();
    }
  }

  onMouseMove(e) {
    if (!this.isPanning) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    this.panX = this.initialPanX + dx;
    this.panY = this.initialPanY + dy;
    this.applyTransform();
  }

  onMouseUp() {
    if (this.isPanning) {
      this.isPanning = false;
      this.viewport.classList.remove('panning');
      if (!this.isSpaceDown) {
        this.shield.classList.remove('active');
      }
    }
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom centered at mouse position
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      this.zoomRelative(zoomFactor, e.clientX, e.clientY);
    } else {
      // Pan canvas
      this.panX -= e.deltaX;
      this.panY -= e.deltaY;
      this.applyTransform();
    }
  }

  // --- Keyboard Shortcuts ---

  onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        e.target.blur();
      }
      return;
    }

    if (e.code === 'Space' && !this.isSpaceDown) {
      this.isSpaceDown = true;
      this.shield.classList.add('active');
    } else if (e.key === '=' || e.key === '+') {
      this.zoomRelative(1.15);
    } else if (e.key === '-') {
      this.zoomRelative(0.85);
    } else if (e.key === '0') {
      this.setZoom(1.0);
    } else if (e.key === 'f' || e.key === 'F') {
      this.fitAll();
    } else if (e.key === '/') {
      e.preventDefault();
      this.searchInput.focus();
    } else if (e.key === '[' || e.key === ']') {
      this.sidebar.classList.toggle('collapsed');
    } else if (e.key === '?') {
      this.openShortcutsModal();
    } else if (e.key === 'Escape') {
      this.closeShortcutsModal();
    } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
      const tabs = this.filterTabs.querySelectorAll('.filter-tab');
      const idx = parseInt(e.key, 10) - 1;
      if (tabs[idx]) tabs[idx].click();
    }
  }

  onKeyUp(e) {
    if (e.code === 'Space') {
      this.isSpaceDown = false;
      if (!this.isPanning) {
        this.shield.classList.remove('active');
      }
    }
  }

  openShortcutsModal() {
    this.shortcutsModal.classList.add('open');
  }

  closeShortcutsModal() {
    this.shortcutsModal.classList.remove('open');
  }

  // --- Data Loading & Rendering ---

  async loadManifest() {
    try {
      const res = await fetch('/api/designs');
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      this.manifest = await res.json();

      this.projectTitleEl.textContent = this.manifest.title || 'Design Explorer';

      // Flatten artboards
      this.artboards = [];
      if (Array.isArray(this.manifest.sections)) {
        for (const section of this.manifest.sections) {
          if (Array.isArray(section.artboards)) {
            for (const board of section.artboards) {
              this.artboards.push({
                ...board,
                sectionId: section.id,
                sectionName: section.name
              });
            }
          }
        }
      }

      this.renderSidebar();
      this.renderCanvas();

      // Fit after the first layout only, so a rebuild keeps the user's pan and zoom
      if (!this.hasFitted) {
        this.hasFitted = true;
        setTimeout(() => this.fitAll(), 150);
      }
    } catch (err) {
      console.error('Failed loading designs manifest:', err);
      this.projectTitleEl.textContent = 'Error loading designs';
    }
  }

  getFilteredSections() {
    if (!this.manifest || !Array.isArray(this.manifest.sections)) return [];

    return this.manifest.sections.map((section) => {
      const filteredBoards = (section.artboards || []).filter((board) => {
        // Category filter
        if (this.currentCategory !== 'all') {
          const cat = (board.category || 'responsive').toLowerCase();
          if (cat !== this.currentCategory) return false;
        }

        // Search query filter
        if (this.searchQuery) {
          const matchTitle = (board.title || '').toLowerCase().includes(this.searchQuery);
          const matchFile = (board.file || '').toLowerCase().includes(this.searchQuery);
          const matchDesc = (board.description || '').toLowerCase().includes(this.searchQuery);
          const matchTags = (board.tags || []).some((t) => t.toLowerCase().includes(this.searchQuery));
          if (!matchTitle && !matchFile && !matchDesc && !matchTags) return false;
        }

        return true;
      });

      return {
        ...section,
        artboards: filteredBoards
      };
    }).filter((section) => section.artboards.length > 0);
  }

  renderSidebar() {
    const sections = this.getFilteredSections();
    let totalCount = 0;
    this.sidebarTree.innerHTML = '';

    for (const section of sections) {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'sidebar-section';

      const headerEl = document.createElement('div');
      headerEl.className = 'sidebar-section-title';
      headerEl.innerHTML = `
        <span>${escapeHtml(section.name)}</span>
        <span>${section.artboards.length}</span>
      `;
      sectionEl.appendChild(headerEl);

      const itemsEl = document.createElement('div');
      itemsEl.className = 'sidebar-items';

      for (const board of section.artboards) {
        totalCount++;
        const itemEl = document.createElement('div');
        itemEl.className = 'sidebar-item';
        itemEl.dataset.id = board.id;
        if (board.id === this.activeArtboardId) itemEl.classList.add('active');

        itemEl.innerHTML = `
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(board.title || board.id)}</span>
          <span class="sidebar-item-badge">${board.width || 'auto'}×${board.height || 'auto'}</span>
        `;

        itemEl.addEventListener('click', () => {
          this.focusArtboard(board.id);
        });

        itemsEl.appendChild(itemEl);
      }

      sectionEl.appendChild(itemsEl);
      this.sidebarTree.appendChild(sectionEl);
    }

    this.artboardCountEl.textContent = `${totalCount} artboard${totalCount === 1 ? '' : 's'}`;
  }

  renderCanvas() {
    const sections = this.getFilteredSections();
    this.content.innerHTML = '';

    if (sections.length === 0) {
      this.content.innerHTML = `
        <div style="padding: 100px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 12px;">🔍</div>
          <div style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">No Artboards Found</div>
          <div style="font-size: 13px;">Try adjusting your filter or search criteria, or add HTML files to the project directory.</div>
        </div>
      `;
      this.applyTransform();
      return;
    }

    for (const section of sections) {
      const sectionContainer = document.createElement('section');
      sectionContainer.className = 'canvas-section';
      sectionContainer.id = `section-${section.id}`;

      const secHeader = document.createElement('div');
      secHeader.className = 'canvas-section-header';
      secHeader.innerHTML = `
        <h2 class="canvas-section-title">${escapeHtml(section.name)}</h2>
        ${section.description ? `<p class="canvas-section-desc">${escapeHtml(section.description)}</p>` : ''}
      `;
      sectionContainer.appendChild(secHeader);

      const flow = document.createElement('div');
      flow.className = 'artboards-flow';

      for (const board of section.artboards) {
        const frame = this.createArtboardFrame(board);
        flow.appendChild(frame);
      }

      sectionContainer.appendChild(flow);
      this.content.appendChild(sectionContainer);
    }

    this.applyTransform();
  }

  createArtboardFrame(board) {
    const frame = document.createElement('div');
    frame.className = 'artboard-frame';
    frame.id = `frame-${board.id}`;

    const width = board.width || 1200;
    const height = board.height || 800;
    const category = board.category || 'responsive';

    const header = document.createElement('div');
    header.className = 'artboard-header';
    header.innerHTML = `
      <div class="artboard-title-group">
        <span class="artboard-badge badge-${category}">${category}</span>
        <span class="artboard-title" title="${escapeHtml(board.title)}">${escapeHtml(board.title)}</span>
      </div>
      <div class="artboard-actions">
        <span class="artboard-dimensions">${width} × ${height}</span>
        <button class="artboard-btn btn-reload-frame" title="Reload Artboard">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6"/>
            <path d="M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
        <a href="/${board.file}" target="_blank" rel="noopener" class="artboard-btn" title="Open Standalone in New Tab">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>
    `;

    const body = document.createElement('div');
    body.className = 'artboard-body';
    body.style.width = `${width}px`;
    body.style.height = `${height}px`;

    const iframe = document.createElement('iframe');
    iframe.className = 'artboard-iframe';
    iframe.dataset.file = board.file;
    iframe.dataset.id = board.id;
    iframe.src = withCacheBust(board.file, this.cacheBustCounter);
    iframe.style.width = '100%';
    iframe.style.height = '100%';

    // Auto-measuring support for same-origin artboards
    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        if (doc && doc.body) {
          // If board has no fixed height, auto-fit height
          if (!board.height) {
            const docHeight = doc.documentElement.scrollHeight || doc.body.scrollHeight;
            if (docHeight > 100) {
              body.style.height = `${docHeight}px`;
            }
          }
        }
      } catch (_) {
        // Cross-origin fallback
      }
    });

    body.appendChild(iframe);
    frame.appendChild(header);
    frame.appendChild(body);

    // Frame Reload Button
    header.querySelector('.btn-reload-frame').addEventListener('click', () => {
      this.reloadIframe(iframe);
    });

    // Frame selection click
    frame.addEventListener('click', (e) => {
      if (!e.target.closest('a, button')) {
        document.querySelectorAll('.artboard-frame').forEach((f) => f.classList.remove('focused'));
        frame.classList.add('focused');
        this.activeArtboardId = board.id;
        document.querySelectorAll('.sidebar-item').forEach((item) => {
          item.classList.toggle('active', item.dataset.id === board.id);
        });
      }
    });

    return frame;
  }

  reloadIframe(iframe) {
    this.cacheBustCounter++;
    iframe.src = withCacheBust(iframe.dataset.file, this.cacheBustCounter);
  }

  // --- Live Reload Connection (SSE) ---

  connectLiveReload() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    try {
      this.eventSource = new EventSource('/api/events');

      this.eventSource.addEventListener('connected', () => {
        this.liveIndicator.classList.remove('disconnected');
        this.liveIndicator.querySelector('.live-text').textContent = 'Live';
      });

      this.eventSource.addEventListener('change', (e) => {
        try {
          const data = JSON.parse(e.data);
          this.handleFileChange(data);
        } catch (err) {
          console.warn('[htmlboard] Error parsing change event:', err);
        }
      });

      this.eventSource.onerror = () => {
        this.liveIndicator.classList.add('disconnected');
        this.liveIndicator.querySelector('.live-text').textContent = 'Offline';
      };
    } catch (err) {
      console.warn('[htmlboard] SSE connection failed:', err);
      this.liveIndicator.classList.add('disconnected');
    }
  }

  handleFileChange(data) {
    if (data.type === 'manifest') {
      // Manifest changed, reload all designs
      this.loadManifest();
      return;
    }

    // A specific file changed: reload the frames showing it (ignoring their query strings)
    const changedFile = (data.file || '').replace(/\\/g, '/');
    const iframes = document.querySelectorAll('.artboard-iframe');
    let reloadedAny = false;

    iframes.forEach((iframe) => {
      const frameFile = (iframe.dataset.file || '').replace(/\\/g, '/').split('?')[0];
      if (frameFile === changedFile) {
        this.reloadIframe(iframe);
        reloadedAny = true;
      }
    });

    if (reloadedAny) return;

    if (data.isHtml) {
      // An HTML file that isn't on the canvas yet may be a new artboard
      this.loadManifest();
    } else {
      // A shared file (CSS, script, image, font) may be used by any artboard
      iframes.forEach((iframe) => this.reloadIframe(iframe));
    }
  }
}

function withCacheBust(file, counter) {
  return `/${file}${file.includes('?') ? '&' : '?'}t=${counter}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Initialize Explorer on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.__htmlboardExplorer = new HtmlBoardExplorer();
});
