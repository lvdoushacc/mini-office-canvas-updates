/**
 * 小小办公 本地存储管理器 (不接网络、纯本地持久化)
 */
const STORAGE_KEY_WORKSPACE = 'xxdp_workspace_name';
const STORAGE_KEY_FIRST_LAUNCH = 'xxdp_first_launch_time';
const STORAGE_KEY_THEME = 'xxdp_theme';

export const store = {
  /**
   * 获取当前保存的主题 ('dark' | 'light')
   */
  getTheme() {
    try {
      const t = localStorage.getItem(STORAGE_KEY_THEME) || localStorage.getItem('studio_theme') || localStorage.getItem('canvas_theme');
      return (t === 'light') ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  },

  /**
   * 持久化保存主题
   */
  setTheme(theme) {
    const validTheme = (theme === 'light') ? 'light' : 'dark';
    try {
      localStorage.setItem(STORAGE_KEY_THEME, validTheme);
      localStorage.setItem('studio_theme', validTheme);
      localStorage.setItem('canvas_theme', validTheme);
      return true;
    } catch (e) {
      console.error('保存主题失败', e);
      return false;
    }
  },

  /**
   * 获取当前保存的工作空间名称
   * @returns {string|null}
   */
  getWorkspaceName() {
    try {
      return localStorage.getItem(STORAGE_KEY_WORKSPACE);
    } catch (e) {
      console.warn('读取本地存储失败', e);
      return null;
    }
  },

  /**
   * 保存工作空间名称
   * @param {string} name
   */
  setWorkspaceName(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return false;
    try {
      localStorage.setItem(STORAGE_KEY_WORKSPACE, trimmed);
      if (!localStorage.getItem(STORAGE_KEY_FIRST_LAUNCH)) {
        localStorage.setItem(STORAGE_KEY_FIRST_LAUNCH, new Date().toISOString());
      }
      return true;
    } catch (e) {
      console.error('保存本地工作空间失败', e);
      return false;
    }
  },

  /**
   * 检查是否已完成首次配置
   * @returns {boolean}
   */
  /** 主机名字（与工作空间名同一落盘键，兼容旧数据） */
  getHostName() {
    return this.getWorkspaceName();
  },

  setHostName(name) {
    return this.setWorkspaceName(name);
  },

  hasConfiguredWorkspace() {
    const name = this.getWorkspaceName();
    return typeof name === 'string' && name.trim().length > 0;
  },

  /**
   * 清除工作空间配置（方便复测首次启动效果）
   */
  resetWorkspace() {
    try {
      localStorage.removeItem(STORAGE_KEY_WORKSPACE);
      localStorage.removeItem(STORAGE_KEY_FIRST_LAUNCH);
    } catch (e) {
      console.error('重置存储失败', e);
    }
  },

  /**
   * 获取指定项目画布持久化数据
   * @param {string} projectName 
   * @returns {{nodes: Array, connections: Array}|null}
   */
  getProjectCanvas(projectName) {
    try {
      const key = `xxdp_canvas_${encodeURIComponent(projectName || 'default')}`;
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.warn('读取项目画布数据失败', e);
      return null;
    }
  },

  /**
   * 持久化保存指定项目画布数据
   * @param {string} projectName 
   * @param {{nodes: Array, connections: Array}} canvasData 
   * @returns {boolean}
   */
  saveProjectCanvas(projectName, canvasData) {
    try {
      const key = `xxdp_canvas_${encodeURIComponent(projectName || 'default')}`;
      localStorage.setItem(key, JSON.stringify(canvasData));
      return true;
    } catch (e) {
      console.error('保存项目画布数据失败', e);
      return false;
    }
  }
};

