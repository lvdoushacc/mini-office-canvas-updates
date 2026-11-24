import { SettingsManager } from "../settings/settings-manager.js";
import { CollabManager } from "../collaboration/collab-manager.js";
import { ProjectManager } from "./managers/project-manager.js";
import { store } from '../common/store.js';
import { apiClient } from '../common/api-client.js';
import { HomeAssetLibrary } from './home-assets.js?v=2026.09.17.wf_export_fix_v1';

// ================= Fetch Interceptor for Auth =================
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  let [resource, config] = args;
  
  config = config || {};
  config.headers = config.headers || {};
  
  let isApiCall = false;
  let url = '';
  if (typeof resource === 'string') {
    url = resource;
  } else if (resource instanceof Request) {
    url = resource.url;
  }
  
  if (url.includes('/api/')) {
    isApiCall = true;
    const token = localStorage.getItem('xxdp_auth_token');
    if (token) {
      if (resource instanceof Request) {
        resource.headers.set('Authorization', `Bearer ${token}`);
      } else {
        if (config.headers instanceof Headers) {
          config.headers.set('Authorization', `Bearer ${token}`);
        } else {
          config.headers['Authorization'] = `Bearer ${token}`;
        }
      }
    }
  }

  const response = await originalFetch(resource, config);

  if (isApiCall && response.status === 401 && !url.includes('/api/auth/')) {
    localStorage.removeItem('xxdp_auth_token');
    // 本机主机：尝试免登恢复，不踢登录页
    const isFixedLanOrigin = window.location.port === '8910' || (
      window.location.hostname && !['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
    );
    // 8910 是固定的局域网协作入口，协作身份由 roomId/memberId/sessionId 管理，
    // 不使用账号登录。接口未带房间凭据时只返回错误给调用方，不能把协作者踢到账号登录页。
    if (isFixedLanOrigin) return response;
    if (!isFixedLanOrigin && store.hasConfiguredWorkspace() && !window.__xxdpLocalHostRecovering) {
      window.__xxdpLocalHostRecovering = true;
      try {
        const hr = await originalFetch('/api/auth/local-host', { method: 'POST' });
        if (hr.ok) {
          const hd = await hr.json();
          if (hd?.token) {
            localStorage.setItem('xxdp_auth_token', hd.token);
            window.location.reload();
            return response;
          }
        }
      } catch (_) {}

    }
    window.location.replace('/static/auth.html?mode=login');
  }

  return response;
};

class App {

