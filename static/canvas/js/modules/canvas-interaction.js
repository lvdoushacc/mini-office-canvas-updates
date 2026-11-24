/**
 * canvas-interaction.js - smart canvas interaction calculations.
 * DOM event handlers, drag state writes and guide rendering remain in the main file.
 */
(function attachSmartCanvasInteraction(globalScope) {
    function needDeps(name) {
        throw new Error('canvas-interaction: ' + name + ' requires injected dependencies');
    }

    function calculateSmartMagneticSnap(draggedNode, rawX, rawY, threshold = 10,
        deps = needDeps('calculateSmartMagneticSnap')) {
        const {viewport, imageLayout, nodeScale, dragState, nodes, nodeRect, SMART_LOG_PREVIEW_NODE_ID} = deps;
        if(!draggedNode) return {x: rawX, y: rawY, snappedX: false, snappedY: false, guides: []};
        const scale = viewport?.scale ? viewport.scale : 1;
        const snapThreshold = Math.max(6, Math.min(16, threshold / scale));
        const layout = imageLayout(draggedNode.images || [], nodeScale(draggedNode), draggedNode);
        const w = layout.width || draggedNode.w || 260;
        const h = layout.height || draggedNode.h || 200;
        const excludeIds = new Set([draggedNode.id, ...(dragState?.groupIds || [])]);
        if(SMART_LOG_PREVIEW_NODE_ID !== undefined) excludeIds.add(SMART_LOG_PREVIEW_NODE_ID);
        const candidateNodes = (nodes || []).filter(n => n && !excludeIds.has(n.id) && n.id !== SMART_LOG_PREVIEW_NODE_ID);
        if(!candidateNodes.length) return {x: rawX, y: rawY, snappedX: false, snappedY: false, guides: []};

        let snappedX = rawX, snappedY = rawY;
        let bestDx = null, minDistX = snapThreshold + 1, guideXList = [];
        let bestDy = null, minDistY = snapThreshold + 1, guideYList = [];
        candidateNodes.forEach(other => {
            const oRect = nodeRect(other);
            const ox = oRect.x, oy = oRect.y, ow = oRect.width, oh = oRect.height;
            const oright = ox + ow, obottom = oy + oh, ocx = ox + ow / 2, ocy = oy + oh / 2;
            const candidatesX = [
                {dx: ox - rawX, gx: ox}, {dx: oright - rawX, gx: oright},
                {dx: (ox - w) - rawX, gx: ox}, {dx: (oright - w) - rawX, gx: oright},
                {dx: (ocx - w / 2) - rawX, gx: ocx}
            ];
            candidatesX.forEach(({dx, gx}) => {
                const dist = Math.abs(dx);
                if(dist <= snapThreshold){
                    if(dist < minDistX){
                        minDistX = dist; bestDx = dx; guideXList = [{gx, other: oRect}];
                    } else if(Math.abs(dist - minDistX) < 0.01 && bestDx !== null && Math.abs(dx - bestDx) < 0.01){
                        guideXList.push({gx, other: oRect});
                    }
                }
            });
            const candidatesY = [
                {dy: oy - rawY, gy: oy}, {dy: obottom - rawY, gy: obottom},
                {dy: (oy - h) - rawY, gy: oy}, {dy: (obottom - h) - rawY, gy: obottom},
                {dy: (ocy - h / 2) - rawY, gy: ocy}
            ];
            candidatesY.forEach(({dy, gy}) => {
                const dist = Math.abs(dy);
                if(dist <= snapThreshold){
                    if(dist < minDistY){
                        minDistY = dist; bestDy = dy; guideYList = [{gy, other: oRect}];
                    } else if(Math.abs(dist - minDistY) < 0.01 && bestDy !== null && Math.abs(dy - bestDy) < 0.01){
                        guideYList.push({gy, other: oRect});
                    }
                }
            });
        });
        if(bestDx !== null) snappedX = Math.round((rawX + bestDx) * 10) / 10;
        if(bestDy !== null) snappedY = Math.round((rawY + bestDy) * 10) / 10;

        const guides = [];
        const verticalByX = new Map();
        guideXList.forEach(({gx, other}) => {
            const roundedGx = Math.round(gx);
            const y1 = Math.min(snappedY, other.y) - 24;
            const y2 = Math.max(snappedY + h, other.y + other.height) + 24;
            if(!verticalByX.has(roundedGx)) verticalByX.set(roundedGx, {type: 'vertical', x: roundedGx, y1, y2});
            else {
                const entry = verticalByX.get(roundedGx);
                entry.y1 = Math.min(entry.y1, y1); entry.y2 = Math.max(entry.y2, y2);
            }
        });
        verticalByX.forEach(g => guides.push(g));
        const horizontalByY = new Map();
        guideYList.forEach(({gy, other}) => {
            const roundedGy = Math.round(gy);
            const x1 = Math.min(snappedX, other.x) - 24;
            const x2 = Math.max(snappedX + w, other.x + other.width) + 24;
            if(!horizontalByY.has(roundedGy)) horizontalByY.set(roundedGy, {type: 'horizontal', y: roundedGy, x1, x2});
            else {
                const entry = horizontalByY.get(roundedGy);
                entry.x1 = Math.min(entry.x1, x1); entry.x2 = Math.max(entry.x2, x2);
            }
        });
        horizontalByY.forEach(g => guides.push(g));
        return {x: snappedX, y: snappedY, snappedX: bestDx !== null, snappedY: bestDy !== null, guides};
    }

    function screenToWorld(event, deps = needDeps('screenToWorld')) {
        const {shell, safeScale, viewport} = deps;
        const rect = shell ? shell.getBoundingClientRect() : {left: 0, top: 0};
        const s = safeScale(viewport.scale);
        const clientX = typeof event?.clientX === 'number' ? event.clientX : (event?.x ?? 0);
        const clientY = typeof event?.clientY === 'number' ? event.clientY : (event?.y ?? 0);
        return {
            x:(clientX - rect.left - viewport.x) / s,
            y:(clientY - rect.top - viewport.y) / s
        };
    }

    function worldToScreen(point, deps = needDeps('worldToScreen')) {
        const {shell, safeScale, viewport} = deps;
        const rect = shell ? shell.getBoundingClientRect() : {left: 0, top: 0};
        const s = safeScale(viewport.scale);
        const px = typeof point?.x === 'number' ? point.x : 0;
        const py = typeof point?.y === 'number' ? point.y : 0;
        return {
            x: rect.left + viewport.x + px * s,
            y: rect.top + viewport.y + py * s
        };
    }

    function viewportCenter(deps = needDeps('viewportCenter')) {
        const {shell, safeScale, viewport} = deps;
        const s = safeScale(viewport.scale);
        return {
            x:(shell.clientWidth / 2 - viewport.x) / s,
            y:(shell.clientHeight / 2 - viewport.y) / s
        };
    }

    function edgeAutoPanVelocity(clientX, clientY, rect, margin = 60, minSpeed = 1, maxSpeed = 10) {
        let vx = 0;
        let vy = 0;
        if(clientX < rect.left + margin){
            const dist = Math.max(0, clientX - rect.left);
            const ratio = Math.min(1, Math.max(0, (margin - dist) / margin));
            const ease = Math.pow(ratio, 2.0);
            vx = minSpeed + (maxSpeed - minSpeed) * ease;
        } else if(clientX > rect.right - margin){
            const dist = Math.max(0, rect.right - clientX);
            const ratio = Math.min(1, Math.max(0, (margin - dist) / margin));
            const ease = Math.pow(ratio, 2.0);
            vx = -(minSpeed + (maxSpeed - minSpeed) * ease);
        }
        if(clientY < rect.top + margin){
            const dist = Math.max(0, clientY - rect.top);
            const ratio = Math.min(1, Math.max(0, (margin - dist) / margin));
            const ease = Math.pow(ratio, 2.0);
            vy = minSpeed + (maxSpeed - minSpeed) * ease;
        } else if(clientY > rect.bottom - margin){
            const dist = Math.max(0, rect.bottom - clientY);
            const ratio = Math.min(1, Math.max(0, (margin - dist) / margin));
            const ease = Math.pow(ratio, 2.0);
            vy = -(minSpeed + (maxSpeed - minSpeed) * ease);
        }
        return {x: vx, y: vy};
    }

    function selectionRect(a, b) {
        const ax = a.x;
        const ay = a.y;
        const bx = b.x;
        const by = b.y;
        const left = Math.min(ax, bx);
        const top = Math.min(ay, by);
        const right = Math.max(ax, bx);
        const bottom = Math.max(ay, by);
        return {left, top, right, bottom, x:left, y:top, width:right - left, height:bottom - top};
    }

    function nodeIdsInSelection(currentNodes, bounds, nodeRect) {
        return (currentNodes || []).filter(node => {
            const rect = nodeRect(node);
            return rect.x < bounds.right && rect.x + rect.width > bounds.left
                && rect.y < bounds.bottom && rect.y + rect.height > bounds.top;
        }).map(node => node.id);
    }

    globalScope.SmartCanvasInteraction = {
        calculateSmartMagneticSnap,
        screenToWorld,
        worldToScreen,
        viewportCenter,
        edgeAutoPanVelocity,
        selectionRect,
        nodeIdsInSelection
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
