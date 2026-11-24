/**
 * canvas-utils.js —— 智能画布纯工具与媒体工具层（画布拆分第 2 阶段）
 *
 * 这里只放不触碰画布状态的函数：HTML 转义、媒体 URL 解析、媒体类型判定、
 * 文件名处理、剪贴板、下载、尺寸/比例计算与格式化。
 * 不读写 nodes / canvas / viewport / settings，不调用 render / saveCanvas。
 *
 * 加载顺序：必须在 smart-canvas.js 之前加载。本文件在解析期不读取主文件
 * 的任何全局，因此先加载是安全的；主文件保留同名兼容包装函数。
 * 对外只暴露 window.SmartCanvasUtils，不污染其它全局名。
 */
(function attachSmartCanvasUtils(globalScope) {

    // ===== HTML 转义 =====
    function escapeHtml(str){ return String(str == null ? '' : str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }

    // ===== 媒体 URL 解析 =====
    function smartOriginalMediaUrl(itemOrUrl){
        const raw = typeof itemOrUrl === 'string' ? itemOrUrl : (itemOrUrl?.url || '');
        const text = String(raw || '');
        if(!text) return '';
        // 兼容旧画布只保存文件名（如 online_xxx.png）的结果记录。
        // 裸文件名会被浏览器解析到 /static 下，必须还原为输出目录 URL。
        if(!/^[a-z]+:\/\//i.test(text) && !text.startsWith('/') && !text.startsWith('data:') && !text.startsWith('blob:') && /^(?:online_|ai_ref_|output_)[^/]+\.(?:png|jpe?g|webp|gif|bmp|avif|tiff?)$/i.test(text)){
            return `/output/${encodeURIComponent(text)}`;
        }
        try {
            const parsed = new URL(text, window.location.origin);
            if(parsed.pathname === '/api/media-preview'){
                const original = parsed.searchParams.get('url') || '';
                return original || text;
            }
        } catch(e) {}
        return text;
    }
    function smartMediaPreviewUrl(itemOrUrl, size=512){
        const raw = smartOriginalMediaUrl(itemOrUrl);
        const displayItem = typeof itemOrUrl === 'object' && itemOrUrl ? {...itemOrUrl, url:raw} : raw;
        const displayUrl = displayMediaUrl(displayItem);
        if(!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return displayUrl;
        if(!raw.startsWith('/output/') && !raw.startsWith('/assets/')) return displayUrl;
        if(!/\.(png|jpe?g|webp|gif|bmp|avif|tiff?|mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(raw)) return displayUrl;
        const width = Math.max(64, Math.min(2048, Math.round(Number(size) || 512)));
        return typeof window.__xxdpLanRouteResource === 'function'
            ? window.__xxdpLanRouteResource(`/api/media-preview?w=${width}&url=${encodeURIComponent(raw)}`)
            : `/api/media-preview?w=${width}&url=${encodeURIComponent(raw)}`;
    }
    function sameMediaSrc(a, b){
        const left = String(a || '');
        const right = String(b || '');
        if(!left || !right) return false;
        if(left === right) return true;
        try {
            return new URL(left, location.href).href === new URL(right, location.href).href;
        } catch(e) {
            return false;
        }
    }
    function localDisplayUrlForMediaItem(img){
        if(!img) return '';
        const candidates = [
            img.originalLocalUrl,
            img.localUrl,
            img.sourceUrl,
            img.local_url,
            img.source_url,
            img.url
        ];
        const local = candidates.find(url => url && !/^https?:\/\//i.test(String(url)));
        return local || img.url || '';
    }
    function imageForDisplay(img){
        if(!img || typeof img !== 'object') return img;
        const localUrl = localDisplayUrlForMediaItem(img);
        if(!localUrl || localUrl === img.url) return img;
        return {
            ...img,
            url:localUrl,
            originalLocalUrl:img.originalLocalUrl || localUrl
        };
    }
    function looksLikeImageMediaUrl(url){
        const text = String(url || '').trim().toLowerCase();
        if(!text) return false;
        if(text.startsWith('data:image/')) return true;
        if(text.startsWith('asset://')) return false;
        const path = text.split('?', 1)[0].split('#', 1)[0];
        return /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(path);
    }
    function isRemoteVideoReferenceUrl(url){
        return /^https?:\/\//i.test(String(url || '')) || /^asset:\/\//i.test(String(url || ''));
    }
    function outputUrlLooksVideo(url){
        return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(smartOriginalMediaUrl(url).toLowerCase());
    }
    function proxiedMediaUrl(itemOrUrl, name=''){
        const url = smartOriginalMediaUrl(itemOrUrl);
        if(!url || String(url).startsWith('/assets/') || String(url).startsWith('/output/') || String(url).startsWith('data:') || String(url).startsWith('blob:')) return url;
        const filename = name || (typeof itemOrUrl === 'object' ? (itemOrUrl.name || '') : '') || fileNameFromUrl(url) || 'preview';
        return `/api/download-output?inline=1&url=${encodeURIComponent(url)}&name=${encodeURIComponent(filename)}`;
    }
    function displayMediaUrl(itemOrUrl, name=''){
        const url = smartOriginalMediaUrl(itemOrUrl);
        const resolved = /^https?:\/\//i.test(String(url || '')) ? proxiedMediaUrl(itemOrUrl, name) : url;
        return typeof window.__xxdpLanRouteResource === 'function'
            ? window.__xxdpLanRouteResource(resolved)
            : resolved;
    }
    function browserCanPlayHevc(){
        if(typeof browserCanPlayHevc._ok === 'boolean') return browserCanPlayHevc._ok;
        try {
            const probe = document.createElement('video');
            const types = [
                'video/mp4; codecs="hvc1"',
                'video/mp4; codecs="hev1"',
                'video/mp4; codecs="hvc1.1.6.L93.B0"',
                'video/mp4; codecs="hvc1.2.4.L153.B0"'
            ];
            browserCanPlayHevc._ok = types.some(type => {
                const result = probe.canPlayType(type);
                return result === 'probably' || result === 'maybe';
            });
        } catch(e) {
            browserCanPlayHevc._ok = false;
        }
        return browserCanPlayHevc._ok;
    }
    function isLocalCanvasMediaUrl(url){
        const text = String(url || '').split('#')[0].split('?')[0];
        return text.startsWith('/output/') || text.startsWith('/assets/') || text.startsWith('/api/storage-files/');
    }
    function playbackVideoUrl(url, forceCompat=false){
        const original = smartOriginalMediaUrl(url);
        const raw = String(original || '');
        const hashIdx = raw.indexOf('#');
        const hash = hashIdx >= 0 ? raw.slice(hashIdx) : '';
        const base = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).split('?')[0];
        if(!base || base.startsWith('data:') || base.startsWith('blob:') || base.includes('/api/video-playback')){
            return displayMediaUrl({url:original});
        }
        if(!isLocalCanvasMediaUrl(base) || !outputUrlLooksVideo(base)){
            return displayMediaUrl({url:original});
        }
        if(!forceCompat && browserCanPlayHevc()) return displayMediaUrl({url:original});
            const fallback = `/api/video-playback?url=${encodeURIComponent(base)}${hash}`;
            return typeof window.__xxdpLanRouteResource === 'function'
                ? window.__xxdpLanRouteResource(fallback)
                : fallback;
    }

    // ===== 媒体尺寸缓存 =====
    function loadSmartOriginalImageDimensions(url){
        const src = displayMediaUrl({url:smartOriginalMediaUrl(url)});
        if(!src || /^data:/i.test(src) || /^blob:/i.test(src)) return Promise.resolve(null);
        if(!window.__smartMediaDimensionCache) window.__smartMediaDimensionCache = new Map();
        const cache = window.__smartMediaDimensionCache;
        if(cache.has(src)) return cache.get(src);
        const promise = new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? {w:img.naturalWidth, h:img.naturalHeight} : null);
            img.onerror = () => resolve(null);
            img.src = src;
        });
        cache.set(src, promise);
        return promise;
    }

    // ===== 媒体类型判定 =====
    function isVideoMediaItem(img){
        if(!img) return false;
        if(img.kind === 'video') return true;
        const name = String(img.name || img.title || img.filename || '').toLowerCase();
        if(/\.(mp4|webm|mov|m4v|avi|mkv|flv|wmv)(\?|$)/i.test(name)) return true;
        const url = smartOriginalMediaUrl(img).toLowerCase();
        return /\.(mp4|webm|mov|m4v|avi|mkv|flv|wmv)(\?|$)/i.test(url);
    }
    function isInlineVideoActive(img){
        return Boolean(img && img._inlineVideoActive);
    }
    function isAudioMediaItem(img){
        if(!img) return false;
        if(img.kind === 'audio') return true;
        const name = String(img.name || img.title || img.filename || '').toLowerCase();
        if(/\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(name)) return true;
        const url = smartOriginalMediaUrl(img).toLowerCase();
        return /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(url);
    }
    function isTextMediaItem(img){
        if(!img) return false;
        if(img.kind === 'text') return true;
        const name = String(img.name || img.title || img.filename || '').toLowerCase();
        if(/\.(txt|json|csv|srt|vtt|md)(\?|$)/i.test(name)) return true;
        const url = smartOriginalMediaUrl(img).toLowerCase();
        return /\.(txt|json|csv|srt|vtt|md)(\?|$)/i.test(url);
    }
    function isFileMediaItem(img){
        if(!img) return false;
        return img.kind === 'file';
    }
    function mediaKindForFile(file){
        const type = String(file?.type || '').toLowerCase();
        const name = String(file?.name || file?.filename || '').toLowerCase();
        if(type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv|flv|wmv)(\?|$)/i.test(name)) return 'video';
        if(type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(name)) return 'audio';
        if(type.startsWith('text/') || /\.(txt|json|csv|srt|vtt|md)(\?|$)/i.test(name)) return 'text';
        return 'image';
    }
    function mediaKindForItem(img){
        if(isFileMediaItem(img)) return 'file';
        if(isTextMediaItem(img)) return 'text';
        if(isAudioMediaItem(img)) return 'audio';
        if(isVideoMediaItem(img)) return 'video';
        return 'image';
    }

    // ===== 文件名处理 =====
    function imageResolutionLabel(img){
        const w = Number(img?.natural_w || img?.width || img?.w || 0);
        const h = Number(img?.natural_h || img?.height || img?.h || 0);
        return w > 0 && h > 0 ? `${Math.round(w)} x ${Math.round(h)}` : '';
    }
    function imageNameLabel(img, fallback='image'){
        const raw = String(img?.name || fileNameFromUrl(img?.url || '') || fallback || 'image').trim();
        return raw || 'image';
    }
    function safeExportFileName(name, fallback='download.zip'){
        const cleaned = String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim();
        return cleaned || fallback;
    }
    function fileNameFromUrl(url=''){
        try {
            const parsed = new URL(String(url || ''), window.location.href);
            return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
        } catch(e) {
            return decodeURIComponent(String(url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '');
        }
    }
    function isMachineGeneratedMediaName(str=''){
        if(!str) return true;
        const base = String(str).split('?')[0].split('#')[0].split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,8}$/i, '').trim();
        if(!base) return true;
        if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) return true;
        if(/^\d{10,14}(?:_[0-9a-fA-F-]+)?$/i.test(base)) return true;
        if(/^[0-9a-fA-F]{24,}$/i.test(base)) return true;
        return false;
    }
    function cleanMediaBaseName(rawName, fallback='素材'){
        if(!rawName) return fallback;
        let name = String(rawName).trim();
        name = name.split('?')[0].split('#')[0];
        name = name.split(/[\\/]/).filter(Boolean).pop() || '';
        name = name.replace(/\.[a-z0-9]{2,8}$/i, '').trim();

        if(!name || isMachineGeneratedMediaName(name)){
            return fallback;
        }

        name = name.replace(/^\d{10,14}[_-]/, '');
        name = name.replace(/^\d+[-_]\d+[\._]/, '');
        name = name.replace(/[-_](?:first|last|current)[-_]frame/gi, '');
        name = name.replace(/[-_]r\d+[-_]c\d+/gi, '');
        name = name.replace(/[-_]拆分组\d+/g, '');
        name = name.replace(/[-_]paint$/i, '');
        name = name.replace(/[-_]join$/i, '');
        name = name.replace(/[-_]resize(?:[-_]\d+pct)?$/i, '');
        name = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
        name = name.replace(/^[-_]+|[-_]+$/g, '');

        return name || fallback;
    }
    function escapeSemanticRegex(str){
        return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function appendSemanticActionSuffix(base, action, counter){
        const cleanBase = cleanMediaBaseName(base, '素材');
        const act = String(action || '').trim();
        if(!act) return cleanBase;

        if(counter !== undefined && counter !== null && String(counter).trim() !== ''){
            const stripped = cleanBase.replace(new RegExp(`[-_]${escapeSemanticRegex(act)}\\d*$`), '');
            return `${stripped}_${act}${counter}`;
        }

        const isFrameTag = /^(?:首帧|尾帧|当前帧|\d+(?:\.\d+)?s|\d+m\d+(?:\.\d+)?s)$/.test(act);
        if(isFrameTag){
            const sameTagRegex = new RegExp(`[-_]${escapeSemanticRegex(act)}(\\d*)$`);
            const sameMatch = cleanBase.match(sameTagRegex);
            if(sameMatch){
                const nextNum = sameMatch[1] ? parseInt(sameMatch[1], 10) + 1 : 2;
                const prefix = cleanBase.slice(0, sameMatch.index);
                return `${prefix}_${act}${nextNum}`;
            }
            const frameTagRegex = /[-_](?:首帧|尾帧|当前帧|\d+(?:\.\d+)?s|\d+m\d+(?:\.\d+)?s)(?:\d+)?$/;
            const stripped = cleanBase.replace(frameTagRegex, '');
            return `${stripped}_${act}`;
        }

        const actRegex = new RegExp(`[-_]${escapeSemanticRegex(act)}(\\d*)$`);
        const actMatch = cleanBase.match(actRegex);
        if(actMatch){
            const nextNum = actMatch[1] ? parseInt(actMatch[1], 10) + 1 : 2;
            const prefix = cleanBase.slice(0, actMatch.index);
            return `${prefix}_${act}${nextNum}`;
        }

        return `${cleanBase}_${act}`;
    }
    function extensionForMediaItem(item, fallback='.png'){
        const source = [item?.name, item?.url].map(value => String(value || '').split('?')[0].split('#')[0]).find(value => /\.[a-z0-9]{2,8}$/i.test(value));
        if(source) return source.match(/(\.[a-z0-9]{2,8})$/i)?.[1] || fallback;
        const kind = mediaKindForItem(item);
        if(kind === 'video') return '.mp4';
        if(kind === 'audio') return '.mp3';
        if(kind === 'text') return '.txt';
        return fallback;
    }
    function downloadNameForMediaItem(item, fallbackPrefix='canvas-output'){
        const ext = extensionForMediaItem(item);
        const itemName = String(item?.name || '').trim();
        const localName = fileNameFromUrl(item?.url || '').trim();

        let chosen = '';
        if(itemName && !isMachineGeneratedMediaName(itemName)){
            chosen = itemName;
        } else if(localName && !isMachineGeneratedMediaName(localName)){
            chosen = localName;
        } else if(itemName){
            const cleaned = cleanMediaBaseName(itemName, '');
            if(cleaned && cleaned !== '素材' && cleaned !== '图片' && cleaned !== '视频'){
                chosen = cleaned + ext;
            }
        }

        if(!chosen){
            const cleanPrefix = cleanMediaBaseName(fallbackPrefix, 'canvas-output');
            chosen = `${cleanPrefix}_${Date.now().toString().slice(-4)}${ext}`;
        }

        let name = safeExportFileName(chosen, `download${ext}`);
        if(!/\.[a-z0-9]{2,8}$/i.test(name)) name += ext;
        return name;
    }
    function smartImageNameFromUrl(url){
        try {
            const clean = String(url || '').split('?', 1)[0].split('#', 1)[0];
            return decodeURIComponent(clean.split('/').pop() || 'image');
        } catch(_) {
            return 'image';
        }
    }

    // ===== 剪贴板 =====
    function copyTextWithCopyEvent(value){
        let handled = false;
        const onCopy = event => {
            event.preventDefault();
            event.clipboardData?.setData('text/plain', value);
            handled = true;
        };
        document.addEventListener('copy', onCopy);
        try {
            return document.execCommand('copy') && handled;
        } catch(_) {
            return false;
        } finally {
            document.removeEventListener('copy', onCopy);
        }
    }
    function copyTextWithTextarea(value){
        let ta = null;
        try {
            ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            ta.style.top = '0';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus({preventScroll:true});
            ta.select();
            ta.setSelectionRange(0, ta.value.length);
            return document.execCommand('copy');
        } catch(_) {
            return false;
        } finally {
            ta?.remove();
        }
    }
    async function clipboardMatchesText(value){
        try {
            if(navigator.clipboard?.readText && window.isSecureContext){
                return (await navigator.clipboard.readText()) === value;
            }
        } catch(_) {}
        return null;
    }
    async function copyTextToClipboard(text){
        const value = String(text || '');
        if(!value) return false;
        if(copyTextWithCopyEvent(value) || copyTextWithTextarea(value)){
            const verified = await clipboardMatchesText(value);
            return verified !== false;
        }
        try {
            if(navigator.clipboard?.writeText && window.isSecureContext !== false){
                await navigator.clipboard.writeText(value);
                const verified = await clipboardMatchesText(value);
                return verified !== false;
            }
        } catch(_) {}
        return false;
    }

    // ===== 下载工具 =====
    function downloadBlob(blob, filename){
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'smart-canvas-workflow.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 800);
    }

    // ===== 尺寸/比例计算 =====
    function getSmartGhostDimensions(aspectRatio){
        const r = (typeof aspectRatio === 'number' && Number.isFinite(aspectRatio) && aspectRatio > 0) ? aspectRatio : 1;
        if(r >= 1){
            const w = Math.max(40, Math.min(220, Math.round(120 * Math.sqrt(r))));
            const h = Math.max(40, Math.round(w / r));
            return { width: w, height: h };
        } else {
            const h = Math.max(40, Math.min(220, Math.round(120 / Math.sqrt(r))));
            const w = Math.max(40, Math.round(h * r));
            return { width: w, height: h };
        }
    }
    function parseSmartAspectRatio(val){
        if(typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
        if(typeof val === 'string'){
            const match = val.match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
            if(match){
                const w = parseFloat(match[1]);
                const h = parseFloat(match[2]);
                if(w > 0 && h > 0) return w / h;
            }
            const num = parseFloat(val);
            if(Number.isFinite(num) && num > 0) return num;
        }
        return 1;
    }
    const STANDARD_IMAGE_RESOLUTIONS = {
        '1:1': {
            '1k': { width: 1024, height: 1024, label: '1K 标准' },
            '2k': { width: 2048, height: 2048, label: '2K 高清' },
            '4k': { width: 4096, height: 4096, label: '4K 超清' }
        },
        '16:9': {
            '1k': { width: 1344, height: 768, label: '1K 标准' },
            '2k': { width: 2560, height: 1440, label: '2K 高清' },
            '4k': { width: 3840, height: 2160, label: '4K 超清' }
        },
        '9:16': {
            '1k': { width: 768, height: 1344, label: '1K 标准' },
            '2k': { width: 1440, height: 2560, label: '2K 高清' },
            '4k': { width: 2160, height: 3840, label: '4K 超清' }
        },
        '4:3': {
            '1k': { width: 1152, height: 864, label: '1K 标准' },
            '2k': { width: 2048, height: 1536, label: '2K 高清' },
            '4k': { width: 3840, height: 2880, label: '4K 超清' }
        },
        '3:4': {
            '1k': { width: 864, height: 1152, label: '1K 标准' },
            '2k': { width: 1536, height: 2048, label: '2K 高清' },
            '4k': { width: 2880, height: 3840, label: '4K 超清' }
        },
        '21:9': {
            '1k': { width: 1536, height: 640, label: '1K 标准' },
            '2k': { width: 2560, height: 1080, label: '2K 高清' },
            '4k': { width: 5120, height: 2160, label: '4K 超清' }
        },
        '2:3': {
            '1k': { width: 832, height: 1248, label: '1K 标准' },
            '2k': { width: 1664, height: 2496, label: '2K 高清' },
            '4k': { width: 3328, height: 4992, label: '4K 超清' }
        },
        '3:2': {
            '1k': { width: 1248, height: 832, label: '1K 标准' },
            '2k': { width: 2496, height: 1664, label: '2K 高清' },
            '4k': { width: 4992, height: 3328, label: '4K 超清' }
        },
        '9:21': {
            '1k': { width: 640, height: 1536, label: '1K 标准' },
            '2k': { width: 1080, height: 2560, label: '2K 高清' },
            '4k': { width: 2160, height: 5120, label: '4K 超清' }
        }
    };
    const STANDARD_VIDEO_RESOLUTIONS = {
        '16:9': {
            '480p': { width: 854, height: 480, label: '480P 标清' },
            '720p': { width: 1280, height: 720, label: '720P 高清' },
            '768p': { width: 1366, height: 768, label: '768P 高清' },
            '1080p': { width: 1920, height: 1080, label: '1080P 全高清' },
            '2k': { width: 2560, height: 1440, label: '2K 高清' },
            '4k': { width: 3840, height: 2160, label: '4K 超清' }
        },
        '9:16': {
            '480p': { width: 480, height: 854, label: '480P 标清' },
            '720p': { width: 720, height: 1280, label: '720P 高清' },
            '768p': { width: 768, height: 1366, label: '768P 高清' },
            '1080p': { width: 1080, height: 1920, label: '1080P 全高清' },
            '2k': { width: 1440, height: 2560, label: '2K 高清' },
            '4k': { width: 2160, height: 3840, label: '4K 超清' }
        },
        '1:1': {
            '480p': { width: 480, height: 480, label: '480P 标清' },
            '720p': { width: 720, height: 720, label: '720P 高清' },
            '768p': { width: 768, height: 768, label: '768P 高清' },
            '1080p': { width: 1080, height: 1080, label: '1080P 全高清' },
            '2k': { width: 1440, height: 1440, label: '2K 高清' },
            '4k': { width: 2160, height: 2160, label: '4K 超清' }
        },
        '4:3': {
            '480p': { width: 640, height: 480, label: '480P 标清' },
            '720p': { width: 960, height: 720, label: '720P 高清' },
            '768p': { width: 1024, height: 768, label: '768P 高清' },
            '1080p': { width: 1440, height: 1080, label: '1080P 全高清' },
            '2k': { width: 1920, height: 1440, label: '2K 高清' },
            '4k': { width: 2880, height: 2160, label: '4K 超清' }
        },
        '3:4': {
            '480p': { width: 480, height: 640, label: '480P 标清' },
            '720p': { width: 720, height: 960, label: '720P 高清' },
            '768p': { width: 768, height: 1024, label: '768P 高清' },
            '1080p': { width: 1080, height: 1440, label: '1080P 全高清' },
            '2k': { width: 1440, height: 1920, label: '2K 高清' },
            '4k': { width: 2160, height: 2880, label: '4K 超清' }
        },
        '21:9': {
            '480p': { width: 1120, height: 480, label: '480P 标清' },
            '720p': { width: 1680, height: 720, label: '720P 高清' },
            '768p': { width: 1792, height: 768, label: '768P 高清' },
            '1080p': { width: 2560, height: 1080, label: '1080P 全高清' },
            '2k': { width: 2560, height: 1080, label: '2K 高清' },
            '4k': { width: 5120, height: 2160, label: '4K 超清' }
        },
        '2:3': {
            '480p': { width: 480, height: 720, label: '480P 标清' },
            '720p': { width: 720, height: 1080, label: '720P 高清' },
            '768p': { width: 768, height: 1152, label: '768P 高清' },
            '1080p': { width: 1080, height: 1620, label: '1080P 全高清' },
            '2k': { width: 1440, height: 2160, label: '2K 高清' },
            '4k': { width: 2160, height: 3240, label: '4K 超清' }
        },
        '3:2': {
            '480p': { width: 720, height: 480, label: '480P 标清' },
            '720p': { width: 1080, height: 720, label: '720P 高清' },
            '768p': { width: 1152, height: 768, label: '768P 高清' },
            '1080p': { width: 1620, height: 1080, label: '1080P 全高清' },
            '2k': { width: 2160, height: 1440, label: '2K 高清' },
            '4k': { width: 3240, height: 2160, label: '4K 超清' }
        }
    };
    function normalizeImageRatio(r){
        const map = {
            'square': '1:1',
            'wide': '16:9',
            'story': '9:16',
            'landscape43': '4:3',
            'portrait43': '3:4',
            'portrait': '2:3',
            'landscape': '3:2',
            'ultrawide': '21:9',
            'ultratall': '9:21'
        };
        return map[r] || r || '1:1';
    }
    function getImageDimensions(ratio, quality='2k'){
        const normRatio = normalizeImageRatio(ratio || '1:1');
        const normQ = String(quality || '2k').trim().toLowerCase();
        const qKey = (normQ === '4k' || normQ === 'uhd' || normQ === 'ultra' || normQ === 'high' || normQ === '4K') ? '4k'
                   : (normQ === '1k' || normQ === 'standard' || normQ === 'low' || normQ === 'sd' || normQ === '1K') ? '1k'
                   : '2k';
        const matrix = STANDARD_IMAGE_RESOLUTIONS[normRatio] || STANDARD_IMAGE_RESOLUTIONS['1:1'];
        const item = matrix[qKey] || matrix['2k'] || { width: 2048, height: 2048, label: '2K 高清' };
        return {
            width: item.width,
            height: item.height,
            label: item.label
        };
    }
    function getVideoDimensions(ratio='16:9', resolution='720p'){
        const normRatio = normalizeImageRatio(ratio || '16:9');
        const normRes = String(resolution || '720p').trim().toLowerCase();
        const resKey = (normRes === '4k' || normRes === '2160p' || normRes === 'uhd') ? '4k'
                     : (normRes === '2k' || normRes === '2K' || normRes === '2048') ? '2k'
                     : (normRes === '1080p' || normRes === '1080' || normRes === 'fhd') ? '1080p'
                     : (normRes === '768p' || normRes === '768') ? '768p'
                     : (normRes === '480p' || normRes === '480' || normRes === 'sd') ? '480p'
                     : '720p';
        const matrix = STANDARD_VIDEO_RESOLUTIONS[normRatio] || STANDARD_VIDEO_RESOLUTIONS['16:9'];
        const item = matrix[resKey] || matrix['720p'] || { width: 1280, height: 720, label: '720P 高清' };
        return {
            width: item.width,
            height: item.height,
            label: item.label
        };
    }
    function parseSizeValue(value){
        const match = String(value || '').trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
        return match ? {width:match[1], height:match[2]} : null;
    }
    function parseRatioValue(value){
        const raw = String(value || '').trim();
        const parts = raw.includes(':') ? raw.split(':') : raw.split(/[xX*]/);
        if(parts.length !== 2) return 0;
        const w = Number(parts[0]);
        const h = Number(parts[1]);
        return w > 0 && h > 0 ? w / h : 0;
    }
    // 图片以 object-fit: cover 显示：容器比例与图片比例不一致时，画面被居中裁切。
    // 这里算出「容器里实际看到的是原图的哪一块」（原图像素坐标），裁剪与切分导出都以此为基准；
    // 否则会按整张原图换算，切出来的部位与用户看到的不一致。比例一致时即为整张原图。
    function mediaCoverWindow(naturalW, naturalH, boxW, boxH){
        const nw = Number(naturalW) || 0;
        const nh = Number(naturalH) || 0;
        const bw = Number(boxW) || 0;
        const bh = Number(boxH) || 0;
        if(!(nw > 0 && nh > 0 && bw > 0 && bh > 0)) return { x:0, y:0, w:nw, h:nh, exact:false };
        const imgRatio = nw / nh;
        const boxRatio = bw / bh;
        let w, h;
        if(imgRatio > boxRatio){ h = nh; w = nh * boxRatio; }
        else { w = nw; h = nw / boxRatio; }
        w = Math.max(1, Math.min(nw, Math.round(w)));
        h = Math.max(1, Math.min(nh, Math.round(h)));
        return {
            x: Math.max(0, Math.round((nw - w) / 2)),
            y: Math.max(0, Math.round((nh - h) / 2)),
            w, h,
            exact:true
        };
    }
    function normalizedSizeLabel(value){
        const parsed = parseSizeValue(value);
        const w = Number(parsed?.width || 0);
        const h = Number(parsed?.height || 0);
        return w > 0 && h > 0 ? `${Math.round(w)} x ${Math.round(h)}` : '';
    }
    function getImageCropRatioValue(ratioKey, naturalW, naturalH){
        if(!ratioKey || ratioKey === 'free') return null;
        if(ratioKey === 'original') return (naturalW && naturalH) ? (naturalW / naturalH) : 1;
        const parts = String(ratioKey).split(':').map(Number);
        if(parts.length === 2 && parts[0] > 0 && parts[1] > 0){
            return parts[0] / parts[1];
        }
        return null;
    }

    // ===== 格式化 =====
    function formatSmartVideoDurationTag(itemOrDuration){
        let sec = 0;
        if(typeof itemOrDuration === 'number') sec = itemOrDuration;
        else if(itemOrDuration && typeof itemOrDuration === 'object'){
            sec = Number(itemOrDuration.duration || 0);
        }
        if(!Number.isFinite(sec) || sec <= 0) return '';
        return sec < 10 && sec % 1 !== 0 ? `${sec.toFixed(1)}s` : `${Number(sec.toFixed(1))}s`;
    }
    function formatMediaFileSize(bytes){
        const n = Number(bytes);
        if(!Number.isFinite(n) || n <= 0) return '';
        if(n >= 1024 * 1024){
            return `${(n / (1024 * 1024)).toFixed(2)}MB`;
        }
        if(n >= 1024){
            return `${(n / 1024).toFixed(2)}KB`;
        }
        return `${n}B`;
    }
    function getMediaFormatName(item, kind){
        if(!item && !kind) return 'png';
        const mime = String(item?.mime || item?.content_type || '').toLowerCase();
        if(mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
        if(mime.includes('png')) return 'png';
        if(mime.includes('webp')) return 'webp';
        if(mime.includes('gif')) return 'gif';
        if(mime.includes('mp4')) return 'mp4';
        if(mime.includes('webm')) return 'webm';
        if(mime.includes('quicktime') || mime.includes('mov')) return 'mov';

        const urlStr = String(item?.url || item?.file || item?.name || '');
        if(urlStr.startsWith('data:image/')){
            const m = urlStr.match(/^data:image\/([a-zA-Z0-9+]+);/);
            if(m){
                const sub = m[1].toLowerCase();
                return sub === 'jpeg' ? 'jpg' : sub;
            }
        }
        const clean = urlStr.split('?')[0].split('#')[0];
        const dotMatch = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
        if(dotMatch){
            let ext = dotMatch[1].toLowerCase();
            if(ext === 'jpeg') ext = 'jpg';
            return ext;
        }
        return kind === 'video' ? 'mp4' : 'png';
    }
    function formatRunDuration(ms){
        const n = Number(ms || 0);
        if(n <= 0 || isNaN(n)) return '0s';
        if(n > 86400000) return '--';
        const totalSec = n / 1000;
        if(totalSec < 10 && totalSec % 1 !== 0){
            return `${totalSec.toFixed(1)}s`;
        }
        const total = Math.round(totalSec);
        const min = Math.floor(total / 60);
        const sec = total % 60;
        return min ? `${min}:${String(sec).padStart(2, '0')}` : `${sec}s`;
    }

    globalScope.SmartCanvasUtils = {
        getSmartGhostDimensions: getSmartGhostDimensions,
        parseSmartAspectRatio: parseSmartAspectRatio,
        normalizeImageRatio: normalizeImageRatio,
        getImageDimensions: getImageDimensions,
        getVideoDimensions: getVideoDimensions,
        copyTextWithCopyEvent: copyTextWithCopyEvent,
        copyTextWithTextarea: copyTextWithTextarea,
        clipboardMatchesText: clipboardMatchesText,
        copyTextToClipboard: copyTextToClipboard,
        escapeHtml: escapeHtml,
        smartOriginalMediaUrl: smartOriginalMediaUrl,
        smartMediaPreviewUrl: smartMediaPreviewUrl,
        loadSmartOriginalImageDimensions: loadSmartOriginalImageDimensions,
        formatSmartVideoDurationTag: formatSmartVideoDurationTag,
        sameMediaSrc: sameMediaSrc,
        downloadBlob: downloadBlob,
        parseSizeValue: parseSizeValue,
        parseRatioValue: parseRatioValue,
        isVideoMediaItem: isVideoMediaItem,
        isInlineVideoActive: isInlineVideoActive,
        isAudioMediaItem: isAudioMediaItem,
        isTextMediaItem: isTextMediaItem,
        isFileMediaItem: isFileMediaItem,
        mediaKindForFile: mediaKindForFile,
        mediaKindForItem: mediaKindForItem,
        localDisplayUrlForMediaItem: localDisplayUrlForMediaItem,
        imageForDisplay: imageForDisplay,
        mediaCoverWindow: mediaCoverWindow,
        looksLikeImageMediaUrl: looksLikeImageMediaUrl,
        isRemoteVideoReferenceUrl: isRemoteVideoReferenceUrl,
        imageResolutionLabel: imageResolutionLabel,
        imageNameLabel: imageNameLabel,
        outputUrlLooksVideo: outputUrlLooksVideo,
        proxiedMediaUrl: proxiedMediaUrl,
        displayMediaUrl: displayMediaUrl,
        browserCanPlayHevc: browserCanPlayHevc,
        isLocalCanvasMediaUrl: isLocalCanvasMediaUrl,
        playbackVideoUrl: playbackVideoUrl,
        safeExportFileName: safeExportFileName,
        fileNameFromUrl: fileNameFromUrl,
        isMachineGeneratedMediaName: isMachineGeneratedMediaName,
        cleanMediaBaseName: cleanMediaBaseName,
        escapeSemanticRegex: escapeSemanticRegex,
        appendSemanticActionSuffix: appendSemanticActionSuffix,
        extensionForMediaItem: extensionForMediaItem,
        downloadNameForMediaItem: downloadNameForMediaItem,
        normalizedSizeLabel: normalizedSizeLabel,
        formatMediaFileSize: formatMediaFileSize,
        getMediaFormatName: getMediaFormatName,
        getImageCropRatioValue: getImageCropRatioValue,
        formatRunDuration: formatRunDuration,
        smartImageNameFromUrl: smartImageNameFromUrl
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
