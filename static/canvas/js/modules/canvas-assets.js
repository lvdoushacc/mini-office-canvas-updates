/** Pure asset classification, URL matching and upload validation helpers. */
(function attachSmartCanvasAssets(globalScope) {
    function assetSmartClassKey(entry) {
        if(!entry?.dimension || !entry?.tag) return '';
        return `${String(entry.dimension)}::${String(entry.tag)}`;
    }

    function assetSmartClassOptionId(entry, prefix) {
        const key = assetSmartClassKey(entry);
        return key ? `${prefix}${key}` : '';
    }

    function parseAssetSmartClassId(id = '', prefix) {
        const value = String(id || '');
        if(!value.startsWith(prefix)) return null;
        const raw = value.slice(prefix.length);
        const index = raw.indexOf('::');
        if(index < 0) return null;
        return {dimension:raw.slice(0, index), tag:raw.slice(index + 2)};
    }

    function normalizeAssetUrlForMatch(rawUrl) {
        if(!rawUrl || typeof rawUrl !== 'string') return '';
        let value = rawUrl.trim();
        if(!value) return '';
        try {
            if(value.startsWith('http://') || value.startsWith('https://')) value = new URL(value).pathname;
        } catch(_) {}
        value = value.split('?')[0].split('#')[0];
        value = value.replace(/\\/g, '/');
        try {
            value = decodeURIComponent(value);
        } catch(_) {}
        value = value.trim().toLowerCase();
        if(value && !value.startsWith('/')) value = '/' + value;
        return value;
    }

    function isSupportedUploadFile(file) {
        const type = String(file?.type || '').toLowerCase();
        const name = String(file?.name || '').toLowerCase();
        return type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')
            || /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name);
    }

    function smartUploadRejectReason(files, maxBytes, acceptHint) {
        const list = [...(files || [])];
        if(!list.length) return '没有可上传的文件';
        const unsupported = list.filter(file => !isSupportedUploadFile(file));
        if(unsupported.length === list.length) return `格式不支持。${acceptHint}`;
        const oversized = list.filter(file => isSupportedUploadFile(file) && Number(file.size || 0) > maxBytes);
        if(oversized.length){
            const name = oversized[0]?.name || '文件';
            return `「${name}」超过 100MB 限制。${acceptHint}`;
        }
        return '';
    }

    globalScope.SmartCanvasAssets = {
        assetSmartClassKey,
        assetSmartClassOptionId,
        parseAssetSmartClassId,
        normalizeAssetUrlForMatch,
        isSupportedUploadFile,
        smartUploadRejectReason
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
