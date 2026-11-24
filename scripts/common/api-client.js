/**
 * 小小办公 - AI 生成 API 客户端 (API Client)
 * 复用并适配成熟的 XXDP 图片与视频任务、轮询协议及安全防护机制
 */

// 图片比例与对应宽高映射 (优先常用比例，适配主流文生图标准)
export const RATIO_SIZES = {
  '1:1': { width: 1024, height: 1024, label: '1:1 正方形' },
  '16:9': { width: 1792, height: 1024, label: '16:9 横版宽屏' },
  '9:16': { width: 1024, height: 1792, label: '9:16 竖版构图' },
  '4:3': { width: 1152, height: 896, label: '4:3 传统横版' },
  '3:4': { width: 896, height: 1152, label: '3:4 经典人像' }
};

// 视频模型参数能力 Schema 映射 (按模型动态限制比例、时长、分辨率与图生视频支持)
export const VIDEO_MODEL_SCHEMAS = {
  'doubao-seedance-2-5-260628': {
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    durations: [-1, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30],
    resolutions: ['480p', '720p', '1080p'],
    supportsImage: true,
    supportsText: true,
    supportsOmni: true,
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
    defaultRatio: '16:9',
    defaultDuration: 5,
    defaultResolution: '720p'
  },
  'doubao-seedance-2-0-260128': {
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    durations: [-1, 4, 5, 6, 8, 10, 12, 15],
    resolutions: ['480p', '720p', '1080p'],
    supportsImage: true,
    supportsText: true,
    supportsOmni: false,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    defaultRatio: '16:9',
    defaultDuration: 5,
    defaultResolution: '720p'
  },
  'doubao-seedance-2-0-fast-260128': {
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    durations: [-1, 4, 5, 6, 8, 10, 12, 15],
    resolutions: ['480p', '720p'],
    supportsImage: true,
    supportsText: true,
    supportsOmni: false,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    defaultRatio: '16:9',
    defaultDuration: 5,
    defaultResolution: '720p'
  },
  'MiniMax-H3': {
    ratios: ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'],
    durations: [4, 5, 6, 8, 10, 12, 15],
    resolutions: ['768P', '2K'],
    supportsImage: true,
    supportsText: true,
    supportsOmni: true,
    defaultRatio: '16:9',
    defaultDuration: 5,
    defaultResolution: '768P'
  },
  'MiniMax-H3-Max': {
    ratios: ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'],
    durations: [5, 6, 8, 10, 12, 15],
    resolutions: ['480P', '768P'],
    supportsImage: true,
    supportsText: true,
    supportsOmni: false,
    defaultRatio: '16:9',
    defaultDuration: 5,
    defaultResolution: '768P'
  },
  'hailuo-h3-cankaosheng': {
    ratios: ['16:9', '9:16', '1:1'],
    durations: [6],
    resolutions: ['720p'],
    supportsImage: true,
    supportsText: false,
    defaultRatio: '16:9',
    defaultDuration: 6,
    defaultResolution: '720p'
  },
  'veo3.1-fast': {
    ratios: ['16:9', '9:16', '1:1'],
    durations: [5, 8],
    resolutions: ['720p', '1080p'],
    supportsImage: true,
    supportsText: true,
    defaultRatio: '16:9',
    defaultDuration: 5,
    defaultResolution: '720p'
  },
  'veo3-fast': {
    ratios: ['16:9', '9:16', '1:1'],
    durations: [5],
    resolutions: ['720p', '1080p'],
    supportsImage: true,
    supportsText: true,
    defaultRatio: '16:9',
    defaultDuration: 5,
    defaultResolution: '720p'
  },
  'sora-2': {
    ratios: ['16:9', '9:16'],
    durations: [4, 8, 12],
    resolutions: ['720p'],
    supportsImage: true,
    supportsText: true,
    defaultRatio: '16:9',
    defaultDuration: 8,
    defaultResolution: '720p'
  },
  'sora-2-pro': {
    ratios: ['16:9', '9:16'],
    durations: [4, 8, 12],
    resolutions: ['720p', '1080p'],
    supportsImage: true,
    supportsText: true,
    defaultRatio: '16:9',
    defaultDuration: 8,
    defaultResolution: '720p'
  },
  'default': {
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    durations: [5, 10],
    resolutions: ['720p', '1080p'],
    supportsImage: true,
    supportsText: true,
    defaultRatio: '16:9',
    defaultDuration: 5,
    defaultResolution: '720p'
  }
};

