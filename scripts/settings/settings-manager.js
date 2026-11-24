import { BaseManager } from "../home/managers/base-manager.js";
import { store } from "../common/store.js";
import { apiClient } from "../common/api-client.js";

/**
 * SettingsManager: 统一管理本地存储路径、AI 服务商/大模型配置、CLI 探测与设置保存
 */
export class SettingsManager extends BaseManager {

  handleAddManualModel() {
    const provider = this.getSelectedProvider();
    const modelType = String(this.manualModelType?.value || 'image').toLowerCase();
    const modelId = String(this.manualModelInput?.value || '').trim();
    if (!provider || !['image', 'video', 'chat'].includes(modelType)) return;
    if (!modelId) {
      this.showActionResult(false, '请输入模型 ID');
      this.manualModelInput?.focus();
      return;
    }
    const key = `${modelType}_models`;
    const current = Array.isArray(this.providerEdits[provider.id]?.[key])
      ? [...this.providerEdits[provider.id][key]]
      : [...(provider[key] || [])];
    if (current.some(item => String(item).toLowerCase() === modelId.toLowerCase())) {
      this.showActionResult(false, '该模型已经存在');
      return;
    }
    this.providerEdits[provider.id] = this.providerEdits[provider.id] || {};
    this.providerEdits[provider.id][key] = [...current, modelId];
    provider[key] = [...current, modelId];
    if (this.manualModelInput) this.manualModelInput.value = '';
    this.renderSelectedProviderCard();
    this.renderDefaultModelSelectors();
    this.renderProviderList();
    this.updateSummary();
    this.checkSettingsDirty();
    this.showActionResult(true, `已添加${modelType === 'image' ? '图片' : modelType === 'video' ? '视频' : '对话'}模型：${modelId}，点击“保存设置”后生效`);
  }

  handleRemoveManualModel(modelType, modelId) {
    const provider = this.getSelectedProvider();
    const key = `${modelType}_models`;
    if (!provider || !['image', 'video', 'chat'].includes(modelType)) return;
    const current = Array.isArray(this.providerEdits[provider.id]?.[key])
      ? [...this.providerEdits[provider.id][key]]
      : [...(provider[key] || [])];
    const next = current.filter(item => String(item) !== String(modelId));
    if (next.length === current.length) return;
    this.providerEdits[provider.id] = this.providerEdits[provider.id] || {};
    this.providerEdits[provider.id][key] = next;
    provider[key] = next;
    this.renderSelectedProviderCard();
    this.renderDefaultModelSelectors();
    this.renderProviderList();
    this.updateSummary();
    this.checkSettingsDirty();
  }

  handleClearCategoryModels(modelType) {
    const provider = this.getSelectedProvider();
    const key = `${modelType}_models`;
    if (!provider || !['image', 'video', 'chat'].includes(modelType)) return;
    const current = Array.isArray(this.providerEdits[provider.id]?.[key])
      ? [...this.providerEdits[provider.id][key]]
      : [...(provider[key] || [])];
    if (current.length === 0) return;
    this.providerEdits[provider.id] = this.providerEdits[provider.id] || {};
    this.providerEdits[provider.id][key] = [];
    provider[key] = [];
    this.renderSelectedProviderCard();
    this.renderDefaultModelSelectors();
    this.renderProviderList();
    this.updateSummary();
    this.checkSettingsDirty();
    const label = modelType === 'image' ? '图片' : modelType === 'video' ? '视频' : '文本';
    this.showActionResult(true, `已清空${label}模型列表，点击“保存设置”后生效`);
  }

  // ==================== 方案 B: 按类独立挑选模型 ====================
  ensurePickerState() {
    if (!this.pickerCandidateCache) {
      this.pickerCandidateCache = {};
    }
    if (!this.currentPickerState) {
      this.currentPickerState = {
        category: 'image',
        providerId: '',
        candidates: [],
        selectedIds: new Set(),
        existingIds: new Set(),
        filterText: ''
      };
    }
  }

