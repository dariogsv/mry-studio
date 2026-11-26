#!/usr/bin/env node
/**
 * Self-contained deterministic test suite for MRY Visual Studio (SPN + RBD).
 * Runs in Node.js with zero external dependencies (used in local verification & CI).
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const Core = require("./mry-core.js");
global.window = {};
require("./presets.js");
const PRESETS = global.window.MRY_PRESETS || [];

let allOk = true;
function report(ok, name, detail) {
  if (!ok) allOk = false;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name.padEnd(36)} | ${detail}`);
}

// 1. Round-trip idempotency for every built-in public preset (SPN & RBD)
assert(PRESETS.length >= 4, "Expected at least 4 built-in presets");
for (const pr of PRESETS) {
  const ast1 = Core.parseMry(pr.code);
  const aud1 = Core.auditModel(ast1);
  const gen1 = Core.generateMry(ast1);
  const ast2 = Core.parseMry(gen1);
  const aud2 = Core.auditModel(ast2);
  const gen2 = Core.generateMry(ast2);

  const idempotent = gen1 === gen2;
  const countsMatch = JSON.stringify(aud1.stats) === JSON.stringify(aud2.stats);
  let layoutOk = false;

  if (ast1.modelType === "SPN") {
    const lay = Core.computeAutoLayout(ast1);
    layoutOk =
      ast1.places.every((p) => lay[`P:${p.name}`]) &&
      ast1.transitions.every((t) => lay[`T:${t.name}`]);
    report(
      idempotent && countsMatch && layoutOk,
      pr.id,
      `SPN ${aud1.stats.places}L ${aud1.stats.transitions}T ${aud1.stats.totalArcs}A (IF:${aud1.stats.conditionalArcs}, Inh:${aud1.stats.inhibitorArcs}, G:${aud1.stats.guardedTransitions})`
    );
  } else {
    const rLay = Core.computeRbdLayout(ast2);
    layoutOk = rLay.boxes.length === ast1.blocks.length;
    report(
      idempotent && countsMatch && layoutOk,
      pr.id,
      `RBD ${aud1.stats.blocks}B ${aud1.stats.groups}G SPOF:${aud1.stats.spofs} A=${aud1.rbdEval.sysA.toFixed(6)} R(t)=${aud1.rbdEval.sysR.toFixed(6)}`
    );
  }
}

// 2. Synthetic Mercury SPN stress test (guards + inhibitors(2) + IF/ELSE + Det + priority/weight)
const synthetic = `
N = 5;
D = 2.5;
SPN StressTest {
    place P1( tokens = N );
    place P2;
    place Lock( tokens = 1 );
    immediateTransition T_imm(
        inputs = [P1(2)],
        outputs = [P2("IF(#Lock>0):(2)ELSE(1)")],
        inhibitors = [Lock(2)],
        enablingFunction = "(#P1>=2)AND(#Lock=1)",
        priority = 3,
        weight = 0.75
    );
    timedTransition T_det(
        inputs = [P2],
        outputs = [P1],
        delay = ( type = "Deterministic", parameters = ( Value = D ) ),
        serverType = "InfiniteServer",
        enablingFunction = "(#P2>0)"
    );
    metric M1 = stationarySimulation(expression="P{#P2>0}");
}
`;
const sAst1 = Core.parseMry(synthetic);
const sGen1 = Core.generateMry(sAst1);
const sAst2 = Core.parseMry(sGen1);
const sGen2 = Core.generateMry(sAst2);
const sAud = Core.auditModel(sAst2);
const stressOk =
  sGen1 === sGen2 &&
  sAud.stats.guardedTransitions === 2 &&
  sAud.stats.inhibitorArcs === 1 &&
  sAud.stats.conditionalArcs === 1 &&
  sAud.stats.multiplicityGt1Arcs === 2 &&
  sAud.stats.detTransitions === 1;
report(
  stressOk,
  "SYNTHETIC_STRESS_TEST",
  `G:${sAud.stats.guardedTransitions} Inh:${sAud.stats.inhibitorArcs} IF:${sAud.stats.conditionalArcs} Det:${sAud.stats.detTransitions}`
);

// 3. Mercury expression evaluator (guards, AND/OR/NOT, chained IF/ELSE)
const exprOk =
  Core.evalMercuryBool("(#P1>=2)AND(#Lock=1)", { P1: 5, Lock: 1 }, {}) === true &&
  Core.evalMercuryBool("(#P1>=2)AND(#Lock=1)", { P1: 1, Lock: 1 }, {}) === false &&
  Core.evalMercuryBool("(#A=0)OR(#B>2)", { A: 1, B: 3 }, {}) === true &&
  Core.evalMercuryBool("NOT(#A=1)", { A: 0 }, {}) === true &&
  Core.evalMercuryNumeric("IF(#InService>0):(1)ELSE(0)", { InService: 1 }, {}) === 1 &&
  Core.evalMercuryNumeric("IF(#InService>0):(1)ELSE(0)", { InService: 0 }, {}) === 0 &&
  Core.evalMercuryNumeric("IF(#X>5):(3)IF(#X>0):(2)ELSE(0)", { X: 2 }, {}) === 2;
report(exprOk, "MERCURY_EXPRESSION_EVALUATOR", `guards & chained IF/ELSE ok=${exprOk}`);

// 4. Token Game normal ACK cycle + Timeout/Recycle cycle on spn_client_server_timeout
const spnTimeoutAst = Core.parseMry(PRESETS.find((p) => p.id === "spn_client_server_timeout").code);
const m0 = Core.createInitialMarking(spnTimeoutAst);

let mAck = { ...m0 };
let ackOk = true;
for (const trName of ["GenerateRequest", "SendRequest", "AcquireServer", "ProcessRequest", "ReceiveAck"]) {
  const en = Core.getEnabledTransitions(spnTimeoutAst, mAck, true);
  if (!en.fireable.has(trName)) {
    ackOk = false;
    break;
  }
  mAck = Core.fireTransition(spnTimeoutAst, trName, mAck).marking;
}
ackOk = ackOk && JSON.stringify(mAck) === JSON.stringify(m0);
report(ackOk, "TOKEN_GAME_ACK_CYCLE", `returnedToM0=${ackOk}`);

let mTo = { ...m0 };
let toOk = true;
for (const trName of ["GenerateRequest", "SendRequest", "AcquireServer", "RequestTimeout", "RecycleTimeout"]) {
  const en = Core.getEnabledTransitions(spnTimeoutAst, mTo, true);
  if (!en.fireable.has(trName)) {
    toOk = false;
    break;
  }
  mTo = Core.fireTransition(spnTimeoutAst, trName, mTo).marking;
}
const invTo = Core.detectConservationInvariants(spnTimeoutAst, m0, mTo);
toOk = toOk && invTo.every((i) => i.ok) && JSON.stringify(mTo) === JSON.stringify(m0);
report(toOk, "TOKEN_GAME_TIMEOUT_RECYCLE", `invOk=${invTo.every((i) => i.ok)} returnedToM0=${toOk}`);

// 5. Token Game inhibitor & guard preemption on spn_ha_guard_inhibitor
const spnHaAst = Core.parseMry(PRESETS.find((p) => p.id === "spn_ha_guard_inhibitor").code);
let mHa = Core.createInitialMarking(spnHaAst);
const enHa0 = Core.getEnabledTransitions(spnHaAst, mHa, true);
const inhBlockedInitially = !enHa0.fireable.has("ActivateBackup");
mHa = Core.fireTransition(spnHaAst, "FailPrimary", mHa).marking;
const enHa1 = Core.getEnabledTransitions(spnHaAst, mHa, true);
const enabledAfterFail = enHa1.fireable.has("ActivateBackup");
mHa = Core.fireTransition(spnHaAst, "ActivateBackup", mHa).marking;
mHa = Core.fireTransition(spnHaAst, "RepairPrimary", mHa).marking;
const enHa2 = Core.getEnabledTransitions(spnHaAst, mHa, true);
const immPreempts = enHa2.immPreempting && enHa2.fireable.has("RestorePrimary");
const haOk = inhBlockedInitially && enabledAfterFail && immPreempts;
report(haOk, "TOKEN_GAME_GUARD_INHIBITOR_IMM", `inh=${inhBlockedInitially} fail=${enabledAfterFail} imm=${immPreempts}`);

// 6. Shadow/Mirror Places projection (exact arc count + zero overlap)
const layTo = Core.computeAutoLayout(spnTimeoutAst);
const gMir = Core.computeSpnArcGraph(spnTimeoutAst, layTo, {
  useGravity: true,
  useMirrors: true,
  mirrorDistThreshold: 300
});
let mirOverlap = false;
for (const mir of gMir.mirrors) {
  for (const [, pt] of Object.entries(layTo)) {
    if (Math.hypot((mir.x - pt.x) / 70, (mir.y - pt.y) / 55) < 1.0) mirOverlap = true;
  }
}
for (let i = 0; i < gMir.mirrors.length; i++) {
  for (let j = i + 1; j < gMir.mirrors.length; j++) {
    const a = gMir.mirrors[i], b = gMir.mirrors[j];
    if (Math.hypot((a.x - b.x) / 72, (a.y - b.y) / 42) < 1.0) mirOverlap = true;
  }
}
const expectedArcs = Core.auditModel(spnTimeoutAst).stats.totalArcs;
const mirOk = gMir.arcs.length === expectedArcs && gMir.mirrors.length > 0 && !mirOverlap;
report(mirOk, "SHADOW_MIRROR_PROJECTION", `arcs=${gMir.arcs.length}/${expectedArcs} mirrors=${gMir.mirrors.length} overlap=${mirOverlap}`);

// 7. Formal transition table export (Markdown + LaTeX)
const fTab = Core.generateTransitionTable(spnTimeoutAst);
const tabOk = fTab.rows.length === spnTimeoutAst.transitions.length && fTab.markdown.includes("RecycleTimeout") && fTab.latex.includes("\\begin{tabular}");
report(tabOk, "FORMAL_TRANSITION_TABLE", `rows=${fTab.rows.length} md=${fTab.markdown.length}ch tex=${fTab.latex.length}ch`);

// 8. CLI SVG exporter smoke test (SPN + --mirrors --ieee + RBD)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mry-studio-test-"));
try {
  const spnIn = path.join(tmpDir, "spn.mry");
  const spnOut = path.join(tmpDir, "spn.svg");
  const rbdIn = path.join(tmpDir, "rbd.mry");
  const rbdOut = path.join(tmpDir, "rbd.svg");
  fs.writeFileSync(spnIn, PRESETS[0].code, "utf-8");
  fs.writeFileSync(rbdIn, PRESETS[3].code, "utf-8");
  execFileSync(process.execPath, [path.join(__dirname, "export_svg.js"), spnIn, spnOut, "--ieee", "--mirrors"], { stdio: "pipe" });
  execFileSync(process.execPath, [path.join(__dirname, "export_svg.js"), rbdIn, rbdOut], { stdio: "pipe" });
  const spnSvg = fs.readFileSync(spnOut, "utf-8");
  const rbdSvg = fs.readFileSync(rbdOut, "utf-8");
  const cliOk = spnSvg.includes("<svg") && spnSvg.includes("RecycleTimeout") && rbdSvg.includes("<svg") && rbdSvg.includes("Compute2of3");
  report(cliOk, "CLI_SVG_EXPORTER_SMOKE", `spn=${spnSvg.length}B rbd=${rbdSvg.length}B`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (!allOk) process.exit(1);
console.log("ALL DETERMINISTIC MRY STUDIO TESTS PASSED!");
