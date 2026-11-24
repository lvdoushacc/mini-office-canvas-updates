/**
 * canvas-layout.js —— 智能画布纯布局计算层（画布拆分第 4.1 阶段）
 *
 * 只放「给定节点/图片数据 -> 尺寸/排布数字」的纯计算：节点缩放、媒体与单图布局、
 * 多图网格、智能分组尺寸、空生成板尺寸、输入缩略图排布。
 *
 * 三条硬约束：
 * 1. 不碰 DOM，不读写 nodes / canvas / viewport，不 render、不 save。
 *    所有布局常量（STANDARD_ASPECT_RATIO_PRESETS / MEDIA_GROUP_* / SMART_GROUP_*）
 *    在主文件另有 2-22 处引用，因此全部留在主文件，由同名包装函数按引用注入，
 *    参数名与原常量一致，函数体逐字节保持原样。
 *    singleImageLayout 会读 settings?.ratio 作为比例兜底，同样是注入而非复制。
 * 2. deps 缺失一律抛错（见 needDeps）。原代码里 normalizeImageRatio 与
 *    emptyGenBoardSizeFromAspect 都有 `typeof X === 'function'` 兜底，
 *    如果放任 deps 为空，结果会**静默**变化而不是报错。
 * 3. 加载顺序必须在 smart-canvas.js 之前；本文件解析期不读取任何外部全局。
 *    只暴露 window.SmartCanvasLayout。
 */
