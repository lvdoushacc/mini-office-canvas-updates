// Phase-3 verification harness. Invoked by scripts/canvas_split_phase3_check.py.
// argv: [node, harness, old_impl.js, new_impl.js, groups.json, expected_globals.json, canvas-state.js]
'use strict';
const fs = require('fs');
const vm = require('vm');

const OLD_FILE = process.argv[2];
const NEW_FILE = process.argv[3];
const GROUPS = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const EXPECTED_GLOBALS = new Set(JSON.parse(fs.readFileSync(process.argv[5], 'utf8')));
const STATE_FILE = process.argv[6];
const UTILS_FILE = process.argv[7];

const INTRINSICS = new Set(vm.runInNewContext('Object.getOwnPropertyNames(globalThis)'));

// realm-local helpers so nothing host-realm crosses into the sandbox
const RUNNER = `
globalThis.__ser = function (v) {
  if (v === undefined) return JSON.stringify('<undefined>');
  if (typeof v === 'number' && !Number.isFinite(v)) return JSON.stringify('<' + String(v) + '>');
  if (typeof v === 'function') return JSON.stringify('<function>');
  if (typeof v === 'bigint' || typeof v === 'symbol') return JSON.stringify('<' + String(v) + '>');
  try { return JSON.stringify(v); } catch (e) { return JSON.stringify('<unserializable>'); }
};
globalThis.__runCase = function (expr, argJson) {
  let x;
  if (argJson === null) { x = undefined; }
  else { try { x = JSON.parse(argJson); } catch (e) { return JSON.stringify({err: 'bad arg'}); } }
  let ret, err = null;
  try { ret = eval(expr); } catch (e) { err = String((e && e.message) || e); }
  return JSON.stringify({err: err, ret: globalThis.__ser(ret), input: globalThis.__ser(x)});
};
`;

function buildSandbox(file, i18n) {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  // tr() reads window.StudioI18n; exercise both the translated and the
  // key-fallback branch, since the result is persisted as a node title.
  vm.runInContext(i18n
    ? 'globalThis.StudioI18n = { t: function (k) { return "I18N[" + k + "]"; } };'
    : 'delete globalThis.StudioI18n;', sandbox);
  vm.runInContext(RUNNER, sandbox, { filename: '<runner>' });
  return sandbox;
}

// ---------------------------------------------------- gate A: access trap ---
function makeStub() {
  const fn = function () { return stub; };
  const stub = new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 1;
      if (k === 'toString') return () => 'stub';
      if (k === 'then') return undefined;
      return stub;
    },
    apply() { return stub; },
    has() { return true; },
  });
  return stub;
}

function accessTrap() {
  // No Proxy: an unresolved global in a plain vm context raises
  // ReferenceError, whose message names the global. Load utils + state alone,
  // call every export, harvest the missing names, add a permissive stub and
  // repeat until the set stops growing. The result is the complete list of
  // globals canvas-state.js reaches for -- ideally none, because everything it
  // needs from smart-canvas.js is supposed to arrive as a parameter.
  const utilsSrc = fs.readFileSync(UTILS_FILE, 'utf8');
  const stateSrc = fs.readFileSync(STATE_FILE, 'utf8');
  const discovered = new Set();
  let touchedOnLoad = [];
  const argSets = [
    [], [null], [{}], [[]], [[{}]], [null, null], [{}, {}], [{}, null],
    [{ id: 'x', type: 'smart-image', images: [{ url: 'data:image/png;base64,' + 'A'.repeat(2000) }] }],
    [{ id: 'x', type: 'smart-container', inputImage: { url: '/a.png' } }, {}],
    [{ id: 'x', type: 'smart-image' }, { tr: s => s, isEmptyGenBoard: () => true,
      isSmartVideoNode: () => false, emptyGenBoardSizeFromAspect: () => ({ w: 1, h: 1 }),
      EMPTY_GEN_NODE_WIDTH: 340, mediaKindForItem: () => 'image' }],
    [{ nodes: [{ id: 'a', images: [{ url: '/a.png' }] }], connections: [] }, {}, {}, '__preview__'],
  ];
  let rounds = 0;
  for (let round = 0; round < 15; round++) {
    rounds = round + 1;
    const initial = { console };
    for (const g of discovered) initial[g] = makeStub();
    const sandbox = vm.createContext(initial);
    vm.runInContext(utilsSrc, sandbox, { filename: 'canvas-utils.js' });
    vm.runInContext(stateSrc, sandbox, { filename: 'canvas-state.js' });
    if (round === 0) {
      // loading must not reach for anything outside the JS intrinsics
      touchedOnLoad = probeLoadClean(sandbox);
    }
    const api = sandbox.SmartCanvasState;
    if (!api) return { error: 'SmartCanvasState was not exported' };
    for (const n of Object.keys(api)) {
      for (const args of argSets) {
        try { api[n](...args); } catch (e) {
          const m = /([A-Za-z_$][\w$]*) is not defined/.exec(String((e && e.message) || e));
          if (m) discovered.add(m[1]);
        }
      }
    }
    const before = discovered.size;
    // one more sweep with the freshly stubbed names so deeper branches run
    const initial2 = { console };
    for (const g of discovered) initial2[g] = makeStub();
    const sb2 = vm.createContext(initial2);
    vm.runInContext(utilsSrc, sb2, { filename: 'canvas-utils.js' });
    vm.runInContext(stateSrc, sb2, { filename: 'canvas-state.js' });
    const api2 = sb2.SmartCanvasState;
    for (const n of Object.keys(api2)) {
      for (const args of argSets) {
        try { api2[n](...args); } catch (e) {
          const m = /([A-Za-z_$][\w$]*) is not defined/.exec(String((e && e.message) || e));
          if (m) discovered.add(m[1]);
        }
      }
    }
    if (discovered.size === before) {
      return { touchedOnLoad, discovered: [...discovered].sort(), rounds };
    }
  }
  return { touchedOnLoad, discovered: [...discovered].sort(), rounds, notConverged: true };
}

