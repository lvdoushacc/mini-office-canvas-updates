import { BaseManager } from "./base-manager.js";
import { store } from "../../common/store.js";
import { apiClient } from "../../common/api-client.js";

// 画布 iframe 的版本令牌。它同时是「iframe 是否需要重新加载」的判断依据：
// 只要画布前端代码（smart-canvas.js / smart-canvas.html / 相关 CSS）有改动，
// 必须递增此常量，否则嵌套 iframe 会继续复用内存里的旧脚本，改动看不到效果。
const CANVAS_FRAME_VERSION = '2026.09.19.canvas_split_p7_delete_empty';

/**
 * ProjectManager: 统一管理项目创建/重命名/删除/恢复/收藏、画布管理与工作台视图切换
 */
export class ProjectManager extends BaseManager {

  openNewProjectDialog() {


    if (this.newCanvasModal) {


      if (this.newCanvasTitleInput) {


        this.newCanvasTitleInput.value = '';


      }


      if (this.newCanvasErrorHint) {


        this.newCanvasErrorHint.style.display = 'none';


        this.newCanvasErrorHint.textContent = '';


      }


      if (this.btnSubmitNewCanvas) {


        this.btnSubmitNewCanvas.disabled = false;


        this.btnSubmitNewCanvas.textContent = '创建';


      }


      this.newCanvasModal.classList.add('active');


      setTimeout(() => {


        if (this.newCanvasTitleInput) {


          this.newCanvasTitleInput.focus();


        }


      }, 60);


    }


  }

  closeNewProjectDialog() {


    if (this.newCanvasModal) {


      this.newCanvasModal.classList.remove('active');


      if (this.newCanvasErrorHint) {


        this.newCanvasErrorHint.style.display = 'none';


        this.newCanvasErrorHint.textContent = '';


      }


    }


  }

  openNewCanvasDialog() {


    this.openNewProjectDialog();


  }

  closeNewCanvasDialog() {


    this.closeNewProjectDialog();


  }

  openRenameProjectDialog(project) {


    if (!project || !this.renameProjectModal) return;


    this.renamingProject = project;


    if (this.renameProjectTitleInput) {


      this.renameProjectTitleInput.value = project.name || '';


    }


    if (this.renameProjectErrorHint) {


      this.renameProjectErrorHint.style.display = 'none';


      this.renameProjectErrorHint.textContent = '';


    }


    if (this.btnSubmitRenameProject) {


      this.btnSubmitRenameProject.disabled = false;


      this.btnSubmitRenameProject.textContent = '保存';


    }


    this.renameProjectModal.classList.add('active');


    setTimeout(() => {


      if (this.renameProjectTitleInput) {


        this.renameProjectTitleInput.focus();


        this.renameProjectTitleInput.select();


      }


    }, 60);


  }

  closeRenameProjectDialog() {


    if (this.renameProjectModal) {


      this.renameProjectModal.classList.remove('active');


      if (this.renameProjectErrorHint) {


        this.renameProjectErrorHint.style.display = 'none';


        this.renameProjectErrorHint.textContent = '';


      }


    }


    this.renamingProject = null;


  }

  async handleRenameProjectSubmit(e) {


    if (e && e.preventDefault) e.preventDefault();


    if (!this.renamingProject) return;





    const input = this.renameProjectTitleInput;


    const errorHint = this.renameProjectErrorHint;


    const submitBtn = this.btnSubmitRenameProject;


    const newName = (input?.value || '').trim();





    if (!newName) {


      if (errorHint) {


        errorHint.textContent = '项目名称不能为空';


        errorHint.style.display = 'block';


      }


      return;


    }





    // 如果名称未变，直接关闭


    if (newName === this.renamingProject.name) {


      this.closeRenameProjectDialog();


      return;


    }





    try {


      if (submitBtn) {


        submitBtn.disabled = true;


        submitBtn.textContent = '保存中...';


      }


      if (errorHint) {


        errorHint.style.display = 'none';


        errorHint.textContent = '';


      }





      const resp = await fetch(`/api/projects/${encodeURIComponent(this.renamingProject.id)}`, {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({ name: newName })


      });





      if (!resp.ok) {


        const data = await resp.json().catch(() => ({}));


        throw new Error(data.detail || `保存失败 (HTTP ${resp.status})`);


      }





      const result = await resp.json();


      const updatedProject = result.project || { ...this.renamingProject, name: newName };





      // 更新本地项目数据


      if (Array.isArray(this.projectsData)) {


        const idx = this.projectsData.findIndex(p => p.id === this.renamingProject.id);


        if (idx !== -1) {


          this.projectsData[idx] = { ...this.projectsData[idx], ...updatedProject };


        }


      }





      this.closeRenameProjectDialog();


      // 重新渲染项目卡片


      await this.loadAndRenderPortals();


    } catch (err) {


      console.error('[App] 修改项目名称失败:', err);


      if (errorHint) {


        errorHint.textContent = err.message || '保存项目名称失败，请重试';


        errorHint.style.display = 'block';


      }


    } finally {


      if (submitBtn) {


        submitBtn.disabled = false;


        submitBtn.textContent = '保存';


      }


    }


  }

