/**
 * 画布素材回收站 (Canvas Trash Manager)
 * 支持记录画布中删除的卡片/素材、持久化存储、一键恢复，并支持历史生图与本地素材快速重载
 */
(function(){
    'use strict';

    let currentCanvasId = '';
    let hostConfig = {
        canvasId: '',
        btnId: 'smartTrashBtn',
        badgeId: 'smartTrashBadge',
        onRestoreNode: null,
        onRestoreImage: null,
        getViewportCenter: null,
        showToast: null
    };

    let activeTab = 'trash'; // 'trash' | 'history' | 'local'
    let historyCache = null;
    let localAssetsCache = null;
    let isLoadingData = false;

    function getStorageKey(){
        let id = hostConfig.canvasId || currentCanvasId;
        if(!id){
            try {
                if(typeof canvas !== 'undefined' && canvas?.id) id = canvas.id;
                else if(typeof canvasId !== 'undefined' && canvasId) id = canvasId;
                else {
                    const p = new URLSearchParams(window.location.search);
                    id = p.get('id') || p.get('canvas_id') || '';
                }
            } catch(e) {}
        }
        return `canvas_trash_${id || 'default'}`;
    }

    function loadTrashItems(){
        try {
            const raw = localStorage.getItem(getStorageKey());
            if(!raw) return [];
            const parsed = JSON.parse(raw);
            return (Array.isArray(parsed) ? parsed : []).filter(it => it && typeof it === 'object' && it.id);
        } catch(e) {
            return [];
        }
    }

    function saveTrashItems(items){
        try {
            localStorage.setItem(getStorageKey(), JSON.stringify((items || []).slice(0, 100)));
        } catch(e) {}
    }

    function formatRelativeTime(ts){
        if(!ts) return '';
        const now = Date.now();
        const diffSec = Math.floor((now - Number(ts)) / 1000);
        if(diffSec < 5) return '刚刚';
        if(diffSec < 60) return `${diffSec}秒前`;
        const diffMin = Math.floor(diffSec / 60);
        if(diffMin < 60) return `${diffMin}分钟前`;
        const diffHour = Math.floor(diffMin / 60);
        if(diffHour < 24) return `${diffHour}小时前`;
        const d = new Date(Number(ts));
        return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    function escapeHtml(str){
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function updateBadge(){
        const items = loadTrashItems();
        const count = items.length;
        ['smartTrashBadge', 'canvasTrashBadge', 'canvasBottomTrashBadge', hostConfig.badgeId].forEach(id => {
            if(!id) return;
            const badge = document.getElementById(id);
            if(badge){
                badge.textContent = String(count);
                badge.style.display = count > 0 ? 'inline-flex' : 'none';
            }
        });
        const tabPill = document.getElementById('canvasTrashRecentPill');
        if(tabPill){
            tabPill.textContent = String(count);
        }
        const clearBtns = [document.getElementById('canvasTrashClearBtn'), document.getElementById('canvasBottomTrashClearBtn')];
        clearBtns.forEach(clearBtn => {
            if(clearBtn){
                clearBtn.style.display = (activeTab === 'trash' && count > 0) ? 'inline-flex' : 'none';
            }
        });
    }

    function recordNode(node){
        if(!node || !node.id) return;
        if(node.type === 'history-group') return;
        const items = loadTrashItems();

        let thumb = '';
        if(Array.isArray(node.images) && node.images.length > 0){
            const firstImg = node.images[0];
            thumb = typeof firstImg === 'string' ? firstImg : (firstImg?.url || '');
        } else if(node.url){
            thumb = node.url;
        }

        let title = node.title || '';
        if(!title){
            if(node.isFrameGroup || node.type === 'smart-group') title = '分组容器';
            else if(node.type === 'smart-prompt') title = '提示词卡片';
            else if(node.genKind === 'video' || node.type === 'video' || node.type === 'smart-video') title = '视频节点';
            else title = '图片素材卡片';
        }

        const promptText = node.prompt || node.text || node.promptText || '';
        const trashItem = {
            id: 'trash_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            kind: 'node',
            nodeType: (node.isFrameGroup || node.type === 'smart-group') ? 'smart-group' : (node.type || 'smart-image'),
            title,
            prompt: promptText,
            thumbnail: thumb,
            data: JSON.parse(JSON.stringify(node)),
            deletedAt: Date.now(),
            origX: node.x,
            origY: node.y
        };

        const filtered = items.filter(it => it.id !== trashItem.id && !(it.data?.id === node.id && Date.now() - it.deletedAt < 300));
        filtered.unshift(trashItem);
        saveTrashItems(filtered);
        updateBadge();

        if(isPanelOpen()){
            renderCurrentTab();
        }
    }

    function recordImage(img, fromNode){
        if(!img) return;
        const imgObj = typeof img === 'string' ? { url: img, name: '图片素材' } : img;
        if(!imgObj.url) return;
        const items = loadTrashItems();
        const title = imgObj.name || fromNode?.title || '图片素材';
        const trashItem = {
            id: 'trash_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            kind: 'image',
            nodeType: 'image-item',
            title,
            prompt: fromNode?.prompt || '',
            thumbnail: imgObj.url,
            data: {
                image: JSON.parse(JSON.stringify(imgObj)),
                fromNodeId: fromNode?.id || '',
                origX: fromNode?.x,
                origY: fromNode?.y
            },
            deletedAt: Date.now(),
            origX: fromNode?.x,
            origY: fromNode?.y
        };

        items.unshift(trashItem);
        saveTrashItems(items);
        updateBadge();

        if(isPanelOpen()){
            renderCurrentTab();
        }
    }

    function isPanelOpen(){
        const popover = document.getElementById('canvasBottomMorePopover');
        if(popover && popover.classList.contains('open')){
            return true;
        }
        const panel = document.getElementById('canvasTrashPanel');
        return Boolean(panel && panel.classList.contains('open'));
    }

    function openPanel(){
        const popover = document.getElementById('canvasBottomMorePopover');
        const moreBtn = document.getElementById('canvasBottomMoreBtn');
        const toolbar = popover?.closest('.canvas-bottom-toolbar');
        if(toolbar){
            toolbar.classList.add('has-open-popover');
        }
        if(popover){
            popover.style.display = 'flex';
            void popover.offsetHeight;
            popover.classList.add('open');
            moreBtn?.classList.add('active');
            try { renderCurrentTab(); } catch(err) { console.error('[CanvasTrash Render Error]', err); }
            try { refreshIcons(popover); } catch(_) {}
            return;
        }
        ensureModalDoms();
        const panel = document.getElementById('canvasTrashPanel');
        const btns = [document.getElementById('smartTrashBtn'), document.getElementById('canvasTrashBtn'), document.getElementById(hostConfig.btnId)];
        if(!panel) return;
        panel.classList.add('open');
        btns.forEach(b => b?.classList.add('active'));
        try { renderCurrentTab(); } catch(err) { console.error('[CanvasTrash Render Error]', err); }
    }

    function closePanel(){
        const popover = document.getElementById('canvasBottomMorePopover');
        const moreBtn = document.getElementById('canvasBottomMoreBtn');
        const toolbar = popover?.closest('.canvas-bottom-toolbar');
        if(toolbar){
            toolbar.classList.remove('has-open-popover');
        }
        if(popover){
            popover.classList.remove('open');
            moreBtn?.classList.remove('active');
            setTimeout(() => {
                if(!popover.classList.contains('open')){
                    popover.style.display = 'none';
                }
            }, 180);
        }
        const panel = document.getElementById('canvasTrashPanel');
        const btns = [document.getElementById('smartTrashBtn'), document.getElementById('canvasTrashBtn'), document.getElementById(hostConfig.btnId)];
        if(panel){
            panel.classList.remove('open');
            btns.forEach(b => b?.classList.remove('active'));
        }
    }

    function togglePanel(event){
        if(event){
            event.preventDefault?.();
            event.stopPropagation?.();
        }
        if(isPanelOpen()) closePanel();
        else openPanel();
    }

    function notifyToast(msg){
        if(typeof hostConfig.showToast === 'function'){
            hostConfig.showToast(msg);
        } else if(typeof window.toast === 'function'){
            window.toast(msg);
        }
    }

    function restoreTrashItem(trashId){
        const items = loadTrashItems();
        const item = items.find(it => it.id === trashId);
        if(!item) return;

        let success = false;
        if(item.kind === 'node' && typeof hostConfig.onRestoreNode === 'function'){
            success = hostConfig.onRestoreNode(item.data);
        } else if(item.kind === 'image' && typeof hostConfig.onRestoreImage === 'function'){
            success = hostConfig.onRestoreImage(item.data);
        } else if(typeof hostConfig.onRestoreNode === 'function'){
            success = hostConfig.onRestoreNode(item.data);
        }

        if(success !== false){
            const next = items.filter(it => it.id !== trashId);
            saveTrashItems(next);
            updateBadge();
            renderCurrentTab();
            notifyToast(`已将「${item.title}」恢复到画布`);
        }
    }

    function mediaUrlsFromTrashItem(item){
        const urls = new Set();
        const add = value => {
            if(typeof value === 'string' && value.trim()) urls.add(value.trim());
        };
        const walk = value => {
            if(!value) return;
            if(typeof value === 'string') return add(value);
            if(Array.isArray(value)) return value.forEach(walk);
            if(typeof value !== 'object') return;
            ['url', 'src', 'path', 'file', 'filename'].forEach(key => add(value[key]));
            Object.keys(value).forEach(key => {
                if(['url', 'src', 'path', 'file', 'filename'].includes(key)) return;
                const child = value[key];
                if(child && (typeof child === 'object' || Array.isArray(child))) walk(child);
            });
        };
        walk(item?.data);
        add(item?.thumbnail);
        return urls;
    }

    function sameMediaUrl(left, right){
        if(left && typeof left === 'object') left = left.url || left.src || left.path || '';
        if(right && typeof right === 'object') right = right.url || right.src || right.path || '';
        const normalize = value => String(value || '').split('?')[0].replace(/\\/g, '/').replace(/\/$/, '');
        const a = normalize(left);
        const b = normalize(right);
        if(!a || !b) return false;
        return a === b || a.endsWith('/' + b.split('/').pop()) || b.endsWith('/' + a.split('/').pop());
    }

    async function purgeBackendHistory(item){
        const urls = mediaUrlsFromTrashItem(item);
        if(!urls.size) return {deleted: 0};

        const response = await fetch('/api/history');
        if(!response.ok) throw new Error(`读取后台历史失败 (${response.status})`);
        const history = await response.json();
        const records = (Array.isArray(history) ? history : []).filter(record =>
            Array.isArray(record.images) && record.images.some(image =>
                [...urls].some(url => sameMediaUrl(url, image))
            )
        );

        let deleted = 0;
        for(const record of records){
            if(record.timestamp === undefined || record.timestamp === null) continue;
            const result = await fetch('/api/history/delete', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({timestamp: record.timestamp})
            });
            if(!result.ok) throw new Error(`删除后台历史失败 (${result.status})`);
            const payload = await result.json().catch(() => ({}));
            if(payload.success === false) throw new Error(payload.message || '后台历史删除失败');
            deleted += 1;
        }
        // 回收站卡片不一定对应 history 记录（例如手动删除的节点/组合），
        // 直接把卡片内的本地媒体 URL 交给统一删除接口，确保文件与入口同步清理。
        let mediaDeleted = 0;
        const mediaResponse = await fetch('/api/media/delete', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({urls: [...urls]})
        });
        if(!mediaResponse.ok) throw new Error(`删除回收站素材失败 (${mediaResponse.status})`);
        const mediaPayload = await mediaResponse.json().catch(() => ({}));
        mediaDeleted = Number(mediaPayload.deleted || 0);
        historyCache = Array.isArray(historyCache)
            ? historyCache.filter(record => !records.includes(record))
            : historyCache;
        return {deleted: deleted + mediaDeleted};
    }

    async function deleteTrashItem(trashId){
        const items = loadTrashItems();
        const item = items.find(it => it.id === trashId);
        if(!item) return;
        if(!confirm(`确定要彻底删除「${item.title || '此记录'}」及后台文件吗？此操作不可恢复。`)) return;

        try {
            const result = await purgeBackendHistory(item);
            saveTrashItems(items.filter(it => it.id !== trashId));
            historyCache = null;
            localAssetsCache = null;
            window.dispatchEvent(new Event('local-assets-changed'));
            updateBadge();
            renderCurrentTab();
            notifyToast(result.deleted ? `已彻底删除记录及 ${result.deleted} 条后台历史` : '已彻底删除回收站记录');
        } catch(error){
            console.error('[CanvasTrash] purge backend history failed', error);
            notifyToast(error?.message || '后台文件删除失败，回收站记录未移除');
        }
    }

    async function clearAllTrash(){
        const items = loadTrashItems();
        if(!items.length && !confirm('确定要清空素材回收站中的服务器文件吗？此操作不可恢复。')) return;
        if(items.length && !confirm('确定要清空回收站，并彻底删除后台对应文件与历史记录吗？此操作不可恢复。')) return;

        const failed = [];
        for(const item of items){
            try {
                await purgeBackendHistory(item);
            } catch(error){
                console.error('[CanvasTrash] purge backend history failed', error);
                failed.push(item);
            }
        }
        let mediaTrashFailed = false;
        try {
            const mediaRes = await fetch('/api/media-trash/clear', { method: 'POST' });
            mediaTrashFailed = !mediaRes.ok;
        } catch (_) {
            mediaTrashFailed = true;
        }
        saveTrashItems(failed);
        historyCache = null;
        localAssetsCache = null;
        if (!mediaTrashFailed) {
            window.dispatchEvent(new Event('local-assets-changed'));
        }
        updateBadge();
        renderCurrentTab();
        notifyToast(failed.length || mediaTrashFailed ? `回收站已处理${failed.length ? `，${failed.length} 条历史删除失败` : ''}${mediaTrashFailed ? '，服务器素材清理失败' : ''}` : '回收站及服务器素材已清空');
    }

    function renderTrashTab(container){
        const items = loadTrashItems();
        if(!items.length){
            container.innerHTML = `
                <div class="canvas-trash-empty">
                    <div class="canvas-trash-empty-icon"><i data-lucide="trash-2"></i></div>
                    <p>回收站暂无素材</p>
                    <small>在画布上删除的图片或卡片会保存在这里，随时可一键恢复。</small>
                </div>
            `;
            refreshIcons(container);
            return;
        }

        container.innerHTML = items.map(it => {
            const isVideo = it.nodeType?.includes('video') || (it.thumbnail && it.thumbnail.endsWith('.mp4'));
            const isGroup = it.nodeType === 'smart-group' || it.data?.isFrameGroup;
            const isPrompt = it.nodeType === 'smart-prompt';
            let thumbHtml = '';
            if(it.thumbnail){
                thumbHtml = isVideo
                    ? `<video src="${escapeHtml(it.thumbnail)}" muted loop playsinline></video><span class="canvas-trash-thumb-badge">视频</span>`
                    : `<img src="${escapeHtml(it.thumbnail)}" alt="">`;
            } else if(isGroup){
                thumbHtml = `<div class="canvas-trash-thumb-fallback"><i data-lucide="folder"></i></div>`;
            } else if(isPrompt){
                thumbHtml = `<div class="canvas-trash-thumb-fallback"><i data-lucide="file-text"></i></div>`;
            } else {
                thumbHtml = `<div class="canvas-trash-thumb-fallback"><i data-lucide="image"></i></div>`;
            }

            let typeDesc = '图片素材';
            if(isGroup){
                const count = Array.isArray(it.data?.items) ? it.data.items.length : 0;
                typeDesc = count > 0 ? `组合容器 · 含 ${count} 个素材` : '组合容器';
            } else if(isVideo){
                typeDesc = '视频生成素材';
            } else if(isPrompt){
                typeDesc = '提示词卡片';
            } else if(it.data?.w && it.data?.h){
                typeDesc = `图片 · ${Math.round(it.data.w)}×${Math.round(it.data.h)}`;
            }

            const timeStr = formatRelativeTime(it.deletedAt);
            const subText = it.prompt ? `${it.prompt.slice(0, 42)}${it.prompt.length > 42 ? '...' : ''}` : typeDesc;

            return `
                <div class="canvas-trash-item" data-trash-id="${escapeHtml(it.id)}">
                    <div class="canvas-trash-thumb">${thumbHtml}</div>
                    <div class="canvas-trash-info">
                        <div class="canvas-trash-item-top">
                            <div class="canvas-trash-item-title" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</div>
                            <span class="canvas-trash-item-time">${escapeHtml(timeStr)}</span>
                        </div>
                        <div class="canvas-trash-item-sub" title="${escapeHtml(it.prompt || typeDesc)}">${escapeHtml(subText)}</div>
                    </div>
                    <div class="canvas-trash-item-actions">
                        <button class="canvas-trash-restore-btn" type="button" onclick="CanvasTrash.restoreItem('${escapeHtml(it.id)}')" title="恢复至画布">
                            <span>恢复</span>
                        </button>
                        <button class="canvas-trash-delete-btn" type="button" onclick="CanvasTrash.deleteItem('${escapeHtml(it.id)}')" title="彻底清除记录">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        refreshIcons(container);
    }

    async function renderHistoryTab(container){
        if(isLoadingData){
            container.innerHTML = `<div class="canvas-trash-empty"><small>正在加载历史素材...</small></div>`;
            return;
        }

        let list = historyCache;
        if(!list){
            isLoadingData = true;
            container.innerHTML = `<div class="canvas-trash-empty"><small>正在加载历史素材...</small></div>`;
            try {
                const res = await fetch('/api/history');
                list = await res.json();
                historyCache = Array.isArray(list) ? list : [];
            } catch(e) {
                historyCache = [];
            } finally {
                isLoadingData = false;
            }
        }

        const items = (historyCache || []).filter(h => Array.isArray(h.images) && h.images.length > 0);
        if(!items.length){
            container.innerHTML = `
                <div class="canvas-trash-empty">
                    <div class="canvas-trash-empty-icon"><i data-lucide="history"></i></div>
                    <p>暂无历史生成产物</p>
                    <small>在画布上生成的图片或视频都会保存在历史中，可在此一键放回画布。</small>
                </div>
            `;
            refreshIcons(container);
            return;
        }

        container.innerHTML = items.slice(0, 50).map((it, idx) => {
            const firstImg = it.images[0] || '';
            const isVideo = firstImg.endsWith('.mp4');
            const thumbHtml = isVideo
                ? `<video src="${escapeHtml(firstImg)}" muted loop playsinline></video><span class="canvas-trash-thumb-badge">视频</span>`
                : `<img src="${escapeHtml(firstImg)}" alt="">`;

            const promptText = it.prompt || (it.params?.prompt) || 'AI 生成素材';
            const modelName = it.model || it.params?.model || '';
            const countStr = it.images.length > 1 ? `${it.images.length} 张` : '';
            const metaParts = [modelName, countStr].filter(Boolean).join(' · ') || '历史产物';
            const timeStr = it.timestamp ? formatRelativeTime(it.timestamp * 1000) : '';

            return `
                <div class="canvas-trash-item">
                    <div class="canvas-trash-thumb">${thumbHtml}</div>
                    <div class="canvas-trash-info">
                        <div class="canvas-trash-item-top">
                            <div class="canvas-trash-item-title" title="${escapeHtml(promptText)}">${escapeHtml(promptText)}</div>
                            ${timeStr ? `<span class="canvas-trash-item-time">${escapeHtml(timeStr)}</span>` : ''}
                        </div>
                        <div class="canvas-trash-item-sub" title="${escapeHtml(metaParts)}">${escapeHtml(metaParts)}</div>
                    </div>
                    <div class="canvas-trash-item-actions">
                        <button class="canvas-trash-restore-btn" type="button" onclick="CanvasTrash.addHistoryToCanvas(${idx})" title="放回画布">
                            <span>放回画布</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        refreshIcons(container);
    }

    async function renderLocalTab(container){
        if(isLoadingData){
            container.innerHTML = `<div class="canvas-trash-empty"><small>正在加载本地素材...</small></div>`;
            return;
        }

        let list = localAssetsCache;
        if(!list){
            isLoadingData = true;
            container.innerHTML = `<div class="canvas-trash-empty"><small>正在加载本地素材...</small></div>`;
            try {
                const res = await fetch('/api/local-assets');
                const data = await res.json();
                list = Array.isArray(data?.items) ? data.items : [];
                localAssetsCache = list;
            } catch(e) {
                localAssetsCache = [];
            } finally {
                isLoadingData = false;
            }
        }

        const items = localAssetsCache || [];
        if(!items.length){
            container.innerHTML = `
                <div class="canvas-trash-empty">
                    <div class="canvas-trash-empty-icon"><i data-lucide="folder-open"></i></div>
                    <p>暂无本地上传素材</p>
                    <small>上传到资产库或本地文件夹的参考素材可在此快捷调取并放回画布。</small>
                </div>
            `;
            refreshIcons(container);
            return;
        }

        container.innerHTML = items.slice(0, 50).map((it, idx) => {
            const url = it.url || `/assets/uploads/${it.filename || it.name}`;
            const isVideo = it.kind === 'video' || (url && url.endsWith('.mp4'));
            const thumbHtml = isVideo
                ? `<video src="${escapeHtml(url)}" muted loop playsinline></video><span class="canvas-trash-thumb-badge">视频</span>`
                : `<img src="${escapeHtml(url)}" alt="">`;

            const name = it.name || it.filename || '素材';
            const sizeStr = it.size ? `${Math.round(it.size/1024)} KB` : '';
            const timeStr = it.ctime ? formatRelativeTime(it.ctime * 1000) : '';
            const metaParts = [sizeStr, '本地素材'].filter(Boolean).join(' · ');

            return `
                <div class="canvas-trash-item">
                    <div class="canvas-trash-thumb">${thumbHtml}</div>
                    <div class="canvas-trash-info">
                        <div class="canvas-trash-item-top">
                            <div class="canvas-trash-item-title" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                            ${timeStr ? `<span class="canvas-trash-item-time">${escapeHtml(timeStr)}</span>` : ''}
                        </div>
                        <div class="canvas-trash-item-sub" title="${escapeHtml(metaParts)}">${escapeHtml(metaParts)}</div>
                    </div>
                    <div class="canvas-trash-item-actions">
                        <button class="canvas-trash-restore-btn" type="button" onclick="CanvasTrash.addLocalToCanvas(${idx})" title="放回画布">
                            <span>放回画布</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        refreshIcons(container);
    }

    function renderCurrentTab(){
        const container = document.getElementById('canvasTrashList');
        if(!container) return;

        document.querySelectorAll('.canvas-trash-tab, .canvas-more-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === activeTab);
        });

        const items = loadTrashItems();
        const clearBtns = [document.getElementById('canvasTrashClearBtn'), document.getElementById('canvasBottomTrashClearBtn')];
        clearBtns.forEach(clearBtn => {
            if(clearBtn){
                clearBtn.style.display = (activeTab === 'trash' && items.length > 0) ? 'inline-flex' : 'none';
            }
        });

        if(activeTab === 'trash'){
            renderTrashTab(container);
        } else if(activeTab === 'history'){
            renderHistoryTab(container);
        } else if(activeTab === 'local'){
            renderLocalTab(container);
        }
    }

    async function pruneUnavailableTrashItems(){
        const items = loadTrashItems();
        if(!items.length) return;
        const localUrls = new Set();
        items.forEach(item => mediaUrlsFromTrashItem(item).forEach(url => {
            if(String(url).startsWith('/assets/') || String(url).startsWith('/output/') || String(url).startsWith('/api/storage-files/')){
                localUrls.add(String(url));
            }
        }));
        if(!localUrls.size) return;
        try {
            const response = await fetch('/api/canvas-assets/check', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({urls: [...localUrls]})
            });
            if(!response.ok) return;
            const payload = await response.json().catch(() => ({}));
            const exists = payload.exists || {};
            const next = items.filter(item => {
                const urls = [...mediaUrlsFromTrashItem(item)].filter(url => localUrls.has(String(url)));
                return !urls.length || urls.some(url => exists[url] !== false);
            });
            if(next.length !== items.length){
                saveTrashItems(next);
                historyCache = null;
                localAssetsCache = null;
                updateBadge();
                if(document.getElementById('canvasTrashPanel')?.classList.contains('active')) renderCurrentTab();
            }
        } catch (_) {}
    }

    function switchTab(tab){
        activeTab = tab;
        renderCurrentTab();
    }

    function addHistoryToCanvas(historyIndex){
        const list = historyCache || [];
        const record = list[historyIndex];
        if(!record || !Array.isArray(record.images) || !record.images.length) return;

        if(typeof hostConfig.onRestoreImage === 'function'){
            const imgUrls = record.images.map(url => ({
                url,
                name: (typeof url === 'string' ? url.split('/').pop() : '') || '历史生图',
                prompt: record.prompt || ''
            }));
            hostConfig.onRestoreImage({ images: imgUrls, prompt: record.prompt || '' });
            notifyToast('已将历史生成素材放回画布');
        }
    }

    function addLocalToCanvas(localIndex){
        const list = localAssetsCache || [];
        const item = list[localIndex];
        if(!item) return;

        const url = item.url || `/assets/uploads/${item.filename || item.name}`;
        if(typeof hostConfig.onRestoreImage === 'function'){
            hostConfig.onRestoreImage({
                images: [{ url, name: item.name || item.filename || '本地素材' }],
                prompt: item.caption || ''
            });
            notifyToast('已将本地素材放回画布');
        }
    }

    function refreshIcons(root){
        if(window.lucide && typeof window.lucide.createIcons === 'function'){
            window.lucide.createIcons(root ? { root } : undefined);
        }
    }

    function ensureModalDoms(){
        let panel = document.getElementById('canvasTrashPanel');
        if(!panel){
            panel = document.createElement('aside');
            panel.id = 'canvasTrashPanel';
            panel.className = 'canvas-trash-panel';
            panel.innerHTML = `
                <div class="canvas-trash-head">
                    <div class="canvas-trash-title-wrap">
                        <div class="canvas-trash-icon"><i data-lucide="trash-2"></i></div>
                        <div>
                            <div class="canvas-trash-title">素材回收站</div>
                            <div class="canvas-trash-sub">找回误删卡片与素材，支持一键还原</div>
                        </div>
                    </div>
                    <div class="canvas-trash-head-actions">
                        <button id="canvasTrashClearBtn" class="canvas-trash-head-btn" type="button" onclick="CanvasTrash.clearAll()" title="清空回收站">
                            <i data-lucide="trash"></i><span>清空</span>
                        </button>
                        <button class="canvas-trash-close-btn" type="button" onclick="CanvasTrash.close()" title="关闭">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                </div>
                <div class="canvas-trash-tabs">
                    <button class="canvas-trash-tab active" type="button" data-tab="trash" onclick="CanvasTrash.switchTab('trash')">
                        <span>最近删除</span>
                        <span id="canvasTrashRecentPill" class="canvas-trash-tab-pill">0</span>
                    </button>
                    <button class="canvas-trash-tab" type="button" data-tab="history" onclick="CanvasTrash.switchTab('history')">
                        <span>历史生图</span>
                    </button>
                    <button class="canvas-trash-tab" type="button" data-tab="local" onclick="CanvasTrash.switchTab('local')">
                        <span>本地素材</span>
                    </button>
                </div>
                <div id="canvasTrashList" class="canvas-trash-body"></div>
            `;

            // 拦截面板内部所有的鼠标/触摸事件，防止画布平移或点击触发背景取消
            panel.addEventListener('mousedown', e => e.stopPropagation());
            panel.addEventListener('pointerdown', e => e.stopPropagation());
            panel.addEventListener('click', e => e.stopPropagation());
            panel.addEventListener('wheel', e => e.stopPropagation());

            const host = document.getElementById('shell') || document.body;
            host.appendChild(panel);
            refreshIcons(panel);
        }
        return panel;
    }

    function bindButton(btnId){
        const btn = document.getElementById(btnId);
        if(!btn || btn.dataset.trashBound) return;
        btn.dataset.trashBound = 'true';
        btn.addEventListener('mousedown', e => e.stopPropagation());
        btn.addEventListener('pointerdown', e => e.stopPropagation());
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            togglePanel(e);
        });
    }

    function autoInit(){
        try {
            updateBadge();
            bindButton('smartTrashBtn');
            bindButton('canvasTrashBtn');
            // 底部更多按钮已经通过内联 onclick 绑定，避免重复 toggle 导致一次点击打开后立即关闭。
            if(hostConfig.btnId){
                bindButton(hostConfig.btnId);
            }
        } catch(e) {
            console.error('[CanvasTrash AutoInit Error]', e);
        }
    }

    window.addEventListener('local-assets-changed', () => {
        historyCache = null;
        localAssetsCache = null;
        updateBadge();
        pruneUnavailableTrashItems();
        if(document.getElementById('canvasTrashPanel')?.classList.contains('active')) renderCurrentTab();
    });

    function init(config){
        hostConfig = Object.assign(hostConfig, config || {});
        currentCanvasId = hostConfig.canvasId || '';
        autoInit();
    }

    // 全局点击监听，点击面板及按钮外部时关闭
    document.addEventListener('click', (e) => {
        if(!isPanelOpen()) return;
        const target = e.target;
        if(target.closest('#canvasBottomMorePopover') || target.closest('#canvasBottomMoreBtn') || target.closest('#canvasTrashPanel') || target.closest('.minimap-trash-btn') || target.closest('#smartTrashBtn') || target.closest('#canvasTrashBtn')) return;
        closePanel();
    });

    // 监听 Escape 键
    window.addEventListener('keydown', (e) => {
        if(e.key === 'Escape' && isPanelOpen()){
            closePanel();
        }
    });

    // 立即执行并挂载生命周期
    if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }
    window.addEventListener('load', autoInit);

    window.CanvasTrash = {
        init,
        recordNode,
        recordImage,
        restoreItem: restoreTrashItem,
        deleteItem: deleteTrashItem,
        clearAll: clearAllTrash,
        getItems: loadTrashItems,
        switchTab,
        addHistoryToCanvas,
        addLocalToCanvas,
        open: openPanel,
        close: closePanel,
        closeMorePopover: closePanel,
        toggle: togglePanel,
        updateBadge
    };
})();
