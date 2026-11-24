/**
 * canvas-renderer.js —— 智能画布连线绘制层（画布拆分第 4.3 阶段）
 *
 * 只放不持有状态的渲染计算：连线 SVG、连接选中 class、视口可见区域几何。
 * renderConnections、updateConnectionSelection、connectionMidpoint、
 * canvasWorldBounds、isNodeInRenderWindow、isSmartNodeRenderActive、
 * visibleCanvasNodes。
 *
 * 四条硬约束：
 * 1. 不声明全局、不持有可变状态。nodes / canvas / smartCascadeRunPath / loopInsertPreview
 *    等一律由 smart-canvas.js 的同名包装在调用期按引用注入（见 rendererDeps()），
 *    本模块不复制第二份真源。
 * 2. 不查 DOM。updateConnectionSelection 要改选中 class，宿主元素是注入进来的 `world`
 *    句柄；模块里没有 document / window / getElementById 这类自由标识符。
 * 3. deps 缺失一律抛错（见 needDeps）。原函数大量使用 `?.` 与 `|| []` 兜底，
 *    放任 deps 为空会**静默**少画连线，而不是报错。
 * 4. 必须在 smart-canvas.js 之前加载，解析期不读取任何外部全局；
 *    只暴露 window.SmartCanvasRenderer。
 *
 * 小地图（renderMinimap / renderMinimapDirect）没有搬进来：它持有五个主文件可变
 * `let` 状态（raf 句柄、投影几何、节点矩形表、元素 Map、dirty 标记）并直接建 DOM，
 * 搬动等于复制状态或大规模改写，理由记在 docs/canvas-split-plan.md 第 4.3 阶段。
 */
