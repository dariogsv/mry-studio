#!/usr/bin/env node
/**
 * Deterministic CLI Exporter: .mry -> Clean SPN SVG (Color or IEEE Monochrome)
 * Usage: node export_svg.js <input.mry> <output.svg> [--ieee] [--mirrors] [--labels=tag|summary|full]
 */
const fs = require("fs");
const path = require("path");
const Core = require("./mry-core.js");

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: node export_svg.js <input.mry> <output.svg> [--ieee] [--mirrors] [--labels=tag|summary|full]");
  process.exit(1);
}

const inputPath = args[0];
const outputPath = args[1];
const ieee = args.includes("--ieee");
const useMirrors = args.includes("--mirrors");
const labelArg = args.find((a) => a.startsWith("--labels="));
const arcLabelMode = labelArg ? labelArg.split("=")[1] : "tag";

const source = fs.readFileSync(inputPath, "utf-8");
const ast = Core.parseMry(source);
const audit = Core.auditModel(ast);

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fontFamily = ieee ? "Georgia, 'Times New Roman', serif" : "'Segoe UI', Arial, sans-serif";
const monoFamily = "Consolas, 'Courier New', monospace";

if (ast.modelType === "RBD") {
  const layout = Core.computeRbdLayout(ast);
  const ev = audit.rbdEval;
  const b = layout.bounds;
  const padX = 40, padTop = 36, footerH = 74;
  const vx = b.minX - padX, vy = b.minY - padTop;
  const vw = Math.max(700, b.maxX - b.minX + padX * 2);
  const vh = Math.max(380, b.maxY - b.minY + padTop + footerH + 20);
  const fmtPct = (p) => `${(p * 100).toFixed(p > 0.999 ? 4 : 2)}%`;

  let groupsSvg = "";
  for (const gf of layout.groupFrames) {
    const gm = ev.groupMetrics[gf.name] || { A: 0, R: 0 };
    const title = gf.kind === "kooN" ? `${gf.group.k}-of-${gf.group.children.length} (${gf.name})` : gf.kind === "parallel" ? `PARALLEL (1-of-${gf.group.children.length}) • ${gf.name}` : `SERIES • ${gf.name}`;
    const fill = ieee ? (gf.kind === "series" ? "none" : "#f9fafb") : (gf.kind === "kooN" ? "rgba(139,92,246,0.06)" : gf.kind === "parallel" ? "rgba(16,185,129,0.06)" : "rgba(14,165,233,0.04)");
    const stroke = ieee ? "#4b5563" : (gf.kind === "kooN" ? "#7c3aed" : gf.kind === "parallel" ? "#059669" : "#0284c7");
    groupsSvg += `<rect x="${gf.x.toFixed(1)}" y="${gf.y.toFixed(1)}" width="${gf.w.toFixed(1)}" height="${gf.h.toFixed(1)}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.4" stroke-dasharray="${gf.kind === "series" ? "4,4" : "7,4"}" />
    <text x="${(gf.x + 10).toFixed(1)}" y="${(gf.y + 15).toFixed(1)}" font-family="${fontFamily}" font-size="10" font-weight="700" fill="${ieee ? "#111827" : stroke}">${esc(title)}  |  A=${fmtPct(gm.A)}  R(t)=${fmtPct(gm.R)}</text>`;
  }

  const wiresSvg = layout.wires.map((w) => `<line x1="${w.x1.toFixed(1)}" y1="${w.y1.toFixed(1)}" x2="${w.x2.toFixed(1)}" y2="${w.y2.toFixed(1)}" stroke="${ieee ? "#111827" : "#334155"}" stroke-width="2" stroke-linecap="round" />`).join("\n");
  const terminalsSvg = `<circle cx="${layout.startPt.x}" cy="${layout.startPt.y}" r="16" fill="#0f172a" /><text x="${layout.startPt.x}" y="${layout.startPt.y + 4}" text-anchor="middle" font-family="${fontFamily}" font-size="9.5" font-weight="700" fill="#ffffff">IN</text>
  <circle cx="${layout.endPt.x}" cy="${layout.endPt.y}" r="16" fill="#0f172a" /><text x="${layout.endPt.x}" y="${layout.endPt.y + 4}" text-anchor="middle" font-family="${fontFamily}" font-size="9.5" font-weight="700" fill="#ffffff">OUT</text>`;

  let boxesSvg = "";
  for (const bx of layout.boxes) {
    const bm = ev.blockMetrics[bx.name] || { A: 1, R: 1 };
    const isSpof = ev.spofs.includes(bx.name);
    const isHier = bx.kind === "hierarchy";
    const fill = ieee ? "#ffffff" : (isHier ? "#f5f3ff" : "#ffffff");
    const stroke = ieee ? "#111827" : (isSpof ? "#dc2626" : isHier ? "#7c3aed" : "#1e293b");
    const headerFill = ieee ? "#f3f4f6" : (isHier ? "#ede9fe" : isSpof ? "#fef2f2" : "#f1f5f9");
    const bObj = bx.block;
    const line1 = isHier && bObj ? `R=${bObj.reliability || bm.R}` : bObj ? `MTTF=${bm.mttf ?? bObj.mttf}  MTTR=${bm.mttr ?? bObj.mttr}` : "";
    const line2 = `A=${fmtPct(bm.A)}  R(t)=${fmtPct(bm.R)}`;
    const typeTxt = isHier ? "HIER" : "EXP";
    const spofBadge = isSpof && !ieee ? `<rect x="${bx.x + bx.w - 72}" y="${bx.y + 4}" width="33" height="14" rx="3" fill="#dc2626" /><text x="${bx.x + bx.w - 55.5}" y="${bx.y + 13.8}" text-anchor="middle" font-family="${monoFamily}" font-size="8" font-weight="700" fill="#ffffff">SPOF</text>` : "";
    boxesSvg += `<rect x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="${isSpof && !ieee ? 2.2 : 1.8}" />
    <rect x="${bx.x + 1}" y="${bx.y + 1}" width="${bx.w - 2}" height="22" rx="6" fill="${headerFill}" />
    <line x1="${bx.x}" y1="${bx.y + 23}" x2="${bx.x + bx.w}" y2="${bx.y + 23}" stroke="#cbd5e1" stroke-width="1" />
    <text x="${bx.x + 8}" y="${bx.y + 15.5}" font-family="${fontFamily}" font-size="11" font-weight="700" fill="#0f172a">${esc(bx.name)}</text>
    ${spofBadge}
    <rect x="${bx.x + bx.w - 36}" y="${bx.y + 4}" width="31" height="14" rx="3" fill="${ieee ? "#ffffff" : (isHier ? "#7c3aed" : "#0f172a")}" stroke="${ieee ? "#111827" : "none"}" stroke-width="0.8" />
    <text x="${bx.x + bx.w - 20.5}" y="${bx.y + 13.8}" text-anchor="middle" font-family="${monoFamily}" font-size="8" font-weight="700" fill="${ieee ? "#111827" : "#ffffff"}">${typeTxt}</text>
    <text x="${bx.cx}" y="${bx.y + 44}" text-anchor="middle" font-family="${monoFamily}" font-size="9.2" fill="#334155">${esc(line1)}</text>
    <text x="${bx.cx}" y="${bx.y + 66}" text-anchor="middle" font-family="${monoFamily}" font-size="9.5" font-weight="700" fill="${ieee ? "#111827" : "#0369a1"}">${esc(line2)}</text>`;
  }

  const fy = b.maxY + 12;
  const ninesStr = Number.isFinite(ev.nines) ? ev.nines.toFixed(2) : "inf";
  const rbdSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(vw)}" height="${Math.round(vh)}" viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}">
  <rect x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" fill="#ffffff" />
  ${groupsSvg}
  ${wiresSvg}
  ${terminalsSvg}
  ${boxesSvg}
  <rect x="${vx + 20}" y="${fy}" width="${vw - 40}" height="${footerH - 10}" rx="6" fill="#ffffff" stroke="#334155" stroke-width="1" />
  <text x="${vx + 32}" y="${fy + 18}" font-family="${fontFamily}" font-size="11" font-weight="700" fill="#0f172a">RBD Analytical Summary (${esc(ast.modelName)} • top = ${esc(ev.topName)} • mission time t = ${ev.missionTime}h):</text>
  <text x="${vx + 32}" y="${fy + 36}" font-family="${monoFamily}" font-size="10.5" fill="#111827">Availability A = ${(ev.sysA * 100).toFixed(5)}% (${ninesStr} nines)  |  Reliability R(${ev.missionTime}h) = ${(ev.sysR * 100).toFixed(5)}%  |  Downtime = ${ev.downtimeHoursYear.toFixed(2)} h/yr</text>
  <text x="${vx + 32}" y="${fy + 52}" font-family="${monoFamily}" font-size="10" fill="#334155">Single Points of Failure (${ev.spofs.length}): ${esc(ev.spofs.join(", ") || "None")}</text>