export function getVideoModelSchema(modelId) {
  if (!modelId) return VIDEO_MODEL_SCHEMAS['default'];
  return VIDEO_MODEL_SCHEMAS[modelId] || VIDEO_MODEL_SCHEMAS['default'];
}

/** 任务状态 -> 面向非技术用户的短文案 */
export const TASK_STATUS_LABELS = {
  queued: '排队中',
  running: '处理中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消'
};

export function getTaskStatusLabel(status) {
  const key = String(status || '').toLowerCase();
  return TASK_STATUS_LABELS[key] || (status ? String(status) : '未知');
}


class ApiClient {
  constructor() {
    this.configCache = null;
    this.configPromise = null;
    this.availableImageModels = [];
    this.availableVideoModels = [];
  }

  /**
   * 拉取并解析服务端 AI 配置
   * @param {boolean} forceRefresh 
   */
  async getConfig(forceRefresh = false) {
    if (this.configCache && !forceRefresh) {
      return this.configCache;
    }
    if (this.configPromise && !forceRefresh) {
      return this.configPromise;
    }

    this.configPromise = (async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) {
          throw new Error(`无法获取服务配置 (HTTP ${res.status})`);
        }
        const cfg = await res.json();
        this.configCache = cfg;
        this.parseAvailableImageModels(cfg);
        this.parseAvailableVideoModels(cfg);
        return cfg;
      } catch (e) {
        console.warn('[ApiClient] 拉取配置失败，使用默认配置:', e);
        return {
          api_providers: [
            { id: 'custom-api', name: 'APImart.', image_models: ['gpt-image-2'], video_models: [] },
            { id: 'volcengine', name: '火山引擎', image_models: [], video_models: ['doubao-seedance-2-5-260628'] },
            { id: 'custom-api-3', name: 'minimax', image_models: [], video_models: ['MiniMax-H3', 'MiniMax-H3-Max'] }
          ]
        };
      } finally {
        this.configPromise = null;
      }
    })();

    return this.configPromise;
  }

  /**
   * 从配置中提炼用户真正可用的图片生成模型列表
   */
  parseAvailableImageModels(cfg) {
    const models = [];
    const providers = Array.isArray(cfg?.api_providers) ? cfg.api_providers : [];

    providers.forEach(p => {
      if (p.enabled === false) return;
      const imgModels = Array.isArray(p.image_models) ? p.image_models : [];
      imgModels.forEach(m => {
        const modelName = p.model_names?.[m] || m;
        models.push({
          id: m,
          name: `${modelName} (${p.name || p.id})`,
          rawName: modelName,
          providerId: p.id,
          providerName: p.name || p.id
        });
      });
    });

    if (models.length === 0) {
      models.push({
        id: 'gpt-image-2',
        name: 'gpt-image-2 (APImart.)',
        rawName: 'gpt-image-2',
        providerId: 'custom-api',
        providerName: 'APImart.'
      });
    }

    this.availableImageModels = models;
    return models;
  }

  /**
   * 从配置中提炼用户真正可用的视频生成模型列表 (严格对齐真实模型)
   */
  parseAvailableVideoModels(cfg) {
    const models = [];
    const providers = Array.isArray(cfg?.api_providers) ? cfg.api_providers : [];

    // 1. 遍历配置了 video_models 的活跃供应商
    providers.forEach(p => {
      if (p.enabled === false) return;
      const vidModels = Array.isArray(p.video_models) ? p.video_models : [];
      vidModels.forEach(m => {
        const modelName = p.model_names?.[m] || m;
        models.push({
          id: m,
          name: `${modelName} (${p.name || p.id})`,
          rawName: modelName,
          providerId: p.id,
          providerName: p.name || p.id,
          schema: getVideoModelSchema(m)
        });
      });
    });

    // 2. 如果供应商中未声明专属 video_models，从公共支持模型补充
    if (models.length === 0) {
      const publicVideoModels = Array.isArray(cfg?.video_models) && cfg.video_models.length > 0
        ? cfg.video_models
        : ['doubao-seedance-2-5-260628', 'veo3-fast', 'MiniMax-H3', 'MiniMax-H3-Max'];

      publicVideoModels.forEach(m => {
        models.push({
          id: m,
          name: `${m} (默认服务)`,
          rawName: m,
          providerId: 'volcengine',
          providerName: '火山引擎',
          schema: getVideoModelSchema(m)
        });
      });
    }

    this.availableVideoModels = models;
    return models;
  }

  /**
   * 获取当前可用的图片模型列表
   */
  async getAvailableImageModels() {
    if (this.availableImageModels.length === 0) {
      await this.getConfig();
    }
    return this.availableImageModels;
  }

  /**
   * 获取当前可用的视频模型列表
   */
  async getAvailableVideoModels() {
    if (this.availableVideoModels.length === 0) {
      await this.getConfig();
    }
    return this.availableVideoModels;
  }

  /**
   * 提交异步图片生成任务
   */
  async createImageTask(params) {
    const {
      prompt,
      providerId = 'custom-api',
      model = 'gpt-image-2',
      ratio = '16:9',
      resolution = '2k',
      quality = 'auto',
      count = 1,
      referenceImages = []
    } = params;

    const trimmedPrompt = (prompt || '').trim();
    if (!trimmedPrompt) {
      throw new Error('请输入图片生成提示词');
    }

    const ratioMeta = RATIO_SIZES[ratio] || RATIO_SIZES['16:9'];
    const sizeStr = `${ratioMeta.width}x${ratioMeta.height}`;

    const formattedRefs = (referenceImages || []).map(ref => {
      if (typeof ref === 'string') return { url: ref, role: 'reference', name: '参考图' };
      return { url: ref.url || '', name: ref.name || '参考图', role: ref.role || 'reference' };
    }).filter(r => Boolean(r.url));

    const payload = {
      prompt: trimmedPrompt,
      scope_id: '',
      provider_id: providerId,
      model: model,
      size: sizeStr,
      width: ratioMeta.width,
      height: ratioMeta.height,
      aspect_ratio: ratio,
      resolution: resolution,
      quality: quality,
      n: Math.max(1, Number(count) || 1),
      reference_images: formattedRefs
    };

    const res = await fetch('/api/canvas-image-tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      let errorMsg = '生成任务提交失败';
      try {
        const parsed = JSON.parse(errText);
        errorMsg = parsed.detail || parsed.message || errorMsg;
      } catch (_) {
        if (errText) errorMsg = errText.slice(0, 200);
      }
      throw new Error(this.friendlyError(errorMsg));
    }

    const data = await res.json();
    return {
      taskId: data.task_id,
      status: data.status || 'queued'
    };
  }

  /**
   * 轮询检查图片任务状态
   */
  async pollImageTask(taskId, options = {}) {
    const { onProgress, signal } = options;
    if (!taskId) throw new Error('任务 ID 为空');

    const maxAttempts = 300;
    const intervalMs = 1500;

    for (let i = 0; i < maxAttempts; i++) {
      if (signal?.aborted) {
        throw new Error('用户已停止生成');
      }

      await new Promise(r => setTimeout(r, intervalMs));

      if (signal?.aborted) {
        throw new Error('用户已停止生成');
      }

      let res;
      try {
        res = await fetch(`/api/canvas-image-tasks/${encodeURIComponent(taskId)}`, { signal });
      } catch (e) {
        if (signal?.aborted) throw new Error('用户已停止生成');
        continue;
      }

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('任务已过期或不存在');
        }
        continue;
      }

      const task = await res.json();
      const status = task.status;

      const statusLabel = getTaskStatusLabel(status);
      const progressText = task.progress_text || task.message || (
        status === 'running' ? '处理中，正在生成图片…' :
        status === 'queued' ? '排队中，等待处理…' :
        statusLabel
      );
      if (onProgress) {
        onProgress(status, progressText, { statusLabel, progress: task.progress ?? null, task });
      }

      if (status === 'cancelled') {
        throw new Error('用户已停止生成');
      }

      if (status === 'succeeded') {
        const result = task.result || {};
        const images = result.images || [];
        const imageUrl = images[0] || (result.image_items?.[0]?.url) || '';

        if (!imageUrl) {
          throw new Error('接口未返回生成的图片资源');
        }

        return {
          status: 'succeeded',
          imageUrl: imageUrl,
          taskId: taskId,
          model: task.model || result.model || '',
          providerId: task.provider_id || result.provider_id || '',
          prompt: result.prompt || '',
          rawResult: result
        };
      }

      if (status === 'failed') {
        const detail = task.error || '图片生成遇到错误';
        throw new Error(this.friendlyError(detail));
      }
    }

    throw new Error('生成等待超时，请稍后重试');
  }

  /**
   * 便捷图片生成方法 (提交任务并等待轮询完成)
   */
  async generateImage(params) {
    const { prompt, providerId, model, ratio, resolution, quality, count, referenceImages, imageUrl, signal } = params;
    const refs = Array.isArray(referenceImages) ? [...referenceImages] : [];
    if (imageUrl && !refs.some(r => (typeof r === 'string' ? r : r.url) === imageUrl)) {
      refs.unshift({ url: imageUrl, role: 'reference', name: '上游图片' });
    }
    const task = await this.createImageTask({
      prompt,
      providerId,
      model,
      ratio,
      resolution,
      quality,
      count,
      referenceImages: refs
    });
    try {
      return await this.pollImageTask(task.taskId, { signal, onProgress: params.onProgress });
    } catch (err) {
      if (signal?.aborted) {
        await this.cancelImageTask(task.taskId);
      }
      throw err;
    }
  }

  /**
   * 提交异步视频生成任务
   * @param {Object} params
   */
  async createVideoTask(params) {
    const {
      prompt,
      providerId = 'volcengine',
      model = 'doubao-seedance-2-5-260628',
      ratio = '16:9',
      duration = 5,
      resolution = '720p',
      images = [],
      cameraFixed = false,
      enhancePrompt = false,
      enableUpsample = false,
      watermark = false,
      generateAudio = false,
      multimodal = false
    } = params;

    const trimmedPrompt = (prompt || '').trim();
    if (!trimmedPrompt) {
      throw new Error('请输入视频生成提示词');
    }

    const formattedImages = (images || []).map(img => {
      if (typeof img === 'string') return { url: img, role: 'first_frame', name: '素材' };
      return {
        url: img.url || '',
        name: img.name || '素材',
        role: img.role || 'first_frame'
      };
    }).filter(img => Boolean(img.url));

    const payload = {
      prompt: trimmedPrompt,
      scope_id: '',
      provider_id: providerId,
      model: model,
      aspect_ratio: ratio,
      duration: Number(duration) === -1 ? -1 : (Number(duration) || 5),
      resolution: resolution || '',
      images: formattedImages,
      camerafixed: Boolean(cameraFixed),
      enhance_prompt: Boolean(enhancePrompt),
      enable_upsample: Boolean(enableUpsample),
      watermark: Boolean(watermark),
      generate_audio: Boolean(generateAudio),
      multimodal: Boolean(multimodal),
      test_mode: params.test_mode !== undefined ? Boolean(params.test_mode) : (params.testMode !== undefined ? Boolean(params.testMode) : true)
    };

    const res = await fetch('/api/canvas-video-tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      let errorMsg = '视频任务提交失败';
      try {
        const parsed = JSON.parse(errText);
        errorMsg = parsed.detail || parsed.message || errorMsg;
      } catch (_) {
        if (errText) errorMsg = errText.slice(0, 200);
      }
      throw new Error(this.friendlyError(errorMsg));
    }

    const data = await res.json();
    return {
      taskId: data.task_id,
      status: data.status || 'queued'
    };
  }

  /**
   * 轮询检查视频任务状态 (支持真实进度百分比展示，无假进度)
   * @param {string} taskId 
   * @param {Object} options 
   */
  async pollVideoTask(taskId, options = {}) {
    const { onProgress, signal } = options;
    if (!taskId) throw new Error('视频任务 ID 为空');

    const maxAttempts = 600; // 最多轮询 ~15 分钟
    const intervalMs = 1500;

    for (let i = 0; i < maxAttempts; i++) {
      if (signal?.aborted) {
        throw new Error('用户已停止生成');
      }

      await new Promise(r => setTimeout(r, intervalMs));

      if (signal?.aborted) {
        throw new Error('用户已停止生成');
      }

      let res;
      try {
        res = await fetch(`/api/canvas-video-tasks/${encodeURIComponent(taskId)}`, { signal });
      } catch (e) {
        if (signal?.aborted) throw new Error('用户已停止生成');
        continue;
      }

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('视频任务已过期或不存在');
        }
        continue;
      }

      const task = await res.json();
      const status = task.status;
      const progress = typeof task.progress === 'number' ? task.progress : null;
      const statusLabel = getTaskStatusLabel(status);
      const progressText = task.progress_text || (
        status === 'running' ? '处理中…' :
        status === 'queued' ? '排队中…' :
        statusLabel
      );

      if (onProgress) {
        onProgress(status, progress, progressText, { statusLabel, task });
      }

      if (status === 'succeeded') {
        const result = task.result || {};
        const videos = result.videos || [];
        const videoUrl = videos[0] || result.video_url || '';

        if (!videoUrl) {
          throw new Error('接口未返回生成的视频资源');
        }

        return {
          status: 'succeeded',
          videoUrl: videoUrl,
          videos: videos.length ? videos : [videoUrl],
          taskId: taskId,
          model: task.model || result.model || '',
          providerId: task.provider_id || result.provider_id || '',
          prompt: task.prompt || result.prompt || '',
          duration: result.duration || 5,
          aspectRatio: result.aspect_ratio || '16:9',
          rawResult: result
        };
      }

      if (status === 'cancelled') {
        throw new Error('用户已停止生成');
      }

      if (status === 'failed') {
        const detail = task.error || '视频生成遇到错误';
        throw new Error(this.friendlyError(detail));
      }
    }

    throw new Error('视频生成等待超时，请稍后重试');
  }

  /**
   * 便捷视频生成方法 (提交任务并等待轮询完成)
   */
  async generateVideo(params) {
    const {
      prompt,
      providerId,
      model,
      duration,
      ratio,
      resolution,
      cameraFixed,
      enhancePrompt,
      enableUpsample,
      watermark,
      generateAudio,
      multimodal,
      images,
      imageUrl,
      signal
    } = params;

    let finalImages = Array.isArray(images) ? [...images] : [];
    if (imageUrl && !finalImages.length) {
      finalImages.push({ role: 'first_frame', url: imageUrl });
    }

    const task = await this.createVideoTask({
      prompt,
      providerId,
      model,
      duration,
      ratio,
      resolution,
      cameraFixed,
      enhancePrompt,
      enableUpsample,
      watermark,
      generateAudio,
      multimodal,
      images: finalImages
    });
    return await this.pollVideoTask(task.taskId, { signal });
  }

  /**
   * 取消指定的视频任务
   * @param {string} taskId 
   */
  async cancelVideoTask(taskId) {
    if (!taskId) return;
    try {
      await fetch(`/api/canvas-video-tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
    } catch (_) {}
  }

  /**
   * 取消指定的图片任务
   * @param {string} taskId
   */
  async cancelImageTask(taskId) {
    if (!taskId) return;
    try {
      await fetch(`/api/canvas-image-tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
    } catch (_) {}
  }

  /**
   * 对瞬时网络失败做有限次重试（不重试业务错误）
   * @param {Function} fn
   * @param {{ retries?: number, delayMs?: number, signal?: AbortSignal }} options
   */
  async withRetry(fn, options = {}) {
    const retries = Math.max(0, Number(options.retries) || 2);
    const delayMs = Math.max(200, Number(options.delayMs) || 800);
    const signal = options.signal;
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) {
        throw new Error('用户已停止生成');
      }
      try {
        return await fn(attempt);
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || err || '');
        const transient = /网络|超时|timeout|failed to fetch|econnrefused|502|503|504/i.test(msg);
        if (!transient || attempt >= retries) {
          throw err;
        }
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
    throw lastError;
  }

  /**
   * 将接口原始错误转为尽量友好的用户提示
   */
  friendlyError(errStr) {
    const text = String(errStr || '').trim();
    if (!text) return '生成失败，请重试';

    if (/unauthorized|api[_ -]?key|401|authentication/i.test(text)) {
      return 'API Key 无效或未授权，请检查模型密钥';
    }
    if (/timeout|timed? out|504/i.test(text)) {
      return '服务超时，上游响应超时，请重试';
    }
    if (/rate limit|too many requests|429/i.test(text)) {
      return '请求频率超限，请稍候再试';
    }
    if (/safety|content policy|sensitive|nsfw|block/i.test(text)) {
      return '提示词触发了模型安全审核，请调整描述';
    }
    if (/not.?found|does not exist|InvalidEndpointOrModel|404/i.test(text)) {
      return '模型不可用或未部署，请切换可用模型';
    }
    if (/insufficient_quota|quota|balance|credit|402/i.test(text)) {
      return '模型账户余额不足或额度耗尽';
    }
    if (/connection refused|econnrefused|502|failed to fetch|net::/i.test(text)) {
      return '连接失败，无法连接上游 API 服务';
    }
    if (/invalid.?param|422|validation|invalid size/i.test(text)) {
      return '参数错误，当前模型不支持所选尺寸或参数';
    }
    if (/upload|tos|oss|s3|上传/i.test(text)) {
      return '上传失败，参考图或素材上传异常';
    }
    if (/task.?failed|failed to generate|任务失败/i.test(text)) {
      return '任务失败，上游模型处理失败';
    }
    if (/安全防护|免计费保护模式/i.test(text)) {
      return text;
    }

    try {
      const match = text.match(/"message"\s*:\s*"([^"]+)"/);
      if (match && match[1]) {
        const msg = match[1].replace(/https?:\/\/\S+/g, '').trim();
        return msg.length > 50 ? msg.slice(0, 50) + '…' : msg;
      }
    } catch (_) {}

    const sanitized = text.replace(/[{}[\]"\\]/g, '').replace(/https?:\/\/\S+/g, '').replace(/^[^\w\u4e00-\u9fa5]+/, '').trim();
    if (sanitized && sanitized.length <= 50 && !sanitized.includes('Traceback')) {
      return sanitized;
    }
    return '生成遇到异常，请检查网络或切换模型后重试';
  }
}

export const apiClient = new ApiClient();
