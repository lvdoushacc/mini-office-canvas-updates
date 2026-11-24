/**
 * 局域网大素材 5 态生命周期调度器 (static/collaboration/js/lan-asset-manager.js)
 * 职责：
 * 1. 管理素材 5 态生命周期 (STRUCTURE_SYNCED, SYNCING, LOCAL_SAVED, REMOTE_AVAILABLE, UNAVAILABLE)
 * 2. 状态感知与无缝替换：
 *    - STRUCTURE_SYNCED: 节点显示内嵌 thumbBase64 缩略图
 *    - SYNCING: 节点显示微型下载进度圆环 (xx%)
 *    - LOCAL_SAVED: SHA256 校验通过，无缝切换至本地高清原图
 *    - REMOTE_AVAILABLE: 悬浮提示“在线成员持有，正在排队”，支持点击优先下载
 *    - UNAVAILABLE: 悬浮提示“持有该素材的原设备当前离线”
 * 3. 联动顶部协作状态栏中的“素材：X/Y 已保存”计数器
 * 4. 监听 WebSocket 的 asset_status_updated 事件与主动轮询
 */

(function () {
    'use strict';

    // 检查是否开启局域网协同模式
    const urlParams = new URLSearchParams(window.location.search);
    const isLanMode = urlParams.get('mode') === 'lan';

    if (!isLanMode) {
        // 非局域网模式，完全休眠
        return;
    }

    console.log('[LanAssetManager] LAN Asset Transport & 5-State Lifecycle Manager Enabled');

    // 5 态常量
    const ASSET_STATES = {
        STRUCTURE_SYNCED: 'STRUCTURE_SYNCED',
        SYNCING: 'SYNCING',
        LOCAL_SAVED: 'LOCAL_SAVED',
        REMOTE_AVAILABLE: 'REMOTE_AVAILABLE',
        UNAVAILABLE: 'UNAVAILABLE'
    };

    class LanAssetManager {
        constructor() {
            // 解析远端协同主机（协作者模式）
            let hostCandidate = urlParams.get('host') || '';
            if (!hostCandidate) {
                try { hostCandidate = localStorage.getItem('lan_target_host') || ''; } catch(e) {}
            }
            this.remoteHost = (hostCandidate || '').trim();

            this.assetStates = new Map(); // sha256 -> { status, progress, downloadedBytes, totalBytes, localPath, availablePeers, error }
            this.summary = { total: 0, saved: 0, syncing: 0, remote_available: 0, unavailable: 0, ratio: '0/0' };
            this.pollTimer = null;
            this.activeDownloads = new Set();
            this.pendingFetches = new Map(); // sha256 -> Promise
            this.counterEl = null;

            this.init();
        }

        getApiUrl(path) {
            const cleanPath = path.startsWith('/') ? path : `/${path}`;
            if (this.remoteHost) {
                const base = this.remoteHost.startsWith('http') ? this.remoteHost : `http://${this.remoteHost}`;
                return `${base.replace(/\/+$/, '')}${cleanPath}`;
            }
            return cleanPath;
        }

        init() {
            this.injectAssetStyles();
            this.initCounterBadge();
            this.fetchSummary();
            this.setupWsListener();
            this.setupDomObserver();
            this.startPolling();
        }

        // =========================================================================
        // 1. 顶部协作状态栏素材计数联动
        // =========================================================================
        initCounterBadge() {
            const statusBar = document.getElementById('lanCollabStatusBar');
            if (statusBar) {
                let counter = document.getElementById('lanAssetCounter');
                if (!counter) {
                    counter = document.createElement('span');
                    counter.id = 'lanAssetCounter';
                    counter.className = 'lan-asset-counter';
                    counter.innerHTML = `
                        <span class="lan-asset-icon">🖼️</span>
                        <span class="lan-asset-text">素材: <span id="lanAssetRatioText" class="asset-count-text">0/0</span></span>
                    `;
                    statusBar.appendChild(counter);
                }
                this.counterEl = counter;
            }
        }

        getCanvasImageStats() {
            let total = 0;
            let saved = 0;
            const nodes = document.querySelectorAll('.smart-canvas-node, [data-node-id]');
            nodes.forEach(node => {
                const images = node.querySelectorAll('.node-output-image, img[data-sha256], .preview-image, .media-thumb img');
                images.forEach(img => {
                    total += 1;
                    const status = img.getAttribute('data-asset-status') || '';
                    if (status === ASSET_STATES.LOCAL_SAVED || img.src?.startsWith('data:') || img.src?.includes('/assets/lan/')) {
                        saved += 1;
                    }
                });
            });
            return { total, saved };
        }

        async fetchSummary() {
            try {
                const res = await fetch(this.getApiUrl(`/api/lan/assets/summary?_t=${Date.now()}`));
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'ok' && data.summary) {
                        this.updateSummary(data.summary);
                        return;
                    }
                }
            } catch (e) {
                console.warn('[LanAssetManager] Failed to fetch asset summary:', e);
            }
            // 本地兜底动态计算
            const localStats = this.getCanvasImageStats();
            this.updateSummary({
                total: localStats.total,
                saved: localStats.saved,
                savedCount: localStats.saved,
                ratio: `${localStats.saved}/${localStats.total}`
            });
        }

        updateSummary(summary) {
            if (!summary) return;
            this.summary = Object.assign(this.summary, summary);

            if (!this.counterEl) {
                this.initCounterBadge();
            }

            if (this.counterEl) {
                const textEl = this.counterEl.querySelector('.asset-count-text');
                const savedNum = typeof this.summary.savedCount === 'number' ? this.summary.savedCount : (this.summary.saved || 0);
                const totalNum = this.summary.total || 0;
                if (textEl) {
                    const ratioStr = this.summary.ratio || `${savedNum}/${totalNum}`;
                    textEl.textContent = `素材: ${ratioStr} 已保存`;
                }

                // 根据保存状态添加样式类 (仅 LOCAL_SAVED 达标才高亮全部已保存)
                this.counterEl.classList.remove('is-all-saved', 'is-syncing', 'is-pending');
                if (totalNum > 0 && savedNum >= totalNum) {
                    this.counterEl.classList.add('is-all-saved');
                } else if (this.summary.syncing > 0) {
                    this.counterEl.classList.add('is-syncing');
                } else if (this.summary.remote_available > 0 || this.summary.unavailable > 0) {
                    this.counterEl.classList.add('is-pending');
                }
            }

            // 同步联动 LanSyncAdapter 协作状态栏副标题
            if (window.LanSyncAdapter && typeof window.LanSyncAdapter.renderStatusBar === 'function') {
                window.LanSyncAdapter.renderStatusBar();
            }
        }

        // =========================================================================
        // 2. 素材 5 态生命周期查询与排队下载
        // =========================================================================
        async fetchAssetStatus(sha256) {
            if (!sha256) return null;
            if (this.pendingFetches.has(sha256)) {
                return this.pendingFetches.get(sha256);
            }
            const fetchPromise = (async () => {
                try {
                    const res = await fetch(this.getApiUrl(`/api/lan/assets/status/${sha256}`));
                    if (!res.ok) return null;
                    const data = await res.json();
                    if (data.status === 'ok') {
                        this.assetStates.set(sha256, data);
                        this.updateNodeAssetDisplay(sha256, data);
                        return data;
                    }
                } catch (e) {
                    console.warn(`[LanAssetManager] Failed to fetch status for asset ${sha256}:`, e);
                } finally {
                    this.pendingFetches.delete(sha256);
                }
                return null;
            })();
            this.pendingFetches.set(sha256, fetchPromise);
            return fetchPromise;
        }

        async queueDownload(sha256, priority = 0, targetExt = '') {
            if (!sha256) return false;
            try {
                const res = await fetch(this.getApiUrl('/api/lan/assets/queue-download'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sha256: sha256,
                        priority: priority,
                        target_ext: targetExt
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'ok') {
                        this.activeDownloads.add(sha256);
                        // 更新本地状态为 SYNCING
                        const cur = this.assetStates.get(sha256) || { sha256 };
                        cur.status = ASSET_STATES.SYNCING;
                        cur.progress = cur.progress || 0.05;
                        this.assetStates.set(sha256, cur);
                        this.updateNodeAssetDisplay(sha256, cur);
                        return true;
                    }
                }
            } catch (e) {
                console.error(`[LanAssetManager] Error queuing download for ${sha256}:`, e);
            }
            return false;
        }

        // =========================================================================
        // 3. 节点 DOM 5 态渲染与无缝切换
        // =========================================================================
        updateNodeAssetDisplay(sha256, assetInfo) {
            if (!sha256 || !assetInfo) return;
            const status = assetInfo.status || ASSET_STATES.STRUCTURE_SYNCED;
            const progress = assetInfo.progress || 0.0;
            const percent = Math.round(progress * 100);

            // 查找引用了该 sha256 的所有 DOM 元素 (例如 img, .node-media, .image-card)
            const targetElements = document.querySelectorAll(
                `[data-sha256="${sha256}"], [data-asset-hash="${sha256}"], img[src*="${sha256}"]`
            );

            targetElements.forEach(el => {
                const currentStatus = el.getAttribute('data-asset-status');
                const container = el.closest('.node-image-item, .node-media, .image-card-wrap') || el.parentElement || el;
                // 局域网素材实际落盘在 assets/lan/ 下，直接走公开静态路由。
                // 不要用 /api/lan/assets/{sha256}：该接口要求一次性的 session+token 签名，
                // 而这里只是给 <img>/<video> 赋 src，无法携带凭据，必然 403。
                const localUrl = `/assets/lan/${sha256}`;

                // =============================================================
                // 状态幂等保护 (Idempotency Guard)：若状态与 DOM 完全匹配，杜绝任何重复赋值与重绘
                // =============================================================
                if (currentStatus === status) {
                    if (status === ASSET_STATES.LOCAL_SAVED) {
                        const isImg = el.tagName === 'IMG';
                        const curSrc = isImg ? (el.getAttribute('src') || el.src || '') : '';
                        const hasCorrectSrc = isImg ? (curSrc.includes(sha256) || curSrc.includes(localUrl)) : true;
                        const isNotThumb = isImg ? !el.classList.contains('is-placeholder-thumb') : true;
                        const hasLocalSavedClass = container.classList.contains('is-local-saved');
                        const hasNoOverlay = !container.querySelector('.lan-asset-status-overlay');
                        if (hasCorrectSrc && isNotThumb && hasLocalSavedClass && hasNoOverlay) {
                            return; // 完全幂等，直接跳过零扰动
                        }
                    } else if (status === ASSET_STATES.SYNCING) {
                        const existingOverlay = container.querySelector('.lan-asset-status-overlay.is-syncing');
                        if (existingOverlay) {
                            const progressText = existingOverlay.querySelector('.lan-asset-progress-text');
                            const ringFg = existingOverlay.querySelector('.ring-fg');
                            if (progressText && progressText.textContent !== `${percent}%`) {
                                progressText.textContent = `${percent}%`;
                            }
                            if (ringFg) {
                                ringFg.setAttribute('stroke-dasharray', `${percent}, 100`);
                            }
                            return; // 仅微量更新数字，不重建 DOM 不修改滤镜
                        }
                    } else if (status === ASSET_STATES.REMOTE_AVAILABLE) {
                        if (container.querySelector('.lan-asset-status-overlay.is-remote-available')) {
                            return;
                        }
                    } else if (status === ASSET_STATES.UNAVAILABLE) {
                        if (container.querySelector('.lan-asset-status-overlay.is-unavailable')) {
                            return;
                        }
                    } else if (status === ASSET_STATES.STRUCTURE_SYNCED) {
                        if (container.classList.contains('is-structure-synced')) {
                            return;
                        }
                    }
                }

                el.setAttribute('data-asset-status', status);

                // 移除旧徽章与进度层
                const oldOverlay = container.querySelector('.lan-asset-status-overlay');
                if (oldOverlay) oldOverlay.remove();

                if (status === ASSET_STATES.LOCAL_SAVED) {
                    // 1. LOCAL_SAVED: 校验通过，切换为本地高清图
                    if (el.tagName === 'IMG') {
                        if (!el.src.includes(sha256) || el.classList.contains('is-placeholder-thumb')) {
                            el.src = localUrl;
                            el.classList.remove('is-placeholder-thumb');
                        }
                        if (el.style.filter !== 'none') el.style.filter = 'none';
                        if (el.style.opacity !== '1') el.style.opacity = '1';
                    }
                    container.classList.remove('is-syncing', 'is-remote-available', 'is-unavailable', 'is-structure-synced');
                    container.classList.add('is-local-saved');

                } else if (status === ASSET_STATES.SYNCING) {
                    // 2. SYNCING: 显示微型下载进度圆环
                    container.classList.add('is-syncing');
                    container.classList.remove('is-remote-available', 'is-unavailable', 'is-local-saved', 'is-structure-synced');
                    if (el.tagName === 'IMG') {
                        el.style.filter = 'brightness(0.75) blur(1px)';
                    }

                    const overlay = document.createElement('div');
                    overlay.className = 'lan-asset-status-overlay is-syncing';
                    overlay.innerHTML = `
                        <div class="lan-asset-progress-wrap">
                            <svg class="lan-asset-progress-ring" viewBox="0 0 36 36">
                                <path class="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                <path class="ring-fg" stroke-dasharray="${percent}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            </svg>
                            <span class="lan-asset-progress-text">${percent}%</span>
                        </div>
                        <span class="lan-asset-status-label">正在同步素材...</span>
                    `;
                    container.style.position = 'relative';
                    container.appendChild(overlay);

                } else if (status === ASSET_STATES.REMOTE_AVAILABLE) {
                    // 3. REMOTE_AVAILABLE: 在线成员持有，悬浮提示并可点击下载
                    container.classList.add('is-remote-available');
                    container.classList.remove('is-syncing', 'is-unavailable', 'is-local-saved', 'is-structure-synced');
                    if (el.tagName === 'IMG') {
                        el.style.filter = 'brightness(0.85)';
                    }

                    const overlay = document.createElement('div');
                    overlay.className = 'lan-asset-status-overlay is-remote-available';
                    overlay.title = '在线成员持有该素材，点击立即下载';
                    overlay.innerHTML = `
                        <div class="lan-asset-badge-btn" onclick="window.LanAssetManager && window.LanAssetManager.queueDownload('${sha256}', 1)">
                            <span class="badge-dot"></span>
                            <span>在线成员持有 · 点击下载</span>
                        </div>
                    `;
                    container.style.position = 'relative';
                    container.appendChild(overlay);

                } else if (status === ASSET_STATES.UNAVAILABLE) {
                    // 4. UNAVAILABLE: 原设备离线，无在线副本
                    container.classList.add('is-unavailable');
                    container.classList.remove('is-syncing', 'is-remote-available', 'is-local-saved', 'is-structure-synced');
                    if (el.tagName === 'IMG') {
                        el.style.filter = 'grayscale(0.8) brightness(0.7)';
                    }

                    const overlay = document.createElement('div');
                    overlay.className = 'lan-asset-status-overlay is-unavailable';
                    overlay.title = '持有该素材的原设备当前离线';
                    overlay.innerHTML = `
                        <div class="lan-asset-badge-warn">
                            <span class="warn-icon">⚠️</span>
                            <span>原设备已离线</span>
                        </div>
                    `;
                    container.style.position = 'relative';
                    container.appendChild(overlay);

                } else if (status === ASSET_STATES.STRUCTURE_SYNCED) {
                    // 5. STRUCTURE_SYNCED: 结构已同步，缩略图预览
                    container.classList.add('is-structure-synced');
                    container.classList.remove('is-syncing', 'is-remote-available', 'is-unavailable', 'is-local-saved');
                    if (el.tagName === 'IMG' && el.getAttribute('data-thumb-base64')) {
                        el.src = el.getAttribute('data-thumb-base64');
                        el.classList.add('is-placeholder-thumb');
                    }
                }
            });
        }

        // =========================================================================
        // 4. 事件监听与轮询
        // =========================================================================
        setupWsListener() {
            // 监听全局 WebSocket 广播消息
            window.addEventListener('message', (event) => {
                if (!event.data) return;
                const type = event.data.type;
                if (type === 'asset_status_updated') {
                    const data = event.data.data || {};
                    if (data.sha256) {
                        this.fetchAssetStatus(data.sha256);
                    }
                    if (data.summary) {
                        this.updateSummary(data.summary);
                    }
                }
            });
            window.addEventListener('lan-op-applied', (event) => {
                const type = String(event.detail?.op?.type || '').toUpperCase();
                if (type === 'ADD_NODE_IMAGE' || type === 'REMOVE_NODE_IMAGE' || type === 'CREATE_NODE' || type === 'DELETE_NODE') {
                    this.fetchSummary();
                }
            });
        }

        setupDomObserver() {
            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        m.addedNodes.forEach(node => {
                            if (node.nodeType === 1) {
                                // 忽略光标、选区、浮层、状态栏、overlay等高频变动的非素材节点，杜绝平移与光标晃动时重绘
                                if (
                                    node.id === 'lanCursorLayer' ||
                                    node.id === 'lanCollabStatusBar' ||
                                    node.id === 'lanCollabModal' ||
                                    node.classList?.contains('lan-collab-panel') ||
                                    node.classList?.contains('lan-cursor-layer') ||
                                    node.classList?.contains('lan-remote-cursor') ||
                                    node.classList?.contains('lan-asset-status-overlay') ||
                                    node.classList?.contains('smart-node-floating-menu') ||
                                    node.classList?.contains('node-floating-toolbar') ||
                                    node.classList?.contains('floating-toolbar') ||
                                    node.classList?.contains('selection-box') ||
                                    node.classList?.contains('smart-selection-box') ||
                                    node.classList?.contains('node-selection-box') ||
                                    (typeof node.closest === 'function' && (
                                        node.closest('#lanCursorLayer, .lan-cursor-layer, .lan-remote-cursor, .lan-asset-status-overlay, .smart-node-floating-menu, .node-floating-toolbar, .floating-toolbar')
                                    ))
                                ) {
                                    return;
                                }
                                // 查找新加入的图片或素材节点
                                const imgs = [];
                                if (node.tagName === 'IMG' && (node.src?.includes('/assets/lan/') || node.src?.includes('/api/lan/assets/') || node.hasAttribute('data-sha256'))) {
                                    imgs.push(node);
                                }
                                if (node.querySelectorAll) {
                                    node.querySelectorAll('img[src*="/assets/lan/"], img[src*="/api/lan/assets/"], [data-sha256]').forEach(img => imgs.push(img));
                                }
                                imgs.forEach(img => {
                                    const sha = img.getAttribute('data-sha256') || this.extractShaFromSrc(img.src);
                                    if (sha) {
                                        img.setAttribute('data-sha256', sha);
                                        // 若已知状态且已是 LOCAL_SAVED，避免重复网络请求与更新
                                        const cached = this.assetStates.get(sha);
                                        if (cached && cached.status === ASSET_STATES.LOCAL_SAVED && img.getAttribute('data-asset-status') === ASSET_STATES.LOCAL_SAVED) {
                                            return;
                                        }
                                        this.fetchAssetStatus(sha);
                                    }
                                });
                            }
                        });
                    }
                }
            });

            const target = document.getElementById('world') || document.body;
            observer.observe(target, { childList: true, subtree: true });
        }

        extractShaFromSrc(src) {
            if (!src) return null;
            const match = src.match(/([a-fA-F0-9]{64})/);
            return match ? match[1] : null;
        }

        startPolling() {
            // 每 4 秒拉取一次全局素材汇总与正在同步的素材进度
            this.pollTimer = setInterval(() => {
                this.fetchSummary();
                for (const [sha, info] of this.assetStates.entries()) {
                    if (info.status === ASSET_STATES.SYNCING || this.activeDownloads.has(sha)) {
                        this.fetchAssetStatus(sha);
                    }
                }
            }, 4000);
        }

        // =========================================================================
        // 5. 样式动态注入
        // =========================================================================
        injectAssetStyles() {
            const style = document.createElement('style');
            style.textContent = `
                /* 状态栏素材计数徽章 */
                .lan-asset-counter {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 2px 8px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 600;
                    color: #cbd5e1;
                    background: rgba(255, 255, 255, 0.08);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    margin-left: 8px;
                    transition: all 0.2s ease;
                }
                .lan-asset-counter .asset-icon-dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: #94a3b8;
                }
                .lan-asset-counter.is-all-saved {
                    color: #10b981;
                    border-color: rgba(16, 185, 129, 0.35);
                }
                .lan-asset-counter.is-all-saved .asset-icon-dot {
                    background: #10b981;
                    box-shadow: 0 0 6px #10b981;
                }
                .lan-asset-counter.is-syncing {
                    color: var(--text-primary, #f2f3f5);
                    border-color: var(--border-focus, rgba(255, 255, 255, 0.35));
                }
                .lan-asset-counter.is-syncing .asset-icon-dot {
                    background: var(--text-primary, #f2f3f5);
                    box-shadow: 0 0 6px var(--border-focus, rgba(255, 255, 255, 0.4));
                    animation: lan-live-pulse 1.2s infinite ease-in-out;
                }
                .lan-asset-counter.is-pending {
                    color: #f59e0b;
                    border-color: rgba(245, 158, 11, 0.35);
                }
                .lan-asset-counter.is-pending .asset-icon-dot {
                    background: #f59e0b;
                }

                /* 节点素材 5 态浮层 */
                .lan-asset-status-overlay {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    background: rgba(15, 23, 42, 0.65);
                    backdrop-filter: blur(2px);
                    border-radius: 6px;
                    z-index: 10;
                    pointer-events: auto;
                    user-select: none;
                    transition: opacity 0.2s ease;
                }

                /* 进度圆环 */
                .lan-asset-progress-wrap {
                    position: relative;
                    width: 44px;
                    height: 44px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .lan-asset-progress-ring {
                    width: 100%;
                    height: 100%;
                    transform: rotate(-90deg);
                }
                .lan-asset-progress-ring .ring-bg {
                    fill: none;
                    stroke: rgba(255, 255, 255, 0.2);
                    stroke-width: 3.5;
                }
                .lan-asset-progress-ring .ring-fg {
                    fill: none;
                    stroke: #ffffff;
                    stroke-width: 3.5;
                    stroke-linecap: round;
                    transition: stroke-dasharray 0.3s ease;
                }
                .lan-asset-progress-text {
                    position: absolute;
                    font-size: 10px;
                    font-weight: 700;
                    color: #ffffff;
                }
                .lan-asset-status-label {
                    margin-top: 6px;
                    font-size: 10px;
                    font-weight: 600;
                    color: #e2e8f0;
                    letter-spacing: 0.2px;
                }

                /* 在线成员持有徽章按钮 */
                .lan-asset-badge-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    padding: 4px 10px;
                    border-radius: 999px;
                    background: var(--btn-primary-bg, #ffffff);
                    color: var(--btn-primary-text, #090a0f);
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
                    transition: opacity 0.15s ease, background 0.15s ease;
                }
                .lan-asset-badge-btn:hover {
                    opacity: 0.92;
                }
                .lan-asset-badge-btn .badge-dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: #ffffff;
                }

                /* 离线警告徽章 */
                .lan-asset-badge-warn {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    padding: 4px 10px;
                    border-radius: 999px;
                    background: rgba(180, 83, 9, 0.85);
                    color: #fffbeb;
                    font-size: 11px;
                    font-weight: 600;
                    box-shadow: 0 4px 12px rgba(180, 83, 9, 0.4);
                }
            `;
            document.head.appendChild(style);
        }
    }

    // 暴露单例
    window.LanAssetManager = new LanAssetManager();

})();
