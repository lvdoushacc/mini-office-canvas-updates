// Phase-4.1 verification harness. Driven by scripts/canvas_split_phase4_1_check.py.
// argv: [node, harness, canvas-layout.js, old_impl.js, new_impl.js, payload.json]
//
//   A  global-access trap: load canvas-layout.js alone in a bare vm context, call
//      every export with a real deps object, and record any ReferenceError. A pure
//      layout module must reach for ZERO globals -- everything comes in as a param.
//   B  old-vs-new equivalence: the same expression is evaluated against the
//      pre-split definitions and against the module + the real wrappers taken from
//      smart-canvas.js, so the wrappers are under test too.
'use strict';
const fs = require('fs');
const vm = require('vm');

const LAYOUT_FILE = process.argv[2];
const OLD_FILE = process.argv[3];
const NEW_FILE = process.argv[4];
const PAYLOAD = JSON.parse(fs.readFileSync(process.argv[5], 'utf8'));

// ---------------------------------------------------------------- helpers ---
const RUNNER = `
globalThis.__ser = function (v) {
  if (v === undefined) return JSON.stringify('<undefined>');
  if (typeof v === 'number' && !Number.isFinite(v)) return JSON.stringify('<' + String(v) + '>');
  if (typeof v === 'function') return JSON.stringify('<function>');
  if (typeof v === 'bigint' || typeof v === 'symbol') return JSON.stringify('<' + String(v) + '>');
  try { return JSON.stringify(v); } catch (e) { return JSON.stringify('<unserializable>'); }
};
globalThis.__clone = function (s) { return JSON.parse(s); };
globalThis.__runCase = function (expr, argJson) {
  let x;
  try { x = JSON.parse(argJson); } catch (e) { return JSON.stringify({err: 'bad arg'}); }
  let ret, err = null;
  try { ret = eval(expr); } catch (e) { err = String((e && e.message) || e); }
  return JSON.stringify({err: err, ret: globalThis.__ser(ret), input: globalThis.__ser(x)});
};
`;

function bareContext() {
  const sb = { console };
  vm.createContext(sb);
  return sb;
}

// Evaluate the layout constants in a throwaway context and hand their *values*
// back as JSON, so the trap sandbox never has them as globals.
function constDepsJson() {
  const sb = bareContext();
  vm.runInContext(PAYLOAD.constsSrc, sb, { filename: '<consts>' });
  return vm.runInContext('JSON.stringify(' + PAYLOAD.constsExpr + ')', sb);
}

// -------------------------------------------------------------- gate A ------
function accessTrap() {
  const discovered = new Set();
  let leakedLoad = [];
  for (let round = 0; round < 10; round++) {
    const sb = bareContext();
    // deps are supplied as a value object, never as globals: constants arrive as
    // JSON data and the callable ones as functions, so any global the module still
    // reaches for is a genuine un-injected dependency.
    vm.runInContext(fs.readFileSync(PAYLOAD.utilsFile, 'utf8'), sb, { filename: 'canvas-utils.js' });
    vm.runInContext('globalThis.__C = ' + constDepsJson(), sb, { filename: '<const-deps>' });
    vm.runInContext('globalThis.__D = Object.assign({}, __C, ' + PAYLOAD.trapFnDepsExpr + ')', sb,
                    { filename: '<fn-deps>' });
    for (const name of discovered) {
      vm.runInContext(`globalThis[${JSON.stringify(name)}] = function(){ return null; };`, sb);
    }
    try {
      vm.runInContext(fs.readFileSync(LAYOUT_FILE, 'utf8'), sb, { filename: 'canvas-layout.js' });
    } catch (e) {
      return { error: 'load failed: ' + (e && e.message) };
    }
    if (round === 0) leakedLoad = [...discovered];
    // the module's export name differs per layer (SmartCanvasLayout / SmartCanvasRenderer)
    const API = PAYLOAD.moduleGlobal || 'SmartCanvasLayout';
    const api = sb[API];
    if (!api) return { error: `window.${API} not exported` };
    for (const n of Object.keys(api)) {
      // A per-export arg list wins, because exports do not share a signature
      // (imageLayout takes 3 args before deps, smartGroupThumbLayout only 1).
      const argSets = (PAYLOAD.trapArgSetsByExport && PAYLOAD.trapArgSetsByExport[n]) ||
        PAYLOAD.trapArgSets;
      for (const args of argSets) {
        try {
          // spread the arg list, then hand the deps object as the trailing param
          vm.runInContext(
            `${API}[${JSON.stringify(n)}](...(${JSON.stringify(args)}), __D)`, sb,
            { filename: '<call>' });
        } catch (e) {
          const m = /\b([A-Za-z_$][\w$]*) is not defined/.exec(String((e && e.message) || e));
          if (m) discovered.add(m[1]);
        }
      }
    }
    if (discovered.size === 0) return { discovered: [], loadClean: !leakedLoad.length };
    // keep iterating so a single leaked name does not hide the next one
    if (round === 9) return { discovered: [...discovered], loadClean: !leakedLoad.length, stalled: true };
  }
}

