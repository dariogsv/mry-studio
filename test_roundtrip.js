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

// 1. Round-trip idempotency for every built-in textbook preset (SPN & RBD)
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
  Core.evalMercuryNumeric("IF(#Active_Up=0):(1)ELSE(0)", { Active_Up: 0 }, {}) === 1 &&
  Core.evalMercuryNumeric("IF(#Active_Up>0):(1)ELSE(0)", { Active_Up: 1 }, {}) === 1 &&
  Core.evalMercuryNumeric("IF(#X>5):(3)IF(#X>0):(2)ELSE(0)", { X: 2 }, {}) === 2;
report(exprOk, "MERCURY_EXPRESSION_EVALUATOR", `guards & chained IF/ELSE ok=${exprOk}`);

// 4. Token Game full cycle on M/M/1/K queue (Arrival -> immediate StartService -> FinishService -> M0)
const mm1kAst = Core.parseMry(PRESETS.find((p) => p.id === "spn_mm1k_queue").code);
const m0Queue = Core.createInitialMarking(mm1kAst);
let mQ = { ...m0Queue };
let qOk = true;
for (const trName of ["Arrival", "StartService", "FinishService"]) {
  const en = Core.getEnabledTransitions(mm1kAst, mQ, true);
  if (!en.fireable.has(trName)) {
    qOk = false;
    break;
  }
  mQ = Core.fireTransition(mm1kAst, trName, mQ).marking;
}
qOk = qOk && JSON.stringify(mQ) === JSON.stringify(m0Queue);
report(qOk, "TOKEN_GAME_MM1K_CYCLE", `returnedToM0=${qOk}`);

// 5. Token Game inhibitor, deterministic switchover & conditional IF/ELSE repair on Cold Standby
const csAst = Core.parseMry(PRESETS.find((p) => p.id === "spn_cold_standby").code);
const m0Cs = Core.createInitialMarking(csAst);
let mCs = { ...m0Cs };
const enCs0 = Core.getEnabledTransitions(csAst, mCs, true);
const inhBlocked = !enCs0.fireable.has("Switchover");
mCs = Core.fireTransition(csAst, "FailActive", mCs).marking;
const enCs1 = Core.getEnabledTransitions(csAst, mCs, true);
const switchEnabled = enCs1.fireable.has("Switchover");
mCs = Core.fireTransition(csAst, "Switchover", mCs).marking;
mCs = Core.fireTransition(csAst, "RepairUnit", mCs).marking;
const csBackToM0 = JSON.stringify(mCs) === JSON.stringify(m0Cs);
const csOk = inhBlocked && switchEnabled && csBackToM0;
report(csOk, "TOKEN_GAME_COLD_STANDBY_CYCLE", `inh=${inhBlocked} switch=${switchEnabled} returnedToM0=${csBackToM0}`);

// 6. Shadow/Mirror Places projection (exact arc count + zero overlap)
const layCs = Core.computeAutoLayout(csAst);
const gMir = Core.computeSpnArcGraph(csAst, layCs, {
  useGravity: true,
  useMirrors: true,
  mirrorDistThreshold: 120
});
let mirOverlap = false;
for (const mir of gMir.mirrors) {
  for (const [, pt] of Object.entries(layCs)) {
    if (Math.hypot((mir.x - pt.x) / 70, (mir.y - pt.y) / 55) < 1.0) mirOverlap = true;
  }
}
for (let i = 0; i < gMir.mirrors.length; i++) {
  for (let j = i + 1; j < gMir.mirrors.length; j++) {
    const a = gMir.mirrors[i], b = gMir.mirrors[j];
    if (Math.hypot((a.x - b.x) / 72, (a.y - b.y) / 42) < 1.0) mirOverlap = true;
  }
}
const expectedArcs = Core.auditModel(csAst).stats.totalArcs;
const mirOk = gMir.arcs.length === expectedArcs && gMir.mirrors.length > 0 && !mirOverlap;
report(mirOk, "SHADOW_MIRROR_PROJECTION", `arcs=${gMir.arcs.length}/${expectedArcs} mirrors=${gMir.mirrors.length} overlap=${mirOverlap}`);

// 7. Formal transition table export (Markdown + LaTeX)
const fTab = Core.generateTransitionTable(csAst);
const tabOk = fTab.rows.length === csAst.transitions.length && fTab.markdown.includes("Switchover") && fTab.latex.includes("\\begin{tabular}");
report(tabOk, "FORMAL_TRANSITION_TABLE", `rows=${fTab.rows.length} md=${fTab.markdown.length}ch tex=${fTab.latex.length}ch`);

// 8. CLI SVG exporter smoke test (SPN + --mirrors --ieee + RBD TMR 2-of-3)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mry-studio-test-"));
try {
  const spnIn = path.join(tmpDir, "spn.mry");
  const spnOut = path.join(tmpDir, "spn.svg");
  const rbdIn = path.join(tmpDir, "rbd.mry");
  const rbdOut = path.join(tmpDir, "rbd.svg");
  fs.writeFileSync(spnIn, PRESETS[1].code, "utf-8");
  fs.writeFileSync(rbdIn, PRESETS[3].code, "utf-8");
  execFileSync(process.execPath, [path.join(__dirname, "export_svg.js"), spnIn, spnOut, "--ieee", "--mirrors"], { stdio: "pipe" });
  execFileSync(process.execPath, [path.join(__dirname, "export_svg.js"), rbdIn, rbdOut], { stdio: "pipe" });
  const spnSvg = fs.readFileSync(spnOut, "utf-8");
  const rbdSvg = fs.readFileSync(rbdOut, "utf-8");
  const cliOk = spnSvg.includes("<svg") && spnSvg.includes("Switchover") && rbdSvg.includes("<svg") && rbdSvg.includes("Channels_2of3");
  report(cliOk, "CLI_SVG_EXPORTER_SMOKE", `spn=${spnSvg.length}B rbd=${rbdSvg.length}B`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (!allOk) process.exit(1);
console.log("ALL DETERMINISTIC MRY STUDIO TESTS PASSED!");