</svg>`;
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, rbdSvg, "utf-8");
  console.log(`Exported RBD ${outputPath} (${audit.stats.blocks}B, ${audit.stats.groups}G, A=${(ev.sysA * 100).toFixed(5)}%, R(${ev.missionTime}h)=${(ev.sysR * 100).toFixed(5)}%)`);
  process.exit(0);
}

const positions = Object.assign({}, Core.computeAutoLayout(ast), ast.layout || {});

const PLACE_R = 28;
const getTransDim = (tr) => (tr.kind === "immediate" ? { w: 9, h: 48 } : { w: 20, h: 52 });

function clipCircle(cx, cy, r, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  const d = Math.hypot(dx, dy) || 1;
  return { x: cx + (dx / d) * r, y: cy + (dy / d) * r };
}
function clipRect(cx, cy, hw, hh, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}

const spnGraph = Core.computeSpnArcGraph(ast, positions, { useGravity: true, useMirrors });
const allArcs = spnGraph.arcs;
const mirrors = spnGraph.mirrors || [];

const pts = Object.values(positions);
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const p of pts) {
  minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
  minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
}
for (const m of mirrors) {
  minX = Math.min(minX, m.x - 45); maxX = Math.max(maxX, m.x + 45);
  minY = Math.min(minY, m.y - 30); maxY = Math.max(maxY, m.y + 36);
}

const padX = 115;
const padTop = 95;
const legendLines = audit.conditionalLegend || [];
const extraMirrorNote = mirrors.length > 0 ? 18 : 0;
const legendH = (legendLines.length > 0 && arcLabelMode === "tag" ? 38 + legendLines.length * 16 : 20) + extraMirrorNote;
const padBottom = 85 + legendH;
const vx = minX - padX, vy = minY - padTop;
const vw = Math.max(600, maxX - minX + padX * 2);
const vh = Math.max(400, maxY - minY + padTop + padBottom);

const colorNormal = ieee ? "#111827" : "#334155";
const colorCondIn = ieee ? "#111827" : "#2563eb";
const colorCondOut = ieee ? "#111827" : "#7c3aed";
const colorInh = ieee ? "#111827" : "#dc2626";

// Branch lane boxes
let bandsSvg = "";
const branchCoords = {};
for (const [id, pt] of Object.entries(positions)) {
  const b = Core.getNodeBranch(id.slice(2));
  if (!branchCoords[b]) branchCoords[b] = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  branchCoords[b].minX = Math.min(branchCoords[b].minX, pt.x);
  branchCoords[b].maxX = Math.max(branchCoords[b].maxX, pt.x);
  branchCoords[b].minY = Math.min(branchCoords[b].minY, pt.y);
  branchCoords[b].maxY = Math.max(branchCoords[b].maxY, pt.y);
}
const branchNames = Object.keys(branchCoords).filter((b) => /^T\d+$/.test(b) || b === "SHARED" || b === "INFRA");
if (branchNames.length >= 2) {
  for (const b of branchNames) {
    const box = branchCoords[b];
    const fill = ieee
      ? (b === "SHARED" ? "#f3f4f6" : "none")
      : (b === "SHARED" ? "rgba(99,102,241,0.06)" : b === "INFRA" ? "rgba(239,68,68,0.04)" : "rgba(14,165,233,0.035)");
    const stroke = ieee ? "#9ca3af" : (b === "SHARED" ? "#a5b4fc" : b === "INFRA" ? "#fca5a5" : "#bae6fd");
    const label = b === "SHARED" ? "SERVIDOR CENTRAL COMPARTILHADO" : b === "INFRA" ? "DEPENDABILIDADE (FALHA / REPARO)" : `SUBMODELO CATRACA ${b}`;
    bandsSvg += `<rect x="${box.minX - 76}" y="${box.minY - 74}" width="${box.maxX - box.minX + 152}" height="${box.maxY - box.minY + 148}" rx="12" fill="${fill}" stroke="${stroke}" stroke-dasharray="6,4" stroke-width="1.2" />
    <text x="${box.minX - 62}" y="${box.minY - 57}" font-family="${fontFamily}" font-size="10.5" font-weight="700" fill="#374151">${esc(label)}</text>`;
  }
}

let arcsSvg = "";
for (const item of allArcs) {
  const mult = String(item.arc.multiplicity || "1").trim();
  const isCond = item.arc.isConditional || /IF\s*\(/i.test(mult) || /#[A-Za-z_]/.test(mult);
  const isInh = item.dir === "inh";
  let stroke = colorNormal, marker = "url(#arrow-normal)", dash = "";
  if (isInh) { stroke = colorInh; marker = "url(#inhibitor-circle)"; }
  else if (isCond) {
    stroke = item.dir === "in" ? colorCondIn : colorCondOut;
    marker = item.dir === "in" ? "url(#arrow-cond-in)" : "url(#arrow-cond-out)";
    dash = 'stroke-dasharray="6,3"';
  }
  const pathD = item.pathD;
  const lx = item.lx;
  const ly = item.ly;
  let labelText = "";
  if (isCond) {
    const tag = audit.condExprToTag[mult] || "w?";
    labelText = arcLabelMode === "tag" ? tag : arcLabelMode === "summary" ? `${tag}: ${Core.summarizeCondition(mult)}` : mult;
  } else if (mult !== "1") {
    labelText = `×${mult}`;
  }
  let labelSvg = "";
  if (labelText) {
    const bw = Math.max(24, labelText.length * 6.2 + 10);
    const badgeFill = ieee ? "#ffffff" : (isCond ? (item.dir === "in" ? "#eff6ff" : "#f5f3ff") : "#fef3c7");
    const badgeStroke = ieee ? "#111827" : (isCond ? stroke : "#d97706");
    const textFill = ieee ? "#111827" : (isCond ? stroke : "#92400e");
    labelSvg = `<rect x="${(lx - bw / 2).toFixed(1)}" y="${(ly - 8).toFixed(1)}" width="${bw.toFixed(1)}" height="16" rx="4" fill="${badgeFill}" stroke="${badgeStroke}" stroke-width="1" />
    <text x="${lx.toFixed(1)}" y="${(ly + 3.5).toFixed(1)}" text-anchor="middle" font-family="${monoFamily}" font-size="9.5" font-weight="700" fill="${textFill}">${esc(labelText)}</text>`;
  }
  arcsSvg += `<path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="${isCond || isInh ? 1.75 : 1.5}" ${dash} marker-end="${marker}" />${labelSvg}`;
}

let nodesSvg = "";
for (const pl of ast.places) {
  const pt = positions[`P:${pl.name}`];
  const tokExpr = String(pl.tokens ?? "0").trim();
  const resTok = Core.resolveValue(tokExpr, audit.paramMap);
  const hasTok = tokExpr !== "0" && tokExpr !== "";
  const fill = ieee ? "#ffffff" : (hasTok ? "#f0f9ff" : "#ffffff");
  const stroke = ieee ? "#111827" : (hasTok ? "#0284c7" : "#1e293b");
  let tokSvg = "";
  if (hasTok) {
    const disp = resTok !== null && String(resTok) !== tokExpr ? String(resTok) : tokExpr;
    tokSvg = `<text x="${pt.x}" y="${pt.y + 5}" text-anchor="middle" font-family="${monoFamily}" font-size="13" font-weight="800" fill="${ieee ? "#111827" : "#0369a1"}">${esc(disp)}</text>`;
  }
  nodesSvg += `<circle cx="${pt.x}" cy="${pt.y}" r="${PLACE_R}" fill="${fill}" stroke="${stroke}" stroke-width="2" />${tokSvg}
  <text x="${pt.x}" y="${pt.y + PLACE_R + 14}" text-anchor="middle" font-family="${fontFamily}" font-size="10.5" font-weight="600" fill="#0f172a">${esc(pl.name)}</text>`;
}