  async openModelPicker(category) {
    this.ensurePickerState();
    const provider = this.getSelectedProvider();
    if (!provider) {
      this.showActionResult(false, '请先在左侧选择一个服务平台');
      return;
    }

    const isCli = provider.protocol === 'codex' || provider.protocol === 'gemini-cli' || String(provider.id || '').includes('cli');
    if (isCli) {
      this.showActionResult(false, 'CLI 本机协议不支持在线拉取网络模型，请在下方手动添加模型');
      return;
    }

    const categoryLabels = { image: '图片', video: '视频', chat: '文本' };
    const categoryLabel = categoryLabels[category] || '模型';

    const edit = this.providerEdits[provider.id] || {};
    const baseUrl = (edit.base_url !== undefined ? edit.base_url : provider.base_url) || '';
    const newKey = edit.new_api_key?.trim();
    const apiKey = newKey ? newKey : undefined;

    if (!baseUrl.trim() && provider.protocol !== 'runninghub') {
      this.showActionResult(false, `请先填写 ${provider.name || provider.id} 的请求地址 (Base URL)`);
      return;
    }

    const key = `${category}_models`;
    const currentModels = Array.isArray(edit[key])
      ? [...edit[key]]
      : Array.isArray(provider[key])
        ? [...provider[key]]
        : [];

    this.currentPickerState = {
      category,
      providerId: provider.id,
      candidates: [],
      selectedIds: new Set(), // 关键：默认 0 个勾选，不强制灌入任何模型
      existingIds: new Set(currentModels),
      filterText: ''
    };

    const modalEl = document.getElementById('modelPickerModal');
    const titleEl = document.getElementById('modelPickerModalTitle');
    const subtitleEl = document.getElementById('modelPickerModalSubtitle');
    const searchInput = document.getElementById('modelPickerSearchInput');
    const clearSearchBtn = document.getElementById('btnModelPickerSearchClear');

    if (titleEl) titleEl.textContent = `挑选${categoryLabel}模型`;
    if (subtitleEl) subtitleEl.textContent = `服务商：${provider.name || provider.id}`;
    if (searchInput) searchInput.value = '';
    if (clearSearchBtn) clearSearchBtn.style.display = 'none';

    this.updatePickerFooterStats();

    if (modalEl) {
      modalEl.classList.add('active');
    }

    // 检查缓存
    const cacheKey = `${provider.id}__${baseUrl}`;
    if (this.pickerCandidateCache[cacheKey]) {
      const cachedData = this.pickerCandidateCache[cacheKey];
      this.currentPickerState.candidates = this.extractCandidatesForCategory(cachedData, category);
      this.renderPickerList('');
      return;
    }

    // 请求上游接口获取候选模型
    const listEl = document.getElementById('modelPickerList');
    if (listEl) {
      listEl.innerHTML = `
        <div class="xxdp-picker-status">
          <div class="xxdp-list-loading">正在拉取服务商实时模型列表 (GET /v1/models)...</div>
        </div>
      `;
    }

    try {
      const res = await fetch('/api/providers/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl,
          api_key: apiKey,
          provider_id: provider.id,
          protocol: provider.protocol || 'openai',
          image_request_mode: provider.image_request_mode || 'openai',
          scope_id: 'personal:default'
        })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok !== false) {
        this.pickerCandidateCache[cacheKey] = data;
        this.currentPickerState.candidates = this.extractCandidatesForCategory(data, category);
        this.renderPickerList('');
      } else {
        const rawMsg = data.detail || data.message || `获取失败 (HTTP ${res.status})`;
        const safeMsg = this.sanitizeSafeText(typeof rawMsg === 'string' ? rawMsg : '获取模型失败');
        if (listEl) {
          listEl.innerHTML = `
            <div class="xxdp-picker-status">
              <div style="color: var(--error); margin-bottom: 8px;">获取服务商模型列表失败</div>
              <div style="font-size: 11px; color: var(--text-muted); max-width: 320px; line-height: 1.4;">${safeMsg}</div>
            </div>
          `;
        }
      }
    } catch (err) {
      if (listEl) {
        listEl.innerHTML = `
          <div class="xxdp-picker-status">
            <div style="color: var(--error); margin-bottom: 8px;">网络连接异常</div>
            <div style="font-size: 11px; color: var(--text-muted);">无法连接后端服务获取模型列表</div>
          </div>
        `;
      }
    }
  }

  extractCandidatesForCategory(data, category) {
    if (!data) return [];
    let list = [];
    const all = Array.isArray(data.all) ? data.all : [];
    const models = Array.isArray(data.models) ? data.models : [];

    if (category === 'image') {
      const imgModels = Array.isArray(data.image_models) ? data.image_models : [];
      list = [...imgModels];
      models.forEach(m => {
        if (m?.capabilities?.includes('image') && m.id && !list.includes(m.id)) {
          list.push(m.id);
        }
      });
      if (list.length === 0) {
        const keywords = ['gpt-image', 'flare', 'sunburst', 'banana', 'flux', 'dall-e', 'sd', 'stable-diffusion', 'kolors', 'schnell', 'cogview', 'midjourney', 'image', 'ideogram', 'recraft', 'seedream'];
        all.forEach(id => {
          const lower = String(id).toLowerCase();
          if (keywords.some(k => lower.includes(k)) && !list.includes(id)) {
            list.push(id);
          }
        });
      }
    } else if (category === 'video') {
      const vidModels = Array.isArray(data.video_models) ? data.video_models : [];
      list = [...vidModels];
      models.forEach(m => {
        if (m?.capabilities?.includes('video') && m.id && !list.includes(m.id)) {
          list.push(m.id);
        }
      });
      if (list.length === 0) {
        const keywords = ['seedance', 'skyreels', 'pixverse', 'vidu', 'veo', 'video', 'ltx', 'cogvideo', 'minimax', 'hailuo', 'kling', 'runway', 'sora', 'wan', 'hunyuan', 'pika'];
        all.forEach(id => {
          const lower = String(id).toLowerCase();
          if (keywords.some(k => lower.includes(k)) && !list.includes(id)) {
            list.push(id);
          }
        });
      }
    } else if (category === 'chat') {
      const chatModels = Array.isArray(data.chat_models) ? data.chat_models : [];
      list = [...chatModels];
      models.forEach(m => {
        if (m?.capabilities?.includes('chat') && m.id && !list.includes(m.id)) {
          list.push(m.id);
        }
      });
      if (list.length === 0) {
        const junk = ['embedding', 'text-embedding', 'bge-', 'whisper', 'tts', 'speech', 'audio', 'rerank', 'moderation', 'realtime'];
        all.forEach(id => {
          const lower = String(id).toLowerCase();
          if (!junk.some(j => lower.includes(j)) && !list.includes(id)) {
            list.push(id);
          }
        });
      }
      if (list.length === 0) {
        list = [...all];
      }
    }

    return Array.from(new Set(list)).sort((a, b) => String(a).localeCompare(String(b)));
  }

  renderPickerList(filterText = '') {
    this.ensurePickerState();
    this.currentPickerState.filterText = filterText;
    const listEl = document.getElementById('modelPickerList');
    const countsHint = document.getElementById('modelPickerCountsHint');
    if (!listEl) return;

    const query = String(filterText || '').trim().toLowerCase();
    const allCandidates = this.currentPickerState.candidates || [];
    const filtered = query
      ? allCandidates.filter(m => String(m).toLowerCase().includes(query))
      : allCandidates;

    if (countsHint) {
      countsHint.textContent = `候选模型 ${filtered.length} 个（共 ${allCandidates.length} 个）`;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="xxdp-picker-status">
          <span class="xxdp-picker-empty-hint">${allCandidates.length === 0 ? '该类别未拉取到候选模型' : '未找到匹配的模型'}</span>
        </div>
      `;
      this.updatePickerFooterStats();
      return;
    }

    const { selectedIds, existingIds } = this.currentPickerState;

    listEl.innerHTML = filtered.map(modelId => {
      const isExisting = existingIds.has(modelId);
      const isSelected = selectedIds.has(modelId);
      const safeId = this.escapeHtml(modelId);
      const isChecked = isExisting || isSelected;

      return `
        <div class="xxdp-picker-item ${isExisting ? 'disabled' : ''} ${isSelected ? 'selected' : ''}" data-picker-model="${safeId}">
          <input type="checkbox" data-picker-check="${safeId}" ${isChecked ? 'checked' : ''} ${isExisting ? 'disabled' : ''} />
          <span class="xxdp-picker-item-label">${safeId}</span>
          ${isExisting ? '<span class="xxdp-picker-badge-added">已绑定</span>' : ''}
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.xxdp-picker-item:not(.disabled)').forEach(item => {
      item.addEventListener('click', (e) => {
        const modelId = item.dataset.pickerModel;
        if (!modelId) return;
        const checkbox = item.querySelector('input[type="checkbox"]');
        const willCheck = e.target === checkbox ? checkbox.checked : !checkbox.checked;
        if (e.target !== checkbox && checkbox) {
          checkbox.checked = willCheck;
        }
        if (willCheck) {
          selectedIds.add(modelId);
          item.classList.add('selected');
        } else {
          selectedIds.delete(modelId);
          item.classList.remove('selected');
        }
        this.updatePickerFooterStats();
      });
    });

    this.updatePickerFooterStats();
  }

  selectAllPickerVisible() {
    this.ensurePickerState();
    const query = String(this.currentPickerState.filterText || '').trim().toLowerCase();
    const allCandidates = this.currentPickerState.candidates || [];
    const filtered = query
      ? allCandidates.filter(m => String(m).toLowerCase().includes(query))
      : allCandidates;

    filtered.forEach(m => {
      if (!this.currentPickerState.existingIds.has(m)) {
        this.currentPickerState.selectedIds.add(m);
      }
    });

    this.renderPickerList(this.currentPickerState.filterText);
  }

  deselectAllPicker() {
    this.ensurePickerState();
    this.currentPickerState.selectedIds.clear();
    this.renderPickerList(this.currentPickerState.filterText);
  }

  updatePickerFooterStats() {
    this.ensurePickerState();
    const count = this.currentPickerState.selectedIds.size;
    const countEl = document.getElementById('modelPickerSelectedCount');
    const confirmBtn = document.getElementById('btnModelPickerConfirm');

    if (countEl) countEl.textContent = String(count);
    if (confirmBtn) {
      confirmBtn.disabled = count === 0;
      confirmBtn.textContent = `确定添加 (${count})`;
    }
  }

  confirmModelPicker() {
    this.ensurePickerState();
    const { category, providerId, selectedIds, existingIds } = this.currentPickerState;
    if (!providerId || !category || selectedIds.size === 0) {
      this.closeModelPicker();
      return;
    }

    const provider = this.getSelectedProvider();
    if (!provider || provider.id !== providerId) {
      this.closeModelPicker();
      return;
    }

    const key = `${category}_models`;
    const current = Array.isArray(this.providerEdits[provider.id]?.[key])
      ? [...this.providerEdits[provider.id][key]]
      : Array.isArray(provider[key])
        ? [...provider[key]]
        : [];

    const toAdd = Array.from(selectedIds).filter(m => !existingIds.has(m));
    if (toAdd.length === 0) {
      this.closeModelPicker();
      return;
    }

    const next = [...current, ...toAdd];
    this.providerEdits[provider.id] = this.providerEdits[provider.id] || {};
    this.providerEdits[provider.id][key] = next;
    provider[key] = next;

    this.renderSelectedProviderCard();
    this.renderDefaultModelSelectors();
    this.renderProviderList();
    this.updateSummary();
    this.checkSettingsDirty();

    const categoryLabels = { image: '图片', video: '视频', chat: '文本' };
    const categoryLabel = categoryLabels[category] || '模型';
    this.showActionResult(true, `已添加 ${toAdd.length} 个${categoryLabel}模型，点击“保存设置”后生效`);

    this.closeModelPicker();
  }

  closeModelPicker() {
    const modalEl = document.getElementById('modelPickerModal');
    if (modalEl) {
      modalEl.classList.remove('active');
    }
    if (this.currentPickerState) {
      this.currentPickerState.selectedIds.clear();
    }
  }

  async loadStorageSettings() {


    if (!this.storageListContainer) return;


    this.storageListContainer.innerHTML = '<div class="xxdp-storage-loading">正在读取本地存储路径与状态..</div>';


    try {


      const res = await fetch('/api/storage/settings');


      if (!res.ok) {


        throw new Error(`HTTP ${res.status}`);


      }


      const data = await res.json();


      this.currentStorageData = data;


      this.renderStorageList(data);


    } catch (err) {


      console.error('[App] 加载存储配置失败:', err);


      if (this.storageListContainer) {


        this.storageListContainer.innerHTML = `<div class="xxdp-storage-alert" style="background:rgba(239,68,68,0.15);color:#f87171;border-color:rgba(239,68,68,0.4);">读取本地存储配置失败: ${this.escapeHtml(err.message)}</div>`;


      }


    }


  }

  renderStorageList(data) {


    if (!this.storageListContainer) return;


    this.storageListContainer.innerHTML = '';





    if (data.has_reference_error) {


      const alertEl = document.createElement('div');


      alertEl.className = 'xxdp-storage-alert';


      alertEl.style.background = 'rgba(239, 68, 68, 0.15)';


      alertEl.style.color = '#f87171';


      alertEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';


      alertEl.innerHTML = '<strong>严重异常</strong>检测到有存储目录指向了运行核心目录 (runtime_core)，系统已拒绝静默使用！请点击“更改”设置为正式目录并保存';


      this.storageListContainer.appendChild(alertEl);


    }





    const dirs = Array.isArray(data.directories) ? data.directories : [];


    dirs.forEach(d => {


      const itemEl = document.createElement('div');


      itemEl.className = `xxdp-storage-item${d.is_reference ? ' has-error' : ''}`;





      let badgesHtml = '';


      if (d.is_reference) {


        badgesHtml += '<span class="xxdp-status-badge-sm err">严禁指向参考库</span>';


      }


      if (d.exists) {


        badgesHtml += '<span class="xxdp-status-badge-sm ok">存在</span>';


      } else {


        badgesHtml += '<span class="xxdp-status-badge-sm warn">未创建</span>';


      }


      if (d.readable) {


        badgesHtml += '<span class="xxdp-status-badge-sm ok">可读</span>';


      }


      if (d.writable) {


        badgesHtml += '<span class="xxdp-status-badge-sm ok">可写</span>';


      } else if (d.exists) {


        badgesHtml += '<span class="xxdp-status-badge-sm warn">只读</span>';


      }





      let derivedHtml = '';


      if (Array.isArray(d.derived) && d.derived.length > 0) {


        const parts = d.derived.map(df => {


          const st = df.exists ? (df.writable ? '可读' : '只读') : '未生成';


          const stClass = df.exists ? 'ok' : 'warn';


          return `<span class="xxdp-storage-derived-item">${this.escapeHtml(df.name)}: <code>${this.escapeHtml(df.file)}</code> <span class="xxdp-status-badge-sm ${stClass}">${st}</span></span>`;


        });


        derivedHtml = `<div class="xxdp-storage-derived">派生文件: ${parts.join(' · ')}</div>`;


      }





      itemEl.innerHTML = `


        <div class="xxdp-storage-header-row">


          <div class="xxdp-storage-title-group">


            <span class="xxdp-storage-label">${this.escapeHtml(d.label || d.key)}</span>


            <span class="xxdp-storage-desc">${this.escapeHtml(d.description || '')}</span>


            <div class="xxdp-storage-badges">${badgesHtml}</div>


          </div>


          <div class="xxdp-storage-actions">


            <button type="button" class="xxdp-btn-sm btn-open-dir" title="在 Windows 文件资源管理器中打开此目录">打开目录</button>


            <button type="button" class="xxdp-btn-sm btn-change-dir" title="选择 Windows 本地新目录">更改</button>


          </div>


        </div>


        <div class="xxdp-storage-input-row">


          <input type="text" class="xxdp-input xxdp-storage-path-input" data-key="${this.escapeHtml(d.key)}" value="${this.escapeHtml(d.path || '')}" spellcheck="false" autocomplete="off" />


        </div>


        ${derivedHtml}


      `;





      const pathInput = itemEl.querySelector('.xxdp-storage-path-input');


      const openBtn = itemEl.querySelector('.btn-open-dir');


      const changeBtn = itemEl.querySelector('.btn-change-dir');





      if (pathInput) {


        pathInput.addEventListener('input', () => {


          this.markStorageDirty();


        });


      }





      if (openBtn) {


        openBtn.addEventListener('click', async () => {


          const currentPath = pathInput ? pathInput.value.trim() : d.path;


          try {


            openBtn.disabled = true;


            const res = await fetch('/api/storage/open-directory', {


              method: 'POST',


              headers: { 'Content-Type': 'application/json' },


              body: JSON.stringify({ path: currentPath })


            });


            const resData = await res.json();


            if (!res.ok) {


              await this.alert(resData.detail || '打开目录失败', '打开目录失败');


            }


          } catch (e) {


            await this.alert('打开目录请求异常: ' + e.message, '异常提示');


          } finally {


            openBtn.disabled = false;


          }


        });


      }





      if (changeBtn) {


        changeBtn.addEventListener('click', async () => {


          const currentPath = pathInput ? pathInput.value.trim() : d.path;


          try {


            changeBtn.disabled = true;


            changeBtn.textContent = '选择中..';


            const res = await fetch('/api/storage/select-directory', {


              method: 'POST',


              headers: { 'Content-Type': 'application/json' },


              body: JSON.stringify({ current_path: currentPath })


            });


            const resData = await res.json();


            if (!res.ok) {


              await this.alert(resData.detail || '选择目录失败', '选择目录失败');


            } else if (resData.selected_path) {


              if (pathInput) {


                pathInput.value = resData.selected_path;


              }


              this.markStorageDirty();


            }


          } catch (e) {


            await this.alert('调起目录选择器失败：' + e.message, '异常提示');


          } finally {


            changeBtn.disabled = false;


            changeBtn.textContent = '更改';


          }


        });


      }





      this.storageListContainer.appendChild(itemEl);


    });


  }

  markStorageDirty() {


    if (this.storageDirtyNotice) {


      this.storageDirtyNotice.style.display = 'inline-flex';


    }


  }

  async handleSaveStorageSettings() {


    if (!this.storageListContainer) return;


    const inputs = this.storageListContainer.querySelectorAll('.xxdp-storage-path-input');


    const newSettings = {};


    inputs.forEach(inp => {


      const k = inp.dataset.key;


      if (k) {


        newSettings[k] = inp.value.trim();


      }


    });





    if (this.btnSaveStorage) {


      this.btnSaveStorage.disabled = true;


      this.btnSaveStorage.textContent = '保存中...';


    }


    if (this.storageStatusMsg) {


      this.storageStatusMsg.style.display = 'none';


      this.storageStatusMsg.textContent = '';


    }





    try {


      const res = await fetch('/api/storage/settings', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({ settings: newSettings })


      });


      const data = await res.json();


      if (!res.ok) {


        throw new Error(data.detail || '保存存储设置失败');


      }





      if (this.storageDirtyNotice) {


        this.storageDirtyNotice.style.display = 'none';


      }


      if (this.storageStatusMsg) {


        this.storageStatusMsg.style.display = 'inline-block';


        this.storageStatusMsg.style.color = '#4ade80';


        this.storageStatusMsg.textContent = data.message || '存储配置保存成功';


      }


      await this.loadStorageSettings();


    } catch (err) {


      console.error('[App] 保存存储设置失败:', err);


      if (this.storageStatusMsg) {


        this.storageStatusMsg.style.display = 'inline-block';


        this.storageStatusMsg.style.color = '#f87171';


        this.storageStatusMsg.textContent = err.message || '保存失败';


      }


      await this.alert('保存存储配置失败: ' + err.message, '保存失败');


    } finally {


      if (this.btnSaveStorage) {


        this.btnSaveStorage.disabled = false;


        this.btnSaveStorage.textContent = '保存存储配置';


      }


    }


  }

  async loadApiSettings() {


    try {


      if (this.settingsProviderList) {


        this.settingsProviderList.dataset.listSig = '';
        this.settingsProviderList.innerHTML = '<div class="xxdp-list-loading">正在读取服务平台列表…</div>';


      }


      if (this.settingsDefaultChatModel) {
        this.settingsDefaultChatModel.dataset.optionsSig = '';
        this.settingsDefaultChatModel.innerHTML = '<option value="">加载模型列表中..</option>';


      }




      if (this.settingsDefaultImageModel) {
        this.settingsDefaultImageModel.dataset.optionsSig = '';
        this.settingsDefaultImageModel.innerHTML = '<option value="">加载模型列表中..</option>';


      }


      if (this.settingsDefaultVideoModel) {
        this.settingsDefaultVideoModel.dataset.optionsSig = '';
        this.settingsDefaultVideoModel.innerHTML = '<option value="">加载模型列表中..</option>';


      }





      const res = await fetch('/api/canvas-api-settings?mode=personal&canvas_id=default');


      if (!res.ok) {


        throw new Error(`获取设置失败 (HTTP ${res.status})`);


      }


      const data = await res.json();


      this.apiSettingsData = data;


      this.workingProviders = JSON.parse(JSON.stringify(data.providers || []));


      this.workingDefaultProvider = data.default_provider || (this.workingProviders[0]?.id || '');


      this.providerEdits = {};





      if (!this.selectedProviderId || !this.workingProviders.some(p => p.id === this.selectedProviderId)) {


        this.selectedProviderId = this.workingDefaultProvider || (this.workingProviders[0]?.id || '');


      }





      this.renderDefaultModelSelectors();


      this.renderProviderList();


      this.renderSelectedProviderCard();


      this.updateSummary();


      this.updateSnapshotFromData(data);


      this.checkSettingsDirty();


    } catch (_) {


      console.warn('[App] 加载 API 设置失败');


      if (this.settingsProviderList) {


        this.settingsProviderList.dataset.listSig = '';
        this.settingsProviderList.innerHTML = '<div class="xxdp-list-empty">加载服务平台失败，请确认本地服务正常运行</div>';


      }


      if (this.settingsDefaultChatModel) {


        this.settingsDefaultChatModel.innerHTML = '<option value="">加载模型失败</option>';


      }




      if (this.settingsDefaultImageModel) {


        this.settingsDefaultImageModel.innerHTML = '<option value="">加载模型失败</option>';


      }


      if (this.settingsDefaultVideoModel) {


        this.settingsDefaultVideoModel.innerHTML = '<option value="">加载模型失败</option>';


      }


      if (this.settingsStatusMsg) {


        this.settingsStatusMsg.style.display = 'block';


        this.settingsStatusMsg.style.color = '#ef4444';


        this.settingsStatusMsg.textContent = '无法加载配置，请确认本地服务正常运行';


      }


    }


  }

  updateSnapshotFromData(data) {


    if (!data || typeof data !== 'object') {


      this.initialSettingsSnapshot = null;


      return;


    }


    const providers = Array.isArray(data.providers) ? data.providers : [];


    const initialProviders = {};


    providers.forEach(p => {


      initialProviders[p.id] = {


        name: p.name || p.id,


        base_url: (p.base_url || '').trim(),


        enabled: p.enabled !== false,


        protocol: p.protocol || 'openai',


        image_models: Array.isArray(p.image_models) ? [...p.image_models] : [],


        video_models: Array.isArray(p.video_models) ? [...p.video_models] : [],


        chat_models: Array.isArray(p.chat_models) ? [...p.chat_models] : []


      };


    });



    let initialChatKey = '';


    if (this.settingsDefaultChatModel && this.settingsDefaultChatModel.value) {


      initialChatKey = this.settingsDefaultChatModel.value;


    } else if (data.default_bindings?.chat?.provider_id && data.default_bindings?.chat?.model) {


      initialChatKey = `${data.default_bindings.chat.provider_id}::${data.default_bindings.chat.model}`;


    } else if (data.default_models?.chat) {


      const matchP = providers.find(p => Array.isArray(p.chat_models) && p.chat_models.includes(data.default_models.chat));


      if (matchP) initialChatKey = `${matchP.id}::${data.default_models.chat}`;


    }



    let initialImageKey = '';


    if (this.settingsDefaultImageModel && this.settingsDefaultImageModel.value) {


      initialImageKey = this.settingsDefaultImageModel.value;


    } else if (data.default_bindings?.image?.provider_id && data.default_bindings?.image?.model) {


      initialImageKey = `${data.default_bindings.image.provider_id}::${data.default_bindings.image.model}`;


    } else if (data.default_models?.image) {


      const matchP = providers.find(p => Array.isArray(p.image_models) && p.image_models.includes(data.default_models.image));


      if (matchP) initialImageKey = `${matchP.id}::${data.default_models.image}`;


    }





    let initialVideoKey = '';


    if (this.settingsDefaultVideoModel && this.settingsDefaultVideoModel.value) {


      initialVideoKey = this.settingsDefaultVideoModel.value;


    } else if (data.default_bindings?.video?.provider_id && data.default_bindings?.video?.model) {


      initialVideoKey = `${data.default_bindings.video.provider_id}::${data.default_bindings.video.model}`;


    } else if (data.default_models?.video) {


      const matchP = providers.find(p => Array.isArray(p.video_models) && p.video_models.includes(data.default_models.video));


      if (matchP) initialVideoKey = `${matchP.id}::${data.default_models.video}`;


    }





    this.initialSettingsSnapshot = {


      chatKey: initialChatKey,


      imageKey: initialImageKey,


      videoKey: initialVideoKey,


      defaultProvider: data.default_provider || '',


      providerIds: providers.map(p => p.id),


      providers: initialProviders


    };


  }

  renderDefaultModelSelectors() {


    if (!this.workingProviders) return;


    const cliOrder = { 'gemini-cli': 0, 'codex': 1 };


    const providers = [...this.workingProviders].sort((a, b) => {


      const ai = cliOrder[String(a?.id || '').toLowerCase()] ?? 2;


      const bi = cliOrder[String(b?.id || '').toLowerCase()] ?? 2;


      return ai - bi;


    });


    const bindings = this.apiSettingsData?.default_bindings || {};


    const defaultModels = this.apiSettingsData?.default_models || {};





    // 0. 默认文本模型


    if (this.settingsDefaultChatModel) {


      const prevVal = this.settingsDefaultChatModel.value;


      const chatOptions = [];


      providers.forEach(p => {


        const isEnabled = this.providerEdits[p.id]?.enabled !== undefined ? this.providerEdits[p.id].enabled : (p.enabled !== false);


        if (!isEnabled) return;


        const models = this.providerEdits[p.id]?.chat_models || p.chat_models || [];


        const pName = this.providerEdits[p.id]?.name || p.name || p.id;


        models.forEach(m => {


          chatOptions.push({


            value: `${p.id}::${m}`,


            label: `${m} (${pName})`


          });


        });


      });





      if (chatOptions.length === 0) {


        this.settingsDefaultChatModel.innerHTML = '<option value="">暂无可用文本模型</option>';


      } else {


        const emptyOption = '<option value="">未指定默认模型</option>';


        this._setSelectOptionsIfChanged(this.settingsDefaultChatModel, emptyOption + chatOptions
          .map(opt => `<option value="${this.escapeHtml(opt.value)}">${this.escapeHtml(opt.label)}</option>`)
          .join(''), prevVal);





        let target = '';


        if (prevVal && chatOptions.some(o => o.value === prevVal)) {


          target = prevVal;


        } else if (bindings.chat?.provider_id && bindings.chat?.model) {


          const candidate = `${bindings.chat.provider_id}::${bindings.chat.model}`;


          if (chatOptions.some(o => o.value === candidate)) {


            target = candidate;


          }


        }


        if (!target && defaultModels.chat) {


          if (this.workingDefaultProvider && chatOptions.some(o => o.value === `${this.workingDefaultProvider}::${defaultModels.chat}`)) {


            target = `${this.workingDefaultProvider}::${defaultModels.chat}`;


          } else {


            const m = chatOptions.find(o => o.value.endsWith(`::${defaultModels.chat}`));


            if (m) target = m.value;


          }


        }


        if (!target && chatOptions.length > 0) {


          const matchP = chatOptions.find(o => o.value.startsWith(`${this.workingDefaultProvider}::`));


          target = matchP ? matchP.value : chatOptions[0].value;


        }





        if (target && chatOptions.some(o => o.value === target)) {


          this.settingsDefaultChatModel.value = target;


        } else {


          this.settingsDefaultChatModel.value = '';


        }


      }


    }





    // 1. 默认图片模型


    if (this.settingsDefaultImageModel) {


      const prevVal = this.settingsDefaultImageModel.value;


      const imgOptions = [];


      providers.forEach(p => {


        const isEnabled = this.providerEdits[p.id]?.enabled !== undefined ? this.providerEdits[p.id].enabled : (p.enabled !== false);


        if (!isEnabled) return;


        const models = this.providerEdits[p.id]?.image_models || p.image_models || [];


        const pName = this.providerEdits[p.id]?.name || p.name || p.id;


        models.forEach(m => {


          imgOptions.push({


            value: `${p.id}::${m}`,


            label: `${m} (${pName})`


          });


        });


      });





      if (imgOptions.length === 0) {


        this.settingsDefaultImageModel.innerHTML = '<option value="">暂无可用图片模型</option>';


      } else {


        const emptyOption = '<option value="">未指定默认模型</option>';


        this._setSelectOptionsIfChanged(this.settingsDefaultImageModel, emptyOption + imgOptions.map(opt => `<option value="${this.escapeHtml(opt.value)}">${this.escapeHtml(opt.label)}</option>`).join(''), prevVal);





        let target = '';


        if (prevVal && imgOptions.some(o => o.value === prevVal)) {


          target = prevVal;


        } else if (bindings.image?.provider_id && bindings.image?.model) {


          const candidate = `${bindings.image.provider_id}::${bindings.image.model}`;


          if (imgOptions.some(o => o.value === candidate)) {


            target = candidate;


          }


        }


        if (!target && defaultModels.image) {


          if (this.workingDefaultProvider && imgOptions.some(o => o.value === `${this.workingDefaultProvider}::${defaultModels.image}`)) {


            target = `${this.workingDefaultProvider}::${defaultModels.image}`;


          } else {


            const m = imgOptions.find(o => o.value.endsWith(`::${defaultModels.image}`));


            if (m) target = m.value;


          }


        }


        if (!target && imgOptions.length > 0) {


          const matchP = imgOptions.find(o => o.value.startsWith(`${this.workingDefaultProvider}::`));


          target = matchP ? matchP.value : imgOptions[0].value;


        }





        if (target && imgOptions.some(o => o.value === target)) {


          this.settingsDefaultImageModel.value = target;


        } else {


          this.settingsDefaultImageModel.value = '';


        }


      }


    }





    // 2. 默认视频模型


    if (this.settingsDefaultVideoModel) {


      const prevVal = this.settingsDefaultVideoModel.value;


      const vidOptions = [];


      providers.forEach(p => {


        const isEnabled = this.providerEdits[p.id]?.enabled !== undefined ? this.providerEdits[p.id].enabled : (p.enabled !== false);


        if (!isEnabled) return;


        const models = this.providerEdits[p.id]?.video_models || p.video_models || [];


        const pName = this.providerEdits[p.id]?.name || p.name || p.id;


        models.forEach(m => {


          vidOptions.push({


            value: `${p.id}::${m}`,


            label: `${m} (${pName})`


          });


        });


      });





      if (vidOptions.length === 0) {


        this.settingsDefaultVideoModel.innerHTML = '<option value="">暂无可用视频模型</option>';


      } else {


        const emptyOption = '<option value="">未指定默认模型</option>';


        this._setSelectOptionsIfChanged(this.settingsDefaultVideoModel, emptyOption + vidOptions.map(opt => `<option value="${this.escapeHtml(opt.value)}">${this.escapeHtml(opt.label)}</option>`).join(''), prevVal);





        let target = '';


        if (prevVal && vidOptions.some(o => o.value === prevVal)) {


          target = prevVal;


        } else if (bindings.video?.provider_id && bindings.video?.model) {


          const candidate = `${bindings.video.provider_id}::${bindings.video.model}`;


          if (vidOptions.some(o => o.value === candidate)) {


            target = candidate;


          }


        }


        if (!target && defaultModels.video) {


          if (this.workingDefaultProvider && vidOptions.some(o => o.value === `${this.workingDefaultProvider}::${defaultModels.video}`)) {


            target = `${this.workingDefaultProvider}::${defaultModels.video}`;


          } else {


            const m = vidOptions.find(o => o.value.endsWith(`::${defaultModels.video}`));


            if (m) target = m.value;


          }


        }


        if (!target && vidOptions.length > 0) {


          const matchP = vidOptions.find(o => o.value.startsWith(`${this.workingDefaultProvider}::`));


          target = matchP ? matchP.value : vidOptions[0].value;


        }





        if (target && vidOptions.some(o => o.value === target)) {


          this.settingsDefaultVideoModel.value = target;


        } else {


          this.settingsDefaultVideoModel.value = '';


        }


      }


    }


  }

  updateSummary() {


    // 摘要卡片已移除，不再引用已删除的 DOM


  }

  _setSelectOptionsIfChanged(selectEl, optionsHtml, selectedValue) {
    if (!selectEl) return;
    const next = String(optionsHtml || '');
    const prev = selectEl.dataset.optionsSig || '';
    const sel = selectedValue == null ? '' : String(selectedValue);
    const sig = next + '||sel:' + sel;
    if (prev === sig) return false;
    selectEl.innerHTML = next;
    if (sel) {
      try { selectEl.value = sel; } catch (_) {}
    }
    // 原生 select 被隐藏时，主动派发变更让自定义下拉显示同步更新。
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    selectEl.dataset.optionsSig = sig;
    return true;
  }

  _providerListSignature(providers) {
    return (providers || []).map(p => {
      const ed = this.providerEdits[p.id] || {};
      const enabled = ed.enabled !== undefined ? ed.enabled : (p.enabled !== false);
      const name = ed.name || p.name || p.id;
      const img = (ed.image_models || p.image_models || []).length;
      const vid = (ed.video_models || p.video_models || []).length;
      const chat = (ed.chat_models || p.chat_models || []).length;
      return [p.id, name, enabled ? 1 : 0, img, vid, chat, p.id === this.selectedProviderId ? 1 : 0, p.id === this.workingDefaultProvider ? 1 : 0].join(':');
    }).join('|');
  }

  renderProviderList() {


    if (!this.settingsProviderList || !this.workingProviders) return;


    const providers = this.workingProviders;





    if (providers.length === 0) {


      this.settingsProviderList.dataset.listSig = '';
      this.settingsProviderList.innerHTML = '<div class="xxdp-list-empty">暂无服务平台，请点击右上角添加</div>';


      return;


    }





    const _plistSig = this._providerListSignature(providers);
    const _listShowingLoading = !!this.settingsProviderList.querySelector('.xxdp-list-loading');
    if (!_listShowingLoading && this.settingsProviderList.dataset.listSig === _plistSig) return;
    this.settingsProviderList.dataset.listSig = _plistSig;
    this.settingsProviderList.innerHTML = providers.map(p => {


      const isSelected = p.id === this.selectedProviderId;


      const isPreferred = p.id === this.workingDefaultProvider;


      const isEnabled = this.providerEdits[p.id]?.enabled !== undefined ? this.providerEdits[p.id].enabled : (p.enabled !== false);


      const pName = this.providerEdits[p.id]?.name || p.name || p.id;





      const imgModels = this.providerEdits[p.id]?.image_models || p.image_models || [];


      const vidModels = this.providerEdits[p.id]?.video_models || p.video_models || [];


      const chatModels = this.providerEdits[p.id]?.chat_models || p.chat_models || [];


      const totalModels = imgModels.length + vidModels.length + chatModels.length;





      return `


        <div class="xxdp-provider-list-item ${isSelected ? 'active' : ''} ${!isEnabled ? 'disabled' : ''}" data-provider-id="${this.escapeHtml(p.id)}">


          <div class="xxdp-item-top">


            <span class="xxdp-item-name" title="${this.escapeHtml(pName)}">${this.escapeHtml(pName)}</span>


            <div class="xxdp-item-badges">


              ${!isEnabled ? '<span class="xxdp-pill-disabled">已禁用</span>' : ''}


            </div>


          </div>


          <div class="xxdp-item-meta">


            <span class="xxdp-item-model-count">${totalModels} 模型</span>


          </div>


        </div>


      `;


    }).join('');





    const items = this.settingsProviderList.querySelectorAll('.xxdp-provider-list-item');


    items.forEach(el => {


      el.addEventListener('click', () => {


        const id = el.dataset.providerId;


        if (id && id !== this.selectedProviderId) {


          this.switchSelectedProvider(id);


        }


      });


    });


  }

  renderProviderSelect() {


    this.renderProviderList();


  }

  getSelectedProvider() {


    if (!this.workingProviders || !this.selectedProviderId) return null;


    return this.workingProviders.find(p => p.id === this.selectedProviderId) || null;


  }

  switchSelectedProvider(newProviderId) {


    if (!newProviderId || newProviderId === this.selectedProviderId) return;





    const currProvider = this.getSelectedProvider();


    if (currProvider) {


      this.providerEdits[currProvider.id] = this.providerEdits[currProvider.id] || {};


      if (this.providerNameInput) {


        const n = this.providerNameInput.value.trim();


        this.providerEdits[currProvider.id].name = n;


        currProvider.name = n || currProvider.id;


      }


      const isCli = ['gemini-cli', 'codex'].includes(String(currProvider.protocol || '').toLowerCase());


      if (this.providerBaseUrlInput && !isCli) {


        this.providerEdits[currProvider.id].base_url = this.providerBaseUrlInput.value;


      }


        if (this.providerApiKeyInput && !isCli) {


          this.providerEdits[currProvider.id].new_api_key = this.providerApiKeyInput.value;


        }


        if (this.providerProtocolInput && !isCli) {


          this.providerEdits[currProvider.id].protocol = this.providerProtocolInput.value;


        }


    }





    this.selectedProviderId = newProviderId;


    this.renderProviderList();


    this.renderSelectedProviderCard();


    this.checkSettingsDirty();


  }

  onProviderSelectChanged(newProviderId) {


    this.switchSelectedProvider(newProviderId);


  }

  renderSelectedProviderCard() {


    const provider = this.getSelectedProvider();


    if (!provider) {


      if (this.providerCardName) this.providerCardName.textContent = '未选择平台';


      return;


    }





    const isCli = ['gemini-cli', 'codex'].includes(String(provider.protocol || '').toLowerCase());

    const header = document.querySelector('#settingsProviderCard .xxdp-edit-card-header');
    const leftColumn = document.querySelector('#settingsProviderCard .xxdp-provider-col-left');
    if (header && leftColumn) {
      leftColumn.classList.add('xxdp-cli-left-card');
      if (header.parentNode !== leftColumn) {
        leftColumn.insertBefore(header, leftColumn.firstChild);
      }
      header.classList.toggle('xxdp-api-toggle-only', !isCli);
    }
    const editPane = document.getElementById('settingsProviderCard');
    if (editPane) {
      editPane.classList.add('xxdp-compact-provider-layout');
      editPane.classList.toggle('xxdp-cli-layout', isCli);
    }


    const edit = this.providerEdits[provider.id] || {};


    const currName = edit.name !== undefined ? edit.name : (provider.name || provider.id);


    const isEnabled = edit.enabled !== undefined ? edit.enabled : (provider.enabled !== false);


    const isPreferred = provider.id === this.workingDefaultProvider;





    if (this.providerCardName) {


      this.providerCardName.textContent = currName;


    }


    if (this.providerCardProtocol) {


      this.providerCardProtocol.textContent = provider.protocol || 'openai';
      this.providerCardProtocol.hidden = isCli;


    }





    if (this.providerNameInput) {


      this.providerNameInput.value = currName;


    }

    if (this.providerNameGroup) {
      this.providerNameGroup.hidden = isCli;
      this.providerNameGroup.style.display = isCli ? 'none' : '';
    }





    if (this.btnSetDefaultProvider) {


      if (isPreferred) {


        this.btnSetDefaultProvider.textContent = '已是默认';


        this.btnSetDefaultProvider.disabled = true;


        this.btnSetDefaultProvider.classList.add('active');


      } else {


        this.btnSetDefaultProvider.textContent = '设为默认';


        this.btnSetDefaultProvider.disabled = false;


        this.btnSetDefaultProvider.classList.remove('active');


      }


    }





    if (this.providerEnabledInput) {


      this.providerEnabledInput.checked = isEnabled;


      const toggle = this.providerEnabledInput.closest('.xxdp-toggle-label');


      if (toggle) toggle.hidden = false;
    }





    if (this.btnDeleteProvider) {


      this.btnDeleteProvider.hidden = isCli;


      this.btnDeleteProvider.disabled = isCli || (this.workingProviders.length <= 1);


      this.btnDeleteProvider.title = isCli ? '固定 CLI 不能删除' : ((this.workingProviders.length <= 1) ? '至少保留一个平台，无法删除' : '从当前草稿中删除此平台');


    }





    
    if (this.btnCancelSettings) {
      this.btnCancelSettings.hidden = isCli;
    }
if (this.providerBaseUrlGroup) {


      this.providerBaseUrlGroup.hidden = isCli;


      this.providerBaseUrlGroup.style.display = isCli ? 'none' : '';


    }


    if (this.providerProtocolGroup) {


      this.providerProtocolGroup.hidden = isCli;


      this.providerProtocolGroup.style.display = isCli ? 'none' : '';


    }


    if (this.providerApiKeyGroup) {


      this.providerApiKeyGroup.hidden = isCli;


      this.providerApiKeyGroup.style.display = isCli ? 'none' : '';


    }


    if (this.providerRemoteActions) {


      this.providerRemoteActions.hidden = isCli;


      this.providerRemoteActions.style.display = isCli ? 'none' : '';


    }


    if (this.providerCliPanel) {


      this.providerCliPanel.hidden = !isCli;


      this.providerCliPanel.style.display = !isCli ? 'none' : '';


    }


    if (isCli) {


      const isCodex = provider.protocol === 'codex';


      if (this.providerCliPanelTitle) {


        this.providerCliPanelTitle.textContent = isCodex ? 'Codex CLI' : 'Antigravity CLI';


      }


      if (this.providerCliPanelText) {


        this.providerCliPanelText.textContent = isCodex ? '本机 Codex 会话' : '本机 agy 会话';


      }


      if (this.providerCliCmdVal) {


        this.providerCliCmdVal.textContent = isCodex ? 'codex' : 'agy auth';


      }


      // 仅在设置弹窗真实处于激活状态时刷新 CLI 状态，避免首页刷新在后台冗余触发


      const isModalActive = this.settingsModal && this.settingsModal.classList.contains('active');


      if (isModalActive) {


        this.refreshCliStatusBadge(provider.protocol);


      }


    }


    if (this.providerProtocolInput) {


      const protocol = String(edit.protocol !== undefined ? edit.protocol : (provider.protocol || 'openai')).toLowerCase();


      this.providerProtocolInput.value = this.providerProtocolInput.querySelector(`option[value="${protocol}"]`) ? protocol : 'openai';


    }





    // 密钥状态脱敏显示(永不回显已有真实密钥)


    if (this.providerCardKeyStatus) {
      if (!this._providerKeyStatusOrigin) {
        this._providerKeyStatusOrigin = {
          parent: this.providerCardKeyStatus.parentNode,
          next: this.providerCardKeyStatus.nextSibling
        };
      }
      if (isCli) {
        this.providerCardKeyStatus.remove();
      } else if (!this.providerCardKeyStatus.isConnected && this._providerKeyStatusOrigin.parent) {
        this._providerKeyStatusOrigin.parent.insertBefore(this.providerCardKeyStatus, this._providerKeyStatusOrigin.next);
      }


      const dot = this.providerCardKeyStatus.querySelector('.xxdp-status-dot');


      const text = this.providerCardKeyStatus.querySelector('.xxdp-status-text');


      const draftKey = edit.new_api_key?.trim();





      if (isCli) {


        if (dot) dot.className = 'xxdp-status-dot green';


        if (text) text.textContent = '本机已就绪';


      } else if (draftKey) {


        if (dot) dot.className = 'xxdp-status-dot green';


        if (text) text.textContent = '新密钥（未保存草稿）';


      } else if (provider.has_key) {


        if (dot) dot.className = 'xxdp-status-dot green';


        if (text) text.textContent = '已保存';


      } else {


        if (dot) dot.className = 'xxdp-status-dot gray';


        if (text) text.textContent = '未配置密';


      }


    }





    // Base URL


    if (this.providerBaseUrlInput) {


      if (isCli) {


        this.providerBaseUrlInput.value = '';


        this.providerBaseUrlInput.disabled = true;


        this.providerBaseUrlInput.placeholder = 'CLI 本机协议无需配置网络地址';


        if (this.providerBaseUrlHint) {


          this.providerBaseUrlHint.textContent = '命令行 CLI 本机协议，无需配置 HTTP 地址';


        }


      } else {
        this.providerBaseUrlInput.disabled = false;
        const currentProtocol = String(edit.protocol !== undefined ? edit.protocol : (provider.protocol || 'openai')).toLowerCase();
        if (currentProtocol === 'apimart') {
          this.providerBaseUrlInput.placeholder = '例如：https://api.apimart.ai/v1';
          if (this.providerBaseUrlHint) {
            this.providerBaseUrlHint.textContent = '文本、图片(GPT-Image-2.5)与视频(Seedance)统一走 /v1/tasks 调度';
          }
        } else if (currentProtocol === 'volcengine') {
          this.providerBaseUrlInput.placeholder = '例如：https://ark.cn-beijing.volces.com/api/v3';
          if (this.providerBaseUrlHint) {
            this.providerBaseUrlHint.textContent = '';
          }
        } else {
          this.providerBaseUrlInput.placeholder = '例如：https://api.openai.com/v1';
          if (this.providerBaseUrlHint) {
            this.providerBaseUrlHint.textContent = '';
          }
        }
        const editedUrl = edit.base_url;
        this.providerBaseUrlInput.value = (editedUrl !== undefined) ? editedUrl : (provider.base_url || '');
      }


    }





    // API Key (永不回显已有密钥)


    if (this.providerApiKeyInput) {


      this.providerApiKeyInput.type = 'password';


      this.providerApiKeyInput.value = edit.new_api_key || '';


      if (isCli) {


        this.providerApiKeyInput.disabled = true;


        this.providerApiKeyInput.placeholder = 'CLI 协议使用本机系统认证';


      } else {


        this.providerApiKeyInput.disabled = false;


        this.providerApiKeyInput.placeholder = provider.has_key ? '已保存（不回显，留空保留原有密钥）' : '请输入 API Key';


      }


    }





    // 获取真实模型按钮：CLI 协议不能请求网络模型


    if (this.btnFetchModels) {


      this.btnFetchModels.disabled = isCli;


      this.btnFetchModels.title = isCli ? 'CLI 本机协议不支持在线拉取网络模型' : '以当前草稿 URL/Key 请求服务商模型列表';


    }

    document.querySelectorAll('[data-model-fetch]').forEach((button) => {
      button.disabled = isCli;
      const label = button.dataset.modelFetch === 'chat' ? '文本' : button.dataset.modelFetch === 'video' ? '视频' : '图片';
      button.title = isCli ? 'CLI 模型由本机工具管理' : `拉取${label}模型`;
    });

    // 模型标签展示 (按图片 / 视频 / 对话分组)
    const imgModels = edit.image_models || provider.image_models || [];
    const vidModels = edit.video_models || provider.video_models || [];
    const chatModels = edit.chat_models || provider.chat_models || [];

    // 方案 B: 独立挑选模型与清空按钮状态维护
    document.querySelectorAll('[data-model-pick]').forEach((button) => {
      button.disabled = isCli;
      const cat = button.dataset.modelPick;
      const label = cat === 'chat' ? '文本' : cat === 'video' ? '视频' : '图片';
      button.title = isCli ? 'CLI 模型由本机工具管理' : `从服务商挑选${label}模型`;
    });

    document.querySelectorAll('[data-model-clear]').forEach((button) => {
      const cat = button.dataset.modelClear;
      const label = cat === 'chat' ? '文本' : cat === 'video' ? '视频' : '图片';
      const models = cat === 'image' ? imgModels : cat === 'video' ? vidModels : chatModels;
      button.disabled = models.length === 0;
      button.title = models.length === 0 ? `当前无已绑定的${label}模型` : `清空已绑定的${label}模型 (${models.length}个)`;
    });





    if (this.providerImageModelTags) {


      if (imgModels.length === 0) {


        this.providerImageModelTags.innerHTML = '<span class="xxdp-tag-empty">无图片模型</span>';


      } else {


        this.providerImageModelTags.innerHTML = imgModels


          .map(m => `<button type="button" class="xxdp-model-tag image-tag" data-remove-model="image" data-model-id="${this.escapeHtml(m)}" title="移除模型">${this.escapeHtml(m)}<span aria-hidden="true">×</span></button>`)


          .join('');


      }


    }





    if (this.providerVideoModelTags) {


      if (vidModels.length === 0) {


        this.providerVideoModelTags.innerHTML = '<span class="xxdp-tag-empty">无视频模型</span>';


      } else {


        this.providerVideoModelTags.innerHTML = vidModels


          .map(m => `<button type="button" class="xxdp-model-tag video-tag" data-remove-model="video" data-model-id="${this.escapeHtml(m)}" title="移除模型">${this.escapeHtml(m)}<span aria-hidden="true">×</span></button>`)


          .join('');


      }


    }





    const imageCount = document.getElementById('providerImageModelCount');
    const videoCount = document.getElementById('providerVideoModelCount');
    const chatCount = document.getElementById('providerChatModelCount');
    if (imageCount) imageCount.textContent = String(imgModels.length);
    if (videoCount) videoCount.textContent = String(vidModels.length);
    if (chatCount) chatCount.textContent = String(chatModels.length);
    const capabilityHint = document.getElementById('providerCapabilityHint');
    if (capabilityHint) capabilityHint.textContent = (imgModels.length + vidModels.length + chatModels.length)
      ? '当前草稿模型已同步，可点击“+ 挑选模型”按需挑选添加'
      : '保存平台后可获取最新模型列表';

    if (this.providerChatModelTags) {


      if (chatModels.length === 0) {


        this.providerChatModelTags.innerHTML = '<span class="xxdp-tag-empty">无对话模型</span>';


      } else {


        this.providerChatModelTags.innerHTML = chatModels


          .map(m => `<button type="button" class="xxdp-model-tag chat-tag" data-remove-model="chat" data-model-id="${this.escapeHtml(m)}" title="移除模型">${this.escapeHtml(m)}<span aria-hidden="true">×</span></button>`)


          .join('');


      }


    }





    [
      [this.providerImageModelTags, 'image'],
      [this.providerVideoModelTags, 'video'],
      [this.providerChatModelTags, 'chat']
    ].forEach(([container, type]) => {
      container?.querySelectorAll('[data-remove-model]').forEach(button => {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.handleRemoveManualModel(type, button.dataset.modelId || '');
        });
      });
    });

    this.hideActionResult();


  }

  handleAddCustomProvider() {


    let count = 1;


    let newId = `custom-api-${count}`;


    while (this.workingProviders.some(p => p.id === newId)) {


      count++;


      newId = `custom-api-${count}`;


    }





    const newProvider = {


      id: newId,


      name: `自定义平台${count}`,


      protocol: 'openai',


      base_url: '',


      enabled: true,


      primary: false,


      image_models: [],


      video_models: [],


      chat_models: [],


      model_names: {},


      model_protocols: {},


      has_key: false,


      key_preview: ''


    };





    this.workingProviders.push(newProvider);


    this.selectedProviderId = newId;


    this.renderProviderList();


    this.renderSelectedProviderCard();


    this.updateSummary();


    this.checkSettingsDirty();





    if (this.providerNameInput) {


      this.providerNameInput.focus();


      this.providerNameInput.select();


    }


  }

  async handleDeleteProvider() {


    const provider = this.getSelectedProvider();


    if (!provider) return;


    if (['gemini-cli', 'codex'].includes(String(provider.id || '').toLowerCase()) || ['gemini-cli', 'codex'].includes(String(provider.protocol || '').toLowerCase())) {


      await this.alert('Antigravity CLI ?GPT CLI 是固定本机能力，不能删除', '无法删除');


      return;


    }


    const pId = provider.id;





    // 1. 至少保留一个平台


    if (this.workingProviders.length <= 1) {


      await this.alert('至少保留一个 API 服务平台，无法删除当前唯一的平台', '无法删除');


      return;


    }





    // 2. 检查是否被 image/video/chat 默认绑定引用


    const referencedCaps = [];





    // 检查图片默认绑定：当下拉框已有当前草稿选择时只依据当前选择，没有当前值时才回退检查已保存 binding


    const currentImgVal = (this.settingsDefaultImageModel?.value || '').trim();


    if (currentImgVal) {


      if (currentImgVal.startsWith(`${pId}::`) || currentImgVal === pId) {


        referencedCaps.push('图片');


      }


    } else {


      const storedImgBinding = this.apiSettingsData?.default_bindings?.image?.provider_id;


      if (storedImgBinding === pId) {


        referencedCaps.push('图片');


      }


    }





    // 检查视频默认绑定：当下拉框已有当前草稿选择时只依据当前选择，没有当前值时才回退检查已保存 binding


    const currentVidVal = (this.settingsDefaultVideoModel?.value || '').trim();


    if (currentVidVal) {


      if (currentVidVal.startsWith(`${pId}::`) || currentVidVal === pId) {


        referencedCaps.push('视频');


      }


    } else {


      const storedVidBinding = this.apiSettingsData?.default_bindings?.video?.provider_id;


      if (storedVidBinding === pId) {


        referencedCaps.push('视频');


      }


    }





    // 检查文本/对话默认绑定：当下拉框已有当前草稿选择时只依据当前选择，没有当前值时才回退检查已保存 binding


    const currentChatVal = (this.settingsDefaultChatModel?.value || '').trim();


    if (currentChatVal) {


      if (currentChatVal.startsWith(`${pId}::`) || currentChatVal === pId) {


        referencedCaps.push('文本');


      }


    } else {


      const storedChatBinding = this.apiSettingsData?.default_bindings?.chat?.provider_id;


      if (storedChatBinding === pId) {


        referencedCaps.push('文本');


      }


    }





    if (referencedCaps.length > 0) {


      const capsStr = referencedCaps.join('');


      await this.alert(`平台「${provider.name || pId}」正被默认 [${capsStr}] 模型绑定引用，无法删除。\n\n请先修改上方的默认模型绑定，换用其他平台的模型后再删除此平台。`, '删除受阻');


      return;


    }





    // 3. 二次确认


    const confirmed = await this.confirm({


      title: '删除平台',


      message: `确定要从当前草稿中删除服务平台「${provider.name || pId}」吗？保存设置后永久生效。`,


      confirmText: '删除',


      cancelText: '取消',


      danger: true


    });


    if (!confirmed) return;





    // 4. 执行删除


    const idx = this.workingProviders.findIndex(p => p.id === pId);


    if (idx !== -1) {


      this.workingProviders.splice(idx, 1);


    }


    delete this.providerEdits[pId];





    if (this.workingDefaultProvider === pId) {


      this.workingDefaultProvider = this.workingProviders[0]?.id || '';


    }





    this.selectedProviderId = this.workingProviders[0]?.id || '';





    this.renderDefaultModelSelectors();


    this.renderProviderList();


    this.renderSelectedProviderCard();


    this.updateSummary();


    this.checkSettingsDirty();


  }

  handleSetDefaultProvider() {


    const provider = this.getSelectedProvider();


    if (!provider) return;


    this.workingDefaultProvider = provider.id;


    this.renderProviderList();


    this.renderSelectedProviderCard();


    this.updateSummary();


    this.checkSettingsDirty();


  }

  handleToggleProviderEnabled(enabled) {


    const provider = this.getSelectedProvider();


    if (!provider) return;


    


    this.providerEdits[provider.id] = this.providerEdits[provider.id] || {};


    this.providerEdits[provider.id].enabled = enabled;


    provider.enabled = enabled;





    this.renderDefaultModelSelectors();


    this.renderProviderList();


    this.renderSelectedProviderCard();


    this.updateSummary();


    this.checkSettingsDirty();


  }

  onProviderNameInput(val) {


    const provider = this.getSelectedProvider();


    if (!provider) return;


    const cleanVal = val.trim();


    this.providerEdits[provider.id] = this.providerEdits[provider.id] || {};


    this.providerEdits[provider.id].name = cleanVal;


    provider.name = cleanVal || provider.id;





    if (this.providerCardName) {


      this.providerCardName.textContent = cleanVal || provider.id;


    }


    const listItem = this.settingsProviderList?.querySelector(`[data-provider-id="${provider.id}"] .xxdp-item-name`);


    if (listItem) {


      listItem.textContent = cleanVal || provider.id;


    }





    this.renderDefaultModelSelectors();


    this.updateSummary();


    this.checkSettingsDirty();


  }

  onBaseUrlInput(val) {


    const provider = this.getSelectedProvider();


    if (!provider) return;


    this.providerEdits[provider.id] = this.providerEdits[provider.id] || {};


    this.providerEdits[provider.id].base_url = val;


    this.checkSettingsDirty();


  }

  onProviderProtocolInput(val) {


    const provider = this.getSelectedProvider();


    if (!provider) return;


    const allowed = new Set(['openai', 'apimart', 'volcengine', 'minimax']);
    const protocol = allowed.has(String(val || '').toLowerCase()) ? String(val).toLowerCase() : 'openai';
    this.providerEdits[provider.id] = this.providerEdits[provider.id] || {};
    this.providerEdits[provider.id].protocol = protocol;
    provider.protocol = protocol;

    if (this.providerCardProtocol) this.providerCardProtocol.textContent = protocol;

    if (this.providerBaseUrlInput && !this.isCliProtocol(provider)) {
      if (protocol === 'apimart') {
        this.providerBaseUrlInput.placeholder = '例如：https://api.apimart.ai/v1';
        if (this.providerBaseUrlHint) {
          this.providerBaseUrlHint.textContent = '文本、图片(GPT-Image-2.5)与视频(Seedance)统一走 /v1/tasks 调度';
        }
      } else if (protocol === 'volcengine') {
        this.providerBaseUrlInput.placeholder = '例如：https://ark.cn-beijing.volces.com/api/v3';
        if (this.providerBaseUrlHint) {
          this.providerBaseUrlHint.textContent = '';
        }
      } else {
        this.providerBaseUrlInput.placeholder = '例如：https://api.openai.com/v1';
        if (this.providerBaseUrlHint) {
          this.providerBaseUrlHint.textContent = '';
        }
      }
    }

    this.renderProviderList();
    this.checkSettingsDirty();


  }

  onApiKeyInput(val) {


    const provider = this.getSelectedProvider();


    if (!provider) return;


    this.providerEdits[provider.id] = this.providerEdits[provider.id] || {};


    this.providerEdits[provider.id].new_api_key = val;


    this.renderProviderList();


    this.updateSummary();


    this.checkSettingsDirty();


  }

  toggleApiKeyVisibility() {


    if (!this.providerApiKeyInput) return;


    const isPw = this.providerApiKeyInput.type === 'password';


    this.providerApiKeyInput.type = isPw ? 'text' : 'password';


  }

  sanitizeSafeText(text) {


    if (!text || typeof text !== 'string') return '操作未成功，请检查配';


    let sanitized = text;


    for (const edit of Object.values(this.providerEdits || {})) {


      const k = edit?.new_api_key?.trim();


      if (k && k.length > 0) {


        sanitized = sanitized.split(k).join('***');


      }


    }


    sanitized = sanitized


      .replace(/sk-[a-zA-Z0-9_-]{6,}/g, 'sk-***')


      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***')


      .replace(/key=[a-zA-Z0-9._-]+/gi, 'key=***');


    return sanitized;


  }

  async handleTestConnection() {


    const provider = this.getSelectedProvider();


    if (!provider) return;





    const isCli = ['gemini-cli', 'codex'].includes(String(provider.protocol || '').toLowerCase());


    const editedUrl = this.providerEdits[provider.id]?.base_url;


    const baseUrl = (editedUrl !== undefined) ? editedUrl.trim() : (provider.base_url || '').trim();





    if (!isCli && !baseUrl) {


      this.showActionResult(false, '请先填写接口地址 (Base URL)');


      return;


    }





    const newKey = this.providerEdits[provider.id]?.new_api_key;


    const apiKey = (newKey !== undefined && newKey.trim() !== '') ? newKey.trim() : undefined;





    if (this.btnTestConnection) {


      this.btnTestConnection.disabled = true;


      const span = this.btnTestConnection.querySelector('span');


      if (span) span.textContent = '测试中...';


    }


      this.showActionResult('loading', '正在探测服务连通性...');





    try {


      const res = await fetch('/api/providers/test-connection', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({


          base_url: baseUrl,


          api_key: apiKey,


          provider_id: provider.id,


          protocol: provider.protocol || 'openai',


          image_request_mode: provider.image_request_mode || 'openai',


          scope_id: 'personal:default'


        })


      });





      const data = await res.json().catch(() => ({}));


      if (res.ok && data.ok) {


        const imgModels = Array.isArray(data.image_models) ? data.image_models : [];


        const vidModels = Array.isArray(data.video_models) ? data.video_models : [];


        const chatModels = Array.isArray(data.chat_models) ? data.chat_models : [];


        // 缓存可用模型候选列表，供右侧「+ 挑选模型」直接使用，不污染当前已配置的模型
        this.ensurePickerState();
        const cacheKey = `${provider.id}__${baseUrl}`;
        this.pickerCandidateCache[cacheKey] = data;

        const totalFound = (Array.isArray(data.all) && data.all.length) || (data.model_count || 0) || (imgModels.length + vidModels.length + chatModels.length);
        const countStr = totalFound > 0 ? `（发现 ${totalFound} 个可用模型，可点击右侧「+ 挑选模型」按需添加）` : '';
        const safeMsg = this.sanitizeSafeText(data.message || '服务正常可用');
        this.showActionResult(true, `连通成功：${safeMsg} ${countStr}`);


      } else {


        const rawMsg = data.detail || data.message || `测试未通过 (状态码 ${res.status})`;


        const safeMsg = this.sanitizeSafeText(typeof rawMsg === 'string' ? rawMsg : '连通性验证失');


        this.showActionResult(false, `连通失败：${safeMsg}`);


      }


    } catch (_) {


      this.showActionResult(false, '网络连接异常，无法连接后端服务');


    } finally {


      if (this.btnTestConnection) {


        this.btnTestConnection.disabled = false;


        const span = this.btnTestConnection.querySelector('span');


        if (span) span.textContent = '测试连通';


      }


    }


  }

  async refreshCliStatusBadge(protocol, force = false) {


    const isCodex = String(protocol || '').toLowerCase() === 'codex';


    const cacheKey = isCodex ? 'codex' : 'gemini';


    this._cliStatusCache = this._cliStatusCache || {};





    if (!force && this._cliStatusCache[cacheKey]) {


      const cached = this._cliStatusCache[cacheKey];


      if (this.providerCliStatusText) this.providerCliStatusText.textContent = cached.text;


      if (this.providerCliStatusBadge) {


        const dot = this.providerCliStatusBadge.querySelector('.xxdp-status-dot');


        if (dot) dot.className = cached.dotClass;


      }


      if (this.providerCliVersionVal) this.providerCliVersionVal.textContent = cached.version;


      if (this.providerCliPathVal) this.providerCliPathVal.textContent = cached.path;


      return;


    }





    this._cliFetching = this._cliFetching || {};


    if (this._cliFetching[cacheKey]) {


      return this._cliFetching[cacheKey];


    }





    const endpoint = isCodex ? '/api/codex/status' : '/api/cli/status';


    const fetchPromise = (async () => {


      try {


        const res = await fetch(endpoint);


      const data = await res.json().catch(() => ({}));


      if (res.ok && (data.ok || data.installed)) {


        const item = {


          text: '已就',


          dotClass: 'xxdp-status-dot green',


          version: data.version || '已识',


          path: data.path || '系统 PATH '


        };


        this._cliStatusCache[cacheKey] = item;


        if (this.providerCliStatusText) this.providerCliStatusText.textContent = item.text;


        if (this.providerCliStatusBadge) {


          const dot = this.providerCliStatusBadge.querySelector('.xxdp-status-dot');


          if (dot) dot.className = item.dotClass;


        }


        if (this.providerCliVersionVal) this.providerCliVersionVal.textContent = item.version;


        if (this.providerCliPathVal) this.providerCliPathVal.textContent = item.path;


      } else {


        const item = {


          text: '未检测到',


          dotClass: 'xxdp-status-dot gray',


          version: '-',


          path: '未安装或不在系统 PATH '


        };


        this._cliStatusCache[cacheKey] = item;


        if (this.providerCliStatusText) this.providerCliStatusText.textContent = item.text;


        if (this.providerCliStatusBadge) {


          const dot = this.providerCliStatusBadge.querySelector('.xxdp-status-dot');


          if (dot) dot.className = item.dotClass;


        }


        if (this.providerCliVersionVal) this.providerCliVersionVal.textContent = item.version;


        if (this.providerCliPathVal) this.providerCliPathVal.textContent = item.path;


      }


    } catch (_) {


    } finally {


      delete this._cliFetching[cacheKey];


    }


  })();


  this._cliFetching[cacheKey] = fetchPromise;


  return fetchPromise;


}

  async handleTestCliPrompt() {
    const provider = this.getSelectedProvider();
    const prompt = String(this.providerCliPromptInput?.value || '').trim();
    if (!provider || !prompt) {
      if (this.providerCliPromptResult) this.providerCliPromptResult.textContent = '请输入测试提示词';
      this.providerCliPromptInput?.focus();
      return;
    }
    const isCodex = String(provider.protocol || '').toLowerCase() === 'codex';
    const endpoint = '/api/cli/test';
    if (this.btnTestCliPrompt) this.btnTestCliPrompt.disabled = true;
    if (this.providerCliPromptResult) this.providerCliPromptResult.textContent = '正在执行 CLI 测试...';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: isCodex ? 'codex' : 'antigravity', prompt, model: 'auto', timeout: 60 })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.message || 'CLI 测试失败');
      const output = data.output || data.stdout || data.result || '(无输出)';
      const latency = data.latency_ms ? ` · ${data.latency_ms}ms` : '';
      if (this.providerCliPromptResult) this.providerCliPromptResult.textContent = `测试成功${latency}\n${String(output).slice(0, 2000)}`;
    } catch (error) {
      if (this.providerCliPromptResult) this.providerCliPromptResult.textContent = `测试失败\n${error.message || error}`;
    } finally {
      if (this.btnTestCliPrompt) this.btnTestCliPrompt.disabled = false;
    }
  }

  async handleTestCliEnv() {


    const provider = this.getSelectedProvider();


    if (!provider) return;





    if (this.btnTestCliEnv) {


      this.btnTestCliEnv.disabled = true;


      const span = this.btnTestCliEnv.querySelector('span');


      if (span) span.textContent = '检测中...';


    }


    this.showActionResult('loading', '正在探测本机命令行环境与授权...');





    try {


      const isCodex = String(provider.protocol || '').toLowerCase() === 'codex';


      const endpoint = isCodex ? '/api/codex/status' : '/api/cli/status';


      const res = await fetch(endpoint);


      const data = await res.json().catch(() => ({}));





      if (res.ok && (data.ok || data.installed)) {


        const ver = data.version || '';


        const name = data.display_name || (isCodex ? 'OpenAI Codex CLI' : 'Antigravity CLI');


        const latency = data.latency_ms ? ` (${data.latency_ms}ms)` : '';


        const cacheKey = isCodex ? 'codex' : 'gemini';


        this._cliStatusCache = this._cliStatusCache || {};


        this._cliStatusCache[cacheKey] = {


          text: '已就',


          dotClass: 'xxdp-status-dot green',


          version: ver || '已识',


          path: data.path || '系统 PATH '


        };


        this.showActionResult(true, `检测通过：${name} ${ver} 已就绪（${latency}）`);


        if (this.providerCliStatusText) this.providerCliStatusText.textContent = '已就';


        if (this.providerCliStatusBadge) {


          const dot = this.providerCliStatusBadge.querySelector('.xxdp-status-dot');


          if (dot) dot.className = 'xxdp-status-dot green';


        }


        if (this.providerCliVersionVal && ver) this.providerCliVersionVal.textContent = ver;


        if (this.providerCliPathVal && data.path) this.providerCliPathVal.textContent = data.path;


      } else {


        const cacheKey = isCodex ? 'codex' : 'gemini';


        this._cliStatusCache = this._cliStatusCache || {};


        this._cliStatusCache[cacheKey] = {


          text: '未就',


          dotClass: 'xxdp-status-dot gray',


          version: '-',


          path: '未安装或不在系统 PATH '


        };


        const msg = data.detail || data.message || '未检测到可用命令行工具，请先在终端安装并登录';


        this.showActionResult(false, `检测失败：${this.sanitizeSafeText(msg)}`);


        if (this.providerCliStatusText) this.providerCliStatusText.textContent = '未就';


        if (this.providerCliStatusBadge) {


          const dot = this.providerCliStatusBadge.querySelector('.xxdp-status-dot');


          if (dot) dot.className = 'xxdp-status-dot gray';


        }


      }


    } catch (_) {


      this.showActionResult(false, '无法连接本地后端检查 CLI 状态');


    } finally {


      if (this.btnTestCliEnv) {


        this.btnTestCliEnv.disabled = false;


        const span = this.btnTestCliEnv.querySelector('span');


        if (span) span.textContent = '检测环';


      }


    }


  }

  async handleFetchModels() {


    const provider = this.getSelectedProvider();


    if (!provider) return;





    const isCli = ['gemini-cli', 'codex'].includes(String(provider.protocol || '').toLowerCase());


    if (isCli) {


      this.showActionResult(false, 'CLI 本机协议由本地环境决定可用模型，不支持在线拉取网络模型');


      return;


    }





    const edit = this.providerEdits[provider.id] || {};


    const baseUrl = (edit.base_url !== undefined ? edit.base_url : (provider.base_url || '')).trim();





    if (!baseUrl) {


      this.showActionResult(false, '请先填写接口地址 (Base URL)');


      return;


    }





    const newKey = edit.new_api_key?.trim();


    const apiKey = newKey ? newKey : undefined;





    if (this.btnFetchModels) {


      this.btnFetchModels.disabled = true;


      const span = this.btnFetchModels.querySelector('span');


      if (span) span.textContent = '获取中...';


    }


    this.showActionResult('loading', '正在请求服务商实时模型列表（GET /v1/models)...');





    try {


      const res = await fetch('/api/providers/fetch-models', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({


          base_url: baseUrl,


          api_key: apiKey,


          provider_id: provider.id,


          protocol: provider.protocol || 'openai',


          image_request_mode: provider.image_request_mode || 'openai',


          scope_id: 'personal:default'


        })


      });





      const data = await res.json().catch(() => ({}));


      if (res.ok && data.ok !== false) {


        let imgModels = Array.isArray(data.image_models) ? data.image_models : [];
        const vidModels = Array.isArray(data.video_models) ? data.video_models : [];
        const chatModels = Array.isArray(data.chat_models) ? data.chat_models : [];

        // 防清空保护与零手动智能兜底：上游未提供生图模型时，绝不清空现有模型；
        // 若现有模型也为空，全自动按厂商指纹预设最佳模型，彻底消除手动填写
        if (imgModels.length === 0) {
          if (Array.isArray(provider.image_models) && provider.image_models.length > 0) {
            imgModels = [...provider.image_models];
          } else {
            imgModels = [];
          }
        }

        const total = imgModels.length + vidModels.length + chatModels.length;

        // 存入当前未保存草稿中


        this.providerEdits[provider.id] = this.providerEdits[provider.id] || {};
        this.providerEdits[provider.id].image_models = imgModels;
        this.providerEdits[provider.id].video_models = vidModels;
        this.providerEdits[provider.id].chat_models = chatModels;
        this.providerEdits[provider.id].modelsFetched = true;

        provider.image_models = imgModels;
        provider.video_models = vidModels;
        provider.chat_models = chatModels;

        this.renderSelectedProviderCard();
        this.renderDefaultModelSelectors();
        this.renderProviderList();
        this.updateSummary();
        this.checkSettingsDirty();

        let hint = '';
        if (data.auto_resolved) {
          hint = `上游接口未公开模型列表，已全自动为您匹配并预设最佳可用生图模型（共 ${imgModels.length} 个：${imgModels.slice(0, 3).join(', ')} 等），可直接在画布生成图片。`;
        } else {
          hint = `识别到 ${total} 个可用模型（图片 ${imgModels.length} / 视频 ${vidModels.length} / 对话 ${chatModels.length}）。`;
        }
        this.showActionResult(true, `获取完成：${hint}已暂存为未保存草稿。`);


      } else {


        const rawMsg = data.detail || data.message || `获取模型失败 (HTTP ${res.status})`;


        const safeMsg = this.sanitizeSafeText(typeof rawMsg === 'string' ? rawMsg : '获取模型失败');


        this.showActionResult(false, `获取模型失败：${safeMsg}`);


      }


    } catch (_) {


      this.showActionResult(false, '网络连接异常，无法连接后端服务获取模型');


    } finally {


      if (this.btnFetchModels) {


        this.btnFetchModels.disabled = isCli;


        const span = this.btnFetchModels.querySelector('span');


        if (span) span.textContent = '获取真实模型';


      }


    }


  }

  showActionResult(status, text) {


    if (!this.settingsTestResult) return;


    this.settingsTestResult.style.display = 'inline-flex';


    if (status === 'loading') {


      this.settingsTestResult.className = 'xxdp-test-result loading';


    } else if (status === true) {


      this.settingsTestResult.className = 'xxdp-test-result success';


    } else {


      this.settingsTestResult.className = 'xxdp-test-result error';


    }


    this.settingsTestResult.textContent = text;


  }

  hideActionResult() {


    if (!this.settingsTestResult) return;


    this.settingsTestResult.style.display = 'none';


    this.settingsTestResult.textContent = '';


  }

  showTestResult(status, text) {


    this.showActionResult(status, text);


  }

  hideTestResult() {


    this.hideActionResult();


  }

  checkSettingsDirty() {
    if (this._isResettingSnapshot) {
      return false;
    }


    if (!this.initialSettingsSnapshot) {


      this.isSettingsDirtyState = false;


      this.updateDirtyNotice();


      return false;


    }





    let isDirty = false;





    // 1. 默认模型选择检查


    const currentChat = this.settingsDefaultChatModel?.value || '';


    const currentImg = this.settingsDefaultImageModel?.value || '';


    const currentVid = this.settingsDefaultVideoModel?.value || '';





    const snapshotChat = this.initialSettingsSnapshot.chatKey || '';


    const snapshotImg = this.initialSettingsSnapshot.imageKey || '';


    const snapshotVid = this.initialSettingsSnapshot.videoKey || '';





    if (currentChat !== snapshotChat || currentImg !== snapshotImg || currentVid !== snapshotVid) {


      isDirty = true;


    }





    // 2. 首选平台比较


    if (!isDirty) {


      if (this.workingDefaultProvider !== this.initialSettingsSnapshot.defaultProvider) {


        isDirty = true;


      }


    }





    // 3. 平台列表变动比较 (新增/删除)


    if (!isDirty) {


      const snapIds = this.initialSettingsSnapshot.providerIds || [];


      const currentIds = (this.workingProviders || []).map(p => p.id);


      if (snapIds.length !== currentIds.length || snapIds.some((id, i) => id !== currentIds[i])) {


        isDirty = true;


      }


    }





    // 4. Provider 配置草稿检查


    if (!isDirty) {


      for (const p of (this.workingProviders || [])) {


        const snap = this.initialSettingsSnapshot.providers?.[p.id];


        const edit = this.providerEdits?.[p.id];


        if (!snap) {


          isDirty = true;


          break;


        }


        if (edit) {


          if (edit.new_api_key && edit.new_api_key.trim().length > 0) {


            isDirty = true;


            break;


          }


          if (edit.base_url !== undefined && edit.base_url.trim() !== snap.base_url) {


            isDirty = true;


            break;


          }


          if (edit.name !== undefined && edit.name.trim() !== snap.name) {


            isDirty = true;


            break;


          }


          if (edit.enabled !== undefined && edit.enabled !== snap.enabled) {


            isDirty = true;


            break;


          }


          if (edit.protocol !== undefined && edit.protocol !== snap.protocol) {


            isDirty = true;


            break;


          }


          if (edit.modelsFetched) {


            isDirty = true;


            break;


          }


        }


      }


    }





    this.isSettingsDirtyState = isDirty;


    this.updateDirtyNotice();


    return isDirty;


  }

  updateDirtyNotice() {


    if (this.settingsDirtyNotice) {


      this.settingsDirtyNotice.style.display = this.isSettingsDirtyState ? 'flex' : 'none';


    }


  }

  async requestCloseSettings() {


    if (this.isSettingsDirtyState) {


      const confirmed = await this.confirm({


        title: '放弃未保存的修改',


        message: '当前有未保存的全局 API 设置修改，确定要放弃修改并关闭吗',


        confirmText: '放弃修改',


        cancelText: '继续编辑',


        danger: true


      });


      if (!confirmed) return;


    }


    this.closeSettings();


  }

  closeSettings() {


    if (this.settingsModal) {


      this.showHome(this.workspaceName, 'my');
      this.navSettings?.classList.remove('active');


    }


    this.providerEdits = {};


    this.isSettingsDirtyState = false;


    this.updateDirtyNotice();


    this.hideActionResult();


  }

  async handleSaveSettings() {


    if (document.activeElement && typeof document.activeElement.blur === 'function') {


      try { document.activeElement.blur(); } catch (_) {}


    }


    if (!this.workingProviders || !this.apiSettingsData) return;


    if (this.btnSaveSettings) {


      this.btnSaveSettings.disabled = true;


      this.btnSaveSettings.textContent = '保存中...';


    }





    try {


      // 1. 同步当前激活编辑框的实时内容到草稿


      const currP = this.getSelectedProvider();


      if (currP) {


        this.providerEdits[currP.id] = this.providerEdits[currP.id] || {};


        if (this.providerNameInput) {


          const n = this.providerNameInput.value.trim();


          this.providerEdits[currP.id].name = n;


          currP.name = n || currP.id;


        }


        const isCli = ['gemini-cli', 'codex'].includes(String(currP.protocol || '').toLowerCase());


        if (this.providerBaseUrlInput && !isCli) {


          this.providerEdits[currP.id].base_url = this.providerBaseUrlInput.value;


        }


        if (this.providerApiKeyInput && !isCli) {


          this.providerEdits[currP.id].new_api_key = this.providerApiKeyInput.value;


        }


        if (this.providerProtocolInput && !isCli) {


          this.providerEdits[currP.id].protocol = this.providerProtocolInput.value;


        }


      }





      const chatVal = this.settingsDefaultChatModel?.value || '';


      const imgVal = this.settingsDefaultImageModel?.value || '';


      const vidVal = this.settingsDefaultVideoModel?.value || '';





      let chatProviderId = '';


      let chatModel = '';


      if (chatVal.includes('::')) {


        const parts = chatVal.split('::');


        chatProviderId = parts[0];


        chatModel = parts.slice(1).join('::');


      }





      let imgProviderId = '';


      let imgModel = '';


      if (imgVal.includes('::')) {


        const parts = imgVal.split('::');


        imgProviderId = parts[0];


        imgModel = parts.slice(1).join('::');


      }





      let vidProviderId = '';


      let vidModel = '';


      if (vidVal.includes('::')) {


        const parts = vidVal.split('::');


        vidProviderId = parts[0];


        vidModel = parts.slice(1).join('::');


      }





      // 初始化 defaultModels 与 defaultBindings，安全保留未管理的 chat 及其他已有能力项


      const defaultModels = { ...(this.apiSettingsData.default_models || {}) };


      const defaultBindings = {};


      if (this.apiSettingsData.default_bindings && typeof this.apiSettingsData.default_bindings === 'object') {


        for (const [cap, binding] of Object.entries(this.apiSettingsData.default_bindings)) {


          if (binding && typeof binding === 'object') {


            const bindingCopy = { ...binding };


            delete bindingCopy.api_key;


            defaultBindings[cap] = bindingCopy;


          }


        }


      }





      // 更新本设置中心管理的 chat/image/video 模型绑定


      if (chatProviderId && chatModel) {


        defaultBindings.chat = { provider_id: chatProviderId, model: chatModel };


        defaultModels.chat = chatModel;


      } else {


        delete defaultBindings.chat;


        delete defaultModels.chat;


      }






      if (imgProviderId && imgModel) {


        defaultBindings.image = { provider_id: imgProviderId, model: imgModel };


        defaultModels.image = imgModel;


      } else {


        delete defaultBindings.image;


        delete defaultModels.image;


      }





      if (vidProviderId && vidModel) {


        defaultBindings.video = { provider_id: vidProviderId, model: vidModel };


        defaultModels.video = vidModel;


      } else {


        delete defaultBindings.video;


        delete defaultModels.video;


      }





      // 组装 providers 列表 payload


      const providersPayload = JSON.parse(JSON.stringify(this.workingProviders));


      providersPayload.forEach(p => {


        const edit = this.providerEdits[p.id];


        if (edit) {


          if (edit.name !== undefined) p.name = edit.name.trim();


          if (edit.base_url !== undefined) p.base_url = edit.base_url.trim();


          if (edit.protocol !== undefined) p.protocol = edit.protocol;


          if (edit.enabled !== undefined) p.enabled = edit.enabled;


          if (edit.image_models) p.image_models = edit.image_models;


          if (edit.video_models) p.video_models = edit.video_models;


          if (edit.chat_models) p.chat_models = edit.chat_models;


          if (edit.new_api_key && edit.new_api_key.trim().length > 0) {


            p.api_key = edit.new_api_key.trim();


          } else {


            delete p.api_key;


          }


        } else {


          delete p.api_key;


        }


        if (['gemini-cli', 'codex'].includes(String(p.id || '').toLowerCase())) {


          p.base_url = '';


          p.protocol = p.id;


          delete p.api_key;


        }


        p.primary = (p.id === this.workingDefaultProvider);


      });





      // 严格使用真实有效平台推导有效 default_provider


      const validProviderIds = new Set(providersPayload.map(p => p.id));


      let defaultProvider = this.workingDefaultProvider;


      if (!validProviderIds.has(defaultProvider)) {


        if (imgProviderId && validProviderIds.has(imgProviderId)) {


          defaultProvider = imgProviderId;


        } else if (vidProviderId && validProviderIds.has(vidProviderId)) {


          defaultProvider = vidProviderId;


        } else if (defaultBindings.chat?.provider_id && validProviderIds.has(defaultBindings.chat.provider_id)) {


          defaultProvider = defaultBindings.chat.provider_id;


        } else if (providersPayload.length > 0) {


          defaultProvider = providersPayload[0].id;


        }


      }





      // 清洗 defaultBindings，确保其中的 provider 与 model 真实存在于当前有效模型列表中，防止后端 400
      for (const [cap, binding] of Object.entries(defaultBindings)) {
        if (!binding || !binding.provider_id) {
          delete defaultBindings[cap];
          delete defaultModels[cap];
          continue;
        }
        const prov = providersPayload.find(p => String(p.id).toLowerCase() === String(binding.provider_id).toLowerCase());
        const capModels = prov ? (prov[`${cap}_models`] || []) : [];
        if (!prov || !capModels.includes(binding.model)) {
          delete defaultBindings[cap];
          delete defaultModels[cap];
        }
      }





      const putPayload = {


        mode: 'personal',


        canvas_id: 'default',


        providers: providersPayload,


        default_models: defaultModels,


        default_bindings: defaultBindings


      };


      if (defaultProvider) {


        putPayload.default_provider = defaultProvider;


      }





      const putRes = await fetch('/api/canvas-api-settings', {


        method: 'PUT',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify(putPayload)


      });





      if (!putRes.ok) {


        if (putRes.status === 404 || putRes.status === 405) {


          const patchPayload = {


            mode: 'personal',


            canvas_id: 'default',


            default_models: defaultModels,


            default_bindings: defaultBindings


          };


          if (defaultProvider) {


            patchPayload.default_provider = defaultProvider;


          }





          const patchRes = await fetch('/api/canvas-api-settings/defaults', {


            method: 'PATCH',


            headers: { 'Content-Type': 'application/json' },


            body: JSON.stringify(patchPayload)


          });





          if (!patchRes.ok) {


            const patchJson = await patchRes.json().catch(() => ({}));


            throw new Error(patchJson.detail || `默认模型同步失败 (HTTP ${patchRes.status})`);


          }


        } else {


          const errJson = await putRes.json().catch(() => ({}));


          throw new Error(errJson.detail || `保存设置失败 (HTTP ${putRes.status})`);


        }


      }





      // 成功保存后重新 GET 真实值作为新快照


      const getRes = await fetch('/api/canvas-api-settings?mode=personal&canvas_id=default');


      if (!getRes.ok) {


        throw new Error(`配置已保存但读取验证失败 (HTTP ${getRes.status})`);


      }


      const refreshedData = await getRes.json();





      try {


        apiClient.configCache = null;


      } catch (_) {}





      this._isResettingSnapshot = true;
      try {
        this.apiSettingsData = refreshedData;
        this.workingProviders = JSON.parse(JSON.stringify(refreshedData.providers || []));
        this.workingDefaultProvider = refreshedData.default_provider || (this.workingProviders[0]?.id || '');
        this.providerEdits = {};

        if (!this.selectedProviderId || !this.workingProviders.some(p => p.id === this.selectedProviderId)) {
          this.selectedProviderId = this.workingDefaultProvider || (this.workingProviders[0]?.id || '');
        }

        this.renderDefaultModelSelectors();
        this.renderProviderList();
        this.renderSelectedProviderCard();
        this.updateSummary();
        this.updateSnapshotFromData(refreshedData);
        this.isSettingsDirtyState = false;
        this.updateDirtyNotice();
      } finally {
        this._isResettingSnapshot = false;
      }

      if (this.btnSaveSettings) {
        this.btnSaveSettings.textContent = '✓ 已保存';
      }





      // 实时通知画布 iframe 与广播通道


      try {


        const frame = document.getElementById('xxdpCanvasFrame');


        if (frame && frame.contentWindow) {


          frame.contentWindow.postMessage({ type: 'api_settings_updated', data: refreshedData }, '*');


          frame.contentWindow.postMessage({ type: 'providers-changed', data: refreshedData }, '*');


        }


      } catch (_) {}


      try {


        const apiChannel = new BroadcastChannel('studio-api');


        apiChannel.postMessage({ type: 'api_settings_updated', data: refreshedData });


        apiChannel.postMessage({ type: 'providers-changed', data: refreshedData });
        apiChannel.close();

        const syncChannel = new BroadcastChannel('xxdp-api-settings');
        syncChannel.postMessage({ type: 'api-settings-updated', mode: 'personal', canvasId: 'default', scopeId: refreshedData.scope_id || 'personal:default', updatedAt: Date.now() });
        syncChannel.close();


      } catch (_) {}





      if (this.settingsStatusMsg) {


        this.settingsStatusMsg.style.display = 'block';


        this.settingsStatusMsg.style.color = '#10b981';


        this.settingsStatusMsg.textContent = '✓ 全局设置已保存并同步至所有项目';


        setTimeout(() => {


          if (this.settingsStatusMsg) this.settingsStatusMsg.style.display = 'none';


        }, 2800);


      }


    } catch (err) {


      console.error('[App] 保存设置失败');


      if (this.settingsStatusMsg) {


        this.settingsStatusMsg.style.display = 'block';


        this.settingsStatusMsg.style.color = '#ef4444';


        const rawMsg = typeof err?.message === 'string' ? err.message : '保存设置失败，请稍后重试';


        this.settingsStatusMsg.textContent = `保存失败: ${this.sanitizeSafeText(rawMsg)}`;


      }


    } finally {
      setTimeout(() => {
        if (this.btnSaveSettings) {
          this.btnSaveSettings.disabled = false;
          this.btnSaveSettings.textContent = '保存设置';
        }
      }, 900);
    }
  }

  async handleExportApiConfig() {
    try {
      if (this.btnExportApiConfig) {
        this.btnExportApiConfig.disabled = true;
      }
      // 1. 优先尝试从后端导出包含真实密钥的配置数据；若后端未重启(404)或异常则自动使用前端数据兜底
      let data = null;
      let usedFallback = false;
      try {
        const res = await fetch('/api/canvas-api-settings/export?mode=personal&canvas_id=default');
        if (res.ok) {
          data = await res.json();
        } else {
          usedFallback = true;
        }
      } catch (_) {
        usedFallback = true;
      }

      if (!data || typeof data !== 'object') {
        data = {
          version: 1,
          exported_at: new Date().toISOString(),
          app: 'xiaoxiao-office',
          mode: 'personal',
          canvas_id: 'default',
          default_provider: this.workingDefaultProvider || '',
          default_models: { ...(this.apiSettingsData?.default_models || {}) },
          default_bindings: { ...(this.apiSettingsData?.default_bindings || {}) },
          providers: JSON.parse(JSON.stringify(this.workingProviders || []))
        };
      }

      // 2. 合并当前前端未保存的草稿修改
      if (this.providerEdits && typeof this.providerEdits === 'object') {
        data.providers = (data.providers || []).map(p => {
          const edit = this.providerEdits[p.id];
          if (!edit) return p;
          const merged = { ...p };
          if (edit.name !== undefined) merged.name = edit.name.trim();
          if (edit.base_url !== undefined) merged.base_url = edit.base_url.trim();
          if (edit.protocol !== undefined) merged.protocol = edit.protocol;
          if (edit.enabled !== undefined) merged.enabled = edit.enabled;
          if (edit.image_models) merged.image_models = [...edit.image_models];
          if (edit.video_models) merged.video_models = [...edit.video_models];
          if (edit.chat_models) merged.chat_models = [...edit.chat_models];
          if (edit.new_api_key && edit.new_api_key.trim().length > 0) {
            merged.api_key = edit.new_api_key.trim();
          }
          return merged;
        });
      }

      // 如果有前端新建但未保存的平台
      if (Array.isArray(this.workingProviders)) {
        for (const wp of this.workingProviders) {
          if (!data.providers.some(p => p.id === wp.id)) {
            const edit = this.providerEdits?.[wp.id] || {};
            data.providers.push({
              ...wp,
              name: edit.name !== undefined ? edit.name : wp.name,
              base_url: edit.base_url !== undefined ? edit.base_url : wp.base_url,
              protocol: edit.protocol !== undefined ? edit.protocol : wp.protocol,
              api_key: edit.new_api_key || wp.api_key || '',
              image_models: edit.image_models || wp.image_models || [],
              video_models: edit.video_models || wp.video_models || [],
              chat_models: edit.chat_models || wp.chat_models || []
            });
          }
        }
      }

      if (this.workingDefaultProvider) {
        data.default_provider = this.workingDefaultProvider;
      }

      // 3. 生成 JSON Blob 并触发浏览器下载
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `xiaoxiao-api-config-${timestamp}.json`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (usedFallback) {
        this.showActionResult(true, `✓ 已导出当前工作区 API 配置文件：${filename}`);
      } else {
        this.showActionResult(true, `✓ 已成功导出包含 API 密钥的配置文件：${filename}`);
      }
    } catch (err) {
      console.error('[SettingsManager] 导出配置失败', err);
      await this.alert(err.message || '导出 API 配置文件失败', '导出失败');
    } finally {
      if (this.btnExportApiConfig) {
        this.btnExportApiConfig.disabled = false;
      }
    }
  }

  async handleImportApiConfig(file) {
    if (!file) return;
    try {
      const text = await file.text();
      let imported;
      try {
        imported = JSON.parse(text);
      } catch (_) {
        await this.alert('文件格式错误，请选择有效的 JSON 格式配置文件', '导入失败');
        return;
      }

      if (!imported || typeof imported !== 'object') {
        await this.alert('配置文件格式不符合要求', '导入失败');
        return;
      }

      let importProviders = [];
      if (Array.isArray(imported.providers)) {
        importProviders = imported.providers;
      } else if (Array.isArray(imported)) {
        importProviders = imported;
      }

      if (importProviders.length === 0) {
        await this.alert('未在文件中发现可导入的服务平台配置', '导入失败');
        return;
      }

      const count = importProviders.length;
      const confirmed = await this.confirm({
        title: '导入配置确认',
        message: `检测到文件中包含 ${count} 个服务平台配置。\n导入将合并更新现有平台配置与 API 密钥。\n是否确认导入？`,
        confirmText: '确认导入',
        cancelText: '取消'
      });
      if (!confirmed) return;

      this.workingProviders = this.workingProviders || [];
      let updatedCount = 0;

      for (const rawItem of importProviders) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const id = String(rawItem.id || '').trim().toLowerCase();
        if (!id) continue;

        let existing = this.workingProviders.find(p => String(p.id).toLowerCase() === id);
        this.providerEdits[id] = this.providerEdits[id] || {};

        if (!existing) {
          existing = {
            id,
            name: rawItem.name || id,
            base_url: rawItem.base_url || '',
            protocol: rawItem.protocol || 'openai',
            enabled: rawItem.enabled !== false,
            image_models: Array.isArray(rawItem.image_models) ? [...rawItem.image_models] : [],
            video_models: Array.isArray(rawItem.video_models) ? [...rawItem.video_models] : [],
            chat_models: Array.isArray(rawItem.chat_models) ? [...rawItem.chat_models] : [],
            has_key: false
          };
          this.workingProviders.push(existing);
        } else {
          if (rawItem.name !== undefined) existing.name = rawItem.name;
          if (rawItem.base_url !== undefined) existing.base_url = rawItem.base_url;
          if (rawItem.protocol !== undefined) existing.protocol = rawItem.protocol;
          if (rawItem.enabled !== undefined) existing.enabled = rawItem.enabled;
          if (Array.isArray(rawItem.image_models)) existing.image_models = [...rawItem.image_models];
          if (Array.isArray(rawItem.video_models)) existing.video_models = [...rawItem.video_models];
          if (Array.isArray(rawItem.chat_models)) existing.chat_models = [...rawItem.chat_models];
        }

        // 同步至 providerEdits 草稿
        this.providerEdits[id].name = existing.name;
        this.providerEdits[id].base_url = existing.base_url;
        this.providerEdits[id].protocol = existing.protocol;
        this.providerEdits[id].enabled = existing.enabled;
        this.providerEdits[id].image_models = [...existing.image_models];
        this.providerEdits[id].video_models = [...existing.video_models];
        this.providerEdits[id].chat_models = [...existing.chat_models];

        // 导入 API 密钥（如果有）
        const newKey = String(rawItem.api_key || '').trim();
        if (newKey) {
          this.providerEdits[id].new_api_key = newKey;
          existing.has_key = true;
        }
        updatedCount++;
      }

      // 如果导入包包含首选平台设置
      if (imported.default_provider && this.workingProviders.some(p => p.id === imported.default_provider)) {
        this.workingDefaultProvider = imported.default_provider;
      }

      // 自动选定第一个导入的平台
      const firstImportedId = String(importProviders[0]?.id || '').trim().toLowerCase();
      if (firstImportedId && this.workingProviders.some(p => p.id === firstImportedId)) {
        this.selectedProviderId = firstImportedId;
      }

      // 刷新界面
      this.renderProviderList();
      this.renderSelectedProviderCard();
      this.renderDefaultModelSelectors();
      this.updateSummary();

      // 标记为脏状态，让用户明确核对后点击保存
      this.isSettingsDirtyState = true;
      this.updateDirtyNotice();
      this.showActionResult(true, `✓ 已成功导入 ${updatedCount} 个服务平台配置，请核对后点击下方「保存设置」生效`);
    } catch (err) {
      console.error('[SettingsManager] 导入配置失败', err);
      await this.alert(err.message || '导入配置处理失败', '导入失败');
    }
  }

  async syncApiSettingsDisplay() {
    // 兼容方法：旧代码如调用不报错
  }
}
