/** Pure generation provider and model helpers. */
(function attachSmartCanvasGeneration(globalScope) {
    function isApiLikeEngine(engine) {
        return ['api', 'volcengine'].includes(String(engine || '').toLowerCase());
    }

    function smartLoopRoundSettings(runSettings, context) {
        const next = {...(runSettings || {})};
        const imageCountEngine = isApiLikeEngine(next.engine)
            ? next.apiKind !== 'video'
            : next.engine === 'modelscope';
        if(context?.nodeId && imageCountEngine) next.count = 1;
        return next;
    }

    function isGptImageAutoSizeModel(model) {
        const raw = String(model || '').trim().toLowerCase();
        const normalized = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const compact = raw.replace(/[^a-z0-9]+/g, '');
        return normalized === 'gpt-image-2'
            || normalized.startsWith('gpt-image-2-')
            || normalized.endsWith('-gpt-image-2')
            || normalized.includes('-gpt-image-2-')
            || compact === 'gptimage2'
            || compact.startsWith('gptimage2')
            || compact.endsWith('gptimage2');
    }

    function isGptImage25Model(model) {
        const raw = String(model || '').trim().toLowerCase();
        const normalized = raw.replace(/[^a-z0-9]+/g, '-');
        const compact = raw.replace(/[^a-z0-9]+/g, '');
        return normalized.includes('gpt-image-2-5') || compact.includes('gptimage25');
    }

    function defaultSmartApiResolution(model) {
        return isGptImageAutoSizeModel(model) ? '4k' : '1k';
    }

    function runningHubEntryKey(kind, id) {
        return `${kind}:${String(id || '').trim()}`;
    }

    function parseRunningHubEntryKey(value) {
        const text = String(value || '').trim();
        const match = text.match(/^(app|workflow|model):(.+)$/);
        return match ? {kind:match[1], id:match[2].trim()} : null;
    }

    function rhWorkflowJsonFromSources(...sources) {
        for(const source of sources){
            if(source && typeof source === 'object' && Object.keys(source).length) return source;
        }
        return {};
    }

    function rhUsableFields(fields) {
        const list = Array.isArray(fields) ? fields : [];
        if(!list.length) return [];
        const enabled = list.filter(field => field.enabled === true);
        return enabled.length ? enabled : list;
    }

    globalScope.SmartCanvasGeneration = {
        isApiLikeEngine,
        smartLoopRoundSettings,
        isGptImageAutoSizeModel,
        isGptImage25Model,
        defaultSmartApiResolution,
        runningHubEntryKey,
        parseRunningHubEntryKey,
        rhWorkflowJsonFromSources,
        rhUsableFields
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
