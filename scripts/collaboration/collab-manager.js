import { BaseManager } from "../home/managers/base-manager.js";

/**
 * CollabManager: 管理局域网房间、主机发现、加入和会话状态同步。
 */
export class CollabManager extends BaseManager {
  bindLanHubEvents() {
    if (this.btnLanHubEnterCanvas) {
      this.btnLanHubEnterCanvas.addEventListener('click', () => {
        const canvasId = this.lanHubState.canvasId || 'lan_main';
        this.showWorkspace('协作画布', canvasId, '', true);
      });
    }

    if (this.btnLanHubRefresh) {
      this.btnLanHubRefresh.addEventListener('click', async () => {
        if (this.btnLanHubRefresh) {
          this.btnLanHubRefresh.style.transform = 'rotate(180deg)';
          setTimeout(() => {
            if (this.btnLanHubRefresh) this.btnLanHubRefresh.style.transform = '';
          }, 400);
        }
        await this.fetchLanHubState();
      });
    }

    if (this.btnLanHubNewCanvas) {
      this.btnLanHubNewCanvas.addEventListener('click', () => {
        this.handleNewLanCanvas();
      });
    }

    if (this.btnLanHubPairingCode) {
      this.btnLanHubPairingCode.addEventListener('click', () => {
        this.showLanPairingModal();
      });
    }

    if (this.btnCloseLanPairingModal) {
      this.btnCloseLanPairingModal.addEventListener('click', () => {
        this.hideLanPairingModal();
      });
    }

    if (this.lanPairingModal) {
      this.lanPairingModal.addEventListener('click', (e) => {
        if (e.target === this.lanPairingModal) {
          this.hideLanPairingModal();
        }
      });
    }

    if (this.btnLanHubCopyPairingCode) {
      this.btnLanHubCopyPairingCode.addEventListener('click', () => {
        this.handleCopyPairingCode();
      });
    }

    if (this.btnLanHubConfirmImportCode) {
      this.btnLanHubConfirmImportCode.addEventListener('click', () => {
        this.handleImportPairingCode();
      });
    }

    if (this.lanHubImportPairingCode) {
      this.lanHubImportPairingCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleImportPairingCode();
        }
      });
    }
  }

  async fetchLanHubState() {
    try {
      const [initRes, canvasesRes] = await Promise.all([
        fetch(`/api/lan/init-status?_t=${Date.now()}`),
        fetch(`/api/lan/canvases?_t=${Date.now()}`)
      ]);

      if (initRes.ok) {
        const initData = await initRes.json();
        this.lanHubState.ready = Boolean(initData.ready);
        this.lanHubState.workspaceId = initData.workspace_id || initData.workspaceId || 'lan_workspace';
        this.lanHubState.canvasId = initData.canvas_id || initData.canvasId || 'lan_main';
        this.lanHubState.peerCount = Number(initData.peer_count || initData.peerCount || 0);
        this.lanHubState.onlineCount = Number(initData.onlineCount || 1);
        this.lanHubState.role = initData.role || 'WRITABLE';
        this.lanHubState.seatName = initData.seatName || '活力红';
        this.lanHubState.localColor = initData.localColor || '#ef4444';
        this.lanHubState.onlinePeers = Array.isArray(initData.online_peers) ? initData.online_peers : [];
      }

      if (canvasesRes.ok) {
        const canvasesData = await canvasesRes.json();
        this.lanHubState.canvases = Array.isArray(canvasesData.canvases) ? canvasesData.canvases : [];
        if (this.lanHubState.canvases.length > 0) {
          const mainCanvas = this.lanHubState.canvases[0];
          this.lanHubState.nodesCount = mainCanvas.nodes_count || mainCanvas.nodesCount || 0;
          if (mainCanvas.title) this.lanHubState.title = mainCanvas.title;
        }
      }

      this.renderLanHub();
    } catch (err) {
      console.warn('[LAN Hub] 拉取状态失败:', err);
      if (this.lanHubMeshText) {
        this.lanHubMeshText.textContent = '正在重试连接协作服务...';
      }
    }
  }

  renderLanHub() {
    const s = this.lanHubState;

    if (this.lanHubMeshText) {
      if (s.peerCount > 0) {
        this.lanHubMeshText.textContent = `协作在线 · ${s.peerCount} 设备`;
      } else {
        this.lanHubMeshText.textContent = '协作在线';
      }
    }

    if (this.lanHubSeatText) {
      const roleText = s.role === 'WRITABLE' ? '读写' : '只读';
      this.lanHubSeatText.textContent = `席位：${s.seatName || '活力红'} (${roleText})`;
    }
    if (this.lanHubSeatDot) {
      this.lanHubSeatDot.style.background = s.localColor || '#ef4444';
      this.lanHubSeatDot.style.boxShadow = `0 0 6px ${s.localColor || '#ef4444'}80`;
    }

    if (this.lanHubWsId) {
      this.lanHubWsId.textContent = `Workspace: ${s.workspaceId.slice(0, 18)}`;
    }

    if (this.lanHubCanvasTitle && s.title) {
      this.lanHubCanvasTitle.textContent = s.title;
    }

    if (this.lanHubNodesCount) {
      this.lanHubNodesCount.textContent = String(s.nodesCount || 0);
    }

    if (this.lanHubOnlineCount) {
      this.lanHubOnlineCount.textContent = `${s.onlineCount} / 4`;
    }

    if (this.lanHubPeersCount) {
      this.lanHubPeersCount.textContent = `${s.peerCount} 节点`;
    }

    if (this.lanHubSyncStatus) {
      this.lanHubSyncStatus.textContent = s.ready ? '已就绪' : '同步中';
    }

    if (this.lanHubPeerSummary) {
      this.lanHubPeerSummary.textContent = `发现 ${s.peerCount} 台邻近设备 · 本机 (${s.seatName})`;
    }

    if (this.lanHubPeersGrid) {
      if (!s.onlinePeers || s.onlinePeers.length === 0) {
        this.lanHubPeersGrid.innerHTML = `
          <div class="lan-peers-empty">
            <div class="radar-scan-icon">
              <svg class="radar-anim" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
            </div>
            <div class="radar-empty-title">正在扫描可用协作设备...</div>
            <div class="radar-empty-desc">同一网络下的其他成员进入协作画布后将自动被探测；若跨网段，请使用右上角【协作配对码】快速直连。</div>
          </div>
        `;
      } else {
        const escapeHtml = (str) => String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        this.lanHubPeersGrid.innerHTML = s.onlinePeers.map((peer, idx) => {
          const color = peer.color || '#3b82f6';
          const name = escapeHtml(peer.nickname || '协作成员');
          const ip = escapeHtml(peer.hostIp || '127.0.0.1');
          const port = peer.port || 3000;
          const seatName = escapeHtml(peer.seatName || '协同席位');
          return `
            <div class="lan-peer-card">
              <div class="lan-peer-header">
                <div class="lan-peer-avatar" style="background: ${color}20; color: ${color}; border-color: ${color}50;">
                  <span>P${idx + 1}</span>
                </div>
                <div class="lan-peer-meta">
                  <div class="lan-peer-name">${name}</div>
                  <div class="lan-peer-ip">${ip}:${port}</div>
                </div>
              </div>
              <div class="lan-peer-footer">
                <span class="lan-peer-seat" style="color: ${color};">
                  <span class="dot" style="background: ${color};"></span>
                  ${seatName}
                </span>
                <span class="lan-peer-tag online">
                  <span class="pulse-dot"></span>
                  <span>已互联</span>
                </span>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  startLanHubPolling() {
    this.stopLanHubPolling();
    // 禁用自动定时轮询，避免后台内存浪费
  }

  stopLanHubPolling() {
    if (this.lanHubTimer) {
      clearInterval(this.lanHubTimer);
      this.lanHubTimer = null;
    }
  }

  async showLanPairingModal() {
    if (!this.lanPairingModal) return;
    this.lanPairingModal.style.display = 'flex';
    if (this.lanHubImportFeedback) {
      this.lanHubImportFeedback.style.display = 'none';
      this.lanHubImportFeedback.textContent = '';
    }
    if (this.lanHubImportPairingCode) {
      this.lanHubImportPairingCode.value = '';
    }
    if (this.lanHubCurrentPairingCode) {
      this.lanHubCurrentPairingCode.value = '正在拉取本机配对码...';
    }
    try {
      const res = await fetch(`/api/lan/pairing-code?_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (this.lanHubCurrentPairingCode) {
          this.lanHubCurrentPairingCode.value = data.pairing_code || '';
        }
      } else {
        if (this.lanHubCurrentPairingCode) {
          this.lanHubCurrentPairingCode.value = '获取配对码失败，请检查服务';
        }
      }
    } catch (err) {
      if (this.lanHubCurrentPairingCode) {
        this.lanHubCurrentPairingCode.value = '获取异常: ' + err.message;
      }
    }
  }

  hideLanPairingModal() {
    if (this.lanPairingModal) {
      this.lanPairingModal.style.display = 'none';
    }
  }

  async handleCopyPairingCode() {
    if (!this.lanHubCurrentPairingCode || !this.lanHubCurrentPairingCode.value) return;
    const code = this.lanHubCurrentPairingCode.value;
    try {
      await navigator.clipboard.writeText(code);
      if (this.btnLanHubCopyPairingCode) {
        const originalText = this.btnLanHubCopyPairingCode.innerHTML;
        this.btnLanHubCopyPairingCode.innerHTML = '<span>已复制！</span>';
        setTimeout(() => {
          if (this.btnLanHubCopyPairingCode) this.btnLanHubCopyPairingCode.innerHTML = originalText;
        }, 1500);
      }
    } catch (err) {
      this.lanHubCurrentPairingCode.select();
      document.execCommand('copy');
      if (this.btnLanHubCopyPairingCode) {
        const originalText = this.btnLanHubCopyPairingCode.innerHTML;
        this.btnLanHubCopyPairingCode.innerHTML = '<span>已复制！</span>';
        setTimeout(() => {
          if (this.btnLanHubCopyPairingCode) this.btnLanHubCopyPairingCode.innerHTML = originalText;
        }, 1500);
      }
    }
  }

  async handleImportPairingCode() {
    const code = (this.lanHubImportPairingCode?.value || '').trim();
    if (!code) {
      if (this.lanHubImportFeedback) {
        this.lanHubImportFeedback.className = 'lan-pairing-feedback error';
        this.lanHubImportFeedback.textContent = '请输入有效的配对码';
        this.lanHubImportFeedback.style.display = 'block';
      }
      return;
    }

    if (this.btnLanHubConfirmImportCode) {
      this.btnLanHubConfirmImportCode.disabled = true;
      this.btnLanHubConfirmImportCode.innerHTML = '<span>解析探测中...</span>';
    }

    try {
      const res = await fetch('/api/lan/pairing-code/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairing_code: code })
      });
      if (res.ok) {
        const data = await res.json();
        if (this.lanHubImportFeedback) {
          this.lanHubImportFeedback.className = 'lan-pairing-feedback success';
          this.lanHubImportFeedback.textContent = '配对成功！正在准备加入协作画布...';
          this.lanHubImportFeedback.style.display = 'block';
        }
        setTimeout(() => {
          this.hideLanPairingModal();
          const room = data.room || {};
          const targetHost = data.targetHost;
          const roomId = data.roomId || room.roomId;
          const requiresPasscode = room.requiresPasscode === true;
          const pin = data.pin || '';

          this.openLanJoinModal({
            targetHost: targetHost,
            roomId: roomId,
            projectName: room.projectName || '协作项目',
            hostName: room.hostName || '目标主机',
            requiresPasscode: requiresPasscode,
            passcode: pin
          });
        }, 500);
      } else {
        const errData = await res.json().catch(() => ({}));
        if (this.lanHubImportFeedback) {
          this.lanHubImportFeedback.className = 'lan-pairing-feedback error';
          this.lanHubImportFeedback.textContent = errData.detail || '配对码格式无效或连接目标失败';
          this.lanHubImportFeedback.style.display = 'block';
        }
      }
    } catch (err) {
      if (this.lanHubImportFeedback) {
        this.lanHubImportFeedback.className = 'lan-pairing-feedback error';
        this.lanHubImportFeedback.textContent = '导入异常: ' + err.message;
        this.lanHubImportFeedback.style.display = 'block';
      }
    } finally {
      if (this.btnLanHubConfirmImportCode) {
        this.btnLanHubConfirmImportCode.disabled = false;
        this.btnLanHubConfirmImportCode.innerHTML = '<span>解析并加入</span>';
      }
    }
  }

  async handleNewLanCanvas() {
      if (!window.confirm('确认初始化新的协作画布？这将创建全新的空白画板。')) {
      return;
    }
    try {
      const res = await fetch('/api/lan/canvases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '协作画布' })
      });
      if (res.ok) {
        await this.fetchLanHubState();
        this.showWorkspace('协作画布', this.lanHubState.canvasId || 'lan_main', '', true);
      } else {
        alert('初始化协同画布失败，请重试');
      }
    } catch (err) {
      alert('操作异常: ' + err.message);
    }
  }

  bindLanEvents() {
    this.bindLanHubEvents();
    this.restoreLanSessionFromStorage();


    if (this.btnLanBackHome) {


      this.btnLanBackHome.addEventListener('click', () => {


        this.showHome(this.workspaceName);


      });


    }


    if (this.lanBrandBackHome) {


      this.lanBrandBackHome.addEventListener('click', () => {


        this.showHome(this.workspaceName);


      });


    }





    if (this.lanHostProjectSelect) {
      this.lanHostProjectSelect.addEventListener('change', () => {
        this.onLanHostProjectChange();
      });
    }

    const togglePinMode = () => {
      const isCustom = this.lanPinModeCustom && this.lanPinModeCustom.checked;
      if (this.lanPinInputGroup) {
        this.lanPinInputGroup.style.display = isCustom ? 'block' : 'none';
      }
      if (isCustom && this.lanHostPasscodeInput) {
        if (!this.lanHostPasscodeInput.value) {
          this.lanHostPasscodeInput.value = `${Math.floor(1000 + Math.random() * 9000)}`;
        }
        this.lanHostPasscodeInput.focus();
      } else if (!isCustom && this.lanHostPasscodeInput) {
        this.lanHostPasscodeInput.value = '';
      }
    };

    if (this.lanPinModeNone) {
      this.lanPinModeNone.addEventListener('change', togglePinMode);
    }
    if (this.lanPinModeCustom) {
      this.lanPinModeCustom.addEventListener('change', togglePinMode);
    }
    if (this.btnLanRegenPin) {
      this.btnLanRegenPin.addEventListener('click', () => {
        if (this.lanHostPasscodeInput) {
          this.lanHostPasscodeInput.value = `${Math.floor(1000 + Math.random() * 9000)}`;
          this.lanHostPasscodeInput.focus();
        }
      });
    }





    if (this.btnLanCreateRoom) {


      this.btnLanCreateRoom.addEventListener('click', () => {


        this.handleLanHostCreateRoom();


      });


    }





    if (this.btnLanHostEnterSnapshot) {


      this.btnLanHostEnterSnapshot.addEventListener('click', () => {


        this.handleLanHostEnterSnapshot();


      });


    }


    const btnEnterCanvas = document.getElementById('btnLanHostEnterCanvas');
    if (btnEnterCanvas) {
      btnEnterCanvas.addEventListener('click', () => {
        if (!this.lanHostCurrentRoom) return;
        this.showWorkspace(
          this.lanHostCurrentRoom.projectName,
          this.lanHostCurrentRoom.canvasId,
          this.lanHostCurrentRoom.projectId,
          true
        );
      });
    }

    const btnSessionCanvas = document.getElementById('btnLanSessionEnterCanvas');
    if (btnSessionCanvas) {
      btnSessionCanvas.addEventListener('click', () => {
        if (!this.lanCurrentSession) return;
        this.showWorkspace(
          this.lanCurrentSession.projectName,
          this.lanCurrentSession.snapshot?.id || 'lan_main',
          '',
          true
        );
      });
    }

    const btnLanCopyIp = document.getElementById('btnLanCopyIp');
    if (btnLanCopyIp) {
      btnLanCopyIp.addEventListener('click', () => {
        const fullAddr = this.lanNetworkInfo?.fullAddress || document.getElementById('lanRibbonHostAddress')?.textContent?.trim();
        if (fullAddr && fullAddr !== '正在探测...') {
          navigator.clipboard.writeText(fullAddr).then(() => {
            const fb = document.getElementById('txtLanCopyIpFeedback');
            if (fb) {
              const orig = fb.textContent;
              fb.textContent = '已复制!';
              setTimeout(() => { if (fb) fb.textContent = orig; }, 1500);
            }
          }).catch(() => {
            alert('复制失败，请手动复制: ' + fullAddr);
          });
        }
      });
    }

    const btnLanPairingCodeShortcut = document.getElementById('btnLanPairingCodeShortcut');
    if (btnLanPairingCodeShortcut) {
      btnLanPairingCodeShortcut.addEventListener('click', () => {
        this.showLanPairingModal();
      });
    }





    if (this.btnLanHostAddMember) {


      this.btnLanHostAddMember.addEventListener('click', () => {


        this.handleLanHostAddInvite();


      });


    }





    if (this.lanHostNewMemberName) {


      this.lanHostNewMemberName.addEventListener('keydown', (e) => {


        if (e.key === 'Enter') {


          e.preventDefault();


          this.handleLanHostAddInvite();


        }


      });


    }





    if (this.btnLanHostCloseRoom) {


      this.btnLanHostCloseRoom.addEventListener('click', () => {


        this.handleLanHostCloseRoom();


      });


    }





    if (this.btnLanRefreshRooms) {
      this.btnLanRefreshRooms.addEventListener('click', async () => {
        this.btnLanRefreshRooms.classList.add('loading');
        try {
          if (this.isFixedLanEntry) {
            await this.loadFixedLanEntryRoom();
          } else {
            await this.fetchDiscoveredRooms();
            if (this.lanHostActiveCard && this.lanHostActiveCard.style.display !== 'none') {
              await this.fetchHostRoomStatus();
            }
            await this.fetchLanHubState();
          }
        } finally {
          setTimeout(() => {
            if (this.btnLanRefreshRooms) this.btnLanRefreshRooms.classList.remove('loading');
          }, 350);
        }
      });
    }





    if (this.btnLanManualProbe) {


      this.btnLanManualProbe.addEventListener('click', () => {


        this.handleLanManualProbe();


      });


    }





    if (this.btnCloseLanJoin) {


      this.btnCloseLanJoin.addEventListener('click', () => {


        this.closeLanJoinModal();


      });


    }





    if (this.btnCancelLanJoin) {


      this.btnCancelLanJoin.addEventListener('click', () => {


        this.closeLanJoinModal();


      });


    }





    if (this.lanJoinModal) {


      this.lanJoinModal.addEventListener('click', (e) => {


        if (e.target === this.lanJoinModal) {


          this.closeLanJoinModal();


        }


      });


    }





    if (this.lanJoinForm) {


      this.lanJoinForm.addEventListener('submit', (e) => {


        this.handleLanJoinSubmit(e);


      });


    }





    if (this.btnLanSessionAction) {


      this.btnLanSessionAction.addEventListener('click', () => {


        this.exitLanSession();


      });


    }





    if (this.btnLanAlertReturnLobby) {


      this.btnLanAlertReturnLobby.addEventListener('click', () => {


        this.exitLanSession();


      });


    }


  }

  showLan() {


    this.showHome(this.workspaceName, 'lan');


  }

  startLanDiscovery() {
    this.stopLanDiscovery();
    // 禁用自动高频轮询，避免内存浪费与性能消耗，由用户点击【刷新】按钮手动探测
  }

  stopLanDiscovery() {


    if (this.lanDiscoveryTimer) {


      clearInterval(this.lanDiscoveryTimer);


      this.lanDiscoveryTimer = null;


    }


  }

  stopLanHeartbeat() {


    if (this.lanHeartbeatTimer) {


      clearInterval(this.lanHeartbeatTimer);


      this.lanHeartbeatTimer = null;


    }


    this.lanHeartbeatFailCount = 0;


  }

  getStableDeviceId() {


    let id = localStorage.getItem('xxdp_device_id');


    if (!id || typeof id !== 'string' || !id.startsWith('dev_')) {


      id = `dev_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;


      try {


        localStorage.setItem('xxdp_device_id', id);


      } catch (e) {}


    }


    return id;


  }

  getDeviceName() {


    return this.workspaceName || '我的设备';


  }

  updateLanModeBadge(mode, count = 1) {


    const isLan = (mode === 'lan');


    const text = isLan ? `协作在线 · ${count}人` : '本地';





    const homeBadge = document.getElementById('homeTopStatusIndicator');


    const homeText = document.getElementById('homeTopStatusText');


    if (homeBadge) homeBadge.classList.toggle('lan-mode', isLan);


    if (homeText) homeText.textContent = text;





    const wsBadge = document.getElementById('workspaceTopStatusIndicator');


    const wsText = document.getElementById('workspaceTopStatusText');


    if (wsBadge) wsBadge.classList.toggle('lan-mode', isLan);


    if (wsText) wsText.textContent = text;





    const lanBadge = document.getElementById('lanTopStatusBadge');


    const lanText = document.getElementById('lanTopStatusText');


    if (lanBadge) lanBadge.classList.toggle('lan-mode', isLan);


    if (lanText) lanText.textContent = isLan ? `协作在线 · ${count}人` : '协作就绪';


  }

  async loadLanProjectsAndCanvases() {


    if (!this.lanHostProjectSelect) return;


    try {


      const [projRes, canvasRes] = await Promise.all([


        fetch('/api/projects').catch(() => null),


        fetch('/api/canvases').catch(() => null)


      ]);





      let projects = [];


      if (projRes && projRes.ok) {


        const pData = await projRes.json();


        projects = Array.isArray(pData?.projects) ? pData.projects : [];


      }





      this.lanAllCanvases = [];


      if (canvasRes && canvasRes.ok) {


        const cData = await canvasRes.json();


        this.lanAllCanvases = Array.isArray(cData?.canvases) ? cData.canvases : [];


      }





      this.lanAllProjects = projects;





      if (projects.length === 0) {


        this.lanHostProjectSelect.innerHTML = '<option value="">暂无可用项目，请先在主页新建项目</option>';


        if (this.lanHostCanvasSelect) this.lanHostCanvasSelect.innerHTML = '<option value="">无可用画布</option>';


        return;


      }





      this.lanHostProjectSelect.innerHTML = projects


        .map(p => `<option value="${this.escapeHtml(p.id)}">${this.escapeHtml(p.name || '未命名项目')}</option>`)


        .join('');





      this.onLanHostProjectChange();





      if (this.lanHostNameInput && !this.lanHostNameInput.value) {


        this.lanHostNameInput.value = `${this.workspaceName || '我的主机'}`;


      }


      if (this.lanHostPasscodeInput) {
        const isCustom = this.lanPinModeCustom && this.lanPinModeCustom.checked;
        if (isCustom && !this.lanHostPasscodeInput.value) {
          this.lanHostPasscodeInput.value = `${Math.floor(1000 + Math.random() * 9000)}`;
        } else if (!isCustom) {
          this.lanHostPasscodeInput.value = '';
        }
      }


    } catch (e) {


      console.warn('[LAN] 加载项目与画布失败', e);


    }


  }

  onLanHostProjectChange() {


    if (!this.lanHostProjectSelect || !this.lanHostCanvasSelect) return;


    const selectedProjId = this.lanHostProjectSelect.value;


    const canvases = (this.lanAllCanvases || []).filter(c => (c.project || 'default') === selectedProjId);





    if (canvases.length === 0) {


      this.lanHostCanvasSelect.innerHTML = '<option value="">该项目暂无可用画布</option>';


      return;


    }





    this.lanHostCanvasSelect.innerHTML = canvases
      .map(c => `<option value="${this.escapeHtml(c.id)}">${this.escapeHtml(c.title || c.id)}</option>`)
      .join('');
    if (canvases[0]) {
      this.lanHostCanvasSelect.value = canvases[0].id;
    }
  }

  async fetchHostRoomStatus() {


    try {


      const res = await fetch('/api/lan/host/room');


      if (!res.ok) return;


      const data = await res.json();


      const room = data?.room;





      if (room && room.status === 'open') {
        this.lanHostCurrentRoom = room;
        try { localStorage.setItem('xxdp_lan_host_room', JSON.stringify(room)); } catch(e) {}


        if (this.lanHostCreateFormWrap) this.lanHostCreateFormWrap.style.display = 'none';


        if (this.lanHostActiveCard) this.lanHostActiveCard.style.display = 'block';

        const portEl = document.getElementById('lanHostActiveRoomPort');
        if (portEl) portEl.textContent = `Port: ${room.port || 8910}`;
        const seatNameEl = document.getElementById('lanRibbonSeatName');
        if (seatNameEl) seatNameEl.textContent = '👑 房主席位 (广播中)';





        if (this.lanHostActiveRoomId) this.lanHostActiveRoomId.textContent = room.roomId;


        if (this.lanHostActiveProjName) this.lanHostActiveProjName.textContent = `${room.projectName} (${room.canvasTitle})`;


        if (this.lanHostActiveAddress) this.lanHostActiveAddress.textContent = `${room.hostIp}:${room.port}`;


        if (this.lanHostActivePasscode) {
          if (room.passcode && room.passcode.trim()) {
            this.lanHostActivePasscode.textContent = room.passcode;
            this.lanHostActivePasscode.classList.remove('no-pin');
          } else {
            this.lanHostActivePasscode.textContent = '无需 PIN 码 (自由加入)';
            this.lanHostActivePasscode.classList.add('no-pin');
          }
        }

        const syncTargetEl = document.getElementById('lanHostSyncTargetHint');
        if (syncTargetEl) {
          syncTargetEl.textContent = room.canvasTitle ? `实时同步至: ${room.canvasTitle}` : '实时同步至我的画布';
        }





        const members = Array.isArray(room.members) ? room.members : [];


        const onlineMembers = members.filter(m => m.online);


        if (this.lanHostMemberCount) this.lanHostMemberCount.textContent = onlineMembers.length;





        // 呈现成员固定专属色彩 Chip


        if (this.lanHostMembersChips) {


          this.lanHostMembersChips.innerHTML = members.map(m => `


            <span class="lan-member-chip ${m.role === 'host' || m.isHost ? 'host' : ''}" style="border-left: 3px solid ${m.color || '#3b82f6'};">


              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${m.color || '#3b82f6'};"></span>


              <span>${this.escapeHtml(m.displayName || m.name || m.memberId)}</span>


              <span style="font-size:10px;opacity:0.75;">(${m.online ? '在线' : '离线'})</span>


            </span>


          `).join('');


        }





        // 呈现一人一码专属验证码列表


        this.renderLanHostInvites(room.invites || [], members);





        // 更新全局顶部栏为局域网模式


        this.updateLanModeBadge('lan', onlineMembers.length);


      } else {
        this.lanHostCurrentRoom = null;
        try { localStorage.removeItem('xxdp_lan_host_room'); } catch(e) {}


        if (this.lanHostCreateFormWrap) this.lanHostCreateFormWrap.style.display = 'block';


        if (this.lanHostActiveCard) this.lanHostActiveCard.style.display = 'none';





        // 恢复个人单机模式


        this.updateLanModeBadge('personal');


      }


    } catch (e) {


      console.warn('[LAN] 获取主机房间状态失败', e);


    }


  }

  renderLanHostInvites(invites, members = []) {


    if (!this.lanHostInvitesList) return;


    if (!Array.isArray(invites) || invites.length === 0) {


      this.lanHostInvitesList.innerHTML = '<div class="lan-empty-invites" style="font-size:11px;color:var(--text-muted);padding:8px 0;text-align:center;">暂未生成同事专属码，上方输入姓名即可生成</div>';


      return;


    }





    const memberMap = new Map((members || []).map(m => [m.memberId, m]));





    this.lanHostInvitesList.innerHTML = invites.map(inv => {


      const member = memberMap.get(inv.memberId);


      const isOnline = Boolean(member && member.online);


      return `


        <div class="lan-invite-item ${inv.enabled ? '' : 'disabled'}" data-invite-id="${this.escapeHtml(inv.inviteId)}">


          <div class="lan-invite-info">


            <span class="lan-invite-color-dot" style="background:${inv.color || '#3b82f6'};box-shadow:0 0 6px ${inv.color || '#3b82f6'};"></span>


            <span class="lan-invite-name">${this.escapeHtml(inv.displayName)}</span>


            <span class="lan-invite-status-tag ${isOnline ? 'online' : 'offline'}">${isOnline ? '● 在线' : '○ 离线'}</span>


          </div>


          <div class="lan-invite-code-wrap">


            <span class="lan-invite-code" title="点击复制专属验证码" data-code="${this.escapeHtml(inv.code)}">


              ${this.escapeHtml(inv.code)}


            </span>


            <button type="button" class="lan-invite-btn-toggle ${inv.enabled ? '' : 'disabled'} btn-toggle-invite" data-invite-id="${this.escapeHtml(inv.inviteId)}" data-enabled="${inv.enabled}">


              ${inv.enabled ? '禁用' : '启用'}


            </button>


          </div>


        </div>


      `;


    }).join('');





    // 点击验证码一键复制


    this.lanHostInvitesList.querySelectorAll('.lan-invite-code').forEach(el => {


      el.addEventListener('click', () => {


        const code = el.dataset.code;


        if (code) {


          navigator.clipboard?.writeText(code).then(() => {


            const orig = el.textContent;


            el.textContent = '已复制';


            setTimeout(() => { el.textContent = orig; }, 1200);


          }).catch(() => {});


        }


      });


    });





    // 启用/禁用切换


    this.lanHostInvitesList.querySelectorAll('.btn-toggle-invite').forEach(btn => {


      btn.addEventListener('click', () => {


        const inviteId = btn.dataset.inviteId;


        const currentEnabled = btn.dataset.enabled === 'true';


        this.handleLanHostToggleInvite(inviteId, currentEnabled);


      });


    });


  }

  async handleLanHostAddInvite() {


    if (!this.lanHostNewMemberName || !this.lanHostCurrentRoom) return;


    const name = this.lanHostNewMemberName.value.trim();


    if (!name) {


      this.lanHostNewMemberName.focus();


      return;


    }





    if (this.btnLanHostAddMember) {


      this.btnLanHostAddMember.disabled = true;


      this.btnLanHostAddMember.textContent = '生成中..';


    }





    try {


      const res = await fetch('/api/lan/host/invite', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({ displayName: name })


      });





      if (!res.ok) {


        const err = await res.json().catch(() => ({}));


        throw new Error(err.detail || `生成失败 (HTTP ${res.status})`);


      }





      this.lanHostNewMemberName.value = '';


      await this.fetchHostRoomStatus();


    } catch (e) {


      await this.alert(`生成专属码失败： ${e.message}`, '生成失败');


    } finally {


      if (this.btnLanHostAddMember) {


        this.btnLanHostAddMember.disabled = false;


        this.btnLanHostAddMember.innerHTML = `


          <svg class="icon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>


          <span>生成专属码</span>


        `;


      }


    }


  }

  async handleLanHostToggleInvite(inviteId, currentEnabled) {


    if (!inviteId) return;


    try {


      const res = await fetch('/api/lan/host/invite/toggle', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({ inviteId, enabled: !currentEnabled })


      });





      if (!res.ok) {


        const err = await res.json().catch(() => ({}));


        throw new Error(err.detail || `切换失败 (HTTP ${res.status})`);


      }





      await this.fetchHostRoomStatus();


    } catch (e) {


      await this.alert(`操作失败: ${e.message}`, '操作失败');


    }


  }

  async handleLanHostCreateRoom() {
    if (!this.lanHostProjectSelect) return;

    const projectId = this.lanHostProjectSelect.value;
    let canvasId = this.lanHostCanvasSelect ? this.lanHostCanvasSelect.value : '';
    if (!canvasId && projectId) {
      const projCanvases = (this.lanAllCanvases || []).filter(c => (c.project || 'default') === projectId);
      if (projCanvases.length > 0) {
        canvasId = projCanvases[0].id;
      } else {
        canvasId = projectId;
      }
    }

    const hostName = this.lanHostNameInput?.value?.trim() || '我的主机';
    const isNoPin = this.lanPinModeNone ? this.lanPinModeNone.checked : true;
    let passcode = '';
    if (!isNoPin) {
      passcode = this.lanHostPasscodeInput?.value?.trim() || `${Math.floor(1000 + Math.random() * 9000)}`;
    }

    if (!projectId || !canvasId) {
      if (this.lanHostCreateError) {
        this.lanHostCreateError.textContent = '请选择包含有效画布的项目';
        this.lanHostCreateError.style.display = 'block';
      }
      return;
    }





    if (this.lanHostCreateError) this.lanHostCreateError.style.display = 'none';


    if (this.btnLanCreateRoom) {


      this.btnLanCreateRoom.disabled = true;


      this.btnLanCreateRoom.textContent = '正在创建并启动广播中..';


    }





    try {


      const projObj = (this.lanAllProjects || []).find(p => p.id === projectId);


      const canvasObj = (this.lanAllCanvases || []).find(c => c.id === canvasId);


      const projectName = projObj?.name || '未命名项目';


      const canvasTitle = canvasObj?.title || '智能画布';





      const res = await fetch('/api/lan/host/create', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({


          projectId,


          canvasId,


          projectName,


          canvasTitle,


          hostName,


          passcode


        })


      });





      if (!res.ok) {


        const errJson = await res.json().catch(() => ({}));


        throw new Error(errJson.detail || `创建失败 (HTTP ${res.status})`);


      }





      await this.fetchHostRoomStatus();


    } catch (err) {


      if (this.lanHostCreateError) {


        this.lanHostCreateError.textContent = `创建失败: ${err.message}`;


        this.lanHostCreateError.style.display = 'block';


      }


    } finally {


      if (this.btnLanCreateRoom) {


        this.btnLanCreateRoom.disabled = false;


        this.btnLanCreateRoom.innerHTML = `


          <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>


          <span>创建协作房间并开启广播</span>


        `;


      }


    }


  }

  async handleLanHostEnterSnapshot() {


    if (!this.lanHostCurrentRoom) return;


    try {


      const canvasRes = await fetch(`/api/canvases/${encodeURIComponent(this.lanHostCurrentRoom.canvasId)}`);


      if (!canvasRes.ok) throw new Error('读取画布快照失败');


      const canvasData = await canvasRes.json();


      const canvas = canvasData.canvas || canvasData;





      const snapshot = {


        id: canvas.id,


        title: canvas.title,


        nodes: canvas.nodes || [],


        connections: canvas.connections || [],


        viewport: canvas.viewport || { x: 0, y: 0, scale: 1 },


        updatedAt: canvas.updated_at


      };





      const sessionData = {


        role: 'host',


        roomId: this.lanHostCurrentRoom.roomId,


        memberId: this.lanHostCurrentRoom.hostId,


        sessionId: this.lanHostCurrentRoom.hostSessionId || this.lanHostCurrentRoom.members?.find(m => m.isHost || m.role === 'host')?.currentSessionId || '',


        targetHost: `${this.lanHostCurrentRoom.hostIp}:${this.lanHostCurrentRoom.port}`,


        projectName: this.lanHostCurrentRoom.projectName,


        hostName: this.lanHostCurrentRoom.hostName,


        snapshot: snapshot,


        members: this.lanHostCurrentRoom.members || []


      };





      this.enterLanSession(sessionData);


    } catch (err) {


      await this.alert(`无法读取快照: ${err.message}`, '读取失败');


    }


  }

  async handleLanHostCloseRoom() {


    const confirmed = await this.confirm({


      title: '关闭协作房间',


      message: '确定要关闭当前协作房间并停止广播吗？在线协作者将即刻断开',


      confirmText: '关闭房间',


      cancelText: '取消',


      danger: true


    });


    if (!confirmed) return;


    try {


      const res = await fetch('/api/lan/host/close', { method: 'POST' });


      if (res.ok) {


        this.updateLanModeBadge('personal');


        await this.fetchHostRoomStatus();


      }


    } catch (e) {


      console.warn('[LAN] 关闭房间失败:', e);


    }


  }

  async fetchDiscoveredRooms() {


    if (!this.lanDiscoveredRoomsList) return;


    try {


      const res = await fetch('/api/lan/discovery/rooms');


      if (!res.ok) return;


      const data = await res.json();


      const rooms = Array.isArray(data?.rooms) ? data.rooms : [];





      if (this.lanHubPeerSummary) {
        this.lanHubPeerSummary.textContent = rooms.length > 0 ? `发现 ${rooms.length} 个协同房间` : '扫描发现中';
      }

      const countHint = document.getElementById('lanDiscoveredCountHint');
      if (rooms.length === 0) {
        if (countHint) countHint.textContent = '已扫描当前子网 · 暂无房间';
        this.lanDiscoveredRoomsList.innerHTML = `
          <div class="lan-empty-list">
            <div class="lan-radar-scan-box">
              <span class="lan-radar-ring"></span>
              <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
            </div>
            <div class="lan-empty-title">正在实时扫描可用协作画板...</div>
            <div class="lan-empty-desc">同一局域网下的其他成员进入协作画布后将自动探测呈现</div>
          </div>
        `;
        return;
      }

      if (countHint) countHint.textContent = `已发现 ${rooms.length} 个活跃画板`;

      this.lanDiscoveredRoomsList.innerHTML = rooms.map(r => `
        <div class="lan-discovered-item" data-room-id="${this.escapeHtml(r.roomId)}">
          <div class="lan-item-info">
            <span class="lan-item-project">${this.escapeHtml(r.projectName || '未命名项目')}</span>
            <div class="lan-item-meta">
              <span>主机: ${this.escapeHtml(r.hostName || '协作主机')}</span>
              <span>·</span>
              <span style="font-family:monospace;">${this.escapeHtml(r.hostIp)}:${r.port}</span>
              <span>·</span>
              ${r.requiresPasscode ? '<span class="lan-badge-lock">🔒 需要 PIN 码</span>' : '<span class="lan-badge-open">⚡ 无需 PIN 码</span>'}
            </div>
          </div>
          <button type="button" class="lan-small-btn btn-join-discovered" data-room-raw='${JSON.stringify(r).replace(/'/g, "&apos;")}'>
            ${r.requiresPasscode ? '加入协作' : '直接加入'}
          </button>
        </div>
      `).join('');

      this.lanDiscoveredRoomsList.querySelectorAll('.btn-join-discovered').forEach(btn => {
        btn.addEventListener('click', () => {
          try {
            const raw = JSON.parse(btn.dataset.roomRaw);
            this.openLanJoinModal({
              targetHost: `${raw.hostIp}:${raw.port}`,
              roomId: raw.roomId,
              projectName: raw.projectName,
              hostName: raw.hostName,
              requiresPasscode: raw.requiresPasscode
            });
          } catch (e) {}
        });
      });
    } catch (e) {
      console.warn('[LAN] 拉取发现列表失败:', e);
    }
  }

  async fetchLanNetworkInfo() {
    try {
      const res = await fetch(`/api/lan/network/info?_t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok) {
        this.lanNetworkInfo = data;
        const ribbonIpEl = document.getElementById('lanRibbonHostAddress');
        if (ribbonIpEl && data.fullAddress) {
          ribbonIpEl.textContent = data.fullAddress;
        }
        if (this.lanHostActiveAddress && data.fullAddress) {
          this.lanHostActiveAddress.textContent = data.fullAddress;
        }
        const seatNameEl = document.getElementById('lanRibbonSeatName');
        if (seatNameEl) {
          seatNameEl.textContent = (data.activeRoom && data.activeRoom.status === 'open') ? '👑 房主席位 (广播中)' : '房主席位';
        }
      }
    } catch (e) {
      console.warn('[LAN] 获取网络参数异常:', e);
    }
  }

  renderRecentSessions() {
    const container = document.getElementById('lanRecentSessionsList');
    if (!container) return;
    let recents = [];
    try {
      const saved = localStorage.getItem('xxdp_lan_recent_sessions');
      if (saved) recents = JSON.parse(saved);
    } catch (e) {}

    if (!Array.isArray(recents) || recents.length === 0) {
      container.innerHTML = '<div class="lan-empty-recent">暂无最近协作记录，成功连入新房间后将自动记忆在此</div>';
      return;
    }

    container.innerHTML = recents.slice(0, 6).map((item, idx) => {
      const title = this.escapeHtml(item.projectName || '未命名画板');
      const host = this.escapeHtml(item.targetHost || item.hostIp || '未知主机');
      const timeStr = item.time ? this.formatRecentTime(item.time) : '最近';
      return `
        <div class="lan-recent-item" data-recent-idx="${idx}" title="点击重连: ${title} (${host})">
          <div class="recent-item-meta">
            <span class="recent-item-title">${title}</span>
            <span class="recent-item-host">${host} · ${timeStr}</span>
          </div>
          <button type="button" class="recent-item-btn">重连</button>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.lan-recent-item').forEach(itemEl => {
      itemEl.addEventListener('click', () => {
        const idx = Number(itemEl.dataset.recentIdx);
        const targetItem = recents[idx];
        if (!targetItem) return;
        if (this.lanManualIpInput) {
          this.lanManualIpInput.value = targetItem.targetHost || '';
        }
        if (targetItem.targetHost) {
          this.handleLanManualProbe(targetItem.targetHost);
        }
      });
    });
  }

  formatRecentTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return `${Math.floor(diff / 86400000)}天前`;
  }

  addRecentSession(sessionInfo) {
    if (!sessionInfo || !sessionInfo.targetHost) return;
    try {
      let list = [];
      const saved = localStorage.getItem('xxdp_lan_recent_sessions');
      if (saved) list = JSON.parse(saved);
      if (!Array.isArray(list)) list = [];
      list = list.filter(item => item.targetHost !== sessionInfo.targetHost && item.roomId !== sessionInfo.roomId);
      list.unshift({
        roomId: sessionInfo.roomId || '',
        projectName: sessionInfo.projectName || '协作画板',
        hostName: sessionInfo.hostName || '',
        targetHost: sessionInfo.targetHost || '',
        time: Date.now()
      });
      localStorage.setItem('xxdp_lan_recent_sessions', JSON.stringify(list.slice(0, 6)));
      this.renderRecentSessions();
    } catch (e) {}
  }

  async restoreLanSessionFromStorage() {
    let targetHost = '', roomId = '', memberId = '', sessionId = '';
    try {
      targetHost = localStorage.getItem('lan_target_host') || '';
      roomId = localStorage.getItem('lan_room_id') || '';
      memberId = localStorage.getItem('lan_member_id') || '';
      sessionId = localStorage.getItem('lan_session_id') || '';
    } catch (_) { return; }
    if (!targetHost || !roomId || !memberId || !sessionId) return;
    const base = (targetHost.startsWith('http') ? targetHost : `http://${targetHost}`).replace(/\/+$/, '');
    try {
      const hb = await fetch(`${base}/api/lan/room/heartbeat`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({roomId, memberId, sessionId})
      });
      if (!hb.ok) return;
      const hbData = await hb.json().catch(() => ({}));
      const info = await fetch(`${base}/api/lan/room/info?roomId=${encodeURIComponent(roomId)}`);
      const infoData = info.ok ? await info.json().catch(() => ({})) : {};
      const snap = await fetch(`${base}/api/lan/room/snapshot?roomId=${encodeURIComponent(roomId)}&memberId=${encodeURIComponent(memberId)}&sessionId=${encodeURIComponent(sessionId)}`);
      const snapData = snap.ok ? await snap.json().catch(() => ({})) : {};
      const room = infoData.room || {};
      this.enterLanSession({
        role: memberId === room.hostMemberId ? 'host' : 'client', roomId, memberId, sessionId,
        displayName: room.hostName || '协作者', color: '#3b82f6', targetHost,
        projectName: room.projectName || '协作项目', hostName: room.hostName || '协作主机',
        snapshot: snapData.snapshot || {}, members: hbData.members || []
      });
    } catch (_) {}
  }

  async loadFixedLanEntryRoom() {
    if (!this.lanDiscoveredRoomsList) return;
    try {
      const res = await fetch(`/api/lan/room/info?_t=${Date.now()}`);
      if (!res.ok) throw new Error(res.status === 404 ? '房主当前没有开放协作房间' : `读取房间失败 (HTTP ${res.status})`);
      const data = await res.json();
      const room = data?.room;
      if (!room?.roomId) throw new Error('房主当前没有开放协作房间');
      const targetHost = window.location.host;
      if (this.lanHubPeerSummary) this.lanHubPeerSummary.textContent = '已连接房主协作服务';
      this.lanDiscoveredRoomsList.innerHTML = `
        <div class="lan-discovered-item" data-room-id="${this.escapeHtml(room.roomId)}">
          <div class="lan-item-info">
            <span class="lan-item-project">${this.escapeHtml(room.projectName || '未命名项目')}</span>
            <div class="lan-item-meta">
              <span>主机: ${this.escapeHtml(room.hostName || '协作主机')}</span>
              <span>·</span>
              <span style="font-family:monospace;">${this.escapeHtml(targetHost)}</span>
              <span>·</span>
              ${room.requiresPasscode ? '<span class="lan-badge-lock">需要 PIN 码</span>' : '<span class="lan-badge-open">无需 PIN 码</span>'}
            </div>
          </div>
          <button type="button" class="lan-small-btn btn-join-current-room">
            ${room.requiresPasscode ? '加入协作' : '直接加入'}
          </button>
        </div>`;
      this.lanDiscoveredRoomsList.querySelector('.btn-join-current-room')?.addEventListener('click', () => {
        this.openLanJoinModal({
          targetHost,
          roomId: room.roomId,
          projectName: room.projectName,
          hostName: room.hostName,
          requiresPasscode: room.requiresPasscode
        });
      });
    } catch (error) {
      if (this.lanHubPeerSummary) this.lanHubPeerSummary.textContent = '等待房主开放协作房间';
      this.lanDiscoveredRoomsList.innerHTML = `<div class="lan-empty-list">${this.escapeHtml(error.message || '房主当前没有开放协作房间')}</div>`;
    }
  }

  async handleLanManualProbe() {


    if (!this.lanManualIpInput) return;


    const target = this.lanManualIpInput.value.trim();


    if (!target) {


      if (this.lanManualError) {


        this.lanManualError.textContent = '请输入目标主机 IP 或 IP:端口';


        this.lanManualError.style.display = 'block';


      }


      return;


    }





    if (this.lanManualError) this.lanManualError.style.display = 'none';


    if (this.btnLanManualProbe) {


      this.btnLanManualProbe.disabled = true;


      this.btnLanManualProbe.textContent = '探测中..';


    }





    try {


      const res = await fetch('/api/lan/probe', {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({ target })


      });





      if (!res.ok) {


        const err = await res.json().catch(() => ({}));


        throw new Error(err.detail || `无法连接至目标主机（HTTP ${res.status})`);


      }





      const data = await res.json();


      const room = data.room;


      if (!room || !room.roomId) {


        throw new Error('目标主机当前未开放协作房');


      }





      this.openLanJoinModal({
        targetHost: data.target || ((room.hostIp && room.port) ? `${room.hostIp}:${room.port}` : target),
        roomId: room.roomId,
        projectName: room.projectName,
        hostName: room.hostName,
        requiresPasscode: room.requiresPasscode
      });


    } catch (err) {


      if (this.lanManualError) {


        this.lanManualError.textContent = `探测失败: ${err.message}`;


        this.lanManualError.style.display = 'block';


      }


    } finally {


      if (this.btnLanManualProbe) {


        this.btnLanManualProbe.disabled = false;


        this.btnLanManualProbe.innerHTML = `


          <svg class="icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>


          <span>探测连接</span>


        `;


      }


    }


  }

  openLanJoinModal(targetInfo) {
    this.lanTargetPendingJoin = targetInfo;
    if (this.lanJoinTargetProject) this.lanJoinTargetProject.textContent = targetInfo.projectName || '未命名项目';
    if (this.lanJoinTargetHost) this.lanJoinTargetHost.textContent = targetInfo.hostName || '协作主机';
    if (this.lanJoinTargetAddress) this.lanJoinTargetAddress.textContent = targetInfo.targetHost;

    // 只有服务端明确标记需要 PIN 时才要求密码；兼容旧房间信息时再回退检查 passcode。
    const requiresPin = targetInfo.requiresPasscode === true || (
      targetInfo.requiresPasscode == null && Boolean(String(targetInfo.passcode || '').trim())
    );
    const passcodeField = document.getElementById('lanJoinPasscodeField');
    const noPinBanner = document.getElementById('lanJoinNoPinBanner');
    const pinLabel = document.querySelector('label[for="lanJoinPasscodeInput"]');
    const pinDesc = document.querySelector('#lanJoinForm .xxdp-dialog-desc');
    const btnSubmit = document.getElementById('btnSubmitLanJoin');

    if (this.lanJoinPasscodeInput) {
      this.lanJoinPasscodeInput.value = targetInfo.passcode || '';
      if (!requiresPin) {
        if (passcodeField) passcodeField.style.display = 'none';
        if (noPinBanner) noPinBanner.style.display = 'flex';
        this.lanJoinPasscodeInput.removeAttribute('required');
        if (pinLabel) pinLabel.textContent = '专属验证码 (选填)';
        if (pinDesc) pinDesc.textContent = '此房间无需 PIN 码即可加入，点击即可直接进入协作画布';
        if (btnSubmit) btnSubmit.innerHTML = '<span>直接进入协作画布</span>';
      } else {
        if (passcodeField) passcodeField.style.display = 'block';
        if (noPinBanner) noPinBanner.style.display = 'none';
        this.lanJoinPasscodeInput.placeholder = '请输入 4 位 PIN 码或专属码';
        this.lanJoinPasscodeInput.setAttribute('required', 'required');
        if (pinLabel) pinLabel.textContent = '专属验证码 (PIN) *';
        if (pinDesc) pinDesc.textContent = '请输入房主设置的 4 位 PIN 码或分配的专属席位码';
        if (btnSubmit) btnSubmit.innerHTML = '<span>验证并加入协作</span>';
      }
    }

    if (this.lanJoinNameInput && !this.lanJoinNameInput.value) {
      this.lanJoinNameInput.value = `协作者-${Math.floor(100 + Math.random() * 900)}`;
    }

    if (this.lanJoinErrorHint) {
      this.lanJoinErrorHint.style.display = 'none';
      this.lanJoinErrorHint.textContent = '';
    }

    if (this.lanJoinModal) {
      this.lanJoinModal.style.display = 'flex';
      this.lanJoinModal.classList.add('active');
    }
    setTimeout(() => {
      if (requiresPin && this.lanJoinPasscodeInput) {
        this.lanJoinPasscodeInput.focus();
      } else if (this.lanJoinNameInput) {
        this.lanJoinNameInput.focus();
      }
    }, 60);
  }

  closeLanJoinModal() {
    if (this.lanJoinModal) {
      this.lanJoinModal.classList.remove('active');
      this.lanJoinModal.style.display = 'none';
    }
    this.lanTargetPendingJoin = null;
    if (this.lanJoinErrorHint) {
      this.lanJoinErrorHint.style.display = 'none';
      this.lanJoinErrorHint.textContent = '';
    }
  }

  async handleLanJoinSubmit(e) {
    if (e) e.preventDefault();
    if (!this.lanTargetPendingJoin || !this.lanJoinPasscodeInput) return;

    const passcode = this.lanJoinPasscodeInput.value.trim();
    const deviceId = this.getStableDeviceId();
    const deviceName = this.getDeviceName();
    const clientName = this.lanJoinNameInput?.value?.trim() || '';

    const pendingRoom = this.lanTargetPendingJoin || {};
    const requiresPin = pendingRoom.requiresPasscode === true || (
      pendingRoom.requiresPasscode == null && Boolean(String(pendingRoom.passcode || '').trim())
    );
    if (requiresPin && !passcode) {
      if (this.lanJoinErrorHint) {
        this.lanJoinErrorHint.textContent = '请输入房主设置的 PIN 码或专属验证码';
        this.lanJoinErrorHint.style.display = 'block';
      }
      return;
    }





    if (this.lanJoinErrorHint) this.lanJoinErrorHint.style.display = 'none';


    if (this.btnSubmitLanJoin) {


      this.btnSubmitLanJoin.disabled = true;


      this.btnSubmitLanJoin.textContent = '正在验证并绑定身份中..';


    }





    try {


      const targetHost = this.lanTargetPendingJoin.targetHost;


      const targetUrl = targetHost.startsWith('http') ? targetHost : `http://${targetHost}`;


      const joinUrl = `${targetUrl.replace(/\/+$/, '')}/api/lan/room/join`;





      const res = await fetch(joinUrl, {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify({


          roomId: this.lanTargetPendingJoin.roomId,


          passcode: passcode,


          deviceId: deviceId,


          deviceName: deviceName,


          clientName: clientName


        })


      });





      if (!res.ok) {


        const errData = await res.json().catch(() => ({}));


        throw new Error(errData.detail || `验证失败 (HTTP ${res.status})`);


      }





      const joinData = await res.json();


      const pending = this.lanTargetPendingJoin;


      this.closeLanJoinModal();





      const sessionData = {


        role: 'client',


        roomId: pending?.roomId || '',


        memberId: joinData.memberId,


        sessionId: joinData.sessionId,


        displayName: joinData.displayName,


        color: joinData.color,


        targetHost: pending?.targetHost || '',


        projectName: joinData.room?.projectName || pending?.projectName || '协作项目',


        hostName: joinData.room?.hostName || pending?.hostName || '协作主机',


        snapshot: joinData.snapshot,


        members: joinData.members || []
      };

      this.addRecentSession({
        roomId: sessionData.roomId,
        projectName: sessionData.projectName,
        hostName: sessionData.hostName,
        targetHost: sessionData.targetHost
      });

      this.enterLanSession(sessionData);


    } catch (err) {


      if (this.lanJoinErrorHint) {


        this.lanJoinErrorHint.textContent = `加入失败: ${err.message}`;


        this.lanJoinErrorHint.style.display = 'block';


      }


    } finally {


      if (this.btnSubmitLanJoin) {


        this.btnSubmitLanJoin.disabled = false;


        this.btnSubmitLanJoin.textContent = '验证并获取快';


      }


    }


  }

  enterLanSession(sessionData) {


    this.lanCurrentSession = sessionData;
    try {
      localStorage.setItem('lan_target_host', sessionData.targetHost || '');
      localStorage.setItem('lan_room_id', sessionData.roomId || '');
      localStorage.setItem('lan_member_id', sessionData.memberId || '');
      localStorage.setItem('lan_session_id', sessionData.sessionId || '');
    } catch (_) {}


    this.stopLanDiscovery();





    if (this.lanLobbyContainer) this.lanLobbyContainer.style.display = 'none';


    if (this.lanSessionContainer) this.lanSessionContainer.style.display = 'flex';


    if (this.lanSessionAlertBanner) this.lanSessionAlertBanner.style.display = 'none';





    if (this.lanSessionRoleBadge) {


      if (sessionData.role === 'host') {


        this.lanSessionRoleBadge.innerHTML = '<span>👑 主机模式</span>';


        this.lanSessionRoleBadge.classList.add('host');


      } else {


        const color = sessionData.color || '#3b82f6';


        const name = this.escapeHtml(sessionData.displayName || '协作');


        this.lanSessionRoleBadge.innerHTML = `


          <span style="display:inline-flex;align-items:center;gap:6px;">


            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};"></span>


            <span>${name}</span>


          </span>


        `;


        this.lanSessionRoleBadge.classList.remove('host');


      }


    }


    if (this.lanSessionProjectTitle) {


      this.lanSessionProjectTitle.textContent = sessionData.projectName || '协作项目';


    }


    if (this.lanSessionHostInfo) {


      this.lanSessionHostInfo.textContent = `主机: ${sessionData.hostName} (${sessionData.targetHost})`;


    }





    const members = sessionData.members || [];


    const onlineCount = members.filter(m => m.online).length;


    this.updateLanModeBadge('lan', onlineCount || members.length);


    this.updateLanSessionPresence(members);


    this.renderReadOnlySnapshot(sessionData.snapshot);





    this.startLanHeartbeat();


  }

  startLanHeartbeat() {


    this.stopLanHeartbeat();


    if (!this.lanCurrentSession) return;





    this.lanHeartbeatTimer = setInterval(async () => {


      if (!this.lanCurrentSession) return;


      const targetHost = this.lanCurrentSession.targetHost;


      const targetUrl = targetHost.startsWith('http') ? targetHost : `http://${targetHost}`;


      const hbUrl = `${targetUrl.replace(/\/+$/, '')}/api/lan/room/heartbeat`;





      try {


        const res = await fetch(hbUrl, {


          method: 'POST',


          headers: { 'Content-Type': 'application/json' },


          body: JSON.stringify({


            roomId: this.lanCurrentSession.roomId,


            memberId: this.lanCurrentSession.memberId,


            sessionId: this.lanCurrentSession.sessionId


          })


        });





        if (res.ok) {


          this.lanHeartbeatFailCount = 0;


          const data = await res.json();


          if (data.status === 'closed') {


          this.showLanSessionAlert('房间已关闭：房主已结束本次协作画布');


            this.stopLanHeartbeat();


            return;


          }


          const members = data.members || [];


          const onlineCount = members.filter(m => m.online).length;


          this.updateLanModeBadge('lan', onlineCount || members.length);


          this.updateLanSessionPresence(members);


        } else if (res.status === 403) {


          this.showLanSessionAlert('访问受限：您的专属验证码已被房主禁用');


          this.stopLanHeartbeat();


        } else if (res.status === 401 || res.status === 404) {


          this.showLanSessionAlert('连接已过期或已失效，请重新加入');


          this.stopLanHeartbeat();


        } else {


          this.lanHeartbeatFailCount++;


          if (this.lanHeartbeatFailCount >= 3) {


            this.showLanSessionAlert('与主机连接中断，正在自动恢复...');


          }


        }


      } catch (err) {


        this.lanHeartbeatFailCount++;


        if (this.lanHeartbeatFailCount >= 3) {


          this.showLanSessionAlert('与主机连接中断，正在自动恢复...');


        }


      }


    }, 2500);


  }

  updateLanSessionPresence(members) {


    if (!Array.isArray(members)) return;


    const onlineMembers = members.filter(m => m.online);


    if (this.lanSessionPresenceText) {


      this.lanSessionPresenceText.textContent = `在线成员 ${onlineMembers.length} 人`;


    }


  }

  showLanSessionAlert(msg) {


    if (this.lanSessionAlertBanner) {


      this.lanSessionAlertBanner.style.display = 'flex';


      if (this.lanSessionAlertText) {


        this.lanSessionAlertText.textContent = msg;


      }


    }


  }

  async exitLanSession() {


    this.stopLanHeartbeat();


    if (this.lanCurrentSession && this.lanCurrentSession.role === 'client') {


      try {


        const targetHost = this.lanCurrentSession.targetHost;


        const targetUrl = targetHost.startsWith('http') ? targetHost : `http://${targetHost}`;


        const leaveUrl = `${targetUrl.replace(/\/+$/, '')}/api/lan/room/leave`;


        await fetch(leaveUrl, {


          method: 'POST',


          headers: { 'Content-Type': 'application/json' },


          body: JSON.stringify({


            roomId: this.lanCurrentSession.roomId,


            memberId: this.lanCurrentSession.memberId,


            sessionId: this.lanCurrentSession.sessionId


          })


        }).catch(() => {});


      } catch (e) {}


    }





    this.lanCurrentSession = null;
    try {
      localStorage.removeItem('lan_target_host');
      localStorage.removeItem('lan_room_id');
      localStorage.removeItem('lan_member_id');
      localStorage.removeItem('lan_session_id');
    } catch (e) {}


    if (this.lanSessionContainer) this.lanSessionContainer.style.display = 'none';


    if (this.lanLobbyContainer) this.lanLobbyContainer.style.display = 'flex';


    if (this.lanSessionAlertBanner) this.lanSessionAlertBanner.style.display = 'none';





    this.updateLanModeBadge('personal');


    this.fetchHostRoomStatus();
    this.fetchDiscoveredRooms();
    this.fetchLanNetworkInfo();
    this.renderRecentSessions();
    this.startLanDiscovery();


  }

  renderReadOnlySnapshot(snapshot) {


    if (!this.lanSnapshotNodes || !this.lanSnapshotSvg) return;


    this.lanSnapshotNodes.innerHTML = '';


    this.lanSnapshotSvg.innerHTML = '';





    if (!snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {


      this.lanSnapshotNodes.innerHTML = `


        <div style="position: absolute; top: 100px; left: 100px; color: var(--text-muted); font-size: 13px;">


          <span>当前画布为空白画布，暂无图元节点</span>


        </div>


      `;


      return;


    }





    const nodes = snapshot.nodes;


    const nodeMap = new Map();





    nodes.forEach(node => {


      nodeMap.set(node.id, node);


      const nodeEl = document.createElement('div');


      nodeEl.className = 'lan-node-card';


      const x = node.position?.x ?? node.x ?? 80;


      const y = node.position?.y ?? node.y ?? 80;


      nodeEl.style.left = `${Math.max(20, x)}px`;


      nodeEl.style.top = `${Math.max(20, y)}px`;





      const type = node.type || node.kind || 'node';


      const title = node.title || node.data?.title || node.label || '节点';


      const prompt = node.data?.prompt || node.prompt || '';


      const previewUrl = node.data?.url || node.data?.outputUrl || node.url || '';
      const mediaHost = String(this.lanCurrentSession?.targetHost || '').trim().replace(/\/+$/, '');
      const mediaSrc = mediaHost && /^\/(?:api|assets|output)\//i.test(String(previewUrl))
        ? `${mediaHost.startsWith('http') ? mediaHost : `http://${mediaHost}`}${previewUrl}`
        : previewUrl;


      const isVideo = previewUrl.endsWith('.mp4') || previewUrl.endsWith('.webm') || type.includes('video');





      nodeEl.innerHTML = `


        <div class="lan-node-card-header">


          <span>${this.escapeHtml(title)}</span>


          <span class="lan-node-type-tag">${this.escapeHtml(type)}</span>


        </div>


        <div class="lan-node-card-body">


          ${previewUrl ? (


            isVideo ? `<video class="lan-node-media-preview" src="${this.escapeHtml(mediaSrc)}" controls playsinline></video>` :


            `<img class="lan-node-media-preview" src="${this.escapeHtml(mediaSrc)}" alt="Preview" loading="lazy" />`


          ) : ''}


          ${prompt ? `<div style="overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.4;">${this.escapeHtml(prompt)}</div>` : ''}


          <div style="margin-top: 6px; font-size: 11px; color: var(--text-muted);">


            <span>状态：只读锁定</span>


          </div>


        </div>


      `;


      this.lanSnapshotNodes.appendChild(nodeEl);


    });





    const connections = Array.isArray(snapshot.connections) ? snapshot.connections : [];


    let svgContent = '';


    connections.forEach(conn => {


      const fromNode = nodeMap.get(conn.from || conn.source);


      const toNode = nodeMap.get(conn.to || conn.target);


      if (fromNode && toNode) {


        const x1 = (fromNode.position?.x ?? fromNode.x ?? 80) + 250;


        const y1 = (fromNode.position?.y ?? fromNode.y ?? 80) + 40;


        const x2 = (toNode.position?.x ?? toNode.x ?? 80);


        const y2 = (toNode.position?.y ?? toNode.y ?? 80) + 40;


        const dx = Math.max(50, Math.abs(x2 - x1) * 0.5);


        const pathData = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;


        svgContent += `<path d="${pathData}" fill="none" stroke="rgba(148, 163, 184, 0.6)" stroke-width="2" stroke-dasharray="4 4" />`;


      }


    });


    this.lanSnapshotSvg.innerHTML = svgContent;


  }

}