// -------------------------------------------------------------- gate B ------
function buildSandbox(file) {
  const sb = bareContext();
  vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
  // re-seed the stubbed node-graph callees so equivalence cannot fluke a match
  if (PAYLOAD.seed !== undefined) {
    vm.runInContext('globalThis.__SEED = ' + PAYLOAD.seed, sb, { filename: '<seed>' });
  }
  vm.runInContext(RUNNER, sb, { filename: '<runner>' });
  return sb;
}

function equivalence() {
  const old = buildSandbox(OLD_FILE);
  const neu = buildSandbox(NEW_FILE);
  const missing = [];
  for (const g of PAYLOAD.groups) {
    const fn = g.call.replace(/^globalThis\./, '').split('(')[0];
    for (const [sb, label] of [[old, 'old'], [neu, 'new']]) {
      if (typeof sb[fn] !== 'function') missing.push(`${g.name} -> ${label}.${fn}`);
    }
  }
  if (missing.length) return { error: missing };

  let pass = 0, fail = 0;
  const failures = [];
  const perGroup = [];
  for (const g of PAYLOAD.groups) {
    let gp = 0, gf = 0, gclean = 0, gpat = 0;
    for (let i = 0; i < g.inputs.length; i++) {
      const argJson = JSON.stringify(g.inputs[i]);
      const a = old.__runCase(g.call, argJson);
      const b = neu.__runCase(g.call, argJson);
      // A group that "matches" only because both sides throw is worth nothing: count how
      // many cases really ran, and how many produced the output the phase is about.
      try { if (JSON.parse(a).err === null) gclean++; } catch (e) { /* not our envelope */ }
      if (g.pattern && a.includes(g.pattern)) gpat++;
      if (a === b) { pass++; gp++; continue; }
      fail++; gf++;
      if (failures.length < 12) {
        failures.push(`${g.name} #${i}\n      expr=${g.call}\n      arg =${String(argJson).slice(0, 220)}` +
          `\n      OLD =${String(a).slice(0, 420)}\n      NEW =${String(b).slice(0, 420)}`);
      }
    }
    perGroup.push({ name: g.name, cases: g.inputs.length, pass: gp, fail: gf,
                    clean: gclean, pat: gpat, minClean: g.minClean, minPat: g.minPat });
  }
  return { pass, fail, failures, perGroup };
}

const trap = accessTrap();
console.log('A. canvas-layout.js global-access trap (module loaded alone, deps passed in)');
if (trap.error) {
  console.log('   ERROR:', trap.error);
} else {
  console.log('   globals reached for :', JSON.stringify(trap.discovered),
    trap.discovered.length === 0 ? '-> PASS (fully injected)' : '-> FAIL');
  console.log('   load-time cleanliness:', trap.loadClean ? 'PASS' : 'FAIL');
  if (trap.stalled) console.log('   (did not converge)');
}

console.log('\nB. old-vs-new equivalence (same expression, two implementations)');
const eq = equivalence();
if (eq.error) {
  console.log('   ERROR: missing functions:', JSON.stringify(eq.error));
  process.exit(1);
}
for (const g of eq.perGroup) {
  // clean/pat are only printed when a group asks for a coverage floor, so the older
  // phase checks keep parsing the original line format.
  const extra = (g.pattern || g.minClean !== undefined || g.minPat !== undefined)
    ? ' clean=' + String(g.clean).padEnd(6) + 'pat=' + g.pat : '';
  console.log('   ' + g.name.padEnd(30) + ' cases=' + String(g.cases).padEnd(6) +
    'pass=' + String(g.pass).padEnd(6) + 'fail=' + g.fail + extra);
}
if (eq.failures.length) {
  console.log('\n--- first failures ---');
  eq.failures.forEach(f => console.log(' * ' + f));
}
console.log('\n   TOTAL pass=' + eq.pass + ' fail=' + eq.fail);

const okA = !trap.error && trap.discovered && trap.discovered.length === 0 && trap.loadClean;
// coverage floors: a group that asked for them must have actually produced that much
// real output, otherwise "0 differences" is an artifact of both sides failing the same way
const thin = eq.perGroup.filter(g =>
  (g.minClean !== undefined && g.clean < g.minClean * g.cases) ||
  (g.minPat !== undefined && g.pat < g.minPat * g.cases));
if (thin.length) {
  console.log('\n   COVERAGE TOO THIN (both sides may be erroring identically):');
  thin.forEach(g => console.log(`     - ${g.name}: clean=${g.clean}/${g.cases} pat=${g.pat}` +
                                ` wanted >=${Math.ceil((g.minClean || 0) * g.cases)}` +
                                `/${Math.ceil((g.minPat || 0) * g.cases)}`));
}
const okB = eq.fail === 0 && !thin.length;
console.log('\nGATE A:', okA ? 'PASS' : 'FAIL');
console.log('GATE B:', okB ? 'PASS' : 'FAIL');
process.exit(okA && okB ? 0 : 1);