  constructor() {


    this.welcomeView = document.getElementById('welcomeView');


    this.homeView = document.getElementById('homeView');


    this.workspaceView = document.getElementById('workspaceView');





    this.welcomeForm = document.getElementById('welcomeForm');


    this.workspaceInput = document.getElementById('workspaceInput');


    this.workspaceDisplay = document.getElementById('workspaceDisplay');


    this.currentProjectTitle = document.getElementById('currentProjectTitle');





    this.sidebarNav = document.getElementById('sidebarNav');


    this.btnFloatingNewProject = document.getElementById('btnFloatingNewProject');


    this.btnNewProject = document.getElementById('btnNewProject') || this.btnFloatingNewProject;


    this.centralCreateNode = document.getElementById('centralCreateNode');


    this.homeBreadcrumb = document.getElementById('homeBreadcrumb');


    this.homeSectionTitle = document.getElementById('homeSectionTitle');


    this.homeFilterPills = document.getElementById('homeFilterPills');


    this.breadcrumbWorkspaceDisplay = document.getElementById('breadcrumbWorkspaceDisplay');


    this.navAppearance = document.getElementById('navAppearance');


    this.themeToggleCheckbox = document.getElementById('themeToggleCheckbox');


    this.themeToggleBtn = document.getElementById('themeToggleBtn');
    this.globalThemeToggleBtn = document.getElementById('globalThemeToggleBtn');

    this.navSettings = document.getElementById('navSettings');


    this.commandInput = document.querySelector('.command-input');


    this.homeSearchWrapper = document.getElementById('homeSearchWrapper');


    this.gooeyIconBubble = null; // legacy gooey bubble removed


    this.portals = document.querySelectorAll('.canvas-portal');



    // 工作区交互元素


    this.btnBackToHome = document.getElementById('btnBackToHome');


    this.brandBackHome = document.getElementById('brandBackHome');





    // 新建画布模态弹窗元素


    this.newCanvasModal = document.getElementById('newCanvasModal');


    this.newCanvasForm = document.getElementById('newCanvasForm');


    this.newCanvasTitleInput = document.getElementById('newCanvasTitleInput');


    this.newCanvasErrorHint = document.getElementById('newCanvasErrorHint');


    this.btnCloseNewCanvas = document.getElementById('btnCloseNewCanvas');


    this.btnCancelNewCanvas = document.getElementById('btnCancelNewCanvas');


    this.btnSubmitNewCanvas = document.getElementById('btnSubmitNewCanvas');


    this.dynamicPortalsContainer = document.getElementById('dynamicPortalsContainer');





    // 修改项目名称模态弹窗元素


    this.renameProjectModal = document.getElementById('renameProjectModal');


    this.renameProjectForm = document.getElementById('renameProjectForm');


    this.renameProjectTitleInput = document.getElementById('renameProjectTitleInput');


    this.renameProjectErrorHint = document.getElementById('renameProjectErrorHint');


    this.btnCloseRenameProject = document.getElementById('btnCloseRenameProject');


    this.btnCancelRenameProject = document.getElementById('btnCancelRenameProject');


    this.btnSubmitRenameProject = document.getElementById('btnSubmitRenameProject');


    this.renamingProject = null;





    // 设置中心与主题模态元素


    this.settingsModal = document.getElementById('settingsModal');
    this.apiSettingsSyncChannel = null;
    try {
      this.apiSettingsSyncChannel = new BroadcastChannel('xxdp-api-settings');
      this.apiSettingsSyncChannel.addEventListener('message', (event) => {
        const data = event?.data;
        if (data?.type !== 'api-settings-updated') return;
        if (data.mode && data.mode !== 'personal') return;
        if (data.canvasId && data.canvasId !== 'default') return;
        if (this.currentSettingsTab === 'api' && !this.isSettingsDirtyState && !this.isSavingSettings) {
          this.loadApiSettings().catch(() => {});
        }
      });
    } catch (_) {}


    this.storageSettingsSection = document.getElementById('storageSettingsSection');


    this.storageListContainer = document.getElementById('storageListContainer');


    this.btnSaveStorage = document.getElementById('btnSaveStorage');


    this.storageStatusMsg = document.getElementById('storageStatusMsg');


    this.storageDirtyNotice = document.getElementById('storageDirtyNotice');


    this.workspaceBtnSettings = document.getElementById('workspaceBtnSettings');


    this.btnCloseSettings = document.getElementById('btnCloseSettings');


    this.themeCardDark = document.getElementById('themeCardDark');


    this.themeCardLight = document.getElementById('themeCardLight');


    this.settingsDefaultChatModel = document.getElementById('settingsDefaultChatModel');


    this.settingsDefaultImageModel = document.getElementById('settingsDefaultImageModel');


    this.settingsDefaultVideoModel = document.getElementById('settingsDefaultVideoModel');


    this.settingsProviderSelect = document.getElementById('settingsProviderSelect');


    this.providerCardName = document.getElementById('providerCardName');


    this.providerCardProtocol = document.getElementById('providerCardProtocol');


    this.providerCardKeyStatus = document.getElementById('providerCardKeyStatus');


    this.providerBaseUrlInput = document.getElementById('providerBaseUrlInput');


    this.providerBaseUrlHint = document.getElementById('providerBaseUrlHint');


    this.providerProtocolInput = document.getElementById('providerProtocolInput');


    this.providerBaseUrlGroup = document.getElementById('providerBaseUrlGroup');


    this.providerProtocolGroup = document.getElementById('providerProtocolGroup');


    this.providerApiKeyGroup = document.getElementById('providerApiKeyGroup');


    this.providerRemoteActions = document.getElementById('providerRemoteActions');


    this.providerCliPanel = document.getElementById('providerCliPanel');


    this.providerCliPanelTitle = document.getElementById('providerCliPanelTitle');


    this.providerCliPanelText = document.getElementById('providerCliPanelText');


    this.providerCliStatusBadge = document.getElementById('providerCliStatusBadge');


    this.providerCliStatusText = document.getElementById('providerCliStatusText');


    this.providerCliPathVal = document.getElementById('providerCliPathVal');


    this.providerCliVersionVal = document.getElementById('providerCliVersionVal');


    this.providerCliCmdVal = document.getElementById('providerCliCmdVal');


    this.btnTestCliEnv = document.getElementById('btnTestCliEnv');

    this.providerCliPromptInput = document.getElementById('providerCliPromptInput');
    this.btnTestCliPrompt = document.getElementById('btnTestCliPrompt');
    this.providerCliPromptResult = document.getElementById('providerCliPromptResult');


    this.providerApiKeyInput = document.getElementById('providerApiKeyInput');


    this.btnToggleApiKeyVisibility = document.getElementById('btnToggleApiKeyVisibility');


    this.providerModelTags = document.getElementById('providerModelTags');


    this.btnTestConnection = document.getElementById('btnTestConnection');

    // 快捷预设点击自动填入 (方案 1: 辅助预设)
    const presetChipsContainer = document.getElementById('providerPresetChips');
    if (presetChipsContainer) {
      presetChipsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.xxdp-preset-chip');
        if (!btn) return;
        const presetKey = btn.dataset.preset;
        const presetMap = {
          openai: { name: 'OpenAI 官方', protocol: 'openai', url: 'https://api.openai.com/v1' },
          deepseek: { name: 'DeepSeek 深度求索', protocol: 'openai', url: 'https://api.deepseek.com/v1' },
          claude: { name: 'Anthropic Claude', protocol: 'openai', url: 'https://api.anthropic.com/v1' },
          siliconflow: { name: 'SiliconFlow 硅基流动', protocol: 'openai', url: 'https://api.siliconflow.cn/v1' },
          ollama: { name: 'Ollama 本地', protocol: 'openai', url: 'http://localhost:11434/v1' },
          zhipu: { name: '智谱 GLM', protocol: 'openai', url: 'https://open.bigmodel.cn/api/paas/v4/' }
        };
        const p = presetMap[presetKey];
        if (!p) return;
        if (this.providerNameInput) {
          this.providerNameInput.value = p.name;
          this.providerNameInput.dispatchEvent(new Event('input'));
        }
        if (this.providerProtocolInput) {
          this.providerProtocolInput.value = p.protocol;
          this.providerProtocolInput.dispatchEvent(new Event('change'));
        }
        if (this.providerBaseUrlInput) {
          this.providerBaseUrlInput.value = p.url;
          this.providerBaseUrlInput.dispatchEvent(new Event('input'));
        }
      });
    }



    this.settingsTestResult = document.getElementById('settingsTestResult');


    this.settingsDirtyNotice = document.getElementById('settingsDirtyNotice');


    this.settingsStatusMsg = document.getElementById('settingsStatusMsg');


    this.btnCancelSettings = document.getElementById('btnCancelSettings');


    this.btnSaveSettings = document.getElementById('btnSaveSettings');





    // 全局 API 设置工作台元素


    this.apiTabContent = document.getElementById('apiTabContent');


    this.settingsProviderList = document.getElementById('settingsProviderList');


    this.btnAddProvider = document.getElementById('btnAddProvider');
    this.btnExportApiConfig = document.getElementById('btnExportApiConfig');
    this.btnImportApiConfig = document.getElementById('btnImportApiConfig');
    this.apiConfigFileInput = document.getElementById('apiConfigFileInput');

    this.btnSetDefaultProvider = document.getElementById('btnSetDefaultProvider');


    this.providerEnabledInput = document.getElementById('providerEnabledInput');


    this.btnDeleteProvider = document.getElementById('btnDeleteProvider');


    this.providerNameInput = document.getElementById('providerNameInput');

    this.providerNameGroup = document.getElementById('providerNameGroup');


    this.btnFetchModels = document.getElementById('btnFetchModels');


    this.providerImageModelTags = document.getElementById('providerImageModelTags');


    this.providerVideoModelTags = document.getElementById('providerVideoModelTags');


    this.providerChatModelTags = document.getElementById('providerChatModelTags');

    this.manualModelType = document.getElementById('manualModelType');
    this.manualModelInput = document.getElementById('manualModelInput');
    this.btnAddManualModel = document.getElementById('btnAddManualModel');

    // 方案 B: 模型挑选模态弹窗与控件
    this.modelPickerModal = document.getElementById('modelPickerModal');
    this.modelPickerSearchInput = document.getElementById('modelPickerSearchInput');
    this.btnModelPickerSearchClear = document.getElementById('btnModelPickerSearchClear');
    this.btnModelPickerSelectAll = document.getElementById('btnModelPickerSelectAll');
    this.btnModelPickerDeselectAll = document.getElementById('btnModelPickerDeselectAll');
    this.btnModelPickerCancel = document.getElementById('btnModelPickerCancel');
    this.btnModelPickerConfirm = document.getElementById('btnModelPickerConfirm');
    this.btnCloseModelPicker = document.getElementById('btnCloseModelPicker');





    this.apiSettingsData = null;


    this.workingProviders = [];


    this.workingDefaultProvider = '';


    this.selectedProviderId = '';


    this.providerEdits = {};


    this.isSettingsDirtyState = false;


    this.initialSettingsSnapshot = null;





    this.workspaceName = '';


    this.currentProject = '';


    this.currentProjectId = '';


    this.currentTheme = store.getTheme();





    // 小小办公原生内置画布引擎


    this.canvasApp = null;

    // 实例化专门子模块，通过 BaseManager 自动实现双向代理与契约兼容
    this.settingsManager = new SettingsManager(this);
    this.collabManager = new CollabManager(this);
    this.projectManager = new ProjectManager(this);






    // 局域网协作 V1 元素与状态


    this.homePortalsScrollArea = document.getElementById('homePortalsScrollArea');


    this.homeLanScrollArea = document.getElementById('homeLanScrollArea');
    this.homeSettingsScrollArea = document.getElementById('homeSettingsScrollArea');


    this.lanTopStatusBadge = document.getElementById('lanTopStatusBadge');


    this.lanTopStatusText = document.getElementById('lanTopStatusText');


    this.lanView = document.getElementById('lanView');


    this.btnLanBackHome = document.getElementById('btnLanBackHome');


    this.lanBrandBackHome = document.getElementById('lanBrandBackHome');


    this.lanLobbyContainer = document.getElementById('lanLobbyContainer');


    this.lanSessionContainer = document.getElementById('lanSessionContainer');


    this.lanHostProjectSelect = document.getElementById('lanHostProjectSelect');


    this.lanHostCanvasSelect = document.getElementById('lanHostCanvasSelect');


    this.lanHostNameInput = document.getElementById('lanHostNameInput');


    this.lanHostPasscodeInput = document.getElementById('lanHostPasscodeInput');
    this.lanPinModeNone = document.getElementById('lanPinModeNone');
    this.lanPinModeCustom = document.getElementById('lanPinModeCustom');
    this.lanPinInputGroup = document.getElementById('lanPinInputGroup');
    this.btnLanRegenPin = document.getElementById('btnLanRegenPin');
    this.btnLanCreateRoom = document.getElementById('btnLanCreateRoom');


    this.lanHostCreateError = document.getElementById('lanHostCreateError');


    this.lanHostActiveCard = document.getElementById('lanHostActiveCard');


    this.lanHostCreateFormWrap = document.getElementById('lanHostCreateFormWrap');


    this.lanHostActiveRoomId = document.getElementById('lanHostActiveRoomId');


    this.lanHostActiveProjName = document.getElementById('lanHostActiveProjName');


    this.lanHostActiveAddress = document.getElementById('lanHostActiveAddress');


    this.lanHostActivePasscode = document.getElementById('lanHostActivePasscode');


    this.lanHostMemberCount = document.getElementById('lanHostMemberCount');


    this.lanHostMembersChips = document.getElementById('lanHostMembersChips');


    this.lanHostNewMemberName = document.getElementById('lanHostNewMemberName');


    this.btnLanHostAddMember = document.getElementById('btnLanHostAddMember');


    this.lanHostInvitesList = document.getElementById('lanHostInvitesList');


    this.btnLanHostEnterSnapshot = document.getElementById('btnLanHostEnterSnapshot');


    this.btnLanHostCloseRoom = document.getElementById('btnLanHostCloseRoom');


    this.btnLanRefreshRooms = document.getElementById('btnLanRefreshRooms');


    this.lanDiscoveredRoomsList = document.getElementById('lanDiscoveredRoomsList');


    this.lanManualIpInput = document.getElementById('lanManualIpInput');


    this.btnLanManualProbe = document.getElementById('btnLanManualProbe');


    this.lanManualError = document.getElementById('lanManualError');


    this.lanJoinModal = document.getElementById('lanJoinModal');


    this.btnCloseLanJoin = document.getElementById('btnCloseLanJoin');


    this.btnCancelLanJoin = document.getElementById('btnCancelLanJoin');


    this.lanJoinForm = document.getElementById('lanJoinForm');


    this.lanJoinTargetProject = document.getElementById('lanJoinTargetProject');


    this.lanJoinTargetHost = document.getElementById('lanJoinTargetHost');


    this.lanJoinTargetAddress = document.getElementById('lanJoinTargetAddress');


    this.lanJoinPasscodeInput = document.getElementById('lanJoinPasscodeInput');


    this.lanJoinNameInput = document.getElementById('lanJoinNameInput');


    this.lanJoinErrorHint = document.getElementById('lanJoinErrorHint');


    this.btnSubmitLanJoin = document.getElementById('btnSubmitLanJoin');


    this.lanSessionRoleBadge = document.getElementById('lanSessionRoleBadge');


    this.lanSessionProjectTitle = document.getElementById('lanSessionProjectTitle');


    this.lanSessionHostInfo = document.getElementById('lanSessionHostInfo');


    this.lanSessionPresenceText = document.getElementById('lanSessionPresenceText');


    this.btnLanSessionAction = document.getElementById('btnLanSessionAction');


    this.lanSessionAlertBanner = document.getElementById('lanSessionAlertBanner');


    this.lanSessionAlertText = document.getElementById('lanSessionAlertText');


    this.btnLanAlertReturnLobby = document.getElementById('btnLanAlertReturnLobby');


    this.lanSnapshotNodes = document.getElementById('lanSnapshotNodes');


    this.lanSnapshotSvg = document.getElementById('lanSnapshotSvg');





    this.lanCurrentSession = null;


    this.lanDiscoveryTimer = null;


    this.lanHeartbeatTimer = null;


    this.lanTargetPendingJoin = null;


    this.lanHeartbeatFailCount = 0;


    this.currentHomeTab = 'my';

    this.authHeartbeatTimer = null;

    let cachedHostRoom = null;
    try {
      const savedHostRoom = localStorage.getItem('xxdp_lan_host_room');
      if (savedHostRoom) cachedHostRoom = JSON.parse(savedHostRoom);
    } catch(e) {}
    this.lanHostCurrentRoom = cachedHostRoom;

    // 全新局域网协同体系状态与元素绑定
    this.lanHubState = {
      ready: false,
      workspaceId: 'lan_workspace',
      canvasId: 'lan_main',
      title: '协作画布',
      peerCount: 0,
      seatCount: 1,
      role: 'WRITABLE',
      seatName: '活力红',
      localColor: '#ef4444',
      onlineCount: 1,
      nodesCount: 0,
      canvases: [],
      onlinePeers: []
    };
    this.lanHubTimer = null;
    this.lanHubMeshBadge = document.getElementById('lanHubMeshBadge');
    this.lanHubMeshText = document.getElementById('lanHubMeshText');
    this.lanHubSeatBadge = document.getElementById('lanHubSeatBadge');
    this.lanHubSeatDot = document.getElementById('lanHubSeatDot');
    this.lanHubSeatText = document.getElementById('lanHubSeatText');
    this.lanHubWsId = document.getElementById('lanHubWsId');
    this.lanHubCanvasTitle = document.getElementById('lanHubCanvasTitle');
    this.lanHubNodesCount = document.getElementById('lanHubNodesCount');
    this.lanHubOnlineCount = document.getElementById('lanHubOnlineCount');
    this.lanHubPeersCount = document.getElementById('lanHubPeersCount');
    this.lanHubSyncStatus = document.getElementById('lanHubSyncStatus');
    this.lanHubPeerSummary = document.getElementById('lanHubPeerSummary');
    this.lanHubPeersGrid = document.getElementById('lanHubPeersGrid');
    this.btnLanHubEnterCanvas = document.getElementById('btnLanHubEnterCanvas');
    this.btnLanHubPairingCode = document.getElementById('btnLanHubPairingCode');
    this.btnLanHubNewCanvas = document.getElementById('btnLanHubNewCanvas');
    this.btnLanHubRefresh = document.getElementById('btnLanHubRefresh');
    this.lanPairingModal = document.getElementById('lanPairingModal');
    this.btnCloseLanPairingModal = document.getElementById('btnCloseLanPairingModal');
    this.lanHubCurrentPairingCode = document.getElementById('lanHubCurrentPairingCode');
    this.btnLanHubCopyPairingCode = document.getElementById('btnLanHubCopyPairingCode');
    this.lanHubImportPairingCode = document.getElementById('lanHubImportPairingCode');
    this.btnLanHubConfirmImportCode = document.getElementById('btnLanHubConfirmImportCode');
    this.lanHubImportFeedback = document.getElementById('lanHubImportFeedback');

    this.initCustomDropdowns();
    this.init();
  }






  // ================= Uiverse 自定义下拉框逻辑 (支持深浅色无缝切换) =================
  bindUiverseSelect(selectEl) {
    if (!selectEl || selectEl.dataset.uiverseBound === 'true' || selectEl.style.display === 'none' || selectEl.hidden) return;
    selectEl.dataset.uiverseBound = 'true';
    selectEl.classList.add('uiverse-hidden-native-select');

    const wrapper = document.createElement('div');
    wrapper.className = 'uiverse-select-wrapper';
    if (selectEl.id) wrapper.dataset.targetId = selectEl.id;

    const selectedBtn = document.createElement('div');
    selectedBtn.className = 'uiverse-selected';
    selectedBtn.innerHTML = `
      <span class="uiverse-selected-text"></span>
      <svg class="uiverse-arrow" viewBox="0 0 24 24">
        <path d="M7 10l5 5 5-5z"/>
      </svg>
    `;

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'uiverse-options';

    wrapper.appendChild(selectedBtn);
    wrapper.appendChild(optionsContainer);
    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

    const syncOptions = () => {
      optionsContainer.innerHTML = '';
      const options = Array.from(selectEl.options);
      const selectedOpt = selectEl.options[selectEl.selectedIndex] || options[0];
      const textEl = selectedBtn.querySelector('.uiverse-selected-text');
      if (textEl) textEl.textContent = selectedOpt ? selectedOpt.textContent : '';

      options.forEach(opt => {
        const optDiv = document.createElement('div');
        optDiv.className = 'uiverse-option' + (opt.selected ? ' selected' : '');
        optDiv.textContent = opt.textContent;
        optDiv.dataset.value = opt.value;
        optDiv.addEventListener('click', (e) => {
          e.stopPropagation();
          selectEl.value = opt.value;
          if (textEl) textEl.textContent = opt.textContent;
          optionsContainer.querySelectorAll('.uiverse-option').forEach(el => el.classList.remove('selected'));
          optDiv.classList.add('selected');
          wrapper.classList.remove('open');
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        });
        optionsContainer.appendChild(optDiv);
      });
    };

    syncOptions();

    selectedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.uiverse-select-wrapper.open').forEach(w => {
        if (w !== wrapper) w.classList.remove('open');
      });
      wrapper.classList.toggle('open');
    });

    selectEl.addEventListener('change', () => {
      const selectedOpt = selectEl.options[selectEl.selectedIndex];
      const textEl = selectedBtn.querySelector('.uiverse-selected-text');
      if (selectedOpt && textEl) {
        textEl.textContent = selectedOpt.textContent;
        optionsContainer.querySelectorAll('.uiverse-option').forEach(el => {
          el.classList.toggle('selected', el.dataset.value === selectEl.value);
        });
      }
    });

    // 拦截 value 属性的 setter，确保通过 JS 赋值时自定义组件自动同步
    try {
      const originalValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      const originalValueGetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').get;
      Object.defineProperty(selectEl, 'value', {
        get() {
          return originalValueGetter.call(this);
        },
        set(val) {
          originalValueSetter.call(this, val);
          const selectedOpt = selectEl.options[selectEl.selectedIndex];
          const textEl = selectedBtn.querySelector('.uiverse-selected-text');
          if (selectedOpt && textEl) {
            textEl.textContent = selectedOpt.textContent;
            optionsContainer.querySelectorAll('.uiverse-option').forEach(el => {
              el.classList.toggle('selected', el.dataset.value === selectEl.value);
            });
          }
        },
        configurable: true
      });
    } catch (e) {}

    // 观察原生 select 的 DOM 变动 (如 options 动态加载更新)
    const observer = new MutationObserver(() => {
      syncOptions();
    });
    observer.observe(selectEl, { childList: true, subtree: true, characterData: true });

    if (!window._uiverseDocClickBound) {
      window._uiverseDocClickBound = true;
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.uiverse-select-wrapper')) {
          document.querySelectorAll('.uiverse-select-wrapper.open').forEach(w => w.classList.remove('open'));
        }
      });
    }

    return wrapper;
  }

  initCustomDropdowns() {
    window.bindUiverseSelect = (sel) => this.bindUiverseSelect(sel);
    [
      this.lanHostProjectSelect,
      this.settingsDefaultChatModel,
      this.settingsDefaultImageModel,
      this.settingsDefaultVideoModel,
      this.providerProtocolInput,
      this.manualModelType || document.getElementById('manualModelType')
    ].forEach(sel => {
      if (sel) this.bindUiverseSelect(sel);
    });
  }

  async init() {
    console.log('[Init] checking host name / auth...');

    // 固定局域网入口是协作工作区，不依赖本机主机名字配置。
    this.isFixedLanEntry = window.location.port === '8910' || (
      window.location.hostname && !['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
    );
    document.body?.classList.toggle('is-fixed-lan-entry', this.isFixedLanEntry);

    // 主机名优先：未设置则进欢迎页设主机名（本机落盘），不挡登录墙
    const initParams = new URLSearchParams(window.location.search);
    if (initParams.get('reset') === '1' || initParams.get('clean') === '1' || window.location.hash === '#reset') {
      store.resetWorkspace();
      try {
        localStorage.removeItem('xxpd_local_host_profile');
        localStorage.removeItem('xxdp_auth_token');
        localStorage.removeItem('xxdp_lan_host_room');
        localStorage.removeItem('xxdp_device_id');
      } catch (_) {}
      if (window.history && window.history.replaceState) {
        const isDesktop = document.documentElement.classList.contains('desktop-shell') ||
          Boolean(window.desktopWindow) ||
          (window.navigator && window.navigator.userAgent && window.navigator.userAgent.indexOf('Electron') !== -1);
        const search = isDesktop ? '?desktop=1' : '';
        window.history.replaceState({}, '', window.location.pathname + search);
      }
    }

    this.currentTheme = store.getTheme();
    this.applyTheme(this.currentTheme);

    if (!store.hasConfiguredWorkspace() && !this.isFixedLanEntry) {
      this.bindEvents();
      this.showWelcome();
      return;
    }

    this.workspaceName = store.getWorkspaceName() || (this.isFixedLanEntry ? '协作工作区' : '本机主机');

    try {
      const authStatus = await fetch('/api/auth/status').then(r => r.json()).catch(() => ({}));

      const ensureLocalHost = async () => {
        // Agent 1: 仅本机 127.0.0.1/::1 可签发
        let preferredName = '';
        try {
          const localProfile = JSON.parse(localStorage.getItem('xxpd_local_host_profile') || '{}');
          preferredName = localProfile.displayName || store.getWorkspaceName() || this.workspaceName || '';
        } catch (_) {
          preferredName = store.getWorkspaceName() || this.workspaceName || '';
        }
        const res = await fetch('/api/auth/local-host', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: preferredName })
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        if (!data?.token) return null;
        localStorage.setItem('xxdp_auth_token', data.token);
        this.sessionKind = data.sessionKind || 'local-host';
        return data;
      };

      let token = localStorage.getItem('xxdp_auth_token');
      let meUser = null;

      if (!token) {
        const hostSession = this.isFixedLanEntry ? null : await ensureLocalHost();
        if (hostSession?.user) {
          meUser = hostSession.user;
          token = hostSession.token;
        } else if (this.isFixedLanEntry) {
          // 固定 LAN 入口使用房间会话，不创建或要求账号。
          this.sessionKind = 'lan-session';
          meUser = { id: 'lan-session', username: '协作者', role: 'member', accessMode: 'lan' };
        } else if (authStatus.setupRequired) {
          window.location.replace('/static/auth.html?mode=setup');
          return;
        } else {
          window.location.replace('/static/auth.html?mode=login');
          return;
        }
      } else {
        const meRes = await fetch('/api/auth/me');
        if (meRes.ok) {
          const meData = await meRes.json();
          meUser = meData?.user || null;
        } else {
          localStorage.removeItem('xxdp_auth_token');
          const hostSession = this.isFixedLanEntry ? null : await ensureLocalHost();
          if (hostSession?.user) {
            meUser = hostSession.user;
          } else if (this.isFixedLanEntry) {
            this.sessionKind = 'lan-session';
            meUser = { id: 'lan-session', username: '协作者', role: 'member', accessMode: 'lan' };
          } else {
            window.location.replace('/static/auth.html?mode=login');
            return;
          }
        }
      }

      if (this.sessionKind === 'local-host' || meUser?.accessMode === 'host') {
        try {
          const localProfile = JSON.parse(localStorage.getItem('xxpd_local_host_profile') || '{}');
          const hostName = localProfile.displayName || store.getWorkspaceName() || this.workspaceName || '';
          if (hostName) {
            localProfile.displayName = hostName;
            localStorage.setItem('xxpd_local_host_profile', JSON.stringify(localProfile));
            meUser = {
              ...(meUser || {}),
              displayName: hostName,
              ...(localProfile.avatar ? { avatar: localProfile.avatar } : {})
            };
          }
        } catch (_) {}
      }

      this.currentUsername = meUser?.username || '';
      const configuredHost = store.getHostName?.() || store.getWorkspaceName() || this.workspaceName || '';
      if (this.sessionKind === 'local-host' || this.accessMode === 'host') {
        this.currentDisplayName = (meUser?.displayName && meUser.displayName !== '本机主机')
          ? meUser.displayName
          : (configuredHost || meUser?.displayName || '主机用户');
      } else {
        this.currentDisplayName = meUser?.displayName || this.currentUsername || '';
      }
      this.currentUserAvatar = meUser?.avatar || '';
      // 密码不会进入前端状态。
      this.currentPassword = '';
      this.currentUserId = String(meUser?.id || '');
      this.currentUserRole = meUser?.role || '';
      this.accessMode = meUser?.accessMode || (this.sessionKind === 'local-host' ? 'host' : '');
      // 固定局域网链接是协作入口：即使浏览器残留了本机主账号会话，也不能在这里显示主机管理 UI。
      const accountIsMaster = this.currentUserRole === 'master' || this.currentUserRole === 'admin' || this.accessMode === 'host' || this.sessionKind === 'local-host';
      this.isMasterAccount = !this.isFixedLanEntry && accountIsMaster;
      this.isCollaborationAccount = false;
      const hostLabel = this.currentDisplayName || store.getHostName?.() || store.getWorkspaceName() || this.workspaceName || '主机用户';
      if (this.workspaceDisplay) {
        this.workspaceDisplay.textContent = hostLabel;
      }
      const avatarEl = document.getElementById('currentUserAvatar');
      if (avatarEl) avatarEl.textContent = (hostLabel.trim()[0] || '主').toUpperCase();
      const statusText = document.getElementById('homeTopStatusText');
      if (statusText) {
        statusText.textContent = this.accessMode === 'host' || this.sessionKind === 'local-host' ? '本地' : (this.currentUserRole === 'master' || this.currentUserRole === 'admin' ? '管理员' : '已登录');
      }
    } catch(err) {
      console.warn("Auth check failed:", err);
    }

    this.startAuthHeartbeat();

    console.log('[Init] window.location.search:', window.location.search);


    const urlParams = new URLSearchParams(window.location.search);


    const themeParam = urlParams.get('theme');


    if (themeParam === 'light' || themeParam === 'dark') {


      this.currentTheme = themeParam;


    }





    this.applyTheme(this.currentTheme);


    this.bindEvents();





    if (store.hasConfiguredWorkspace()) {


      this.workspaceName = store.getWorkspaceName();


    } else {


      this.workspaceName = '';


    }





    const initialTab = urlParams.get('tab') || (this.isFixedLanEntry ? 'lan' : null);


    const initialModal = urlParams.get('modal');





    const initialView = urlParams.get('view');
    const initialCanvasId = urlParams.get('id');
    if (initialView === 'workspace' && initialCanvasId) {
      this.showWorkspace(
        urlParams.get('project') || this.workspaceName,
        initialCanvasId,
        urlParams.get('project_id') || '',
        urlParams.get('mode') === 'lan'
      );
    } else {
      this.showHome(this.workspaceName, initialTab);
    }





    if (initialModal === 'new') {


      setTimeout(() => this.openNewProjectDialog(), 100);


    } else if (initialModal === 'settings') {


      setTimeout(() => this.openSettings('api'), 100);


    } else if (initialModal === 'appearance') {


      setTimeout(() => this.openSettings('appearance'), 100);


    }





    // 异步预加载工作空间全局 API 设置 (personal:default)，确保刷新及进入后已就绪
    this.loadApiSettings().catch(() => {});

    // 仅本机主机负责恢复已打开的房间。
    if (!this.isFixedLanEntry) this.fetchHostRoomStatus().catch(() => {});
  }





  bindEvents() {
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        const isLocalHost = this.sessionKind === 'local-host' || this.accessMode === 'host';
        const confirmed = await this.confirm({
          title: isLocalHost ? '退出并重置主机' : '退出登录',
          message: isLocalHost
            ? '确定要退出并清除当前主机用户与配置吗？\n\n退出后将回到初始引导页，您可以重新设置主机名称。'
            : '确定要退出当前账号吗？\n\n退出后需要重新登录才能继续使用。',
          confirmText: isLocalHost ? '退出并重置' : '退出登录',
          cancelText: '取消',
          danger: true
        });
        if (!confirmed) return;
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch (e) {}
        if (isLocalHost) {
          store.resetWorkspace();
          try {
            localStorage.removeItem('xxpd_local_host_profile');
            localStorage.removeItem('xxdp_lan_host_room');
            localStorage.removeItem('xxdp_device_id');
          } catch (_) {}
        }
        localStorage.removeItem('xxdp_auth_token');
        this.stopAuthHeartbeat();
        window.location.replace('/');
      });
    }

    // 同步主页、画布 iframe 与其他窗口的主题状态。
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data && (data.type === 'theme_changed' || data.type === 'studio-theme' || data.type === 'studio-theme-change')) {
        const theme = data.theme;
        if ((theme === 'dark' || theme === 'light') && this.currentTheme !== theme) {
          this.applyTheme(theme, false);
        }
      }
    });

    window.addEventListener('storage', (event) => {
      if (event.key === 'xxdp_theme' || event.key === 'studio_theme' || event.key === 'canvas_theme') {
        const next = event.newValue === 'light' ? 'light' : 'dark';
        if (this.currentTheme !== next) this.applyTheme(next, false);
      }
    });

    const canvasFrame = document.getElementById('xxdpCanvasFrame');
    canvasFrame?.addEventListener('load', () => this.syncFrameTheme());

    // 1. 首次启动页提示


    if (this.welcomeForm) {


      this.welcomeForm.addEventListener('submit', (e) => {


        e.preventDefault();


        const name = this.workspaceInput.value.trim();


        if (!name) {


          this.workspaceInput.focus();


          return;


        }





        const success = store.setWorkspaceName(name);
        if (success) {
          this.workspaceName = name;
          try {
            const profile = JSON.parse(localStorage.getItem('xxpd_local_host_profile') || '{}');
            profile.displayName = name;
            localStorage.setItem('xxpd_local_host_profile', JSON.stringify(profile));
          } catch (_) {}
          // 设完主机名后重新走 init：有会话则进首页；需建主账号/登录则交给 Agent 1 页
          window.location.replace('/');
        }
      });

      // 预设快捷标签点击填入
      const presetChips = document.querySelectorAll('#welcomePresetChips .welcome-chip');
      presetChips.forEach((chip) => {
        chip.addEventListener('click', () => {
          const val = chip.getAttribute('data-preset');
          if (this.workspaceInput && val) {
            this.workspaceInput.value = val;
            this.workspaceInput.focus();
            if (this.welcomeInputClearBtn) {
              this.welcomeInputClearBtn.style.display = 'flex';
            }
          }
        });
      });

      // 输入框快捷清空按钮
      this.welcomeInputClearBtn = document.getElementById('welcomeInputClearBtn');
      if (this.workspaceInput && this.welcomeInputClearBtn) {
        this.workspaceInput.addEventListener('input', () => {
          this.welcomeInputClearBtn.style.display = this.workspaceInput.value ? 'flex' : 'none';
        });
        this.welcomeInputClearBtn.addEventListener('click', () => {
          this.workspaceInput.value = '';
          this.welcomeInputClearBtn.style.display = 'none';
          this.workspaceInput.focus();
        });
      }

      // 首次启动页主题切换
      const welcomeThemeBtn = document.getElementById('welcomeThemeToggleBtn');
      if (welcomeThemeBtn) {
        welcomeThemeBtn.addEventListener('click', () => {
          this.toggleThemeWithAnimation();
        });
      }
    }





    // 2. 首页左侧栏导航点击


    if (this.sidebarNav) {


      this.sidebarNav.addEventListener('click', (e) => {


        const item = e.target.closest('.sidebar-nav-item');


        if (!item) return;





        let navType = item.dataset.nav;


        if (navType === 'recent') navType = 'my';


        if (['my', 'assets', 'favorites', 'trash', 'lan', 'users'].includes(navType)) {
          this.navSettings?.classList.remove('active');


          this.sidebarNav.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));


          item.classList.add('active');


          this.currentHomeTab = navType;


          this.showHome(this.workspaceName, navType);


          return;


        }





        this.sidebarNav.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));


        item.classList.add('active');


      });


    }





    // 3. 点击项目 Portal 进入对应纯净 smart-canvas.html 工作区


    if (this.portals) {


      this.portals.forEach(portal => {


        portal.addEventListener('click', (e) => {


          const targetEl = e.currentTarget || e.target.closest('.canvas-portal') || portal;


          const projectName = targetEl.dataset.project || targetEl.querySelector('.portal-title')?.textContent?.trim() || 'AI 秋季品宣全流';
          const canvasId = targetEl.dataset.canvasId || '';
          const projectId = targetEl.dataset.projectId || '';


          this.showWorkspace(projectName, canvasId, projectId);


        });


      });


    }





    // 4. 点击新建项目（中央节点或左侧新建按钮，弹出原生命名窗口）


    if (this.centralCreateNode) {


      this.centralCreateNode.addEventListener('click', () => {


        this.openNewProjectDialog();


      });


    }





    if (this.btnFloatingNewProject) {


      this.btnFloatingNewProject.addEventListener('click', () => {


        this.openNewProjectDialog();


      });


    }





    if (this.btnNewProject) {


      this.btnNewProject.addEventListener('click', () => {


        this.openNewProjectDialog();


      });


    }





    // 4.1 首页顶部分类筛选 Pill 切换事件


    if (this.homeFilterPills) {


      this.homeFilterPills.addEventListener('click', (e) => {


        const pill = e.target.closest('.filter-pill');


        if (!pill) return;


        let filterType = pill.dataset.filter;


        if (filterType === 'recent') filterType = 'my';


        if (filterType === 'lan') {


          this.showLan();


          return;


        }


        if (['my', 'favorites', 'trash'].includes(filterType)) {


          this.currentHomeTab = filterType;


          this.showHome(this.workspaceName, filterType);


        }


      });


    }





    // 4.2 ⌘K / Ctrl+K 搜索聚焦快捷键


    window.addEventListener('keydown', (e) => {


      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {


        if (this.homeView && this.homeView.classList.contains('active')) {


          e.preventDefault();


          if (this.homeSearchWrapper) {


            this.homeSearchWrapper.classList.add('expanded');


          }


          if (this.commandInput) {


            this.commandInput.focus();


            this.commandInput.select();


          }


        }


      }


    });





    // 新建项目模态弹窗事件


    if (this.btnCloseNewCanvas) {


      this.btnCloseNewCanvas.addEventListener('click', () => {


        this.closeNewProjectDialog();


      });


    }





    if (this.btnCancelNewCanvas) {


      this.btnCancelNewCanvas.addEventListener('click', () => {


        this.closeNewProjectDialog();


      });


    }





    if (this.newCanvasModal) {


      this.newCanvasModal.addEventListener('click', (e) => {


        if (e.target === this.newCanvasModal) {


          this.closeNewProjectDialog();


        }


      });


    }





    if (this.newCanvasForm) {


      this.newCanvasForm.addEventListener('submit', (e) => {


        this.handleCreateProjectSubmit(e);


      });


    }





    // 修改项目名称模态弹窗事件绑定


    if (this.btnCloseRenameProject) {


      this.btnCloseRenameProject.addEventListener('click', () => {


        this.closeRenameProjectDialog();


      });


    }





    if (this.btnCancelRenameProject) {


      this.btnCancelRenameProject.addEventListener('click', () => {


        this.closeRenameProjectDialog();


      });


    }





    if (this.renameProjectModal) {


      this.renameProjectModal.addEventListener('click', (e) => {


        if (e.target === this.renameProjectModal) {


          this.closeRenameProjectDialog();


        }


      });


    }





    if (this.renameProjectForm) {


      this.renameProjectForm.addEventListener('submit', (e) => {


        this.handleRenameProjectSubmit(e);


      });


    }





    // 全局点击空白处关闭所有卡片三点下拉菜单


    document.addEventListener('click', (e) => {


      if (!e.target.closest('.portal-menu-wrapper')) {


        document.querySelectorAll('.portal-menu-wrapper.open').forEach(w => w.classList.remove('open'));


      }


    });





    // 5. 工作区顶部返回首页入口


    const returnButtons = [this.btnBackToHome, this.brandBackHome];


    returnButtons.forEach(btn => {


      if (btn) {


        btn.addEventListener('click', () => {


          this.showHome(this.workspaceName);


        });


      }


    });






    // 7. 首页搜索过滤


    if (this.commandInput) {


      this.commandInput.addEventListener('input', () => {


        this.applyCurrentSearch();


      });





      this.commandInput.addEventListener('focus', () => {


        if (this.homeSearchWrapper) {


          this.homeSearchWrapper.classList.add('expanded');


        }


      });





      this.commandInput.addEventListener('blur', () => {


        if (!this.commandInput.value.trim() && this.homeSearchWrapper) {


          this.homeSearchWrapper.classList.remove('expanded');


        }


      });


    }





    if (this.gooeyIconBubble && this.commandInput) {


      this.gooeyIconBubble.addEventListener('click', () => {


        if (this.homeSearchWrapper) {


          this.homeSearchWrapper.classList.add('expanded');


        }


        this.commandInput.focus();


      });


    }





    // 7. 打开设置中心模态对话框


    if (this.navAppearance) {


      this.navAppearance.addEventListener('click', () => {


        this.openSettings('appearance');


      });


    }





        if (this.navSettings) {
      this.navSettings.addEventListener('click', (e) => {
        if (e) e.stopPropagation();
        this.sidebarNav.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
        this.navSettings.classList.add('active');
        this.currentHomeTab = 'settings';
        this.showHome(this.workspaceName, 'settings');
      });
    }





    if (this.workspaceBtnSettings) {


      this.workspaceBtnSettings.addEventListener('click', () => {


        this.openSettings('api');


      });


    }





    // 7.1 设置中心顶部标签切换 (API 设置 / 本地与存储


    const tabNavEl = document.querySelector('.xxdp-settings-tab-nav');


    if (tabNavEl) {


      tabNavEl.addEventListener('click', (e) => {


        const btn = e.target.closest('[data-settings-tab]');


        if (btn && btn.dataset.settingsTab) {


          const tab = btn.dataset.settingsTab;


          this.switchSettingsTab(tab);
    this.initCustomDropdowns();


          if (tab === 'api') {


            this.loadApiSettings();


          } else if (tab === 'storage') {


            this.loadStorageSettings();


          }


        }


      });


    }





    if (this.btnSaveStorage) {


      this.btnSaveStorage.addEventListener('click', () => {


        this.handleSaveStorageSettings();


      });


    }





    // 8. 关闭设置中心模态对话框 (带未保存修改保护)


    if (this.btnCloseSettings) {


      this.btnCloseSettings.addEventListener('click', () => {


        this.requestCloseSettings();


      });


    }





    if (this.btnCancelSettings) {


      this.btnCancelSettings.addEventListener('click', () => {


        this.requestCloseSettings();


      });


    }





    if (this.settingsModal) {


      this.settingsModal.addEventListener('click', (e) => {


        if (e.target === this.settingsModal) {


          this.requestCloseSettings();


        }


      });


    }





    window.addEventListener('keydown', (e) => {


      if (e.key === 'Escape') {


        // 关闭任何展开的卡片三点菜单


        document.querySelectorAll('.portal-menu-wrapper.open').forEach(w => w.classList.remove('open'));





        // 退出搜索框聚焦


        if (this.commandInput && document.activeElement === this.commandInput) {


          this.commandInput.blur();


          if (!this.commandInput.value.trim() && this.homeSearchWrapper) {


            this.homeSearchWrapper.classList.remove('expanded');


          }


          return;


        }





        if (document.getElementById('appConfirmModal')?.classList.contains('active')) {


          return;


        }


        if (this.modelPickerModal?.classList.contains('active')) {
          this.closeModelPicker();
          return;
        }

        if (this.renameProjectModal?.classList.contains('active')) {


          this.closeRenameProjectDialog();


          return;


        }


        if (this.newCanvasModal?.classList.contains('active')) {


          this.closeNewCanvasDialog();


        }


        if (this.settingsModal?.classList.contains('active')) {


          this.requestCloseSettings();


        }


        if (this.lanJoinModal?.classList.contains('active')) {
          this.closeLanJoinModal();
        }
      }
    });

    window.addEventListener('keydown', (e) => {
      const isDeleteKey = e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Del'
        || e.code === 'Delete' || e.code === 'Backspace'
        || e.keyCode === 46 || e.keyCode === 8;
      if (!isDeleteKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (this.workspaceView && this.workspaceView.classList.contains('active')) {
        const activeEl = document.activeElement;
        const isEditable = activeEl && (
          activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable ||
          Boolean(activeEl.closest?.('input, textarea, [contenteditable="true"]'))
        );
        if (isEditable) return;
        const anyModalOpen = document.querySelector('.modal.active, .modal.show, #settingsModal.open, #settingsModal.active, #appConfirmModal.active');
        if (anyModalOpen) return;
        const frame = document.getElementById('xxdpCanvasFrame');
        if (frame && frame.contentWindow) {
          try {
            frame.contentWindow.postMessage({ type: 'canvas_delete_key' }, '*');
          } catch (_) {}
        }
      }
    });





    // 8.1 全局 API 设置工作台交互联动


    if (this.settingsDefaultChatModel) {


      this.settingsDefaultChatModel.addEventListener('change', () => {


        this.updateSummary();


        this.checkSettingsDirty();


      });


    }




    if (this.settingsDefaultImageModel) {


      this.settingsDefaultImageModel.addEventListener('change', () => {


        this.updateSummary();


        this.checkSettingsDirty();


      });


    }





    if (this.settingsDefaultVideoModel) {


      this.settingsDefaultVideoModel.addEventListener('change', () => {


        this.updateSummary();


        this.checkSettingsDirty();


      });


    }





    if (this.settingsProviderSelect) {


      this.settingsProviderSelect.addEventListener('change', (e) => {


        this.onProviderSelectChanged(e.target.value);


      });


    }





    if (this.btnAddProvider) {


      this.btnAddProvider.addEventListener('click', () => {
        this.handleAddCustomProvider();
      });
    }

    if (this.btnExportApiConfig) {
      this.btnExportApiConfig.addEventListener('click', () => {
        this.handleExportApiConfig();
      });
    }

    if (this.btnImportApiConfig) {
      this.btnImportApiConfig.addEventListener('click', () => {
        if (this.apiConfigFileInput) {
          this.apiConfigFileInput.value = '';
          this.apiConfigFileInput.click();
        }
      });
    }

    if (this.apiConfigFileInput) {
      this.apiConfigFileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) {
          this.handleImportApiConfig(file);
        }
      });
    }





    if (this.btnSetDefaultProvider) {


      this.btnSetDefaultProvider.addEventListener('click', () => {


        this.handleSetDefaultProvider();


      });


    }





    if (this.providerEnabledInput) {


      this.providerEnabledInput.addEventListener('change', (e) => {


        this.handleToggleProviderEnabled(e.target.checked);


      });


    }





    if (this.btnDeleteProvider) {


      this.btnDeleteProvider.addEventListener('click', () => {


        this.handleDeleteProvider();


      });


    }





    if (this.providerNameInput) {


      this.providerNameInput.addEventListener('input', (e) => {


        this.onProviderNameInput(e.target.value);


      });


    }





    if (this.providerBaseUrlInput) {


      this.providerBaseUrlInput.addEventListener('input', (e) => {


        this.onBaseUrlInput(e.target.value);


      });


    }





    if (this.providerProtocolInput) {


      this.providerProtocolInput.addEventListener('change', (e) => {


        this.onProviderProtocolInput(e.target.value);


      });


    }





    if (this.providerApiKeyInput) {


      this.providerApiKeyInput.addEventListener('input', (e) => {


        this.onApiKeyInput(e.target.value);


      });


    }





    if (this.btnToggleApiKeyVisibility) {


      this.btnToggleApiKeyVisibility.addEventListener('click', () => {


        this.toggleApiKeyVisibility();


      });


    }





    if (this.btnTestConnection) {


      this.btnTestConnection.addEventListener('click', () => {


        this.handleTestConnection();


      });


    }





    if (this.btnTestCliEnv) {


      this.btnTestCliEnv.addEventListener('click', () => {


        this.handleTestCliEnv();


      });


    }





    if (this.btnFetchModels) {


      this.btnFetchModels.addEventListener('click', () => {


        this.handleFetchModels();


      });


    }

    // 方案 B: 按类独立挑选模型与清空事件绑定
    document.querySelectorAll('[data-model-pick]').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        const cat = button.dataset.modelPick;
        this.openModelPicker(cat);
      });
    });

    document.querySelectorAll('[data-model-clear]').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        const cat = button.dataset.modelClear;
        this.handleClearCategoryModels(cat);
      });
    });

    // 方案 B: 模型挑选模态弹窗内控件事件绑定
    if (this.btnCloseModelPicker) {
      this.btnCloseModelPicker.addEventListener('click', () => this.closeModelPicker());
    }
    if (this.btnModelPickerCancel) {
      this.btnModelPickerCancel.addEventListener('click', () => this.closeModelPicker());
    }
    if (this.btnModelPickerConfirm) {
      this.btnModelPickerConfirm.addEventListener('click', () => this.confirmModelPicker());
    }
    if (this.btnModelPickerSelectAll) {
      this.btnModelPickerSelectAll.addEventListener('click', () => this.selectAllPickerVisible());
    }
    if (this.btnModelPickerDeselectAll) {
      this.btnModelPickerDeselectAll.addEventListener('click', () => this.deselectAllPicker());
    }
    if (this.modelPickerSearchInput) {
      this.modelPickerSearchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (this.btnModelPickerSearchClear) {
          this.btnModelPickerSearchClear.style.display = val ? 'flex' : 'none';
        }
        this.renderPickerList(val);
      });
    }
    if (this.btnModelPickerSearchClear) {
      this.btnModelPickerSearchClear.addEventListener('click', () => {
        if (this.modelPickerSearchInput) {
          this.modelPickerSearchInput.value = '';
          this.modelPickerSearchInput.focus();
        }
        this.btnModelPickerSearchClear.style.display = 'none';
        this.renderPickerList('');
      });
    }
    if (this.modelPickerModal) {
      this.modelPickerModal.addEventListener('click', (e) => {
        if (e.target === this.modelPickerModal) {
          this.closeModelPicker();
        }
      });
    }

    if (this.btnTestCliPrompt) {
      this.btnTestCliPrompt.addEventListener('click', () => this.handleTestCliPrompt());
    }
    if (this.providerCliPromptInput) {
      this.providerCliPromptInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.handleTestCliPrompt();
        }
      });
    }

    if (this.btnAddManualModel) {
      this.btnAddManualModel.addEventListener('click', () => this.handleAddManualModel());
    }
    if (this.manualModelInput) {
      this.manualModelInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.handleAddManualModel();
        }
      });
    }





    if (this.btnSaveSettings) {


      this.btnSaveSettings.addEventListener('click', () => {


        this.handleSaveSettings();


      });


    }





    // 9. 主题卡片点击即时切换


    if (this.themeCardDark) {


      this.themeCardDark.addEventListener('click', () => {


        this.applyTheme('dark');


      });


    }





    if (this.themeCardLight) {


      this.themeCardLight.addEventListener('click', () => {


        this.applyTheme('light');


      });


    }





    // 8. 窗口控制栏全局深浅主题切换（统一通过全局入口，不重复绑定 click 避免双重触发即刻相消）
    window.toggleGlobalAppTheme = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      this.toggleThemeWithAnimation();
    };





    if (this.themeToggleCheckbox) {


      this.themeToggleCheckbox.addEventListener('change', (e) => {


        this.applyTheme(e.target.checked ? 'dark' : 'light');


      });


    }





    // 10. 绑定局域网协作事件


    this.bindLanEvents();


  }





  handleAddManualModel(...args) {
    return this.settingsManager.handleAddManualModel(...args);
  }

  handleRemoveManualModel(...args) {
    return this.settingsManager.handleRemoveManualModel(...args);
  }

  handleClearCategoryModels(...args) {
    return this.settingsManager.handleClearCategoryModels(...args);
  }

  openModelPicker(...args) {
    return this.settingsManager.openModelPicker(...args);
  }

  closeModelPicker(...args) {
    return this.settingsManager.closeModelPicker(...args);
  }

  confirmModelPicker(...args) {
    return this.settingsManager.confirmModelPicker(...args);
  }

  renderPickerList(...args) {
    return this.settingsManager.renderPickerList(...args);
  }

  selectAllPickerVisible(...args) {
    return this.settingsManager.selectAllPickerVisible(...args);
  }

  deselectAllPicker(...args) {
    return this.settingsManager.deselectAllPicker(...args);
  }

  /**


   * 切换深浅主题，立即生效，无过渡动画。


   * @param {'dark' | 'light'} [targetTheme]


   */


  toggleTheme(targetTheme) {
    const current = this.currentTheme || document.documentElement.getAttribute('data-theme') || (document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light');
    const nextTheme = (typeof targetTheme === 'string' && (targetTheme === 'dark' || targetTheme === 'light'))
      ? targetTheme
      : (current === 'dark' ? 'light' : 'dark');
    this.applyTheme(nextTheme);
  }

  toggleThemeWithAnimation(targetTheme) {
    const current = this.currentTheme || document.documentElement.getAttribute('data-theme') || (document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light');
    const nextTheme = (typeof targetTheme === 'string' && (targetTheme === 'dark' || targetTheme === 'light'))
      ? targetTheme
      : (current === 'dark' ? 'light' : 'dark');
    this.applyTheme(nextTheme);
  }



  /**


   * 应用并即时生效主题（无需刷新）


   * @param {'dark' | 'light'} theme 
   */


  applyTheme(theme, notifyFrame = true) {
    try {
      const themeRoot = document.documentElement;
      themeRoot.classList.add('theme-switching');
      requestAnimationFrame(() => themeRoot.classList.remove('theme-switching'));

      this.currentTheme = (theme === 'light') ? 'light' : 'dark';

      document.documentElement.dataset.theme = this.currentTheme;
      document.documentElement.setAttribute('data-theme', this.currentTheme);
      document.documentElement.classList.toggle('theme-dark', this.currentTheme === 'dark');
      document.documentElement.classList.toggle('dark', this.currentTheme === 'dark');
      document.documentElement.classList.toggle('studio-theme-dark', this.currentTheme === 'dark');

      const globalBtn = this.globalThemeToggleBtn || document.getElementById('globalThemeToggleBtn');
      if (globalBtn) {
        globalBtn.setAttribute('data-theme', this.currentTheme);
        globalBtn.title = (this.currentTheme === 'dark') ? '切换为浅色模式' : '切换为深色模式';
        globalBtn.setAttribute('aria-label', (this.currentTheme === 'dark') ? '切换为浅色模式' : '切换为深色模式');
      }

      if (this.themeToggleBtn) {
        this.themeToggleBtn.setAttribute('data-theme', this.currentTheme);
        this.themeToggleBtn.title = (this.currentTheme === 'dark') ? '切换为浅色模式' : '切换为深色模式';
      }

      const welcomeThemeBtn = document.getElementById('welcomeThemeToggleBtn');
      if (welcomeThemeBtn) {
        welcomeThemeBtn.setAttribute('data-theme', this.currentTheme);
        welcomeThemeBtn.title = (this.currentTheme === 'dark') ? '切换为浅色模式' : '切换为深色模式';
      }

      if (this.themeToggleCheckbox) {
        this.themeToggleCheckbox.checked = (this.currentTheme === 'dark');
      }

      if (this.themeCardDark) {
        this.themeCardDark.classList.toggle('selected', this.currentTheme === 'dark');
      }

      if (this.themeCardLight) {
        this.themeCardLight.classList.toggle('selected', this.currentTheme === 'light');
      }

      store.setTheme(this.currentTheme);

      try {
        localStorage.setItem('studio_theme', this.currentTheme);
        localStorage.setItem('canvas_theme', this.currentTheme);
        localStorage.setItem('xxdp_theme', this.currentTheme);
      } catch(e) {}

      if (notifyFrame) {
        this.syncFrameTheme();
      }
    } catch (e) {}
  }

  syncFrameTheme(targetTheme = this.currentTheme) {
    const theme = (targetTheme === 'light') ? 'light' : 'dark';
    const dark = (theme === 'dark');
    const frame = document.getElementById('xxdpCanvasFrame');
    if (frame && frame.contentWindow) {
      try {
        frame.contentWindow.postMessage({ type: 'theme_changed', theme }, '*');
        frame.contentWindow.postMessage({ type: 'studio-theme', theme }, '*');
        try {
          if (typeof frame.contentWindow.StudioTheme?.apply === 'function') {
            frame.contentWindow.StudioTheme.apply(theme);
          }
        } catch (_) {}
        try {
          if (typeof frame.contentWindow.applyCanvasTheme === 'function') {
            frame.contentWindow.applyCanvasTheme(theme);
          } else if (typeof frame.contentWindow.applyTheme === 'function') {
            frame.contentWindow.applyTheme(theme);
          }
        } catch (_) {}
        const doc = frame.contentDocument;
        if (doc && doc.documentElement) {
          doc.documentElement.classList.toggle('theme-dark', dark);
          doc.documentElement.classList.toggle('studio-theme-dark', dark);
          doc.documentElement.setAttribute('data-theme', theme);
          if (doc.body) {
            doc.body.classList.toggle('theme-dark', dark);
            doc.body.classList.toggle('studio-theme-dark', dark);
            doc.body.setAttribute('data-theme', theme);
          }
        }
        try {
          if (frame.contentWindow.history && frame.contentWindow.location) {
            const u = new URL(frame.contentWindow.location.href);
            if (u.searchParams.get('theme') !== theme) {
              u.searchParams.set('theme', theme);
              frame.contentWindow.history.replaceState(null, '', u.pathname + u.search + u.hash);
            }
          }
        } catch (_) {}
      } catch (e) {}
    }
  }





  /**


   * 打开设置中心或外观模态对话框


   * @param {'api' | 'appearance' | 'storage'} tab


   */


  async openSettings(tab = 'api') {


    if (!this.settingsModal) return;


    
    this.navSettings?.classList.add('active');


    this.providerEdits = {};


    this.isSettingsDirtyState = false;


    this.updateDirtyNotice();


    this.hideTestResult();


    if (this.settingsStatusMsg) {


      this.settingsStatusMsg.style.display = 'none';


      this.settingsStatusMsg.textContent = '';


    }


    if (this.storageStatusMsg) {


      this.storageStatusMsg.style.display = 'none';


      this.storageStatusMsg.textContent = '';


    }


    if (this.storageDirtyNotice) {


      this.storageDirtyNotice.style.display = 'none';


    }


    this.switchSettingsTab(tab);
    this.initCustomDropdowns();

    // 统一使用实际选中的设置标签加载内容。
    const effectiveTab = this.currentSettingsTab;





    if (effectiveTab === 'api') {


      await this.loadApiSettings();


    } else if (effectiveTab === 'storage') {


      await this.loadStorageSettings();


    }


  }





  /**


   * 切换设置中心内部展示区域 (API 设置 / 本地与存储/ 外观模式)


   * @param {'api' | 'appearance' | 'storage'} tab


   */


  switchSettingsTab(tab = 'api') {


    // 外观主题由侧边栏控制，设置中心只保留 API 与本地存储。
    if (tab === 'appearance' || tab === 'account' || tab === 'users') tab = 'api';
    if (tab === 'storage' && !this.isMasterAccount) tab = 'api';


    this.currentSettingsTab = tab;


    const tabNav = document.querySelector('.xxdp-settings-tab-nav');


    const apiTabContent = document.getElementById('apiTabContent');


    const storageSection = document.getElementById('storageSettingsSection');


const titleEl = document.getElementById('settingsModalTitle');


    const scopeBadge = document.getElementById('settingsScopeBadge');


    const footer = this.settingsModal ? this.settingsModal.querySelector('.xxdp-settings-footer') : null;





    if (tabNav) {


      const tabBtns = tabNav.querySelectorAll('[data-settings-tab]');


      tabBtns.forEach(btn => {
        if (btn.dataset.settingsTab === 'storage') {
          const canSeeStorage = Boolean(this.isMasterAccount && !this.isCollaborationAccount);
          btn.hidden = !canSeeStorage;
          btn.setAttribute('aria-hidden', canSeeStorage ? 'false' : 'true');
        }


        btn.classList.toggle('active', btn.dataset.settingsTab === tab);


      });


    }





    if (tab === 'storage') {
      if (titleEl) titleEl.textContent = '本地与存储设置';
      if (scopeBadge) scopeBadge.style.display = 'none';
      const scopePill = document.getElementById('settingsScopeDisplayPill');
      if (scopePill) scopePill.style.display = 'none';
      if (tabNav) tabNav.style.display = '';
      if (apiTabContent) apiTabContent.style.display = 'none';
      if (storageSection) storageSection.style.display = '';
      if (footer) footer.style.display = 'none';
    } else {
      // tab === 'api' (以及默认全局设置)
      if (titleEl) titleEl.textContent = '全局 API 配置，所有项目共用';
      if (scopeBadge) {
        scopeBadge.style.display = 'none';
      }
      const scopePill = document.getElementById('settingsScopeDisplayPill');
      if (scopePill) scopePill.style.display = 'none';
      if (tabNav) tabNav.style.display = '';
      if (apiTabContent) apiTabContent.style.display = '';
      if (storageSection) storageSection.style.display = 'none';
      if (footer) footer.style.display = '';
    }


  }






  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }
  /**


  * 加载本地与存储配置


   */


  loadStorageSettings(...args) {
    return this.settingsManager.loadStorageSettings(...args);
  }





  /**


   * 渲染本地与存储紧凑列表


   */


  renderStorageList(...args) {
    return this.settingsManager.renderStorageList(...args);
  }





  markStorageDirty(...args) {
    return this.settingsManager.markStorageDirty(...args);
  }





  /**


   * 保存存储路径配置


   */


  handleSaveStorageSettings(...args) {
    return this.settingsManager.handleSaveStorageSettings(...args);
  }





  /**


   * 从后端真实 GET /api/canvas-api-settings?mode=personal&canvas_id=default


   */


  loadApiSettings(...args) {
    return this.settingsManager.loadApiSettings(...args);
  }





  /**


   * 从后端数据建立干净快照（供脏检查对比）


   */


  updateSnapshotFromData(...args) {
    return this.settingsManager.updateSnapshotFromData(...args);
  }





  /**


   * 渲染默认图片/视频模型下拉框(严格使用真实已启用平台模型


   */


  renderDefaultModelSelectors(...args) {
    return this.settingsManager.renderDefaultModelSelectors(...args);
  }





  /**


   * 刷新全局设置状态（摘要卡片已移除，保留空实现以兼容现有调用点）


   */


  updateSummary(...args) {
    return this.settingsManager.updateSummary(...args);
  }





  /**


   * 真实渲染左侧平台列表 (provider、协议/密钥状态、能力模型、首选状态


   */



  /** Skip select rebuild when option values+labels(+selected) unchanged. */
  _setSelectOptionsIfChanged(...args) {
    return this.settingsManager._setSelectOptionsIfChanged(...args);
  }

  /** Provider list: rebuild via DocumentFragment only when signature changes. */
  _providerListSignature(...args) {
    return this.settingsManager._providerListSignature(...args);
  }

  renderProviderList(...args) {
    return this.settingsManager.renderProviderList(...args);
  }





  /**


   * 兼容保留的下拉框方法 (避免第三方或旧调用异常


   */


  renderProviderSelect(...args) {
    return this.settingsManager.renderProviderSelect(...args);
  }





  /**


   * 获取当前选中的 Provider 对象


   */


  getSelectedProvider(...args) {
    return this.settingsManager.getSelectedProvider(...args);
  }





  /**


   * 切换选中的 Provider（切换前保留当前草稿）


   */


  switchSelectedProvider(...args) {
    return this.settingsManager.switchSelectedProvider(...args);
  }





  onProviderSelectChanged(...args) {
    return this.settingsManager.onProviderSelectChanged(...args);
  }





  /**


   * 渲染右侧选中的 Provider 卡片配置详情


   */


  renderSelectedProviderCard(...args) {
    return this.settingsManager.renderSelectedProviderCard(...args);
  }





  /**


   * 新增自定义平台(从本次草稿中新建)


   */


  handleAddCustomProvider(...args) {
    return this.settingsManager.handleAddCustomProvider(...args);
  }





  /**


   * 从本次草稿删除平台


   * 约束：至少保留一个平台；删除被 image/video/chat 默认绑定引用的平台时必须阻止并提示先改默认绑定


   */


  handleDeleteProvider(...args) {
    return this.settingsManager.handleDeleteProvider(...args);
  }





  /**


   * 设为当前工作空间首选平台


   */


  handleSetDefaultProvider(...args) {
    return this.settingsManager.handleSetDefaultProvider(...args);
  }





  /**


   * 切换当前平台的启用状态


   */


  handleToggleProviderEnabled(...args) {
    return this.settingsManager.handleToggleProviderEnabled(...args);
  }





  /**


   * 编辑平台名称输入联动


   */


  onProviderNameInput(...args) {
    return this.settingsManager.onProviderNameInput(...args);
  }





  onBaseUrlInput(...args) {
    return this.settingsManager.onBaseUrlInput(...args);
  }





  onProviderProtocolInput(...args) {
    return this.settingsManager.onProviderProtocolInput(...args);
  }





  onApiKeyInput(...args) {
    return this.settingsManager.onApiKeyInput(...args);
  }





  toggleApiKeyVisibility(...args) {
    return this.settingsManager.toggleApiKeyVisibility(...args);
  }





  /**


   * 安全文本清洗：替换内存中当前输入的 Key 及常见密钥模式，杜绝 UI 与 Console 泄露


   */


  sanitizeSafeText(...args) {
    return this.settingsManager.sanitizeSafeText(...args);
  }





  /**


   * 测试当前平台连通性（仅在用户主动点击时调用，沿用 /api/providers/test-connection)


   */


  handleTestConnection(...args) {
    return this.settingsManager.handleTestConnection(...args);
  }





  /**


   * 异步更新 CLI 状态徽章与路径/版本


   */


  refreshCliStatusBadge(...args) {
    return this.settingsManager.refreshCliStatusBadge(...args);
  }





  /**


   * 手动“检测本机 CLI 环境”（查询 /api/cli/status 与 /api/codex/status 并给予状态反馈）


   */


  handleTestCliPrompt(...args) {
    return this.settingsManager.handleTestCliPrompt(...args);
  }

  handleTestCliEnv(...args) {
    return this.settingsManager.handleTestCliEnv(...args);
  }





  /**


   * 手动“获取真实模型”（沿用 /api/providers/fetch-models，以当前草稿 URL/Key 发起，结果按图片/视频/对话分组为未保存草稿）


   * 失败不伪造、不开页自动请求；CLI 不能请求网络模型


   */


  handleFetchModels(...args) {
    return this.settingsManager.handleFetchModels(...args);
  }





  showActionResult(...args) {
    return this.settingsManager.showActionResult(...args);
  }





  hideActionResult(...args) {
    return this.settingsManager.hideActionResult(...args);
  }





  showTestResult(...args) {
    return this.settingsManager.showTestResult(...args);
  }





  hideTestResult(...args) {
    return this.settingsManager.hideTestResult(...args);
  }





  /**


   * 检查当前是否有未保存的设置修改


   */


  checkSettingsDirty(...args) {
    return this.settingsManager.checkSettingsDirty(...args);
  }





  updateDirtyNotice(...args) {
    return this.settingsManager.updateDirtyNotice(...args);
  }





  /**


   * 关闭设置中心（在有未保存修改时弹窗二次确认）


   */


  requestCloseSettings(...args) {
    return this.settingsManager.requestCloseSettings(...args);
  }





  closeSettings(...args) {
    return this.settingsManager.closeSettings(...args);
  }





  /**


   * 保存设置：调用真实 PUT /api/canvas-api-settings 与 PATCH /api/canvas-api-settings/defaults


   */


  handleSaveSettings(...args) {
    return this.settingsManager.handleSaveSettings(...args);
  }

  handleExportApiConfig(...args) {
    return this.settingsManager.handleExportApiConfig(...args);
  }

  handleImportApiConfig(...args) {
    return this.settingsManager.handleImportApiConfig(...args);
  }





  syncApiSettingsDisplay(...args) {
    return this.settingsManager.syncApiSettingsDisplay(...args);
  }





  /**


   * 呈现首次启动视图


   */


  showWelcome() {


    this.homeView.classList.remove('active');


    this.workspaceView.classList.remove('active');


    if (this.lanView) this.lanView.classList.remove('active');


    this.stopLanDiscovery();


    this.stopLanHeartbeat();
    this.stopAuthHeartbeat();


    this.welcomeView.classList.add('active');


    setTimeout(() => {


      if (this.workspaceInput) {


        this.workspaceInput.focus();


      }


    }, 120);


  }

  startAuthHeartbeat() {
    if (this.authHeartbeatTimer || !localStorage.getItem('xxdp_auth_token')) return;
    const send = () => {
      if (!localStorage.getItem('xxdp_auth_token')) return;
      fetch('/api/auth/heartbeat', { method: 'POST' }).catch(() => {});
    };
    send();
    this.authHeartbeatTimer = window.setInterval(send, 20000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) send();
    }, { once: false });
  }

  stopAuthHeartbeat() {
    if (!this.authHeartbeatTimer) return;
    window.clearInterval(this.authHeartbeatTimer);
    this.authHeartbeatTimer = null;
  }





  /**


   * 呈现首页视图（项目入口。/ Canvas Launchpad?


   * @param {string} workspaceName


   */


  showHome(workspaceName, targetTab) {
    const display = this.currentDisplayName || workspaceName || store.getWorkspaceName() || this.workspaceName || this.currentUsername || '主机用户';
    if (this.workspaceDisplay) {
      this.workspaceDisplay.textContent = display;
    }

    if (this.breadcrumbWorkspaceDisplay) {
      this.breadcrumbWorkspaceDisplay.textContent = display;
    }





    if (targetTab === 'recent') targetTab = 'my';


    if (targetTab && ['my', 'assets', 'favorites', 'trash', 'lan'].includes(targetTab)) {


      this.currentHomeTab = targetTab;


    } else if (!this.currentHomeTab) {


      this.currentHomeTab = 'my';


    }





    // 首页左侧栏高亮同步当前选中的分类


    if (this.sidebarNav) {


      this.sidebarNav.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));


      const activeTabItem = this.sidebarNav.querySelector(`[data-nav="${this.currentHomeTab}"]`);


      if (activeTabItem) {


        activeTabItem.classList.add('active');


      }


    }





    // 同步顶部标题与面包屑文本


    const titles = {


      my: '我的画布',

      assets: '我的资产',


      favorites: '收藏项目',


      trash: '回收站',


      lan: '协作画布',
      settings: '设置'


    };


    const breadcrumbs = {


      my: '我的画布',

      assets: '我的资产',


      favorites: '收藏项目',


      trash: '回收站',


      lan: '协作画布',
      settings: '设置'


    };


    const currentTitle = titles[this.currentHomeTab] || '我的画布';


    const currentBreadcrumb = breadcrumbs[this.currentHomeTab] || currentTitle;


    if (this.homeSectionTitle) {


      this.homeSectionTitle.textContent = currentTitle;


    }


    if (this.homeBreadcrumb) {


      this.homeBreadcrumb.textContent = currentBreadcrumb;


    }


    const spatialTitleEl = document.querySelector('.canvas-spatial-tag span:last-child');


    if (spatialTitleEl) {


      spatialTitleEl.textContent = currentTitle;


    }





    // 同步顶部分类筛选 Pill 激活态


    if (this.homeFilterPills) {


      this.homeFilterPills.querySelectorAll('.filter-pill').forEach(el => {


        el.classList.toggle('active', el.dataset.filter === this.currentHomeTab);


      });


    }





    // 返回主页后清除画布路由，后续刷新保持在主页。


    try {


      const cleanUrl = new URL(window.location);


      cleanUrl.searchParams.delete('view');


      cleanUrl.searchParams.delete('project');


      cleanUrl.searchParams.delete('id');

      cleanUrl.searchParams.delete('project_id');

      cleanUrl.searchParams.delete('mode');

      if (document.documentElement.classList.contains('desktop-shell') || Boolean(window.desktopWindow)) {
        cleanUrl.searchParams.set('desktop', '1');
      }

      window.history.replaceState({}, '', cleanUrl);


    } catch (e) {}





    this.welcomeView.classList.remove('active');


    this.workspaceView.classList.remove('active');


    if (this.lanView) this.lanView.classList.remove('active');


    this.homeView.classList.add('active');





    // 针对 LAN Tab 与普通项目 Tab 进行分支显示与数据装载


    const isLanTab = this.currentHomeTab === 'lan';
    const isSettingsTab = this.currentHomeTab === 'settings';
    const isMyTab = this.currentHomeTab === 'my';
    const isAssetsTab = this.currentHomeTab === 'assets';

    if (this.lanTopStatusBadge) {
      this.lanTopStatusBadge.style.display = isLanTab ? 'inline-flex' : 'none';
    }
    if (this.homeSearchWrapper) {
      this.homeSearchWrapper.style.display = isMyTab ? 'flex' : 'none';
    }
    if (!isMyTab && this.commandInput && this.commandInput.value) {
      this.commandInput.value = '';
      this.homeSearchWrapper?.classList.remove('expanded');
    }
    const homePanelHeader = document.querySelector('.home-panel-header');
    if (homePanelHeader) {
      homePanelHeader.style.display = isAssetsTab ? 'none' : 'flex';
    }
    const canvasLaunchpad = document.getElementById('canvasLaunchpad');
    if (canvasLaunchpad) {
      canvasLaunchpad.classList.toggle('is-assets-mode', isAssetsTab);
    }
    if (this.homePortalsScrollArea) {
      this.homePortalsScrollArea.style.display = (isLanTab || isSettingsTab || isAssetsTab) ? 'none' : 'block';
    }
    const homeAssetsScrollArea = document.getElementById('homeAssetsScrollArea');
    if (homeAssetsScrollArea) {
      homeAssetsScrollArea.style.display = isAssetsTab ? 'flex' : 'none';
      if (isAssetsTab && !this.homeAssetLibrary) this.homeAssetLibrary = new HomeAssetLibrary(homeAssetsScrollArea);
      this.homeAssetLibrary?.setActive(isAssetsTab);
    }
    if (this.homeLanScrollArea) {
      this.homeLanScrollArea.style.display = isLanTab ? 'flex' : 'none';
    }
    if (this.homeSettingsScrollArea) {
      this.homeSettingsScrollArea.style.display = isSettingsTab ? 'flex' : 'none';
    }
    if (isSettingsTab) {
      this.navSettings?.classList.add('active');
      this.openSettings('api');
    } else if (isAssetsTab) {
      this.navSettings?.classList.remove('active');
      this.stopLanHubPolling();
      this.stopLanDiscovery();
    } else {
      this.navSettings?.classList.remove('active');
    }

    if (isLanTab) {
      if (this.isFixedLanEntry) {
        // 另一台电脑通过 8910 打开时，直接展示本机当前开放的协作房间。
        this.collabManager.loadFixedLanEntryRoom().catch(() => {});
      } else {
        // 房主页面同时加载协作状态和可选择的项目/画布。
        this.fetchLanHubState().catch(() => {});
        this.collabManager?.fetchLanNetworkInfo?.().catch(() => {});
        this.collabManager?.renderRecentSessions?.();
        this.loadLanProjectsAndCanvases().catch((error) => {
          console.warn('[LAN] 项目列表加载失败:', error);
          if (this.lanHostProjectSelect) {
            this.lanHostProjectSelect.innerHTML = '<option value="">项目列表加载失败，请点击协作画布后重试</option>';
          }
          if (this.lanHostCanvasSelect) {
            this.lanHostCanvasSelect.innerHTML = '<option value="">暂无可用画布</option>';
          }
        });
      }
    } else {
      this.stopLanHubPolling();
      this.stopLanDiscovery();

      // 素材库有独立的数据入口。
      if (!isAssetsTab) this.loadAndRenderPortals();
    }


  }

  /**


   * 打开新建项目对话框


   */


  openNewProjectDialog(...args) {
    return this.projectManager.openNewProjectDialog(...args);
  }





  /**


   * 关闭新建项目对话框（取消操作：不创建任何记录）


   */


  closeNewProjectDialog(...args) {
    return this.projectManager.closeNewProjectDialog(...args);
  }





  // 兼容别名方法


  openNewCanvasDialog(...args) {
    return this.projectManager.openNewCanvasDialog(...args);
  }





  closeNewCanvasDialog(...args) {
    return this.projectManager.closeNewCanvasDialog(...args);
  }





  /**


   * 打开修改项目名称对话框


   * @param {object} project


   */


  openRenameProjectDialog(...args) {
    return this.projectManager.openRenameProjectDialog(...args);
  }





  /**


   * 关闭修改项目名称对话框


   */


  closeRenameProjectDialog(...args) {
    return this.projectManager.closeRenameProjectDialog(...args);
  }





  /**


   * 提交修改项目名称


   * @param {Event} e


   */


  handleRenameProjectSubmit(...args) {
    return this.projectManager.handleRenameProjectSubmit(...args);
  }





  /**


   * 原生主题确认对话框(统一内建 UI，彻底告别浏览器默认 window.confirm)


   * @param {string|object} options


   *   - title?: string


   *   - message: string


   *   - confirmText?: string (默认 '确定')


   *   - cancelText?: string (默认 '取消')


   *   - danger?: boolean (是否危险操作红色按钮)


   * @returns {Promise<boolean>}


   */


  confirm(options) {


    return new Promise((resolve) => {


      const opts = typeof options === 'string' ? { message: options } : (options || {});


      const modal = document.getElementById('appConfirmModal');


      const titleEl = document.getElementById('appConfirmModalTitle');


      const msgEl = document.getElementById('appConfirmModalMessage');


      const btnCancel = document.getElementById('btnCancelAppConfirm');


      const btnSubmit = document.getElementById('btnSubmitAppConfirm');


      const btnClose = document.getElementById('btnCloseAppConfirm');





      if (!modal || !msgEl || !btnSubmit) {


        resolve(window.confirm(opts.message || ''));


        return;


      }





      if (titleEl) titleEl.textContent = opts.title || '确认操作';


      msgEl.textContent = opts.message || '';


      btnSubmit.textContent = opts.confirmText || '确定';


      if (btnCancel) {


        btnCancel.style.display = 'inline-flex';


        btnCancel.textContent = opts.cancelText || '取消';


      }





      if (opts.danger) {


        btnSubmit.classList.add('danger');


        btnSubmit.classList.remove('primary');


      } else {


        btnSubmit.classList.remove('danger');


        btnSubmit.classList.add('primary');


      }





      let settled = false;


      const cleanup = () => {


        if (settled) return;


        settled = true;


        modal.classList.remove('active');


        btnSubmit.removeEventListener('click', onConfirm);


        if (btnCancel) btnCancel.removeEventListener('click', onCancel);


        if (btnClose) btnClose.removeEventListener('click', onCancel);


        modal.removeEventListener('click', onBackdrop);


        window.removeEventListener('keydown', onKey, true);


      };





      const onConfirm = () => {


        cleanup();


        resolve(true);


      };





      const onCancel = () => {


        cleanup();


        resolve(false);


      };





      const onBackdrop = (e) => {


        if (e.target === modal) {


          onCancel();


        }


      };





      const onKey = (e) => {


        if (e.key === 'Escape') {


          e.preventDefault();


          e.stopPropagation();


          onCancel();


        } else if (e.key === 'Enter') {


          e.preventDefault();


          e.stopPropagation();


          onConfirm();


        }


      };





      btnSubmit.addEventListener('click', onConfirm);


      if (btnCancel) btnCancel.addEventListener('click', onCancel);


      if (btnClose) btnClose.addEventListener('click', onCancel);


      modal.addEventListener('click', onBackdrop);


      window.addEventListener('keydown', onKey, true);





      modal.classList.add('active');


      setTimeout(() => {


        btnSubmit.focus();


      }, 50);


    });


  }





  /**


   * 原生主题提示对话框(统一内建 UI，彻底告别浏览器默认 alert)


   * @param {string} message


   * @param {string} [title]


   * @returns {Promise<void>}


   */


  alert(message, title = '提示') {


    return new Promise((resolve) => {


      const modal = document.getElementById('appConfirmModal');


      const titleEl = document.getElementById('appConfirmModalTitle');


      const msgEl = document.getElementById('appConfirmModalMessage');


      const btnCancel = document.getElementById('btnCancelAppConfirm');


      const btnSubmit = document.getElementById('btnSubmitAppConfirm');


      const btnClose = document.getElementById('btnCloseAppConfirm');





      if (!modal || !msgEl || !btnSubmit) {


        window.alert(message);


        resolve();


        return;


      }





      if (titleEl) titleEl.textContent = title;


      msgEl.textContent = message || '';


      btnSubmit.textContent = '我知道了';


      btnSubmit.classList.remove('danger');


      btnSubmit.classList.add('primary');





      if (btnCancel) btnCancel.style.display = 'none';





      let settled = false;


      const cleanup = () => {


        if (settled) return;


        settled = true;


        modal.classList.remove('active');


        if (btnCancel) btnCancel.style.display = 'inline-flex';


        btnSubmit.removeEventListener('click', onClose);


        if (btnClose) btnClose.removeEventListener('click', onClose);


        modal.removeEventListener('click', onBackdrop);


        window.removeEventListener('keydown', onKey, true);


      };





      const onClose = () => {


        cleanup();


        resolve();


      };





      const onBackdrop = (e) => {


        if (e.target === modal) {


          onClose();


        }


      };





      const onKey = (e) => {


        if (e.key === 'Escape' || e.key === 'Enter') {


          e.preventDefault();


          e.stopPropagation();


          onClose();


        }


      };





      btnSubmit.addEventListener('click', onClose);


      if (btnClose) btnClose.addEventListener('click', onClose);


      modal.addEventListener('click', onBackdrop);


      window.addEventListener('keydown', onKey, true);





      modal.classList.add('active');


      setTimeout(() => {


        btnSubmit.focus();


      }, 50);


    });


  }





  /**


   * 提交新建项目表单（真实后端持久化：创建项目 -> 为该项目创建画布 -> 进入工作区）


   */


  handleCreateProjectSubmit(...args) {
    return this.projectManager.handleCreateProjectSubmit(...args);
  }





  // 兼容别名方法


  handleCreateCanvasSubmit(...args) {
    return this.projectManager.handleCreateCanvasSubmit(...args);
  }





  /**


   * 从后端真实拉取项目和画布列表并动态渲染首页项目列表


   */


  loadAndRenderPortals(...args) {
    return this.projectManager.loadAndRenderPortals(...args);
  }





  /**


   * 应用当前 Command Bar 搜索框中的关键词进行即时卡片过滤


   */


  applyCurrentSearch(...args) {
    return this.projectManager.applyCurrentSearch(...args);
  }





  renderPortals(...args) {
    return this.projectManager.renderPortals(...args);
  }





  /**


   * 切换项目收藏状态


   * @param {object} project


   */


  handleToggleFavoriteProject(...args) {
    return this.projectManager.handleToggleFavoriteProject(...args);
  }





  /**


   * 软删除项目：移入回收站并保留画布与媒体


   * @param {object} project


   */


  handleTrashProject(...args) {
    return this.projectManager.handleTrashProject(...args);
  }





  /**


   * 彻底删除项目：永久清除项目记录（仅在回收站内触发）


   * @param {object} project


   */


  handleDeleteForeverProject(...args) {
    return this.projectManager.handleDeleteForeverProject(...args);
  }





  /**


   * 恢复项目：从回收站中恢复并保留画布与媒体


   * @param {object} project


   */


  handleRestoreProject(...args) {
    return this.projectManager.handleRestoreProject(...args);
  }





  /**


   * 打开项目：进入项目关联的画布。若该项目暂无画布，则为该项目创建第一张画布（不得创建无归属的临时画布）?


   * @param {object} project


   * @param {object|null} primaryCanvas


   */


  openProject(...args) {
    return this.projectManager.openProject(...args);
  }





  escapeHtml(str) {


    const div = document.createElement('div');


    div.textContent = str || '';


    return div.innerHTML;


  }





  formatRelativeTime(...args) {
    return this.projectManager.formatRelativeTime(...args);
  }





  getOrCreateCanvasId(...args) {
    return this.projectManager.getOrCreateCanvasId(...args);
  }





  /**


   * 点击新建画布兼容实现


   */


  createNewCanvas(...args) {
    return this.projectManager.createNewCanvas(...args);
  }





  /**


   * 呈现项目工作区视图（加载成熟的 smart-canvas 视口）


   * @param {string} projectName


   * @param {string} [explicitCanvasId]


   * @param {string} [projectId]


   */


  showWorkspace(...args) {
    return this.projectManager.showWorkspace(...args);
  }





  // ================= 全新局域网协同体系 (P2P Mesh + CRDT 4色席位) =================
  bindLanHubEvents(...args) {
    return this.collabManager.bindLanHubEvents(...args);
  }

  fetchLanHubState(...args) {
    return this.collabManager.fetchLanHubState(...args);
  }

  renderLanHub(...args) {
    return this.collabManager.renderLanHub(...args);
  }

  startLanHubPolling(...args) {
    return this.collabManager.startLanHubPolling(...args);
  }

  stopLanHubPolling(...args) {
    return this.collabManager.stopLanHubPolling(...args);
  }

  showLanPairingModal(...args) {
    return this.collabManager.showLanPairingModal(...args);
  }

  hideLanPairingModal(...args) {
    return this.collabManager.hideLanPairingModal(...args);
  }

  handleCopyPairingCode(...args) {
    return this.collabManager.handleCopyPairingCode(...args);
  }

  handleImportPairingCode(...args) {
    return this.collabManager.handleImportPairingCode(...args);
  }

  handleNewLanCanvas(...args) {
    return this.collabManager.handleNewLanCanvas(...args);
  }

  /**
   * ================= 局域网协作 V1 业务逻辑 (LAN Collaboration V1) =================
   */


  bindLanEvents(...args) {
    return this.collabManager.bindLanEvents(...args);
  }





  showLan(...args) {
    return this.collabManager.showLan(...args);
  }





  startLanDiscovery(...args) {
    return this.collabManager.startLanDiscovery(...args);
  }





  stopLanDiscovery(...args) {
    return this.collabManager.stopLanDiscovery(...args);
  }





  stopLanHeartbeat(...args) {
    return this.collabManager.stopLanHeartbeat(...args);
  }





  getStableDeviceId(...args) {
    return this.collabManager.getStableDeviceId(...args);
  }





  getDeviceName(...args) {
    return this.collabManager.getDeviceName(...args);
  }





  updateLanModeBadge(...args) {
    return this.collabManager.updateLanModeBadge(...args);
  }





  loadLanProjectsAndCanvases(...args) {
    return this.collabManager.loadLanProjectsAndCanvases(...args);
  }





  onLanHostProjectChange(...args) {
    return this.collabManager.onLanHostProjectChange(...args);
  }





  fetchHostRoomStatus(...args) {
    return this.collabManager.fetchHostRoomStatus(...args);
  }





  renderLanHostInvites(...args) {
    return this.collabManager.renderLanHostInvites(...args);
  }





  handleLanHostAddInvite(...args) {
    return this.collabManager.handleLanHostAddInvite(...args);
  }





  handleLanHostToggleInvite(...args) {
    return this.collabManager.handleLanHostToggleInvite(...args);
  }





  handleLanHostCreateRoom(...args) {
    return this.collabManager.handleLanHostCreateRoom(...args);
  }





  handleLanHostEnterSnapshot(...args) {
    return this.collabManager.handleLanHostEnterSnapshot(...args);
  }





  handleLanHostCloseRoom(...args) {
    return this.collabManager.handleLanHostCloseRoom(...args);
  }





  fetchDiscoveredRooms(...args) {
    return this.collabManager.fetchDiscoveredRooms(...args);
  }





  handleLanManualProbe(...args) {
    return this.collabManager.handleLanManualProbe(...args);
  }





  openLanJoinModal(...args) {
    return this.collabManager.openLanJoinModal(...args);
  }

  closeLanJoinModal(...args) {
    return this.collabManager.closeLanJoinModal(...args);
  }

  handleLanJoinSubmit(...args) {
    return this.collabManager.handleLanJoinSubmit(...args);
  }





  enterLanSession(...args) {
    return this.collabManager.enterLanSession(...args);
  }





  startLanHeartbeat(...args) {
    return this.collabManager.startLanHeartbeat(...args);
  }





  updateLanSessionPresence(...args) {
    return this.collabManager.updateLanSessionPresence(...args);
  }





  showLanSessionAlert(...args) {
    return this.collabManager.showLanSessionAlert(...args);
  }





  exitLanSession(...args) {
    return this.collabManager.exitLanSession(...args);
  }





  renderReadOnlySnapshot(...args) {
    return this.collabManager.renderReadOnlySnapshot(...args);
  }


}





function bootApp() {


  try {


    console.log('[Boot] Instantiating App...');


    window.app = window.__XXPD_APP__ = new App();


    console.log('[Boot] App successfully instantiated!');


  } catch (err) {


    console.error('[Boot Error]', err);


    window.__APP_BOOT_ERROR__ = { message: err.message, stack: err.stack };


  }


}


if (document.readyState === 'loading') {


  document.addEventListener('DOMContentLoaded', bootApp);


} else {


  bootApp();


}
