(() => {
  if (window.localAssetsSyncInstalled) return;
  window.localAssetsSyncInstalled = true;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('xxpd-local-assets') : null;
  const notify = () => window.dispatchEvent(new Event('local-assets-changed'));
  channel && (channel.onmessage = notify);
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (resource, options) => {
    const response = await originalFetch(resource, options);
    const url = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url, location.href);
    const method = String(options?.method || resource?.method || 'GET').toUpperCase();
    const mutableAssetApi = ['/api/local-assets/', '/api/asset-library/', '/api/canvas-workflows/', '/api/media/', '/api/projects/'];
    if (response.ok && url.origin === location.origin && mutableAssetApi.some(prefix => url.pathname.startsWith(prefix)) && ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) channel?.postMessage({ type: 'changed' });
    return response;
  };
})();