// Report any global the module reads while merely being evaluated.
function probeLoadClean(sandbox) {
  const probe = vm.runInContext(
    'typeof SmartCanvasState !== "undefined" && typeof SmartCanvasUtils !== "undefined"', sandbox);
  return probe ? [] : ['SmartCanvasState or SmartCanvasUtils missing after load'];
}

// ------------------------------------------------- gate B: equivalence ------
function equivalence() {
  const results = [];
  for (const variant of [true, false]) {
    const r = equivalenceFor(buildSandbox(OLD_FILE, variant), buildSandbox(NEW_FILE, variant),
      variant ? 'i18n' : 'no-i18n');
    results.push(r);
  }
  const pass = results.reduce((a, r) => a + (r.pass || 0), 0);
  const fail = results.reduce((a, r) => a + (r.fail || 0), 0);
  const failures = results.flatMap(r => r.failures || []);
  const perGroup = results[0].perGroup.map((g, i) => ({
    name: g.name, cases: g.cases * 2,
    pass: g.pass + results[1].perGroup[i].pass,
    fail: g.fail + results[1].perGroup[i].fail,
  }));
  return { pass, fail, failures, perGroup };
}

function equivalenceFor(old, neu, variant) {
  const missing = [];
  for (const g of GROUPS) {
    for (const ctx of [[old, 'old'], [neu, 'new']]) {
      const name = g.call.replace(/^globalThis\./, '').split('(')[0];
      if (typeof ctx[0][name] !== 'function') missing.push(g.name + ' -> ' + ctx[1] + '.' + name);
    }
  }
  if (missing.length) return { error: missing };

  let pass = 0, fail = 0;
  const failures = [];
  const perGroup = [];
  for (const g of GROUPS) {
    let gp = 0, gf = 0;
    for (let i = 0; i < g.inputs.length; i++) {
      const argJson = JSON.stringify(g.inputs[i]);
      const a = old.__runCase(g.call, argJson);
      const b = neu.__runCase(g.call, argJson);
      if (a === b) { pass++; gp++; continue; }
      fail++; gf++;
      if (failures.length < 15) {
        failures.push('[' + variant + '] ' + g.name + ' #' + i +
          '\n      expr=' + g.call +
          '\n      arg =' + String(argJson).slice(0, 220) +
          '\n      OLD =' + String(a).slice(0, 420) +
          '\n      NEW =' + String(b).slice(0, 420));
      }
    }
    perGroup.push({ name: g.name, cases: g.inputs.length, pass: gp, fail: gf });
  }
  return { pass, fail, failures, perGroup };
}

const trap = accessTrap();
console.log('A. canvas-state.js global-access trap (utils + state loaded alone)');
if (trap.error) {
  console.log('   ERROR:', trap.error);
} else {
  console.log('   fixpoint rounds            :', trap.rounds, trap.notConverged ? '(NOT CONVERGED)' : '');
  console.log('   globals read during load   :', JSON.stringify(trap.touchedOnLoad),
    trap.touchedOnLoad.length === 0 ? '-> PASS' : '-> FAIL');
  const unexpected = trap.discovered.filter(g => !EXPECTED_GLOBALS.has(g));
  console.log('   globals read at call time  :', JSON.stringify(trap.discovered));
  console.log('   unexpected (implicit deps) :', unexpected.length ? JSON.stringify(unexpected) + ' -> FAIL' : 'none -> PASS');
  const unused = [...EXPECTED_GLOBALS].filter(g => !trap.discovered.includes(g) &&
    !['console', 'SmartCanvasUtils'].includes(g));
  console.log('   injected-but-never-read    :', JSON.stringify(unused));
  trap._ok = trap.touchedOnLoad.length === 0 && unexpected.length === 0;
}

console.log('\nB. old-vs-new equivalence (same expression, two implementations)');
const eq = equivalence();
if (eq.error) {
  console.log('   ERROR: functions missing from a sandbox:', JSON.stringify(eq.error));
  process.exit(1);
}
for (const g of eq.perGroup) {
  console.log('   ' + g.name.padEnd(38) + ' cases=' + String(g.cases).padEnd(6) +
    'pass=' + g.pass + ' fail=' + g.fail);
}
if (eq.failures.length) {
  console.log('\n--- first failures ---');
  eq.failures.forEach(f => console.log(' * ' + f));
}
console.log('\n   TOTAL pass=' + eq.pass + ' fail=' + eq.fail);
console.log('\nGATE A:', trap._ok ? 'PASS' : 'FAIL');
console.log('GATE B:', eq.fail === 0 ? 'PASS' : 'FAIL');
process.exit(trap._ok && eq.fail === 0 ? 0 : 1);
