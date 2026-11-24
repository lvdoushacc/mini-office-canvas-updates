// ==========================================================================
// 全屏独立“我的资产” (Home Asset Library) - 极简三栏中枢架构
// 严格纯粹中性黑白灰工业设计语言 · 剔除提示词 · 对齐 Mini Office Canvas 资产架构
// ==========================================================================

const escapeHtml = (val) => String(val ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeAttr = (val) => escapeHtml(val);

export function assetDate(value) {
  if (!value) return '日期未知';
  const num = Number(value);
  const date = new Date(num > 1e11 ? num : num * 1000);
  if (Number.isNaN(date.getTime())) return '日期未知';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function detectAssetKind(item) {
  if (!item) return 'image';
  const url = String(item.url || item.file || item.thumbnail || '').toLowerCase();
  const name = String(item.name || item.title || '').toLowerCase();
  const mime = String(item.mime_type || item.mime || item.type || item.format || '').toLowerCase();
  if (item.kind === 'video' || mime.startsWith('video') || /\.(mp4|webm|mov|m4v|flv|mkv|avi)(?:\?|#|$)/.test(url) || /\.(mp4|webm|mov|m4v|flv|mkv|avi)$/.test(name)) {
    return 'video';
  }
  if (item.kind === 'audio' || mime.startsWith('audio') || /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/.test(url) || /\.(mp3|wav|m4a|aac|ogg|flac)$/.test(name)) {
    return 'audio';
  }
  if (item.kind === 'workflow' || item.type === 'workflow' || /\.(json|zip)(?:\?|#|$)/.test(url) || /\.(json|zip)$/.test(name)) {
    return 'workflow';
  }
  return item.kind || 'image';
}

export function getAssetSemanticTag(item) {
  if (item?.classification && item.classification.tag) {
    return String(item.classification.tag);
  }
  const str = `${item?.name || ''} ${item?.folder || ''} ${item?.canvasTitle || ''}`.toLowerCase();
  if (/人物|角色|portrait|character|person|avatar|face|人像/i.test(str)) return '角色';
  if (/场景|背景|landscape|scene|building|architecture|city|nature|街道|环境/i.test(str)) return '场景';
  if (/道具|物件|prop|object|product|weapon|furniture|工具|物品/i.test(str)) return '道具';
  return '未分类';
}

export function isItemCanvasGenerated(node, item) {
  if (!item) return false;
  if (item.source === 'upload' || item.isUpload === true || item.isLocal === true) return false;
  const url = String(item.url || item.file || '');
  if (url.includes('/assets/output/') || url.includes('/output/')) return true;
  return false;
}

export function filterAssets(items, { kind = '', tag = '', folder = null, query = '', sort = 'newest' } = {}) {
  const term = query.trim().toLowerCase();
  return items.filter(item => {
    const itemKind = detectAssetKind(item);
    if (folder !== null && (item.category_id || item.folder || '') !== folder) return false;
    if (kind && itemKind !== kind) return false;
    if (tag && item.tag !== tag) return false;
    if (term) {
      const haystack = `${item.name || ''} ${item.folder || ''} ${item.canvasTitle || ''}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    if (sort === 'size') return Number(b.size || 0) - Number(a.size || 0);
    const timeA = Number(a.created_at || 0);
    const timeB = Number(b.created_at || 0);
    return sort === 'oldest' ? timeA - timeB : timeB - timeA;
  });
}

export function formatDateHeading(dateStr) {
  if (!dateStr || dateStr === '日期未知') return '日期未知';
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return dateStr === todayStr ? `${dateStr} 今天` : dateStr;
}

export class HomeAssetLibrary {
  constructor(root) {
    this.root = root;
    this.active = false;
    this.activeTab = 'assets'; // 'assets' | 'workflows' | 'canvas-assets' | 'local'
    this.assetLibrary = { libraries: [], categories: [] };
    this.activeLibraryId = 'default';
    this.activeCategoryId = '';
    this.activeTagFilter = '';
    this.selectedIds = new Set();
    this.selectedItem = null;
    this.manageMode = false;
    this.searchQuery = '';
    this.sortMode = 'newest';
    this.canvasAssets = [];
    this.canvasWorkflows = [];
    this.localAssets = [];
    this._onExternalAssetsChanged = () => {
      if (this.active) this.load();
    };

    this.initDOM();
    this.bindEvents();
    window.addEventListener('local-assets-changed', this._onExternalAssetsChanged);
  }

  setActive(active) {
    this.active = Boolean(active);
    if (this.active) {
      this.load();
    }
  }

  initDOM() {
    this.root.className = 'asset-library custom-scroll';
    this.root.innerHTML = `
      <!-- 1. 顶部极简操作栏 (52px) -->
      <div class="asset-toolbar">
        <div class="asset-toolbar-left">
          <div class="asset-view-header">
            <span class="asset-view-title">我的资产</span>
            <span class="asset-sync-badge">全域资产中枢</span>
          </div>

          <!-- 4个板块 (绝无提示词) -->
          <div class="asset-hub-tabs" role="tablist">
            <button type="button" class="asset-hub-tab active" data-tab="assets">图片资产</button>
            <button type="button" class="asset-hub-tab" data-tab="workflows">工作流</button>
            <button type="button" class="asset-hub-tab" data-tab="canvas-assets">画布生成</button>
            <button type="button" class="asset-hub-tab" data-tab="local">本地素材</button>
          </div>
        </div>

        <div class="asset-toolbar-right">
          <!-- 常规素材操作栏 -->
          <div class="asset-standard-actions">
            <div class="asset-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input type="search" data-action="search" placeholder="搜索资产名称、标签..." maxlength="120" autocomplete="off" spellcheck="false">
            </div>
            <select class="asset-sort" data-action="sort">
              <option value="newest">最近添加</option>
              <option value="oldest">最早添加</option>
              <option value="name">按名称</option>
              <option value="size">按大小</option>
            </select>
            <button type="button" class="asset-tool-btn" data-action="manage-toggle" aria-pressed="false" title="选择素材">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              <span>选择</span>
            </button>
            <button type="button" class="asset-btn-primary" data-action="upload-trigger">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>上传资产</span>
            </button>
          </div>

          <!-- 工作流极简专属操作栏：仅添加、导出、删除三项 -->
          <div class="asset-wf-actions">
            <button type="button" class="asset-tool-btn" data-action="wf-top-add" title="添加工作流 (.zip / .json)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              <span>添加</span>
            </button>
            <button type="button" class="asset-tool-btn" data-action="wf-top-export" title="导出选中工作流">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>导出</span>
            </button>
            <button type="button" class="asset-tool-btn danger" data-action="wf-top-delete" title="删除工作流">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <span>删除</span>
            </button>
          </div>

          <input type="file" data-ref="fileInput" multiple hidden>
          <input type="file" data-ref="wfInput" accept=".json,.zip,application/json,application/zip" multiple hidden>
        </div>
      </div>

      <!-- 批量操作控制浮条 -->
      <div class="asset-manage-bar" hidden>
        <div class="asset-manage-inner">
          <label class="asset-check-label">
            <input type="checkbox" data-action="select-all">
            <span>全选当前</span>
          </label>
          <div class="asset-divider"></div>
          <span class="asset-selected-text">已选 <b data-ref="selectedCount">0</b> 项</span>
          <div class="asset-manage-actions">
            <button type="button" class="asset-tool-btn" data-action="batch-move" disabled>移动至分组</button>
            <button type="button" class="asset-tool-btn" data-action="batch-crop" disabled>批量裁剪</button>
            <button type="button" class="asset-tool-btn" data-action="batch-classify" disabled>AI打标</button>
            <button type="button" class="asset-tool-btn danger" data-action="batch-delete" disabled>删除</button>
          </div>
        </div>
      </div>

      <!-- 2. 三栏主体工作台 -->
      <div class="asset-layout">
        
        <!-- 左栏：资产库 + 分组树 + AI标签 (230px) -->
        <aside class="asset-sidebar-tree">
          <!-- 资产库 -->
          <div class="asset-tree-block">
            <div class="asset-tree-head">
              <span>资产库</span>
              <button type="button" class="asset-link-action" data-action="new-lib">+ 新库</button>
            </div>
            <div class="asset-tree-list" data-ref="libList"></div>
          </div>

          <!-- 分组 -->
          <div class="asset-tree-block">
            <div class="asset-tree-head">
              <span>分组</span>
              <button type="button" class="asset-link-action" data-action="new-cat">+ 新建组</button>
            </div>
            <div class="asset-tree-list" data-ref="catList"></div>
          </div>

          <!-- AI标签 -->
          <div class="asset-tree-block">
            <div class="asset-tree-head">
              <span>智能标签</span>
            </div>
            <div class="asset-tag-cloud" data-ref="tagList"></div>
          </div>
        </aside>

        <!-- 中栏：网格卡片瀑布流 -->
        <section class="asset-main-grid-wrap">
          <div class="asset-grid" data-ref="assetGrid"></div>
        </section>

        <!-- 右栏：选中详情面板 (260px) -->
        <aside class="asset-detail-panel" data-ref="detailPanel">
          <div class="asset-detail-empty">选择素材查看详细信息</div>
        </aside>

      </div>
    `;

    this.fileInput = this.root.querySelector('[data-ref="fileInput"]');
    this.wfInput = this.root.querySelector('[data-ref="wfInput"]');
    this.libListEl = this.root.querySelector('[data-ref="libList"]');
    this.catListEl = this.root.querySelector('[data-ref="catList"]');
    this.tagListEl = this.root.querySelector('[data-ref="tagList"]');
    this.assetGridEl = this.root.querySelector('[data-ref="assetGrid"]');
    this.detailPanelEl = this.root.querySelector('[data-ref="detailPanel"]');
    this.manageBarEl = this.root.querySelector('.asset-manage-bar');
    this.selectedCountEl = this.root.querySelector('[data-ref="selectedCount"]');
    this.selectAllInput = this.root.querySelector('[data-action="select-all"]');
  }

  bindEvents() {
    // Tab 切换
    this.root.querySelectorAll('.asset-hub-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.root.querySelectorAll('.asset-hub-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTab = btn.dataset.tab;
        this.activeCategoryId = '';
        this.activeTagFilter = '';
        this.selectedIds.clear();
        this.selectedItem = null;
        this.renderAll();
      });
    });

    // 搜索
    const searchInput = this.root.querySelector('[data-action="search"]');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim();
      this.renderGrid();
    });

    // 排序
    const sortSelect = this.root.querySelector('[data-action="sort"]');
    if (sortSelect && typeof window.bindUiverseSelect === 'function') {
      window.bindUiverseSelect(sortSelect);
    }
    sortSelect?.addEventListener('change', (e) => {
      this.sortMode = e.target.value;
      this.renderGrid();
    });

    // 批量模式切换
    this.root.querySelector('[data-action="manage-toggle"]')?.addEventListener('click', () => {
      this.manageMode = !this.manageMode;
      this.manageBarEl.hidden = !this.manageMode;
      this.selectedIds.clear();
      const toggle = this.root.querySelector('[data-action="manage-toggle"]');
      toggle?.setAttribute('aria-pressed', this.manageMode ? 'true' : 'false');
      toggle?.classList.toggle('active', this.manageMode);
      this.updateManageBar();
      this.renderGrid();
    });

    // 全选
    this.selectAllInput?.addEventListener('change', (e) => {
      const items = this.getCurrentTabItems();
      if (e.target.checked) {
        items.forEach(it => this.selectedIds.add(it.id));
      } else {
        this.selectedIds.clear();
      }
      this.updateManageBar();
      this.renderGrid();
    });

    // 上传
    this.root.querySelector('[data-action="upload-trigger"]')?.addEventListener('click', () => {
      if (this.activeTab === 'workflows') {
        this.wfInput?.click();
      } else {
        this.fileInput?.click();
      }
    });

    // 工作流专属顶栏操作 (添加、导出、删除)
    this.root.querySelector('[data-action="wf-top-add"]')?.addEventListener('click', () => {
      this.wfInput?.click();
    });

    this.root.querySelector('[data-action="wf-top-export"]')?.addEventListener('click', () => {
      const items = this.getCurrentTabItems();
      if (!items || !items.length) {
        this.showToast('当前分类下暂无工作流', true);
        return;
      }
      if (this.selectedItem && items.some(x => x.id === this.selectedItem.id)) {
        this.exportWorkflowItem(this.selectedItem);
      } else if (items.length === 1) {
        this.selectedItem = items[0];
        this.exportWorkflowItem(items[0]);
      } else {
        this.selectedItem = items[0];
        this.assetGridEl?.querySelectorAll('.asset-card-workflow').forEach(c => {
          c.classList.toggle('selected', c.dataset.id === items[0].id);
        });
        this.exportWorkflowItem(items[0]);
      }
    });

    this.root.querySelector('[data-action="wf-top-delete"]')?.addEventListener('click', () => {
      const items = this.getCurrentTabItems();
      if (!items || !items.length) {
        this.showToast('当前分类下暂无工作流', true);
        return;
      }
      if (this.selectedItem && items.some(x => x.id === this.selectedItem.id)) {
        this.deleteWorkflowItem(this.selectedItem);
      } else if (items.length === 1) {
        this.deleteWorkflowItem(items[0]);
      } else {
        this.showToast('请先在下方点击选择需要删除的工作流卡片', true);
      }
    });

    this.fileInput?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      await this.uploadFiles(files);
      this.fileInput.value = '';
    });

    this.wfInput?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      await this.uploadWorkflows(files);
      this.wfInput.value = '';
    });

    // 批量操作按钮
    this.root.querySelector('[data-action="batch-delete"]')?.addEventListener('click', () => this.handleBatchDelete());
    this.root.querySelector('[data-action="batch-move"]')?.addEventListener('click', () => this.handleBatchMove());
    this.root.querySelector('[data-action="batch-crop"]')?.addEventListener('click', () => this.handleBatchCrop());
    this.root.querySelector('[data-action="batch-classify"]')?.addEventListener('click', () => this.handleBatchClassify());

    // 新建库 / 新建组
    this.root.querySelector('[data-action="new-lib"]')?.addEventListener('click', () => this.handleNewLibrary());
    this.root.querySelector('[data-action="new-cat"]')?.addEventListener('click', () => this.handleNewCategory());
  }

  async load() {
    try {
      const [libRes, localRes, canvasRes, wfRes] = await Promise.all([
        fetch('/api/asset-library').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/local-assets').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/canvas-assets').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/canvas-workflows').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (libRes?.library) {
        this.assetLibrary = libRes.library;
        const libs = this.assetLibrary.libraries || [];
        if (!libs.some(l => l.id === this.activeLibraryId)) {
          this.activeLibraryId = this.assetLibrary.active_library_id || libs[0]?.id || 'default';
        }
      }

      this.localAssets = Array.isArray(localRes?.items) ? localRes.items : [];
      this.canvasAssets = Array.isArray(canvasRes?.items) ? canvasRes.items : [];
      this.canvasWorkflows = Array.isArray(wfRes?.workflows) ? wfRes.workflows : [];

      this.renderAll();
    } catch (e) {
      console.warn('Load assets error:', e);
    }
  }

  getCurrentLibrary() {
    const libs = this.assetLibrary.libraries || [];
    return libs.find(l => l.id === this.activeLibraryId) || libs[0] || null;
  }

  getCurrentCategories() {
    const lib = this.getCurrentLibrary();
    if (!lib) return [];
    const isWorkflow = this.activeTab === 'workflows';
    return (lib.categories || []).filter(c => isWorkflow ? c.type === 'workflow' : c.type !== 'workflow');
  }

  getCurrentTabItems() {
    let list = [];
    if (this.activeTab === 'assets') {
      const lib = this.getCurrentLibrary();
      const cats = (lib?.categories || []).filter(c => c.type !== 'workflow');
      if (this.activeCategoryId) {
        const cat = cats.find(c => c.id === this.activeCategoryId);
        list = cat?.items || [];
      } else {
        list = cats.flatMap(c => c.items || []);
      }
    } else if (this.activeTab === 'workflows') {
      const lib = this.getCurrentLibrary();
      const cats = (lib?.categories || []).filter(c => c.type === 'workflow');
      const libItems = cats.flatMap(c => c.items || []);

      const cWorkflows = (this.canvasWorkflows || []).map(w => ({
        id: w.id,
        name: w.name || w.id,
        kind: 'workflow',
        type: 'workflow',
        format: (w.filename || '').endsWith('.zip') ? 'zip' : 'json',
        node_count: w.node_count || 0,
        connection_count: w.connection_count || 0,
        resource_count: w.resource_count || 0,
        created_at: w.created_at || w.updated_at,
        size: w.size || '',
        filename: w.filename || `${w.id}.json`,
        url: `/api/canvas-workflows/${encodeURIComponent(w.id)}`,
        isCanvasWorkflow: true
      }));

      const map = new Map();
      cWorkflows.forEach(it => map.set(it.id, it));
      libItems.forEach(it => {
        if (!map.has(it.id)) {
          map.set(it.id, { ...it, kind: 'workflow', type: 'workflow' });
        }
      });
      list = Array.from(map.values());
    } else if (this.activeTab === 'canvas-assets') {
      list = this.canvasAssets;
    } else if (this.activeTab === 'local') {
      list = this.localAssets;
    }

    // 智能标签过滤 (非工作流)
    if (this.activeTagFilter && this.activeTab !== 'workflows') {
      list = list.filter(item => getAssetSemanticTag(item) === this.activeTagFilter);
    }

    // 关键词搜索 (非工作流)
    if (this.searchQuery && this.activeTab !== 'workflows') {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(item => (item.name || '').toLowerCase().includes(q) || (item.tag || '').toLowerCase().includes(q));
    }

    // 排序
    return [...list].sort((a, b) => {
      if (this.sortMode === 'name') return (a.name || '').localeCompare(b.name || '', 'zh-CN');
      if (this.sortMode === 'size') return (b.size || 0) - (a.size || 0);
      const timeA = Number(a.created_at || 0);
      const timeB = Number(b.created_at || 0);
      return this.sortMode === 'oldest' ? timeA - timeB : timeB - timeA;
    });
  }

  renderAll() {
    const isWf = this.activeTab === 'workflows';
    this.root.classList.toggle('is-workflows-mode', isWf);
    if (!isWf) {
      this.renderSidebar();
    }
    this.renderGrid();
    if (!isWf) {
      this.renderDetail();
    }
  }

  renderSidebar() {
    // 1. 资产库列表
    const libs = this.assetLibrary.libraries || [];
    const canDelLib = libs.length > 1;
    this.libListEl.innerHTML = libs.map(lib => {
      const isActive = lib.id === this.activeLibraryId;
      const count = (lib.categories || []).reduce((n, c) => n + (c.items || []).length, 0);
      return `
        <div class="asset-tree-item ${isActive ? 'active' : ''}" data-action="select-lib" data-id="${escapeAttr(lib.id)}">
          <span class="truncate" title="${escapeAttr(lib.name || '资产库')}">${escapeHtml(lib.name || '资产库')}</span>
          <div class="asset-tree-item-right">
            <span class="asset-badge">${count}</span>
            ${canDelLib ? `
              <button type="button" class="asset-tree-del-btn" data-action="delete-lib" data-id="${escapeAttr(lib.id)}" data-name="${escapeAttr(lib.name || '资产库')}" title="删除此资产库">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('') || '<div class="asset-empty-hint">暂无资产库</div>';

    this.libListEl.querySelectorAll('[data-action="select-lib"]').forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest('[data-action="delete-lib"]')) return;
        this.activeLibraryId = el.dataset.id;
        this.activeCategoryId = '';
        this.selectedIds.clear();
        this.renderAll();
      };
    });

    this.libListEl.querySelectorAll('[data-action="delete-lib"]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const libId = btn.dataset.id;
        const libName = btn.dataset.name || '资产库';
        await this.handleDeleteLibrary(libId, libName);
      };
    });

    // 2. 分组列表
    const cats = this.getCurrentCategories();
    let catHtml = `
      <div class="asset-tree-item ${!this.activeCategoryId ? 'active' : ''}" data-action="select-cat" data-id="">
        <span class="truncate">全部素材</span>
        <div class="asset-tree-item-right">
          <span class="asset-badge">${cats.reduce((n, c) => n + (c.items || []).length, 0)}</span>
        </div>
      </div>
    `;
    catHtml += cats.map(cat => {
      const isActive = cat.id === this.activeCategoryId;
      const count = (cat.items || []).length;
      const isProtected = ['default', 'workflows'].includes(cat.id) && this.activeLibraryId === 'default';
      return `
        <div class="asset-tree-item ${isActive ? 'active' : ''}" data-action="select-cat" data-id="${escapeAttr(cat.id)}">
          <span class="truncate" title="${escapeAttr(cat.name || '分组')}">${escapeHtml(cat.name || '分组')}</span>
          <div class="asset-tree-item-right">
            <span class="asset-badge">${count}</span>
            ${!isProtected ? `
              <button type="button" class="asset-tree-del-btn" data-action="delete-cat" data-id="${escapeAttr(cat.id)}" data-name="${escapeAttr(cat.name || '分组')}" title="删除此分组">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
    this.catListEl.innerHTML = catHtml;

    this.catListEl.querySelectorAll('[data-action="select-cat"]').forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest('[data-action="delete-cat"]')) return;
        this.activeCategoryId = el.dataset.id;
        this.selectedIds.clear();
        this.renderGrid();
        this.renderSidebar();
      };
    });

    this.catListEl.querySelectorAll('[data-action="delete-cat"]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const catId = btn.dataset.id;
        const catName = btn.dataset.name || '分组';
        await this.handleDeleteCategory(catId, catName);
      };
    });

    // 3. 智能标签
    const items = this.getCurrentTabItems();
    const tagCounts = {};
    items.forEach(it => {
      const tag = getAssetSemanticTag(it);
      if (tag && tag !== '未分类') tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
    const tags = Object.keys(tagCounts);
    this.tagListEl.innerHTML = tags.map(t => `
      <span class="asset-tag-pill ${this.activeTagFilter === t ? 'active' : ''}" data-action="toggle-tag" data-tag="${escapeAttr(t)}">
        ${escapeHtml(t)} (${tagCounts[t]})
      </span>
    `).join('') || '<div class="asset-empty-hint">暂无标签</div>';

    this.tagListEl.querySelectorAll('[data-action="toggle-tag"]').forEach(el => {
      el.onclick = () => {
        this.activeTagFilter = this.activeTagFilter === el.dataset.tag ? '' : el.dataset.tag;
        this.renderGrid();
        this.renderSidebar();
      };
    });
  }

  renderGrid() {
    const items = this.getCurrentTabItems();
    const isWf = this.activeTab === 'workflows';

    if (isWf) {
      if (!items.length) {
        this.assetGridEl.innerHTML = `
          <div class="asset-wf-empty">
            <div class="asset-wf-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            </div>
            <div class="asset-wf-empty-title">暂无工作流</div>
            <div class="asset-wf-empty-desc">导入或添加 .json / .zip 格式的工作流工程包，随时在画布中复用。</div>
          </div>
        `;
        return;
      }

      this.assetGridEl.innerHTML = items.map(item => {
        const isCurrent = this.selectedItem?.id === item.id;
        const formatText = item.format === 'zip' ? 'ZIP 包' : 'JSON 流程';
        const metaParts = [];
        if (item.node_count) metaParts.push(`${item.node_count} 节点`);
        if (item.connection_count) metaParts.push(`${item.connection_count} 连线`);
        if (item.size) metaParts.push(typeof item.size === 'number' ? `${(item.size / 1024).toFixed(1)} KB` : item.size);
        const metaStr = metaParts.length ? metaParts.join(' · ') : assetDate(item.created_at);

        return `
          <div class="asset-card-workflow ${isCurrent ? 'selected' : ''}" data-id="${escapeAttr(item.id)}">
            <div class="asset-card-thumb">
              <span class="asset-wf-format-pill">${escapeHtml(formatText)}</span>
              <svg class="asset-wf-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
            </div>
            <div class="asset-card-meta">
              <span class="asset-card-name" title="${escapeAttr(item.name || '')}">${escapeHtml(item.name || '未命名工作流')}</span>
              <span class="asset-card-sub">${escapeHtml(metaStr)}</span>
            </div>
            <div class="asset-wf-card-actions">
              <button type="button" class="asset-wf-action-btn" data-action="card-export" data-id="${escapeAttr(item.id)}" title="导出工作流">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>导出</span>
              </button>
              <button type="button" class="asset-wf-action-btn danger" data-action="card-delete" data-id="${escapeAttr(item.id)}" title="删除工作流">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                <span>删除</span>
              </button>
            </div>
          </div>
        `;
      }).join('');

      // 绑定工作流卡片交互
      this.assetGridEl.querySelectorAll('.asset-card-workflow').forEach(card => {
        const id = card.dataset.id;
        const item = items.find(x => x.id === id);
        if (!item) return;

        card.addEventListener('click', () => {
          this.selectedItem = item;
          this.assetGridEl.querySelectorAll('.asset-card-workflow').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        });

        card.querySelector('[data-action="card-export"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectedItem = item;
          this.assetGridEl.querySelectorAll('.asset-card-workflow').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          this.exportWorkflowItem(item);
        });

        card.querySelector('[data-action="card-delete"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteWorkflowItem(item);
        });
      });

      return;
    }

    // 非工作流模式 (图片资产、画布生成、本地素材)
    if (!items.length) {
      this.assetGridEl.innerHTML = '<div class="asset-grid-empty">当前分组为空</div>';
      return;
    }

    this.assetGridEl.innerHTML = items.map(item => {
      const isSelected = this.selectedIds.has(item.id);
      const isCurrent = this.selectedItem?.id === item.id;
      const kind = detectAssetKind(item);
      const isVideo = kind === 'video';

      return `
        <div class="asset-card ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''}" data-id="${escapeAttr(item.id)}" data-kind="${escapeAttr(kind)}">
          ${this.manageMode ? `
            <div class="asset-card-checkbox">
              <input type="checkbox" ${isSelected ? 'checked' : ''} data-action="toggle-check" data-id="${escapeAttr(item.id)}">
            </div>
          ` : ''}
          <div class="asset-card-thumb">
            ${isVideo ? `
              <div class="asset-thumb-video-wrap">
                <video src="${escapeAttr(item.url || item.thumbnail || '')}#t=0.001" preload="metadata" muted playsinline loop></video>
                <span class="asset-video-badge">
                  <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  <span>VIDEO</span>
                </span>
              </div>
            ` : `
              <img src="${escapeAttr(item.thumbnail || item.url || '')}" alt="" loading="lazy">
            `}
          </div>
          <div class="asset-card-meta">
            <span class="asset-card-name" title="${escapeAttr(item.name || '')}">${escapeHtml(item.name || '未命名')}</span>
            <span class="asset-card-sub">${escapeHtml(isVideo ? '视频' : item.kind || 'media')}</span>
          </div>
        </div>
      `;
    }).join('');

    // 绑定普通卡片点击与视频悬浮自动播放
    this.assetGridEl.querySelectorAll('.asset-card').forEach(card => {
      const id = card.dataset.id;
      const item = items.find(x => x.id === id);
      if (!item) return;

      const videoEl = card.querySelector('video');
      if (videoEl) {
        card.addEventListener('mouseenter', () => {
          videoEl.currentTime = 0;
          videoEl.play().catch(() => {});
        });
        card.addEventListener('mouseleave', () => {
          videoEl.pause();
          videoEl.currentTime = 0.001;
        });
      }

      card.addEventListener('click', (e) => {
        if (this.manageMode && e.target.tagName === 'INPUT') {
          return;
        }

        if (this.manageMode) {
          if (this.selectedIds.has(id)) this.selectedIds.delete(id);
          else this.selectedIds.add(id);
          this.updateManageBar();
          this.renderGrid();
        } else {
          this.selectedItem = item;
          this.renderDetail();
          this.assetGridEl.querySelectorAll('.asset-card').forEach(c => c.classList.remove('current'));
          card.classList.add('current');
        }
      });
    });

    // 勾选事件
    this.assetGridEl.querySelectorAll('[data-action="toggle-check"]').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const id = chk.dataset.id;
        if (e.target.checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        this.updateManageBar();
      });
    });
  }

  renderDetail() {
    const item = this.selectedItem;
    if (!item) {
      this.detailPanelEl.innerHTML = '<div class="asset-detail-empty">选择素材查看详细属性</div>';
      return;
    }

    const kind = detectAssetKind(item);
    const isVideo = kind === 'video';
    const isWf = kind === 'workflow' || item.type === 'workflow';
    const tag = getAssetSemanticTag(item);

    this.detailPanelEl.innerHTML = `
      <div class="asset-detail-head">素材详情</div>
      <div class="asset-detail-thumb">
        ${isVideo ? `
          <div class="asset-detail-video-player">
            <video src="${escapeAttr(item.url || item.thumbnail || '')}" controls playsinline preload="metadata"></video>
          </div>
        ` : isWf ? `
          <div class="asset-thumb-wf large">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            <span>${escapeHtml(item.name || '工作流')}</span>
          </div>
        ` : `
          <img src="${escapeAttr(item.url || item.thumbnail || '')}" alt="">
        `}
      </div>

      <div class="asset-detail-title" title="${escapeAttr(item.name || '')}">${escapeHtml(item.name || '未命名')}</div>

      <div class="asset-detail-rows">
        <div class="asset-detail-row">
          <span>类型</span>
          <b>${escapeHtml(isVideo ? '视频媒体 (MP4)' : isWf ? '工作流配置' : item.kind || '图片素材')}</b>
        </div>
        ${item.natural_w && item.natural_h ? `
          <div class="asset-detail-row">
            <span>分辨率</span>
            <b>${item.natural_w} × ${item.natural_h}</b>
          </div>
        ` : ''}
        ${item.size ? `
          <div class="asset-detail-row">
            <span>体积</span>
            <b>${typeof item.size === 'number' ? (item.size > 1024 * 1024 ? (item.size / (1024 * 1024)).toFixed(2) + ' MB' : (item.size / 1024).toFixed(1) + ' KB') : item.size}</b>
          </div>
        ` : ''}
        <div class="asset-detail-row">
          <span>智能标签</span>
          <b>${escapeHtml(tag)}</b>
        </div>
        <div class="asset-detail-row">
          <span>创建日期</span>
          <b>${assetDate(item.created_at)}</b>
        </div>
      </div>

      <div class="asset-detail-actions">
        ${item.url ? `<button type="button" class="asset-detail-btn" data-action="copy-url">复制文件链接</button>` : ''}
        ${item.url ? `<a href="${escapeAttr(item.url)}" download class="asset-detail-btn" style="text-align:center;text-decoration:none;">下载素材</a>` : ''}
        <button type="button" class="asset-detail-btn danger" data-action="delete-single">删除素材</button>
      </div>
    `;

    this.detailPanelEl.querySelector('[data-action="copy-url"]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.url || '');
        alert('已复制素材链接');
      } catch (_) {}
    });

    this.detailPanelEl.querySelector('[data-action="delete-single"]')?.addEventListener('click', async () => {
      if (!confirm(`确定删除素材「${item.name || 'asset'}」？`)) return;
      try {
        await this.deleteAssetItem(item);
        this.selectedItem = null;
        await this.load();
        this.showToast('素材已永久删除');
      } catch (error) {
        this.showToast(error?.message || '素材删除失败', true);
      }
    });
  }

  updateManageBar() {
    const count = this.selectedIds.size;
    if (this.selectedCountEl) this.selectedCountEl.textContent = count;
    this.root.querySelectorAll('.asset-manage-actions button').forEach(btn => {
      btn.disabled = count === 0;
    });
  }

  async uploadFiles(files) {
    const cat = this.getCurrentCategories()[0];
    if (!cat) {
      alert('请先创建分组');
      return;
    }
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    const upRes = await fetch('/api/ai/upload', { method: 'POST', body: form }).then(r => r.json());
    const items = (upRes.files || []).map(f => ({
      library_id: this.activeLibraryId,
      category_id: this.activeCategoryId || cat.id,
      url: f.url,
      name: f.name || 'asset'
    }));

    if (items.length) {
      await fetch('/api/asset-library/items/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ library_id: this.activeLibraryId, category_id: this.activeCategoryId || cat.id, items })
      });
      await this.load();
    }
  }

  async uploadWorkflows(files) {
    if (!files || !files.length) return;
    let successCount = 0;
    for (const file of files) {
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/canvas-workflows/import', { method: 'POST', body: form });
        if (res.ok) {
          successCount++;
          continue;
        }
      } catch (_) {}

      try {
        const form = new FormData();
        form.append('library_id', this.activeLibraryId);
        form.append('files', file);
        const res = await fetch('/api/asset-library/workflows/upload', { method: 'POST', body: form });
        if (res.ok) successCount++;
      } catch (_) {}
    }

    if (successCount > 0) {
      await this.load();
      this.showToast(`成功添加 ${successCount} 个工作流`);
    } else {
      this.showToast('工作流添加失败，请确认文件为有效的 .json 或 .zip 格式', true);
    }
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async exportWorkflowItem(item) {
    if (!item) {
      this.showToast('未选择任何工作流', true);
      return;
    }
    const safeName = (item.name || item.id || 'workflow').replace(/[\/\\?%*:|"<>]/g, '_');
    this.showToast(`正在导出工作流「${safeName}」...`);

    try {
      // 1. 如果是画布已归档工作流或以 wf_ 开头，优先读取完整 workflow 结构
      if (item.isCanvasWorkflow || String(item.id).startsWith('wf_')) {
        const wid = item.id;
        try {
          const getRes = await fetch(`/api/canvas-workflows/${encodeURIComponent(wid)}`);
          if (getRes.ok) {
            const getData = await getRes.json();
            const wf = getData.workflow;
            if (wf) {
              // 若明确为 zip 格式，尝试打包工程包
              if (item.format === 'zip') {
                try {
                  const exportRes = await fetch('/api/canvas-workflows/export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      nodes: wf.nodes || [],
                      connections: wf.connections || [],
                      resources: wf.resources || [],
                      include_resources: true,
                      filename: `${safeName}-workflow.zip`
                    })
                  });
                  if (exportRes.ok) {
                    const blob = await exportRes.blob();
                    this.downloadBlob(blob, `${safeName}-workflow.zip`);
                    this.showToast(`✓ 已导出工作流工程包「${safeName}.zip」`);
                    return;
                  }
                } catch (zipErr) {
                  console.warn('Export zip package failed, fallback to JSON:', zipErr);
                }
              }

              // 标准/兜底导出：直接以完整 JSON 格式秒级下载
              const jsonBlob = new Blob([JSON.stringify(wf, null, 2)], { type: 'application/json;charset=utf-8' });
              this.downloadBlob(jsonBlob, `${safeName}.json`);
              this.showToast(`✓ 已导出工作流「${safeName}.json」`);
              return;
            }
          }
        } catch (fetchWfErr) {
          console.warn('Fetch canvas workflow detail failed:', fetchWfErr);
        }
      }

      // 2. 如果是素材库文件且有静态资源 url（如 /assets/...）
      if (item.url) {
        const isZip = item.format === 'zip' || (item.url || '').endsWith('.zip');
        const ext = isZip ? '.zip' : '.json';
        const filename = `${safeName}${ext}`;
        try {
          const fileRes = await fetch(item.url);
          if (fileRes.ok) {
            const blob = await fileRes.blob();
            this.downloadBlob(blob, filename);
            this.showToast(`✓ 已导出工作流「${filename}」`);
            return;
          }
        } catch (urlErr) {
          console.warn('Fetch asset url failed:', urlErr);
        }
      }

      this.showToast('导出失败：未找到该工作流的数据文件', true);
    } catch (err) {
      console.error('Export workflow error:', err);
      this.showToast('导出工作流失败：' + (err.message || '网络异常'), true);
    }
  }

  async deleteWorkflowItem(item) {
    if (!item) return;
    const ok = await this.showConfirm({
      title: '删除工作流',
      message: `确定删除工作流「${item.name || '未命名'}」？此操作不可撤销。`,
      danger: true,
      confirmText: '删除'
    });
    if (!ok) return;
    try {
      if (item.isCanvasWorkflow || String(item.id).startsWith('wf_')) {
        await fetch(`/api/canvas-workflows/${encodeURIComponent(item.id)}`, { method: 'DELETE' }).catch(() => {});
      }
      await fetch(`/api/asset-library/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' }).catch(() => {});
      if (this.selectedItem?.id === item.id) {
        this.selectedItem = null;
      }
      this.selectedIds.delete(item.id);
      await this.load();
    } catch (err) {
      console.error('Delete workflow error:', err);
      alert('删除工作流失败');
    }
  }

  getSelectedAssetItems() {
    const selected = this.selectedIds;
    let items = [];
    if (this.activeTab === 'assets') {
      const lib = this.getCurrentLibrary();
      items = (lib?.categories || [])
        .filter(category => category.type !== 'workflow')
        .flatMap(category => category.items || []);
    } else if (this.activeTab === 'local') {
      items = this.localAssets || [];
    } else if (this.activeTab === 'canvas-assets') {
      items = this.canvasAssets || [];
    }
    return items.filter(item => selected.has(item.id));
  }

  async deleteAssetItem(item) {
    if (!item) throw new Error('未选择素材');

    if (this.activeTab === 'assets') {
      const response = await fetch(`/api/asset-library/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `删除失败 (${response.status})`);
      return { removed: 1 };
    }

    if (this.activeTab === 'local') {
      const path = item.file || item.id;
      const response = await fetch('/api/local-assets/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: [path] })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `删除失败 (${response.status})`);
      const deleted = Array.isArray(payload.deleted) ? payload.deleted.map(String) : [];
      if (!deleted.includes(String(path))) {
        throw new Error('素材仍被活动画布使用，请先在画布中删除对应节点');
      }
      return { removed: 1 };
    }

    if (this.activeTab === 'canvas-assets') {
      const response = await fetch('/api/media/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [item.url] })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `删除失败 (${response.status})`);
      if (Number(payload.deleted || 0) > 0) return { removed: 1 };
      if (Number(payload.kept || 0) > 0) {
        throw new Error('素材仍被活动画布使用，请先在画布中删除对应节点');
      }
      throw new Error('素材文件不存在或已被删除');
    }

    throw new Error('当前页面不支持删除此类型素材');
  }

  async handleBatchDelete() {
    if (!this.selectedIds.size) return;
    if (!confirm(`确定删除所选 ${this.selectedIds.size} 项素材？`)) return;
    try {
      const items = this.getSelectedAssetItems();
      if (!items.length) throw new Error('没有找到可删除的素材');
      let removed = 0;
      let kept = 0;

      if (this.activeTab === 'assets') {
        const response = await fetch('/api/asset-library/items/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: items.map(item => item.id), library_id: this.activeLibraryId })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || `删除失败 (${response.status})`);
        removed = Number(payload.removed || 0);
      } else if (this.activeTab === 'local') {
        const response = await fetch('/api/local-assets/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names: items.map(item => item.file || item.id) })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || `删除失败 (${response.status})`);
        const deleted = new Set((Array.isArray(payload.deleted) ? payload.deleted : []).map(String));
        removed = items.filter(item => deleted.has(String(item.file || item.id))).length;
        kept = items.length - removed;
      } else if (this.activeTab === 'canvas-assets') {
        const response = await fetch('/api/media/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: items.map(item => item.url).filter(Boolean) })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || `删除失败 (${response.status})`);
        removed = Number(payload.deleted || 0);
        kept = Number(payload.kept || 0);
      } else {
        throw new Error('当前页面不支持批量删除此类型素材');
      }

      if (!removed && kept) {
        throw new Error('所选素材仍被活动画布使用，请先在画布中删除对应节点');
      }
      if (!removed) throw new Error('没有找到可删除的素材');
      this.selectedIds.clear();
      this.selectedItem = null;
      this.updateManageBar();
      await this.load();
      this.showToast(kept ? `已永久删除 ${removed} 项素材，${kept} 项仍被画布使用` : `已永久删除 ${removed} 项素材`);
    } catch (error) {
      this.showToast(error?.message || '素材删除失败', true);
    }
  }

  async handleBatchMove() {
    const cats = this.getCurrentCategories();
    if (!cats.length) return;
    const names = cats.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
    const input = prompt(`请输入目标分组编号：\n${names}`);
    const idx = parseInt(input, 10) - 1;
    if (isNaN(idx) || !cats[idx]) return;

    await fetch('/api/asset-library/items/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: Array.from(this.selectedIds),
        library_id: this.activeLibraryId,
        target_library_id: this.activeLibraryId,
        target_category_id: cats[idx].id
      })
    });
    this.selectedIds.clear();
    this.updateManageBar();
    await this.load();
  }

  async handleBatchCrop() {
    if (!this.selectedIds.size) return;
    await fetch('/api/asset-library/items/crop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(this.selectedIds), library_id: this.activeLibraryId })
    });
    this.selectedIds.clear();
    this.updateManageBar();
    await this.load();
  }

  async handleBatchClassify() {
    if (!this.selectedIds.size) return;
    alert('已提交 AI 智能分类识别');
    await fetch('/api/asset-library/items/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(this.selectedIds), library_id: this.activeLibraryId })
    });
    await this.load();
  }

  ensureDialogDOM() {
    let modal = document.getElementById('assetDialogModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'assetDialogModal';
      modal.className = 'xxdp-modal-backdrop';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = `
        <div class="xxdp-dialog-modal" style="width: 380px; max-width: 90vw;">
          <header class="xxdp-modal-header">
            <h2 class="xxdp-modal-title" data-ref="dialogTitle">新建</h2>
            <button class="xxdp-modal-close" type="button" data-action="dialog-close" title="关闭 (Esc)">
              <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </header>
          <form class="xxdp-dialog-form" data-ref="dialogForm">
            <div class="xxdp-dialog-field" data-ref="dialogInputWrap">
              <label class="xxdp-dialog-label" data-ref="dialogLabel">名称</label>
              <input type="text" class="xxdp-dialog-input" data-ref="dialogInput" maxlength="50" autocomplete="off" spellcheck="false" required>
            </div>
            <div class="app-confirm-body" data-ref="dialogConfirmBody" style="display:none; padding: 4px 0 12px; font-size: 13px; line-height: 1.6; color: var(--asset-text-muted, #64748b);">
              <p data-ref="dialogMessage" style="margin: 0; white-space: pre-wrap; word-break: break-word;"></p>
            </div>
            <footer class="xxdp-dialog-actions">
              <button type="button" class="xxdp-btn secondary" data-action="dialog-cancel">取消</button>
              <button type="submit" class="xxdp-btn primary" data-ref="dialogSubmit">确定</button>
            </footer>
          </form>
        </div>
      `;
      document.body.appendChild(modal);
    }
    return modal;
  }

  showPrompt({ title = '请输入', label = '名称', placeholder = '', defaultValue = '', confirmText = '确定' } = {}) {
    return new Promise((resolve) => {
      const modal = this.ensureDialogDOM();
      const titleEl = modal.querySelector('[data-ref="dialogTitle"]');
      const labelEl = modal.querySelector('[data-ref="dialogLabel"]');
      const inputEl = modal.querySelector('[data-ref="dialogInput"]');
      const inputWrap = modal.querySelector('[data-ref="dialogInputWrap"]');
      const confirmBody = modal.querySelector('[data-ref="dialogConfirmBody"]');
      const submitBtn = modal.querySelector('[data-ref="dialogSubmit"]');
      const form = modal.querySelector('[data-ref="dialogForm"]');

      titleEl.textContent = title;
      labelEl.textContent = label;
      inputEl.placeholder = placeholder;
      inputEl.value = defaultValue;
      inputWrap.style.display = 'flex';
      confirmBody.style.display = 'none';

      submitBtn.textContent = confirmText;
      submitBtn.classList.remove('danger');
      submitBtn.classList.add('primary');

      let resolved = false;
      const cleanup = () => {
        modal.classList.remove('active');
        document.removeEventListener('keydown', onKey);
      };

      const doResolve = (val) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(val);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          doResolve(null);
        }
      };

      form.onsubmit = (e) => {
        e.preventDefault();
        const val = inputEl.value.trim();
        if (!val) return;
        doResolve(val);
      };

      modal.querySelector('[data-action="dialog-close"]').onclick = () => doResolve(null);
      modal.querySelector('[data-action="dialog-cancel"]').onclick = () => doResolve(null);
      modal.onclick = (e) => {
        if (e.target === modal) doResolve(null);
      };

      document.addEventListener('keydown', onKey);
      modal.classList.add('active');
      setTimeout(() => {
        inputEl.focus();
        inputEl.select();
      }, 50);
    });
  }

  showConfirm({ title = '确认操作', message = '', danger = false, confirmText = '确定', cancelText = '取消' } = {}) {
    return new Promise((resolve) => {
      const modal = this.ensureDialogDOM();
      const titleEl = modal.querySelector('[data-ref="dialogTitle"]');
      const inputWrap = modal.querySelector('[data-ref="dialogInputWrap"]');
      const confirmBody = modal.querySelector('[data-ref="dialogConfirmBody"]');
      const msgEl = modal.querySelector('[data-ref="dialogMessage"]');
      const submitBtn = modal.querySelector('[data-ref="dialogSubmit"]');
      const cancelBtn = modal.querySelector('[data-action="dialog-cancel"]');
      const form = modal.querySelector('[data-ref="dialogForm"]');

      titleEl.textContent = title;
      msgEl.textContent = message;
      inputWrap.style.display = 'none';
      confirmBody.style.display = 'block';

      cancelBtn.textContent = cancelText;
      submitBtn.textContent = confirmText;
      if (danger) {
        submitBtn.classList.add('danger');
        submitBtn.classList.remove('primary');
      } else {
        submitBtn.classList.remove('danger');
        submitBtn.classList.add('primary');
      }

      let resolved = false;
      const cleanup = () => {
        modal.classList.remove('active');
        document.removeEventListener('keydown', onKey);
      };

      const doResolve = (val) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(val);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          doResolve(false);
        }
      };

      form.onsubmit = (e) => {
        e.preventDefault();
        doResolve(true);
      };

      modal.querySelector('[data-action="dialog-close"]').onclick = () => doResolve(false);
      modal.querySelector('[data-action="dialog-cancel"]').onclick = () => doResolve(false);
      modal.onclick = (e) => {
        if (e.target === modal) doResolve(false);
      };

      document.addEventListener('keydown', onKey);
      modal.classList.add('active');
      setTimeout(() => submitBtn.focus(), 50);
    });
  }

  showToast(msg, isError = false) {
    let toastEl = document.getElementById('assetLibraryToast');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'assetLibraryToast';
      toastEl.className = 'asset-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', isError);
    toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2400);
  }

  async handleNewLibrary() {
    const name = await this.showPrompt({
      title: '新建资产库',
      label: '资产库名称',
      placeholder: '请输入资产库名称...',
      defaultValue: '',
      confirmText: '新建'
    });
    if (!name) return;

    try {
      const res = await fetch('/api/asset-library/libraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '创建资产库失败');
      }
      const data = await res.json();
      const newLib = data.asset_library;
      if (newLib?.id) {
        this.activeLibraryId = newLib.id;
        this.activeCategoryId = '';
      }
      await this.load();
      this.showToast(`资产库“${name}”创建成功`);
    } catch (e) {
      this.showToast(e.message || '创建资产库失败', true);
    }
  }

  async handleNewCategory() {
    const curLib = this.getCurrentLibrary();
    if (!curLib) {
      this.showToast('请先选择或新建一个资产库', true);
      return;
    }
    const isWf = this.activeTab === 'workflows';
    const name = await this.showPrompt({
      title: isWf ? '新建工作流分组' : '新建分组',
      label: '分组名称',
      placeholder: '请输入分组名称...',
      defaultValue: '',
      confirmText: '新建'
    });
    if (!name) return;

    try {
      const res = await fetch('/api/asset-library/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          library_id: this.activeLibraryId,
          name,
          type: isWf ? 'workflow' : 'image'
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '创建分组失败');
      }
      const data = await res.json();
      if (data.category?.id) {
        this.activeCategoryId = data.category.id;
      }
      await this.load();
      this.showToast(`分组“${name}”创建成功`);
    } catch (e) {
      this.showToast(e.message || '创建分组失败', true);
    }
  }

  async handleDeleteLibrary(libId, libName) {
    const libs = this.assetLibrary.libraries || [];
    if (libs.length <= 1) {
      this.showToast('至少保留一个资产库，无法删除', true);
      return;
    }
    const ok = await this.showConfirm({
      title: '删除资产库',
      message: `确定要删除资产库“${libName}”吗？\n该库内的分组与素材将被清除。`,
      danger: true,
      confirmText: '删除'
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/asset-library/libraries/${encodeURIComponent(libId)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '删除资产库失败');
      }
      if (this.activeLibraryId === libId) {
        const remaining = libs.filter(l => l.id !== libId);
        this.activeLibraryId = remaining[0]?.id || 'default';
        this.activeCategoryId = '';
      }
      await this.load();
      this.showToast(`已删除资产库“${libName}”`);
    } catch (e) {
      this.showToast(e.message || '删除资产库失败', true);
    }
  }

  async handleDeleteCategory(catId, catName) {
    const ok = await this.showConfirm({
      title: '删除分组',
      message: `确定要删除分组“${catName}”吗？\n分组内的素材将被物理删除或移至未分类。`,
      danger: true,
      confirmText: '删除'
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/asset-library/categories/${encodeURIComponent(catId)}?library_id=${encodeURIComponent(this.activeLibraryId)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '删除分组失败');
      }
      if (this.activeCategoryId === catId) {
        this.activeCategoryId = '';
      }
      await this.load();
      this.showToast(`已删除分组“${catName}”`);
    } catch (e) {
      this.showToast(e.message || '删除分组失败', true);
    }
  }
}