for (const tr of ast.transitions) {
  const pt = positions[`T:${tr.name}`];
  const dim = getTransDim(tr);
  const isImm = tr.kind === "immediate";
  const isDet = tr.kind === "timed" && tr.delayType === "Deterministic";
  const fill = isImm || isDet ? "#111827" : "#ffffff";
  const typeTag = isImm ? "IMM" : isDet ? "DET" : "EXP";
  const srvTag = tr.kind === "timed" ? (tr.serverType === "InfiniteServer" ? " ∞" : " 1") : "";
  const prioTag = tr.priority !== "" ? ` π=${tr.priority}` : "";
  const topBadge = `${typeTag}${srvTag}${prioTag}`;
  const tbW = Math.max(36, topBadge.length * 5.8 + 8);
  const topFill = ieee ? "#ffffff" : (isDet ? "#1e293b" : isImm ? "#e2e8f0" : tr.serverType === "InfiniteServer" ? "#dcfce7" : "#fef3c7");
  const topText = ieee ? "#111827" : (isDet ? "#ffffff" : isImm ? "#0f172a" : tr.serverType === "InfiniteServer" ? "#166534" : "#92400e");
  let extraSvg = `<rect x="${(pt.x - tbW / 2).toFixed(1)}" y="${(pt.y - dim.h / 2 - 20).toFixed(1)}" width="${tbW.toFixed(1)}" height="15" rx="3" fill="${topFill}" stroke="#334155" stroke-width="0.9" />
  <text x="${pt.x}" y="${(pt.y - dim.h / 2 - 9.5).toFixed(1)}" text-anchor="middle" font-family="${monoFamily}" font-size="8.5" font-weight="700" fill="${topText}">${esc(topBadge)}</text>`;
  let extraY = pt.y + dim.h / 2 + 26;
  if (tr.kind === "timed") {
    const resD = Core.resolveValue(tr.delayExpr, audit.paramMap);
    const delayLbl = `${isDet ? "D" : "d"}=${resD !== null ? resD : tr.delayExpr}`;
    extraSvg += `<text x="${pt.x}" y="${extraY}" text-anchor="middle" font-family="${monoFamily}" font-size="9" fill="#475569">${esc(delayLbl)}</text>`;
    extraY += 15;
  }
  if (tr.guard) {
    const gTxt = `G: ${tr.guard}`;
    const gW = Math.max(44, gTxt.length * 5.6 + 10);
    extraSvg += `<rect x="${(pt.x - gW / 2).toFixed(1)}" y="${(extraY - 10).toFixed(1)}" width="${gW.toFixed(1)}" height="15" rx="3" fill="${ieee ? "#ffffff" : "#fef3c7"}" stroke="${ieee ? "#111827" : "#d97706"}" stroke-width="1" />
    <text x="${pt.x}" y="${extraY + 0.5}" text-anchor="middle" font-family="${monoFamily}" font-size="8.5" font-weight="700" fill="${ieee ? "#111827" : "#92400e"}">${esc(gTxt)}</text>`;
  }
  nodesSvg += `<rect x="${(pt.x - dim.w / 2).toFixed(1)}" y="${(pt.y - dim.h / 2).toFixed(1)}" width="${dim.w}" height="${dim.h}" rx="${isImm ? 1 : 2}" fill="${fill}" stroke="#0f172a" stroke-width="2" />${extraSvg}
  <text x="${pt.x}" y="${pt.y + dim.h / 2 + 14}" text-anchor="middle" font-family="${fontFamily}" font-size="10.5" font-weight="700" fill="#0f172a">${esc(tr.name)}</text>`;
}