(function attachSmartCanvasRenderer(globalScope) {

    function needDeps(name) {
        throw new Error('canvas-renderer: ' + name +
            ' 需要调用方注入绘制依赖，请通过 smart-canvas.js 的同名包装函数调用');
    }

    // ===== 连线层 SVG =====
    function renderConnections(deps = needDeps('renderConnections')){
        const {nodes, canvas, selectedNodeIds, nodeRect, smartGroupScopeId, cascadeConnectionKeys, smartCascadeEdgeState, smartCascadeRunPath, loopInsertPreview, escapeAttr} = deps;
        const nodeById = new Map((nodes || []).filter(node => node && node.id).map(node => [node.id, node]));
        const conns = (canvas?.connections || []).map((conn, index) => ({...conn, index})).filter(c => nodeById.has(c.from) && nodeById.has(c.to));
        const cascadeKeys = cascadeConnectionKeys();
        const activeCascadeCount = (smartCascadeRunPath?.states && Object.values(smartCascadeRunPath.states).filter(state => state && state !== 'done').length) || 0;
        const reduceMotion = activeCascadeCount > 24;
        const selectedConnIds = new Set(selectedNodeIds());
        // 合并连线：同一来源连到同一分组的多个成员，合成一条到分组的连线（A→A1/A2/A3 显示为 A→分组），
        // 减少“每张图都拖一条线”的杂乱。history 连线不合并。
        const buckets = new Map();
        const items = [];
        conns.forEach(conn => {
            const kind = conn.kind || 'flow';
            const fromScope = kind === 'history' ? '' : smartGroupScopeId(conn.from);
            const toScope = kind === 'history' ? '' : smartGroupScopeId(conn.to);
            // 同一分组内部的连线（成员↔成员、成员↔分组本体）属于内部关系，入组后隐藏，保持整洁。
            if(fromScope && fromScope === toScope) return;
            // 终点是某分组的成员：把同一来源连到该分组各成员的线合并成一条到分组的线。
            const isMemberTarget = toScope && toScope !== conn.to;
            if(isMemberTarget){
                const key = `${conn.from}|${toScope}|${kind}`;
                let b = buckets.get(key);
                if(!b){ b = {merged:true, from:conn.from, toId:toScope, kind, indices:[], targets:[]}; buckets.set(key, b); items.push(b); }
                b.indices.push(conn.index);
                b.targets.push(conn.to);
            } else {
                items.push({merged:false, from:conn.from, toId:conn.to, kind, indices:[conn.index], targets:[conn.to]});
            }
        });
        const paths = items.map(item => {
            const fromNode = nodeById.get(item.from);
            const toNode = nodeById.get(item.toId);
            if(!fromNode || !toNode) return '';
            const fr = nodeRect(fromNode), tr = nodeRect(toNode);
            const kind = item.kind;
            const isHistory = kind === 'history';
            const dataIndex = item.indices.join(',');
            const isInsertPreview = item.indices.some(i => loopInsertPreview?.index === i);
            const edgeKeys = item.targets.map(t => `${item.from}->${t}`);
            const states = edgeKeys.map(smartCascadeEdgeState).filter(Boolean);
            let cascadeState = '';
            if(states.includes('active')) cascadeState = 'active';
            else if(states.some(s => s !== 'done')) cascadeState = states.find(s => s !== 'done');
            else if(states.length) cascadeState = 'done';
            const isCascade = !isHistory && (edgeKeys.some(k => cascadeKeys.has(k)) || Boolean(cascadeState) || isInsertPreview);
            const isPendingLine = !isCascade && item.targets.some(t => nodeById.get(t)?.pending);
            const isSelectedLine = selectedConnIds.size > 0 && (selectedConnIds.has(item.from) || selectedConnIds.has(item.toId) || item.targets.some(t => selectedConnIds.has(t)));
            const fx = isHistory ? fr.x + fr.width / 2 : fr.x + fr.width;
            const fy = isHistory ? fr.y + fr.height : fr.y + fr.height / 2;
            const tx = isHistory ? tr.x + tr.width / 2 : tr.x;
            const ty = isHistory ? tr.y : tr.y + tr.height / 2;
            const dx = Math.max(50, Math.abs(tx - fx) * 0.45);
            const dy = Math.max(36, Math.abs(ty - fy) * 0.45);
            const curve = isHistory
                ? `M${fx} ${fy} C ${fx} ${fy+dy}, ${tx} ${ty-dy}, ${tx} ${ty}`
                : `M${fx} ${fy} C ${fx+dx} ${fy}, ${tx-dx} ${ty}, ${tx} ${ty}`;
            const mx = (fx + tx) / 2, my = (fy + ty) / 2;
            const cls = [
                isPendingLine ? 'conn-pending' : '',
                isCascade ? 'conn-cascade' : '',
                isCascade && cascadeState === 'done' ? 'conn-cascade-done' : '',
                isCascade && Boolean(cascadeState) && cascadeState !== 'done' ? 'conn-cascade-wait' : '',
                isCascade && cascadeState === 'active' ? 'conn-cascade-active' : '',
                isHistory ? 'conn-history' : '',
                isSelectedLine ? 'conn-selected' : ''
            ].filter(Boolean).join(' ');
            const color = isCascade ? '#16a34a' : isHistory ? 'rgba(100,116,139,0.46)' : kind === 'input' ? 'rgba(100,116,139,0.62)' : 'rgba(148,163,184,0.62)';
            const opacity = isPendingLine ? '.82' : '1';
            const width = kind === 'input' ? '1.4' : '1.2';
            const targetIds = escapeAttr((item.targets || []).join(','));
            const selCls = isSelectedLine ? ' conn-selected' : '';
            return `<path class="${cls} conn-line" data-conn-index="${dataIndex}" data-from="${escapeAttr(item.from)}" data-to="${escapeAttr(item.toId)}" data-targets="${targetIds}" d="${curve}" stroke="${color}" stroke-width="${width}" fill="none" opacity="${opacity}"></path><path class="conn-hit${selCls}" data-conn-index="${dataIndex}" d="${curve}" stroke="transparent" stroke-width="16" fill="none"></path><circle class="conn-end${selCls}" data-conn-index="${dataIndex}" cx="${tx}" cy="${ty}" r="2.6" fill="${color}" opacity=".66"></circle>`;
        }).join('');
        return `<svg class="connection-layer ${reduceMotion ? 'conn-reduce-motion' : ''}" style="overflow:visible;" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
    }

    // ===== 连线选中状态 =====
    function updateConnectionSelection(deps = needDeps('updateConnectionSelection')){
        const {world, selectedNodeIds} = deps;
        const svg = world?.querySelector('svg.connection-layer');
        if(!svg) return;
        const selected = new Set(selectedNodeIds().map(String));
        const activeIndices = new Set();
        svg.querySelectorAll('path.conn-line').forEach(path => {
            const from = String(path.dataset.from || '');
            const to = String(path.dataset.to || '');
            const targets = String(path.dataset.targets || '').split(',').filter(Boolean);
            const on = selected.size > 0 && (selected.has(from) || selected.has(to) || targets.some(id => selected.has(id)));
            path.classList.toggle('conn-selected', on);
            if(on && path.dataset.connIndex){
                activeIndices.add(path.dataset.connIndex);
            }
        });
        svg.querySelectorAll('path.conn-hit, circle.conn-end').forEach(el => {
            const on = activeIndices.has(el.dataset.connIndex);
            el.classList.toggle('conn-selected', on);
        });
    }

    // ===== 连线端点几何 =====
    function connectionMidpoint(conn, deps = needDeps('connectionMidpoint')){
        const {nodes, nodeRect} = deps;
        const fromNode = nodes.find(n => n.id === conn?.from);
        const toNode = nodes.find(n => n.id === conn?.to);
        if(!fromNode || !toNode) return null;
        const fr = nodeRect(fromNode), tr = nodeRect(toNode);
        if((conn.kind || 'flow') === 'history'){
            return {x:(fr.x + fr.width / 2 + tr.x + tr.width / 2) / 2, y:(fr.y + fr.height + tr.y) / 2};
        }
        return {x:(fr.x + fr.width + tr.x) / 2, y:(fr.y + fr.height / 2 + tr.y + tr.height / 2) / 2};
    }

    // ===== 视口可见区域几何 =====
    function canvasWorldBounds(buffer, deps = needDeps('canvasWorldBounds')){
        const {safeScale, viewport, shell, viewportWidth, viewportHeight, SMART_CANVAS_RENDER_BUFFER} = deps;
        const scale = safeScale(viewport?.scale || 1);
        const width = Math.max(1, shell?.clientWidth || viewportWidth || 1280);
        const height = Math.max(1, shell?.clientHeight || viewportHeight || 720);
        const pad = Math.max(240, Number(buffer) || SMART_CANVAS_RENDER_BUFFER);
        return {
            left: -viewport.x / scale - pad,
            top: -viewport.y / scale - pad,
            right: -viewport.x / scale + width / scale + pad,
            bottom: -viewport.y / scale + height / scale + pad
        };
    }

    function isNodeInRenderWindow(node, bounds, deps = needDeps('isNodeInRenderWindow')){
        const {nodeRect} = deps;
        if(!node || !bounds) return false;
        const rect = nodeRect(node);
        return rect.x + rect.width >= bounds.left && rect.x <= bounds.right
            && rect.y + rect.height >= bounds.top && rect.y <= bounds.bottom;
    }

    function isSmartNodeRenderActive(node, activeIds = null, deps = needDeps('isSmartNodeRenderActive')){
        const {nodeHasLiveToolSession, activeComposerSubject, selectedImage, dragState} = deps;
        if(!node?.id) return false;
        const id = String(node.id);
        if(activeIds?.has(id)) return true;
        if(node.running || nodeHasLiveToolSession(id)) return true;
        if(activeComposerSubject?.id && String(activeComposerSubject.id) === id) return true;
        if(selectedImage?.nodeId && String(selectedImage.nodeId) === id) return true;
        if(dragState && (String(dragState.id) === id || (dragState.group || []).some(item => String(item?.id) === id))) return true;
        return false;
    }

    function visibleCanvasNodes(currentNodes, deps = needDeps('visibleCanvasNodes')){
        const {
            selectedNodeIds, SMART_CANVAS_ACTIVE_NODE_LIMIT, selectedId, dragState
        } = deps;
        const list = Array.isArray(currentNodes) ? currentNodes : [];
        const bounds = canvasWorldBounds(undefined, deps);
        const selected = selectedNodeIds().map(String);
        const activeIds = new Set();
        // 批量导入会暂时选中整组节点。只保留小规模选择，避免“全选”让虚拟化失效。
        if(selected.length <= SMART_CANVAS_ACTIVE_NODE_LIMIT){
            selected.forEach(id => activeIds.add(id));
        }
        if(selectedId) activeIds.add(String(selectedId));
        if(dragState){
            if(dragState.id) activeIds.add(String(dragState.id));
            (dragState.group || []).forEach(item => item?.id && activeIds.add(String(item.id)));
        }
        return list.filter(node => isSmartNodeRenderActive(node, activeIds, deps) || isNodeInRenderWindow(node, bounds, deps));
    }

    function minimapGeometry(rects, width, height){
        const list = Array.isArray(rects) ? rects : [];
        const minNodeX = list.length ? Math.min(...list.map(r => r.x)) : 0;
        const minNodeY = list.length ? Math.min(...list.map(r => r.y)) : 0;
        const maxNodeX = list.length ? Math.max(...list.map(r => r.x + r.width)) : 0;
        const maxNodeY = list.length ? Math.max(...list.map(r => r.y + r.height)) : 0;
        const minX = Math.min(minNodeX - 200, -200);
        const minY = Math.min(minNodeY - 200, -200);
        const maxX = Math.max(maxNodeX + 200, 200);
        const maxY = Math.max(maxNodeY + 200, 200);
        const scale = Math.min(width / Math.max(1, maxX - minX), height / Math.max(1, maxY - minY));
        const offsetX = (width - (maxX - minX) * scale) / 2;
        const offsetY = (height - (maxY - minY) * scale) / 2;
        return {minX, minY, scale, offsetX, offsetY, width, height};
    }

    function projectMinimapRect(rect, state){
        const {minX, minY, scale, offsetX, offsetY} = state;
        return {
            left:offsetX + (rect.x - minX) * scale,
            top:offsetY + (rect.y - minY) * scale,
            width:Math.max(4, rect.width * scale),
            height:Math.max(4, rect.height * scale)
        };
    }

    globalScope.SmartCanvasRenderer = {
        renderConnections: renderConnections,
        updateConnectionSelection: updateConnectionSelection,
        connectionMidpoint: connectionMidpoint,
        canvasWorldBounds: canvasWorldBounds,
        isNodeInRenderWindow: isNodeInRenderWindow,
        isSmartNodeRenderActive: isSmartNodeRenderActive,
        visibleCanvasNodes: visibleCanvasNodes,
        minimapGeometry: minimapGeometry,
        projectMinimapRect: projectMinimapRect
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
