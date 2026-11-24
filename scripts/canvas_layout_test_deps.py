# -*- coding: utf-8 -*-
"""Shared pieces for the canvas layout split checks (phases 4.1 / 4.2a / 4.2b).

`smartLayoutDeps()` in smart-canvas.js is one object literal shared by every layout
phase, so the list of names it injects and the sandbox stubs that satisfy them belong in
one place: the newest phase appends to these lists, older phase checks import them. A
phase check that keeps its own copy silently goes stale the next time a dependency is
added -- that is exactly how phase 4.1's regression broke after 4.2a.

TRAP_STUB_FNS also fixes a measurement bug: the gate A trap runs the module in a *bare*
vm context, so a deps expression that reads `globalThis.mediaNodeDefaultScale` hands the
module an undefined callable there. The first such call then throws a TypeError and the
trap stops before it ever reaches the constants further down the body, which makes
"0 globals reached" true for the wrong reason. Self-contained stubs keep the calls
running, so an uninjected identifier really does surface as a ReferenceError.
"""
from __future__ import annotations

# consts that stay in smart-canvas.js and are injected by smartLayoutDeps()
PURE_CONSTS = [
    "STANDARD_ASPECT_RATIO_PRESETS", "MEDIA_NODE_DEFAULT_SCALE", "MEDIA_GROUP_DEFAULT_SCALE",
    "MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE", "MEDIA_GROUP_THUMB_BASE",
    "MEDIA_GROUP_MAX_VISIBLE_ROWS", "EMPTY_UPLOAD_NODE_WIDTH",
    "EMPTY_UPLOAD_NODE_HEIGHT", "EMPTY_GEN_NODE_WIDTH",
    "SMART_GROUP_DEFAULT_WIDTH", "SMART_GROUP_MIN_WIDTH",
    "SMART_GROUP_LEGACY_HEIGHT", "SMART_GROUP_DEFAULT_HEIGHT",
    "SMART_GROUP_MIN_HEIGHT", "SMART_GROUP_MAX_VISIBLE_ROWS",
]
# main-file functions that are pure enough to be copied verbatim into both sandboxes
# (smartPendingTasks / isSmartGroupNode are named by smartLayoutDeps() even where the
#  function under test does not call them)
PURE_FNS = ["mediaNodeDefaultScale", "smartMinimaxLayoutSize", "smartLoopWidth",
            "isSmartUploadNode", "isSmartVideoNode", "isSmartImageGenNode",
            "smartPendingTasks", "isSmartGroupNode"]

# Values for the gate A trap's deps object, as a JS object-literal body. Every name
# smartLayoutDeps() injects must appear here or in __C (the JSON-ified constants).
TRAP_STUB_FNS = """
mediaNodeDefaultScale: function(n){
  const imgs = (n && n.images) || [];
  const v = Number(n && n.scale);
  if(imgs.length > 1 && !Number.isFinite(v)) return __C.MEDIA_GROUP_DEFAULT_SCALE;
  return Number.isFinite(v) && v > 0 ? v : __C.MEDIA_NODE_DEFAULT_SCALE;
},
smartMinimaxLayoutSize: function(n){ return {width:Number(n && n.w) || 320, height:200}; },
smartLoopWidth: function(n){ return Number(n && n.w) || 240; },
smartLoopHeight: function(n){ return Number(n && n.h) || 168; },
isSmartUploadNode: function(n){ return Boolean(n && n.type === 'smart-upload'); },
isSmartVideoNode: function(n){ return Boolean(n && (n.type === 'smart-video' || n.genKind === 'video')); },
isSmartImageGenNode: function(n){ return Boolean(n && n.type === 'smart-image'); },
isSmartGroupNode: function(n){ return Boolean(n && n.type === 'smart-group'); },
isSmartGroupCompactMember: function(n){ return Boolean(n && n.type === 'smart-prompt'); },
smartPendingTasks: function(n){ return (n && n.pendingTasks) || []; },
promptNodeLayoutSize: function(n){ return {width:Number(n && n.w) || 316, height:240}; },
smartGroupThumbLayout: function(n){ return null; },
smartGroupImageRefs: function(g){ return (((g && g.images) || []).filter(i => i && typeof i === 'object'))
  .map((img, i) => ({nodeId:g.id, index:i, source:img, item:img})); },
smartGroupCompactMembers: function(g){ return ((g && g.members) || [])
  .filter(m => m && (m.type === 'smart-prompt' || m.type === 'smart-loop')); },
normalizeImageRatio: function(r){ return String(r); },
isAudioMediaItem: function(i){ return Boolean(i && i.kind === 'audio'); },
settings: {ratio:'4:3', imageRatio:'4:3', videoAspect:'16:9'},
"""

# names the trap evaluates as `{...}` alongside the constants in __C
TRAP_CONST_NAMES = ("STANDARD_ASPECT_RATIO_PRESETS, MEDIA_GROUP_MAX_VISIBLE_ROWS, "
                    "MEDIA_NODE_DEFAULT_SCALE, MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE, "
                    "MEDIA_GROUP_DEFAULT_SCALE, MEDIA_GROUP_THUMB_BASE, "
                    "SMART_GROUP_DEFAULT_WIDTH, SMART_GROUP_MIN_WIDTH, "
                    "SMART_GROUP_LEGACY_HEIGHT, SMART_GROUP_DEFAULT_HEIGHT, "
                    "SMART_GROUP_MIN_HEIGHT, EMPTY_UPLOAD_NODE_WIDTH, "
                    "EMPTY_UPLOAD_NODE_HEIGHT, SMART_GROUP_MAX_VISIBLE_ROWS")

# Sandbox statements for the two group-membership functions smartLayoutDeps() names since
# phase 4.2b. Any older phase check that evaluates smartLayoutDeps() must provide them or
# the object literal throws ReferenceError. Phase 4.2b overrides these with its own
# seed-aware, member-map-driven versions further down the same script.
GLOBALS_STUBS = """
globalThis.smartGroupImageRefs = function(g){
  return (((g && g.images) || []).filter(i => i && typeof i === 'object'))
    .map((img, i) => ({nodeId:g.id, index:i, source:img, item:img}));
};
globalThis.smartGroupCompactMembers = function(g){
  return ((g && g.members) || [])
    .filter(m => m && (m.type === 'smart-prompt' || m.type === 'smart-loop'));
};
globalThis.imageLayout = function(images, scale, node){
  const first = (images || [])[0] || {};
  return {width:Number(node && node.w) || Number(first.width) || 270,
          height:Number(node && node.h) || Number(first.height) || 270};
};
"""
