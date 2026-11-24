/**
 * canvas-state.js —— 智能画布数据契约层（画布拆分第 3 阶段）
 *
 * 只放「节点/画布数据 <-> 存储格式」之间的纯转换：设置克隆与清洗、媒体条目持久化、
 * 节点规范化与旧数据迁移、节点序列化、画布存储对象生成、导入数据规范化、
 * 撤销快照的临时字段清理。
 *
 * 三条硬约束：
 * 1. 本文件不持有任何画布状态。nodes / canvas / viewport / settings /
 *    EMPTY_GEN_NODE_WIDTH / SMART_LOG_PREVIEW_NODE_ID / INLINE_MEDIA_MIGRATE_LIMIT
 *    全部留在 smart-canvas.js，需要时由主文件的同名包装函数按引用注入，
 *    绝不复制第二份。注入参数与原全局同名，因此函数体逐字节保持原样。
 *    normalizeLegacySmartNode 额外注入 tr / isEmptyGenBoard / isSmartVideoNode /
 *    emptyGenBoardSizeFromAspect / mediaKindForItem（分属 i18n、布局层与 canvas-utils），
 *    由主文件的 smartNodeMigrationDeps() 统一提供。
 * 2. 不做任何 I/O：不 fetch、不碰 localStorage / indexedDB、不动 DOM。
 *    loadCanvas / saveCanvas / scheduleSave / saveLocalDraft 因此仍留在主文件。
 * 3. 加载顺序必须在 smart-canvas.js 之前。本文件解析期不读取主文件任何变量。
 *    注意主文件顶层有一处解析期调用：
 *      const initialSmartSettings = cloneSmartSettings(settings);
 *    所以本文件缺失会直接白屏，不能只靠运行期兜底。
 *
 * 对外只暴露 window.SmartCanvasState。
 */
