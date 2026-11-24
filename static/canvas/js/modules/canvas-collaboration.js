/** Pure canvas merge helpers used by collaboration refreshes. */
(function attachSmartCanvasCollaboration(globalScope) {
    function mergeSmartNodeLists(localNodes, remoteNodes, mergeNode, keepLocalOnly) {
        const localById = new Map((localNodes || []).map(node => [node.id, node]));
        const remoteById = new Map((remoteNodes || []).map(node => [node.id, node]));
        const order = [];
        const seen = new Set();
        (localNodes || []).forEach(node => {
            if(!seen.has(node.id)){
                seen.add(node.id);
                order.push(node.id);
            }
        });
        (remoteNodes || []).forEach(node => {
            if(!seen.has(node.id)){
                seen.add(node.id);
                order.push(node.id);
            }
        });
        return order.map(id => {
            const local = localById.get(id);
            const remote = remoteById.get(id);
            if(local && !remote) return keepLocalOnly ? local : null;
            if(remote && !local) return remote;
            return mergeNode(local, remote);
        }).filter(Boolean);
    }

    function mergeSmartConnections(localConnections, remoteConnections, nodeIds) {
        const out = [];
        const seen = new Set();
        [...(localConnections || []), ...(remoteConnections || [])].forEach(connection => {
            if(!connection || !nodeIds.has(connection.from) || !nodeIds.has(connection.to)) return;
            const key = `${connection.from}->${connection.to}:${connection.kind || 'flow'}`;
            if(seen.has(key)) return;
            seen.add(key);
            out.push(connection);
        });
        return out;
    }

    globalScope.SmartCanvasCollaboration = {
        mergeSmartNodeLists,
        mergeSmartConnections
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
