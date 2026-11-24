/** Pure workflow naming and presentation helpers. */
(function attachSmartCanvasWorkflow(globalScope) {
    function workflowFilename(title, ext = 'json', now = new Date()) {
        const safe = String(title || 'smart-canvas').trim()
            .replace(/[\\/:*?"<>|]+/g, '_')
            .replace(/\s+/g, '-')
            .slice(0, 48) || 'smart-canvas';
        const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '');
        return `${safe}-workflow-${stamp}.${ext}`;
    }

    function renderPromptWithMentions(value, escapeHtml) {
        if(!value) return '';
        const escaped = escapeHtml(value);
        return escaped.replace(/(@[\u4e00-\u9fa5a-zA-Z0-9_\-]+)/g, '<span class="wf-mention-tag">$1</span>');
    }

    function formatWorkflowTime(ts) {
        if(!ts) return '';
        try {
            const date = new Date(Number(ts));
            if(isNaN(date.getTime())) return '';
            const pad = value => String(value).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
        } catch(_) {
            return '';
        }
    }

    globalScope.SmartCanvasWorkflow = {
        workflowFilename,
        renderPromptWithMentions,
        formatWorkflowTime
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