(function attachSmartCanvasState(globalScope) {

    // ===== 设置克隆与存储清洗 =====
    function cloneSmartSettings(source){
        try {
            return JSON.parse(JSON.stringify(source || {}));
        } catch(e) {
            return {...(source || {})};
        }
    }
    function settingsForStorage(source){
        const clean = cloneSmartSettings(source);
        clean.videoTempShLinks = (clean.videoTempShLinks || []).filter(item => item?.manual === true);
        return clean;
    }
    function stripOutpaintDisplaySettings(settingsObj, node=null){
        const clean = cloneSmartSettings(settingsObj);
        delete clean.outpaintResolutionLocked;
        return clean;
    }

    // ===== 节点媒体数据持久化 =====
    function mediaItemForStorage(item){
        if(!item || typeof item !== 'object') return item;
        const clean = {...item};
        delete clean.cloudUrl;
        delete clean.uploadedUrl;
        delete clean.originalRemoteUrl;
        delete clean.tempCloudUrl;
        delete clean._inlineVideoActive;
        return clean;
    }
    function stripImageGenerationMeta(img){
        if(!img) return img;
        delete img.runPrompt;
        delete img.runModelPrompt;
        delete img.runSettings;
        delete img.sourceNodeId;
        delete img.runAt;
        delete img.promptDraftHtml;
        delete img.promptDraftText;
        return img;
    }
    function applyNodeMetaToImage(image, node){
        return stripImageGenerationMeta(image);
    }
    function inheritNodeMetaFromImage(node){
        if(!node) return;
        node.images = (node.images || []).map(img => stripImageGenerationMeta(img));
    }
    function mergeSmartImageLists(localImgs, remoteImgs){
        const out = [];
        const seen = new Set();
        (localImgs || []).forEach(img => {
            const u = img && img.url;
            if(u && seen.has(u)) return;
            if(u) seen.add(u);
            out.push(img);
        });
        (remoteImgs || []).forEach(img => {
            const u = img && img.url;
            if(!u || seen.has(u)) return;
            seen.add(u);
            out.push(img);
        });
        return out;
    }
    function countCanvasMediaItems(list){
        let count = 0;
        (list || []).forEach(node => {
            const images = node?.images;
            if(!Array.isArray(images)) return;
            images.forEach(item => {
                if(item && (item.url || item.src)) count += 1;
            });
        });
        return count;
    }
    function collectOversizedInlineImages(targetNodes, INLINE_MEDIA_MIGRATE_LIMIT){
        const out = [];
        (targetNodes || []).forEach(n => {
            (n?.images || []).forEach((img, index) => {
                const url = String(img?.url || '');
                if(url.startsWith('data:') && url.length > INLINE_MEDIA_MIGRATE_LIMIT){
                    out.push({ node:n, index, img });
                }
            });
            if(n?.inputImage && typeof n.inputImage === 'object'){
                const url = String(n.inputImage.url || '');
                if(url.startsWith('data:') && url.length > INLINE_MEDIA_MIGRATE_LIMIT){
                    out.push({ node:n, index:-1, img:n.inputImage });
                }
            }
        });
        return out;
    }

    // ===== 节点规范化与旧数据迁移 =====
    function normalizeSmartImageMode(mode){
        return ['omni', 'character', 'style', 'text_only', 'multimodal'].includes(mode) ? (mode === 'multimodal' ? 'omni' : mode) : 'omni';
    }
    function normalizeLegacySmartNode(node, {tr, isEmptyGenBoard, isSmartVideoNode, emptyGenBoardSizeFromAspect, EMPTY_GEN_NODE_WIDTH, mediaKindForItem}){
        if(!node || typeof node !== 'object') return node;
        if(node.type === 'smart-upload' || node.nodeKind === 'upload' || node.title === '上传' || node.title === '素材上传'){
            node.type = 'smart-upload';
            node.nodeKind = 'upload';
        }
        if(node.type === 'smart-container'){
            const fallbackImage = node.inputImage?.url ? stripImageGenerationMeta({
                url:node.inputImage.url,
                name:node.inputImage.name || 'image',
                kind:node.inputImage.kind || mediaKindForItem(node.inputImage),
                natural_w:Number(node.inputImage.natural_w || 0),
                natural_h:Number(node.inputImage.natural_h || 0)
            }) : null;
            const images = Array.isArray(node.images) && node.images.length
                ? node.images
                : (fallbackImage ? [fallbackImage] : []);
            const normalized = {
                ...node,
                type:'smart-upload',
                nodeKind:'upload',
                title:images.length > 1 ? '素材组' : (images.length ? '图片' : tr('smart.createImportNode')),
                images
            };
            delete normalized.imageMode;
            delete normalized.inputImage;
            delete normalized.steps;
            delete normalized.resultGrouping;
            return normalized;
        }
        if(node.gridSplitGroup || node.gridSplitChild){
            node.gridSplitVersion = node.gridSplitVersion || 1;
        }
        if(node.gridSplitGroup){
            node.isFrameGroup = true;
            node.images = [];
            node.fixedBounds = true;
        }
        // 视频裁剪节点数据契约与旧数据迁移补齐 (videoCropVersion: 1)
        const firstImg = node.images?.[0];
        const hasCrop = node.isCroppedVideo || Boolean(node.videoCropVersion) || (Number.isFinite(firstImg?.trimIn) && Number.isFinite(firstImg?.trimOut));
        if(hasCrop){
            node.videoCropVersion = node.videoCropVersion || 1;
            node.isCroppedVideo = true;
            const tIn = Number.isFinite(node.trimIn) ? Number(node.trimIn) : (Number.isFinite(firstImg?.trimIn) ? Number(firstImg.trimIn) : 0);
            const tOut = Number.isFinite(node.trimOut) ? Number(node.trimOut) : (Number.isFinite(firstImg?.trimOut) ? Number(firstImg.trimOut) : 0);
            node.trimIn = Number(tIn.toFixed(2));
            node.trimOut = Number(tOut.toFixed(2));
            node.duration = Math.max(0.1, Number((node.trimOut - node.trimIn).toFixed(2)));
            if(firstImg){
                firstImg.trimIn = node.trimIn;
                firstImg.trimOut = node.trimOut;
                firstImg.duration = node.duration;
                firstImg.kind = 'video';
            }
            node.type = 'smart-video';
            node.genKind = 'video';
            const explicitW = Number(node.w);
            const explicitH = Number(node.h);
            if(!Number.isFinite(explicitW) || explicitW < 40) node.w = 480;
            if(!Number.isFinite(explicitH) || explicitH < 40) node.h = 270;
        }

        if(isEmptyGenBoard(node)){
            node.genBoardVersion = node.genBoardVersion || 1;
            const isVid = isSmartVideoNode(node);
            const aspect = isVid
                ? (node.params?.videoAspect || '16:9')
                : (node.params?.ratio || node.params?.imageRatio || '1:1');
            const targetSize = emptyGenBoardSizeFromAspect(aspect) || (isVid ? { w: 480, h: 270 } : { w: 270, h: 270 });
            const explicitW = Number(node.w);
            const explicitH = Number(node.h);
            if(!Number.isFinite(explicitW) || explicitW <= 40 || !Number.isFinite(explicitH) || explicitH <= 40 || explicitW === 340 || explicitW === EMPTY_GEN_NODE_WIDTH || (explicitH > 270 && !node.images?.length)){
                const oldW = Number.isFinite(explicitW) && explicitW > 40 ? explicitW : targetSize.w;
                const oldH = Number.isFinite(explicitH) && explicitH > 40 ? explicitH : targetSize.h;
                node.x = Math.round((Number(node.x) || 0) + (oldW - targetSize.w) / 2);
                node.y = Math.round((Number(node.y) || 0) + (oldH - targetSize.h) / 2);
                node.w = targetSize.w;
                node.h = targetSize.h;
            }
        }

        if(!node.type) node.type = 'smart-image';
        if(node.type === 'smart-image' && node.imageMode) node.imageMode = normalizeSmartImageMode(node.imageMode);
        if(node.type === 'smart-image' && node.historyFor) node.isHistoryGroup = true;
        (node.images || []).forEach(img => {
            if(img && typeof img === 'object' && (!img.kind || img.kind === 'image')){
                const realKind = mediaKindForItem(img);
                if(realKind) img.kind = realKind;
            }
        });
        // 宫格切片、视频裁剪节点与空生成板等是特定布局节点，其 w/h 属于数据契约，刷新时必须保留，禁止误伤。
        if((node.type === 'smart-image' || node.type === 'smart-upload' || node.type === 'smart-video') && !node.isHistoryGroup && !node.gridSplitChild && !node.isCroppedVideo && !isEmptyGenBoard(node) && (node.images || []).length === 1){
            delete node.w; delete node.h;
        }
        return node;
    }
    function clearSmartNodeTransientRunState(node, options={}){
        if(!node) return node;
        node.running = false;
        node.pending = 0;
        node.queued = false;
        delete node.pendingTasks;
        delete node._runMetaTargetId;
        if(options.clearRunHistory){
            delete node.runStartedAt;
            delete node.runFinishedAt;
            delete node.runElapsedMs;
            delete node.runTimerHidden;
        }
        return node;
    }

    // ===== 节点序列化与画布存储对象 =====
    function serializableSmartNode(node, deps){
        const base = JSON.parse(JSON.stringify(node || {}));
        const copy = normalizeLegacySmartNode(base, deps) || {};
        if(Array.isArray(copy.images)) copy.images = copy.images.map(img => mediaItemForStorage(stripImageGenerationMeta(img))).filter(Boolean);
        if(copy.runSettings) copy.runSettings = settingsForStorage(copy.runSettings);
        clearSmartNodeTransientRunState(copy);
        delete copy._dom;
        return copy;
    }
    function canvasForStorage(canvas, canvasDefaultSmartSettings, initialSmartSettings, SMART_LOG_PREVIEW_NODE_ID){
        const clean = JSON.parse(JSON.stringify(canvas || {}));
        clean.settings = settingsForStorage(canvasDefaultSmartSettings || initialSmartSettings);
        // 日志预览的临时节点（编辑器打开期间临时塞进 nodes）绝不能被持久化，否则刷新后会留下幽灵节点。
        if(Array.isArray(clean.nodes)) clean.nodes = clean.nodes.filter(node => node.id !== SMART_LOG_PREVIEW_NODE_ID);
        (clean.nodes || []).forEach(node => {
            if(Array.isArray(node.images)) node.images = node.images.map(mediaItemForStorage);
            if(node.runSettings) node.runSettings = settingsForStorage(node.runSettings);
            if(node.type === 'smart-minimax') node.timelinePlaying = false;
        });
        return clean;
    }

    // ===== 保存期节点契约补齐（saveCanvas 专用）=====
    // 这段是就地改写实时 nodes，不是克隆后的快照。
    // 它和上面的 normalizeLegacySmartNode 是两套不同策略，故意不合并；差异共五类
    // （证据与复现见 docs/canvas-split-plan.md 第 3.5 阶段记录）：
    //   1. 这里不补 node.type；normalize 会把缺 type 的节点写成 'smart-image'。
    //   2. 裁剪分支只认 node.isCroppedVideo，并在 tOut <= tIn 时强制 tOut = tIn + 10；
    //      normalize 触发条件更宽（videoCropVersion / 首图 trim 也算），没有这条钳制，
    //      还会把 type/genKind 改写成 video。
    //   3. 空生成板分支只在 w/h 无效时补尺寸，不平移 x/y；normalize 会 resize 并重新居中。
    //   4. 裁剪元数据写每张 image；normalize 只写 images[0]。
    //   5. 这里绝不 delete node.w/h；normalize 对单图节点会删，落到实时节点上布局会塌。
    function normalizeSmartNodesForSave(nodes, {isEmptyGenBoard, isSmartVideoNode, emptyGenBoardSizeFromAspect}){
        nodes.forEach(node => {
            if(node.isCroppedVideo){
                let tIn = Number(node.trimIn);
                let tOut = Number(node.trimOut);
                if(!Number.isFinite(tIn)) tIn = 0;
                if(!Number.isFinite(tOut) || tOut <= tIn) tOut = tIn + 10;
                node.trimIn = Number(tIn.toFixed(2));
                node.trimOut = Number(tOut.toFixed(2));
                node.duration = Math.max(0.1, Number((node.trimOut - node.trimIn).toFixed(2)));
                node.videoCropVersion = node.videoCropVersion || 1;
                const explicitW = Number(node.w);
                const explicitH = Number(node.h);
                if(!Number.isFinite(explicitW) || explicitW < 40) node.w = 480;
                if(!Number.isFinite(explicitH) || explicitH < 40) node.h = 270;
            }
            if(isEmptyGenBoard(node)){
                node.genBoardVersion = node.genBoardVersion || 1;
                const explicitW = Number(node.w);
                const explicitH = Number(node.h);
                if(!Number.isFinite(explicitW) || explicitW < 40 || !Number.isFinite(explicitH) || explicitH < 40){
                    const isVid = isSmartVideoNode(node);
                    const aspect = isVid
                        ? (node.params?.videoAspect || '16:9')
                        : (node.params?.ratio || node.params?.imageRatio || '1:1');
                    const size = emptyGenBoardSizeFromAspect(aspect) || (isVid ? { w: 480, h: 270 } : { w: 270, h: 270 });
                    node.w = size.w;
                    node.h = size.h;
                }
            }
            node.images = (node.images || []).map(img => {
                const clean = mediaItemForStorage(stripImageGenerationMeta(img));
                if(node.isCroppedVideo && clean){
                    clean.trimIn = node.trimIn;
                    clean.trimOut = node.trimOut;
                    clean.duration = node.duration;
                    clean.kind = 'video';
                }
                return clean;
            });
            if(node.runSettings) node.runSettings = settingsForStorage(node.runSettings);
        });
    }

    // ===== 导入数据规范化 =====
    function normalizeImportedSmartWorkflow(data){
        if(Array.isArray(data)) return {nodes:data, connections:[]};
        if(Array.isArray(data?.nodes)) return {nodes:data.nodes, connections:Array.isArray(data.connections) ? data.connections : []};
        if(Array.isArray(data?.workflow?.nodes)) return {nodes:data.workflow.nodes, connections:Array.isArray(data.workflow.connections) ? data.workflow.connections : []};
        return {nodes:[], connections:[]};
    }

    // ===== 撤销快照的临时字段清理 =====
    function pruneMediaItemForSnapshot(item){
        if(!item || typeof item !== 'object') return item;
        const clean = {};
        for(const [k, v] of Object.entries(item)){
            if(k.startsWith('_')) continue;
            if(k === 'cloudUrl' || k === 'tempCloudUrl' || k === 'uploadedUrl' || k === 'originalRemoteUrl') continue;
            if(typeof v === 'string' && v.startsWith('data:') && v.length > 32768 && k !== 'url'){
                continue;
            }
            clean[k] = v;
        }
        return clean;
    }
    function pruneNodeForSnapshot(node){
        if(!node || typeof node !== 'object') return node;
        const clean = {};
        for(const [k, v] of Object.entries(node)){
            if(k.startsWith('_')) continue;
            if(k === 'images' && Array.isArray(v)){
                clean.images = v.map(pruneMediaItemForSnapshot);
            } else if(k === 'segments' && Array.isArray(v)){
                clean.segments = v.map(seg => {
                    const cleanSeg = {...seg};
                    if(Array.isArray(cleanSeg.refItems)) cleanSeg.refItems = cleanSeg.refItems.map(pruneMediaItemForSnapshot);
                    if(Array.isArray(cleanSeg.results)) cleanSeg.results = cleanSeg.results.map(pruneMediaItemForSnapshot);
                    if(cleanSeg.result) cleanSeg.result = pruneMediaItemForSnapshot(cleanSeg.result);
                    delete cleanSeg._temp;
                    return cleanSeg;
                });
            } else if(k === 'materials' && Array.isArray(v)){
                clean.materials = v.map(pruneMediaItemForSnapshot);
            } else if(k === 'pendingTasks' || k === 'runningTasks'){
                clean[k] = Array.isArray(v) ? v.slice() : v;
            } else {
                clean[k] = v;
            }
        }
        return clean;
    }

    globalScope.SmartCanvasState = {
        cloneSmartSettings: cloneSmartSettings,
        settingsForStorage: settingsForStorage,
        stripOutpaintDisplaySettings: stripOutpaintDisplaySettings,
        mediaItemForStorage: mediaItemForStorage,
        stripImageGenerationMeta: stripImageGenerationMeta,
        applyNodeMetaToImage: applyNodeMetaToImage,
        inheritNodeMetaFromImage: inheritNodeMetaFromImage,
        mergeSmartImageLists: mergeSmartImageLists,
        countCanvasMediaItems: countCanvasMediaItems,
        collectOversizedInlineImages: collectOversizedInlineImages,
        normalizeSmartImageMode: normalizeSmartImageMode,
        normalizeLegacySmartNode: normalizeLegacySmartNode,
        clearSmartNodeTransientRunState: clearSmartNodeTransientRunState,
        serializableSmartNode: serializableSmartNode,
        canvasForStorage: canvasForStorage,
        normalizeImportedSmartWorkflow: normalizeImportedSmartWorkflow,
        pruneMediaItemForSnapshot: pruneMediaItemForSnapshot,
        pruneNodeForSnapshot: pruneNodeForSnapshot,
        normalizeSmartNodesForSave: normalizeSmartNodesForSave
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
