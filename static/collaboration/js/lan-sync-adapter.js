/**
 * 局域网画布前端协同适配器 (static/collaboration/js/lan-sync-adapter.js)
 * 职责：
 * 1. 检测 URL 参数 mode=lan 自动激活，管理本地 WebSocket (ws://<host>/api/lan/client/ws) 连接生命周期
 * 2. 拦截节点位移、尺寸、提示词、运行参数、图片产出操作，构造带 generationId 的不可变 CRDT Op 发送至后端
 * 3. 接收后端 op_applied 广播，精准局部更新目标节点 DOM
 * 4. 渲染提示词并发冲突徽标 (⚠️ 存在并发编辑版本) 与版本选择下拉菜单
 * 5. 阶段 3 & 4: 分布式席位治理、四色鼠标光标 (平滑插值移动)、顶部协作状态栏与选区高亮光晕
 * 6. LAN_INIT_COMPLETE 握手响应、单人 LOCAL_READY 稳定态收敛与错误重试机制
 */

(function () {
    'use strict';

    // 检查是否开启局域网协同模式
    const urlParams = new URLSearchParams(window.location.search);
    const canvasIdParam = urlParams.get('id') || urlParams.get('canvas_id') || '';
    const isLanParam = urlParams.get('mode') === 'lan' || canvasIdParam.startsWith('lan_');
    const isLanMode = isLanParam || document.documentElement.classList.contains('is-lan-mode');

    console.log(`[LanSyncAdapter] Initialized (isLanMode=${isLanMode})`);

    // 四色席位颜色映射与样式
    const COLOR_THEME_MAP = {
        '#ef4444': { name: '红', seatClass: 'seat-red', cursorClass: 'lan-cursor-red', selectClass: 'lan-node-selected-red' },
        '#3b82f6': { name: '蓝', seatClass: 'seat-blue', cursorClass: 'lan-cursor-blue', selectClass: 'lan-node-selected-blue' },
        '#10b981': { name: '绿', seatClass: 'seat-green', cursorClass: 'lan-cursor-green', selectClass: 'lan-node-selected-green' },
        '#a855f7': { name: '紫', seatClass: 'seat-purple', cursorClass: 'lan-cursor-purple', selectClass: 'lan-node-selected-purple' }
    };

    const SVG_CURSOR_POINTER = `
        <svg class="lan-cursor-svg" viewBox="0 0 24 24" fill="none">
            <path d="M5.65 3.15a1 1 0 0 0-1.4 1.15l4.3 15.3a1 1 0 0 0 1.85.15l3.2-6.5 6.5-3.2a1 1 0 0 0 .15-1.85L4.4 3.75z" />
        </svg>
    `;

    class LanSyncAdapter {
        constructor() {
            this.isLanMode = isLanMode;

            // 解析远端协同主机（协作者模式：支持 URL 参数或 localStorage 自动记忆）
            let hostCandidate = urlParams.get('host') || '';
            if (!hostCandidate) {
                try { hostCandidate = localStorage.getItem('lan_target_host') || ''; } catch(e) {}
            }
            this.remoteHost = (hostCandidate || '').trim();
            this.roomId = urlParams.get('roomId') || (() => { try { return localStorage.getItem('lan_room_id') || ''; } catch (_) { return ''; } })();
            this.memberId = urlParams.get('memberId') || (() => { try { return localStorage.getItem('lan_member_id') || ''; } catch (_) { return ''; } })();
            this.sessionId = urlParams.get('sessionId') || (() => { try { return localStorage.getItem('lan_session_id') || ''; } catch (_) { return ''; } })();

            this.ws = null;
            this.connected = false;
            this.reconnectTimer = null;
            this.reconnectAttempt = 0;
            this.reconnecting = false;
            this.localOpPeerId = this.getOrCreateLocalOpPeerId();
            this.localOpSeq = Number(sessionStorage.getItem(`lan_local_op_seq_${this.localOpPeerId}`) || 0);
            this.syncBaseline = null;
            this.deletedNodeSnapshots = new Map();
            this.pingTimer = null;
            this.deviceId = null;
            this.versionVector = {};
            this.nodesState = new Map(); // nodeId -> nodeData
            this.activeConflictDropdown = null;
            this.syncState = 'INITIALIZING'; // INITIALIZING | LOCAL_READY | ERROR
            this.lastErrorMsg = null;
            this.initTimeoutTimer = null;
            this.assetSummary = { total: 0, localSaved: 0 };
            this.localCursorBadge = null;
            this.sessionRefreshInFlight = null;

            // 读取用户本地偏好的光标颜色
            let preferredColor = '#ef4444';
            try {
                const saved = localStorage.getItem('lan_preferred_cursor_color');
                if (saved && COLOR_THEME_MAP[saved]) {
                    preferredColor = saved;
                }
            } catch(e) {}

            // Presence & 席位状态
            this.presence = {
                totalOnline: 1,
                writableCount: 1,
                maxWritable: 4,
                localRole: 'WRITABLE',
                localColor: preferredColor,
                localSeatName: COLOR_THEME_MAP[preferredColor]?.name || '活力红',
                isReadOnly: false,
                peers: []
            };

            // 远端光标与选区追踪
            this.remoteCursors = new Map(); // peerId -> { el, x, y, targetX, targetY, color, nickname }
            this.remoteSelections = new Map(); // peerId -> Set(nodeIds)
            this.cursorLayer = null;
            this.statusBarEl = null;

            // 鼠标节流
            this.lastMouseSendTime = 0;
            this.mouseThrottleInterval = 16; // 每帧最多发送一次，减少远端光标滞后
            this.cursorSendRaf = 0;
            this.pendingCursorPayload = null;
            this.pendingCursorForce = false;
            this.pendingOps = this.loadPendingOps();

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

        getSessionHeaders() {
            const headers = {};
            if (this.roomId) headers['X-LAN-Room-Id'] = this.roomId;
            if (this.memberId) headers['X-LAN-Member-Id'] = this.memberId;
            if (this.sessionId) headers['X-LAN-Session-Id'] = this.sessionId;
            return headers;
        }

        async refreshRoomSession() {
            if (!this.remoteHost || !this.roomId || !this.memberId || !this.sessionId) return true;
            if (this.sessionRefreshInFlight) return this.sessionRefreshInFlight;
            this.sessionRefreshInFlight = fetch(this.getApiUrl('/api/lan/room/heartbeat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...this.getSessionHeaders() },
                body: JSON.stringify({ roomId: this.roomId, memberId: this.memberId, sessionId: this.sessionId })
            }).then(async res => {
                if (!res.ok) return false;
                const data = await res.json().catch(() => ({}));
                if (data.members) this.updateRoomPresence(data.members);
                return true;
            }).catch(() => false).finally(() => { this.sessionRefreshInFlight = null; });
            return this.sessionRefreshInFlight;
        }

        updateRoomPresence(members) {
            if (!Array.isArray(members)) return;
            const onlineMembers = members.filter(member => member && member.online !== false);
            const peers = onlineMembers.map(member => ({
                deviceId: member.memberId,
                peerId: member.memberId,
                memberId: member.memberId,
                nickname: member.displayName || member.name || '协作者',
                color: member.color,
                role: member.role,
                online: true,
                isLocal: member.memberId === this.memberId,
                seatName: member.role === 'host' ? '房主' : '协作者',
                seatShortName: member.role === 'host' ? '主机' : '成员'
            }));
            this.updatePresenceState({
                totalOnline: onlineMembers.length,
                writableCount: onlineMembers.length,
                maxWritable: onlineMembers.length,
                isReadOnly: false,
                peers
            });
        }

        async init() {
            // 只有协作画布显示彩色鼠标；个人画布保持浏览器默认光标。
            if (this.isLanMode) {
                this.applyLocalCursorColor(this.presence.localColor, this.presence.localSeatName);
                this.setupColorPicker();
                this.setupMouseTracking();
            } else {
                document.documentElement.classList.add('is-personal-mode');
                document.body?.classList.add('is-personal-mode');
                const picker = document.getElementById('lanCursorColorPickerWrap');
                if (picker) picker.hidden = true;
            }

            if (!this.isLanMode) {
                // 如果当前未带 mode=lan，探测后端当前是否正在主持该画布的局域网协同房间（防刷新或从项目列表进入漏带参数）
                try {
                    const hostRes = await fetch(this.getApiUrl(`/api/lan/host/room?_t=${Date.now()}`));
                    if (hostRes.ok) {
                        const hostData = await hostRes.json();
                        const room = hostData?.room;
                        if (room && room.status === 'open') {
                            const curProject = urlParams.get('project');
                            const matchCanvas = room.canvasId && (room.canvasId === canvasIdParam || !canvasIdParam);
                            const matchProj = room.projectId && (room.projectId === curProject || room.projectName === curProject);
                            if (matchCanvas || matchProj) {
                                console.log('[LanSyncAdapter] Discovered active host room for this canvas/project, auto-activating LAN mode!');
                                this.isLanMode = true;
                                document.documentElement.classList.remove('is-personal-mode');
                                document.body.classList.remove('is-personal-mode');
                                document.documentElement.classList.add('is-lan-mode');
                                document.body.classList.add('is-lan-mode');
                                this.applyLocalCursorColor(this.presence.localColor, this.presence.localSeatName);
                                this.setupColorPicker();
                                this.setupMouseTracking();
                                if (this.headerBtn) {
                                    this.headerBtn.style.setProperty('display', 'inline-flex', 'important');
                                }
                                await this.activateLanCollab();
                                return;
                            }
                        }
                    }
                } catch(e) {}

                // 单人/非局域网模式下：确保彻底隐藏局域网协同按钮、协同状态栏与协同弹窗
                if (this.headerBtn) {
                    this.headerBtn.style.setProperty('display', 'none', 'important');
                }
                const statusBar = document.getElementById('lanCollabStatusBar');
                if (statusBar) {
                    statusBar.style.setProperty('display', 'none', 'important');
                }
                const modal = document.getElementById('lanCollabModal');
                if (modal) {
                    modal.style.setProperty('display', 'none', 'important');
                }
                console.log('[LanSyncAdapter] Standalone canvas mode: default cursor active, network sync dormant.');
                return;
            }

            if (this.headerBtn) {
                this.headerBtn.style.setProperty('display', 'inline-flex', 'important');
            }

            // 协同模式：启动顶部状态栏、图层、冲突标记与网络协同
            await this.activateLanCollab();
        }

        async activateLanCollab() {
            this.initStatusBar();
            this.initCursorLayer();
            this.injectConflictStyles();
            this.setupDomObserver();
            this.startInitTimeout();

            // 刷新页面后优先验证并续租已有房间会话，避免直接被旧 session 拒绝。
            await this.refreshRoomSession();

            // 1. 先请求 GET /api/lan/canvas，成功获取并挂载初始画布
            try {
                await this.fetchInitialCanvas();
            } catch (_) {
                this.scheduleReconnect();
                return;
            }

            // 2. 再建立本地 WebSocket
            this.connectWs();
            this.fetchInitialPresence();
        }

        enableLanMode() {
            if (this.isLanMode) return;
            this.isLanMode = true;
            document.documentElement.classList.remove('is-personal-mode');
            document.body?.classList.remove('is-personal-mode');
            this.applyLocalCursorColor(this.presence.localColor, this.presence.localSeatName);
            this.setupColorPicker();
            this.setupMouseTracking();
            this.activateLanCollab();
        }

        startInitTimeout() {
            if (this.initTimeoutTimer) {
                clearTimeout(this.initTimeoutTimer);
            }
            this.initTimeoutTimer = setTimeout(() => {
                if (this.syncState === 'INITIALIZING') {
                    console.warn('[LanSyncAdapter] Handshake timeout (5s) reached before receiving LAN_INIT_COMPLETE');
                    this.handleInitError('初始化超时（5秒内未完成握手）');
                }
            }, 5000);
        }

        // =========================================================================
        // 1. WebSocket 连接与生命周期
        // =========================================================================
        connectWs() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            let host = this.remoteHost;
            if (!host) {
                const defaultPort = '3000';
                host = window.location.host || (window.location.hostname ? `${window.location.hostname}:${window.location.port || defaultPort}` : `127.0.0.1:${defaultPort}`);
            } else {
                host = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
            }
            const wsParams = new URLSearchParams();
            if (this.roomId) wsParams.set('roomId', this.roomId);
            if (this.memberId) wsParams.set('memberId', this.memberId);
            if (this.sessionId) wsParams.set('sessionId', this.sessionId);
            const wsUrl = `${protocol}//${host}/api/lan/client/ws${wsParams.toString() ? `?${wsParams.toString()}` : ''}`;

            try {
                this.ws = new WebSocket(wsUrl);

                this.ws.onopen = () => {
                    console.log('[LAN][WS] OPEN - Connected to ' + wsUrl);
                    this.connected = true;
                    this.reconnecting = false;
                    this.reconnectAttempt = 0;
                    this.startHeartbeat();
                    this.flushPendingOps();
                    this.renderStatusBar();
                    if (this.presence && this.presence.localColor) {
                        try {
                            this.ws.send(JSON.stringify({
                                type: 'set_color',
                                peerId: this.localOpPeerId,
                                color: this.presence.localColor
                            }));
                        } catch(e) {}
                    }
                };

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        console.log('[LAN][WS] MESSAGE - Received:', data.type, data);
                        this.handleWsMessage(data);
                    } catch (e) {
                        console.error('[LanSyncAdapter] Error parsing WS message:', e);
                    }
                };

                this.ws.onclose = (event) => {
                    this.connected = false;
                    this.stopHeartbeat();
                    console.warn('[LAN][WS] CLOSE (code, reason):', event ? event.code : 'unknown', event ? event.reason : '');
                    if (this.syncState === 'INITIALIZING') {
                        this.handleInitError('WebSocket 连接已关闭');
                    } else if (this.syncState === 'LOCAL_READY' || this.syncState === 'RECOVERY_REQUIRED') {
                        this.reconnecting = true;
                        this.renderStatusBar();
                    }
                    this.scheduleReconnect();
                };

                this.ws.onerror = (err) => {
                    console.warn('[LAN][WS] ERROR:', err);
                    if (this.syncState === 'INITIALIZING') {
                        this.handleInitError('WebSocket 连接发生错误');
                    }
                    if (this.ws) {
                        try { this.ws.close(); } catch(e) {}
                    }
                };
            } catch (e) {
                console.warn('[LAN][WS] ERROR:', e);
                this.handleInitError(`无法建立 WebSocket 连接: ${e.message}`);
                this.scheduleReconnect();
            }
        }

        startHeartbeat() {
            this.stopHeartbeat();
            this.pingTimer = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send('ping');
                    this.ws.send(JSON.stringify({
                        type: 'heartbeat',
                        peerId: this.localOpPeerId,
                        deviceId: this.localOpPeerId
                    }));
                }
            }, 2000);
        }

        stopHeartbeat() {
            if (this.pingTimer) {
                clearInterval(this.pingTimer);
                this.pingTimer = null;
            }
        }

        scheduleReconnect() {
            if (this.reconnectTimer || document.visibilityState === 'hidden') return;
            if (this.syncState !== 'LOCAL_READY' && this.syncState !== 'RECOVERY_REQUIRED' && this.syncState !== 'ERROR' && this.syncState !== 'INITIALIZING') return;
            this.reconnecting = true;
            this.renderStatusBar();
            this.reconnectAttempt = Math.min((this.reconnectAttempt || 0) + 1, 6);
            const delay = Math.min(30000, 1000 * (2 ** (this.reconnectAttempt - 1)));
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.refreshRoomSession().finally(() => this.connectWs());
            }, delay);
        }

        handleWsMessage(msg) {
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'LAN_INIT_COMPLETE') {
                if (this.initTimeoutTimer) {
                    clearTimeout(this.initTimeoutTimer);
                    this.initTimeoutTimer = null;
                }
                this.syncState = 'LOCAL_READY';
                this.lastErrorMsg = null;
                this.deviceId = msg.deviceId || this.deviceId;
                this.versionVector = msg.versionVector || this.versionVector;
                if (msg.assetSummary) {
                    this.assetSummary = msg.assetSummary;
                    if (window.LanAssetManager && typeof window.LanAssetManager.updateSummary === 'function') {
                        window.LanAssetManager.updateSummary({
                            total: msg.assetSummary.total,
                            savedCount: msg.assetSummary.localSaved,
                            saved: msg.assetSummary.localSaved
                        });
                    }
                }
                if (msg.presence) {
                    this.updatePresenceState(msg.presence);
                } else {
                    this.renderStatusBar();
                }
                console.log(`[LanSyncAdapter] LAN_INIT_COMPLETE acknowledged: deviceId=${this.deviceId}, syncState=${this.syncState}`);
            } else if (msg.type === 'LAN_RECOVERY_REQUIRED' || msg.syncState === 'RECOVERY_REQUIRED') {
                if (this.initTimeoutTimer) {
                    clearTimeout(this.initTimeoutTimer);
                    this.initTimeoutTimer = null;
                }
                this.showRecoveryModal(msg.recovery || msg);
            } else if (msg.type === 'init') {
                this.deviceId = msg.deviceId;
                this.versionVector = msg.versionVector || {};
                if (msg.presence) {
                    this.updatePresenceState(msg.presence);
                }
                console.log(`[LanSyncAdapter] Initialized with deviceId: ${this.deviceId}`);
            } else if (msg.type === 'op_applied') {
                const opData = msg.data || {};
                this.applyRemoteOp(opData.op, opData.result);
            } else if (msg.type === 'generation_result') {
                const opData = msg.data || {};
                window.dispatchEvent(new CustomEvent('lan-generation-result', { detail: opData }));
            } else if (msg.type === 'presence_update') {
                this.updatePresenceState(msg.data);
            } else if (msg.type === 'cursor_update') {
                this.handleRemoteCursorUpdate(msg.data);
            }
        }

        showRecoveryModal(data) {
            this.syncState = 'RECOVERY_REQUIRED';
            if (this.initTimeoutTimer) {
                clearTimeout(this.initTimeoutTimer);
                this.initTimeoutTimer = null;
            }
            if (this.statusBarEl) {
                this.statusBarEl.classList.remove('is-single');
                this.statusBarEl.classList.add('is-error');
                const textEl = this.statusBarEl.querySelector('.lan-status-main');
                const subEl = this.statusBarEl.querySelector('.lan-status-sub');
                if (textEl) textEl.textContent = '⚠️ 协作画布数据损坏（已安全只读备份）';
                if (subEl) subEl.textContent = `备份路径: ${data.backupPath || 'data/lan/canvas.json.corrupted'}`;
            }

            let modal = document.getElementById('lanRecoveryModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'lanRecoveryModal';
                modal.className = 'lan-recovery-modal';
                document.body.appendChild(modal);
            }

            const canChk = !!data.canRecoverFromCheckpoint;
            const canPeers = !!data.canRecoverFromPeers;
            const backupPath = data.backupPath || 'data/lan/canvas.json.corrupted';

            modal.innerHTML = `
                <div class="lan-recovery-box">
                    <div class="lan-recovery-header">
                        <div class="lan-recovery-icon">⚠️</div>
                        <div class="lan-recovery-title">协作画布数据异常，需要恢复</div>
                    </div>
                    <div class="lan-recovery-body">
                        <p class="lan-recovery-desc">检测到现有的协作画布文件损坏或格式异常。为保证数据安全，系统已将原文件安全备份，当前处于<strong>只读保护状态</strong>。</p>
                        <div class="lan-recovery-backup-path">备份文件：<code>${this.escapeHtml(backupPath)}</code></div>
                        <div class="lan-recovery-steps">
                            <p>请选择恢复方式：</p>
                            <div class="lan-recovery-actions">
                                ${canChk ? `<button class="lan-btn-primary" id="lanBtnRecoverCheckpoint">从本地检查点恢复</button>` : ''}
                                ${canPeers ? `<button class="lan-btn-primary" id="lanBtnRecoverPeer">从在线协作成员拉取恢复</button>` : ''}
                                <button class="lan-btn-danger" id="lanBtnConfirmReset">创建新的空白协作画布</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            modal.style.display = 'flex';

            const btnChk = modal.querySelector('#lanBtnRecoverCheckpoint');
            if (btnChk) {
                btnChk.onclick = async () => {
                    try {
                        const r = await fetch(this.getApiUrl('/api/lan/recovery/from-checkpoint'), {
                            method: 'POST',
                            headers: this.getSessionHeaders()
                        });
                        const resData = await r.json();
                        if (resData.status === 'ok') {
                            modal.remove();
                            window.location.reload();
                        } else {
                            alert(`检查点恢复失败: ${resData.detail || resData.message}`);
                        }
                    } catch (e) {
                        alert(`恢复请求失败: ${e.message}`);
                    }
                };
            }

            const btnPeer = modal.querySelector('#lanBtnRecoverPeer');
            if (btnPeer) {
                btnPeer.onclick = async () => {
                    alert('正在尝试从在线 Peer 协商同步...');
                };
            }

            const btnReset = modal.querySelector('#lanBtnConfirmReset');
            if (btnReset) {
                btnReset.onclick = async () => {
                    if (confirm('确认放弃损坏数据并创建全新的空白协作画布吗？原损坏文件已保留在备份路径中。')) {
                        try {
                            const r = await fetch(this.getApiUrl('/api/lan/recovery/confirm-reset'), {
                                method: 'POST',
                                headers: this.getSessionHeaders()
                            });
                            const resData = await r.json();
                            if (resData.status === 'ok') {
                                modal.remove();
                                window.location.reload();
                            } else {
                                alert(`创建失败: ${resData.detail || resData.message}`);
                            }
                        } catch (e) {
                            alert(`请求失败: ${e.message}`);
                        }
                    }
                };
            }
        }


        handleInitError(errorMsg) {
            if (this.syncState === 'LOCAL_READY') {
                console.warn('[LanSyncAdapter] Warning after LOCAL_READY:', errorMsg);
                return;
            }
            if (this.initTimeoutTimer) {
                clearTimeout(this.initTimeoutTimer);
                this.initTimeoutTimer = null;
            }
            this.syncState = 'ERROR';
            this.lastErrorMsg = errorMsg;
            this.renderStatusBar();
        }

        async retryInit() {
            console.log('[LanSyncAdapter] Retrying initialization...');
            if (this.initTimeoutTimer) {
                clearTimeout(this.initTimeoutTimer);
                this.initTimeoutTimer = null;
            }
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            if (this.ws) {
                try {
                    this.ws.onclose = null;
                    this.ws.onerror = null;
                    this.ws.close();
                } catch(e) {}
                this.ws = null;
            }
            this.syncState = 'INITIALIZING';
            this.lastErrorMsg = null;
            this.renderStatusBar();
            this.startInitTimeout();

            // 1. 先请求 GET /api/lan/canvas
            try {
                await this.fetchInitialCanvas();
            } catch (_) {
                this.scheduleReconnect();
                return;
            }

            // 2. 再建立本地 WebSocket
            this.connectWs();
            this.fetchInitialPresence();
            if (window.LanAssetManager && typeof window.LanAssetManager.fetchSummary === 'function') {
                window.LanAssetManager.fetchSummary();
            }
        }

        // =========================================================================
        // 2. 顶部协作状态栏渲染与席位状态管理
        // =========================================================================
        initStatusBar() {
            this.headerBtn = document.getElementById('lanCollabToggle') || document.getElementById('lanCollabStatusBar');
            let bar = document.getElementById('lanCollabStatusBar');
            const topActions = document.getElementById('smartTopActions');
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'lanCollabStatusBar';
                bar.className = 'lan-collab-status-bar';
                bar.setAttribute('data-panel', 'lan');
                bar.setAttribute('role', 'button');
                bar.setAttribute('tabindex', '0');
                bar.setAttribute('title', '协作网络状态');
                bar.setAttribute('aria-label', '协作网络状态');
                bar.innerHTML = `
                    <div class="status-live-indicator"></div>
                    <div class="lan-status-content">
                        <div class="status-text lan-status-main">协作画布</div>
                        <div class="lan-status-sub" id="lanStatusSub">正在连接...</div>
                    </div>
                    <div class="status-members" id="lanStatusMembers"></div>
                `;
                if (topActions) {
                    topActions.insertBefore(bar, topActions.firstChild);
                } else {
                    const container = document.getElementById('shell') || document.body;
                    if (container) container.appendChild(bar);
                }
            } else {
                if (topActions && bar.parentElement !== topActions) {
                    topActions.insertBefore(bar, topActions.firstChild);
                }
            }
            bar.style.display = 'inline-flex';
            if (!bar._hasLanCollabClick) {
                bar._hasLanCollabClick = true;
                bar.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof window.SmartPanelManager !== 'undefined') {
                        window.SmartPanelManager.toggle('lan');
                    } else {
                        this.showPairingModal();
                    }
                });
            }
            this.statusBarEl = bar;
            this.renderStatusBar();
        }

        async updateCollabPanel() {
            this.renderStatusBar();
        }

        showPairingModal() {
            if (typeof window.SmartPanelManager !== 'undefined') {
                window.SmartPanelManager.open('lan');
            }
        }

        async fetchInitialPresence() {
            try {
                const res = await fetch(this.getApiUrl('/api/lan/presence'), { headers: this.getSessionHeaders() });
                if (res.ok) {
                    const data = await res.json();
                    this.updatePresenceState(data);
                }
            } catch (e) {
                console.warn('[LanSyncAdapter] Failed to fetch initial presence:', e);
            }
        }

        updatePresenceState(data) {
            if (!data) return;
            try {
                const savedColor = localStorage.getItem('lan_preferred_cursor_color');
                if (savedColor && COLOR_THEME_MAP[savedColor]) {
                    data.localColor = savedColor;
                    data.localSeatName = COLOR_THEME_MAP[savedColor].name;
                }
            } catch(e) {}
            this.presence = Object.assign(this.presence, data);

            // 即时刷新本地光标与席位指示
            this.applyLocalCursorColor(this.presence.localColor, this.presence.localSeatName);

            // 清理已离线成员的光标与选区
            const currentPeerIds = new Set((this.presence.peers || []).map(p => p.deviceId));
            for (const peerId of this.remoteCursors.keys()) {
                if (!currentPeerIds.has(peerId)) {
                    this.removeRemoteCursor(peerId);
                }
            }

            this.renderStatusBar();
            this.applyReadOnlyState();
        }

        renderStatusBar() {
            const btn = document.getElementById('lanCollabToggle') || this.headerBtn;
            const btnText = document.getElementById('lanCollabBtnText');
            const panelStatusDot = document.getElementById('lanPanelStatusDot');
            const panelStatusText = document.getElementById('lanPanelStatusText');
            const panelStatusDesc = document.getElementById('lanPanelStatusDesc');
            const panelMembersList = document.getElementById('lanPanelMembersList');
            const panelDeviceId = document.getElementById('lanPanelDeviceId');
            const panelSyncMeta = document.getElementById('lanPanelSyncMeta');

            const statusMainEl = this.statusBarEl?.querySelector('.lan-status-main');
            const statusSubEl = this.statusBarEl?.querySelector('.lan-status-sub') || document.getElementById('lanStatusSub');
            const statusMembersEl = this.statusBarEl?.querySelector('.status-members') || document.getElementById('lanStatusMembers');

            if (panelDeviceId) panelDeviceId.textContent = this.deviceId || '--';

            if (btn) {
                btn.classList.remove('status-connecting', 'status-online', 'status-error', 'status-readonly', 'status-unpaired');
            }

            // 1. 错误状态
            if (this.syncState === 'ERROR') {
                if (this.statusBarEl) {
                    this.statusBarEl.className = 'lan-collab-status-bar is-error';
                    if (statusMainEl) statusMainEl.textContent = '协同 · 异常';
                    if (statusSubEl) {
                        statusSubEl.innerHTML = `<span>${this.escapeHtml(this.lastErrorMsg || '网络服务不可用')}</span><button class="lan-retry-btn" onclick="window.LanSyncAdapter.retryInit()">重试初始化</button>`;
                    }
                }
                if (btn) {
                    btn.classList.add('status-error');
                    if (btnText) btnText.textContent = '协同 · 异常';
                }
                if (panelStatusDot) panelStatusDot.className = 'lan-panel-status-dot status-error';
                if (panelStatusText) panelStatusText.textContent = `协同连接异常: ${this.lastErrorMsg || '网络服务不可用'}`;
                    if (panelStatusDesc) panelStatusDesc.textContent = '无法与本地协作画布服务通信，请检查后台运行状态后重试。';
                if (panelMembersList) panelMembersList.innerHTML = '<span style="font-size:11px;color:var(--muted)">服务离线</span>';
                if (panelSyncMeta) {
                    panelSyncMeta.className = 'workflow-transfer-meta busy';
                    panelSyncMeta.textContent = `异常错误: ${this.lastErrorMsg || '连接失败'}`;
                }
                return;
            }

            // 2. 初始化握手中状态
            if (this.syncState === 'INITIALIZING') {
                if (this.statusBarEl) {
                    this.statusBarEl.className = 'lan-collab-status-bar';
                    if (statusMainEl) statusMainEl.textContent = '正在建立协作画布连接...';
                    if (statusSubEl) statusSubEl.textContent = '正在连接协同房间...';
                }
                if (btn) {
                    btn.classList.add('status-connecting');
                    if (btnText) btnText.textContent = '协同 · 连接中';
                }
                if (panelStatusDot) panelStatusDot.className = 'lan-panel-status-dot status-connecting';
                    if (panelStatusText) panelStatusText.textContent = '正在建立协作画布连接...';
                if (panelStatusDesc) panelStatusDesc.textContent = '正在连接协同房间并同步最新画布状态...';
                if (panelMembersList) panelMembersList.innerHTML = '<span style="font-size:11px;color:var(--muted)">正在同步在线席位...</span>';
                return;
            }

            // 3. 就绪状态 (LOCAL_READY)
            // 2b. 断线重连中
            if (this.reconnecting || (!this.connected && this.syncState === 'LOCAL_READY')) {
                if (this.statusBarEl) {
                    this.statusBarEl.className = 'lan-collab-status-bar is-reconnecting';
                    if (statusMainEl) statusMainEl.textContent = '连接已断开，正在重连...';
                    if (statusSubEl) statusSubEl.textContent = '约 3 秒后重试';
                }
                if (btn) {
                    btn.classList.add('status-connecting');
                    if (btnText) btnText.textContent = '协同 · 重连中';
                }
                if (panelStatusDot) panelStatusDot.className = 'lan-panel-status-dot status-connecting';
                if (panelStatusText) panelStatusText.textContent = '连接已断开，正在重连...';
                    if (panelStatusDesc) panelStatusDesc.textContent = '网络异常或服务暂停，正在自动重连协作画布。';
                if (panelMembersList) panelMembersList.innerHTML = '<span style="font-size:11px;color:var(--muted)">重连后将刷新在线成员</span>';
                if (panelSyncMeta) {
                    panelSyncMeta.className = 'workflow-transfer-meta busy';
                    panelSyncMeta.textContent = '连接已断开，正在重连...';
                }
                return;
            }

            const { totalOnline, maxWritable, isReadOnly, peers } = this.presence;
            const maxW = maxWritable || totalOnline || 1;

            if (isReadOnly) {
                if (this.statusBarEl) {
                    this.statusBarEl.className = 'lan-collab-status-bar is-readonly';
                    if (statusMainEl) statusMainEl.textContent = `只读观察模式 · 席位已满（${maxW}/${maxW}）`;
                    if (statusSubEl) statusSubEl.textContent = '操作已锁定';
                }
                if (btn) {
                    btn.classList.add('status-readonly');
                    if (btnText) btnText.textContent = `协同 · 只读(${maxW}/${maxW})`;
                }
                if (panelStatusDot) panelStatusDot.className = 'lan-panel-status-dot status-connecting';
                if (panelStatusText) panelStatusText.textContent = `只读观察模式 · 席位已满（${maxW}/${maxW}）`;
                if (panelStatusDesc) panelStatusDesc.textContent = '当前协同房间席位已达上限，您处于只读观察状态，操作已被锁定。';
            } else if (totalOnline <= 1) {
                if (this.statusBarEl) {
                    this.statusBarEl.className = 'lan-collab-status-bar is-single';
                    if (statusMainEl) statusMainEl.textContent = `在线 1/${maxW} · 本机独立工作区`;
                    if (statusSubEl) statusSubEl.textContent = `当前使用本机副本`;
                }
                if (btn) {
                    btn.classList.add('status-online');
                    if (btnText) btnText.textContent = `协同 · 在线 1/${maxW}`;
                }
                if (panelStatusDot) panelStatusDot.className = 'lan-panel-status-dot status-online';
                if (panelStatusText) panelStatusText.textContent = `在线 1/${maxW} · 本机独立工作区`;
                    if (panelStatusDesc) panelStatusDesc.textContent = '协作画布已就绪，当前暂无其他成员加入。';
            } else {
                if (this.statusBarEl) {
                    this.statusBarEl.className = 'lan-collab-status-bar';
                    if (statusMainEl) statusMainEl.textContent = `在线 ${totalOnline}/${maxW} · 多人实时协作中`;
                    if (statusSubEl) statusSubEl.textContent = '多人实时协作中';
                }
                if (btn) {
                    btn.classList.add('status-online');
                    if (btnText) btnText.textContent = `协同 · 在线 ${totalOnline}/${maxW}`;
                }
                if (panelStatusDot) panelStatusDot.className = 'lan-panel-status-dot status-online';
                if (panelStatusText) panelStatusText.textContent = `在线 ${totalOnline}/${maxW} · 多人实时协作中`;
                if (panelStatusDesc) panelStatusDesc.textContent = '已连接协作画布，所有节点位移、连线与生成实时同步中。';
            }

            // 渲染成员席位胶囊
            if (panelMembersList) {
                if (Array.isArray(peers) && peers.length > 0) {
                    let pillsHtml = '';
                    peers.forEach(peer => {
                        const isSelf = peer.deviceId === this.deviceId;
                        const peerColor = (isSelf && this.presence.localColor) ? this.presence.localColor : peer.color;
                        const theme = COLOR_THEME_MAP[peerColor] || { seatClass: 'seat-readonly', name: peer.seatShortName || '只读' };
                        const name = peer.nickname || peer.deviceId?.substring(0, 6) || '成员';
                        const selfTag = isSelf ? ' (我)' : '';
                        pillsHtml += `
                            <span class="lan-panel-member-item ${theme.seatClass}">
                                <span class="seat-dot"></span>
                                <span>${this.escapeHtml(name)} [${theme.name}]${selfTag}</span>
                            </span>
                        `;
                    });
                    panelMembersList.innerHTML = pillsHtml;
                } else {
                    const myTheme = COLOR_THEME_MAP[this.presence.localColor] || { seatClass: 'seat-red', name: '红' };
                    panelMembersList.innerHTML = `
                        <span class="lan-panel-member-item ${myTheme.seatClass}">
                            <span class="seat-dot"></span>
                            <span>本机用户 [${myTheme.name}] (我)</span>
                        </span>
                    `;
                }
            }

            // 同步信息卡片
            if (panelSyncMeta) {
                const summary = (window.LanAssetManager && window.LanAssetManager.summary) || {};
                const savedNum = typeof summary.savedCount === 'number' ? summary.savedCount : (summary.saved ?? this.assetSummary?.localSaved ?? 0);
                const totalNum = summary.total ?? this.assetSummary?.total ?? 0;
                panelSyncMeta.className = 'workflow-transfer-meta success';
                panelSyncMeta.innerHTML = `实时协同引擎就绪 · 设备 ID: <span style="font-family:monospace">${this.deviceId || '--'}</span> · 资产缓存: ${savedNum}/${totalNum}`;
            }

            if (typeof window.refreshIcons === 'function') {
                window.refreshIcons();
            } else if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        }

        applyReadOnlyState() {
            const isReadOnly = !!this.presence.isReadOnly;
            const body = document.body;
            if (isReadOnly) {
                body.classList.add('lan-readonly-mode');
            } else {
                body.classList.remove('lan-readonly-mode');
            }
        }

        // =========================================================================
        // 3. 四色远程鼠标光标与选区高亮
        // =========================================================================
        initCursorLayer() {
            let layer = document.getElementById('lanCursorLayer');
            const shell = document.getElementById('shell') || document.body;
            if (!layer) {
                layer = document.createElement('div');
                layer.id = 'lanCursorLayer';
                layer.className = 'lan-cursor-layer';
                layer.style.pointerEvents = 'none';
                layer.style.willChange = 'transform';
                shell.appendChild(layer);
            }
            layer.style.position = 'absolute';
            layer.style.inset = '0';
            layer.style.transform = 'none';
            this.cursorLayer = layer;
        }


        setupColorPicker() {
            const palette = document.getElementById('lanCursorColorPalette');
            if (palette) {
                palette.addEventListener('click', (e) => {
                    const btn = e.target.closest('.lan-color-swatch');
                    if (!btn) return;
                    const color = btn.getAttribute('data-color');
                    const name = btn.getAttribute('data-name');
                    if (!color) return;
                    this.setLocalCursorColor(color, name);
                });
            }
            this.syncColorPickerUI();
        }

        generateCursorSvgUri(color) {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5.65 3.15a1 1 0 0 0-1.4 1.15l4.3 15.3a1 1 0 0 0 1.85.15l3.2-6.5 6.5-3.2a1 1 0 0 0 .15-1.85L4.4 3.75z" fill="${color}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
            let base64;
            try {
                base64 = btoa(unescape(encodeURIComponent(svg)));
            } catch (e) {
                base64 = btoa(svg);
            }
            return `url("data:image/svg+xml;base64,${base64}") 4 3, auto`;
        }

        applyLocalCursorColor(color, seatName) {
            if (!color) return;
            const cursorUri = this.generateCursorSvgUri(color);

            try {
                document.documentElement.style.setProperty('--lan-local-cursor', cursorUri);
                document.documentElement.style.setProperty('--lan-local-cursor-color', color);

                const shell = document.getElementById('shell') || document.body;
                if (shell) {
                    shell.style.setProperty('--lan-local-cursor', cursorUri);
                    shell.style.setProperty('--lan-local-cursor-color', color);
                }

                const world = document.getElementById('world');
                if (world) {
                    world.style.setProperty('--lan-local-cursor', cursorUri);
                    world.style.setProperty('--lan-local-cursor-color', color);
                }
            } catch (e) {}

            this.updateLocalCursorBadge(color, seatName);
        }

        initLocalCursorBadge() {
            if (this.localCursorBadge) return;
            const shell = document.getElementById('shell') || document.body;
            let badge = document.getElementById('lanLocalCursorBadge');
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'lanLocalCursorBadge';
                badge.className = 'lan-cursor-badge lan-local-cursor-badge';
                badge.style.display = 'none';
                shell.appendChild(badge);
            }
            this.localCursorBadge = badge;
            this.updateLocalCursorBadge(this.presence.localColor, this.presence.localSeatName);
        }

        updateLocalCursorBadge(color, seatName) {
            if (!this.localCursorBadge) return;
            const name = this.presence?.localSeatName || seatName || '我';
            const avatar = '';
            const initial = String(name).trim().slice(0, 1).toUpperCase();
            this.localCursorBadge.style.setProperty('--lan-cursor-color', color);
            this.localCursorBadge.innerHTML = `
                <span class="lan-cursor-avatar">${avatar ? `<img src="${this.escapeHtml(avatar)}" alt="" />` : this.escapeHtml(initial)}</span>
                <span class="lan-cursor-name">${this.escapeHtml(name)}</span>
            `;
        }

        setLocalCursorColor(color, name) {
            if (!color) return;
            const theme = COLOR_THEME_MAP[color] || { name: name || '自定义' };
            const seatName = name || theme.name || '活力红';

            this.presence.localColor = color;
            this.presence.localSeatName = seatName;

            try {
                localStorage.setItem('lan_preferred_cursor_color', color);
            } catch(e) {}

            this.applyLocalCursorColor(color, seatName);
            this.syncColorPickerUI();
            this.renderStatusBar();

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try {
                    this.ws.send(JSON.stringify({
                        type: 'set_color',
                        peerId: this.localOpPeerId,
                        color: color
                    }));
                } catch(e) {}
            }
        }

        syncColorPickerUI() {
            const activeColor = (this.presence && this.presence.localColor) || '#ef4444';
            const labelEl = document.getElementById('lanCurrentColorLabel');
            if (labelEl) {
                const theme = COLOR_THEME_MAP[activeColor];
                labelEl.textContent = this.presence.localSeatName || (theme ? theme.name : '活力红');
            }

            const swatches = document.querySelectorAll('#lanCursorColorPalette .lan-color-swatch');
            swatches.forEach(btn => {
                const c = btn.getAttribute('data-color');
                if (c && c.toLowerCase() === activeColor.toLowerCase()) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        setupMouseTracking() {
            this.initLocalCursorBadge();

            const shell = document.getElementById('shell') || document.body;
            let latestMouseEvt = null;
            let shellRect = shell.getBoundingClientRect();
            const refreshShellRect = () => { shellRect = shell.getBoundingClientRect(); };
            window.addEventListener('resize', refreshShellRect, { passive: true });

            const updateBadgePosition = () => {
                if (!this.localCursorBadge || !latestMouseEvt) return;
                const e = latestMouseEvt;
                const sRect = shellRect;

                if (e.clientX >= sRect.left && e.clientX <= sRect.right &&
                    e.clientY >= sRect.top && e.clientY <= sRect.bottom) {

                    const localX = e.clientX - sRect.left + 15;
                    const localY = e.clientY - sRect.top + 15;
                    this.localCursorBadge.style.transform = `translate3d(${localX}px, ${localY}px, 0)`;
                    this.localCursorBadge.style.display = 'inline-flex';

                    const target = e.target;
                    const isInteractive = target && (
                        target.tagName === 'INPUT' ||
                        target.tagName === 'TEXTAREA' ||
                        target.tagName === 'BUTTON' ||
                        target.isContentEditable ||
                        target.closest('button, input, textarea, [contenteditable="true"]')
                    );
                    if (isInteractive) {
                        this.localCursorBadge.classList.add('is-dimmed');
                    } else {
                        this.localCursorBadge.classList.remove('is-dimmed');
                    }
                } else {
                    this.localCursorBadge.style.display = 'none';
                }
            };

            const handleMouseMove = (e) => {
                latestMouseEvt = e;
                updateBadgePosition();

            if (!this.isLanMode) return;

                const now = performance.now();
                if (now - this.lastMouseSendTime < this.mouseThrottleInterval) {
                    return;
                }
                this.lastMouseSendTime = now;

                const worldCoords = this.screenToWorldCoords(e);
                this.lastCursorWorld = { x: worldCoords.x, y: worldCoords.y };
                const selectingNodeIds = this.getCurrentlySelectedNodeIds();

                // 提取悬浮拖拽投影 (ghost)：优先读画布内存状态，避免热路径 DOM 查询。
                let draggingGhost = null;
                if (typeof window.getSmartDragGhost === 'function') {
                    try { draggingGhost = window.getSmartDragGhost(); } catch (_) {}
                }
                const ghostEl = draggingGhost ? null : document.querySelector('.smart-drag-floating-ghost');
                if (ghostEl && ghostEl.style.display !== 'none') {
                    const img = ghostEl.querySelector('img');
                    if (img) {
                        const url = img.src;
                        // 过滤巨大的 base64，避免阻塞 WS
                        if (!url.startsWith('data:') || url.length < 5000) {
                            draggingGhost = {
                                url: url,
                                width: parseFloat(ghostEl.style.width) || 120,
                                height: parseFloat(ghostEl.style.height) || 120
                            };
                        } else {
                            draggingGhost = {
                                url: '',
                                width: parseFloat(ghostEl.style.width) || 120,
                                height: parseFloat(ghostEl.style.height) || 120
                            };
                        }
                    }
                }

                // 提取正在拖拽的节点坐标：优先读画布内存状态，避免每次移动都查 DOM。
                let draggingNodes = [];
                if (typeof window.getSmartDragSnapshot === 'function') {
                    try {
                        const snapshot = window.getSmartDragSnapshot();
                        if (snapshot && snapshot.active) draggingNodes = snapshot.nodes;
                    } catch (_) {}
                } else {
                    selectingNodeIds.forEach(nid => {
                        const el = this.findNodeElement(nid);
                        if (el && el.classList.contains('dragging')) {
                            draggingNodes.push({
                                id: nid,
                                x: parseFloat(el.style.left) || 0,
                                y: parseFloat(el.style.top) || 0
                            });
                        }
                    });
                }

                this.queueCursorUpdate({
                        type: 'cursor_move',
                        peerId: this.localOpPeerId,
                        color: this.presence.localColor,
                        worldX: Math.round(worldCoords.x * 10) / 10,
                        worldY: Math.round(worldCoords.y * 10) / 10,
                        selectingNodeIds: selectingNodeIds,
                        draggingGhost: draggingGhost,
                        draggingNodes: draggingNodes
                });
            };

            this.sendDragStateClear = (finalNodes) => {
                // 保留最后已知光标位置：写 0 会把队友屏幕上的光标瞬移到左上角。
                const last = this.lastCursorWorld || { x: 0, y: 0 };
                // 拖动过程的位置是节流广播的，结束时的最终坐标必须补发一次，
                // 否则队友停留在中间帧坐标，连线会按偏掉的位置绘制（漂移）。
                const clearPayload = JSON.stringify({
                    type: 'cursor_move',
                    peerId: this.localOpPeerId,
                    color: this.presence.localColor,
                    worldX: last.x,
                    worldY: last.y,
                    selectingNodeIds: [],
                    draggingGhost: null,
                    draggingNodes: Array.isArray(finalNodes) ? finalNodes : []
                });
                try {
                    this.queueCursorUpdate(JSON.parse(clearPayload), true);
                } catch (_) {}
            };
            window.addEventListener('mousemove', handleMouseMove, { passive: true });
            document.addEventListener('mouseleave', () => {
                if (this.localCursorBadge) this.localCursorBadge.style.display = 'none';
            });
        }

        screenToWorldCoords(e) {
            const world = document.getElementById('world');
            const shell = document.getElementById('shell') || document.body;
            if (typeof window.screenToWorld === 'function') {
                try {
                    return window.screenToWorld(e);
                } catch (err) {}
            }
            if (world) {
                const sRect = shell.getBoundingClientRect();
                const transform = world.style.transform || '';
                const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/);
                if (match) {
                    const vx = parseFloat(match[1]);
                    const vy = parseFloat(match[2]);
                    const vs = parseFloat(match[3]) || 1;
                    return {
                        x: (e.clientX - sRect.left - vx) / vs,
                        y: (e.clientY - sRect.top - vy) / vs
                    };
                }
            }
            return { x: e.clientX, y: e.clientY };
        }

        findNodeElement(nodeId) {
            const raw = String(nodeId);
            const escaped = window.CSS?.escape ? CSS.escape(raw) : raw.replace(/(["\\])/g, '\\$1');
            return document.querySelector(`.image-node[data-id="${escaped}"], #node-${escaped}, [data-node-id="${escaped}"]`);
        }

        getCurrentlySelectedNodeIds() {
            // 优先读画布内存状态；DOM 查询是全文档扫描，放在鼠标热路径上会明显卡顿。
            if (typeof window.getSmartSelectionIds === 'function') {
                try {
                    const ids = window.getSmartSelectionIds();
                    if (Array.isArray(ids)) return ids;
                } catch (_) {}
            }
            const selected = [];
            const selectedNodes = document.querySelectorAll('.image-node.selected, .node.selected, [data-node-id].selected, .smart-node.selected');
            selectedNodes.forEach(el => {
                const nid = el.getAttribute('data-id') || el.getAttribute('data-node-id') || el.id?.replace(/^node-/, '');
                if (nid) selected.push(nid);
            });
            return selected;
        }

        handleRemoteCursorUpdate(data) {
            if (!data) return;
            const peerId = data.peerId || data.deviceId;
            // 忽略局域网服务回显的本机操作。
            if (!peerId || peerId === this.deviceId || peerId === this.localOpPeerId) {
                return;
            }

            const worldX = data.worldX;
            const worldY = data.worldY;
            const color = data.color || '#3b82f6';
            const nickname = data.nickname || `用户_${peerId.substring(0, 6)}`;
            const selectingNodeIds = data.selectingNodeIds || [];
            const draggingGhost = data.draggingGhost;
            const draggingNodes = data.draggingNodes || [];

            this.lastRemoteCursorMoveAt = this.lastRemoteCursorMoveAt || new Map();
            this.lastRemoteCursorMoveAt.set(String(peerId), performance.now());
            // 节点本体正在被拖动时不再叠加浮层投影，否则会出现两层重影。
            const ghostToRender = draggingNodes.length ? null : draggingGhost;
            this.updateRemoteCursor(peerId, worldX, worldY, color, nickname, ghostToRender, data.avatar || '');
            this.updateRemoteSelectionGlow(peerId, color, nickname, selectingNodeIds);

            // 同步节点模型坐标，连线与小地图才会跟随远端拖动。
            if (draggingNodes.length) {
                if (typeof window.applyRemoteDragPositions === 'function') {
                    window.applyRemoteDragPositions(draggingNodes);
                } else {
                    draggingNodes.forEach(nodeData => {
                        const el = this.findNodeElement(nodeData.id);
                        if (el) {
                            el.style.left = `${nodeData.x}px`;
                            el.style.top = `${nodeData.y}px`;
                        }
                    });
                }
            }
        }

        updateRemoteCursor(peerId, x, y, color, nickname, draggingGhost, avatar = '') {
            if (!this.cursorLayer) this.initCursorLayer();

            let cursorObj = this.remoteCursors.get(peerId);
            const theme = COLOR_THEME_MAP[color] || { cursorClass: 'lan-cursor-blue', name: '蓝' };

            if (!cursorObj) {
                const el = document.createElement('div');
                el.className = `lan-remote-cursor ${theme.cursorClass}`;
                el.setAttribute('data-peer-id', peerId);
                el.style.setProperty('--lan-cursor-color', color);
                const avatarInitial = String(nickname || '成').trim().slice(0, 1).toUpperCase();

                el.innerHTML = `
                    ${SVG_CURSOR_POINTER}
                    <div class="lan-cursor-badge">
                        <span class="lan-cursor-avatar">${avatar ? `<img src="${this.escapeHtml(avatar)}" alt="" />` : this.escapeHtml(avatarInitial)}</span>
                        <span class="lan-cursor-name">${this.escapeHtml(nickname)}</span>
                    </div>
                `;

                this.cursorLayer.appendChild(el);
                cursorObj = { el, x, y, color, nickname, avatar };
                this.remoteCursors.set(peerId, cursorObj);
            }

            // 更新颜色与昵称（如有变化）
            if (cursorObj.color !== color || cursorObj.nickname !== nickname || cursorObj.avatar !== avatar) {
                cursorObj.color = color;
                cursorObj.nickname = nickname;
                cursorObj.avatar = avatar;
                cursorObj.el.className = `lan-remote-cursor ${theme.cursorClass}`;
                cursorObj.el.style.setProperty('--lan-cursor-color', color);
                const nameEl = cursorObj.el.querySelector('.lan-cursor-name');
                if (nameEl) nameEl.textContent = nickname;
                const avatarEl = cursorObj.el.querySelector('.lan-cursor-avatar');
                if (avatarEl) {
                    const avatarInitial = String(nickname || '成').trim().slice(0, 1).toUpperCase();
                    avatarEl.innerHTML = avatar ? `<img src="${this.escapeHtml(avatar)}" alt="" />` : this.escapeHtml(avatarInitial);
                }
            }

            // 渲染远程拖拽投影 ghost
            let remoteGhost = cursorObj.el.querySelector('.lan-remote-ghost');
            if (draggingGhost) {
                if (!remoteGhost) {
                    remoteGhost = document.createElement('div');
                    remoteGhost.className = 'lan-remote-ghost';
                    remoteGhost.style.position = 'absolute';
                    remoteGhost.style.left = '0';
                    remoteGhost.style.top = '0';
                    remoteGhost.style.transform = 'translate(-50%, -50%)';
                    remoteGhost.style.pointerEvents = 'none';
                    remoteGhost.style.borderRadius = '12px';
                    remoteGhost.style.boxShadow = `0 16px 36px rgba(0,0,0,0.3), 0 0 0 2px ${color}`;
                    remoteGhost.style.opacity = '0.75';
                    remoteGhost.style.overflow = 'hidden';
                    remoteGhost.style.display = 'flex';
                    remoteGhost.style.alignItems = 'center';
                    remoteGhost.style.justifyContent = 'center';
                    
                    const img = document.createElement('img');
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = '12px';
                    img.style.display = 'block';
                    remoteGhost.appendChild(img);
                    
                    cursorObj.el.appendChild(remoteGhost);
                }
                remoteGhost.style.width = `${draggingGhost.width}px`;
                remoteGhost.style.height = `${draggingGhost.height}px`;
                const img = remoteGhost.querySelector('img');
                if (img && img.src !== draggingGhost.url) {
                    img.src = draggingGhost.url;
                }
                remoteGhost.style.display = 'flex';
            } else if (remoteGhost) {
                remoteGhost.style.display = 'none';
            }

            // 平滑插值平移
            cursorObj.x = x;
            cursorObj.y = y;
            const shell = document.getElementById('shell') || document.body;
            const shellRect = shell.getBoundingClientRect();
            const screenPoint = typeof window.worldToScreen === 'function'
                ? window.worldToScreen({x: Number(x) || 0, y: Number(y) || 0})
                : {x: shellRect.left + (Number(x) || 0), y: shellRect.top + (Number(y) || 0)};
            cursorObj.el.style.transform = `translate3d(${Math.round(screenPoint.x - shellRect.left)}px, ${Math.round(screenPoint.y - shellRect.top)}px, 0)`;
        }

        removeRemoteCursor(peerId) {
            const cursorObj = this.remoteCursors.get(peerId);
            if (cursorObj && cursorObj.el && cursorObj.el.parentNode) {
                cursorObj.el.parentNode.removeChild(cursorObj.el);
            }
            this.remoteCursors.delete(peerId);
            this.updateRemoteSelectionGlow(peerId, '#000', '', []);
        }

        updateRemoteSelectionGlow(peerId, color, nickname, nodeIds) {
            const prevSelected = this.remoteSelections.get(peerId) || new Set();
            const nextSelected = new Set(nodeIds);
            const theme = COLOR_THEME_MAP[color] || { selectClass: 'lan-node-selected-blue', name: '蓝' };

            // 移除不再选中的节点高亮
            for (const nid of prevSelected) {
                if (!nextSelected.has(nid)) {
                    const nodeEl = this.findNodeElement(nid);
                    if (nodeEl) {
                        nodeEl.classList.remove('lan-node-selected-red', 'lan-node-selected-blue', 'lan-node-selected-green', 'lan-node-selected-purple');
                        const tag = nodeEl.querySelector(`.lan-node-select-tag[data-peer-id="${peerId}"]`);
                        if (tag) tag.remove();
                        // 曾经为锚定标签改过定位的元素要还原，否则节点定位被永久改写。
                        if (nodeEl.dataset.lanTagPositionPatched) {
                            nodeEl.style.position = '';
                            delete nodeEl.dataset.lanTagPositionPatched;
                        }
                    }
                }
            }

            // 添加新选中节点高亮
            for (const nid of nextSelected) {
                const nodeEl = this.findNodeElement(nid);
                if (nodeEl) {
                    nodeEl.classList.add(theme.selectClass);
                    let tag = nodeEl.querySelector(`.lan-node-select-tag[data-peer-id="${peerId}"]`);
                    if (!tag) {
                        tag = document.createElement('div');
                        tag.className = 'lan-node-select-tag';
                        tag.setAttribute('data-peer-id', peerId);
                        // 画布节点本身就是 absolute，已是标签的包含块，绝不能再改成 relative：
                        // 那会改写节点定位，使视觉位置与用于绘制连线的坐标长期不一致（连线飘到空白处）。
                        if (getComputedStyle(nodeEl).position === 'static') {
                            nodeEl.style.position = 'relative';
                            nodeEl.dataset.lanTagPositionPatched = '1';
                        }
                        nodeEl.appendChild(tag);
                    }
                    tag.style.background = color;
                    tag.textContent = `${nickname} (${theme.name})`;
                }
            }

            this.remoteSelections.set(peerId, nextSelected);
        }

        // =========================================================================
        // 4. 获取初态与局部更新
        // =========================================================================
        async fetchInitialCanvas() {
            try {
                const res = await fetch(this.getApiUrl(`/api/lan/canvas?_t=${Date.now()}`), { headers: this.getSessionHeaders() });
                if (!res.ok) {
                    throw new Error(`获取初始画布数据失败 (HTTP ${res.status})`);
                }
                const data = await res.json();
                if (data.status === 'recovery_required') {
                    this.showRecoveryModal(data);
                    return;
                }
                if (data.status === 'ok' && data.canvas) {
                    const canvas = data.canvas;
                    this.syncBaseline = this.makeSnapshotBaseline(canvas);
                    if (Array.isArray(canvas.nodes)) {
                        canvas.nodes.forEach(node => {
                            this.nodesState.set(node.id, node);
                            this.checkAndRenderConflictBadge(node.id, node);
                        });
                    }
                }
            } catch (e) {
                console.error('[LanSyncAdapter] Failed to fetch initial canvas state:', e);
                this.handleInitError(`获取初始画布异常: ${e.message}`);
                throw e;
            }

        }

        applyRemoteOp(op, result) {
            if (!op) return;
            // 服务端会把操作广播给所有客户端（含发起者）。本机发起的操作本地已处理，
            // 再回放一次会触发多余的整画布重绘，这里直接跳过。
            if (op.peerId && op.peerId === this.localOpPeerId) return;
            const opType = (op.type || '').toUpperCase();
            const targetId = op.targetId;
            const payload = op.payload || {};

            console.log(`[LanSyncAdapter] Received remote op: ${opType} on ${targetId}`);

            if (opType === 'UPDATE_NODE_FIELD') {
                this.applyRemoteFieldUpdate(targetId, payload);
            } else if (opType === 'ADD_NODE_IMAGE') {
                this.applyRemoteAddImage(targetId, payload);
            } else if (opType === 'REMOVE_NODE_IMAGE') {
                this.applyRemoteRemoveImage(targetId, payload);
            } else if (opType === 'DELETE_NODE') {
                this.applyRemoteDeleteNode(targetId);
            } else if (opType === 'RESTORE_NODE' || opType === 'CREATE_NODE') {
                this.fetchInitialCanvas();
            } else if (opType === 'RESOLVE_FIELD_CONFLICT') {
                this.applyRemoteConflictResolved(targetId, payload);
            }
            // 远端操作统一触发整图合并，覆盖连线、视口、字段、素材和恢复操作。
            // 事件由 smart-canvas 节流处理，避免连续操作造成重复渲染。
            window.dispatchEvent(new CustomEvent('lan-op-applied', {
                detail: { op, result, peerId: op.peerId || '' }
            }));
        }

        applyRemoteFieldUpdate(nodeId, payload) {
            const nodeEl = this.findNodeElement(nodeId);
            const field = payload.field;
            const value = payload.value;
            const subfield = payload.subfield;

            // 维护内存状态
            let nodeState = this.nodesState.get(nodeId);
            if (!nodeState) {
                nodeState = { id: nodeId, generationId: payload.generationId };
                this.nodesState.set(nodeId, nodeState);
            }

            if (field === 'x' || field === 'y') {
                if (nodeEl) {
                    if (field === 'x') nodeEl.style.left = `${value}px`;
                    if (field === 'y') nodeEl.style.top = `${value}px`;
                }
                nodeState[field] = value;
            } else if (field === 'prompt') {
                if (nodeEl) {
                    const promptArea = nodeEl.querySelector('.node-prompt, textarea.prompt, [data-field="prompt"]');
                    if (promptArea && promptArea !== document.activeElement) {
                        promptArea.value = value;
                    }
                }
                nodeState.prompt = value;
                this.checkAndRenderConflictBadge(nodeId, nodeState);
            } else if (field === 'runSettings' && subfield) {
                if (!nodeState.runSettings) nodeState.runSettings = {};
                nodeState.runSettings[subfield] = value;
            }
        }

        applyRemoteAddImage(nodeId, payload) {
            const nodeEl = this.findNodeElement(nodeId);
            if (!nodeEl) return;

            const imgData = payload.image || payload;
            const imgContainer = nodeEl.querySelector('.node-images, .image-container, .node-media');
            if (imgContainer && imgData.url) {
                const imgEl = document.createElement('img');
                const routedUrl = typeof window.__xxdpLanRouteResource === 'function'
                    ? window.__xxdpLanRouteResource(imgData.url)
                    : imgData.url;
                imgEl.src = routedUrl;
                imgEl.className = 'lan-node-image';
                imgEl.setAttribute('data-item-id', imgData.itemId || '');
                imgEl.style.maxWidth = '100%';
                imgEl.style.borderRadius = '6px';
                imgEl.style.margin = '4px 0';
                imgContainer.appendChild(imgEl);
            }
        }

        applyRemoteRemoveImage(nodeId, payload) {
            const nodeEl = this.findNodeElement(nodeId);
            if (!nodeEl) return;
            const itemId = payload.itemId;
            const imgEl = nodeEl.querySelector(`[data-item-id="${itemId}"]`);
            if (imgEl) {
                imgEl.remove();
            }
        }

        applyRemoteDeleteNode(nodeId) {
            if (!nodeId) return;
            if (typeof window.applyRemoteCanvasDelete === 'function') {
                window.applyRemoteCanvasDelete(nodeId);
            } else {
                const nodeEl = this.findNodeElement(nodeId);
                if (nodeEl) nodeEl.remove();
            }
            this.nodesState.delete(nodeId);
        }

        applyRemoteConflictResolved(nodeId, payload) {
            const nodeState = this.nodesState.get(nodeId);
            if (nodeState) {
                nodeState.prompt = payload.chosenValue;
                if (nodeState.fieldConflictHistory) {
                    nodeState.fieldConflictHistory.prompt = [];
                }
            }
            this.removeConflictBadge(nodeId);
        }

        // =========================================================================
        // 5. 文本冲突提示徽标与版本下拉选择
        // =========================================================================
        checkAndRenderConflictBadge(nodeId, nodeData) {
            const conflictHistory = nodeData.fieldConflictHistory || {};
            const promptConflicts = conflictHistory.prompt || [];

            if (promptConflicts.length > 0) {
                this.renderConflictBadge(nodeId, promptConflicts);
            } else {
                this.removeConflictBadge(nodeId);
            }
        }

        renderConflictBadge(nodeId, conflicts) {
            const nodeEl = this.findNodeElement(nodeId);
            if (!nodeEl) return;

            let badge = nodeEl.querySelector('.lan-conflict-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'lan-conflict-badge';
                badge.innerHTML = `⚠️ 存在并发编辑版本 (${conflicts.length})`;
                badge.title = '点击查看并发冲突版本并一键恢复';

                badge.onclick = (e) => {
                    e.stopPropagation();
                    this.toggleConflictDropdown(badge, nodeId, conflicts);
                };

                const headerOrPrompt = nodeEl.querySelector('.node-prompt-wrapper, .node-header, .node-body') || nodeEl;
                // 同样只在静态定位时才设定位，避免覆盖节点自身的 absolute 定位。
                if (getComputedStyle(headerOrPrompt).position === 'static') {
                    headerOrPrompt.style.position = 'relative';
                }
                headerOrPrompt.appendChild(badge);
            } else {
                badge.innerHTML = `⚠️ 存在并发编辑版本 (${conflicts.length})`;
            }
        }

        removeConflictBadge(nodeId) {
            const nodeEl = this.findNodeElement(nodeId);
            if (!nodeEl) return;
            const badge = nodeEl.querySelector('.lan-conflict-badge');
            if (badge) badge.remove();
        }

        toggleConflictDropdown(badgeEl, nodeId, conflicts) {
            if (this.activeConflictDropdown) {
                this.activeConflictDropdown.remove();
                this.activeConflictDropdown = null;
                return;
            }

            const dropdown = document.createElement('div');
            dropdown.className = 'lan-conflict-dropdown';

            let itemsHtml = '<div class="lan-conflict-title">并发编辑冲突历史</div>';
            conflicts.forEach((item, index) => {
                const author = item.authorNickname || item.authorPeerId || '邻居设备';
                const timeStr = item.timestamp ? new Date(item.timestamp * 1000).toLocaleTimeString() : '';
                const preview = (item.losingValue || '').length > 60
                    ? (item.losingValue || '').substring(0, 60) + '...'
                    : (item.losingValue || '');

                itemsHtml += `
                    <div class="lan-conflict-item">
                        <div class="lan-conflict-item-header">
                            <span class="lan-author">${author}</span>
                            <span class="lan-time">${timeStr}</span>
                        </div>
                        <div class="lan-conflict-content">${this.escapeHtml(preview)}</div>
                        <button class="lan-restore-btn" data-index="${index}">采用此版本</button>
                    </div>
                `;
            });

            dropdown.innerHTML = itemsHtml;
            document.body.appendChild(dropdown);

            const rect = badgeEl.getBoundingClientRect();
            dropdown.style.top = `${rect.bottom + window.scrollY + 6}px`;
            dropdown.style.left = `${rect.left + window.scrollX}px`;

            dropdown.querySelectorAll('.lan-restore-btn').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.getAttribute('data-index'), 10);
                    const selectedConflict = conflicts[idx];
                    if (selectedConflict) {
                        await this.resolveConflict(nodeId, 'prompt', selectedConflict.losingValue);
                    }
                    if (dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);
                    this.activeConflictDropdown = null;
                };
            });

            const closeHandler = (e) => {
                if (!dropdown.contains(e.target) && e.target !== badgeEl) {
                    if (dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);
                    this.activeConflictDropdown = null;
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 10);

            this.activeConflictDropdown = dropdown;
        }

        async resolveConflict(nodeId, field, chosenValue) {
            try {
                const nodeState = this.nodesState.get(nodeId) || {};
                const res = await fetch(this.getApiUrl('/api/lan/nodes/conflict/resolve'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...this.getSessionHeaders() },
                    body: JSON.stringify({
                        node_id: nodeId,
                        generation_id: nodeState.generationId,
                        field: field,
                        chosen_value: chosenValue
                    })
                });

                if (res.ok) {
                    const nodeEl = this.findNodeElement(nodeId);
                    if (nodeState) {
                        nodeState[field] = chosenValue;
                        if (nodeState.fieldConflictHistory) {
                            nodeState.fieldConflictHistory[field] = [];
                        }
                    }
                    if (nodeEl) {
                        const promptArea = nodeEl.querySelector('.node-prompt, textarea.prompt, [data-field="prompt"]');
                        if (promptArea && field === 'prompt') promptArea.value = chosenValue;
                    }
                    this.removeConflictBadge(nodeId);
                    window.dispatchEvent(new CustomEvent('lan-conflict-resolved', { detail: { nodeId, field, chosenValue } }));
                }
            } catch (e) {
                console.error('[LanSyncAdapter] Failed to resolve conflict:', e);
            }
        }

        // =========================================================================
        // 6. 操作拦截与发送
        // =========================================================================
        getOrCreateLocalOpPeerId() {
            // 用会话级存储：同一浏览器多标签页必须各自独立，
            // 否则共用设备标识会让服务端把其他标签页的操作当成重复序号丢弃。
            try {
                const key = 'lan_local_op_peer_id';
                let id = sessionStorage.getItem(key);
                if (!id) {
                    id = `peer_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
                    sessionStorage.setItem(key, id);
                }
                return id;
            } catch (_) {
                return `peer_${Math.random().toString(36).slice(2, 10)}`;
            }
        }

        pendingOpsStorageKey() {
            return `lan_pending_ops_${this.roomId || 'local'}`;
        }

        loadPendingOps() {
            try {
                const raw = localStorage.getItem(this.pendingOpsStorageKey());
                const parsed = raw ? JSON.parse(raw) : [];
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) { return []; }
        }

        persistPendingOps() {
            try { localStorage.setItem(this.pendingOpsStorageKey(), JSON.stringify(this.pendingOps.slice(-200))); } catch (_) {}
        }

        queuePendingOp(op) {
            if (!op || !op.opId) return;
            if (!this.pendingOps.some(item => item.opId === op.opId)) {
                this.pendingOps.push(op);
                this.persistPendingOps();
            }
        }

        removePendingOp(opId) {
            const next = this.pendingOps.filter(item => item.opId !== opId);
            if (next.length !== this.pendingOps.length) {
                this.pendingOps = next;
                this.persistPendingOps();
            }
        }

        async flushPendingOps() {
            if (!this.pendingOps.length || this._flushingPendingOps) return;
            this._flushingPendingOps = true;
            try {
                const remaining = [];
                for (const op of this.pendingOps) {
                    const result = await this.submitOp(op, { fromQueue: true });
                    if (result?.status === 'ERROR') remaining.push(op);
                }
                this.pendingOps = remaining;
                this.persistPendingOps();
            } finally {
                this._flushingPendingOps = false;
            }
        }

        queueCursorUpdate(payload, force = false) {
            if (!payload) return;
            this.pendingCursorPayload = payload;
            this.pendingCursorForce = this.pendingCursorForce || force;
            if (this.cursorSendRaf) return;
            const flush = () => {
                this.cursorSendRaf = 0;
                const ws = this.ws;
                const next = this.pendingCursorPayload;
                const shouldForce = this.pendingCursorForce;
                this.pendingCursorPayload = null;
                this.pendingCursorForce = false;
                if (!ws || ws.readyState !== WebSocket.OPEN || !next) return;
                // WebSocket 缓冲区积压时只保留最新帧，避免远端播放过时拖动轨迹。
                if (!shouldForce && Number(ws.bufferedAmount || 0) > 32768) return;
                try { ws.send(JSON.stringify(next)); } catch (_) {}
            };
            this.cursorSendRaf = requestAnimationFrame(flush);
        }

        _nextOp(type, targetId, payload) {
            this.localOpSeq += 1;
            try { sessionStorage.setItem(`lan_local_op_seq_${this.localOpPeerId}`, String(this.localOpSeq)); } catch (_) {}
            return {
                opId: `op_${this.localOpPeerId}_${this.localOpSeq}`,
                peerId: this.localOpPeerId,
                seq: this.localOpSeq,
                hlc: `${Date.now()}:0:${this.localOpPeerId}`,
                type,
                targetId: String(targetId || ''),
                payload: payload || {},
                timestamp: Date.now()
            };
        }

        _stable(value) {
            try { return JSON.stringify(value === undefined ? null : value); } catch (_) { return String(value); }
        }

        _nodeFields(node) {
            const fields = {};
            Object.keys(node || {}).forEach(key => {
                if (['id', 'generationId', 'images', 'field_versions', 'fieldConflictHistory', 'deletedHlc'].includes(key)) return;
                fields[key] = node[key];
            });
            return fields;
        }

        _connectionParts(conn) {
            const c = conn || {};
            return {
                fromNode: String(c.fromNode || c.from || ''),
                toNode: String(c.toNode || c.to || ''),
                fromPort: String(c.fromPort || c.sourcePort || 'out'),
                toPort: String(c.toPort || c.targetPort || 'in'),
                kind: String(c.kind || 'flow')
            };
        }

        _connectionKey(conn) {
            const c = this._connectionParts(conn);
            return `${c.fromNode}:${c.fromPort}->${c.toNode}:${c.toPort}:${c.kind}`;
        }

        makeSnapshotBaseline(snapshot) {
            const source = snapshot || {};
            const nodes = Array.isArray(source.nodes) ? source.nodes : [];
            const nodeMap = new Map();
            nodes.forEach(node => {
                if (node && node.id) nodeMap.set(String(node.id), JSON.parse(JSON.stringify(node)));
            });
            const connections = new Map();
            (Array.isArray(source.connections) ? source.connections : (source.edges || [])).forEach(conn => {
                if (conn) connections.set(this._connectionKey(conn), this._connectionParts(conn));
            });
            const vp = source.viewport || {};
            return {
                nodes: nodeMap,
                connections,
                viewport: { x: Number(vp.x || 0), y: Number(vp.y || 0), scale: Number(vp.scale || 1) }
            };
        }

        setSyncBaseline(snapshot) {
            if (snapshot && typeof snapshot === 'object') {
                this.syncBaseline = this.makeSnapshotBaseline(snapshot);
            }
        }

        _imageMap(node) {
            const map = new Map();
            (Array.isArray(node?.images) ? node.images : []).forEach((image, index) => {
                if (!image || typeof image !== 'object') return;
                const itemId = String(image.itemId || image.id || `img_${node.id || 'node'}_${index}`);
                image.itemId = itemId;
                map.set(itemId, image);
            });
            return map;
        }

        async syncCanvasSnapshot(snapshot) {
            if (!this.isLanMode || !snapshot || typeof snapshot !== 'object') return { status: 'SKIPPED' };
            // 首次拿到本地快照时只建立基线，不把初始画布伪装成一批新操作。
            if (!this.syncBaseline) {
                this.syncBaseline = this.makeSnapshotBaseline(snapshot);
                return { status: 'BASELINE_ESTABLISHED' };
            }

            const current = this.makeSnapshotBaseline(snapshot);
            const jobs = [];
            const previousNodes = this.syncBaseline.nodes;
            current.nodes.forEach((node, nodeId) => {
                const previous = previousNodes.get(nodeId);
                const generationId = String(node.generationId || `gen_${this.localOpPeerId}_${Date.now().toString(36)}`);
                node.generationId = generationId;
                if (!previous) {
                    const deleted = this.deletedNodeSnapshots.get(nodeId);
                    if (deleted) {
                        jobs.push(this.submitOp(this._nextOp('RESTORE_NODE', nodeId, {
                            generationId,
                            snapshot: node
                        })));
                    } else {
                        jobs.push(this.submitOp(this._nextOp('CREATE_NODE', nodeId, {
                            generationId,
                            fields: { ...this._nodeFields(node), images: node.images || [] }
                        })));
                    }
                } else if (String(previous.generationId || '') !== generationId) {
                    jobs.push(this.submitOp(this._nextOp('RESTORE_NODE', nodeId, {
                        generationId,
                        snapshot: node
                    })));
                } else {
                    const oldFields = this._nodeFields(previous);
                    const newFields = this._nodeFields(node);
                    Object.keys(newFields).forEach(field => {
                        if (this._stable(oldFields[field]) === this._stable(newFields[field])) return;
                        if (field === 'runSettings' && newFields[field] && typeof newFields[field] === 'object') {
                            const oldSettings = oldFields[field] || {};
                            Object.keys(newFields[field]).forEach(subfield => {
                                if (this._stable(oldSettings[subfield]) !== this._stable(newFields[field][subfield])) {
                                    jobs.push(this.submitOp(this._nextOp('UPDATE_NODE_FIELD', nodeId, {
                                        generationId, field, subfield, value: newFields[field][subfield]
                                    })));
                                }
                            });
                        } else {
                            jobs.push(this.submitOp(this._nextOp('UPDATE_NODE_FIELD', nodeId, {
                                generationId, field, value: newFields[field]
                            })));
                        }
                    });
                    const oldImages = this._imageMap(previous);
                    const newImages = this._imageMap(node);
                    newImages.forEach((image, itemId) => {
                        if (!oldImages.has(itemId)) {
                            jobs.push(this.submitOp(this._nextOp('ADD_NODE_IMAGE', nodeId, {
                                generationId, itemId, image
                            })));
                        }
                    });
                    oldImages.forEach((image, itemId) => {
                        if (!newImages.has(itemId)) {
                            jobs.push(this.submitOp(this._nextOp('REMOVE_NODE_IMAGE', nodeId, {
                                generationId, itemId
                            })));
                        }
                    });
                }
            });

            previousNodes.forEach((node, nodeId) => {
                if (current.nodes.has(nodeId)) return;
                this.deletedNodeSnapshots.set(nodeId, node);
                jobs.push(this.submitOp(this._nextOp('DELETE_NODE', nodeId, {
                    generationId: node.generationId || ''
                })));
            });

            this.syncBaseline.connections.forEach((conn, key) => {
                if (!current.connections.has(key)) {
                    jobs.push(this.submitOp(this._nextOp('REMOVE_CONNECTION', `conn_${key}`, conn)));
                }
            });
            current.connections.forEach((conn, key) => {
                if (!this.syncBaseline.connections.has(key)) {
                    jobs.push(this.submitOp(this._nextOp('ADD_CONNECTION', `conn_${key}`, conn)));
                }
            });

            const oldVp = this.syncBaseline.viewport;
            const newVp = current.viewport;
            if (this._stable(oldVp) !== this._stable(newVp)) {
                jobs.push(this.submitOp(this._nextOp('UPDATE_VIEWPORT', 'viewport', newVp)));
            }

            this.syncBaseline = current;
            if (!jobs.length) return { status: 'NO_CHANGES' };
            return { status: 'SUBMITTED', count: jobs.length, results: await Promise.all(jobs) };
        }

        async submitDeleteNode(nodeId, generationId = '') {
            return this.submitOp(this._nextOp('DELETE_NODE', nodeId, { generationId: generationId || '' }));
        }

        async submitOp(op, options = {}) {
            try {
                const res = await fetch(this.getApiUrl('/api/lan/ops'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...this.getSessionHeaders() },
                    body: JSON.stringify({ op: op })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    if (!options.fromQueue) this.queuePendingOp(op);
                    return { status: 'ERROR', error: data.detail || `HTTP ${res.status}` };
                }
                this.removePendingOp(op.opId);
                return data;
            } catch (e) {
                console.error('[LanSyncAdapter] Failed to submit op:', e);
                if (!options.fromQueue) this.queuePendingOp(op);
                return { status: 'ERROR', error: e.message };
            }
        }

        // =========================================================================
        // 7. DOM 监听与样式注入
        // =========================================================================
        setupDomObserver() {
            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        m.addedNodes.forEach(node => {
                            if (node.nodeType === 1 && (node.getAttribute('data-id') || node.getAttribute('data-node-id'))) {
                                const nid = node.getAttribute('data-id') || node.getAttribute('data-node-id');
                                const state = this.nodesState.get(nid);
                                if (state) {
                                    this.checkAndRenderConflictBadge(nid, state);
                                }
                            }
                        });
                    }
                }
            });

            const canvasContainer = document.getElementById('world') || document.getElementById('shell') || document.body;
            observer.observe(canvasContainer, { childList: true, subtree: true });
        }

        injectConflictStyles() {
            const style = document.createElement('style');
            style.textContent = `
                .lan-conflict-badge {
                    position: absolute;
                    top: -10px;
                    right: 8px;
                    background: #f59e0b;
                    color: #ffffff;
                    font-size: 11px;
                    font-weight: bold;
                    padding: 2px 8px;
                    border-radius: 12px;
                    cursor: pointer;
                    box-shadow: 0 2px 6px rgba(245, 158, 11, 0.4);
                    z-index: 100;
                    user-select: none;
                    animation: lan-pulse 2s infinite ease-in-out;
                }
                .lan-conflict-badge:hover {
                    background: #d97706;
                }
                @keyframes lan-pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                }
                .lan-conflict-dropdown {
                    position: absolute;
                    width: 280px;
                    background: #1f2937;
                    border: 1px solid #374151;
                    border-radius: 8px;
                    padding: 10px;
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
                    z-index: 10000;
                    color: #e5e7eb;
                    font-family: system-ui, -apple-system, sans-serif;
                }
                .lan-conflict-title {
                    font-size: 12px;
                    font-weight: 600;
                    color: #9ca3af;
                    margin-bottom: 8px;
                    border-bottom: 1px solid #374151;
                    padding-bottom: 4px;
                }
                .lan-conflict-item {
                    background: #111827;
                    padding: 8px;
                    border-radius: 6px;
                    margin-bottom: 6px;
                    border: 1px solid #2d3748;
                }
                .lan-conflict-item-header {
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    color: #9ca3af;
                    margin-bottom: 4px;
                }
                .lan-author {
                    font-weight: 600;
                    color: var(--text, #e5e9f0);
                }
                .lan-conflict-content {
                    font-size: 12px;
                    color: #d1d5db;
                    margin-bottom: 6px;
                    word-break: break-all;
                }
                .lan-restore-btn {
                    background: #2563eb;
                    color: #ffffff;
                    border: none;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    cursor: pointer;
                    width: 100%;
                    transition: background 0.15s;
                }
                .lan-restore-btn:hover {
                    background: #1d4ed8;
                }
            `;
            document.head.appendChild(style);
        }

        escapeHtml(str) {
            if (!str) return '';
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
    }

    // 实例化适配器并挂载到 window
    window.LanSyncAdapter = new LanSyncAdapter();
})();
