/** Pure media editor geometry and result matching helpers. */
(function attachSmartCanvasMediaEditor(globalScope) {
    function gridJoinAutoDims(count) {
        const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
        return {rows:Math.max(1, Math.ceil(count / cols)), cols};
    }

    function gridJoinItemDisplaySize(entry, cell) {
        return {w:Math.max(1, Math.round(cell.w)), h:Math.max(1, Math.round(cell.h))};
    }

    function gridJoinVisualOrder(layout) {
        return (layout?.items || []).slice()
            .sort((a, b) => (Number(a.y || 0) - Number(b.y || 0)) || (Number(a.x || 0) - Number(b.x || 0)))
            .map(item => Number(item.index));
    }

    function regularGridRects(width, height, rows, cols, gap) {
        const halfGap = gap / 2;
        const rects = [];
        for(let row = 0; row < rows; row++){
            const topLine = row * height / rows;
            const bottomLine = (row + 1) * height / rows;
            const y1 = Math.round(row === 0 ? 0 : topLine + halfGap);
            const y2 = Math.round(row === rows - 1 ? height : bottomLine - halfGap);
            for(let col = 0; col < cols; col++){
                const leftLine = col * width / cols;
                const rightLine = (col + 1) * width / cols;
                const x1 = Math.round(col === 0 ? 0 : leftLine + halfGap);
                const x2 = Math.round(col === cols - 1 ? width : rightLine - halfGap);
                if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
            }
        }
        return rects;
    }

    function customGridRects(width, height, lines, gap) {
        const halfGap = gap / 2;
        const list = Array.isArray(lines) ? lines : [];
        const rawH = [...new Set(list.filter(line => line.type === 'h').map(line => line.pos * height))].sort((a, b) => a - b);
        const rawV = [...new Set(list.filter(line => line.type === 'v').map(line => line.pos * width))].sort((a, b) => a - b);
        const hCuts = [0, ...rawH, height];
        const vCuts = [0, ...rawV, width];
        const rects = [];
        for(let row = 0; row < hCuts.length - 1; row++) for(let col = 0; col < vCuts.length - 1; col++){
            const y1 = Math.round(row === 0 ? hCuts[row] : hCuts[row] + halfGap);
            const y2 = Math.round(row === hCuts.length - 2 ? hCuts[row + 1] : hCuts[row + 1] - halfGap);
            const x1 = Math.round(col === 0 ? vCuts[col] : vCuts[col] + halfGap);
            const x2 = Math.round(col === vCuts.length - 2 ? vCuts[col + 1] : vCuts[col + 1] - halfGap);
            if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
        }
        return rects;
    }

    function clampImageResizeScale(value) {
        const number = Number(value);
        if(!Number.isFinite(number)) return 0.5;
        return Math.max(0.05, Math.min(1, Math.round(number * 100) / 100));
    }

    function circledNumber(number) {
        return number >= 1 && number <= 20 ? String.fromCharCode(0x2460 + number - 1) : String(number);
    }

    function pairFilesToSliceBlobs(files, blobs) {
        const list = Array.isArray(files) ? files : [];
        const wanted = Array.isArray(blobs) ? blobs : [];
        const used = new Set();
        return wanted.map(item => {
            const index = list.findIndex((file, key) => !used.has(key) && file && file.name && item && file.name === item.name);
            if(index < 0) return {blob:item, file:null};
            used.add(index);
            return {blob:item, file:list[index]};
        });
    }

    globalScope.SmartCanvasMediaEditor = {
        gridJoinAutoDims,
        gridJoinItemDisplaySize,
        gridJoinVisualOrder,
        regularGridRects,
        customGridRects,
        clampImageResizeScale,
        circledNumber,
        pairFilesToSliceBlobs
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