  async handleCreateProjectSubmit(e) {


    if (e) e.preventDefault();


    if (!this.newCanvasTitleInput) return;





    const rawTitle = this.newCanvasTitleInput.value;


    const name = (rawTitle || '').trim();





    // 需求 4: “新建项目”必须要求非空项目名称；空名称不得发送创建请求


    if (!name) {


      if (this.newCanvasErrorHint) {


        this.newCanvasErrorHint.textContent = '请输入项目名';


        this.newCanvasErrorHint.style.display = 'block';


      }


      this.newCanvasTitleInput.focus();


      return;


    }





    if (this.newCanvasErrorHint) {


      this.newCanvasErrorHint.style.display = 'none';


      this.newCanvasErrorHint.textContent = '';


    }





    if (this.btnSubmitNewCanvas) {


      this.btnSubmitNewCanvas.disabled = true;


      this.btnSubmitNewCanvas.textContent = '创建中..';


    }





    try {


      // 需求5: POST /api/projects {name}


      const projRes = await fetch('/api/projects', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({ name })


      });





      if (!projRes.ok) {


        const errorDetail = await projRes.text().catch(() => '');


        throw new Error(`创建项目失败 (${projRes.status}): ${errorDetail || projRes.statusText}`);


      }





      const projData = await projRes.json();


      const project = projData?.project;


      if (!project || !project.id) {


        throw new Error('服务端返回项目数据异');


      }





      // 需求5: 成功后 POST /api/canvases {title: project.name, icon: "sparkles", kind: "smart", project: project.id}


      const canvasRes = await fetch('/api/canvases', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({


          title: project.name || name,


          icon: 'sparkles',


          kind: 'smart',


          project: project.id


        })


      });





      if (!canvasRes.ok) {
        const errorDetail = await canvasRes.text().catch(() => '');
        try {
          const rollbackRes = await fetch(`/api/projects/${encodeURIComponent(project.id)}?permanent=true`, { method: 'DELETE' });
          if (!rollbackRes.ok) {
            throw new Error(`项目回滚失败 (${rollbackRes.status})`);
          }
        } catch (rollbackErr) {
          throw new Error(`创建画布失败，项目已创建但自动回滚失败，请到回收站处理。${rollbackErr.message || ''}`);
        }
        throw new Error(`创建画布失败 (${canvasRes.status})：项目已自动回滚。${errorDetail || canvasRes.statusText}`);
      }





      const canvasData = await canvasRes.json();


      const canvas = canvasData?.canvas;


      if (!canvas || !canvas.id) {
        try {
          const rollbackRes = await fetch(`/api/projects/${encodeURIComponent(project.id)}?permanent=true`, { method: 'DELETE' });
          if (!rollbackRes.ok) throw new Error(`项目回滚失败 (${rollbackRes.status})`);
        } catch (rollbackErr) {
          throw new Error(`服务端未返回有效画布，项目已创建但自动回滚失败，请到回收站处理。${rollbackErr.message || ''}`);
        }
        throw new Error('服务端未返回有效画布，项目已自动回滚。');
      }





      // 需求5: 成功后进入该项目对应的现有 smart-canvas iframe


      this.closeNewProjectDialog();


