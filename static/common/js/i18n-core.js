(function(){
    const KEY = 'studio_lang';
    const DEFAULT_LANG = 'zh';
    const dict = { zh: {}, en: {} };

    function lang(){
        return localStorage.getItem(KEY) || DEFAULT_LANG;
    }

    function normalizeEntry(key, entry){
        if(entry && typeof entry === 'object' && !Array.isArray(entry) && ('zh' in entry || 'en' in entry)){
            return {
                zh: entry.zh == null ? (entry.en == null ? key : String(entry.en)) : String(entry.zh),
                en: entry.en == null ? (entry.zh == null ? key : String(entry.zh)) : String(entry.en),
            };
        }
        const value = entry == null ? key : String(entry);
        return { zh: value, en: value };
    }

    function register(bundle){
        if(!bundle || typeof bundle !== 'object') return;
        if(bundle.zh || bundle.en){
            Object.assign(dict.zh, bundle.zh || {});
            Object.assign(dict.en, bundle.en || {});
        } else {
            Object.entries(bundle).forEach(([key, entry]) => {
                const normalized = normalizeEntry(key, entry);
                dict.zh[key] = normalized.zh;
                dict.en[key] = normalized.en;
            });
        }
        // 当有新词条注册且页面已准备好时，自动刷新一次页面翻译
        if(document.readyState !== 'loading'){
            try { apply(); } catch(e){}
        }
    }

    function t(key, fallback){
        if(!key) return fallback || '';
        const current = lang();
        const found = dict[current]?.[key] || dict[DEFAULT_LANG]?.[key];
        if(found !== undefined && found !== null && found !== '') return found;
        if(fallback !== undefined && fallback !== null) return fallback;
        // 中文优先保护：如果未找到词条且 key 为系统键（如 smart.xxx / canvas.xxx），严禁将原始键名暴露在 UI 上
        if(typeof key === 'string' && (key.startsWith('smart.') || key.startsWith('canvas.') || key.startsWith('studio.'))){
            return fallback || '';
        }
        return key;
    }

    function apply(root=document){
        if(!root || !root.querySelectorAll) return;
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if(!key) return;
            const current = lang();
            const translated = dict[current]?.[key] || dict[DEFAULT_LANG]?.[key];
            if(translated){
                el.textContent = translated;
            }
            // 若未找到字典项，保留其原有已写好的中文文本，绝不以 raw key (如 smart.createUploadTitle) 覆盖
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            if(!key) return;
            const translated = dict[lang()]?.[key] || dict[DEFAULT_LANG]?.[key];
            if(translated) el.setAttribute('placeholder', translated);
        });
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.dataset.i18nTitle;
            if(!key) return;
            const translated = dict[lang()]?.[key] || dict[DEFAULT_LANG]?.[key];
            if(translated) el.setAttribute('title', translated);
        });
        root.documentElement?.setAttribute('lang', lang() === 'en' ? 'en' : 'zh-CN');
        window.dispatchEvent(new CustomEvent('studio-lang-change', { detail:{ lang:lang() } }));
    }

    function set(next){
        localStorage.setItem(KEY, next === 'en' ? 'en' : 'zh');
        apply();
    }

    function toggle(){
        set(lang() === 'en' ? 'zh' : 'en');
    }

    function entries(){
        return JSON.parse(JSON.stringify(dict));
    }

    window.StudioI18n = { t, apply, set, toggle, lang, register, entries };
    if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', () => apply());
    } else {
        apply();
    }
})();
