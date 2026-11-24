(function(){
    const KEY = 'studio_theme';
    const LEGACY_KEY = 'canvas_theme';
    const SCALE_KEY = 'studio_ui_scale_mode';
    const SCALE_OPTIONS = ['auto', '60', '65', '70', '75', '80', '85', '90', '95', '100', '115', '125', '140'];

    function currentTheme(){
        try {
            if (isFramed() && window.parent && window.parent !== window) {
                const parentTheme = window.parent.__XXPD_APP__?.currentTheme || window.parent.app?.currentTheme;
                if (parentTheme === 'dark' || parentTheme === 'light') return parentTheme;
            }
        } catch(e) {}
        try {
            const localTheme = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || localStorage.getItem('xxdp_theme');
            if (localTheme === 'dark' || localTheme === 'light') return localTheme;
        } catch(e) {}
        var urlTheme = new URLSearchParams(window.location.search).get('theme');
        if (urlTheme === 'dark' || urlTheme === 'light') return urlTheme;
        return 'dark';
    }

    function applyTheme(theme){
        const next = theme === 'dark' ? 'dark' : 'light';
        const dark = next === 'dark';
        const root = document.documentElement;
        root.classList.add('theme-switching');
        requestAnimationFrame(() => root.classList.remove('theme-switching'));
        document.documentElement.classList.toggle('studio-theme-dark', dark);
        document.documentElement.classList.toggle('theme-dark', dark);
        document.documentElement.setAttribute('data-theme', next);
        if(document.body){
            document.body.classList.toggle('studio-theme-dark', dark);
            document.body.classList.toggle('theme-dark', dark);
            document.body.setAttribute('data-theme', next);
        }
        window.dispatchEvent(new CustomEvent('studio-theme-change', { detail: { theme: next } }));
    }

    function ensureScaleStyle(){
        if(document.getElementById('studio-scale-style')) return;
        const style = document.createElement('style');
        style.id = 'studio-scale-style';
        style.textContent = `
            html, body {
                touch-action: pan-x pan-y;
                -webkit-text-size-adjust: 100%;
                text-size-adjust: 100%;
            }
            html.studio-scale-managed {
                --studio-ui-scale: 1;
            }
            html.studio-ui-scaled,
            html.studio-ui-scaled body {
                overscroll-behavior-x: none;
            }
            html.studio-ui-scaled {
                overflow-x: hidden !important;
            }
            html.studio-ui-scaled::-webkit-scrollbar:horizontal,
            html.studio-ui-scaled body::-webkit-scrollbar:horizontal {
                height: 0 !important;
            }
            /* 遵守项目规则：禁止通过整体缩放或 transform: scale() 放大 UI，保证文本与图标清晰 */
            html.studio-ui-scaled body:not(.studio-scale-host) {
                width: 100% !important;
                min-height: 100vh !important;
                transform: none !important;
            }
            html.studio-ui-scaled body.studio-scale-viewport:not(.studio-scale-host) {
                height: 100vh !important;
            }
            html.studio-ui-scaled body:not(.studio-scale-host) > .app-shell,
            html.studio-ui-scaled body:not(.studio-scale-host) > .shell,
            html.studio-ui-scaled body:not(.studio-scale-host) > .asset-page {
                width: 100% !important;
            }
            html.studio-ui-scaled body:not(.studio-scale-host) > .app-shell,
            html.studio-ui-scaled body:not(.studio-scale-host) > .shell {
                height: 100vh !important;
            }
            html.studio-ui-scaled body:not(.studio-scale-host) > .asset-page {
                min-height: 100vh !important;
            }
        `;
        document.head.appendChild(style);
    }

    function isFramed(){
        try {
            return window.self !== window.top;
        } catch(e) {
            return true;
        }
    }

    function normalizeScaleMode(mode){
        return SCALE_OPTIONS.includes(mode) ? mode : 'auto';
    }

    function currentScaleMode(){
        try {
            return normalizeScaleMode(localStorage.getItem(SCALE_KEY) || 'auto');
        } catch(e) {
            return 'auto';
        }
    }

    function autoScale(){
        const dpr = Math.max(1, Number(window.devicePixelRatio || 1));
        const viewportWidth = Math.max(320, Number(window.innerWidth || 0));
        const viewportHeight = Math.max(320, Number(window.innerHeight || 0));
        const compactRatio = Math.min(viewportWidth / 1500, viewportHeight / 940);
        if(compactRatio < 1) {
            return Math.max(0.68, Math.min(1, compactRatio));
        }
        const screenLong = Math.max(window.screen?.width || 0, window.screen?.height || 0);
        const viewportLong = Math.max(viewportWidth, viewportHeight);
        const longEdge = Math.max(screenLong, viewportLong);
        if(dpr >= 1.35) return 1;
        if(longEdge >= 3600) return 1.22;
        if(longEdge >= 3000) return 1.16;
        if(longEdge >= 2500 && dpr <= 1.15) return 1.1;
        return 1;
    }

    function scaleForMode(mode){
        const next = normalizeScaleMode(mode);
        if(next === 'auto' && Number.isFinite(externalScaleValue)) return externalScaleValue;
        if(next === 'auto') return autoScale();
        return Math.max(0.58, Math.min(1.4, Number(next) / 100));
    }

    let externalScaleValue = null;
    function normalizeExternalScale(value){
        const next = Number(value);
        return Number.isFinite(next) ? Math.max(0.58, Math.min(1.4, next)) : null;
    }

    function appliedScale(){
        const cssValue = Number(getComputedStyle(document.documentElement).getPropertyValue('--studio-ui-scale'));
        return Number.isFinite(cssValue) && cssValue > 0 ? cssValue : scaleForMode(currentScaleMode());
    }

    function updateScaleBodyClasses(){
        if(!document.body) return;
        const hasFrameHost = !!document.querySelector('.app-shell iframe, iframe.active');
        document.body.classList.toggle('studio-scale-host', hasFrameHost && !isFramed());
        const computed = window.getComputedStyle(document.body);
        const viewportLocked = computed.overflow === 'hidden' || computed.overflowY === 'hidden' || !!document.querySelector('.app-shell, .shell');
        document.body.classList.toggle('studio-scale-viewport', viewportLocked);
    }

    function scaleOptedOut(){
        return document.documentElement.dataset.studioScale === 'off';
    }

    function contentFitOptedOut(){
        return document.documentElement.dataset.studioFitScale === 'off';
    }

    let horizontalScrollLockPending = false;
    function lockScaledHorizontalScroll(){
        if(horizontalScrollLockPending || !document.documentElement.classList.contains('studio-ui-scaled')) return;
        if(Math.abs(window.scrollX || 0) < 1) return;
        horizontalScrollLockPending = true;
        requestAnimationFrame(() => {
            horizontalScrollLockPending = false;
            if(document.documentElement.classList.contains('studio-ui-scaled') && Math.abs(window.scrollX || 0) >= 1) {
                window.scrollTo(0, window.scrollY || 0);
            }
        });
    }

    let contentFitTimer = null;
    function scheduleContentFit(mode){
        clearTimeout(contentFitTimer);
        if(mode !== 'auto' || scaleOptedOut() || contentFitOptedOut() || Number.isFinite(externalScaleValue)) return;
        contentFitTimer = setTimeout(() => {
            const root = document.documentElement;
            if(!root.classList.contains('studio-ui-scaled')) return;
            const current = Number(getComputedStyle(root).getPropertyValue('--studio-ui-scale')) || 1;
            const viewportWidth = Math.max(320, Number(window.innerWidth || 0));
            const contentWidth = Math.max(
                viewportWidth,
                root.scrollWidth || 0,
                document.body?.scrollWidth || 0,
                document.body?.offsetWidth || 0
            );
            const fitted = Math.max(0.58, Math.min(current, viewportWidth / contentWidth));
            if(fitted < current - 0.006) {
                root.style.setProperty('--studio-ui-scale', fitted.toFixed(3));
                lockScaledHorizontalScroll();
            }
        }, 80);
    }

    function applyScale(mode){
        ensureScaleStyle();
        const next = normalizeScaleMode(mode);
        const optedOut = scaleOptedOut();
        const value = scaleForMode(next);
        const scaled = !optedOut && Math.abs(value - 1) > 0.01;
        document.documentElement.classList.add('studio-scale-managed');
        document.documentElement.classList.toggle('studio-ui-scaled', scaled);
        document.documentElement.style.setProperty('--studio-ui-scale', value.toFixed(3));
        updateScaleBodyClasses();
        lockScaledHorizontalScroll();
        scheduleContentFit(next);
        window.dispatchEvent(new CustomEvent('studio-ui-scale-change', { detail: { mode: next, scale: value } }));
    }

    function broadcastScale(mode){
        const scale = appliedScale();
        document.querySelectorAll('iframe').forEach(frame => {
            try {
                frame.contentWindow?.postMessage({ type: 'studio-ui-scale', mode, scale }, '*');
            } catch(e) {}
        });
    }

    function setScaleMode(mode, shouldBroadcast = true){
        const next = normalizeScaleMode(mode);
        try {
            localStorage.setItem(SCALE_KEY, next);
        } catch(e) {}
        applyScale(next);
        if(shouldBroadcast) broadcastScale(next);
    }

    let resizeTimer = null;
    let autoScalePausedUntil = 0;
    function pauseAutoScale(duration = 650){
        autoScalePausedUntil = Math.max(autoScalePausedUntil, Date.now() + Math.max(0, Number(duration) || 0));
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(scheduleAutoScaleRefresh, Math.max(0, autoScalePausedUntil - Date.now()) + 40);
    }

    function scheduleAutoScaleRefresh(){
        clearTimeout(resizeTimer);
        const wait = autoScalePausedUntil - Date.now();
        if(wait > 0) {
            resizeTimer = setTimeout(scheduleAutoScaleRefresh, wait + 40);
            return;
        }
        resizeTimer = setTimeout(() => {
            if(currentScaleMode() === 'auto') {
                applyScale('auto');
                broadcastScale('auto');
            }
        }, 160);
    }

    window.StudioTheme = {
        key: KEY,
        get: currentTheme,
        apply: applyTheme,
        set(theme){
            const next = theme === 'dark' ? 'dark' : 'light';
            try {
                localStorage.setItem(KEY, next);
                localStorage.setItem(LEGACY_KEY, next);
                localStorage.setItem('xxdp_theme', next);
            } catch(e) {}
            applyTheme(next);
            try {
                window.parent?.postMessage({ type: 'theme_changed', theme: next }, '*');
                window.parent?.postMessage({ type: 'studio-theme', theme: next }, '*');
                if (window.parent && window.parent !== window && window.parent.__XXPD_APP__) {
                    window.parent.__XXPD_APP__.applyTheme?.(next, false);
                }
            } catch(e) {}
        }
    };

    window.StudioScale = {
        key: SCALE_KEY,
        options: SCALE_OPTIONS.slice(),
        getMode: currentScaleMode,
        getScale: () => scaleForMode(currentScaleMode()),
        apply: applyScale,
        set: setScaleMode
    };

    // =========================================================================
    // 彻底拦截并禁用浏览器原生缩放 (Disable Native Browser Zoom & Lock 1:1 Size)
    // 阻止 Ctrl + 滚轮、Ctrl + +/-/0 快捷键、触控板 Pinch 缩放导致的外壳与侧边栏形变
    // =========================================================================
    function initNativeZoomBlocker(){
        if(window.__studioBrowserZoomLockInstalled) return;
        window.__studioBrowserZoomLockInstalled = true;

        // 1. 全局捕获阶段拦截 Ctrl/Meta + 滚轮缩放 (阻止 Chrome/Edge 页面级 400% 缩放)
        function handleWheel(e){
            if(e.ctrlKey || e.metaKey){
                e.preventDefault();
            }
        }
        window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
        document.addEventListener('wheel', handleWheel, { passive: false, capture: true });

        // 2. 全局拦截浏览器缩放快捷键 (Ctrl + '+', Ctrl + '-', Ctrl + '0', Ctrl + '=', etc.)
        function handleKeyDown(e){
            if(e.ctrlKey || e.metaKey){
                const key = e.key;
                const code = e.code;
                const keyCode = e.keyCode;
                const isZoomKey = (
                    key === '+' || key === '=' || key === '-' || key === '_' || key === '0' ||
                    code === 'Equal' || code === 'Minus' || code === 'Digit0' ||
                    code === 'NumpadAdd' || code === 'NumpadSubtract' || code === 'Numpad0' ||
                    keyCode === 187 || keyCode === 189 || keyCode === 107 || keyCode === 109 ||
                    keyCode === 48 || keyCode === 96 || keyCode === 61 || keyCode === 173
                );
                if(isZoomKey){
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown, { capture: true, passive: false });
        document.addEventListener('keydown', handleKeyDown, { capture: true, passive: false });

        // 3. 拦截触控板/触屏双指 Pinch 手势缩放 (Safari/WebKit Gesture API)
        function preventGesture(e){
            if(e.cancelable !== false){
                e.preventDefault();
            }
        }
        window.addEventListener('gesturestart', preventGesture, { passive: false, capture: true });
        window.addEventListener('gesturechange', preventGesture, { passive: false, capture: true });
        window.addEventListener('gestureend', preventGesture, { passive: false, capture: true });
        document.addEventListener('gesturestart', preventGesture, { passive: false, capture: true });
        document.addEventListener('gesturechange', preventGesture, { passive: false, capture: true });
        document.addEventListener('gestureend', preventGesture, { passive: false, capture: true });

        // 4. 触屏多指/双击防缩放
        let lastTouchEndTime = 0;
        document.addEventListener('touchend', function(e){
            const now = Date.now();
            if(now - lastTouchEndTime <= 300 && e.touches && e.touches.length > 1){
                e.preventDefault();
            }
            lastTouchEndTime = now;
        }, { passive: false, capture: true });
    }

    initNativeZoomBlocker();

    applyTheme(currentTheme());
    applyScale(currentScaleMode());

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(currentTheme());
        applyScale(currentScaleMode());
    });
    window.addEventListener('message', event => {
        if(event.data?.type === 'studio-theme' || event.data?.type === 'theme_changed') applyTheme(event.data.theme);
        if(event.data?.type === 'studio-ui-scale') {
            const incomingScale = normalizeExternalScale(event.data.scale);
            if(incomingScale !== null) externalScaleValue = incomingScale;
            setScaleMode(event.data.mode, false);
        }
        if(event.data?.type === 'studio-ui-scale-pause') pauseAutoScale(event.data.duration);
    });
    window.addEventListener('storage', event => {
        if(event.key === KEY || event.key === LEGACY_KEY || event.key === 'xxdp_theme') {
            const next = (event.newValue === 'dark' || event.newValue === 'light') ? event.newValue : currentTheme();
            applyTheme(next);
        }
        if(event.key === SCALE_KEY) applyScale(currentScaleMode());
    });
    window.addEventListener('resize', scheduleAutoScaleRefresh);
    window.addEventListener('scroll', lockScaledHorizontalScroll, { passive: true });
})();