      this.showWorkspace(project.name || name, canvas.id, project.id);


    } catch (err) {


      console.error('[App] 创建项目与画布失败', err);


      if (this.newCanvasErrorHint) {


        this.newCanvasErrorHint.textContent = `创建失败: ${err.message || '未知错误'}`;


        this.newCanvasErrorHint.style.display = 'block';


      }


      if (this.btnSubmitNewCanvas) {


        this.btnSubmitNewCanvas.disabled = false;


        this.btnSubmitNewCanvas.textContent = '创建';


      }


    }


  }

  handleCreateCanvasSubmit(e) {


    return this.handleCreateProjectSubmit(e);


  }

  async loadAndRenderPortals() {


    const container = document.getElementById('dynamicPortalsContainer');


    if (!container) return;





    // 递增请求序号并捕获当前发起 tab，防止快速切 tab 时陈旧网络响应串台覆盖


    this.portalRequestId = (this.portalRequestId || 0) + 1;


    const currentReqId = this.portalRequestId;


    const requestTab = this.currentHomeTab || 'my';





    const isTrash = requestTab === 'trash';


    // 回收站模式优先查询 /api/projects?include_deleted=true，完全兼容旧版与新版后台进程。


    // 杜绝因旧进程缺失 /api/projects/trash 路由而触发 405 Method Not Allowed


    const projUrl = isTrash ? '/api/projects?include_deleted=true' : '/api/projects';





    try {


      let [projRes, canvasRes] = await Promise.all([


        fetch(projUrl).catch(() => null),


        fetch('/api/canvases').catch(() => null)


      ]);





      // 容错降级：若带参请求异常则降级请求基础 /api/projects


      if (isTrash && projRes && (projRes.status === 404 || projRes.status === 405)) {
        projRes = await fetch('/api/projects').catch(() => null);
      }





      // 验证当前请求是否被后续切换操作作废


      if (currentReqId !== this.portalRequestId || requestTab !== (this.currentHomeTab || 'my')) {


        return;


      }





      // 严格检查服务端响应，若请求失败展示真实错误信息，严禁静默伪装成空项目


      if (!projRes || !projRes.ok) {


        let errorMsg = `获取项目列表失败 (HTTP ${projRes ? projRes.status : 'ERR'})`;


        try {


          const errJson = await projRes.json();


          if (errJson && errJson.detail) errorMsg = errJson.detail;


        } catch (_) {


          try {


            const errText = await projRes.text();


            if (errText) errorMsg = errText;


          } catch (__) {}


        }





        container.innerHTML = `


          <div class="portals-empty-state">


            <div class="empty-icon" style="color: #ef4444;">⚠️</div>


            <div class="empty-title">加载项目失败</div>


            <div class="empty-sub">${this.escapeHtml(errorMsg)}</div>


            <button class="portal-action-btn restore-btn" style="margin-top: 14px; height: 28px; padding: 0 16px; opacity: 1;" type="button">重新加载</button>


          </div>


        `;


        const retryBtn = container.querySelector('button');


        if (retryBtn) {


          retryBtn.addEventListener('click', () => this.loadAndRenderPortals());


        }


        return;


      }





      const projData = await projRes.json();


      const projects = Array.isArray(projData?.projects) ? projData.projects : [];





      let canvases = [];


      if (canvasRes && canvasRes.ok) {


        try {


          const canvasData = await canvasRes.json();


          canvases = Array.isArray(canvasData?.canvases) ? canvasData.canvases : [];


        } catch (_) {}


      }





      this.renderPortals(projects, canvases);





      // 重新渲染后即刻应用当前的搜索关键字过滤状态


      this.applyCurrentSearch();


    } catch (err) {


      if (currentReqId !== this.portalRequestId || requestTab !== (this.currentHomeTab || 'my')) {


        return;


      }


      console.error('[App] 加载项目与画布列表网络异常', err);


      container.innerHTML = `


        <div class="portals-empty-state">


          <div class="empty-icon" style="color: #ef4444;">⚠️</div>


          <div class="empty-title">网络连接失败</div>


          <div class="empty-sub">${this.escapeHtml(err.message || '无法连接到后端服务，请检查服务运行状态')}</div>


          <button class="portal-action-btn restore-btn" style="margin-top: 14px; height: 28px; padding: 0 16px; opacity: 1;" type="button">重新加载</button>


        </div>


      `;


      const retryBtn = container.querySelector('button');


      if (retryBtn) {


        retryBtn.addEventListener('click', () => this.loadAndRenderPortals());


      }


    }


  }

  applyCurrentSearch() {


    if (!this.commandInput) return;


    const query = this.commandInput.value.trim().toLowerCase();


    const currentPortals = document.querySelectorAll('.canvas-portal');


    currentPortals.forEach(portal => {


      const title = portal.querySelector('.portal-title')?.textContent.toLowerCase() || '';


      if (!query || title.includes(query)) {


        portal.style.opacity = '1';


        portal.style.pointerEvents = 'auto';


      } else {


        portal.style.opacity = '0.2';


        portal.style.pointerEvents = 'none';


      }


    });


    const createCard = document.querySelector('.portal-create-card');


    if (createCard) {


      createCard.style.opacity = query ? '0.3' : '1';


      createCard.style.pointerEvents = query ? 'none' : 'auto';


    }


  }

  renderPortals(projects, canvases) {
    const container = document.getElementById('dynamicPortalsContainer');
    if (!container) return;

    const tab = this.currentHomeTab || 'my';
    let filteredProjects = [];

    if (tab === 'trash') {
      // 回收站：仅展示已被软删除的项目
      filteredProjects = (projects || []).filter(p => Boolean(p.deleted || p.deleted_at));
    } else if (tab === 'favorites') {
      // 严格按真实项目字段过滤收藏；数据缺失时展示真实空状态，不伪造成收藏
      filteredProjects = (projects || []).filter(p => !p.deleted && !p.deleted_at && Boolean(p.favorite || p.is_favorite || p.starred || p.isFavorite));
    } else {
      // 'my' / 默认活跃项目列表：排除已删除项目
      filteredProjects = (projects || []).filter(p => !p.deleted && !p.deleted_at);
    }

    // 首页固定按最近更新优先，保持项目列表稳定且无需额外排序控件。
    filteredProjects.sort((a, b) => {
      const ua = Number(a.updated_at || a.created_at || 0);
      const ub = Number(b.updated_at || b.created_at || 0);
      if (ua !== ub) return ub - ua;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const canvasesByProject = new Map();
    (canvases || []).forEach(c => {
      const pid = c.project || 'default';
      if (!canvasesByProject.has(pid)) {
        canvasesByProject.set(pid, []);
      }
      canvasesByProject.get(pid).push(c);
    });

    // Empty states (trash / favorites) — rare; full replace is fine
    if (!filteredProjects || filteredProjects.length === 0) {
      if (tab === 'trash') {
        container.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'portals-empty-state';
        empty.innerHTML = `
            <div class="empty-icon">🗑</div>
            <div class="empty-title">回收站暂无项目</div>
            <div class="empty-sub">删除到回收站的项目会显示在此处，可随时恢复</div>
        `;
        container.appendChild(empty);
        return;
      }
      if (tab === 'favorites') {
        container.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'portals-empty-state';
        empty.innerHTML = `
            <div class="empty-icon">★</div>
            <div class="empty-title">暂无收藏项目</div>
            <div class="empty-sub">在「我的项目」卡片右上角点星即可加入收藏</div>
        `;
        container.appendChild(empty);
        return;
      }
      // 'my' with only create card below
    }

    const existingPortals = new Map();
    container.querySelectorAll('.canvas-portal[data-project-id]').forEach(el => {
      existingPortals.set(el.dataset.projectId, el);
    });
    let createCard = container.querySelector('.portal-create-card');
    const ordered = [];

    // 在「我的项目」视图下，固定置一枚等比呼吸感的「新建项目」引导卡片
    if (tab === 'my') {
      if (!createCard) {
        createCard = document.createElement('article');
        createCard.className = 'portal-create-card';
        createCard.title = '新建画布';
        createCard.innerHTML = `
        <div class="portal-create-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </div>
        <div class="portal-create-label">新建画布</div>
        <div class="portal-create-sub">创建新的画布与工作空间</div>
      `;
        createCard.addEventListener('click', () => {
          this.openNewProjectDialog();
        });
      }
      ordered.push(createCard);
    }

    if ((!filteredProjects || filteredProjects.length === 0) && tab === 'my') {
      container.replaceChildren(...ordered);
      return;
    }

    filteredProjects.forEach(project => {
      const projCanvases = canvasesByProject.get(project.id) || [];
      const primaryCanvas = projCanvases[0] || null;
      const timeStr = this.formatRelativeTime(project.updated_at || project.created_at || primaryCanvas?.updated_at || primaryCanvas?.created_at);
      const projectName = project.name || '未命名项目';
      const nodeCount = projCanvases.reduce((sum, c) => sum + Number(c.node_count || 0), 0);
      const isFavorite = Boolean(project.favorite || project.is_favorite || project.starred);
      const sig = [tab, projectName, timeStr, nodeCount, isFavorite ? 1 : 0, primaryCanvas?.id || ''].join('|');

      let portalEl = existingPortals.get(project.id);
      const needsRebuild = !portalEl || portalEl.dataset.renderSig !== sig;

      if (!portalEl) {
        portalEl = document.createElement('article');
        portalEl.className = 'canvas-portal';
        portalEl.dataset.projectId = project.id;
      }

      portalEl.dataset.projectId = project.id;
      if (primaryCanvas) {
        portalEl.dataset.canvasId = primaryCanvas.id;
      } else {
        delete portalEl.dataset.canvasId;
      }
      portalEl.dataset.project = projectName;

      if (needsRebuild) {
        portalEl.dataset.renderSig = sig;
        // Clone node to drop stale listeners when content changes
        const fresh = portalEl.cloneNode(false);
        fresh.dataset.renderSig = sig;
        fresh.dataset.projectId = project.id;
        if (primaryCanvas) fresh.dataset.canvasId = primaryCanvas.id;
        fresh.dataset.project = projectName;
        portalEl = fresh;

        if (tab === 'trash') {
          portalEl.title = `回收站项目：${projectName}（点击可恢复）`;
          portalEl.innerHTML = `
          <header class="portal-header">
            <div class="portal-title-group">
              <span class="portal-window-dot" style="background-color: #ef4444;"></span>
              <h3 class="portal-title">${this.escapeHtml(projectName)}</h3>
              <span class="portal-trash-badge">已删除</span>
            </div>
            <div class="portal-meta-right">
              <span class="portal-time">${timeStr}</span>
              <button class="portal-action-btn restore-btn" title="从回收站恢复此项目" type="button">
                <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                <span>恢复</span>
              </button>
              <button class="portal-action-btn delete-forever-btn" title="永久删除此项目" type="button">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                <span>永久删除</span>
              </button>
            </div>
          </header>
          <div class="portal-viewport">
            ${nodeCount > 0 ? `
              <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; pointer-events:none;">
                <div class="portal-node node-ai" style="position:static;">
                  <span class="portal-spark">✦</span>
                  <span>包含 ${nodeCount} 个创作要点</span>
                  <span class="portal-ready-dot"></span>
                </div>
              </div>
            ` : `
              <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:var(--text-3); font-size:12px; gap:6px; pointer-events:none;">
                <span>空白画布</span>
              </div>
            `}
          </div>
        `;
          const restoreBtn = portalEl.querySelector('.restore-btn');
          if (restoreBtn) {
            restoreBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleRestoreProject(project);
            });
          }
          const deleteForeverBtn = portalEl.querySelector('.delete-forever-btn');
          if (deleteForeverBtn) {
            deleteForeverBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleDeleteForeverProject(project);
            });
          }
          portalEl.addEventListener('click', () => {
            this.handleRestoreProject(project);
          });
        } else {
          portalEl.title = `打开项目：${projectName}`;
          portalEl.innerHTML = `
          <header class="portal-header">
            <div class="portal-title-group">
              <span class="portal-window-dot"></span>
              <h3 class="portal-title">${this.escapeHtml(projectName)}</h3>
              ${isFavorite ? '<span class="portal-starred-badge" title="已收藏">★</span>' : ''}
            </div>
            <div class="portal-meta-right">
              <div class="portal-menu-wrapper">
                <button class="portal-action-btn portal-more-btn" title="项目选项" type="button" aria-label="项目选项">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <circle cx="12" cy="5" r="1.75"/>
                    <circle cx="12" cy="12" r="1.75"/>
                    <circle cx="12" cy="19" r="1.75"/>
                  </svg>
                </button>
                <div class="portal-dropdown-menu">
                  <button class="portal-dropdown-item menu-item-favorite ${isFavorite ? 'active' : ''}" type="button">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="${isFavorite ? 'currentColor' : 'none'}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span>${isFavorite ? '取消收藏' : '收藏项目'}</span>
                  </button>
                  <button class="portal-dropdown-item menu-item-rename" type="button">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    <span>修改项目名称</span>
                  </button>
                  <div class="portal-dropdown-divider"></div>
                  <button class="portal-dropdown-item menu-item-delete danger" type="button">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    <span>移入回收站</span>
                  </button>
                </div>
              </div>
            </div>
          </header>
          <div class="portal-viewport">
            ${nodeCount > 0 ? `
              <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; pointer-events:none;">
                <div class="portal-node node-ai" style="position:static;">
                  <span class="portal-spark">✦</span>
                  <span>包含 ${nodeCount} 个创作要点</span>
                  <span class="portal-ready-dot"></span>
                </div>
              </div>
            ` : `
              <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:var(--text-3); font-size:12px; gap:6px; pointer-events:none;">
                <span>空白画布</span>
              </div>
            `}
          </div>
          <div class="portal-footer">
            <span class="portal-footer-time">${timeStr}</span>
            <span class="portal-footer-tag">项目</span>
          </div>
        `;
          const menuWrapper = portalEl.querySelector('.portal-menu-wrapper');
          const moreBtn = portalEl.querySelector('.portal-more-btn');
          const favBtn = portalEl.querySelector('.menu-item-favorite');
          const renameBtn = portalEl.querySelector('.menu-item-rename');
          const delBtn = portalEl.querySelector('.menu-item-delete');
          if (moreBtn && menuWrapper) {
            moreBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              document.querySelectorAll('.portal-menu-wrapper.open').forEach(w => {
                if (w !== menuWrapper) w.classList.remove('open');
              });
              menuWrapper.classList.toggle('open');
            });
          }
          if (favBtn) {
            favBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (menuWrapper) menuWrapper.classList.remove('open');
              this.handleToggleFavoriteProject(project);
            });
          }
          if (renameBtn) {
            renameBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (menuWrapper) menuWrapper.classList.remove('open');
              this.openRenameProjectDialog(project);
            });
          }
          if (delBtn) {
            delBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (menuWrapper) menuWrapper.classList.remove('open');
              this.handleTrashProject(project);
            });
          }
          portalEl.addEventListener('click', () => {
            this.openProject(project, primaryCanvas);
          });
        }
      }

      ordered.push(portalEl);
      existingPortals.delete(project.id);
    });

    // Reuse nodes in place via replaceChildren (moves existing DOM; drops orphans)
    container.replaceChildren(...ordered);
  }

  async handleToggleFavoriteProject(project) {


    if (!project || !project.id) return;


    const nextState = !Boolean(project.favorite || project.is_favorite);


    project.favorite = nextState;


    project.is_favorite = nextState;





    try {


      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/favorite`, {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({ favorite: nextState })


      });


      if (!res.ok) {


        const fallbackRes = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {


          method: 'POST',


          headers: { 'Content-Type': 'application/json' },


          body: JSON.stringify({ favorite: nextState })


        });


        if (!fallbackRes.ok) {


          throw new Error('更新收藏状态失');


        }


      }


      await this.loadAndRenderPortals();


    } catch (err) {


      console.error('[App] 收藏操作失败:', err);


      project.favorite = !nextState;


      project.is_favorite = !nextState;


      await this.loadAndRenderPortals();


    }


  }

  async handleTrashProject(project) {


    if (!project || !project.id) return;





    const projectName = project.name || '未命名项目';


    const confirmed = await this.confirm({


      title: '移入回收站',


      message: `确定要将项目“${projectName}”移入回收站吗？\n\n移入后该项目及其关联画布与媒体资产将完好保留，您随时可以在侧边栏“回收站”中将其恢复。`,


      confirmText: '移入回收站',


      cancelText: '取消',


      danger: true


    });


    if (!confirmed) return;





    try {


      let res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/trash`, {


        method: 'POST'


      });


      // 软删除接口不可用时必须停止，不能把“移入回收站”误变成永久删除。
      if (res.status === 404 || res.status === 405) {
        throw new Error('当前服务不支持回收站功能，请先更新服务后重试');
      }


      if (!res.ok) {


        const errData = await res.json().catch(() => ({}));


        throw new Error(errData.detail || `移入回收站失败（${res.status}）`);


      }


      await this.loadAndRenderPortals();


    } catch (err) {


      console.error('[App] 移入回收站失败', err);


      await this.alert(`移入回收站失败：${err.message || '未知错误'}`, '操作失败');


    }


  }

  async handleDeleteForeverProject(project) {


    if (!project || !project.id) return;





    const projectName = project.name || '未命名项目';


    const confirmed = await this.confirm({


      title: '彻底删除项目',


      message: `确定要彻底删除项目“${projectName}”吗？\n\n此操作不可撤销。项目文件、关联画布、画布备份和不再被其他画布使用的媒体将一起永久删除。`,


      confirmText: '彻底删除',


      cancelText: '取消',


      danger: true


    });


    if (!confirmed) return;





    try {


      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}?permanent=true`, {


        method: 'DELETE'


      });


      if (!res.ok) {


        const errData = await res.json().catch(() => ({}));


        throw new Error(errData.detail || `彻底删除失败 (${res.status})`);


      }


      await this.loadAndRenderPortals();


    } catch (err) {


      console.error('[App] 彻底删除失败:', err);


      await this.alert(`彻底删除失败: ${err.message || '未知错误'}`, '操作失败');


    }


  }

  async handleRestoreProject(project) {


    if (!project || !project.id) return;


    const projectName = project.name || '未命名项目';


    const confirmed = await this.confirm({


      title: '恢复项目',


      message: `确定要恢复项目“${projectName}”吗？\n\n恢复后该项目将重新出现在首页项目列表中。`,


      confirmText: '立即恢复',


      cancelText: '取消'


    });


    if (!confirmed) return;





    try {


      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/restore`, {


        method: 'POST'


      });


      if (!res.ok) {


        const errData = await res.json().catch(() => ({}));


        throw new Error(errData.detail || `恢复项目失败 (${res.status})`);


      }


      await this.loadAndRenderPortals();


    } catch (err) {


      console.error('[App] 恢复项目失败:', err);


      await this.alert(`恢复项目失败: ${err.message || '未知错误'}`, '操作失败');


    }


  }

  async openProject(project, primaryCanvas) {
    if (!project || !project.id) return;
    this.openingProjectIds = this.openingProjectIds || new Set();
    if (this.openingProjectIds.has(project.id)) return;
    this.openProjectRequestId = (this.openProjectRequestId || 0) + 1;
    const requestId = this.openProjectRequestId;
    this.openingProjectIds.add(project.id);
    const isCurrentRequest = () => requestId === this.openProjectRequestId;

    try {


    const projectName = project.name || '未命名项目';


    const projectId = project.id;





    if (primaryCanvas && primaryCanvas.id) {
      if (isCurrentRequest()) this.showWorkspace(projectName, primaryCanvas.id, projectId);


      return;


    }





    // 如果没有传入 primaryCanvas，先从后端查询该项目是否已有画布


    try {


      const res = await fetch('/api/canvases');


      if (res.ok) {


        const data = await res.json();


        const canvases = Array.isArray(data?.canvases) ? data.canvases : [];


        const matched = canvases.find(c => (c.project || 'default') === projectId);


        if (matched && matched.id && isCurrentRequest()) {
          this.showWorkspace(projectName, matched.id, projectId);


          return;


        }


      }


    } catch (err) {


      console.warn('[App] 查询项目归属画布失败:', err);


    }





    if (!isCurrentRequest()) return;

    // 仍无画布：为该项目创建第一张归属于它的真实画布（严格绑定 project.id）
    try {


      const createRes = await fetch('/api/canvases', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({


          title: projectName,


          icon: 'sparkles',


          kind: 'smart',


          project: projectId


        })


      });





      if (createRes.ok) {


        const createData = await createRes.json();


        const canvas = createData?.canvas;


        if (canvas && canvas.id && isCurrentRequest()) {
          this.showWorkspace(projectName, canvas.id, projectId);


          return;


        }


      }


    } catch (createErr) {
      console.error('[App] 为项目创建初始画布失败', createErr);
    }
    } finally {
      // 必须用外层参数 project.id：projectId 是 try 块内的 const，finally 访问不到，
      // 会抛 ReferenceError 导致打开锁永远不释放，第二次点击同一项目被静默拒绝。
      this.openingProjectIds.delete(project.id);
    }
  }

  escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  formatRelativeTime(ts) {


    if (!ts) return '刚刚';


    const diff = Date.now() - Number(ts);


    if (diff < 60000) return '刚刚';


    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;


    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;


    return `${Math.floor(diff / 86400000)}天前`;


  }

  getOrCreateCanvasId(projectName) {


    const slug = (projectName || 'default').trim().toLowerCase().replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');


    return `proj_${slug}`;


  }

  async createNewCanvas() {


    try {


      const res = await fetch('/api/canvases', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({


          title: '新建画布',


          icon: 'sparkles',


          kind: 'smart'


        })


      });


      if (res.ok) {


        const data = await res.json();


        if (data && data.canvas && data.canvas.id) {


          this.showWorkspace(data.canvas.title || '新建画布', data.canvas.id);


          return;


        }


      }


    } catch (e) {


      console.warn('[App] 新建画布 API 异常，回退为本地唯一 ID:', e);


    }


    const fallbackId = `canvas_${Date.now()}`;


    this.showWorkspace('新建画布', fallbackId);


  }

  showWorkspace(projectName, explicitCanvasId, projectId, isLan = false, collaborationId = '') {


    console.log('[showWorkspace] called with:', projectName, explicitCanvasId, projectId);


    this.currentProject = projectName || this.currentProject || '未命名项目';


    this.currentProjectId = projectId || this.currentProjectId || '';


    if (this.currentProjectTitle) {


      this.currentProjectTitle.textContent = this.currentProject;


    }





    this.welcomeView.classList.remove('active');


    this.homeView.classList.remove('active');


    if (this.lanView) this.lanView.classList.remove('active');


    this.stopLanDiscovery();


    this.stopLanHeartbeat();


    this.workspaceView.classList.add('active');





    // 载入真实 smart-canvas


    let canvasId = explicitCanvasId;
    if (!canvasId && this.canvases && this.canvases.length) {
      const pid = projectId || this.currentProjectId;
      const matched = this.canvases.find(c => {
        if (pid && (c.project === pid || (c.project || 'default') === pid)) return true;
        if (this.currentProject && (c.title === this.currentProject || c.project === this.currentProject)) return true;
        return false;
      });
      if (matched && matched.id) {
        canvasId = matched.id;
      }
    }
    if (!canvasId) {
      canvasId = this.getOrCreateCanvasId(this.currentProject);
    }


    console.log('[showWorkspace] canvasId resolved to:', canvasId);





    // 把当前画布写入主页面 URL，浏览器刷新后可恢复到同一画布。


    try {


      const workspaceUrl = new URL(window.location);


      workspaceUrl.searchParams.set('view', 'workspace');


      workspaceUrl.searchParams.set('project', this.currentProject);


      workspaceUrl.searchParams.set('id', canvasId);


      if (this.currentProjectId) workspaceUrl.searchParams.set('project_id', this.currentProjectId);
      else workspaceUrl.searchParams.delete('project_id');
      if (isLan) workspaceUrl.searchParams.set('mode', 'lan');
      else workspaceUrl.searchParams.delete('mode');
      window.history.replaceState({}, '', workspaceUrl);


    } catch (e) {}





    const frame = document.getElementById('xxdpCanvasFrame');


    console.log('[showWorkspace] frame element found:', !!frame);


    if (frame) {
      const activeHostRoom = this.lanHostCurrentRoom || (() => {
        try {
          const s = localStorage.getItem('xxdp_lan_host_room');
          return s ? JSON.parse(s) : null;
        } catch(e) { return null; }
      })();

      const isMatchingHostRoom = Boolean(
        activeHostRoom &&
        activeHostRoom.status === 'open' &&
        (
          (canvasId && activeHostRoom.canvasId === canvasId) ||
          (projectId && activeHostRoom.projectId === projectId) ||
          (this.currentProjectId && activeHostRoom.projectId === this.currentProjectId) ||
          (projectName && activeHostRoom.projectName === projectName)
        )
      );

      const isLanMode = Boolean(isLan || (canvasId && canvasId.startsWith('lan_')) || isMatchingHostRoom);
      this.updateLanModeBadge(isLanMode ? 'lan' : 'personal');
      const lanParam = isLanMode ? '&mode=lan' : '';
      let hostParam = '';
      let roomAuthParam = '';
      if (isLanMode && this.lanCurrentSession && this.lanCurrentSession.role === 'client' && this.lanCurrentSession.targetHost) {
        hostParam = `&host=${encodeURIComponent(this.lanCurrentSession.targetHost)}`;
        const session = this.lanCurrentSession;
        roomAuthParam = `&roomId=${encodeURIComponent(session.roomId || '')}&memberId=${encodeURIComponent(session.memberId || '')}&sessionId=${encodeURIComponent(session.sessionId || '')}`;
        try {
          localStorage.setItem('lan_target_host', this.lanCurrentSession.targetHost);
          localStorage.setItem('lan_room_id', session.roomId || '');
          if (this.lanCurrentSession.sessionId) {
            localStorage.setItem('lan_session_id', this.lanCurrentSession.sessionId);
          }
          if (this.lanCurrentSession.memberId) {
            localStorage.setItem('lan_member_id', this.lanCurrentSession.memberId);
          }
        } catch(e) {}
      } else if (isLanMode && this.lanHostCurrentRoom) {
        const hostRoom = this.lanHostCurrentRoom;
        roomAuthParam = `&roomId=${encodeURIComponent(hostRoom.roomId || '')}&memberId=${encodeURIComponent(hostRoom.hostMemberId || hostRoom.hostId || '')}&sessionId=${encodeURIComponent(hostRoom.hostSessionId || '')}`;
        try {
          localStorage.removeItem('lan_target_host');
          localStorage.setItem('lan_room_id', hostRoom.roomId || '');
          localStorage.setItem('lan_member_id', hostRoom.hostMemberId || hostRoom.hostId || '');
          localStorage.setItem('lan_session_id', hostRoom.hostSessionId || '');
        } catch(e) {}
      }
      const currentTheme = this.app?.currentTheme || this.currentTheme || (typeof store !== 'undefined' && store.getTheme ? store.getTheme() : 'dark');
      const themeParam = `&theme=${encodeURIComponent(currentTheme)}`;
      const targetSrc = `/static/smart-canvas.html?id=${encodeURIComponent(canvasId)}&project=${encodeURIComponent(this.currentProject)}${lanParam}${hostParam}${roomAuthParam}${themeParam}&v=${CANVAS_FRAME_VERSION}`;

      console.log('[showWorkspace] setting frame.src =', targetSrc, '(isLanMode=' + isLanMode + ')');

      if (frame.dataset.canvasId !== canvasId || !frame.src || frame.src.endsWith('about:blank') || !frame.src.includes(`v=${CANVAS_FRAME_VERSION}`) || (isLanMode && !frame.src.includes('mode=lan')) || (!isLanMode && frame.src.includes('mode=lan')) || (hostParam && !frame.src.includes('host=')) || (roomAuthParam && (!frame.src.includes('roomId=') || !frame.src.includes('sessionId=')))) {
        frame.dataset.canvasId = canvasId;
        frame.src = targetSrc;
      } else {
        try {
          frame.contentWindow?.postMessage({ type: 'api_settings_updated' }, '*');
        } catch (_) {}
      }

      // 如果当前不是协同模式，异步探测一次后台当前是否有此项目/画布的活跃协同房间（防刷新时竞态漏判）
      if (!isLanMode) {
        fetch('/api/lan/host/room?_t=' + Date.now()).then(r => r.ok ? r.json() : null).then(data => {
          const room = data?.room;
          if (room && room.status === 'open') {
            this.lanHostCurrentRoom = room;
            try { localStorage.setItem('xxdp_lan_host_room', JSON.stringify(room)); } catch(e) {}
            const matches = Boolean(
              (canvasId && room.canvasId === canvasId) ||
              (projectId && room.projectId === projectId) ||
              (projectName && room.projectName === projectName)
            );
            if (matches && frame && !frame.src.includes('mode=lan')) {
              console.log('[showWorkspace] Late discovered active LAN host room, upgrading frame to mode=lan!');
              this.updateLanModeBadge('lan');
              const lateHostAuth = `&roomId=${encodeURIComponent(room.roomId || '')}&memberId=${encodeURIComponent(room.hostMemberId || room.hostId || '')}&sessionId=${encodeURIComponent(room.hostSessionId || '')}`;
              const newSrc = `/static/smart-canvas.html?id=${encodeURIComponent(canvasId)}&project=${encodeURIComponent(this.currentProject)}&mode=lan${lateHostAuth}${themeParam}&v=${CANVAS_FRAME_VERSION}`;
              frame.src = newSrc;
            }
          }
        }).catch(() => {});
      }
      this.app?.syncFrameTheme?.();
    }


  }

}