let mirrorsSvg = "";
for (const m of mirrors) {
  const mStroke = ieee ? "#374151" : "#6366f1";
  const mFill = ieee ? "#f9fafb" : "#eef2ff";
  mirrorsSvg += `<circle cx="${m.x}" cy="${m.y}" r="${m.r}" fill="${mFill}" stroke="${mStroke}" stroke-width="1.4" stroke-dasharray="3.5,2.5" />
  <circle cx="${m.x}" cy="${m.y}" r="${m.r - 3.5}" fill="#ffffff" stroke="${mStroke}" stroke-width="1.1" />
  <text x="${m.x}" y="${m.y + 4}" text-anchor="middle" font-family="${fontFamily}" font-size="11" font-weight="700" fill="${mStroke}">↗</text>
  <text x="${m.x}" y="${m.y + m.r + 12}" text-anchor="middle" font-family="${fontFamily}" font-size="9.2" font-style="italic" font-weight="600" fill="${ieee ? "#1f2937" : "#4338ca"}">↗ ${esc(m.place)}</text>`;
}

let legendSvg = "";
if ((legendLines.length > 0 && arcLabelMode === "tag") || mirrors.length > 0) {
  const ly = maxY + 78;
  const lines = [];
  if (legendLines.length > 0 && arcLabelMode === "tag") {
    lines.push(`<text x="${vx + 32}" y="${ly + 17}" font-family="${fontFamily}" font-size="11" font-weight="700" fill="#0f172a">Marking-Dependent Arc Expressions (${legendLines.length} unique expressions — derived deterministically from .mry):</text>`);
    legendLines.forEach((it, idx) => {
      lines.push(`<text x="${vx + 34}" y="${ly + 34 + idx * 15}" font-family="${monoFamily}" font-size="10" fill="#111827">${esc(it.tag)} = ${esc(it.expr)}</text>`);
    });
  }
  if (mirrors.length > 0) {
    const my = legendLines.length > 0 && arcLabelMode === "tag" ? ly + 36 + legendLines.length * 15 : ly + 18;
    lines.push(`<text x="${vx + 32}" y="${my}" font-family="${fontFamily}" font-size="10" font-style="italic" fill="#374151">Dashed double-ring nodes (↗ PlaceName) represent ${mirrors.length} shadow/mirror references to remote places (visual clarity projection; identical .mry semantics).</text>`);
  }
  legendSvg = `<rect x="${vx + 20}" y="${ly}" width="${vw - 40}" height="${Math.max(28, legendH - 10)}" rx="6" fill="#ffffff" stroke="#334155" stroke-width="1" />
  ${lines.join("\n")}`;
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(vw)}" height="${Math.round(vh)}" viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}">
  <defs>
    <marker id="arrow-normal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="${colorNormal}" /></marker>
    <marker id="arrow-cond-in" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="${colorCondIn}" /></marker>
    <marker id="arrow-cond-out" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="${colorCondOut}" /></marker>
    <marker id="inhibitor-circle" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto"><circle cx="6" cy="6" r="4.2" fill="#ffffff" stroke="${colorInh}" stroke-width="1.8" /></marker>
  </defs>
  <rect x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" fill="#ffffff" />
  ${bandsSvg}
  ${arcsSvg}
  ${mirrorsSvg}
  ${nodesSvg}
  ${legendSvg}
</svg>`;

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, svg, "utf-8");
console.log(`Exported ${outputPath} (${audit.stats.places}L, ${audit.stats.transitions}T, ${audit.stats.totalArcs}A, ${legendLines.length} conditional tags, ${mirrors.length} mirrors)`);