(function attachSmartCanvasLayout(globalScope) {

    function needDeps(name) {
        throw new Error('canvas-layout: ' + name +
            ' 需要调用方注入布局依赖，请通过 smart-canvas.js 的同名包装函数调用');
    }

    // ===== 节点缩放 =====
    function nodeScale(node, {MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE, MEDIA_GROUP_DEFAULT_SCALE} = needDeps('nodeScale')){
        const v = Number(node?.scale);
        if((node?.images || []).length > 1 && v === MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE) return MEDIA_GROUP_DEFAULT_SCALE;
        return Number.isFinite(v) && v > 0 ? v : 1;
    }

    // ===== 空生成板尺寸 =====
    function emptyGenBoardSizeFromAspect(aspect, {STANDARD_ASPECT_RATIO_PRESETS, normalizeImageRatio} = needDeps('emptyGenBoardSizeFromAspect')){
        const raw = String(aspect || '').trim().toLowerCase();
        if(!raw || raw === 'adaptive' || raw === 'auto' || raw === 'source' || raw === 'custom') return null;
        const norm = typeof normalizeImageRatio === 'function' ? normalizeImageRatio(raw) : raw;
        const preset = STANDARD_ASPECT_RATIO_PRESETS.find(p => p.name === norm);
        if(preset){
            return { w: preset.width, h: preset.height, ratio: norm };
        }
        const parts = String(norm).split(':').map(Number);
        const aw = parts[0], ah = parts[1];
        if(!aw || !ah) return null;
        const ratio = aw / ah;
        if(ratio >= 16 / 9){
            return { w: 480, h: Math.max(72, Math.min(270, Math.round(480 / ratio))), ratio: norm };
        } else {
            return { w: Math.max(72, Math.min(480, Math.round(270 * ratio))), h: 270, ratio: norm };
        }
    }

    // ===== 智能分组尺寸 =====
    function smartGroupLayoutSize(node, {SMART_GROUP_DEFAULT_WIDTH, SMART_GROUP_MIN_WIDTH, SMART_GROUP_LEGACY_HEIGHT, SMART_GROUP_DEFAULT_HEIGHT, SMART_GROUP_MIN_HEIGHT} = needDeps('smartGroupLayoutSize')){
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        const width = Number.isFinite(explicitW) && explicitW >= SMART_GROUP_MIN_WIDTH ? explicitW : SMART_GROUP_DEFAULT_WIDTH;
        const height = !Number.isFinite(explicitH) || explicitH === SMART_GROUP_LEGACY_HEIGHT
            ? SMART_GROUP_DEFAULT_HEIGHT
            : Math.max(explicitH, SMART_GROUP_MIN_HEIGHT);
        return {
            width:Math.round(width),
            height:Math.round(height)
        };
    }

    // ===== 媒体与单图布局 =====
    function mediaLayoutSize(img){
        const width = Number(img?.natural_w || img?.width || img?.w || img?.layout_w || img?.preview_w || 0);
        const height = Number(img?.natural_h || img?.height || img?.h || img?.layout_h || img?.preview_h || 0);
        return width > 0 && height > 0 ? {width, height} : {width:0, height:0};
    }
    function standardImageFixedSize(naturalW, naturalH, {STANDARD_ASPECT_RATIO_PRESETS} = needDeps('standardImageFixedSize')){
        const nw = Number(naturalW) || 0;
        const nh = Number(naturalH) || 0;
        if(nw <= 0 || nh <= 0){
            return { width: 480, height: 270 };
        }
        const ratio = nw / nh;
        for(const preset of STANDARD_ASPECT_RATIO_PRESETS){
            if(Math.abs(ratio - preset.ratio) / preset.ratio < 0.035){
                return { width: preset.width, height: preset.height };
            }
        }
        if(ratio >= 16 / 9){
            return { width: 480, height: Math.max(72, Math.min(270, Math.round(480 / ratio))) };
        }
        return { width: Math.max(72, Math.min(480, Math.round(270 * ratio))), height: 270 };
    }
    function singleImageLayout(image, node, scale, deps = needDeps('singleImageLayout')){
        const {settings, isAudioMediaItem} = deps;
        // 音频紧凑尺寸
        if(isAudioMediaItem(image)){
            return {cols:1, rows:1, width:480, height:240, thumb:96, single:true};
        }
        // 宫格切分子卡片与视频裁剪节点：创建、刷新、拖动、缩放都使用同一套显式布局尺寸，严禁被默认 480x270 覆盖导致刷新后尺寸跳变
        const childW = Number(node?.w), childH = Number(node?.h);
        if((node?.gridSplitChild || node?.isCroppedVideo) && Number.isFinite(childW) && Number.isFinite(childH) && childW > 40 && childH > 40){
            return {cols:1, rows:1, width:Math.round(childW), height:Math.round(childH), thumb:96, single:true};
        }
        const layoutSize = mediaLayoutSize(image);
        const naturalW = layoutSize.width;
        const naturalH = layoutSize.height;
        if(naturalW > 0 && naturalH > 0){
            const size = standardImageFixedSize(naturalW, naturalH, deps);
            return {
                cols:1,
                rows:1,
                width:size.width,
                height:size.height,
                thumb:96,
                single:true
            };
        }
        // 当图片未加载完成（naturalW=0）时：如果节点已有指定尺寸或比例（如 1:1 或 4:3），优先使用既有尺寸/比例预设，杜绝默认 480x270 导致的闪烁跳变！
        if(Number.isFinite(childW) && Number.isFinite(childH) && childW > 40 && childH > 40){
            if(childH > 270){
                const ratio = childW / childH;
                const fittedW = Math.max(72, Math.min(480, Math.round(270 * ratio)));
                return {cols:1, rows:1, width:fittedW, height:270, thumb:96, single:true};
            }
            return {cols:1, rows:1, width:Math.round(childW), height:Math.round(childH), thumb:96, single:true};
        }
        const ratioHint = node?.params?.ratio || node?.params?.imageRatio || node?.params?.videoAspect || settings?.ratio;
        if(ratioHint && typeof emptyGenBoardSizeFromAspect === 'function'){
            const preset = emptyGenBoardSizeFromAspect(ratioHint, deps);
            if(preset) return {cols:1, rows:1, width:preset.w, height:preset.h, thumb:96, single:true};
        }
        return {cols:1, rows:1, width:480, height:270, thumb:96, single:true};
    }

    // ===== 多图网格 =====
    function groupImageGridLayout(count, explicitW, explicitH, maxThumb, pad, gap, maxVisibleRows, {MEDIA_GROUP_MAX_VISIBLE_ROWS} = needDeps('groupImageGridLayout')){
        let best = null;
        for(let cols = 1; cols <= count; cols++){
            const rows = Math.ceil(count / cols);
            const visibleRows = Math.min(Math.max(1, maxVisibleRows), rows);
            const availableW = explicitW - pad - (cols - 1) * gap;
            const availableH = explicitH - pad - (visibleRows - 1) * gap;
            if(availableW <= 0 || availableH <= 0) continue;
            const rawThumb = Math.floor(Math.min(availableW / cols, availableH / visibleRows));
            const fittedThumb = Math.max(28, Math.min(maxThumb, rawThumb));
            const fits = rawThumb >= 28;
            const usedW = cols * fittedThumb + (cols - 1) * gap + pad;
            const usedH = visibleRows * fittedThumb + (visibleRows - 1) * gap + pad;
            const spareW = Math.max(0, explicitW - usedW);
            const spareH = Math.max(0, explicitH - usedH);
            const atMax = fittedThumb >= maxThumb;
            const score = [
                fits ? 1 : 0,
                fittedThumb,
                atMax ? cols : 0,
                -(spareW + spareH * 0.35),
                -rows
            ];
            let better = !best;
            if(best){
                for(let i = 0; i < score.length; i++){
                    if(score[i] === best.score[i]) continue;
                    better = score[i] > best.score[i];
                    break;
                }
            }
            if(better){
                best = {cols, rows, visibleRows, thumb:fittedThumb, score};
            }
        }
        const fallbackCols = Math.min(count, 2);
        const fallbackRows = Math.ceil(count / fallbackCols);
        return best || {cols:fallbackCols, rows:fallbackRows, visibleRows:Math.min(MEDIA_GROUP_MAX_VISIBLE_ROWS, fallbackRows), thumb:28};
    }

    // ===== 输入缩略图排布 =====
    function smartNodeInputThumbRows(count){
        return count ? Math.ceil(Math.min(10, count) / 5) : 0;
    }
    function smartNodeInputThumbsHeight(images){
        const rows = smartNodeInputThumbRows((images || []).length);
        return rows ? rows * 44 + (rows - 1) * 6 + 8 : 0;
    }
    function smartNodeLayoutImages(node, {smartPendingTasks} = needDeps('smartNodeLayoutImages')){
        const images = (node?.images || []).filter(img => img?.url);
        const pending = Math.max(Number(node?.pending || 0) || 0, smartPendingTasks(node).length);
        if (pending > 0 && images.length + pending > 1) {
            return images.concat(Array.from({length: pending}, () => ({pending: true})));
        }
        return images.length ? images : ((pending > 0) ? Array.from({length: pending}, () => ({pending: true})) : (node?.images || []));
    }


    // ===== 布局分派枢纽 =====
    // imageLayout 是 nodeRect / render 都经过的分派函数。除下面四个已在
    // 本模块内的函数需要把 deps 继续传下去外，其余被调函数（含节点图与分组
    // 解析相关的 smartGroupThumbLayout / promptNodeLayoutSize /
    // isSmartGroupCompactMember / smartLoopHeight）全部按引用注入，
    // 本模块自身不碰 DOM / nodes / canvas / viewport。
    function imageLayout(images, scale, node, deps = needDeps('imageLayout')){
        const {smartGroupThumbLayout, promptNodeLayoutSize, smartMinimaxLayoutSize, isSmartGroupCompactMember, smartLoopWidth, smartLoopHeight, mediaNodeDefaultScale, isSmartUploadNode, isSmartVideoNode, settings, EMPTY_UPLOAD_NODE_WIDTH, EMPTY_UPLOAD_NODE_HEIGHT, MEDIA_GROUP_THUMB_BASE, MEDIA_GROUP_MAX_VISIBLE_ROWS} = deps;
        if(node?.type === 'smart-group'){
            const groupThumbLayout = smartGroupThumbLayout(node);
            if(groupThumbLayout) return groupThumbLayout;
            return {cols:1, rows:1, ...smartGroupLayoutSize(node, deps), thumb:96, single:true};
        }
        if(node?.type === 'smart-prompt') return {cols:1, rows:1, ...promptNodeLayoutSize(node), thumb:96, single:true};
        if(node?.type === 'smart-minimax') return {cols:1, rows:1, ...smartMinimaxLayoutSize(node), thumb:96, single:true};
        if(node?.type === 'smart-loop'){
            const explicitW = Number(node.w);
            const explicitH = Number(node.h);
            if(isSmartGroupCompactMember(node) && Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24){
                return {cols:1, rows:1, width:Math.round(explicitW), height:Math.round(explicitH), thumb:96, single:true};
            }
            return {cols:1, rows:1, width:Math.round(Number(node.w) || smartLoopWidth(node)), height:Math.round(Math.max(Number(node.h) || 0, smartLoopHeight(node))), thumb:96, single:true};
        }
        const count = (images || []).length;
        const s = node?.type === 'smart-image' || !node?.type ? mediaNodeDefaultScale(node) : (Number.isFinite(scale) && scale > 0 ? scale : 1);
        if(count === 0){
            const isUpload = isSmartUploadNode(node);
            const explicitW = Number(node?.w);
            const explicitH = Number(node?.h);
            const isVid = isSmartVideoNode(node);
            const aspectHint = isVid ? (node?.params?.videoAspect || settings?.videoAspect || '16:9') : (node?.params?.ratio || node?.params?.imageRatio || settings?.ratio || settings?.imageRatio || '1:1');
            const sizedFallback = emptyGenBoardSizeFromAspect(aspectHint, deps) || (isVid ? { w: 480, h: 270 } : { w: 270, h: 270 });
            const fallbackW = isUpload ? EMPTY_UPLOAD_NODE_WIDTH : sizedFallback.w;
            const fallbackH = isUpload ? EMPTY_UPLOAD_NODE_HEIGHT : sizedFallback.h;
            return {
                cols:1,
                rows:1,
                width:Math.round(Number.isFinite(explicitW) && explicitW > 24 ? explicitW : fallbackW),
                height:Math.round(Number.isFinite(explicitH) && explicitH > 24 ? explicitH : fallbackH),
                thumb:Math.round(96*s),
                single:true
            };
        }
        if(count === 1) return singleImageLayout(images[0], node, s, deps);
        const thumb = Math.round(MEDIA_GROUP_THUMB_BASE * s);
        const cell = thumb + 8;
        const PAD = 32; // group-node has 16px padding on each side
        const grid = images.find(img => img?.grid?.type === 'grid-split')?.grid;
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        if(grid){
            const cols = Math.max(1, Number(grid.cols || 1));
            const rows = Math.max(1, Number(grid.rows || 1));
            const visibleRows = Math.min(MEDIA_GROUP_MAX_VISIBLE_ROWS, rows);
            if(Number.isFinite(explicitW) && explicitW > 40 && Number.isFinite(explicitH) && explicitH > 40){
                const fittedThumb = Math.max(28, Math.floor(Math.min((explicitW - PAD - (cols - 1) * 8) / cols, (explicitH - PAD - (visibleRows - 1) * 8) / visibleRows)));
                return {cols, rows, visibleRows, width:Math.round(explicitW), height:visibleRows * (fittedThumb + 8) - 8 + PAD, thumb:fittedThumb};
            }
            return {cols, rows, visibleRows, width:Math.max(Math.round(226*s), cols * cell + PAD), height:visibleRows * cell - 8 + PAD, thumb};
        }
        const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
        const rows = Math.ceil(count / cols);
        const visibleRows = Math.min(MEDIA_GROUP_MAX_VISIBLE_ROWS, rows);
        if(Number.isFinite(explicitW) && explicitW > 40 && Number.isFinite(explicitH) && explicitH > 40){
            const fitted = groupImageGridLayout(count, explicitW, explicitH, thumb, PAD, 8, MEDIA_GROUP_MAX_VISIBLE_ROWS, deps);
            return {cols:fitted.cols, rows:fitted.rows, visibleRows:fitted.visibleRows, width:Math.round(explicitW), height:fitted.visibleRows * (fitted.thumb + 8) - 8 + PAD, thumb:fitted.thumb};
        }
        const width = Math.max(Math.round(226*s), cols * cell + PAD);
        const height = visibleRows * cell - 8 + PAD;
        return {cols, rows, visibleRows, width, height, thumb};
    }


    // ===== 分组缩略图排布 =====
    // smartGroupThumbLayout 只算尺寸：成员是谁、怎么排、连线怎么改都留在主文件。
    // 它调用的 smartGroupImageRefs（按 nodeRect 给成员排序）与
    // smartGroupCompactMembers（读 nodes 取组内成员）按引用注入，
    // 单图与网格两个布局函数在本模块内，继续把 deps 传下去。
    function smartGroupThumbLayout(node, deps = needDeps('smartGroupThumbLayout')){
        const {smartGroupImageRefs, smartGroupCompactMembers, mediaNodeDefaultScale, SMART_GROUP_MIN_WIDTH, SMART_GROUP_MIN_HEIGHT, SMART_GROUP_MAX_VISIBLE_ROWS, MEDIA_GROUP_THUMB_BASE} = deps;
        if(node?.gridSplitGroup || node?.isFrameGroup || (!node?.images?.length && (!Array.isArray(node?.items) || !node.items.length))) return null;
        const refs = smartGroupImageRefs(node).filter(ref => ref.item?.url);
        if(!refs.length) return null;
        const compactMembers = smartGroupCompactMembers(node);
        const count = refs.length + compactMembers.length;
        const items = refs.map(ref => ref.item);
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        const hasExplicit = Number.isFinite(explicitW) && explicitW >= SMART_GROUP_MIN_WIDTH
            && Number.isFinite(explicitH) && explicitH >= SMART_GROUP_MIN_HEIGHT;
        const scale = mediaNodeDefaultScale({type:'smart-image', images:items, scale:node?.scale});
        const summarySpace = 28;
        const outerPad = 32;
        if(count === 1){
            if(hasExplicit){
                return {
                    refs,
                    compactMembers,
                    cols:1,
                    rows:1,
                    visibleRows:1,
                    width:Math.round(explicitW),
                    height:Math.round(explicitH),
                    thumb:Math.round(96 * scale),
                    single:true,
                    innerW:Math.max(24, Math.round(explicitW - outerPad)),
                    innerH:Math.max(24, Math.round(explicitH - outerPad - summarySpace))
                };
            }
            const single = singleImageLayout(refs[0].item, {}, scale, deps);
            return {
                refs,
                compactMembers,
                ...single,
                width:Math.max(SMART_GROUP_MIN_WIDTH, Math.round(single.width + outerPad)),
                height:Math.max(SMART_GROUP_MIN_HEIGHT, Math.round(single.height + outerPad + summarySpace)),
                innerW:single.width,
                innerH:single.height
            };
        }
        const gap = 8;
        const maxVisibleRows = compactMembers.length ? count : SMART_GROUP_MAX_VISIBLE_ROWS;
        if(hasExplicit){
            const fitted = groupImageGridLayout(count, Math.max(72, explicitW - outerPad), Math.max(56, explicitH - outerPad - summarySpace), 100000, 0, gap, maxVisibleRows, deps);
            return {...fitted, refs, compactMembers, width:Math.round(explicitW), height:Math.round(explicitH)};
        }
        const thumb = Math.round(MEDIA_GROUP_THUMB_BASE * scale);
        const cell = thumb + gap;
        const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
        const rows = Math.ceil(count / cols);
        const visibleRows = Math.min(maxVisibleRows, rows);
        const gridW = cols * thumb + (cols - 1) * gap;
        const gridH = visibleRows * cell - gap;
        return {
            refs,
            compactMembers,
            cols,
            rows,
            visibleRows,
            thumb,
            width:Math.max(SMART_GROUP_MIN_WIDTH, Math.round(gridW + outerPad)),
            height:Math.max(SMART_GROUP_MIN_HEIGHT, Math.round(gridH + outerPad + summarySpace))
        };
    }

    // ===== 节点边界几何 =====
    function nodeRect(node, deps = needDeps('nodeRect')){
        const {imageLayout, smartNodeLayoutImages, nodeScale} = deps;
        // 生成中节点包含 pending 占位素材；位置计算必须和实际渲染使用同一份布局数据，
        // 否则点击生成后节点尺寸变化会把 composer/tool 台留在旧位置。
        const layout = imageLayout(smartNodeLayoutImages(node), nodeScale(node), node);
        return {x:node.x || 0, y:node.y || 0, width:layout.width, height:layout.height};
    }

    globalScope.SmartCanvasLayout = {
        nodeScale: nodeScale,
        emptyGenBoardSizeFromAspect: emptyGenBoardSizeFromAspect,
        smartGroupLayoutSize: smartGroupLayoutSize,
        mediaLayoutSize: mediaLayoutSize,
        standardImageFixedSize: standardImageFixedSize,
        singleImageLayout: singleImageLayout,
        groupImageGridLayout: groupImageGridLayout,
        smartNodeInputThumbRows: smartNodeInputThumbRows,
        smartNodeInputThumbsHeight: smartNodeInputThumbsHeight,
        smartNodeLayoutImages: smartNodeLayoutImages,
        imageLayout: imageLayout,
        smartGroupThumbLayout: smartGroupThumbLayout,
        nodeRect: nodeRect
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
