/**
 * MRY Visual Studio — Interactive Bidirectional SVG Canvas, Inspector & Exporter
 */
(function () {
  "use strict";

  const Core = window.MryCore;
  const PRESETS = window.MRY_PRESETS || [];

  // =========================================================================
  // APPLICATION STATE
  // =========================================================================
  const STORAGE_PREFIX = "mry_studio_file_v1::";
  const STORAGE_INDEX_KEY = "mry_studio_index_v1";
  const STORAGE_LAST_KEY = "mry_studio_last_v1";

  const state = {
    ast: null,
    audit: null,
    fileKey: null,       // "preset:<id>" or "file:<filename>"
    fileLabel: "",
    positions: {},       // { "P:name": {x,y}, "T:name": {x,y} }
    zones: [],           // [{ id, label, color, members: ["P:...", "T:..."], emptyPos?: {x,y} }]
    rbdLayout: null,     // { boxes, groupFrames, wires, startPt, endPt, bounds }
    missionTime: null,   // override for RBD R(t)
    selected: null,      // SPN: place|transition|arc|zone; RBD: rbdBlock|rbdGroup
    multiSelected: [],   // Array of SPN nodeIds: ["P:...", "T:..."]
    marquee: null,       // { startX, startY, curX, curY, additive }
    spacePressed: false, // Hold Space + drag to pan
    activeTool: "select",// select | addPlace | addExp | addDet | addImm | delete
    connectorType: "normal", // "normal" | "inhibitor" (Mercury-style active connector selector)
    connectSource: null, // { kind: "P"|"T", name }
    connectCursor: null, // { x, y } SVG coords for live rubber-band wire
    hoveredNode: null,   // { kind: "P"|"T"|"B"|"G", name }
    codeMap: [],         // [{ startLine, endLine, nodeIds: [...], label }]
    codeHoverLine: null, // 1-based line under mouse/caret in editor
    codeSyncNodes: [],   // nodeIds highlighted in canvas from code cursor/hover
    activeTab: "inspector",
    branchFilter: "ALL", // ALL | zone:<id> | COND_ONLY | SPOF_ONLY
    showMeta: true,
    useGravity: true,
    useMirrors: false,
    ieeeMode: false,
    arcLabelMode: "tag", // tag | summary | full
    simMode: false,
    simInitMarking: null,
    simMarking: null,
    simHistory: [],      // [{ prevMarking, trName, deltas }]
    simLastDeltas: {},   // { placeName: deltaNumber }
    simRespectImm: true,
    simLastReason: "",
    lastMirrors: [],
    lastRenderedArcs: [],
    isEmptyEditor: false,
    layoutMode: "zen",   // "zen" (Code + Canvas) | "canvas" (100% Figma Canvas) | "studio" (Code + Canvas + Inspector)
    view: { x: -30, y: -30, w: 1700, h: 1050 },
    isPanning: false,
    panStart: null,
    draggingNode: null,  // { nodeId, origX, origY, offsetX, offsetY, moved }
    draggingMirror: null,
    draggingWaypoint: null, // { wpKey, arcId, idx, origX, origY, moved }
    draggingMulti: null, // { ids, startClientX, startClientY, startSvg, origPos, dragActivated, moved, wasCloned }
    draggingZone: null,  // { zoneId, startSvg, origMemberPos, origEmptyPos, moved }
    axisGuide: null,     // { type: "H", y } | { type: "V", x } (when holding Shift)
    reparentState: null, // { nodeIds: [...], targetZoneId } (when holding Ctrl)
    undoStack: [],
    redoStack: [],
    lastCommittedSnap: null,
    suppressEditorInput: false,
    editorDebounceTimer: null,
    autosaveTimer: null,
    manifestSearch: "",
    manifestCategory: "ALL",
    collab: {
      active: false,
      roomId: "",
      selfId: "u_" + Math.random().toString(36).slice(2, 9),
      userName: "Pesquisador " + Math.floor(10 + Math.random() * 89),
      userColor: ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"][Math.floor(Math.random() * 6)],
      bc: null,
      peer: null,
      conns: new Map(),
      remotePeers: new Map(), // peerId -> { name, color, x, y, ts }
      suppressBroadcast: false,
      lastCursorSent: 0
    }
  };

  // DOM refs
  const dom = {
    presetSelect: document.getElementById("presetSelect"),
    fileInput: document.getElementById("fileInput"),
    btnOpenFile: document.getElementById("btnOpenFile"),
    btnCloseFile: document.getElementById("btnCloseFile"),
    activeFileTab: document.getElementById("activeFileTab"),
    layoutModeSeg: document.getElementById("layoutModeSeg"),
    btnQuickMirrors: document.getElementById("btnQuickMirrors"),
    btnViewMenu: document.getElementById("btnViewMenu"),
    viewMenu: document.getElementById("viewMenu"),
    btnCollabMenu: document.getElementById("btnCollabMenu"),
    collabMenu: document.getElementById("collabMenu"),
    collabDot: document.getElementById("collabDot"),
    collabBtnLabel: document.getElementById("collabBtnLabel"),
    inpCollabName: document.getElementById("inpCollabName"),
    inpCollabRoom: document.getElementById("inpCollabRoom"),
    btnCollabToggle: document.getElementById("btnCollabToggle"),
    collabStatusRow: document.getElementById("collabStatusRow"),
    collabStatusText: document.getElementById("collabStatusText"),
    btnCollabCopyLink: document.getElementById("btnCollabCopyLink"),
    emptyEditorState: document.getElementById("emptyEditorState"),
    btnEmptyOpenCenter: document.getElementById("btnEmptyOpenCenter"),
    btnEmptyNewSpn: document.getElementById("btnEmptyNewSpn"),
    btnEmptyNewRbd: document.getElementById("btnEmptyNewRbd"),
    emptyRecentList: document.getElementById("emptyRecentList"),
    btnExportMenu: document.getElementById("btnExportMenu"),
    exportMenu: document.getElementById("exportMenu"),
    resetMenuSep: document.getElementById("resetMenuSep"),
    btnResetMemory: document.getElementById("btnResetMemory"),
    autosaveBadge: document.getElementById("autosaveBadge"),
    btnExportMry: document.getElementById("btnExportMry"),
    btnExportSvg: document.getElementById("btnExportSvg"),
    btnExportPng: document.getElementById("btnExportPng"),
    btnToggleCode: document.getElementById("btnToggleCode"),
    btnFocusCanvas: document.getElementById("btnFocusCanvas"),
    btnSplitModel: document.getElementById("btnSplitModel"),
    btnToggleInspector: document.getElementById("btnToggleInspector"),
    btnCloseEmbeddedSplit: document.getElementById("btnCloseEmbeddedSplit"),
    btnCloseInspector: document.getElementById("btnCloseInspector"),
    appShell: document.getElementById("appShell"),
    splitterCode: document.getElementById("splitterCode"),
    splitterInspector: document.getElementById("splitterInspector"),
    splitterSplit: document.getElementById("splitterSplit"),
    splitSecondary: document.getElementById("splitSecondary"),
    splitFrame: document.getElementById("splitFrame"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    toastHost: document.getElementById("toastHost"),
    btnWideCode: document.getElementById("btnWideCode"),
    btnCollapseCode: document.getElementById("btnCollapseCode"),
    btnFormatMry: document.getElementById("btnFormatMry"),
    btnCopyMry: document.getElementById("btnCopyMry"),
    mryGutter: document.getElementById("mryGutter"),
    mryHighlight: document.getElementById("mryHighlight"),
    btnUndo: document.getElementById("btnUndo"),
    btnRedo: document.getElementById("btnRedo"),
    spnToolbar: document.getElementById("spnToolbar"),
    btnAddZone: document.getElementById("btnAddZone"),
    btnConnNormal: document.getElementById("btnConnNormal"),
    btnConnInhibitor: document.getElementById("btnConnInhibitor"),
    rbdToolbar: document.getElementById("rbdToolbar"),
    inpMissionTime: document.getElementById("inpMissionTime"),
    btnRbdAddBlock: document.getElementById("btnRbdAddBlock"),
    btnRbdAddHier: document.getElementById("btnRbdAddHier"),
    btnRbdAddSeries: document.getElementById("btnRbdAddSeries"),
    btnRbdAddParallel: document.getElementById("btnRbdAddParallel"),
    btnRbdAddKooN: document.getElementById("btnRbdAddKooN"),
    btnAutoLayout: document.getElementById("btnAutoLayout"),
    btnFitView: document.getElementById("btnFitView"),
    btnRoundTrip: document.getElementById("btnRoundTrip"),
    workspace: document.getElementById("workspace"),
    mryEditor: document.getElementById("mryEditor"),
    parseStatus: document.getElementById("parseStatus"),
    parseStatusText: document.getElementById("parseStatusText"),
    parseStatsMini: document.getElementById("parseStatsMini"),
    branchChips: document.getElementById("branchChips"),
    chkShowMeta: document.getElementById("chkShowMeta"),
    chkGravity: document.getElementById("chkGravity"),
    chkMirrors: document.getElementById("chkMirrors"),
    lblMirrors: document.getElementById("lblMirrors"),
    chkIeeeMode: document.getElementById("chkIeeeMode"),
    arcLabelMode: document.getElementById("arcLabelMode"),
    svgStage: document.getElementById("svgStage"),
    svg: document.getElementById("spnSvg"),
    canvasHint: document.getElementById("canvasHint"),
    legendOverlay: document.getElementById("legendOverlay"),
    figmaDock: document.getElementById("figmaDock"),
    selectionActionBar: document.getElementById("selectionActionBar"),
    selActionCount: document.getElementById("selActionCount"),
    btnFloatNewZone: document.getElementById("btnFloatNewZone"),
    btnFloatClone: document.getElementById("btnFloatClone"),
    btnFloatAlignY: document.getElementById("btnFloatAlignY"),
    btnFloatAlignX: document.getElementById("btnFloatAlignX"),
    btnFloatDelete: document.getElementById("btnFloatDelete"),
    btnToggleSim: document.getElementById("btnToggleSim"),
    simActionBar: document.getElementById("simActionBar"),
    simStepBadge: document.getElementById("simStepBadge"),
    simEnabledBadge: document.getElementById("simEnabledBadge"),
    btnSimStep: document.getElementById("btnSimStep"),
    btnSimStep5: document.getElementById("btnSimStep5"),
    btnSimBack: document.getElementById("btnSimBack"),
    btnSimReset: document.getElementById("btnSimReset"),
    chkSimImmPrio: document.getElementById("chkSimImmPrio"),
    btnSimExit: document.getElementById("btnSimExit"),
    tabBody: document.getElementById("tabBody"),
    tooltip: document.getElementById("svgTooltip")
  };

  // =========================================================================
  // SYNTAX HIGHLIGHTER & BIDIRECTIONAL CODE <-> VISUAL CROSS-HIGHLIGHT
  // =========================================================================
  const MRY_KW = new Set([
    "SPN", "RBD", "main", "place", "timedTransition", "immediateTransition",
    "block", "hierarchy", "series", "parallel", "kooN", "koutofn", "kofn",
    "top", "metric", "for", "in", "println", "print", "solve", "setIntegerParameters"
  ]);
  const MRY_PROPS = new Set([
    "inputs", "outputs", "inhibitors", "inhibitor", "delay", "serverType",
    "enablingFunction", "guard", "guardExpression", "priority", "weight", "policy",
    "tokens", "MTTF", "MTTR", "availability", "reliability", "time", "type",
    "parameters", "Value", "expression", "method", "model", "metrics", "evaluation"
  ]);

  function highlightMryLine(rawLine) {
    let out = "";
    let i = 0;
    const len = rawLine.length;
    while (i < len) {
      // Line comment
      if (rawLine[i] === "/" && rawLine[i + 1] === "/") {
        out += `<span class="tok-cmt">${escapeXml(rawLine.slice(i))}</span>`;
        break;
      }
      // Block comment on single line
      if (rawLine[i] === "/" && rawLine[i + 1] === "*") {
        const end = rawLine.indexOf("*/", i + 2);
        const slice = end >= 0 ? rawLine.slice(i, end + 2) : rawLine.slice(i);
        out += `<span class="tok-cmt">${escapeXml(slice)}</span>`;
        i += slice.length;
        continue;
      }
      // String literal (highlighting IF(...) / #Place inside strings!)
      if (rawLine[i] === '"') {
        let j = i + 1;
        while (j < len && rawLine[j] !== '"') {
          if (rawLine[j] === "\\" && j + 1 < len) j += 2;
          else j++;
        }
        if (j < len) j++;
        const str = rawLine.slice(i, j);
        const cls = /IF\s*\(|#[A-Za-z_]/.test(str) ? "tok-cond" : "tok-str";
        out += `<span class="${cls}">${escapeXml(str)}</span>`;
        i = j;
        continue;
      }
      // Number
      if (/[0-9]/.test(rawLine[i]) && (i === 0 || !/[A-Za-z0-9_]/.test(rawLine[i - 1]))) {
        let j = i;
        while (j < len && /[0-9.eE+\-]/.test(rawLine[j])) {
          if ((rawLine[j] === "+" || rawLine[j] === "-") && rawLine[j - 1] !== "e" && rawLine[j - 1] !== "E") break;
          j++;
        }
        out += `<span class="tok-num">${escapeXml(rawLine.slice(i, j))}</span>`;
        i = j;
        continue;
      }
      // Identifier / Keyword / Property
      if (/[A-Za-z_]/.test(rawLine[i])) {
        let j = i;
        while (j < len && /[A-Za-z0-9_]/.test(rawLine[j])) j++;
        const word = rawLine.slice(i, j);
        if (MRY_KW.has(word)) out += `<span class="tok-kw">${escapeXml(word)}</span>`;
        else if (MRY_PROPS.has(word)) out += `<span class="tok-prop">${escapeXml(word)}</span>`;
        else out += escapeXml(word);
        i = j;
        continue;
      }
      out += escapeXml(rawLine[i]);
      i++;
    }
    return out || " ";
  }

  function buildCodeMap(code, ast) {
    const lines = String(code || "").split(/\r?\n/);
    const map = [];

    // Precompute parameter -> referencing nodeIds so hovering a global parameter lights up all its users!
    const paramUsers = {};
    if (ast) {
      const addRef = (expr, nodeId) => {
        const s = String(expr || "");
        for (const p of ast.parameters || []) {
          if (new RegExp(`\\b${p.name}\\b`).test(s)) {
            if (!paramUsers[p.name]) paramUsers[p.name] = new Set();
            paramUsers[p.name].add(nodeId);
          }
        }
      };
      if (ast.modelType === "SPN") {
        for (const pl of ast.places || []) addRef(pl.tokens, `P:${pl.name}`);
        for (const tr of ast.transitions || []) {
          addRef(tr.delayExpr, `T:${tr.name}`);
          addRef(tr.priority, `T:${tr.name}`);
          addRef(tr.weight, `T:${tr.name}`);
        }
      } else if (ast.modelType === "RBD") {
        for (const b of ast.blocks || []) {
          addRef(b.mttf, `B:${b.name}`);
          addRef(b.mttr, `B:${b.name}`);
          addRef(b.availability, `B:${b.name}`);
          addRef(b.reliability, `B:${b.name}`);
        }
        for (const g of ast.groups || []) addRef(g.k, `G:${g.name}`);
      }
    }

    let i = 0;
    while (i < lines.length) {
      const lineNo = i + 1;
      const trimmed = lines[i].trim();

      // Match multi-line or single-line declarations ending in ';'
      const spnDecl = trimmed.match(/^(place|timedTransition|immediateTransition)\s+([A-Za-z_][A-Za-z0-9_]*)/);
      const rbdDecl = trimmed.match(/^(block|hierarchy|series|parallel|kooN|koutofn|kofn)\s+([A-Za-z_][A-Za-z0-9_]*)/i);
      const paramDecl = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      const metricDecl = trimmed.match(/^metric\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/);

      if (spnDecl || rbdDecl || metricDecl) {
        let endIdx = i;
        while (endIdx < lines.length && !lines[endIdx].includes(";")) endIdx++;
        if (spnDecl) {
          const kind = spnDecl[1] === "place" ? "P" : "T";
          map.push({ startLine: lineNo, endLine: endIdx + 1, nodeIds: [`${kind}:${spnDecl[2]}`], label: spnDecl[2] });
        } else if (rbdDecl) {
          const kw = rbdDecl[1].toLowerCase();
          const kind = kw === "block" || kw === "hierarchy" ? "B" : "G";
          map.push({ startLine: lineNo, endLine: endIdx + 1, nodeIds: [`${kind}:${rbdDecl[2]}`], label: rbdDecl[2] });
        } else if (metricDecl) {
          const blockTxt = lines.slice(i, endIdx + 1).join(" ");
          const refs = new Set();
          for (const m of blockTxt.matchAll(/#([A-Za-z_][A-Za-z0-9_]*)/g)) {
            refs.add(`P:${m[1]}`);
          }
          if (refs.size > 0) {
            map.push({ startLine: lineNo, endLine: endIdx + 1, nodeIds: Array.from(refs), label: `metric ${metricDecl[1]}` });
          }
        }
        i = endIdx + 1;
        continue;
      }

      if (paramDecl && paramUsers[paramDecl[1]]) {
        map.push({
          startLine: lineNo,
          endLine: lineNo,
          nodeIds: Array.from(paramUsers[paramDecl[1]]),
          label: `parâmetro ${paramDecl[1]}`
        });
      }
      i++;
    }
    return map;
  }

  function getSelectedNodeIdsForCode() {
    const ids = new Set();
    if (state.multiSelected.length > 0) {
      for (const id of state.multiSelected) ids.add(id);
    } else if (state.selected) {
      const s = state.selected;
      if (s.type === "place") ids.add(`P:${s.id}`);
      else if (s.type === "transition") ids.add(`T:${s.id}`);
      else if (s.type === "arc") ids.add(`T:${s.trName}`);
      else if (s.type === "rbdBlock") ids.add(`B:${s.id}`);
      else if (s.type === "rbdGroup") ids.add(`G:${s.id}`);
      else if (s.type === "zone") {
        const z = (state.zones || []).find((x) => x.id === s.id);
        if (z) for (const m of z.members || []) ids.add(m);
      }
    }
    return ids;
  }

  function renderCodeHighlight(scrollToSelection = false) {
    if (!dom.mryHighlight || !dom.mryGutter) return;
    const code = dom.mryEditor.value || "";
    const lines = code.split(/\r?\n/);

    const selectedIds = getSelectedNodeIdsForCode();
    const hoverId = state.hoveredNode ? `${state.hoveredNode.kind}:${state.hoveredNode.name}` : null;

    const activeLines = new Set();
    const hoverLines = new Set();
    let firstActiveLine = null;

    for (const entry of state.codeMap || []) {
      const matchesSel = entry.nodeIds.length === 1 && selectedIds.has(entry.nodeIds[0]);
      const matchesHover = hoverId && entry.nodeIds.length === 1 && entry.nodeIds[0] === hoverId;
      if (matchesSel) {
        if (firstActiveLine === null) firstActiveLine = entry.startLine;
        for (let ln = entry.startLine; ln <= entry.endLine; ln++) activeLines.add(ln);
      }
      if (matchesHover) {
        for (let ln = entry.startLine; ln <= entry.endLine; ln++) hoverLines.add(ln);
      }
    }
    if (state.codeHoverLine) hoverLines.add(state.codeHoverLine);

    let codeHtml = "";
    let gutterHtml = "";
    for (let i = 0; i < lines.length; i++) {
      const ln = i + 1;
      const cls = activeLines.has(ln) ? " hl-active" : hoverLines.has(ln) ? " hl-hover" : "";
      codeHtml += `<span class="code-line${cls}">${highlightMryLine(lines[i])}</span>`;
      gutterHtml += `<div class="ln${cls}">${ln}</div>`;
    }

    dom.mryHighlight.innerHTML = codeHtml;
    dom.mryGutter.innerHTML = gutterHtml;

    if (scrollToSelection && firstActiveLine !== null && !dom.workspace.classList.contains("hide-code")) {
      const targetY = Math.max(0, (firstActiveLine - 4) * 18);
      dom.mryEditor.scrollTop = targetY;
    }
    syncCodeScroll();
  }

  function syncCodeScroll() {
    if (!dom.mryHighlight || !dom.mryGutter) return;
    dom.mryHighlight.scrollTop = dom.mryEditor.scrollTop;
    dom.mryHighlight.scrollLeft = dom.mryEditor.scrollLeft;
    dom.mryGutter.scrollTop = dom.mryEditor.scrollTop;
  }

  function renderCodeSyncOverlay() {
    const layer = dom.svg.querySelector("#codeSyncLayer");
    if (!layer) return;
    const ids = state.codeSyncNodes || [];
    if (ids.length === 0 || !state.ast) {
      layer.innerHTML = "";
      return;
    }

    let svg = "";
    if (state.ast.modelType === "RBD" && state.rbdLayout) {
      for (const id of ids) {
        if (id.startsWith("B:")) {
          const bx = state.rbdLayout.boxes.find((x) => x.name === id.slice(2));
          if (bx) {
            svg += `<rect x="${bx.x - 5}" y="${bx.y - 5}" width="${bx.w + 10}" height="${bx.h + 10}" rx="10" fill="rgba(245, 158, 11, 0.14)" stroke="#f59e0b" stroke-width="3" stroke-dasharray="6,3" />`;
          }
        } else if (id.startsWith("G:")) {
          const gf = state.rbdLayout.groupFrames.find((x) => x.name === id.slice(2));
          if (gf) {
            svg += `<rect x="${gf.x - 4}" y="${gf.y - 4}" width="${gf.w + 8}" height="${gf.h + 8}" rx="12" fill="rgba(245, 158, 11, 0.10)" stroke="#f59e0b" stroke-width="3" />`;
          }
        }
      }
    } else {
      for (const id of ids) {
        const pt = state.positions[id];
        if (!pt) continue;
        if (id.startsWith("P:")) {
          svg += `<circle cx="${pt.x}" cy="${pt.y}" r="${PLACE_R + 9}" fill="rgba(245, 158, 11, 0.15)" stroke="#f59e0b" stroke-width="3" stroke-dasharray="6,3" />`;
        } else if (id.startsWith("T:")) {
          const tr = state.ast.transitions.find((t) => t.name === id.slice(2));
          const dim = tr ? getTransDim(tr) : { w: 20, h: 52 };
          svg += `<rect x="${pt.x - dim.w / 2 - 9}" y="${pt.y - dim.h / 2 - 9}" width="${dim.w + 18}" height="${dim.h + 18}" rx="6" fill="rgba(245, 158, 11, 0.15)" stroke="#f59e0b" stroke-width="3" stroke-dasharray="6,3" />`;
        }
      }
    }
    layer.innerHTML = svg;
  }

  function updateCodeLineCrossHighlight(lineNo) {
    if (!lineNo) {
      if (state.codeHoverLine !== null || state.codeSyncNodes.length > 0) {
        state.codeHoverLine = null;
        state.codeSyncNodes = [];
        renderCodeHighlight(false);
        renderCodeSyncOverlay();
      }
      return;
    }

    const found = (state.codeMap || []).find((e) => lineNo >= e.startLine && lineNo <= e.endLine);
    const nextNodes = found ? found.nodeIds : [];
    const changed =
      state.codeHoverLine !== lineNo ||
      nextNodes.length !== state.codeSyncNodes.length ||
      nextNodes.some((id, idx) => id !== state.codeSyncNodes[idx]);

    if (changed) {
      state.codeHoverLine = lineNo;
      state.codeSyncNodes = nextNodes;
      renderCodeHighlight(false);
      renderCodeSyncOverlay();
      if (found) {
        dom.canvasHint.textContent = `Código L${lineNo} ↔ Visual: ${found.label} (${nextNodes.length} elemento${nextNodes.length > 1 ? "s" : ""} destacado${nextNodes.length > 1 ? "s" : ""})`;
      }
    }
  }

  // =========================================================================
  // UNDO / REDO HISTORY & PER-FILE INDEXED AUTOSAVE MEMORY
  // =========================================================================
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function captureSnapshot() {
    return {
      code: dom.mryEditor.value,
      positions: deepClone(state.positions || {}),
      zones: deepClone(state.zones || []),
      missionTime: state.missionTime
    };
  }

  function updateHistoryButtons() {
    dom.btnUndo.disabled = state.undoStack.length === 0;
    dom.btnRedo.disabled = state.redoStack.length === 0;
  }

  function resetHistory() {
    state.undoStack = [];
    state.redoStack = [];
    state.lastCommittedSnap = captureSnapshot();
    updateHistoryButtons();
  }

  function commitHistory() {
    const cur = captureSnapshot();
    if (!state.lastCommittedSnap) {
      state.lastCommittedSnap = cur;
      scheduleAutosave();
      return;
    }
    if (JSON.stringify(cur) !== JSON.stringify(state.lastCommittedSnap)) {
      state.undoStack.push(state.lastCommittedSnap);
      if (state.undoStack.length > 80) state.undoStack.shift();
      state.redoStack = [];
      state.lastCommittedSnap = cur;
      updateHistoryButtons();
      scheduleAutosave();
      broadcastCollabState();
    }
  }

  function applySnapshot(snap, statusMsg) {
    if (!snap) return;
    state.suppressEditorInput = true;
    dom.mryEditor.value = snap.code;
    state.suppressEditorInput = false;
    state.positions = deepClone(snap.positions || {});
    state.zones = deepClone(snap.zones || []);
    state.missionTime = snap.missionTime;
    state.selected = null;
    loadFromCode(snap.code, false, true);
    state.lastCommittedSnap = captureSnapshot();
    updateHistoryButtons();
    setParseStatus(true, statusMsg);
    scheduleAutosave();
  }

  function performUndo() {
    if (state.undoStack.length === 0) return;
    const prev = state.undoStack.pop();
    if (state.lastCommittedSnap) state.redoStack.push(state.lastCommittedSnap);
    applySnapshot(prev, `Desfeito (${state.undoStack.length} no histórico)`);
  }

  function performRedo() {
    if (state.redoStack.length === 0) return;
    const next = state.redoStack.pop();
    if (state.lastCommittedSnap) state.undoStack.push(state.lastCommittedSnap);
    applySnapshot(next, `Refeito (${state.redoStack.length} para refazer)`);
  }

  function loadMemoryIndex() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_INDEX_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function saveMemoryIndex(idx) {
    try {
      localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(idx));
    } catch (_) {}
  }

  function getFileMemory(fileKey) {
    if (!fileKey) return null;
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + fileKey);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveCurrentToMemory() {
    if (!state.fileKey || !state.ast) return;
    try {
      const now = new Date();
      const payload = {
        code: dom.mryEditor.value,
        positions: state.positions,
        zones: state.zones,
        view: state.view,
        missionTime: state.missionTime,
        useGravity: state.useGravity,
        useMirrors: state.useMirrors,
        arcLabelMode: state.arcLabelMode,
        savedAt: now.toISOString()
      };
      localStorage.setItem(STORAGE_PREFIX + state.fileKey, JSON.stringify(payload));
      localStorage.setItem(STORAGE_LAST_KEY, state.fileKey);

      const idx = loadMemoryIndex();
      idx[state.fileKey] = {
        key: state.fileKey,
        displayName: state.fileLabel || state.fileKey,
        isCustomFile: state.fileKey.startsWith("file:"),
        savedAt: payload.savedAt
      };
      saveMemoryIndex(idx);

      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      dom.autosaveBadge.textContent = `💾 Salvo ${hh}:${mm}:${ss}`;
      dom.btnResetMemory.style.display = "flex";
      if (dom.resetMenuSep) dom.resetMenuSep.style.display = "block";
      rebuildPresetDropdown(false);
    } catch (_) {
      dom.autosaveBadge.textContent = "";
    }
  }

  function scheduleAutosave() {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(saveCurrentToMemory, 260);
  }

  function clearMemoryForCurrentFile() {
    if (!state.fileKey) return;
    try {
      localStorage.removeItem(STORAGE_PREFIX + state.fileKey);
      const idx = loadMemoryIndex();
      delete idx[state.fileKey];
      saveMemoryIndex(idx);
    } catch (_) {}

    if (state.fileKey.startsWith("preset:")) {
      const pid = state.fileKey.slice(7);
      const pr = PRESETS.find((p) => p.id === pid);
      if (pr) {
        openWorkspaceEntry(state.fileKey, pr.name, pr.code, false);
        setParseStatus(true, "Memória limpa — modelo restaurado para o original");
      }
    } else {
      // Custom file removed from memory: fall back to first preset
      const pr = PRESETS[0];
      if (pr) openWorkspaceEntry("preset:" + pr.id, pr.name, pr.code, true);
    }
    rebuildPresetDropdown(true);
  }

  function rebuildPresetDropdown(syncValue = true) {
    const idx = loadMemoryIndex();
    const curKey = state.fileKey;
    const customFiles = Object.values(idx)
      .filter((e) => e.isCustomFile)
      .sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));

    let html = `<optgroup label="Modelos do Repositório">`;
    for (const p of PRESETS) {
      const key = "preset:" + p.id;
      const hasMem = Boolean(idx[key]);
      html += `<option value="${escapeXml(key)}">${hasMem ? "● " : ""}${escapeXml(p.name)}</option>`;
    }
    html += `</optgroup>`;

    if (customFiles.length > 0) {
      html += `<optgroup label="Arquivos Locais na Memória">`;
      for (const cf of customFiles) {
        html += `<option value="${escapeXml(cf.key)}">💾 ${escapeXml(cf.displayName)}</option>`;
      }
      html += `</optgroup>`;
    }

    dom.presetSelect.innerHTML = html;
    if (syncValue && curKey) {
      dom.presetSelect.value = curKey;
    } else if (curKey) {
      dom.presetSelect.value = curKey;
    }
  }

  function openWorkspaceEntry(fileKey, fileLabel, fallbackCode, useSavedMemory = true) {
    if (state.isEmptyEditor) exitEmptyEditorState();
    state.fileKey = fileKey;
    state.fileLabel = fileLabel;
    state.selected = null;
    state.multiSelected = [];
    if (state.simMode) exitSimMode(true);
    state.branchFilter = "ALL";
    const mem = useSavedMemory ? getFileMemory(fileKey) : null;

    if (mem && mem.code) {
      dom.mryEditor.value = mem.code;
      state.positions = deepClone(mem.positions || {});
      state.zones = deepClone(mem.zones || []);
      state.missionTime = mem.missionTime ?? null;
      if (typeof mem.useGravity === "boolean") {
        state.useGravity = mem.useGravity;
        dom.chkGravity.checked = mem.useGravity;
      }
      if (typeof mem.useMirrors === "boolean") {
        state.useMirrors = mem.useMirrors;
        if (dom.chkMirrors) dom.chkMirrors.checked = mem.useMirrors;
      } else {
        state.useMirrors = false;
        if (dom.chkMirrors) dom.chkMirrors.checked = false;
      }
      if (dom.btnQuickMirrors) {
        dom.btnQuickMirrors.classList.toggle("active", state.useMirrors);
        dom.btnQuickMirrors.setAttribute("aria-pressed", String(state.useMirrors));
      }
      if (mem.arcLabelMode) {
        state.arcLabelMode = mem.arcLabelMode;
        dom.arcLabelMode.value = mem.arcLabelMode;
      }
      loadFromCode(mem.code, false, true);
      if (mem.view && mem.view.w) {
        state.view = deepClone(mem.view);
        renderCanvas();
      } else {
        fitView();
      }
      const d = mem.savedAt ? new Date(mem.savedAt) : null;
      dom.autosaveBadge.textContent = d
        ? `💾 Restaurado (${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")})`
        : "💾 Restaurado";
      dom.btnResetMemory.style.display = "flex";
      if (dom.resetMenuSep) dom.resetMenuSep.style.display = "block";
    } else {
      dom.mryEditor.value = fallbackCode;
      state.positions = {};
      state.zones = [];
      state.missionTime = null;
      loadFromCode(fallbackCode, true, false);
      dom.autosaveBadge.textContent = "";
      dom.btnResetMemory.style.display = "none";
      if (dom.resetMenuSep) dom.resetMenuSep.style.display = "none";
    }

    try {
      localStorage.setItem(STORAGE_LAST_KEY, fileKey);
    } catch (_) {}
    resetHistory();
    rebuildPresetDropdown(true);
  }

  // =========================================================================
  // TOKEN GAME CONTROLLER (INTERACTIVE SPN SIMULATOR)
  // =========================================================================
  function updateSimBar() {
    if (!dom.simActionBar) return;
    const active = state.simMode && state.ast && state.ast.modelType === "SPN" && state.simMarking;
    dom.simActionBar.style.display = active ? "flex" : "none";
    if (dom.btnToggleSim) dom.btnToggleSim.classList.toggle("active-sim", Boolean(active));
    if (!active) return;

    const en = Core.getEnabledTransitions(state.ast, state.simMarking, state.simRespectImm);
    dom.simStepBadge.textContent = `🎮 Passo #${state.simHistory.length}`;
    if (en.fireable.size === 0) {
      dom.simEnabledBadge.textContent = "⛔ Deadlock (0)";
      dom.simEnabledBadge.classList.add("deadlock");
    } else {
      dom.simEnabledBadge.classList.remove("deadlock");
      dom.simEnabledBadge.textContent = en.immPreempting
        ? `⚡ ${en.fireable.size} imed.`
        : `${en.fireable.size} habilitada${en.fireable.size > 1 ? "s" : ""}`;
    }
    dom.btnSimStep.disabled = en.fireable.size === 0;
    dom.btnSimStep5.disabled = en.fireable.size === 0;
    dom.btnSimBack.disabled = state.simHistory.length === 0;
  }

  function enterSimMode() {
    if (!state.ast || state.ast.modelType !== "SPN") return;
    state.simMode = true;
    state.connectSource = null;
    state.connectCursor = null;
    state.multiSelected = [];
    state.selected = null;
    state.simInitMarking = Core.createInitialMarking(state.ast);
    state.simMarking = { ...state.simInitMarking };
    state.simHistory = [];
    state.simLastDeltas = {};
    state.simLastReason = "";
    state.activeTab = "inspector";
    updateTabButtons();
    updateModeToolbars();
    renderCanvas();
    renderRightPanel();
    setParseStatus(true, "Token Game iniciado — clique em uma transição verde (▶) para disparar");
  }

  function exitSimMode(silent = false) {
    state.simMode = false;
    state.simLastDeltas = {};
    state.simLastReason = "";
    updateModeToolbars();
    if (!silent) {
      renderCanvas();
      renderRightPanel();
      setParseStatus(true, "Modo edição restaurado");
    }
  }

  function toggleSimMode() {
    if (state.simMode) exitSimMode(false);
    else enterSimMode();
  }

  function resetSimMarking() {
    if (!state.ast || state.ast.modelType !== "SPN") return;
    state.simInitMarking = Core.createInitialMarking(state.ast);
    state.simMarking = { ...state.simInitMarking };
    state.simHistory = [];
    state.simLastDeltas = {};
    state.simLastReason = "";
    updateSimBar();
    renderCanvas();
    renderRightPanel();
    setParseStatus(true, "Marcação reiniciada para M₀");
  }

  function stepSimFire(trName, silentStatus = false) {
    if (!state.simMode || !state.ast || !state.simMarking) return false;
    const en = Core.getEnabledTransitions(state.ast, state.simMarking, state.simRespectImm);
    if (!en.fireable.has(trName)) {
      const exp = Core.explainTransitionStatus(state.ast, trName, state.simMarking, state.simRespectImm);
      state.simLastReason = `${trName}: ${exp.reasons.join(" | ")}`;
      if (!silentStatus) {
        dom.canvasHint.textContent = `⛔ ${state.simLastReason}`;
        renderRightPanel();
      }
      return false;
    }
    const prev = { ...state.simMarking };
    const res = Core.fireTransition(state.ast, trName, state.simMarking);
    if (!res) return false;

    const deltaMap = {};
    for (const pl of state.ast.places) {
      const diff = (res.marking[pl.name] ?? 0) - (prev[pl.name] ?? 0);
      if (diff !== 0) deltaMap[pl.name] = diff;
    }

    state.simHistory.push({ prevMarking: prev, trName, deltas: res.deltas });
    if (state.simHistory.length > 200) state.simHistory.shift();
    state.simMarking = res.marking;
    state.simLastDeltas = deltaMap;
    state.simLastReason = "";
    if (!silentStatus) {
      updateSimBar();
      renderCanvas();
      renderRightPanel();
      setParseStatus(true, `Disparou '${trName}' (${res.deltas.join(", ") || "sem alteração"})`);
      broadcastCollabState();
    }
    return true;
  }

  function stepSimRandom(count = 1) {
    if (!state.simMode || !state.ast || !state.simMarking) return;
    const paramMap = Core.buildParamMap(state.ast);
    let fired = 0;
    let lastTr = "";
    for (let k = 0; k < count; k++) {
      const en = Core.getEnabledTransitions(state.ast, state.simMarking, state.simRespectImm);
      const list = Array.from(en.fireable);
      if (list.length === 0) break;
      // Weight-aware random pick for immediate transitions
      const weights = list.map((name) => {
        const tr = state.ast.transitions.find((t) => t.name === name);
        const w = tr && tr.weight ? Core.resolveValue(tr.weight, paramMap) : 1;
        return w !== null && w > 0 ? w : 1;
      });
      const sumW = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * sumW;
      let chosen = list[0];
      for (let i = 0; i < list.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          chosen = list[i];
          break;
        }
      }
      if (stepSimFire(chosen, true)) {
        fired++;
        lastTr = chosen;
      }
    }
    updateSimBar();
    renderCanvas();
    renderRightPanel();
    if (fired === 0) {
      setParseStatus(false, "Deadlock — nenhuma transição habilitada para disparar!");
    } else {
      setParseStatus(true, fired === 1 ? `Disparou '${lastTr}'` : `${fired} disparos executados (último: '${lastTr}')`);
    }
  }

  function stepSimBack() {
    if (!state.simMode || state.simHistory.length === 0) return;
    const last = state.simHistory.pop();
    state.simMarking = last.prevMarking;
    state.simLastDeltas = {};
    state.simLastReason = "";
    updateSimBar();
    renderCanvas();
    renderRightPanel();
    setParseStatus(true, `Desfeito disparo '${last.trName}' (Passo #${state.simHistory.length})`);
  }

  function adjustSimToken(placeName, delta) {
    if (!state.simMode || !state.simMarking) return;
    const cur = state.simMarking[placeName] ?? 0;
    const next = Math.max(0, cur + delta);
    if (next === cur) return;
    state.simHistory.push({
      prevMarking: { ...state.simMarking },
      trName: `[Manual ${delta > 0 ? "+1" : "-1"} ${placeName}]`,
      deltas: [`${delta > 0 ? "+" : ""}${delta} ${placeName}`]
    });
    state.simMarking[placeName] = next;
    state.simLastDeltas = { [placeName]: delta };
    state.simLastReason = "";
    updateSimBar();
    renderCanvas();
    renderRightPanel();
  }

  // =========================================================================
  // CORE SYNCHRONIZATION (MRY <-> AST <-> VISUAL)
  // =========================================================================
  function updateSelectionActionBar() {
    if (!dom.selectionActionBar) return;
    if (!state.simMode && state.ast && state.ast.modelType === "SPN" && state.multiSelected.length >= 2) {
      dom.selectionActionBar.style.display = "flex";
      dom.selActionCount.textContent = `${state.multiSelected.length} selecionados`;
    } else {
      dom.selectionActionBar.style.display = "none";
    }
  }

  function updateModeToolbars() {
    const isRbd = state.ast && state.ast.modelType === "RBD";
    dom.spnToolbar.style.display = isRbd ? "none" : "flex";
    dom.rbdToolbar.style.display = isRbd ? "flex" : "none";
    dom.arcLabelMode.style.display = isRbd ? "none" : "inline-block";
    if (dom.lblMirrors) dom.lblMirrors.style.display = isRbd ? "none" : "inline-flex";
    updateSelectionActionBar();
    updateSimBar();
    if (isRbd) {
      dom.canvasHint.textContent = "RBD: Clique em Bloco/Grupo para editar • Ctrl+Z Desfazer • Autosave por arquivo ativo";
    } else if (state.simMode) {
      dom.canvasHint.textContent = "🎮 Token Game: clique numa transição verde (▶) para disparar • Clique numa bloqueada para ver motivo • Esc sai";
    } else if (state.connectSource) {
      const cLabel = state.connectorType === "inhibitor" ? "Inibidor ○" : "Arco Normal →";
      dom.canvasHint.textContent = `Conectando [${cLabel}] de '${state.connectSource.name}': clique no destino • Tab alterna conector • Esc/vazio cancela`;
    } else if (state.multiSelected.length > 0) {
      dom.canvasHint.textContent = `${state.multiSelected.length} itens selecionados: Arraste para mover (Shift reto, Ctrl p/ Área, Alt clonar bloco) • Del apaga todos`;
    } else if (state.activeTool === "select") {
      dom.canvasHint.textContent = "Arraste no vazio: caixa de seleção | Espaço/Botão meio: Pan | Clique rápido: conectar | Segurar: mover";
    }
  }

  function loadFromCode(code, resetLayout = false, preserveZonesExact = false) {
    try {
      const ast = Core.parseMry(code);
      state.ast = ast;
      if (resetLayout) state.missionTime = null;

      if (ast.modelType === "RBD") {
        if (state.simMode) state.simMode = false;
        state.audit = Core.auditModel(ast, { missionTime: state.missionTime });
        dom.inpMissionTime.value = state.audit.rbdEval.missionTime;
        state.rbdLayout = Core.computeRbdLayout(ast);
        state.positions = {};
        for (const bx of state.rbdLayout.boxes) {
          state.positions[`B:${bx.name}`] = { x: bx.cx, y: bx.cy };
        }
        for (const gf of state.rbdLayout.groupFrames) {
          state.positions[`G:${gf.name}`] = { x: gf.x + gf.w / 2, y: gf.y + gf.h / 2 };
        }
      } else {
        state.rbdLayout = null;
        state.audit = Core.auditModel(ast);
        if (state.simMode) {
          // Keep live simulation consistent if user edits code while simulating
          const freshM0 = Core.createInitialMarking(ast);
          state.simInitMarking = freshM0;
          const synced = {};
          for (const pl of ast.places) {
            synced[pl.name] = state.simMarking && Object.prototype.hasOwnProperty.call(state.simMarking, pl.name)
              ? state.simMarking[pl.name]
              : freshM0[pl.name];
          }
          state.simMarking = synced;
        }
        const autoPos = Core.computeAutoLayout(ast);
        if (resetLayout || Object.keys(state.positions).length === 0) {
          state.positions = Object.assign({}, autoPos, ast.layout || {});
          state.zones = ast.zones
            ? JSON.parse(JSON.stringify(ast.zones))
            : Core.computeDefaultZones(ast);
        } else {
          const nextPos = {};
          for (const [k, v] of Object.entries(autoPos)) {
            nextPos[k] = state.positions[k] || (ast.layout && ast.layout[k]) || v;
          }
          // Preserve custom user-dragged mirror coordinates (M:tr:pl and MT:pl:tr) AND fixed connector inflection points (W:arcId)
          for (const srcMap of [ast.layout || {}, state.positions || {}]) {
            for (const [k, v] of Object.entries(srcMap)) {
              if ((k.startsWith("M:") || k.startsWith("MT:")) && v && Number.isFinite(v.x) && Number.isFinite(v.y)) {
                nextPos[k] = { x: v.x, y: v.y };
              } else if (k.startsWith("W:") && Array.isArray(v) && v.length > 0) {
                nextPos[k] = v
                  .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
                  .map((p) => ({ x: p.x, y: p.y }));
              }
            }
          }
          state.positions = nextPos;
          const validIds = new Set(Object.keys(nextPos));
          if (ast.zones && !preserveZonesExact) {
            state.zones = JSON.parse(JSON.stringify(ast.zones));
          } else {
            state.zones = (state.zones || []).map((z) => ({
              ...z,
              members: (z.members || []).filter((id) => validIds.has(id))
            }));
          }
        }
      }

      updateModeToolbars();
      state.codeMap = buildCodeMap(code, ast);
      setParseStatus(true, `Sincronizado (${ast.modelType}: MRY → Visual)`);
      refreshBranchChips();
      renderCanvas();
      renderCodeHighlight(false);
      if (resetLayout) fitView();
      renderRightPanel();
    } catch (err) {
      renderCodeHighlight(false);
      setParseStatus(false, err.message);
    }
  }

  function syncVisualToMry(note = "Sincronizado (Visual → MRY)", skipHistory = false) {
    if (!state.ast) return;
    if (state.ast.modelType === "RBD") {
      state.audit = Core.auditModel(state.ast, { missionTime: state.missionTime });
      state.rbdLayout = Core.computeRbdLayout(state.ast);
      state.positions = {};
      for (const bx of state.rbdLayout.boxes) state.positions[`B:${bx.name}`] = { x: bx.cx, y: bx.cy };
      for (const gf of state.rbdLayout.groupFrames) state.positions[`G:${gf.name}`] = { x: gf.x + gf.w / 2, y: gf.y + gf.h / 2 };
    } else {
      state.audit = Core.auditModel(state.ast);
    }
    const code = Core.generateMry(state.ast, { includeLayoutComment: false });
    state.suppressEditorInput = true;
    dom.mryEditor.value = code;
    state.suppressEditorInput = false;
    state.codeMap = buildCodeMap(code, state.ast);
    updateModeToolbars();
    setParseStatus(true, note);
    refreshBranchChips();
    renderCanvas();
    renderCodeHighlight(true);
    renderRightPanel();
    if (!skipHistory) commitHistory();
  }

  function setParseStatus(ok, msg) {
    dom.parseStatus.className = "parse-status " + (ok ? "ok" : "err");
    dom.parseStatusText.textContent = (ok ? "✓ " : "✗ ") + msg;
    if (ok && state.audit) {
      const s = state.audit.stats;
      if (state.ast && state.ast.modelType === "RBD") {
        dom.parseStatsMini.textContent = `RBD • ${s.blocks}B • ${s.groups}G • ${s.spofs} SPOF`;
      } else {
        dom.parseStatsMini.textContent = `SPN • ${s.places}L • ${s.transitions}T • ${s.totalArcs}A`;
      }
    } else {
      dom.parseStatsMini.textContent = "";
    }
  }

  // =========================================================================
  // FILTER CHIPS
  // =========================================================================
  function refreshBranchChips() {
    if (!state.ast) return;
    let items = [];
    if (state.ast.modelType === "RBD") {
      items = [
        { id: "ALL", label: "Todos" },
        { id: "SPOF_ONLY", label: "Apenas SPOFs" },
        { id: "HIER_ONLY", label: "Hierárquicos (R/A)" }
      ];
    } else {
      items = [{ id: "ALL", label: "Todos" }];
      for (const z of state.zones || []) {
        items.push({ id: `zone:${z.id}`, label: z.label });
      }
      items.push({ id: "COND_ONLY", label: "Guards / IF / Inib." });
    }

    if (!items.some((x) => x.id === state.branchFilter)) {
      state.branchFilter = "ALL";
    }

    dom.branchChips.innerHTML = items
      .map(
        (it) =>
          `<span class="chip ${state.branchFilter === it.id ? "active" : ""}" data-branch="${it.id}">${it.label}</span>`
      )
      .join("");

    dom.branchChips.querySelectorAll(".chip").forEach((el) => {
      el.addEventListener("click", () => {
        state.branchFilter = el.dataset.branch;
        refreshBranchChips();
        renderCanvas();
      });
    });
  }

  // =========================================================================
  // GEOMETRY HELPERS FOR CLEAN SPN ARCS
  // =========================================================================
  const PLACE_R = 28;
  function getTransDim(tr) {
    if (tr.kind === "immediate") return { w: 9, h: 48 };
    return { w: 20, h: 52 };
  }

  function clipCircle(cx, cy, r, tx, ty) {
    const dx = tx - cx;
    const dy = ty - cy;
    const d = Math.hypot(dx, dy) || 1;
    return { x: cx + (dx / d) * r, y: cy + (dy / d) * r };
  }

  function clipRect(cx, cy, hw, hh, tx, ty) {
    const dx = tx - cx;
    const dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function escapeXml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // =========================================================================
  // SVG RENDERER (TRANSPARENT, ZERO HIDDEN SPN DATA)
  // =========================================================================
  function computeZoneRect(z, excludeNodeIds = null) {
    const excl =
      excludeNodeIds instanceof Set
        ? excludeNodeIds
        : Array.isArray(excludeNodeIds)
        ? new Set(excludeNodeIds)
        : excludeNodeIds
        ? new Set([excludeNodeIds])
        : null;
    const pts = (z.members || [])
      .filter((id) => !excl || !excl.has(id))
      .map((id) => state.positions[id])
      .filter(Boolean);
    if (pts.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const padX = 76;
      const padY = 74;
      return { x: minX - padX, y: minY - padY, w: maxX - minX + padX * 2, h: maxY - minY + padY * 2, count: pts.length };
    }
    const ep = z.emptyPos || { x: 160, y: 120 };
    return { x: ep.x, y: ep.y, w: 260, h: 120, count: 0 };
  }

  function findZoneAtPoint(x, y, excludeNodeId = null) {
    // Check in reverse order so topmost drawn zone wins if overlapping
    const zones = state.zones || [];
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      const r = computeZoneRect(z, excludeNodeId);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        return z;
      }
    }
    return null;
  }

  function buildSvgContent(forExport = false) {
    if (!state.ast || !state.audit) return "";
    if (state.ast.modelType === "RBD") {
      return buildRbdSvgContent(forExport);
    }
    const ast = state.ast;
    const audit = state.audit;
    const ieee = state.ieeeMode;

    // Collect & route all arcs deterministically (optionally projecting long arcs to Shadow/Mirror Places & Incoming Place Mirrors)
    const spnGraph = Core.computeSpnArcGraph(ast, state.positions, {
      useGravity: state.useGravity,
      useMirrors: state.useMirrors
    });
    const allArcs = [...spnGraph.arcs, ...(spnGraph.placeInputArcs || [])];
    const mirrors = spnGraph.mirrors || [];
    state.lastMirrors = mirrors;
    state.lastRenderedArcs = allArcs;

    const simActive = !forExport && state.simMode && Boolean(state.simMarking);
    const simEnabled = simActive
      ? Core.getEnabledTransitions(ast, state.simMarking, state.simRespectImm)
      : null;

    // Determine focus highlight set
    const focusedNodes = new Set();
    const focusedArcs = new Set();
    const focusedMirrors = new Set();
    let hasFocus = false;

    if (!forExport && !simActive && state.multiSelected.length > 0) {
      hasFocus = true;
      for (const mId of state.multiSelected) focusedNodes.add(mId);
      for (const a of allArcs) {
        if (focusedNodes.has(a.srcId) || focusedNodes.has(a.dstId)) {
          focusedArcs.add(a.id);
          if (a.baseArcId) focusedArcs.add(a.baseArcId);
          focusedNodes.add(a.srcId);
          focusedNodes.add(a.dstId);
          if (a.mirrorId) focusedMirrors.add(a.mirrorId);
        }
      }
    } else if (!forExport && !simActive && state.selected) {
      hasFocus = true;
      if (state.selected.type === "place") {
        const pid = `P:${state.selected.id}`;
        focusedNodes.add(pid);
        for (const a of allArcs) {
          if (a.srcId === pid || a.dstId === pid) {
            focusedArcs.add(a.id);
            if (a.baseArcId) focusedArcs.add(a.baseArcId);
            focusedNodes.add(a.srcId);
            focusedNodes.add(a.dstId);
            if (a.mirrorId) focusedMirrors.add(a.mirrorId);
          }
        }
      } else if (state.selected.type === "transition") {
        const tid = `T:${state.selected.id}`;
        focusedNodes.add(tid);
        for (const a of allArcs) {
          if (a.srcId === tid || a.dstId === tid) {
            focusedArcs.add(a.id);
            if (a.baseArcId) focusedArcs.add(a.baseArcId);
            focusedNodes.add(a.srcId);
            focusedNodes.add(a.dstId);
            if (a.mirrorId) focusedMirrors.add(a.mirrorId);
          }
        }
      } else if (state.selected.type === "arc") {
        focusedArcs.add(state.selected.id);
        for (const a of allArcs) {
          if (a.id === state.selected.id || a.baseArcId === state.selected.id) {
            focusedArcs.add(a.id);
            focusedNodes.add(a.srcId);
            focusedNodes.add(a.dstId);
            if (a.mirrorId) focusedMirrors.add(a.mirrorId);
          }
        }
      } else if (state.selected.type === "zone") {
        const z = (state.zones || []).find((x) => x.id === state.selected.id);
        if (z && z.members.length > 0) {
          for (const mId of z.members) focusedNodes.add(mId);
          for (const a of allArcs) {
            if (focusedNodes.has(a.srcId) || focusedNodes.has(a.dstId)) {
              focusedArcs.add(a.id);
              focusedNodes.add(a.srcId);
              focusedNodes.add(a.dstId);
              if (a.mirrorId) focusedMirrors.add(a.mirrorId);
            }
          }
        } else {
          hasFocus = false;
        }
      }
    } else if (!forExport && !simActive && state.branchFilter !== "ALL") {
      hasFocus = true;
      if (state.branchFilter === "COND_ONLY") {
        for (const tr of ast.transitions) {
          if (tr.guard) focusedNodes.add(`T:${tr.name}`);
        }
        for (const a of allArcs) {
          const mult = String(a.arc.multiplicity || "1").trim();
          if (a.dir === "inh" || a.arc.isConditional || mult !== "1") {
            focusedArcs.add(a.id);
            focusedNodes.add(a.srcId);
            focusedNodes.add(a.dstId);
            if (a.mirrorId) focusedMirrors.add(a.mirrorId);
          }
        }
      } else if (state.branchFilter.startsWith("zone:")) {
        const zId = state.branchFilter.slice(5);
        const z = (state.zones || []).find((x) => x.id === zId);
        if (z) {
          for (const mId of z.members || []) focusedNodes.add(mId);
          for (const a of allArcs) {
            if (focusedNodes.has(a.srcId) || focusedNodes.has(a.dstId)) {
              focusedArcs.add(a.id);
              focusedNodes.add(a.srcId);
              focusedNodes.add(a.dstId);
              if (a.mirrorId) focusedMirrors.add(a.mirrorId);
            }
          }
        }
      }
    }

    const colorNormal = ieee ? "#111827" : "#334155";
    const colorCondIn = ieee ? "#111827" : "#2563eb";
    const colorCondOut = ieee ? "#111827" : "#7c3aed";
    const colorInh = ieee ? "#111827" : "#dc2626";
    const colorSel = ieee ? "#111827" : "#0284c7";
    const fontFamily = ieee ? "Georgia, 'Times New Roman', serif" : "'Inter', 'Segoe UI', sans-serif";
    const monoFamily = "'JetBrains Mono', Consolas, monospace";

    const defs = `
      <defs>
        <marker id="arrow-normal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="${colorNormal}" />
        </marker>
        <marker id="arrow-cond-in" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="${colorCondIn}" />
        </marker>
        <marker id="arrow-cond-out" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="${colorCondOut}" />
        </marker>
        <marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse">
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="${colorSel}" />
        </marker>
        <marker id="inhibitor-circle" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto">
          <circle cx="6" cy="6" r="4.2" fill="#ffffff" stroke="${colorInh}" stroke-width="1.8" />
        </marker>
      </defs>
    `;

    // Editable visual Areas (Zones) — clickable & draggable by title handle, never blocking inner nodes!
    let bandsSvg = "";
    const hexToRgba = (hex, alpha) => {
      const m = String(hex || "#0284c7").replace("#", "");
      if (m.length !== 6) return `rgba(2, 132, 199, ${alpha})`;
      const r = parseInt(m.slice(0, 2), 16);
      const g = parseInt(m.slice(2, 4), 16);
      const b = parseInt(m.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const reparentExclude = !forExport && state.reparentState ? state.reparentState.nodeIds : null;
    const reparentTargetId = !forExport && state.reparentState ? state.reparentState.targetZoneId : null;

    for (const z of state.zones || []) {
      const rect = computeZoneRect(z, reparentExclude);
      const { x, y, w, h, count } = rect;

      const isSel = !forExport && state.selected && state.selected.type === "zone" && state.selected.id === z.id;
      const isDropTarget = !forExport && reparentTargetId === z.id;
      const baseColor = z.color || "#0284c7";
      const fill = ieee
        ? "none"
        : isDropTarget
        ? "rgba(16, 185, 129, 0.14)"
        : hexToRgba(baseColor, isSel ? 0.1 : 0.045);
      const stroke = isDropTarget
        ? "#10b981"
        : isSel
        ? "#0284c7"
        : ieee
        ? "#9ca3af"
        : hexToRgba(baseColor, 0.55);
      const pillBg = isDropTarget ? "#10b981" : isSel ? "#0284c7" : ieee ? "#f3f4f6" : hexToRgba(baseColor, 0.14);
      const pillText = isDropTarget || isSel ? "#ffffff" : ieee ? "#111827" : baseColor;
      const titleLabel = forExport
        ? z.label
        : isDropTarget
        ? `✓ SOLTAR EM: ${z.label}`
        : `⋮⋮ ${z.label} (${count})`;
      const pillW = Math.max(120, titleLabel.length * 6.5 + 18);

      bandsSvg += `
        <g class="lane-band" data-zone-id="${escapeXml(z.id)}">
          <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="12" fill="${fill}" stroke="${stroke}" stroke-dasharray="${isSel || isDropTarget ? "none" : "6,4"}" stroke-width="${isDropTarget ? 3.2 : isSel ? 2.4 : 1.3}" pointer-events="stroke" style="cursor:pointer" class="spn-zone-border" data-zone-id="${escapeXml(z.id)}" />
          <g class="spn-zone-handle" data-zone-id="${escapeXml(z.id)}" data-tip="${escapeXml(`Área: ${z.label} (${count} elementos) | Clique para editar/remover membros • Arraste para mover todos juntos`)}" style="cursor:move">
            <rect x="${(x + 10).toFixed(1)}" y="${(y + 6).toFixed(1)}" width="${pillW.toFixed(1)}" height="22" rx="6" fill="${pillBg}" stroke="${stroke}" stroke-width="1" />
            <text x="${(x + 19).toFixed(1)}" y="${(y + 20.5).toFixed(1)}" font-family="${fontFamily}" font-size="10.5" font-weight="700" fill="${pillText}" letter-spacing="0.4">${escapeXml(titleLabel)}</text>
          </g>
          ${count === 0 && !forExport ? `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2 + 8).toFixed(1)}" text-anchor="middle" font-family="${fontFamily}" font-size="11" fill="#64748b" pointer-events="none">Área vazia — clique no título ou use Ctrl+arraste para incluir</text>` : ""}
        </g>
      `;
    }

    // Render routed arcs (using negative-gravity Catmull-Rom cubic paths & separated ports)
    let arcsSvg = "";

    for (const item of allArcs) {
      const canonicalArcId = item.baseArcId || item.id;
      const isSelected = !forExport && state.selected && state.selected.type === "arc" && state.selected.id === canonicalArcId;
      const dimmed = hasFocus && !focusedArcs.has(item.id) && !focusedArcs.has(canonicalArcId);
      const opacity = dimmed ? 0.12 : 1.0;

      const mult = String(item.arc.multiplicity || "1").trim();
      const isCond = item.arc.isConditional || /IF\s*\(/i.test(mult) || /#[A-Za-z_]/.test(mult);
      const isInh = item.dir === "inh";

      let stroke = colorNormal;
      let markerEnd = "url(#arrow-normal)";
      let dash = "";
      let sw = isSelected ? 2.8 : 1.5;

      if (isInh) {
        stroke = colorInh;
        markerEnd = "url(#inhibitor-circle)";
        sw = isSelected ? 2.8 : 1.75;
      } else if (isCond) {
        stroke = item.dir === "in" ? colorCondIn : colorCondOut;
        markerEnd = item.dir === "in" ? "url(#arrow-cond-in)" : "url(#arrow-cond-out)";
        dash = 'stroke-dasharray="6,3"';
        sw = isSelected ? 2.8 : 1.75;
      }
      if (isSelected) {
        stroke = colorSel;
        if (!isInh) markerEnd = "url(#arrow-sel)";
      }

      const pathD = item.pathD;
      const lx = item.lx;
      const ly = item.ly;

      let labelText = "";
      if (isCond) {
        const tag = audit.condExprToTag[mult] || "w?";
        if (state.arcLabelMode === "tag") labelText = tag;
        else if (state.arcLabelMode === "summary") labelText = `${tag}: ${Core.summarizeCondition(mult)}`;
        else labelText = mult;
      } else if (mult !== "1") {
        labelText = `×${mult}`;
      }

      let labelSvg = "";
      if (labelText) {
        const charW = state.arcLabelMode === "full" ? 5.6 : 6.2;
        const bw = Math.max(24, labelText.length * charW + 10);
        const bh = 16;
        const badgeFill = ieee ? "#ffffff" : (isCond ? (item.dir === "in" ? "#eff6ff" : "#f5f3ff") : "#fef3c7");
        const badgeStroke = ieee ? "#111827" : (isCond ? stroke : "#d97706");
        const textFill = ieee ? "#111827" : (isCond ? stroke : "#92400e");
        labelSvg = `
          <g class="arc-badge" pointer-events="none">
            <rect x="${(lx - bw / 2).toFixed(1)}" y="${(ly - bh / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh}" rx="4" fill="${badgeFill}" stroke="${badgeStroke}" stroke-width="1" />
            <text x="${lx.toFixed(1)}" y="${(ly + 3.5).toFixed(1)}" text-anchor="middle" font-family="${monoFamily}" font-size="9.5" font-weight="700" fill="${textFill}">${escapeXml(labelText)}</text>
          </g>
        `;
      }

      const tipTitle = isInh
        ? `Inibidor: ${item.place} ○→ ${item.trName} (mult=${mult}) | Duplo-clique: criar ponto de inflexão fixo`
        : `${item.srcId.slice(2)} → ${item.dstId.slice(2)} | peso: ${mult} | Duplo-clique: criar ponto de inflexão fixo`;

      // Fixed inflection points (bend handles) & segment midpoint '+' handles
      let waypointsSvg = "";
      const wpKey = `W:${item.id}`;
      const customWps = Array.isArray(state.positions[wpKey]) ? state.positions[wpKey] : [];
      if (!forExport && !simActive) {
        if (isSelected) {
          // Segment midpoint '+' handles to create a new fixed inflection point by clicking or dragging!
          const pts = item.finalPts || [item.startPt, item.endPt];
          for (let s = 0; s < pts.length - 1; s++) {
            const pA = pts[s];
            const pB = pts[s + 1];
            if (!pA || !pB || Math.hypot(pB.x - pA.x, pB.y - pA.y) < 34) continue;
            const mx = (pA.x + pB.x) / 2;
            const my = (pA.y + pB.y) / 2;
            waypointsSvg += `
              <g class="spn-arc-wp-add" data-arc-id="${escapeXml(item.id)}" data-seg-idx="${s}" data-mx="${mx.toFixed(1)}" data-my="${my.toFixed(1)}" data-tip="Clique ou arraste para criar um ponto de inflexão fixo neste trecho" style="cursor:copy">
                <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="6" fill="#09090b" stroke="${colorSel}" stroke-width="1.4" />
                <path d="M ${(mx - 2.6).toFixed(1)} ${my.toFixed(1)} H ${(mx + 2.6).toFixed(1)} M ${mx.toFixed(1)} ${(my - 2.6).toFixed(1)} V ${(my + 2.6).toFixed(1)}" stroke="#60a5fa" stroke-width="1.4" stroke-linecap="round" />
              </g>
            `;
          }
          // Existing user-fixed inflection point handles (draggable, double-click/right-click to remove)
          customWps.forEach((wp, wIdx) => {
            waypointsSvg += `
              <g class="spn-arc-wp" data-arc-id="${escapeXml(item.id)}" data-wp-idx="${wIdx}" data-wx="${wp.x}" data-wy="${wp.y}" data-tip="Ponto de inflexão fixo #${wIdx + 1} (${wp.x}, ${wp.y}) | Arraste para mover (Shift alinha 90°) • Duplo-clique ou botão direito para remover" style="cursor:move">
                <circle cx="${wp.x.toFixed(1)}" cy="${wp.y.toFixed(1)}" r="6.5" fill="#ffffff" stroke="${colorSel}" stroke-width="2.2" />
                <circle cx="${wp.x.toFixed(1)}" cy="${wp.y.toFixed(1)}" r="2.4" fill="${colorSel}" />
              </g>
            `;
          });
        } else if (customWps.length > 0) {
          // Subtle pin indicator on unselected arcs that have fixed inflection points
          customWps.forEach((wp, wIdx) => {
            waypointsSvg += `
              <g class="spn-arc-wp" data-arc-id="${escapeXml(item.id)}" data-wp-idx="${wIdx}" data-wx="${wp.x}" data-wy="${wp.y}" data-tip="Ponto de inflexão fixo #${wIdx + 1} | Arraste para ajustar • Duplo-clique para remover" style="cursor:move">
                <circle cx="${wp.x.toFixed(1)}" cy="${wp.y.toFixed(1)}" r="4" fill="#ffffff" stroke="${stroke}" stroke-width="1.6" />
              </g>
            `;
          });
        }
      }

      arcsSvg += `
        <g class="spn-arc" data-arc-id="${escapeXml(item.id)}" data-tip="${escapeXml(tipTitle)}" opacity="${opacity}">
          <path d="${pathD}" fill="none" stroke="transparent" stroke-width="13" style="cursor:pointer" />
          <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="${sw}" ${dash} marker-end="${markerEnd}" style="cursor:pointer" />
          ${labelSvg}
          ${waypointsSvg}
        </g>
      `;
    }

    // Render Shadow / Mirror Nodes (Place Mirrors around Transitions + Incoming Transition Mirrors at Place Inputs!)
    let mirrorsSvg = "";
    for (const m of mirrors) {
      const mDimmed = hasFocus && !focusedMirrors.has(m.id);
      const mOpacity = mDimmed ? 0.14 : 1.0;
      const isTransMirror = m.kind === "transition";

      if (isTransMirror) {
        const isFireable = simActive && simEnabled && simEnabled.fireable.has(m.trName);
        const mStroke = ieee ? "#374151" : isFireable ? "#059669" : "#7c3aed";
        const mFill = ieee ? "#f9fafb" : isFireable ? "#ecfdf5" : "#f5f3ff";
        const targetId = `T:${m.trName}`;
        const mTip = `Espelho de Transição '${m.trName}' (entrada em '${m.place}')${simActive ? (isFireable ? " | ▶ HABILITADA" : " | ⏸ Inativa") : ""} | Clique simples: voar até '${m.trName}' • Arraste: reposicionar espelho`;

        mirrorsSvg += `
          <g class="spn-mirror" data-mirror-id="${escapeXml(m.id)}" data-mirror-kind="T" data-target-id="${escapeXml(targetId)}" data-place-name="${escapeXml(m.place)}" data-tr-name="${escapeXml(m.trName)}" data-mx="${m.x}" data-my="${m.y}" data-tip="${escapeXml(mTip)}" opacity="${mOpacity}" style="cursor:grab">
            <rect x="${(m.x - 13).toFixed(1)}" y="${(m.y - 17).toFixed(1)}" width="26" height="34" rx="5" fill="${mFill}" stroke="${mStroke}" stroke-width="1.4" stroke-dasharray="3.5,2.5" />
            <rect x="${(m.x - 5).toFixed(1)}" y="${(m.y - 11).toFixed(1)}" width="10" height="22" rx="1.5" fill="#ffffff" stroke="${mStroke}" stroke-width="1.2" />
            <text x="${m.x}" y="${m.y + 3.5}" text-anchor="middle" font-family="${fontFamily}" font-size="9.5" font-weight="800" fill="${mStroke}">↗</text>
            <text x="${m.x}" y="${m.y + 30}" text-anchor="middle" font-family="${fontFamily}" font-size="9.2" font-style="italic" font-weight="600" fill="${ieee ? "#1f2937" : "#5b21b6"}">↗ ${escapeXml(m.trName)}</text>
          </g>
        `;
      } else {
        const mStroke = ieee ? "#374151" : "#6366f1";
        const mFill = ieee ? "#f9fafb" : "#eef2ff";
        const liveTok = simActive ? (state.simMarking[m.place] ?? 0) : null;
        const insideTxt = simActive ? String(liveTok) : "↗";
        const insideCol = simActive ? (liveTok > 0 ? "#047857" : "#64748b") : mStroke;
        const targetId = `P:${m.place}`;
        const mTip = `Espelho (Shadow Place) de '${m.place}' | Conectado a '${m.trName}'${simActive ? ` | Marcação ao vivo: #${m.place}=${liveTok}` : ""} | Clique simples: voar até '${m.place}' • Arraste: reposicionar espelho`;

        mirrorsSvg += `
          <g class="spn-mirror" data-mirror-id="${escapeXml(m.id)}" data-mirror-kind="P" data-target-id="${escapeXml(targetId)}" data-place-name="${escapeXml(m.place)}" data-tr-name="${escapeXml(m.trName)}" data-mx="${m.x}" data-my="${m.y}" data-tip="${escapeXml(mTip)}" opacity="${mOpacity}" style="cursor:grab">
            <circle cx="${m.x}" cy="${m.y}" r="${m.r}" fill="${mFill}" stroke="${mStroke}" stroke-width="1.4" stroke-dasharray="3.5,2.5" />
            <circle cx="${m.x}" cy="${m.y}" r="${m.r - 3.5}" fill="#ffffff" stroke="${mStroke}" stroke-width="1.1" />
            <text x="${m.x}" y="${m.y + 4}" text-anchor="middle" font-family="${simActive ? monoFamily : fontFamily}" font-size="${simActive ? "10.5" : "11"}" font-weight="800" fill="${insideCol}">${escapeXml(insideTxt)}</text>
            <text x="${m.x}" y="${m.y + m.r + 12}" text-anchor="middle" font-family="${fontFamily}" font-size="9.2" font-style="italic" font-weight="600" fill="${ieee ? "#1f2937" : "#4338ca"}">↗ ${escapeXml(m.place)}</text>
          </g>
        `;
      }
    }

    // Render places
    let nodesSvg = "";
    for (const pl of ast.places) {
      const id = `P:${pl.name}`;
      const pt = state.positions[id];
      if (!pt) continue;

      const isSelected = !forExport && !simActive && ((state.selected && state.selected.type === "place" && state.selected.id === pl.name) || state.multiSelected.includes(id));
      const isConnSrc = !forExport && !simActive && state.connectSource && state.connectSource.kind === "P" && state.connectSource.name === pl.name;
      const dimmed = hasFocus && !focusedNodes.has(id);
      const opacity = dimmed ? 0.14 : 1.0;

      const tokExpr = String(pl.tokens ?? "0").trim();
      const resolvedTok = Core.resolveValue(tokExpr, audit.paramMap);
      let hasTokens, fill, stroke, sw, tokenBadge = "", deltaBadge = "", tip;

      if (simActive) {
        const liveVal = state.simMarking[pl.name] ?? 0;
        const delta = state.simLastDeltas[pl.name] || 0;
        hasTokens = liveVal > 0;
        fill = hasTokens ? "#ecfdf5" : "#f8fafc";
        stroke = delta > 0 ? "#10b981" : delta < 0 ? "#f59e0b" : hasTokens ? "#059669" : "#94a3b8";
        sw = delta !== 0 ? 3.2 : hasTokens ? 2.4 : 1.7;
        tokenBadge = `<text x="${pt.x}" y="${pt.y + 5.5}" text-anchor="middle" font-family="${monoFamily}" font-size="14" font-weight="800" fill="${hasTokens ? "#047857" : "#94a3b8"}">${liveVal}</text>`;
        if (delta !== 0) {
          const dTxt = delta > 0 ? `+${delta}` : String(delta);
          const dFill = delta > 0 ? "#10b981" : "#ef4444";
          deltaBadge = `
            <rect x="${pt.x + 12}" y="${pt.y - PLACE_R - 6}" width="24" height="15" rx="7" fill="${dFill}" stroke="#ffffff" stroke-width="1.2" />
            <text x="${pt.x + 24}" y="${pt.y - PLACE_R + 4.5}" text-anchor="middle" font-family="${monoFamily}" font-size="9" font-weight="800" fill="#ffffff">${dTxt}</text>
          `;
        }
        tip = `[Token Game] Lugar: ${pl.name} | Marcação atual = ${liveVal} (M₀ = ${state.simInitMarking ? state.simInitMarking[pl.name] : tokExpr})`;
      } else {
        hasTokens = tokExpr !== "0" && tokExpr !== "";
        fill = ieee ? "#ffffff" : (hasTokens ? "#f0f9ff" : "#ffffff");
        stroke = isSelected || isConnSrc ? colorSel : (ieee ? "#111827" : (hasTokens ? "#0284c7" : "#1e293b"));
        sw = isSelected || isConnSrc ? 3.2 : 2.0;

        if (hasTokens) {
          const tokDisplay = resolvedTok !== null && String(resolvedTok) !== tokExpr
            ? `${resolvedTok}`
            : tokExpr;
          const tokSub = resolvedTok !== null && String(resolvedTok) !== tokExpr ? tokExpr : "";
          tokenBadge = `
            <text x="${pt.x}" y="${pt.y + (tokSub ? 2 : 5)}" text-anchor="middle" font-family="${monoFamily}" font-size="13" font-weight="800" fill="${ieee ? "#111827" : "#0369a1"}">${escapeXml(tokDisplay)}</text>
            ${tokSub && state.showMeta ? `<text x="${pt.x}" y="${pt.y + 13}" text-anchor="middle" font-family="${monoFamily}" font-size="7.5" fill="#64748b">${escapeXml(tokSub.length > 10 ? tokSub.slice(0, 9) + "…" : tokSub)}</text>` : ""}
          `;
        }
        tip = `Lugar: ${pl.name} | tokens = ${tokExpr}${resolvedTok !== null && String(resolvedTok) !== tokExpr ? " (" + resolvedTok + ")" : ""}`;
      }

      nodesSvg += `
        <g class="spn-node" data-node-kind="P" data-node-name="${escapeXml(pl.name)}" data-tip="${escapeXml(tip)}" opacity="${opacity}" style="cursor:pointer">
          <circle cx="${pt.x}" cy="${pt.y}" r="${PLACE_R}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />
          ${tokenBadge}
          ${deltaBadge}
          <text x="${pt.x}" y="${pt.y + PLACE_R + 14}" text-anchor="middle" font-family="${fontFamily}" font-size="10.5" font-weight="600" fill="#0f172a">${escapeXml(pl.name)}</text>
        </g>
      `;
    }

    // Render transitions
    for (const tr of ast.transitions) {
      const id = `T:${tr.name}`;
      const pt = state.positions[id];
      if (!pt) continue;

      const isSelected = !forExport && !simActive && ((state.selected && state.selected.type === "transition" && state.selected.id === tr.name) || state.multiSelected.includes(id));
      const isConnSrc = !forExport && !simActive && state.connectSource && state.connectSource.kind === "T" && state.connectSource.name === tr.name;
      const isFireable = simActive && simEnabled.fireable.has(tr.name);
      const isPreempted = simActive && !isFireable && simEnabled.structurallyEnabled.has(tr.name);
      const dimmed = (hasFocus && !focusedNodes.has(id)) || (simActive && !isFireable && !isPreempted);
      const opacity = hasFocus && !focusedNodes.has(id) ? 0.14 : simActive && !isFireable && !isPreempted ? 0.56 : 1.0;

      const dim = getTransDim(tr);
      const isImm = tr.kind === "immediate";
      const isDet = tr.kind === "timed" && tr.delayType === "Deterministic";

      const fill = isFireable
        ? (isImm || isDet ? "#065f46" : "#ecfdf5")
        : (isImm || isDet ? (ieee ? "#111827" : (isDet ? "#0f172a" : "#1e293b")) : "#ffffff");
      const stroke = isFireable
        ? "#10b981"
        : isPreempted
        ? "#f59e0b"
        : isSelected || isConnSrc
        ? colorSel
        : "#0f172a";
      const sw = isFireable ? 3.2 : isPreempted ? 2.6 : isSelected || isConnSrc ? 3.2 : 2.0;

      let simHaloSvg = "";
      if (isFireable) {
        simHaloSvg = `
          <rect class="mercury-blink-halo" x="${(pt.x - dim.w / 2 - 7).toFixed(1)}" y="${(pt.y - dim.h / 2 - 7).toFixed(1)}" width="${dim.w + 14}" height="${dim.h + 14}" rx="6" fill="rgba(16, 185, 129, 0.25)" stroke="#10b981" stroke-width="2" />
          <circle cx="${(pt.x + dim.w / 2 + 7).toFixed(1)}" cy="${(pt.y - dim.h / 2 - 3).toFixed(1)}" r="8" fill="#10b981" stroke="#ffffff" stroke-width="1.2" />
          <text x="${(pt.x + dim.w / 2 + 7.5).toFixed(1)}" y="${(pt.y - dim.h / 2 + 0.5).toFixed(1)}" text-anchor="middle" font-family="${fontFamily}" font-size="8.5" font-weight="800" fill="#ffffff">▶</text>
        `;
      } else if (isPreempted) {
        simHaloSvg = `<rect x="${(pt.x - dim.w / 2 - 5).toFixed(1)}" y="${(pt.y - dim.h / 2 - 5).toFixed(1)}" width="${dim.w + 10}" height="${dim.h + 10}" rx="5" fill="rgba(245, 158, 11, 0.14)" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,2" />`;
      }

      let metaSvg = "";
      if (state.showMeta) {
        const typeTag = isImm ? "IMM" : isDet ? "DET" : (tr.delayType === "Exponential" ? "EXP" : tr.delayType.slice(0, 4).toUpperCase());
        const srvTag = tr.kind === "timed" ? (tr.serverType === "InfiniteServer" ? " ∞" : " 1") : "";
        const prioTag = tr.priority !== "" ? ` π=${tr.priority}` : "";
        const wTag = tr.weight !== "" ? ` w=${tr.weight}` : "";
        const topBadge = `${typeTag}${srvTag}${prioTag}${wTag}`;
        const tbW = Math.max(36, topBadge.length * 5.8 + 8);

        const topFill = ieee
          ? "#ffffff"
          : (isDet ? "#1e293b" : isImm ? "#e2e8f0" : tr.serverType === "InfiniteServer" ? "#dcfce7" : "#fef3c7");
        const topText = ieee ? "#111827" : (isDet ? "#ffffff" : isImm ? "#0f172a" : tr.serverType === "InfiniteServer" ? "#166534" : "#92400e");
        const topStroke = ieee ? "#111827" : (isDet ? "#0f172a" : "#94a3b8");

        metaSvg += `
          <rect x="${(pt.x - tbW / 2).toFixed(1)}" y="${(pt.y - dim.h / 2 - 20).toFixed(1)}" width="${tbW.toFixed(1)}" height="15" rx="3" fill="${topFill}" stroke="${topStroke}" stroke-width="0.9" />
          <text x="${pt.x}" y="${(pt.y - dim.h / 2 - 9.5).toFixed(1)}" text-anchor="middle" font-family="${monoFamily}" font-size="8.5" font-weight="700" fill="${topText}">${escapeXml(topBadge)}</text>
        `;

        let extraY = pt.y + dim.h / 2 + 26;
        if (tr.kind === "timed") {
          const resD = Core.resolveValue(tr.delayExpr, audit.paramMap);
          const delayLbl = resD !== null && String(resD) !== tr.delayExpr
            ? `${isDet ? "D" : "d"}=${resD}`
            : `${isDet ? "D" : "d"}=${tr.delayExpr}`;
          metaSvg += `<text x="${pt.x}" y="${extraY}" text-anchor="middle" font-family="${monoFamily}" font-size="9" fill="${ieee ? "#374151" : "#475569"}">${escapeXml(delayLbl)}</text>`;
          extraY += 15;
        }

        if (tr.guard && tr.guard.trim() !== "") {
          const gTxt = `G: ${tr.guard.trim()}`;
          const gW = Math.max(44, gTxt.length * 5.6 + 10);
          metaSvg += `
            <rect x="${(pt.x - gW / 2).toFixed(1)}" y="${(extraY - 10).toFixed(1)}" width="${gW.toFixed(1)}" height="15" rx="3" fill="${ieee ? "#ffffff" : "#fef3c7"}" stroke="${ieee ? "#111827" : "#d97706"}" stroke-width="1" />
            <text x="${pt.x}" y="${extraY + 0.5}" text-anchor="middle" font-family="${monoFamily}" font-size="8.5" font-weight="700" fill="${ieee ? "#111827" : "#92400e"}">${escapeXml(gTxt)}</text>
          `;
        }
      }

      const resDelay = tr.kind === "timed" ? Core.resolveValue(tr.delayExpr, audit.paramMap) : null;
      const tipParts = [
        `Transição (${tr.kind === "immediate" ? "Imediata" : tr.delayType}): ${tr.name}`
      ];
      if (simActive) {
        if (isFireable) tipParts.unshift("▶ HABILITADA — Clique para disparar!");
        else if (isPreempted) tipParts.unshift("⏸ Preemptada por transição imediata prioritária");
        else tipParts.unshift("⛔ Desabilitada — Clique para ver o motivo");
      }
      if (tr.kind === "timed") {
        tipParts.push(`delay = ${tr.delayExpr}${resDelay !== null ? " (" + resDelay + ")" : ""}`);
        tipParts.push(`serverType = ${tr.serverType || "SingleServer (padrão)"}`);
      }
      if (tr.guard) tipParts.push(`GUARD (${tr.guardKey}): ${tr.guard}`);
      if (tr.priority !== "") tipParts.push(`priority = ${tr.priority}`);
      if (tr.weight !== "") tipParts.push(`weight = ${tr.weight}`);

      nodesSvg += `
        <g class="spn-node${isFireable ? " mercury-blink" : ""}" data-node-kind="T" data-node-name="${escapeXml(tr.name)}" data-tip="${escapeXml(tipParts.join(" | "))}" opacity="${opacity}" style="cursor:${isFireable ? "pointer" : simActive ? "help" : "pointer"}">
          ${simHaloSvg}
          <rect class="${isFireable ? "mercury-blink-bar" : ""}" x="${(pt.x - dim.w / 2).toFixed(1)}" y="${(pt.y - dim.h / 2).toFixed(1)}" width="${dim.w}" height="${dim.h}" rx="${isImm ? 1 : 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />
          ${metaSvg}
          <text x="${pt.x}" y="${pt.y + dim.h / 2 + 14}" text-anchor="middle" font-family="${fontFamily}" font-size="10.5" font-weight="700" fill="#0f172a">${escapeXml(tr.name)}</text>
        </g>
      `;
    }

    let guideSvg = "";
    if (!forExport && state.axisGuide) {
      if (state.axisGuide.type === "H") {
        guideSvg = `<line x1="${state.view.x - 500}" y1="${state.axisGuide.y}" x2="${state.view.x + state.view.w + 500}" y2="${state.axisGuide.y}" stroke="#06b6d4" stroke-width="1.3" stroke-dasharray="6,4" pointer-events="none" />`;
      } else {
        guideSvg = `<line x1="${state.axisGuide.x}" y1="${state.view.y - 500}" x2="${state.axisGuide.x}" y2="${state.view.y + state.view.h + 500}" stroke="#06b6d4" stroke-width="1.3" stroke-dasharray="6,4" pointer-events="none" />`;
      }
    }

    return `${defs}<g id="sceneRoot">${bandsSvg}${guideSvg}${arcsSvg}${mirrorsSvg}${nodesSvg}</g><g id="codeSyncLayer" pointer-events="none"></g><g id="rubberBandLayer" pointer-events="none"></g><g id="marqueeLayer" pointer-events="none"></g><g id="collabLayer" pointer-events="none"></g>`;
  }

  function buildRbdSvgContent(forExport = false) {
    const layout = state.rbdLayout;
    const rbdEval = state.audit.rbdEval;
    if (!layout || !rbdEval) return "";
    const ieee = state.ieeeMode;
    const fontFamily = ieee ? "Georgia, 'Times New Roman', serif" : "'Inter', 'Segoe UI', sans-serif";
    const monoFamily = "'JetBrains Mono', Consolas, monospace";

    const fmtPct = (p) => `${(p * 100).toFixed(p > 0.999 ? 4 : 2)}%`;

    let groupsSvg = "";
    for (const gf of layout.groupFrames) {
      const isSel = !forExport && state.selected && state.selected.type === "rbdGroup" && state.selected.id === gf.name;
      const gm = rbdEval.groupMetrics[gf.name] || { A: 0, R: 0 };
      const kindTitle =
        gf.kind === "kooN"
          ? `${gf.group.k}-of-${gf.group.children.length} (${gf.name})`
          : gf.kind === "parallel"
          ? `PARALLEL (1-of-${gf.group.children.length}) • ${gf.name}`
          : `SERIES • ${gf.name}`;

      const fill = ieee
        ? (gf.kind === "series" ? "none" : "#f9fafb")
        : (gf.kind === "kooN" ? "rgba(139, 92, 246, 0.06)" : gf.kind === "parallel" ? "rgba(16, 185, 129, 0.06)" : "rgba(14, 165, 233, 0.04)");
      const stroke = isSel
        ? "#0284c7"
        : ieee
        ? "#4b5563"
        : gf.kind === "kooN"
        ? "#7c3aed"
        : gf.kind === "parallel"
        ? "#059669"
        : "#0284c7";

      const metaStr = state.showMeta ? `  |  A=${fmtPct(gm.A)}  R(t)=${fmtPct(gm.R)}` : "";
      const tip = `Grupo ${gf.kind}: ${gf.name} | filhos: [${gf.group.children.join(", ")}] | A=${fmtPct(gm.A)} | R(${rbdEval.missionTime}h)=${fmtPct(gm.R)}`;

      groupsSvg += `
        <g class="rbd-group" data-group-name="${escapeXml(gf.name)}" data-tip="${escapeXml(tip)}" style="cursor:pointer">
          <rect x="${gf.x.toFixed(1)}" y="${gf.y.toFixed(1)}" width="${gf.w.toFixed(1)}" height="${gf.h.toFixed(1)}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${isSel ? 2.6 : 1.4}" stroke-dasharray="${gf.kind === "series" ? "4,4" : "7,4"}" />
          <text x="${(gf.x + 10).toFixed(1)}" y="${(gf.y + 15).toFixed(1)}" font-family="${fontFamily}" font-size="10" font-weight="700" fill="${ieee ? "#111827" : stroke}">${escapeXml(kindTitle)}${escapeXml(metaStr)}</text>
        </g>
      `;
    }

    let wiresSvg = "";
    for (const w of layout.wires) {
      wiresSvg += `<line x1="${w.x1.toFixed(1)}" y1="${w.y1.toFixed(1)}" x2="${w.x2.toFixed(1)}" y2="${w.y2.toFixed(1)}" stroke="${ieee ? "#111827" : "#334155"}" stroke-width="2" stroke-linecap="round" />`;
    }

    // Start & End terminals
    const terminalsSvg = `
      <g>
        <circle cx="${layout.startPt.x}" cy="${layout.startPt.y}" r="16" fill="${ieee ? "#111827" : "#0f172a"}" />
        <text x="${layout.startPt.x}" y="${layout.startPt.y + 4}" text-anchor="middle" font-family="${fontFamily}" font-size="9.5" font-weight="700" fill="#ffffff">IN</text>
        <circle cx="${layout.endPt.x}" cy="${layout.endPt.y}" r="16" fill="${ieee ? "#111827" : "#0f172a"}" />
        <text x="${layout.endPt.x}" y="${layout.endPt.y + 4}" text-anchor="middle" font-family="${fontFamily}" font-size="9.5" font-weight="700" fill="#ffffff">OUT</text>
      </g>
    `;

    let boxesSvg = "";
    for (const bx of layout.boxes) {
      const bm = rbdEval.blockMetrics[bx.name] || { A: 1, R: 1, kind: bx.kind };
      const isSpof = rbdEval.spofs.includes(bx.name);
      const isSel = !forExport && state.selected && state.selected.type === "rbdBlock" && state.selected.id === bx.name;

      let dimmed = false;
      if (!forExport && state.branchFilter === "SPOF_ONLY" && !isSpof) dimmed = true;
      if (!forExport && state.branchFilter === "HIER_ONLY" && bx.kind !== "hierarchy") dimmed = true;
      const opacity = dimmed ? 0.16 : 1.0;

      const isHier = bx.kind === "hierarchy";
      const fill = ieee ? "#ffffff" : (bx.isOrphan ? "#fffbeb" : isHier ? "#f5f3ff" : "#ffffff");
      const stroke = isSel
        ? "#0284c7"
        : ieee
        ? "#111827"
        : bx.isOrphan
        ? "#d97706"
        : isSpof
        ? "#dc2626"
        : isHier
        ? "#7c3aed"
        : "#1e293b";
      const sw = isSel ? 3.0 : isSpof && !ieee ? 2.2 : 1.8;

      const headerFill = ieee ? "#f3f4f6" : (isHier ? "#ede9fe" : isSpof ? "#fef2f2" : "#f1f5f9");
      const bObj = bx.block;
      let line1 = "";
      if (isHier && bObj) {
        const parts = [];
        if (bObj.reliability) parts.push(`R=${bObj.reliability}`);
        if (bObj.availability && bObj.availability !== bObj.reliability) parts.push(`A=${bObj.availability}`);
        line1 = parts.join(" • ") || `R=${bm.R.toFixed(4)}`;
      } else if (bObj) {
        const mttfDisp = bm.mttf !== null ? bm.mttf : bObj.mttf;
        const mttrDisp = bm.mttr !== null ? bm.mttr : bObj.mttr;
        line1 = `MTTF=${mttfDisp}  MTTR=${mttrDisp}`;
      } else {
        line1 = "Bloco não declarado!";
      }
      const line2 = `A=${fmtPct(bm.A)}  R(t)=${fmtPct(bm.R)}`;

      let badgesSvg = "";
      if (state.showMeta) {
        const typeTxt = isHier ? "HIER" : "EXP";
        badgesSvg += `
          <rect x="${bx.x + bx.w - 36}" y="${bx.y + 4}" width="31" height="14" rx="3" fill="${ieee ? "#ffffff" : (isHier ? "#7c3aed" : "#0f172a")}" stroke="${ieee ? "#111827" : "none"}" stroke-width="0.8" />
          <text x="${bx.x + bx.w - 20.5}" y="${bx.y + 13.8}" text-anchor="middle" font-family="${monoFamily}" font-size="8" font-weight="700" fill="${ieee ? "#111827" : "#ffffff"}">${typeTxt}</text>
        `;
        if (isSpof && !ieee) {
          badgesSvg += `
            <rect x="${bx.x + bx.w - 72}" y="${bx.y + 4}" width="33" height="14" rx="3" fill="#dc2626" />
            <text x="${bx.x + bx.w - 55.5}" y="${bx.y + 13.8}" text-anchor="middle" font-family="${monoFamily}" font-size="8" font-weight="700" fill="#ffffff">SPOF</text>
          `;
        } else if (bx.isOrphan) {
          badgesSvg += `
            <rect x="${bx.x + bx.w - 78}" y="${bx.y + 4}" width="39" height="14" rx="3" fill="#d97706" />
            <text x="${bx.x + bx.w - 58.5}" y="${bx.y + 13.8}" text-anchor="middle" font-family="${monoFamily}" font-size="8" font-weight="700" fill="#ffffff">ÓRFÃO</text>
          `;
        }
      }

      const tip = `Bloco ${isHier ? "Hierárquico" : "Exponencial"}: ${bx.name}${isSpof ? " [SPOF]" : ""} | ${line1} | ${line2}`;

      boxesSvg += `
        <g class="rbd-block" data-block-name="${escapeXml(bx.name)}" data-tip="${escapeXml(tip)}" opacity="${opacity}" style="cursor:pointer">
          <rect x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />
          <rect x="${bx.x + 1}" y="${bx.y + 1}" width="${bx.w - 2}" height="22" rx="6" fill="${headerFill}" />
          <line x1="${bx.x}" y1="${bx.y + 23}" x2="${bx.x + bx.w}" y2="${bx.y + 23}" stroke="${ieee ? "#d1d5db" : "#cbd5e1"}" stroke-width="1" />
          <text x="${bx.x + 8}" y="${bx.y + 15.5}" font-family="${fontFamily}" font-size="11" font-weight="700" fill="#0f172a">${escapeXml(bx.name)}</text>
          ${badgesSvg}
          <text x="${bx.cx}" y="${bx.y + 44}" text-anchor="middle" font-family="${monoFamily}" font-size="9.2" fill="#334155">${escapeXml(line1)}</text>
          ${state.showMeta ? `<text x="${bx.cx}" y="${bx.y + 66}" text-anchor="middle" font-family="${monoFamily}" font-size="9.5" font-weight="700" fill="${ieee ? "#111827" : "#0369a1"}">${escapeXml(line2)}</text>` : ""}
        </g>
      `;
    }

    return `<g id="sceneRoot">${groupsSvg}${wiresSvg}${terminalsSvg}${boxesSvg}</g><g id="codeSyncLayer" pointer-events="none"></g><g id="collabLayer" pointer-events="none"></g>`;
  }

  function renderCanvas() {
    dom.svgStage.classList.toggle("ieee-mode", state.ieeeMode);
    dom.svg.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
    dom.svg.innerHTML = buildSvgContent(false);
    renderCodeSyncOverlay();
    renderRubberBand();
    renderMarquee();
    renderCollabCursors();
    updateSelectionActionBar();

    // Update collapsible overlay: RBD live metrics banner OR SPN conditional weights legend
    if (state.ast && state.ast.modelType === "RBD" && state.audit && state.audit.rbdEval) {
      const ev = state.audit.rbdEval;
      dom.legendOverlay.style.display = "block";
      const collapsed = dom.legendOverlay.dataset.collapsed === "1";
      const ninesStr = Number.isFinite(ev.nines) ? ev.nines.toFixed(2) : "∞";
      dom.legendOverlay.innerHTML =
        `<h4 style="display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;" id="legendToggleHead">
          <span>Avaliação Analítica RBD (t = ${ev.missionTime}h)</span>
          <span style="font-weight:700;color:#2563eb;">${collapsed ? "+ expandir" : "− recolher"}</span>
        </h4>` +
        (collapsed
          ? ""
          : `<div class="legend-row"><span class="legend-tag">A (Disponibilidade):</span>${(ev.sysA * 100).toFixed(5)}% (${ninesStr} noves)</div>
             <div class="legend-row"><span class="legend-tag">R(${ev.missionTime}h) (Confiab.):</span>${(ev.sysR * 100).toFixed(5)}%</div>
             <div class="legend-row"><span class="legend-tag">Downtime/ano:</span>${ev.downtimeHoursYear.toFixed(2)} h/ano (${(ev.downtimeHoursYear * 60).toFixed(1)} min)</div>
             <div class="legend-row"><span class="legend-tag">SPOFs (${ev.spofs.length}):</span>${escapeXml(ev.spofs.join(", ") || "Nenhum")}</div>`);
      const head = document.getElementById("legendToggleHead");
      if (head) {
        head.addEventListener("click", () => {
          dom.legendOverlay.dataset.collapsed = collapsed ? "0" : "1";
          renderCanvas();
        });
      }
    } else if (state.audit && state.audit.conditionalLegend.length > 0 && state.arcLabelMode === "tag") {
      dom.legendOverlay.style.display = "block";
      const collapsed = dom.legendOverlay.dataset.collapsed === "1";
      dom.legendOverlay.innerHTML =
        `<h4 style="display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;" id="legendToggleHead">
          <span>Legenda IF(...) (${state.audit.conditionalLegend.length} expressões)</span>
          <span style="font-weight:700;color:#2563eb;">${collapsed ? "+ expandir" : "− recolher"}</span>
        </h4>` +
        (collapsed
          ? ""
          : state.audit.conditionalLegend
              .map(
                (item) =>
                  `<div class="legend-row"><span class="legend-tag">${escapeXml(item.tag)} =</span>${escapeXml(item.expr)}</div>`
              )
              .join(""));
      const head = document.getElementById("legendToggleHead");
      if (head) {
        head.addEventListener("click", () => {
          dom.legendOverlay.dataset.collapsed = collapsed ? "0" : "1";
          renderCanvas();
        });
      }
    } else {
      dom.legendOverlay.style.display = "none";
    }

    bindCanvasElementEvents();
  }

  function renderMarquee() {
    const layer = dom.svg.querySelector("#marqueeLayer");
    if (!layer) return;
    if (!state.marquee) {
      layer.innerHTML = "";
      return;
    }
    const x = Math.min(state.marquee.startX, state.marquee.curX);
    const y = Math.min(state.marquee.startY, state.marquee.curY);
    const w = Math.abs(state.marquee.curX - state.marquee.startX);
    const h = Math.abs(state.marquee.curY - state.marquee.startY);
    layer.innerHTML = `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="rgba(56, 189, 248, 0.14)" stroke="#0284c7" stroke-width="1.6" stroke-dasharray="5,3" />
    `;
  }

  function isValidConnection(src, dst, connType) {
    if (!src || !dst) return false;
    if (src.kind === dst.kind) return false;
    if (connType === "inhibitor" && !(src.kind === "P" && dst.kind === "T")) return false;
    return true;
  }

  function renderRubberBand() {
    const layer = dom.svg.querySelector("#rubberBandLayer");
    if (!layer) return;
    if (!state.connectSource || !state.connectCursor || !state.ast || state.ast.modelType !== "SPN") {
      layer.innerHTML = "";
      return;
    }

    const src = state.connectSource;
    const srcId = `${src.kind}:${src.name}`;
    const pSrc = state.positions[srcId];
    if (!pSrc) {
      layer.innerHTML = "";
      return;
    }

    const hov = state.hoveredNode;
    const isSame = hov && hov.kind === src.kind && hov.name === src.name;
    const validTarget = hov && !isSame ? isValidConnection(src, hov, state.connectorType) : null;
    const dstPt = hov && !isSame ? state.positions[`${hov.kind}:${hov.name}`] || state.connectCursor : state.connectCursor;

    // Clip start point to source composite border (clearing top server badges and bottom inline text!)
    let startPt;
    if (src.kind === "P") {
      startPt = Core.clipProtectedPort(pSrc.x, pSrc.y, true, src.name, null, dstPt.x, dstPt.y, false, state.useGravity);
    } else {
      const tr = state.ast.transitions.find((t) => t.name === src.name);
      startPt = Core.clipProtectedPort(pSrc.x, pSrc.y, false, src.name, tr, dstPt.x, dstPt.y, false, state.useGravity);
    }

    // Clip end point to hovered target composite border if hovering another node
    let endPt = { x: dstPt.x, y: dstPt.y };
    let targetRing = "";
    if (hov && !isSame && state.positions[`${hov.kind}:${hov.name}`]) {
      const hp = state.positions[`${hov.kind}:${hov.name}`];
      const ringCol = validTarget ? "#10b981" : "#ef4444";
      if (hov.kind === "P") {
        endPt = Core.clipProtectedPort(hp.x, hp.y, true, hov.name, null, startPt.x, startPt.y, true, state.useGravity);
        targetRing = `<circle cx="${hp.x}" cy="${hp.y}" r="${PLACE_R + 6}" fill="none" stroke="${ringCol}" stroke-width="2.6" stroke-dasharray="5,3" />`;
      } else {
        const tr = state.ast.transitions.find((t) => t.name === hov.name);
        const dim = tr ? getTransDim(tr) : { w: 20, h: 52 };
        endPt = Core.clipProtectedPort(hp.x, hp.y, false, hov.name, tr, startPt.x, startPt.y, true, state.useGravity);
        targetRing = `<rect x="${hp.x - dim.w / 2 - 6}" y="${hp.y - dim.h / 2 - 6}" width="${dim.w + 12}" height="${dim.h + 12}" rx="4" fill="none" stroke="${ringCol}" stroke-width="2.6" stroke-dasharray="5,3" />`;
      }
    }

    const isInh = state.connectorType === "inhibitor";
    const stroke = validTarget === true ? "#10b981" : validTarget === false ? "#ef4444" : isInh ? "#dc2626" : "#0284c7";
    const marker = isInh ? "url(#inhibitor-circle)" : "url(#arrow-sel)";

    // Source pulse ring + live rubber-band connector wire
    const srcRing =
      src.kind === "P"
        ? `<circle cx="${pSrc.x}" cy="${pSrc.y}" r="${PLACE_R + 5}" fill="none" stroke="${stroke}" stroke-width="2" opacity="0.7" />`
        : `<rect x="${pSrc.x - 15}" y="${pSrc.y - 31}" width="30" height="62" rx="4" fill="none" stroke="${stroke}" stroke-width="2" opacity="0.7" />`;

    layer.innerHTML = `
      ${srcRing}
      ${targetRing}
      <line x1="${startPt.x.toFixed(1)}" y1="${startPt.y.toFixed(1)}" x2="${endPt.x.toFixed(1)}" y2="${endPt.y.toFixed(1)}" stroke="${stroke}" stroke-width="2.4" stroke-dasharray="${validTarget === true ? "none" : "7,4"}" marker-end="${marker}" />
    `;
  }

  function bindCanvasElementEvents() {
    // Editable SPN Zones (click title or dashed border to inspect/edit; drag title handle to move whole area!)
    dom.svg.querySelectorAll(".spn-zone-handle, .spn-zone-border").forEach((el) => {
      const zId = el.dataset.zoneId;
      const isHandle = el.classList.contains("spn-zone-handle");
      if (isHandle) {
        el.addEventListener("mouseenter", (e) => showTooltip(el.dataset.tip, e));
        el.addEventListener("mousemove", (e) => moveTooltip(e));
        el.addEventListener("mouseleave", hideTooltip);
      }
      el.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        if (state.activeTool === "delete") {
          deleteZone(zId);
          return;
        }
        state.selected = { type: "zone", id: zId };
        state.activeTab = "inspector";
        updateTabButtons();
        if (isHandle) {
          const z = (state.zones || []).find((x) => x.id === zId);
          if (z) {
            const origMemberPos = {};
            for (const mId of z.members || []) {
              if (state.positions[mId]) origMemberPos[mId] = { ...state.positions[mId] };
            }
            state.draggingZone = {
              zoneId: zId,
              startSvg: clientToSvg(e.clientX, e.clientY),
              origMemberPos,
              origEmptyPos: z.emptyPos ? { ...z.emptyPos } : { x: 160, y: 120 }
            };
          }
        }
        renderCanvas();
        renderRightPanel();
      });
    });

    // RBD Blocks & Groups
    dom.svg.querySelectorAll(".rbd-block").forEach((el) => {
      const bName = el.dataset.blockName;
      el.addEventListener("mouseenter", (e) => {
        showTooltip(el.dataset.tip, e);
        state.hoveredNode = { kind: "B", name: bName };
        renderCodeHighlight(false);
      });
      el.addEventListener("mousemove", (e) => moveTooltip(e));
      el.addEventListener("mouseleave", () => {
        hideTooltip();
        if (state.hoveredNode && state.hoveredNode.kind === "B" && state.hoveredNode.name === bName) {
          state.hoveredNode = null;
          renderCodeHighlight(false);
        }
      });
      el.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        state.selected = { type: "rbdBlock", id: bName };
        state.activeTab = "inspector";
        updateTabButtons();
        renderCanvas();
        renderCodeHighlight(true);
        renderRightPanel();
      });
    });

    dom.svg.querySelectorAll(".rbd-group").forEach((el) => {
      const gName = el.dataset.groupName;
      el.addEventListener("mouseenter", (e) => {
        showTooltip(el.dataset.tip, e);
        state.hoveredNode = { kind: "G", name: gName };
        renderCodeHighlight(false);
      });
      el.addEventListener("mousemove", (e) => moveTooltip(e));
      el.addEventListener("mouseleave", () => {
        hideTooltip();
        if (state.hoveredNode && state.hoveredNode.kind === "G" && state.hoveredNode.name === gName) {
          state.hoveredNode = null;
          renderCodeHighlight(false);
        }
      });
      el.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        state.selected = { type: "rbdGroup", id: gName };
        state.activeTab = "inspector";
        updateTabButtons();
        renderCanvas();
        renderCodeHighlight(true);
        renderRightPanel();
      });
    });

    // Shadow / Mirror Nodes (hover highlights original Place/Transition; drag repositions mirror; simple click flies camera to destination!)
    dom.svg.querySelectorAll(".spn-mirror").forEach((el) => {
      const mirrorId = el.dataset.mirrorId;
      const mirrorKind = el.dataset.mirrorKind || "P";
      const targetId = el.dataset.targetId || `P:${el.dataset.placeName}`;
      const labelName = mirrorKind === "T" ? el.dataset.trName : el.dataset.placeName;

      el.addEventListener("mouseenter", (e) => {
        showTooltip(el.dataset.tip, e);
        state.codeSyncNodes = [targetId];
        renderCodeSyncOverlay();
      });
      el.addEventListener("mousemove", (e) => moveTooltip(e));
      el.addEventListener("mouseleave", () => {
        hideTooltip();
        state.codeSyncNodes = [];
        renderCodeSyncOverlay();
      });
      el.addEventListener("mousedown", (e) => {
        blurActiveControl();
        if (e.button !== 0) return;
        e.stopPropagation();
        if (state.connectSource) cancelConnector();
        if (state.cameraAnimFrame) {
          cancelAnimationFrame(state.cameraAnimFrame);
          state.cameraAnimFrame = null;
        }
        const svgPt = clientToSvg(e.clientX, e.clientY);
        const curX = Number(el.dataset.mx) || svgPt.x;
        const curY = Number(el.dataset.my) || svgPt.y;
        state.draggingMirror = {
          mirrorId,
          targetId,
          labelName,
          startClientX: e.clientX,
          startClientY: e.clientY,
          origX: curX,
          origY: curY,
          offsetX: svgPt.x - curX,
          offsetY: svgPt.y - curY,
          dragActivated: false,
          moved: false
        };
      });
    });

    // Nodes
    dom.svg.querySelectorAll(".spn-node").forEach((el) => {
      const kind = el.dataset.nodeKind;
      const name = el.dataset.nodeName;
      const nodeId = `${kind}:${name}`;

      el.addEventListener("mouseenter", (e) => {
        showTooltip(el.dataset.tip, e);
        state.hoveredNode = { kind, name };
        renderCodeHighlight(false);
        if (state.connectSource) renderRubberBand();
      });
      el.addEventListener("mousemove", (e) => moveTooltip(e));
      el.addEventListener("mouseleave", () => {
        hideTooltip();
        if (state.hoveredNode && state.hoveredNode.kind === kind && state.hoveredNode.name === name) {
          state.hoveredNode = null;
          renderCodeHighlight(false);
          if (state.connectSource) renderRubberBand();
        }
      });

      el.addEventListener("mousedown", (e) => {
        blurActiveControl();
        if (e.button !== 0) return;
        e.stopPropagation();

        // In Token Game simulation mode: clicking a transition fires it (or explains why disabled)!
        if (state.simMode) {
          if (kind === "T") {
            stepSimFire(name, false);
          } else {
            const curTok = state.simMarking ? (state.simMarking[name] ?? 0) : 0;
            dom.canvasHint.textContent = `🎮 Lugar '${name}' tem ${curTok} token(s). Use os botões +/- no Inspetor para testar cenários.`;
          }
          return;
        }

        if (state.activeTool === "delete") {
          deleteNode(kind, name);
          return;
        }

        // If already pulling a rubber-band connector from a previous quick-click, complete connection!
        if (state.connectSource) {
          if (state.connectSource.kind === kind && state.connectSource.name === name) {
            cancelConnector();
            return;
          }
          completeConnectionTo(kind, name);
          return;
        }

        // Shift + Click (without Alt): toggle node in/out of multi-selection
        if (e.shiftKey && !e.altKey) {
          const curSet = new Set(state.multiSelected);
          if (state.selected && (state.selected.type === "place" || state.selected.type === "transition")) {
            curSet.add(`${state.selected.type === "place" ? "P" : "T"}:${state.selected.id}`);
          }
          if (curSet.has(nodeId)) curSet.delete(nodeId);
          else curSet.add(nodeId);
          const arr = Array.from(curSet);
          if (arr.length >= 2) {
            state.multiSelected = arr;
            state.selected = null;
          } else if (arr.length === 1) {
            state.multiSelected = [];
            state.selected = { type: arr[0].startsWith("P:") ? "place" : "transition", id: arr[0].slice(2) };
          } else {
            state.multiSelected = [];
            state.selected = null;
          }
          updateModeToolbars();
          renderCanvas();
          renderRightPanel();
          return;
        }

        // If node belongs to an active multi-selection (>= 2 items), drag (or Alt-clone!) the entire block together!
        if (state.multiSelected.length >= 2 && state.multiSelected.includes(nodeId)) {
          let dragIds = [...state.multiSelected];
          let wasCloned = false;
          if (e.altKey) {
            dragIds = cloneMultiSelection(dragIds);
            state.multiSelected = dragIds;
            wasCloned = true;
          }
          const origPos = {};
          for (const id of dragIds) {
            if (state.positions[id]) origPos[id] = { ...state.positions[id] };
          }
          state.draggingMulti = {
            ids: dragIds,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startSvg: clientToSvg(e.clientX, e.clientY),
            origPos,
            dragActivated: wasCloned,
            moved: false,
            wasCloned
          };
          renderCanvas();
          renderRightPanel();
          return;
        }

        // Otherwise clear multi-selection and handle single node
        state.multiSelected = [];

        let targetKind = kind;
        let targetName = name;
        let targetNodeId = nodeId;

        // Alt + Drag: clone element immediately and drag the clone!
        if (e.altKey) {
          const clonedName = cloneSpnNode(kind, name);
          if (clonedName) {
            targetName = clonedName;
            targetNodeId = `${kind}:${clonedName}`;
          }
        }

        // Select in Inspector & prepare move vs. quick-click connector detection (5px threshold)
        state.selected = { type: targetKind === "P" ? "place" : "transition", id: targetName };
        const svgPt = clientToSvg(e.clientX, e.clientY);
        const cur = state.positions[targetNodeId];
        state.draggingNode = {
          nodeId: targetNodeId,
          kind: targetKind,
          name: targetName,
          startClientX: e.clientX,
          startClientY: e.clientY,
          origX: cur.x,
          origY: cur.y,
          offsetX: svgPt.x - cur.x,
          offsetY: svgPt.y - cur.y,
          dragActivated: e.altKey,
          moved: false,
          wasCloned: e.altKey
        };
        if (e.ctrlKey && e.altKey) {
          const hitZ = findZoneAtPoint(cur.x, cur.y, targetNodeId);
          state.reparentState = { nodeIds: [targetNodeId], targetZoneId: hitZ ? hitZ.id : "" };
        } else {
          state.reparentState = null;
        }
        renderCanvas();
        renderCodeHighlight(true);
        renderRightPanel();
      });
    });

    // Arcs & Fixed Inflection Points (Waypoints)
    dom.svg.querySelectorAll(".spn-arc").forEach((el) => {
      const arcId = el.dataset.arcId;
      el.addEventListener("mouseenter", (e) => showTooltip(el.dataset.tip, e));
      el.addEventListener("mousemove", (e) => moveTooltip(e));
      el.addEventListener("mouseleave", hideTooltip);

      el.addEventListener("mousedown", (e) => {
        if (e.target.closest(".spn-arc-wp, .spn-arc-wp-add")) return;
        e.stopPropagation();
        const baseArcId = arcId.replace(/:pmir$/, "");
        const [trName, arcDir, idxStr] = baseArcId.split(":");
        const arcIdx = Number(idxStr);
        if (state.activeTool === "delete") {
          deleteArc(trName, arcDir, arcIdx);
          return;
        }
        state.selected = { type: "arc", id: baseArcId, trName, arcDir, arcIdx };
        state.activeTab = "inspector";
        updateTabButtons();
        renderCanvas();
        renderCodeHighlight(true);
        renderRightPanel();
      });

      // Double-click anywhere on an arc to insert a fixed inflection point at that exact spot!
      el.addEventListener("dblclick", (e) => {
        if (e.target.closest(".spn-arc-wp")) return;
        e.stopPropagation();
        e.preventDefault();
        const pt = clientToSvg(e.clientX, e.clientY);
        insertArcWaypointAt(arcId, pt.x, pt.y);
      });
    });

    // Existing Fixed Inflection Point Handles (drag to move, double-click or right-click to remove)
    dom.svg.querySelectorAll(".spn-arc-wp").forEach((el) => {
      const arcId = el.dataset.arcId;
      const wpIdx = Number(el.dataset.wpIdx);
      const wpKey = `W:${arcId}`;

      el.addEventListener("mouseenter", (e) => showTooltip(el.dataset.tip, e));
      el.addEventListener("mousemove", (e) => moveTooltip(e));
      el.addEventListener("mouseleave", hideTooltip);

      el.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        if (e.button === 2 || e.altKey || state.activeTool === "delete") {
          e.preventDefault();
          removeArcWaypoint(arcId, wpIdx);
          return;
        }
        if (e.button !== 0) return;
        const baseArcId = arcId.replace(/:pmir$/, "");
        const [trName, arcDir, idxStr] = baseArcId.split(":");
        state.selected = { type: "arc", id: baseArcId, trName, arcDir, arcIdx: Number(idxStr) };
        const wps = Array.isArray(state.positions[wpKey]) ? state.positions[wpKey] : [];
        const cur = wps[wpIdx] || { x: Number(el.dataset.wx) || 0, y: Number(el.dataset.wy) || 0 };
        state.draggingWaypoint = {
          wpKey,
          arcId,
          idx: wpIdx,
          origX: cur.x,
          origY: cur.y,
          moved: false
        };
      });

      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        e.preventDefault();
        removeArcWaypoint(arcId, wpIdx);
      });

      el.addEventListener("contextmenu", (e) => {
        e.stopPropagation();
        e.preventDefault();
        removeArcWaypoint(arcId, wpIdx);
      });
    });

    // Virtual Segment Midpoint '+' Handles (click or drag to materialize a new fixed inflection point!)
    dom.svg.querySelectorAll(".spn-arc-wp-add").forEach((el) => {
      const arcId = el.dataset.arcId;
      const segIdx = Number(el.dataset.segIdx);
      const mx = Math.round((Number(el.dataset.mx) || 0) / 5) * 5;
      const my = Math.round((Number(el.dataset.my) || 0) / 5) * 5;
      const wpKey = `W:${arcId}`;

      el.addEventListener("mouseenter", (e) => showTooltip(el.dataset.tip, e));
      el.addEventListener("mousemove", (e) => moveTooltip(e));
      el.addEventListener("mouseleave", hideTooltip);

      el.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const rendered = (state.lastRenderedArcs || []).find((a) => a.id === arcId);
        let wps = Array.isArray(state.positions[wpKey])
          ? state.positions[wpKey].map((p) => ({ x: p.x, y: p.y }))
          : rendered && rendered.finalPts && rendered.finalPts.length > 2
          ? rendered.finalPts.slice(1, -1).map((p) => ({ x: Math.round(p.x / 5) * 5, y: Math.round(p.y / 5) * 5 }))
          : [];
        const insertIdx = Math.max(0, Math.min(wps.length, segIdx));
        wps.splice(insertIdx, 0, { x: mx, y: my });
        state.positions[wpKey] = wps;
        state.draggingWaypoint = {
          wpKey,
          arcId,
          idx: insertIdx,
          origX: mx,
          origY: my,
          moved: true
        };
        renderCanvas();
        renderRightPanel();
      });
    });
  }

  function showTooltip(text, e) {
    if (!text) return;
    dom.tooltip.innerHTML = escapeXml(text).replace(/ \| /g, "<br/>");
    dom.tooltip.style.display = "block";
    moveTooltip(e);
  }
  function moveTooltip(e) {
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + 360 > window.innerWidth) x = e.clientX - 360;
    if (y + 120 > window.innerHeight) y = e.clientY - 100;
    dom.tooltip.style.left = Math.max(6, x) + "px";
    dom.tooltip.style.top = Math.max(6, y) + "px";
  }
  function hideTooltip() {
    dom.tooltip.style.display = "none";
  }

  // =========================================================================
  // CANVAS PAN / ZOOM / INTERACTIVE EDITING (VISUAL -> MRY)
  // =========================================================================
  function clientToSvg(clientX, clientY) {
    const rect = dom.svg.getBoundingClientRect();
    const rx = (clientX - rect.left) / rect.width;
    const ry = (clientY - rect.top) / rect.height;
    return {
      x: state.view.x + rx * state.view.w,
      y: state.view.y + ry * state.view.h
    };
  }

  function fitView() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    if (state.ast && state.ast.modelType === "RBD" && state.rbdLayout) {
      const b = state.rbdLayout.bounds;
      minX = b.minX; maxX = b.maxX; minY = b.minY; maxY = b.maxY;
    } else {
      const entries = Object.entries(state.positions).filter(
        ([k]) => k.startsWith("P:") || k.startsWith("T:") || (state.useMirrors && (k.startsWith("M:") || k.startsWith("MT:")))
      );
      if (entries.length === 0) return;
      for (const [, p] of entries) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    const padX = state.ast && state.ast.modelType === "RBD" ? 40 : 120;
    const padY = state.ast && state.ast.modelType === "RBD" ? 40 : 100;
    const rect = dom.svg.getBoundingClientRect();
    const aspect = rect.width && rect.height ? rect.width / rect.height : 1.6;
    let w = Math.max(480, maxX - minX + padX * 2);
    let h = Math.max(320, maxY - minY + padY * 2);
    if (w / h < aspect) {
      const targetW = h * aspect;
      minX -= (targetW - w) / 2;
      w = targetW;
    } else {
      const targetH = w / aspect;
      minY -= (targetH - h) / 2;
      h = targetH;
    }
    state.view = { x: minX - padX, y: minY - padY, w, h };
    renderCanvas();
  }

  dom.svgStage.addEventListener("mouseleave", () => {
    // Pause rubber-band visual when user moves mouse out to Inspector / Code Editor
    if (state.connectSource) {
      state.connectCursor = null;
      renderRubberBand();
    }
  });

  dom.svgStage.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (state.connectSource) {
      cancelConnector();
    }
  });

  // Prevent clicks on floating UI inside svgStage from starting marquee / clearing selection!
  [dom.figmaDock, dom.selectionActionBar, dom.simActionBar, dom.legendOverlay].forEach((el) => {
    if (el) {
      el.addEventListener("mousedown", (e) => e.stopPropagation());
      el.addEventListener("wheel", (e) => e.stopPropagation());
    }
  });

  function blurActiveControl() {
    if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  }

  dom.svgStage.addEventListener("mousedown", (e) => {
    blurActiveControl();
    // Middle-click, right-click (when not connecting), or Space+left-click -> Pan camera
    if (e.button === 1 || (e.button === 2 && !state.connectSource) || (e.button === 0 && state.spacePressed)) {
      e.preventDefault();
      state.isPanning = true;
      state.panStart = { clientX: e.clientX, clientY: e.clientY, vx: state.view.x, vy: state.view.y };
      return;
    }

    if (e.button !== 0) return;
    const svgPt = clientToSvg(e.clientX, e.clientY);

    // If pulling a rubber-band connector, clicking empty canvas cancels the wire (keeps node selected!)
    if (state.connectSource) {
      cancelConnector();
      return;
    }

    if (state.activeTool === "addPlace") {
      addPlaceAt(svgPt.x, svgPt.y);
      return;
    }
    if (state.activeTool === "addExp" || state.activeTool === "addDet" || state.activeTool === "addImm") {
      addTransitionAt(state.activeTool, svgPt.x, svgPt.y);
      return;
    }

    // Empty area drag in SPN select mode -> Box Selection (Marquee)!
    if (state.ast && state.ast.modelType === "SPN" && state.activeTool === "select") {
      state.marquee = {
        startX: svgPt.x,
        startY: svgPt.y,
        curX: svgPt.x,
        curY: svgPt.y,
        additive: e.shiftKey
      };
      renderMarquee();
      return;
    }

    // In RBD mode, dragging empty space pans camera
    if (state.selected || state.multiSelected.length > 0) {
      state.selected = null;
      state.multiSelected = [];
      renderCanvas();
      renderRightPanel();
    }
    state.isPanning = true;
    state.panStart = { clientX: e.clientX, clientY: e.clientY, vx: state.view.x, vy: state.view.y };
  });

  window.addEventListener("mousemove", (e) => {
    if (state.collab.active && dom.svg) {
      const rect = dom.svg.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        broadcastCollabCursor(clientToSvg(e.clientX, e.clientY));
      }
    }

    if (state.draggingWaypoint) {
      const dw = state.draggingWaypoint;
      const pt = clientToSvg(e.clientX, e.clientY);
      let nx = Math.round(pt.x / 5) * 5;
      let ny = Math.round(pt.y / 5) * 5;
      const wps = Array.isArray(state.positions[dw.wpKey]) ? state.positions[dw.wpKey] : [];

      if (e.shiftKey) {
        // Snap horizontally or vertically to adjacent waypoint or endpoint for crisp 90° orthogonal bends!
        const rendered = (state.lastRenderedArcs || []).find((a) => a.id === dw.arcId);
        const refPt =
          dw.idx > 0 && wps[dw.idx - 1]
            ? wps[dw.idx - 1]
            : rendered && rendered.startPt
            ? rendered.startPt
            : { x: dw.origX, y: dw.origY };
        if (Math.abs(nx - refPt.x) < Math.abs(ny - refPt.y)) {
          nx = Math.round(refPt.x / 5) * 5;
          state.axisGuide = { type: "V", x: nx };
        } else {
          ny = Math.round(refPt.y / 5) * 5;
          state.axisGuide = { type: "H", y: ny };
        }
      } else {
        state.axisGuide = null;
      }

      if (wps[dw.idx]) {
        wps[dw.idx] = { x: nx, y: ny };
        dw.moved = true;
        renderCanvas();
      }
      return;
    }

    if (state.marquee) {
      const pt = clientToSvg(e.clientX, e.clientY);
      state.marquee.curX = pt.x;
      state.marquee.curY = pt.y;
      renderMarquee();
      return;
    }

    if (state.connectSource && !state.draggingNode && !state.draggingMulti && !state.draggingZone && !state.isPanning) {
      const rect = dom.svg.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        state.connectCursor = clientToSvg(e.clientX, e.clientY);
        renderRubberBand();
      }
      return;
    }

    if (state.draggingMirror) {
      if (!state.draggingMirror.dragActivated) {
        const sDist = Math.hypot(
          e.clientX - state.draggingMirror.startClientX,
          e.clientY - state.draggingMirror.startClientY
        );
        if (sDist < 5) return;
        state.draggingMirror.dragActivated = true;
      }
      const pt = clientToSvg(e.clientX, e.clientY);
      let nx = Math.round((pt.x - state.draggingMirror.offsetX) / 5) * 5;
      let ny = Math.round((pt.y - state.draggingMirror.offsetY) / 5) * 5;
      if (e.shiftKey) {
        if (Math.abs(nx - state.draggingMirror.origX) >= Math.abs(ny - state.draggingMirror.origY)) {
          ny = state.draggingMirror.origY;
          state.axisGuide = { type: "H", y: ny };
        } else {
          nx = state.draggingMirror.origX;
          state.axisGuide = { type: "V", x: nx };
        }
      } else {
        state.axisGuide = null;
      }
      if (nx !== state.draggingMirror.origX || ny !== state.draggingMirror.origY) {
        state.draggingMirror.moved = true;
      }
      state.positions[state.draggingMirror.mirrorId] = { x: nx, y: ny };
      renderCanvas();
      return;
    }

    if (state.draggingMulti) {
      if (!state.draggingMulti.dragActivated) {
        const sDist = Math.hypot(e.clientX - state.draggingMulti.startClientX, e.clientY - state.draggingMulti.startClientY);
        if (sDist < 5) return;
        state.draggingMulti.dragActivated = true;
      }
      const pt = clientToSvg(e.clientX, e.clientY);
      let dx = Math.round((pt.x - state.draggingMulti.startSvg.x) / 5) * 5;
      let dy = Math.round((pt.y - state.draggingMulti.startSvg.y) / 5) * 5;
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          dy = 0;
          state.axisGuide = { type: "H", y: state.draggingMulti.startSvg.y };
        } else {
          dx = 0;
          state.axisGuide = { type: "V", x: state.draggingMulti.startSvg.x };
        }
      } else {
        state.axisGuide = null;
      }
      if (dx !== 0 || dy !== 0) state.draggingMulti.moved = true;
      for (const [id, orig] of Object.entries(state.draggingMulti.origPos)) {
        state.positions[id] = { x: orig.x + dx, y: orig.y + dy };
      }

      if (e.ctrlKey) {
        const hitZone = findZoneAtPoint(pt.x, pt.y, state.draggingMulti.ids);
        state.reparentState = {
          nodeIds: state.draggingMulti.ids,
          targetZoneId: hitZone ? hitZone.id : ""
        };
        dom.canvasHint.textContent = hitZone
          ? `Ctrl ativo: solte para mover os ${state.draggingMulti.ids.length} itens para "${hitZone.label}"`
          : `Ctrl ativo: solte fora das áreas para retirar os ${state.draggingMulti.ids.length} itens de suas áreas`;
      } else if (state.reparentState) {
        state.reparentState = null;
        updateModeToolbars();
      }
      renderCanvas();
      return;
    }

    if (state.draggingZone) {
      const pt = clientToSvg(e.clientX, e.clientY);
      let dx = Math.round((pt.x - state.draggingZone.startSvg.x) / 5) * 5;
      let dy = Math.round((pt.y - state.draggingZone.startSvg.y) / 5) * 5;
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          dy = 0;
          state.axisGuide = { type: "H", y: state.draggingZone.startSvg.y };
        } else {
          dx = 0;
          state.axisGuide = { type: "V", x: state.draggingZone.startSvg.x };
        }
      } else {
        state.axisGuide = null;
      }
      if (dx !== 0 || dy !== 0) state.draggingZone.moved = true;
      const z = (state.zones || []).find((x) => x.id === state.draggingZone.zoneId);
      if (z) {
        const entries = Object.entries(state.draggingZone.origMemberPos);
        if (entries.length > 0) {
          for (const [mId, orig] of entries) {
            state.positions[mId] = { x: orig.x + dx, y: orig.y + dy };
          }
        } else {
          z.emptyPos = {
            x: state.draggingZone.origEmptyPos.x + dx,
            y: state.draggingZone.origEmptyPos.y + dy
          };
        }
        renderCanvas();
      }
    } else if (state.draggingNode) {
      // Threshold check: move only starts once mouse drags > 5px (distinguishes click-to-connect from hold-to-move!)
      if (!state.draggingNode.dragActivated) {
        const screenDist = Math.hypot(e.clientX - state.draggingNode.startClientX, e.clientY - state.draggingNode.startClientY);
        if (screenDist < 5) return;
        state.draggingNode.dragActivated = true;
      }

      const pt = clientToSvg(e.clientX, e.clientY);
      let nx = Math.round((pt.x - state.draggingNode.offsetX) / 5) * 5;
      let ny = Math.round((pt.y - state.draggingNode.offsetY) / 5) * 5;

      // Shift: lock strictly horizontal or vertical axis
      if (e.shiftKey) {
        const adx = Math.abs(nx - state.draggingNode.origX);
        const ady = Math.abs(ny - state.draggingNode.origY);
        if (adx >= ady) {
          ny = state.draggingNode.origY;
          state.axisGuide = { type: "H", y: state.draggingNode.origY };
        } else {
          nx = state.draggingNode.origX;
          state.axisGuide = { type: "V", x: state.draggingNode.origX };
        }
      } else {
        state.axisGuide = null;
      }

      if (nx !== state.draggingNode.origX || ny !== state.draggingNode.origY) {
        state.draggingNode.moved = true;
      }
      state.positions[state.draggingNode.nodeId] = { x: nx, y: ny };

      // Ctrl: allow passing freely across Areas & highlight target Area for reparenting
      if (e.ctrlKey) {
        const hitZone = findZoneAtPoint(nx, ny, state.draggingNode.nodeId);
        state.reparentState = {
          nodeIds: [state.draggingNode.nodeId],
          targetZoneId: hitZone ? hitZone.id : ""
        };
        const nm = state.draggingNode.nodeId.slice(2);
        dom.canvasHint.textContent = hitZone
          ? `Ctrl ativo: solte para mover '${nm}' para a área "${hitZone.label}"`
          : `Ctrl ativo: solte fora das áreas para retirar '${nm}' da área atual`;
      } else if (state.reparentState) {
        state.reparentState = null;
        updateModeToolbars();
      }

      renderCanvas();
    } else if (state.isPanning && state.panStart) {
      const rect = dom.svg.getBoundingClientRect();
      const dx = ((e.clientX - state.panStart.clientX) / rect.width) * state.view.w;
      const dy = ((e.clientY - state.panStart.clientY) / rect.height) * state.view.h;
      state.view.x = state.panStart.vx - dx;
      state.view.y = state.panStart.vy - dy;
      dom.svg.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
    }
  });

  window.addEventListener("mouseup", (e) => {
    // Finish box selection (marquee)
    if (state.marquee) {
      const mq = state.marquee;
      state.marquee = null;
      renderMarquee();
      const x1 = Math.min(mq.startX, mq.curX);
      const y1 = Math.min(mq.startY, mq.curY);
      const x2 = Math.max(mq.startX, mq.curX);
      const y2 = Math.max(mq.startY, mq.curY);

      if (x2 - x1 < 4 && y2 - y1 < 4) {
        // Simple click on empty space -> deselect all
        if (!mq.additive && (state.selected || state.multiSelected.length > 0)) {
          state.selected = null;
          state.multiSelected = [];
          updateModeToolbars();
          renderCanvas();
          renderRightPanel();
        }
      } else {
        const hit = mq.additive ? new Set(state.multiSelected) : new Set();
        for (const [id, pt] of Object.entries(state.positions)) {
          if ((id.startsWith("P:") || id.startsWith("T:")) && pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2) {
            hit.add(id);
          }
        }
        const arr = Array.from(hit);
        if (arr.length >= 2) {
          state.multiSelected = arr;
          state.selected = null;
          state.activeTab = "inspector";
          updateTabButtons();
        } else if (arr.length === 1) {
          state.multiSelected = [];
          state.selected = { type: arr[0].startsWith("P:") ? "place" : "transition", id: arr[0].slice(2) };
          state.activeTab = "inspector";
          updateTabButtons();
        } else if (!mq.additive) {
          state.multiSelected = [];
          state.selected = null;
        }
        updateModeToolbars();
        renderCanvas();
        renderRightPanel();
      }
      return;
    }

    const didWaypointDrag = state.draggingWaypoint;
    const didMirrorDrag = state.draggingMirror;
    const didNodeDrag = state.draggingNode;
    const didMultiDrag = state.draggingMulti;
    const didZoneDrag = state.draggingZone;
    const reparent = state.reparentState;
    const hadGuide = Boolean(state.axisGuide);

    state.draggingWaypoint = null;
    state.draggingMirror = null;
    state.draggingNode = null;
    state.draggingMulti = null;
    state.draggingZone = null;
    state.axisGuide = null;
    state.reparentState = null;
    state.isPanning = false;

    if (didWaypointDrag) {
      if (hadGuide) renderCanvas();
      if (didWaypointDrag.moved) {
        commitHistory();
        renderRightPanel();
        setParseStatus(true, `Ponto de inflexão #${didWaypointDrag.idx + 1} fixado`);
      }
      return;
    }

    if (didMirrorDrag) {
      if (!didMirrorDrag.dragActivated) {
        // Simple click on mirror -> smooth animated camera flight to the original Place or Transition!
        focusNodeById(didMirrorDrag.targetId, {
          animate: true,
          fromPt: { x: didMirrorDrag.origX, y: didMirrorDrag.origY },
          keepSimMode: state.simMode
        });
        if (!state.simMode) {
          renderCodeHighlight(true);
          renderRightPanel();
        }
      } else if (didMirrorDrag.moved) {
        if (hadGuide) renderCanvas();
        commitHistory();
        setParseStatus(true, `Espelho '↗ ${didMirrorDrag.labelName}' reposicionado`);
      } else if (hadGuide) {
        renderCanvas();
      }
      return;
    }

    // Quick click (without dragging > 5px) on a node in select mode -> start rubber-band connector!
    if (didNodeDrag && !didNodeDrag.dragActivated && !didNodeDrag.wasCloned && state.activeTool === "select") {
      startConnectorFrom(didNodeDrag.kind, didNodeDrag.name, e);
      return;
    }

    if (reparent && ((didNodeDrag && didNodeDrag.moved) || (didMultiDrag && didMultiDrag.moved))) {
      setMultiNodesZone(reparent.nodeIds, reparent.targetZoneId);
      const z = (state.zones || []).find((x) => x.id === reparent.targetZoneId);
      const lbl = reparent.nodeIds.length === 1 ? `'${reparent.nodeIds[0].slice(2)}'` : `${reparent.nodeIds.length} itens`;
      setParseStatus(
        true,
        z ? `${lbl} atribuído(s) à área "${z.label}"` : `${lbl} retirado(s) da área`
      );
      updateModeToolbars();
      return;
    }

    if (
      (didNodeDrag && (didNodeDrag.moved || didNodeDrag.wasCloned)) ||
      (didMultiDrag && (didMultiDrag.moved || didMultiDrag.wasCloned)) ||
      (didZoneDrag && didZoneDrag.moved)
    ) {
      if (hadGuide) renderCanvas();
      commitHistory();
      updateModeToolbars();
    } else if (hadGuide) {
      renderCanvas();
      updateModeToolbars();
    }
  });

  dom.svgStage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    const pt = clientToSvg(e.clientX, e.clientY);
    const newW = Math.max(240, Math.min(8000, state.view.w * factor));
    const newH = Math.max(160, Math.min(5500, state.view.h * factor));
    const rx = (pt.x - state.view.x) / state.view.w;
    const ry = (pt.y - state.view.y) / state.view.h;
    state.view.x = pt.x - rx * newW;
    state.view.y = pt.y - ry * newH;
    state.view.w = newW;
    state.view.h = newH;
    dom.svg.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
  }, { passive: false });

  function uniqueName(prefix, existing) {
    let idx = 1;
    while (existing.has(`${prefix}${idx}`)) idx++;
    return `${prefix}${idx}`;
  }

  function addPlaceAt(x, y) {
    const existing = new Set(state.ast.places.map((p) => p.name));
    const name = uniqueName("Place_", existing);
    state.ast.places.push({ name, tokens: "0", hasExplicitTokens: false, extraProps: [] });
    state.positions[`P:${name}`] = { x: Math.round(x), y: Math.round(y) };
    state.selected = { type: "place", id: name };
    setTool("select");
    syncVisualToMry(`Lugar '${name}' adicionado`);
  }

  function addTransitionAt(tool, x, y) {
    const existing = new Set(state.ast.transitions.map((t) => t.name));
    const prefix = tool === "addImm" ? "Imm_" : tool === "addDet" ? "Det_" : "Exp_";
    const name = uniqueName(prefix, existing);
    const tr = {
      name,
      kind: tool === "addImm" ? "immediate" : "timed",
      inputs: [],
      outputs: [],
      inhibitors: [],
      delayType: tool === "addImm" ? "Immediate" : tool === "addDet" ? "Deterministic" : "Exponential",
      delayExpr: tool === "addImm" ? "" : "1.0",
      delayParams: tool === "addDet" ? [{ key: "Value", value: "1.0" }] : [],
      serverType: tool === "addImm" ? null : "SingleServer",
      guard: "",
      guardKey: "enablingFunction",
      priority: tool === "addImm" ? "1" : "",
      weight: tool === "addImm" ? "1.0" : "",
      policy: "",
      extraProps: []
    };
    state.ast.transitions.push(tr);
    state.positions[`T:${name}`] = { x: Math.round(x), y: Math.round(y) };
    state.selected = { type: "transition", id: name };
    setTool("select");
    syncVisualToMry(`Transição '${name}' adicionada`);
  }

  function setConnectorType(type) {
    state.connectorType = type === "inhibitor" ? "inhibitor" : "normal";
    dom.btnConnNormal.classList.toggle("active", state.connectorType === "normal");
    dom.btnConnInhibitor.classList.toggle("active-inhib", state.connectorType === "inhibitor");
    dom.btnConnInhibitor.classList.remove("active");
    // Return to select tool so user can immediately click-to-connect
    if (state.activeTool !== "select") setTool("select");
    updateModeToolbars();
    renderRubberBand();
  }

  function startConnectorFrom(kind, name, mouseEvent) {
    if (state.connectorType === "inhibitor" && kind !== "P") {
      dom.canvasHint.textContent = `Transição '${name}' selecionada. Arco Inibidor ○ só parte de um Lugar — aperte Tab para alternar para Arco Normal.`;
      return;
    }
    state.connectSource = { kind, name };
    state.connectCursor = mouseEvent ? clientToSvg(mouseEvent.clientX, mouseEvent.clientY) : state.positions[`${kind}:${name}`];
    dom.svgStage.classList.add("mode-connect");
    updateModeToolbars();
    renderRubberBand();
  }

  function cancelConnector() {
    state.connectSource = null;
    state.connectCursor = null;
    dom.svgStage.classList.remove("mode-connect");
    updateModeToolbars();
    renderRubberBand();
  }

  function completeConnectionTo(kind, name) {
    const src = state.connectSource;
    if (!src) return;

    if (!isValidConnection(src, { kind, name }, state.connectorType)) {
      dom.canvasHint.textContent =
        state.connectorType === "inhibitor"
          ? "Inválido: Arco Inibidor ○ só pode conectar Lugar → Transição."
          : "Inválido: SPNs são grafos bipartidos — conecte sempre Lugar ↔ Transição.";
      return;
    }

    state.connectSource = null;
    state.connectCursor = null;
    dom.svgStage.classList.remove("mode-connect");

    const arcObj = { place: "", multiplicity: "1", isStringExpr: false, isConditional: false, isNumeric: true };
    let tr, dir, idx;

    if (state.connectorType === "inhibitor") {
      tr = state.ast.transitions.find((t) => t.name === name);
      arcObj.place = src.name;
      tr.inhibitors.push(arcObj);
      dir = "inh";
      idx = tr.inhibitors.length - 1;
    } else if (src.kind === "P" && kind === "T") {
      tr = state.ast.transitions.find((t) => t.name === name);
      arcObj.place = src.name;
      tr.inputs.push(arcObj);
      dir = "in";
      idx = tr.inputs.length - 1;
    } else {
      tr = state.ast.transitions.find((t) => t.name === src.name);
      arcObj.place = name;
      tr.outputs.push(arcObj);
      dir = "out";
      idx = tr.outputs.length - 1;
    }

    state.selected = { type: "arc", id: `${tr.name}:${dir}:${idx}`, trName: tr.name, arcDir: dir, arcIdx: idx };
    syncVisualToMry(`Arco ${dir === "inh" ? "inibidor ○ " : ""}conectado em '${tr.name}'`);
  }

  function cloneSpnNode(kind, name) {
    if (!state.ast || state.ast.modelType !== "SPN") return null;
    const origPos = state.positions[`${kind}:${name}`] || { x: 200, y: 200 };
    const origZoneId = getNodeZoneId(`${kind}:${name}`);

    const makeCloneName = (baseName, existingSet) => {
      const m = baseName.match(/^(.+_T)(\d+)$/);
      if (m) {
        let num = Number(m[2]) + 1;
        while (existingSet.has(`${m[1]}${num}`)) num++;
        return `${m[1]}${num}`;
      }
      let idx = 1;
      while (existingSet.has(`${baseName}_copy${idx}`)) idx++;
      return `${baseName}_copy${idx}`;
    };

    if (kind === "P") {
      const orig = state.ast.places.find((p) => p.name === name);
      if (!orig) return null;
      const existing = new Set(state.ast.places.map((p) => p.name));
      const newName = makeCloneName(name, existing);
      state.ast.places.push({
        name: newName,
        tokens: orig.tokens,
        hasExplicitTokens: orig.hasExplicitTokens,
        extraProps: deepClone(orig.extraProps || [])
      });
      state.positions[`P:${newName}`] = { x: origPos.x, y: origPos.y };
      if (origZoneId) {
        const z = state.zones.find((x) => x.id === origZoneId);
        if (z) z.members.push(`P:${newName}`);
      }
      syncVisualToMry(`Lugar '${name}' clonado → '${newName}' (arraste para posicionar)`, true);
      return newName;
    } else {
      const orig = state.ast.transitions.find((t) => t.name === name);
      if (!orig) return null;
      const existing = new Set(state.ast.transitions.map((t) => t.name));
      const newName = makeCloneName(name, existing);
      state.ast.transitions.push({
        ...deepClone(orig),
        name: newName,
        inputs: [],
        outputs: [],
        inhibitors: []
      });
      state.positions[`T:${newName}`] = { x: origPos.x, y: origPos.y };
      if (origZoneId) {
        const z = state.zones.find((x) => x.id === origZoneId);
        if (z) z.members.push(`T:${newName}`);
      }
      syncVisualToMry(`Transição '${name}' clonada → '${newName}' (arraste para posicionar)`, true);
      return newName;
    }
  }

  function getNodeZoneId(nodeId) {
    const z = (state.zones || []).find((x) => (x.members || []).includes(nodeId));
    return z ? z.id : "";
  }

  function setNodeZone(nodeId, targetZoneId) {
    for (const z of state.zones || []) {
      z.members = (z.members || []).filter((id) => id !== nodeId);
      if (targetZoneId && z.id === targetZoneId) {
        z.members.push(nodeId);
      }
    }
    refreshBranchChips();
    renderCanvas();
    renderRightPanel();
    commitHistory();
  }

  function addZone() {
    if (!state.ast || state.ast.modelType !== "SPN") return;
    // If user already has multiple items selected (or a single node), create the new Area wrapping them immediately!
    if (state.multiSelected.length >= 2) {
      createZoneFromSelection([...state.multiSelected]);
      return;
    }
    const existing = new Set((state.zones || []).map((z) => z.id));
    const id = uniqueName("zone_", existing);
    const num = (state.zones || []).length + 1;
    const palette = ["#0284c7", "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
    const z = {
      id,
      label: `NOVA ÁREA ${num}`,
      color: palette[(num - 1) % palette.length],
      members: [],
      emptyPos: {
        x: Math.round(state.view.x + state.view.w * 0.35),
        y: Math.round(state.view.y + state.view.h * 0.35)
      }
    };
    state.zones.push(z);
    state.selected = { type: "zone", id };
    state.activeTab = "inspector";
    updateTabButtons();
    refreshBranchChips();
    renderCanvas();
    renderRightPanel();
    commitHistory();
    setParseStatus(true, `Área '${z.label}' criada (adicione lugares/transições no Inspetor ou via Ctrl+arraste)`);
  }

  function deleteZone(zoneId) {
    state.zones = (state.zones || []).filter((z) => z.id !== zoneId);
    if (state.selected && state.selected.type === "zone" && state.selected.id === zoneId) {
      state.selected = null;
    }
    if (state.branchFilter === `zone:${zoneId}`) state.branchFilter = "ALL";
    refreshBranchChips();
    renderCanvas();
    renderRightPanel();
    commitHistory();
    setParseStatus(true, "Área visual removida (elementos do .mry preservados)");
  }

  function deleteNode(kind, name) {
    const nodeId = `${kind}:${name}`;
    for (const z of state.zones || []) {
      z.members = (z.members || []).filter((id) => id !== nodeId);
    }
    if (kind === "P") {
      state.ast.places = state.ast.places.filter((p) => p.name !== name);
      for (const tr of state.ast.transitions) {
        tr.inputs = tr.inputs.filter((a) => a.place !== name);
        tr.outputs = tr.outputs.filter((a) => a.place !== name);
        tr.inhibitors = tr.inhibitors.filter((a) => a.place !== name);
      }
      delete state.positions[`P:${name}`];
    } else {
      state.ast.transitions = state.ast.transitions.filter((t) => t.name !== name);
      delete state.positions[`T:${name}`];
    }
    state.selected = null;
    state.connectSource = null;
    state.connectCursor = null;
    dom.svgStage.classList.remove("mode-connect");
    syncVisualToMry(`${kind === "P" ? "Lugar" : "Transição"} '${name}' removido`);
  }

  function setMultiNodesZone(nodeIds, targetZoneId) {
    const idSet = new Set(nodeIds);
    for (const z of state.zones || []) {
      z.members = (z.members || []).filter((id) => !idSet.has(id));
      if (targetZoneId && z.id === targetZoneId) {
        for (const id of nodeIds) z.members.push(id);
      }
    }
    refreshBranchChips();
    renderCanvas();
    renderRightPanel();
    commitHistory();
  }

  function createZoneFromSelection(nodeIds) {
    if (!nodeIds || nodeIds.length === 0) return;
    const existing = new Set((state.zones || []).map((z) => z.id));
    const id = uniqueName("zone_", existing);
    const num = (state.zones || []).length + 1;
    const palette = ["#0284c7", "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
    const z = {
      id,
      label: `ÁREA ${num}`,
      color: palette[(num - 1) % palette.length],
      members: []
    };
    state.zones.push(z);
    state.multiSelected = [];
    state.selected = { type: "zone", id };
    setMultiNodesZone(nodeIds, id);
    setParseStatus(true, `Nova área '${z.label}' criada com ${nodeIds.length} elementos`);
  }

  function cloneMultiSelection(nodeIds, offsetX = 0, offsetY = 0) {
    if (!state.ast || state.ast.modelType !== "SPN" || !nodeIds || nodeIds.length === 0) return [];
    const selectedPlaces = new Set(nodeIds.filter((id) => id.startsWith("P:")).map((id) => id.slice(2)));
    const selectedTrans = new Set(nodeIds.filter((id) => id.startsWith("T:")).map((id) => id.slice(2)));
    const existingP = new Set(state.ast.places.map((p) => p.name));
    const existingT = new Set(state.ast.transitions.map((t) => t.name));

    const makeName = (base, set) => {
      const m = base.match(/^(.+_T)(\d+)$/);
      if (m) {
        let num = Number(m[2]) + 1;
        while (set.has(`${m[1]}${num}`)) num++;
        const cand = `${m[1]}${num}`;
        set.add(cand);
        return cand;
      }
      let idx = 1;
      while (set.has(`${base}_copy${idx}`)) idx++;
      const cand = `${base}_copy${idx}`;
      set.add(cand);
      return cand;
    };

    const placeRenameMap = {};
    const newIds = [];

    for (const pName of selectedPlaces) {
      const orig = state.ast.places.find((p) => p.name === pName);
      if (!orig) continue;
      const newName = makeName(pName, existingP);
      placeRenameMap[pName] = newName;
      state.ast.places.push({
        name: newName,
        tokens: orig.tokens,
        hasExplicitTokens: orig.hasExplicitTokens,
        extraProps: deepClone(orig.extraProps || [])
      });
      const op = state.positions[`P:${pName}`] || { x: 200, y: 200 };
      state.positions[`P:${newName}`] = { x: op.x + offsetX, y: op.y + offsetY };
      newIds.push(`P:${newName}`);
    }

    const rewriteExpr = (expr) => {
      let s = String(expr || "1");
      for (const [oldP, newP] of Object.entries(placeRenameMap)) {
        s = s.replace(new RegExp(`#${oldP}\\b`, "g"), `#${newP}`);
      }
      return s;
    };

    for (const tName of selectedTrans) {
      const orig = state.ast.transitions.find((t) => t.name === tName);
      if (!orig) continue;
      const newName = makeName(tName, existingT);
      // Preserve internal arcs connecting elements inside the cloned block (and rewrite #Place refs!)
      const filterAndMapArcs = (list) =>
        (list || [])
          .filter((a) => placeRenameMap[a.place])
          .map((a) => ({
            ...deepClone(a),
            place: placeRenameMap[a.place],
            multiplicity: rewriteExpr(a.multiplicity)
          }));

      state.ast.transitions.push({
        ...deepClone(orig),
        name: newName,
        guard: orig.guard ? rewriteExpr(orig.guard) : "",
        inputs: filterAndMapArcs(orig.inputs),
        outputs: filterAndMapArcs(orig.outputs),
        inhibitors: filterAndMapArcs(orig.inhibitors)
      });
      const op = state.positions[`T:${tName}`] || { x: 200, y: 200 };
      state.positions[`T:${newName}`] = { x: op.x + offsetX, y: op.y + offsetY };
      newIds.push(`T:${newName}`);
    }

    syncVisualToMry(`Bloco clonado (${newIds.length} elementos + arcos internos)`, offsetX === 0 && offsetY === 0);
    return newIds;
  }

  function deleteMultiSelection(nodeIds) {
    if (!nodeIds || nodeIds.length === 0) return;
    const pDel = new Set(nodeIds.filter((id) => id.startsWith("P:")).map((id) => id.slice(2)));
    const tDel = new Set(nodeIds.filter((id) => id.startsWith("T:")).map((id) => id.slice(2)));
    const idDel = new Set(nodeIds);

    state.ast.places = state.ast.places.filter((p) => !pDel.has(p.name));
    state.ast.transitions = state.ast.transitions.filter((t) => !tDel.has(t.name));
    for (const tr of state.ast.transitions) {
      tr.inputs = tr.inputs.filter((a) => !pDel.has(a.place));
      tr.outputs = tr.outputs.filter((a) => !pDel.has(a.place));
      tr.inhibitors = tr.inhibitors.filter((a) => !pDel.has(a.place));
    }
    for (const id of idDel) delete state.positions[id];
    for (const z of state.zones || []) {
      z.members = (z.members || []).filter((id) => !idDel.has(id));
    }
    state.multiSelected = [];
    state.selected = null;
    state.connectSource = null;
    state.connectCursor = null;
    syncVisualToMry(`${idDel.size} elementos removidos`);
  }

  function alignSelection(mode) {
    const ids = state.multiSelected.filter((id) => state.positions[id]);
    if (ids.length < 2) return;
    const xs = ids.map((id) => state.positions[id].x);
    const ys = ids.map((id) => state.positions[id].y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), midX = Math.round((minX + maxX) / 10) * 5;
    const minY = Math.min(...ys), maxY = Math.max(...ys), midY = Math.round((minY + maxY) / 10) * 5;

    for (const id of ids) {
      if (mode === "left") state.positions[id].x = minX;
      else if (mode === "centerX") state.positions[id].x = midX;
      else if (mode === "right") state.positions[id].x = maxX;
      else if (mode === "top") state.positions[id].y = minY;
      else if (mode === "centerY") state.positions[id].y = midY;
      else if (mode === "bottom") state.positions[id].y = maxY;
    }
    renderCanvas();
    commitHistory();
    setParseStatus(true, `${ids.length} itens alinhados`);
  }

  function distributeSelection(axis) {
    const ids = state.multiSelected.filter((id) => state.positions[id]);
    if (ids.length < 3) return;
    const sorted = [...ids].sort((a, b) => state.positions[a][axis] - state.positions[b][axis]);
    const first = state.positions[sorted[0]][axis];
    const last = state.positions[sorted[sorted.length - 1]][axis];
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((id, idx) => {
      state.positions[id][axis] = Math.round((first + step * idx) / 5) * 5;
    });
    renderCanvas();
    commitHistory();
    setParseStatus(true, `${ids.length} itens distribuídos (${axis === "x" ? "horizontal" : "vertical"})`);
  }

  function deleteSelectedItem() {
    if (state.multiSelected.length > 0) {
      deleteMultiSelection([...state.multiSelected]);
      return true;
    }
    if (!state.selected || !state.ast) return false;
    const sel = state.selected;
    if (sel.type === "place") { deleteNode("P", sel.id); return true; }
    if (sel.type === "transition") { deleteNode("T", sel.id); return true; }
    if (sel.type === "arc") { deleteArc(sel.trName, sel.arcDir, sel.arcIdx); return true; }
    if (sel.type === "zone") { deleteZone(sel.id); return true; }
    if (sel.type === "rbdBlock") { deleteRbdElement("block", sel.id); return true; }
    if (sel.type === "rbdGroup") { deleteRbdElement("group", sel.id); return true; }
    return false;
  }

  function insertArcWaypointAt(arcId, svgX, svgY) {
    const wpKey = `W:${arcId}`;
    const rendered = (state.lastRenderedArcs || []).find((a) => a.id === arcId);
    const pts = rendered && rendered.finalPts && rendered.finalPts.length >= 2
      ? rendered.finalPts
      : [{ x: svgX - 40, y: svgY }, { x: svgX + 40, y: svgY }];

    // Find closest segment index s along finalPts
    let bestSeg = 0;
    let bestDist = Infinity;
    for (let s = 0; s < pts.length - 1; s++) {
      const dx = pts[s + 1].x - pts[s].x;
      const dy = pts[s + 1].y - pts[s].y;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((svgX - pts[s].x) * dx + (svgY - pts[s].y) * dy) / l2));
      const d = Math.hypot(svgX - (pts[s].x + t * dx), svgY - (pts[s].y + t * dy));
      if (d < bestDist) {
        bestDist = d;
        bestSeg = s;
      }
    }

    let wps = Array.isArray(state.positions[wpKey])
      ? state.positions[wpKey].map((p) => ({ x: p.x, y: p.y }))
      : pts.length > 2
      ? pts.slice(1, -1).map((p) => ({ x: Math.round(p.x / 5) * 5, y: Math.round(p.y / 5) * 5 }))
      : [];

    const nx = Math.round(svgX / 5) * 5;
    const ny = Math.round(svgY / 5) * 5;
    const insertIdx = Math.max(0, Math.min(wps.length, bestSeg));
    wps.splice(insertIdx, 0, { x: nx, y: ny });
    state.positions[wpKey] = wps;

    const baseArcId = arcId.replace(/:pmir$/, "");
    const [trName, arcDir, idxStr] = baseArcId.split(":");
    state.selected = { type: "arc", id: baseArcId, trName, arcDir, arcIdx: Number(idxStr) };
    renderCanvas();
    renderRightPanel();
    commitHistory();
    setParseStatus(true, `Ponto de inflexão fixo #${insertIdx + 1} criado em (${nx}, ${ny})`);
  }

  function removeArcWaypoint(arcId, wpIdx) {
    const wpKey = `W:${arcId}`;
    const wps = Array.isArray(state.positions[wpKey]) ? [...state.positions[wpKey]] : [];
    if (wpIdx >= 0 && wpIdx < wps.length) {
      wps.splice(wpIdx, 1);
      if (wps.length === 0) delete state.positions[wpKey];
      else state.positions[wpKey] = wps;
      renderCanvas();
      renderRightPanel();
      commitHistory();
      setParseStatus(true, "Ponto de inflexão removido");
    }
  }

  function clearArcWaypoints(arcId) {
    delete state.positions[`W:${arcId}`];
    delete state.positions[`W:${arcId}:pmir`];
    renderCanvas();
    renderRightPanel();
    commitHistory();
    setParseStatus(true, "Pontos de inflexão limpos — roteamento automático restaurado");
  }

  function deleteArc(trName, arcDir, arcIdx) {
    const tr = state.ast.transitions.find((t) => t.name === trName);
    if (!tr) return;
    const arcId = `${trName}:${arcDir}:${arcIdx}`;
    delete state.positions[`W:${arcId}`];
    delete state.positions[`W:${arcId}:pmir`];
    const arr = arcDir === "in" ? tr.inputs : arcDir === "out" ? tr.outputs : tr.inhibitors;
    arr.splice(arcIdx, 1);
    state.selected = null;
    syncVisualToMry(`Arco removido de '${trName}'`);
  }

  function renamePlace(oldName, newName) {
    const clean = newName.trim();
    if (!clean || clean === oldName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(clean)) return;
    if (state.ast.places.some((p) => p.name === clean)) return;
    const pl = state.ast.places.find((p) => p.name === oldName);
    if (!pl) return;
    pl.name = clean;
    for (const tr of state.ast.transitions) {
      for (const a of [...tr.inputs, ...tr.outputs, ...tr.inhibitors]) {
        if (a.place === oldName) a.place = clean;
      }
    }
    if (state.positions[`P:${oldName}`]) {
      state.positions[`P:${clean}`] = state.positions[`P:${oldName}`];
      delete state.positions[`P:${oldName}`];
    }
    for (const z of state.zones || []) {
      z.members = (z.members || []).map((id) => (id === `P:${oldName}` ? `P:${clean}` : id));
    }
    state.selected = { type: "place", id: clean };
    syncVisualToMry(`Lugar renomeado: ${oldName} → ${clean}`);
  }

  function renameTransition(oldName, newName) {
    const clean = newName.trim();
    if (!clean || clean === oldName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(clean)) return;
    if (state.ast.transitions.some((t) => t.name === clean)) return;
    const tr = state.ast.transitions.find((t) => t.name === oldName);
    if (!tr) return;
    tr.name = clean;
    if (state.positions[`T:${oldName}`]) {
      state.positions[`T:${clean}`] = state.positions[`T:${oldName}`];
      delete state.positions[`T:${oldName}`];
    }
    for (const z of state.zones || []) {
      z.members = (z.members || []).map((id) => (id === `T:${oldName}` ? `T:${clean}` : id));
    }
    state.selected = { type: "transition", id: clean };
    syncVisualToMry(`Transição renomeada: ${oldName} → ${clean}`);
  }

  function animateCameraTo(targetX, targetY, opts = {}) {
    if (state.cameraAnimFrame) {
      cancelAnimationFrame(state.cameraAnimFrame);
      state.cameraAnimFrame = null;
    }
    const startW = state.view.w;
    const startH = state.view.h;
    const startCx = state.view.x + startW / 2;
    const startCy = state.view.y + startH / 2;
    const travelDist = Math.hypot(targetX - startCx, targetY - startCy);

    if (travelDist < 4) {
      state.view.x = targetX - startW / 2;
      state.view.y = targetY - startH / 2;
      renderCanvas();
      return;
    }

    const duration = Math.min(720, Math.max(360, 260 + travelDist * 0.36));
    const zoomLift = travelDist > 260 ? Math.min(0.18, (travelDist - 260) / 2800) : 0;
    const fromPt = opts.fromPt || { x: startCx, y: startCy };
    const t0 = performance.now();

    // Render canvas once up-front so selection highlight is active during flight
    renderCanvas();

    const drawFlightBeacon = (progress) => {
      const layer = dom.svg.querySelector("#codeSyncLayer");
      if (!layer) return;
      const curX = fromPt.x + (targetX - fromPt.x) * progress;
      const curY = fromPt.y + (targetY - fromPt.y) * progress;
      const pulseR = 34 + Math.sin(progress * Math.PI) * 14;
      const alpha = progress < 0.85 ? 0.85 : Math.max(0, (1 - progress) / 0.15) * 0.85;
      layer.innerHTML = `
        <line x1="${fromPt.x.toFixed(1)}" y1="${fromPt.y.toFixed(1)}" x2="${targetX.toFixed(1)}" y2="${targetY.toFixed(1)}" stroke="#6366f1" stroke-width="2.2" stroke-dasharray="8,5" opacity="${(alpha * 0.65).toFixed(2)}" />
        <circle cx="${curX.toFixed(1)}" cy="${curY.toFixed(1)}" r="6" fill="#6366f1" opacity="${alpha.toFixed(2)}" />
        <circle cx="${targetX.toFixed(1)}" cy="${targetY.toFixed(1)}" r="${pulseR.toFixed(1)}" fill="rgba(99, 102, 241, 0.10)" stroke="#6366f1" stroke-width="2.4" stroke-dasharray="6,3" opacity="${alpha.toFixed(2)}" />
      `;
    };

    const step = (now) => {
      const rawT = Math.min(1, (now - t0) / duration);
      // Cubic ease-in-out for natural acceleration and gentle arrival deceleration
      const easeT = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
      const scale = 1 + zoomLift * Math.sin(Math.PI * easeT);
      const curW = startW * scale;
      const curH = startH * scale;
      const cx = startCx + (targetX - startCx) * easeT;
      const cy = startCy + (targetY - startCy) * easeT;

      state.view.w = curW;
      state.view.h = curH;
      state.view.x = cx - curW / 2;
      state.view.y = cy - curH / 2;
      dom.svg.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
      drawFlightBeacon(easeT);

      if (rawT < 1) {
        state.cameraAnimFrame = requestAnimationFrame(step);
      } else {
        state.cameraAnimFrame = null;
        state.view.w = startW;
        state.view.h = startH;
        state.view.x = targetX - startW / 2;
        state.view.y = targetY - startH / 2;
        renderCanvas();
      }
    };

    state.cameraAnimFrame = requestAnimationFrame(step);
  }

  function focusNodeById(nodeId, opts = {}) {
    if (!nodeId || !state.positions[nodeId]) return;
    const prefix = nodeId.slice(0, 2);
    const name = nodeId.slice(2);
    if (!opts.keepSimMode) {
      if (prefix === "B:") state.selected = { type: "rbdBlock", id: name };
      else if (prefix === "G:") state.selected = { type: "rbdGroup", id: name };
      else state.selected = { type: prefix === "P:" ? "place" : "transition", id: name };
    }
    const pt = state.positions[nodeId];
    if (opts.animate !== false) {
      animateCameraTo(pt.x, pt.y, opts);
    } else {
      state.view.x = pt.x - state.view.w / 2;
      state.view.y = pt.y - state.view.h / 2;
      renderCanvas();
    }
  }

  // RBD visual editing helpers
  function renameRbdSymbol(oldName, newName) {
    const clean = newName.trim();
    if (!clean || clean === oldName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(clean)) return false;
    const allNames = new Set([...state.ast.blocks.map((b) => b.name), ...state.ast.groups.map((g) => g.name)]);
    if (allNames.has(clean)) return false;
    for (const b of state.ast.blocks) if (b.name === oldName) b.name = clean;
    for (const g of state.ast.groups) {
      if (g.name === oldName) g.name = clean;
      g.children = g.children.map((ch) => (ch === oldName ? clean : ch));
    }
    if (state.ast.top === oldName) state.ast.top = clean;
    return true;
  }

  function getTargetRbdGroup() {
    if (state.selected && state.selected.type === "rbdGroup") {
      const found = state.ast.groups.find((g) => g.name === state.selected.id);
      if (found) return found;
    }
    if (state.ast.top) {
      const topG = state.ast.groups.find((g) => g.name === state.ast.top);
      if (topG) return topG;
    }
    return state.ast.groups[state.ast.groups.length - 1] || null;
  }

  function addRbdBlock(kind) {
    if (!state.ast || state.ast.modelType !== "RBD") return;
    const existing = new Set([...state.ast.blocks.map((b) => b.name), ...state.ast.groups.map((g) => g.name)]);
    const name = uniqueName(kind === "hierarchy" ? "ENV_" : "COMP_", existing);
    const blk =
      kind === "hierarchy"
        ? { name, kind: "hierarchy", availability: "0.99", reliability: "0.99", extraProps: [] }
        : { name, kind: "block", mttf: "8760.0", mttr: "1.0", extraProps: [] };
    state.ast.blocks.push(blk);
    const parent = getTargetRbdGroup();
    if (parent) parent.children.push(name);
    else state.ast.top = state.ast.top || name;
    state.selected = { type: "rbdBlock", id: name };
    syncVisualToMry(`Bloco RBD '${name}' adicionado`);
    fitView();
  }

  function addRbdGroup(kind) {
    if (!state.ast || state.ast.modelType !== "RBD") return;
    const existing = new Set([...state.ast.blocks.map((b) => b.name), ...state.ast.groups.map((g) => g.name)]);
    const prefix = kind === "kooN" ? "KofN_" : kind === "parallel" ? "Par_" : "Ser_";
    const name = uniqueName(prefix, existing);
    const grp = { name, kind, k: kind === "kooN" ? "2" : "", children: [] };
    const parent = getTargetRbdGroup();
    state.ast.groups.push(grp);
    if (parent && parent.name !== name) parent.children.push(name);
    else if (!state.ast.top) state.ast.top = name;
    state.selected = { type: "rbdGroup", id: name };
    syncVisualToMry(`Grupo ${kind} '${name}' criado`);
    fitView();
  }

  function deleteRbdElement(kind, name) {
    if (kind === "block") {
      state.ast.blocks = state.ast.blocks.filter((b) => b.name !== name);
    } else {
      state.ast.groups = state.ast.groups.filter((g) => g.name !== name);
    }
    for (const g of state.ast.groups) {
      g.children = g.children.filter((ch) => ch !== name);
    }
    if (state.ast.top === name) {
      state.ast.top = state.ast.groups[state.ast.groups.length - 1]?.name || state.ast.blocks[0]?.name || "";
    }
    state.selected = null;
    syncVisualToMry(`Elemento RBD '${name}' removido`);
    fitView();
  }

  // =========================================================================
  // RIGHT PANEL RENDERING (4 TABS)
  // =========================================================================
  function updateTabButtons() {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      const isAct = b.dataset.tab === state.activeTab;
      b.classList.toggle("active", isAct);
      b.setAttribute("aria-selected", String(isAct));
    });
  }

  function renderRightPanel() {
    if (!state.ast || !state.audit) return;
    if (state.activeTab === "inspector") renderInspectorTab();
    else if (state.activeTab === "manifest") renderManifestTab();
    else if (state.activeTab === "params") renderParamsTab();
    else if (state.activeTab === "audit") renderAuditTab();
  }

  function renderSimInspectorTab() {
    const ast = state.ast;
    const marking = state.simMarking || {};
    const initMarking = state.simInitMarking || {};
    const en = Core.getEnabledTransitions(ast, marking, state.simRespectImm);
    const fireableList = ast.transitions.filter((t) => en.fireable.has(t.name));
    const invariants = Core.detectConservationInvariants(ast, initMarking, marking);

    const activePlaces = ast.places.filter((p) => (marking[p.name] ?? 0) > 0);
    const zeroPlaces = ast.places.filter((p) => (marking[p.name] ?? 0) === 0);
    const traceRecent = [...state.simHistory].reverse().slice(0, 25);

    dom.tabBody.innerHTML = `
      <div class="section-card">
        <div class="section-title">
          <span>🎮 Token Game — Habilitadas (${fireableList.length})</span>
          <button class="btn sm sim-primary" id="btnInspSimRand" ${fireableList.length === 0 ? "disabled" : ""}>🎲 Passo</button>
        </div>
        ${state.simLastReason ? `<div class="warn-item warn" style="cursor:default;">⛔ ${escapeXml(state.simLastReason)}</div>` : ""}
        ${en.immPreempting ? `<div style="font-size:10.5px;color:#fbbf24;margin-bottom:6px;">⚡ Transição imediata prioritária ativa (temporizadas pausadas).</div>` : ""}
        ${
          fireableList.length === 0
            ? `<div class="warn-item error" style="cursor:default;"><strong>⛔ DEADLOCK:</strong> Nenhuma transição está habilitada nesta marcação! Use <em>Voltar</em> ou <em>M₀</em>.</div>`
            : fireableList
                .map((tr) => {
                  const badge = tr.kind === "immediate" ? "IMM" : tr.delayType === "Deterministic" ? "DET" : "EXP";
                  return `
                    <div class="fireable-item" data-sim-fire="${escapeXml(tr.name)}">
                      <span style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        <span class="pill ${tr.kind === "immediate" ? "prio" : tr.delayType === "Deterministic" ? "det" : "srv"}">${badge}</span>
                        <strong>${escapeXml(tr.name)}</strong>
                      </span>
                      <span style="color:#34d399;font-weight:800;font-size:11px;flex-shrink:0;">▶ Disparar</span>
                    </div>
                  `;
                })
                .join("")
        }
      </div>

      <div class="section-card">
        <div class="section-title">Invariantes de Conservação</div>
        ${invariants
          .map(
            (inv) => `
          <div class="inv-row ${inv.infoOnly ? "info" : inv.ok ? "ok" : "fail"}">
            <div style="min-width:0;">
              <div style="font-weight:700;color:#f8fafc;">${escapeXml(inv.label)}</div>
              <div style="font-family:var(--font-mono);font-size:9.8px;color:#94a3b8;word-break:break-all;">${escapeXml(inv.expr)}</div>
            </div>
            <div style="font-family:var(--font-mono);font-weight:800;white-space:nowrap;color:${inv.infoOnly ? "#38bdf8" : inv.ok ? "#4ade80" : "#f87171"};">
              ${inv.current}${inv.infoOnly ? "" : `/${inv.expected} ${inv.ok ? "✓" : "✗"}`}
            </div>
          </div>`
          )
          .join("")}
      </div>

      <div class="section-card">
        <div class="section-title">
          <span>Marcação Atual (${activePlaces.length} com tokens)</span>
          <button class="btn sm" id="btnInspSimReset">↺ M₀</button>
        </div>
        ${[...activePlaces, ...zeroPlaces]
          .map((pl) => {
            const val = marking[pl.name] ?? 0;
            const d = state.simLastDeltas[pl.name] || 0;
            return `
              <div class="sim-mark-row">
                <span style="font-family:var(--font-mono);color:${val > 0 ? "#f8fafc" : "#64748b"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${escapeXml(pl.name)} ${d !== 0 ? `<strong style="color:${d > 0 ? "#4ade80" : "#f87171"}">(${d > 0 ? "+" : ""}${d})</strong>` : ""}
                </span>
                <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                  <button class="btn sm" data-tok-dec="${escapeXml(pl.name)}" style="padding:1px 6px;" ${val <= 0 ? "disabled" : ""}>−</button>
                  <strong style="font-family:var(--font-mono);min-width:22px;text-align:center;color:${val > 0 ? "#34d399" : "#64748b"};">${val}</strong>
                  <button class="btn sm" data-tok-inc="${escapeXml(pl.name)}" style="padding:1px 6px;">+</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <div class="section-card">
        <div class="section-title">Histórico de Disparos (${state.simHistory.length})</div>
        ${
          traceRecent.length === 0
            ? `<div class="muted-empty">Nenhum disparo ainda. Clique em uma transição verde no diagrama ou acima.</div>`
            : traceRecent
                .map(
                  (h, idx) => `
              <div class="sim-trace-row">
                <span style="color:#34d399;font-weight:700;">#${state.simHistory.length - idx}</span>
                <strong style="color:#f8fafc;">${escapeXml(h.trName)}</strong>
                <div style="color:#94a3b8;">${escapeXml(h.deltas.join(", ") || "sem delta")}</div>
              </div>`
                )
                .join("")
        }
      </div>
    `;

    const randBtn = document.getElementById("btnInspSimRand");
    if (randBtn) randBtn.addEventListener("click", () => stepSimRandom(1));
    const rstBtn = document.getElementById("btnInspSimReset");
    if (rstBtn) rstBtn.addEventListener("click", resetSimMarking);
    dom.tabBody.querySelectorAll("[data-sim-fire]").forEach((el) => {
      el.addEventListener("click", () => stepSimFire(el.dataset.simFire, false));
      el.addEventListener("mouseenter", () => {
        state.codeSyncNodes = [`T:${el.dataset.simFire}`];
        renderCodeSyncOverlay();
      });
      el.addEventListener("mouseleave", () => {
        state.codeSyncNodes = [];
        renderCodeSyncOverlay();
      });
    });
    dom.tabBody.querySelectorAll("[data-tok-dec]").forEach((b) => {
      b.addEventListener("click", () => adjustSimToken(b.dataset.tokDec, -1));
    });
    dom.tabBody.querySelectorAll("[data-tok-inc]").forEach((b) => {
      b.addEventListener("click", () => adjustSimToken(b.dataset.tokInc, 1));
    });
  }

  function renderInspectorTab() {
    if (state.ast && state.ast.modelType === "RBD") {
      return renderRbdInspectorTab();
    }
    if (state.simMode && state.ast && state.ast.modelType === "SPN") {
      return renderSimInspectorTab();
    }

    if (state.multiSelected.length >= 2) {
      const pCount = state.multiSelected.filter((id) => id.startsWith("P:")).length;
      const tCount = state.multiSelected.filter((id) => id.startsWith("T:")).length;
      dom.tabBody.innerHTML = `
        <div class="section-card">
          <div class="section-title">
            <span>Seleção Múltipla (${state.multiSelected.length} itens)</span>
            <button class="btn sm danger" id="btnMultiDel">Apagar Todos</button>
          </div>
          <div style="font-size:11.5px;color:#94a3b8;margin-bottom:8px;">
            ${pCount} Lugar(es) • ${tCount} Transição(ões)
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            <button class="btn sm primary" id="btnMultiClone" title="Duplica todos os itens selecionados preservando arcos internos">Duplicar Bloco (+ Arcos)</button>
            <button class="btn sm" id="btnMultiClear">Limpar Seleção</button>
          </div>
        </div>

        <div class="section-card">
          <div class="section-title">Alinhar e Distribuir</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:6px;">
            <button class="btn sm" data-align="left">⫷ Esq.</button>
            <button class="btn sm" data-align="centerX">⫶ Centro H</button>
            <button class="btn sm" data-align="right">⫸ Dir.</button>
            <button class="btn sm" data-align="top">⊤ Topo</button>
            <button class="btn sm" data-align="centerY">⋯ Meio V</button>
            <button class="btn sm" data-align="bottom">⊥ Base</button>
          </div>
          ${
            state.multiSelected.length >= 3
              ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
                  <button class="btn sm" id="btnDistX">⬌ Distribuir H</button>
                  <button class="btn sm" id="btnDistY">⬍ Distribuir V</button>
                </div>`
              : ""
          }
        </div>

        <div class="section-card">
          <div class="section-title">Áreas Visuais</div>
          <button class="btn sm primary" id="btnMultiNewZone" style="width:100%;justify-content:center;margin-bottom:7px;">+ Criar Área com Selecionados</button>
          <div style="display:flex;gap:5px;">
            <select id="selMultiZone" style="flex:1;">
              <option value="">(Retirar de qualquer área)</option>
              ${(state.zones || []).map((z) => `<option value="${escapeXml(z.id)}">${escapeXml(z.label)}</option>`).join("")}
            </select>
            <button class="btn sm" id="btnMultiAssignZone">Aplicar</button>
          </div>
        </div>

        <div class="section-card">
          <div class="section-title">Itens Selecionados</div>
          ${state.multiSelected
            .map(
              (id) => `
            <div class="arc-item" style="display:flex;align-items:center;justify-content:space-between;gap:5px;">
              <span style="font-size:11.5px;">
                <span class="pill ${id.startsWith("P:") ? "cond" : "prio"}">${id.startsWith("P:") ? "L" : "T"}</span>
                <strong>${escapeXml(id.slice(2))}</strong>
              </span>
              <button class="btn sm" data-multi-rm="${escapeXml(id)}" title="Remover da seleção">×</button>
            </div>`
            )
            .join("")}
        </div>
      `;

      document.getElementById("btnMultiDel").addEventListener("click", () => deleteMultiSelection([...state.multiSelected]));
      document.getElementById("btnMultiClone").addEventListener("click", () => {
        const cloned = cloneMultiSelection([...state.multiSelected], 40, 40);
        if (cloned.length > 0) {
          state.multiSelected = cloned;
          renderCanvas();
          renderRightPanel();
        }
      });
      document.getElementById("btnMultiClear").addEventListener("click", () => {
        state.multiSelected = [];
        updateModeToolbars();
        renderCanvas();
        renderRightPanel();
      });
      dom.tabBody.querySelectorAll("[data-align]").forEach((b) => {
        b.addEventListener("click", () => alignSelection(b.dataset.align));
      });
      const dxBtn = document.getElementById("btnDistX");
      if (dxBtn) dxBtn.addEventListener("click", () => distributeSelection("x"));
      const dyBtn = document.getElementById("btnDistY");
      if (dyBtn) dyBtn.addEventListener("click", () => distributeSelection("y"));
      document.getElementById("btnMultiNewZone").addEventListener("click", () => createZoneFromSelection([...state.multiSelected]));
      document.getElementById("btnMultiAssignZone").addEventListener("click", () => {
        const zid = document.getElementById("selMultiZone").value;
        setMultiNodesZone([...state.multiSelected], zid);
      });
      dom.tabBody.querySelectorAll("[data-multi-rm]").forEach((b) => {
        b.addEventListener("click", () => {
          state.multiSelected = state.multiSelected.filter((id) => id !== b.dataset.multiRm);
          updateModeToolbars();
          renderCanvas();
          renderRightPanel();
        });
      });
      return;
    }

    const sel = state.selected;
    if (!sel) {
      dom.tabBody.innerHTML = `
        <div class="section-card">
          <div class="section-title">Modelo: ${escapeXml(state.ast.modelName)}</div>
          <div class="field">
            <label>Nome do modelo SPN</label>
            <input type="text" id="inpModelName" value="${escapeXml(state.ast.modelName)}" />
          </div>
          <p class="muted-empty">
            Clique em qualquer <strong>Lugar</strong>, <strong>Transição</strong>, <strong>Arco</strong> ou <strong>Título de Área</strong> no diagrama para editar todas as suas propriedades.
          </p>
        </div>

        <div class="section-card">
          <div class="section-title">
            <span>Áreas Visuais (${(state.zones || []).length})</span>
            <button class="btn sm" id="btnInspNewZone">+ Nova Área</button>
          </div>
          ${
            (state.zones || []).length === 0
              ? `<div class="muted-empty">Nenhuma área criada.</div>`
              : (state.zones || [])
                  .map(
                    (z) => `
                <div class="manifest-item" data-open-zone="${escapeXml(z.id)}" style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                  <div style="display:flex;align-items:center;gap:6px;min-width:0;">
                    <span style="width:10px;height:10px;border-radius:3px;background:${escapeXml(z.color || "#0284c7")};flex-shrink:0;"></span>
                    <strong style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeXml(z.label)}</strong>
                  </div>
                  <span style="font-size:10.5px;color:#94a3b8;">${(z.members || []).length} itens</span>
                </div>`
                  )
                  .join("")
          }
          <button class="btn sm" id="btnResetZones" style="margin-top:4px;width:100%;justify-content:center;">Restaurar Áreas Padrão</button>
        </div>
      `;
      document.getElementById("inpModelName").addEventListener("change", (e) => {
        const v = e.target.value.trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
          state.ast.modelName = v;
          syncVisualToMry("Nome do modelo atualizado");
        }
      });
      document.getElementById("btnInspNewZone").addEventListener("click", addZone);
      document.getElementById("btnResetZones").addEventListener("click", () => {
        state.zones = Core.computeDefaultZones(state.ast);
        refreshBranchChips();
        renderCanvas();
        renderRightPanel();
        commitHistory();
      });
      dom.tabBody.querySelectorAll("[data-open-zone]").forEach((el) => {
        el.addEventListener("click", () => {
          state.selected = { type: "zone", id: el.dataset.openZone };
          renderCanvas();
          renderRightPanel();
        });
      });
      return;
    }

    if (sel.type === "zone") {
      const z = (state.zones || []).find((x) => x.id === sel.id);
      if (!z) return;
      const allNodeIds = [
        ...state.ast.places.map((p) => ({ id: `P:${p.name}`, label: `[Lugar] ${p.name}` })),
        ...state.ast.transitions.map((t) => ({ id: `T:${t.name}`, label: `[Trans.] ${t.name}` }))
      ];
      const memberSet = new Set(z.members || []);
      const addable = allNodeIds.filter((n) => !memberSet.has(n.id));
      const palette = [
        { hex: "#0284c7", name: "Azul" },
        { hex: "#6366f1", name: "Índigo" },
        { hex: "#10b981", name: "Verde" },
        { hex: "#f59e0b", name: "Âmbar" },
        { hex: "#ef4444", name: "Vermelho" },
        { hex: "#64748b", name: "Cinza" }
      ];

      dom.tabBody.innerHTML = `
        <div class="section-card">
          <div class="section-title">
            <span>Área Visual (Grupo)</span>
            <button class="btn sm danger" id="btnDelZone">Apagar Área</button>
          </div>
          <div class="field">
            <label>Título da Área</label>
            <input type="text" id="inpZoneLabel" value="${escapeXml(z.label)}" />
          </div>
          <div class="field">
            <label>Cor da Área</label>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              ${palette
                .map(
                  (c) =>
                    `<button type="button" data-zcolor="${c.hex}" title="${c.name}" style="width:22px;height:22px;border-radius:5px;background:${c.hex};border:${z.color === c.hex ? "2px solid #fff" : "1px solid #334155"};cursor:pointer;"></button>`
                )
                .join("")}
            </div>
          </div>
          <div style="font-size:11px;color:#94a3b8;line-height:1.4;">
            Dica: arraste o <strong>título da área (⋮⋮)</strong> no canvas para mover todos os elementos dela juntos. Apagar a área não remove os lugares/transições do <code>.mry</code>.
          </div>
        </div>

        <div class="section-card">
          <div class="section-title">Elementos nesta Área (${(z.members || []).length})</div>
          ${
            (z.members || []).length === 0
              ? `<div style="color:#64748b;font-size:11px;margin-bottom:6px;">Nenhum elemento nesta área.</div>`
              : (z.members || [])
                  .map(
                    (mId) => `
                <div class="arc-item" style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                  <span style="font-size:11.5px;cursor:pointer;" data-jump-node="${escapeXml(mId)}">
                    <span class="pill ${mId.startsWith("P:") ? "cond" : "prio"}">${mId.startsWith("P:") ? "L" : "T"}</span>
                    <strong>${escapeXml(mId.slice(2))}</strong>
                  </span>
                  <button class="btn sm danger" data-zone-rm="${escapeXml(mId)}" title="Tirar desta área">Tirar ×</button>
                </div>`
                  )
                  .join("")
          }
          ${
            addable.length > 0
              ? `<div style="display:flex;gap:5px;margin-top:8px;">
                  <select id="selZoneAdd" style="flex:1;">
                    ${addable.map((n) => `<option value="${escapeXml(n.id)}">${escapeXml(n.label)}</option>`).join("")}
                  </select>
                  <button class="btn sm primary" id="btnZoneAdd">+ Incluir</button>
                </div>`
              : ""
          }
        </div>
      `;

      document.getElementById("inpZoneLabel").addEventListener("input", (e) => {
        z.label = e.target.value;
        refreshBranchChips();
        renderCanvas();
      });
      document.getElementById("inpZoneLabel").addEventListener("change", () => commitHistory());
      document.getElementById("btnDelZone").addEventListener("click", () => deleteZone(z.id));
      dom.tabBody.querySelectorAll("[data-zcolor]").forEach((btn) => {
        btn.addEventListener("click", () => {
          z.color = btn.dataset.zcolor;
          renderCanvas();
          renderRightPanel();
          commitHistory();
        });
      });
      dom.tabBody.querySelectorAll("[data-zone-rm]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const mId = btn.dataset.zoneRm;
          z.members = (z.members || []).filter((id) => id !== mId);
          refreshBranchChips();
          renderCanvas();
          renderRightPanel();
          commitHistory();
        });
      });
      dom.tabBody.querySelectorAll("[data-jump-node]").forEach((el) => {
        el.addEventListener("click", () => {
          focusNodeById(el.dataset.jumpNode);
          renderRightPanel();
        });
      });
      const addBtn = document.getElementById("btnZoneAdd");
      if (addBtn) {
        addBtn.addEventListener("click", () => {
          const val = document.getElementById("selZoneAdd").value;
          if (val) setNodeZone(val, z.id);
        });
      }
      return;
    }

    if (sel.type === "place") {
      const pl = state.ast.places.find((p) => p.name === sel.id);
      if (!pl) return;
      const res = Core.resolveValue(pl.tokens, state.audit.paramMap);
      const curZoneId = getNodeZoneId(`P:${pl.name}`);
      dom.tabBody.innerHTML = `
        <div class="section-card">
          <div class="section-title">
            <span>Lugar (Place)</span>
            <button class="btn sm danger" id="btnDelSelected">Remover</button>
          </div>
          <div class="field">
            <label>Nome do Lugar</label>
            <input type="text" id="inpPlaceName" value="${escapeXml(pl.name)}" />
          </div>
          <div class="field">
            <label>Marcação Inicial (tokens — número ou parâmetro)</label>
            <input type="text" id="inpPlaceTokens" value="${escapeXml(pl.tokens)}" />
            ${res !== null && String(res) !== String(pl.tokens) ? `<div style="font-size:11px;color:#38bdf8;margin-top:3px;">Valor resolvido: <strong>${res}</strong></div>` : ""}
          </div>
          <div class="field">
            <label>Área Visual (tirar ou mover de área)</label>
            <select id="inpPlaceZone">
              <option value="" ${!curZoneId ? "selected" : ""}>(Nenhuma área / livre)</option>
              ${(state.zones || []).map((z) => `<option value="${escapeXml(z.id)}" ${z.id === curZoneId ? "selected" : ""}>${escapeXml(z.label)}</option>`).join("")}
            </select>
          </div>
        </div>
      `;
      document.getElementById("inpPlaceName").addEventListener("change", (e) => renamePlace(pl.name, e.target.value));
      document.getElementById("inpPlaceTokens").addEventListener("change", (e) => {
        const val = e.target.value.trim() || "0";
        pl.tokens = val;
        pl.hasExplicitTokens = val !== "0";
        syncVisualToMry(`Tokens de '${pl.name}' atualizados`);
      });
      document.getElementById("inpPlaceZone").addEventListener("change", (e) => {
        setNodeZone(`P:${pl.name}`, e.target.value);
      });
      document.getElementById("btnDelSelected").addEventListener("click", () => deleteNode("P", pl.name));
      return;
    }

    if (sel.type === "transition") {
      const tr = state.ast.transitions.find((t) => t.name === sel.id);
      if (!tr) return;
      const resD = tr.kind === "timed" ? Core.resolveValue(tr.delayExpr, state.audit.paramMap) : null;

      const renderArcEditorList = (list, dir, title) => {
        const placeOpts = state.ast.places.map((p) => `<option value="${escapeXml(p.name)}">${escapeXml(p.name)}</option>`).join("");
        return `
          <div class="section-card">
            <div class="section-title">
              <span>${title} (${list.length})</span>
              <button class="btn sm" data-add-arc="${dir}">+ Adicionar</button>
            </div>
            ${list.length === 0 ? `<div style="color:#64748b;font-size:11px;">Nenhum arco.</div>` : ""}
            ${list
              .map(
                (a, idx) => `
              <div class="arc-item">
                <div class="arc-item-head">
                  <select data-arc-place="${dir}:${idx}" style="flex:1;">
                    ${state.ast.places.map((p) => `<option value="${escapeXml(p.name)}" ${p.name === a.place ? "selected" : ""}>${escapeXml(p.name)}</option>`).join("")}
                  </select>
                  <button class="btn sm danger" data-arc-del="${dir}:${idx}" title="Remover arco">×</button>
                </div>
                <input type="text" data-arc-mult="${dir}:${idx}" value="${escapeXml(a.multiplicity || "1")}" placeholder='Peso: 1, 2 ou IF(#P>0):(1)ELSE(0)' />
              </div>`
              )
              .join("")}
            <select id="hiddenOpts_${dir}" style="display:none">${placeOpts}</select>
          </div>
        `;
      };

      dom.tabBody.innerHTML = `
        <div class="section-card">
          <div class="section-title">
            <span>Transição (${tr.kind === "immediate" ? "Imediata" : "Temporizada"})</span>
            <button class="btn sm danger" id="btnDelSelected">Remover</button>
          </div>
          <div class="field">
            <label>Nome da Transição</label>
            <input type="text" id="inpTrName" value="${escapeXml(tr.name)}" />
          </div>
          <div class="field-row">
            <div class="field">
              <label>Classe</label>
              <select id="inpTrKind">
                <option value="timed" ${tr.kind === "timed" ? "selected" : ""}>timedTransition</option>
                <option value="immediate" ${tr.kind === "immediate" ? "selected" : ""}>immediateTransition</option>
              </select>
            </div>
            ${
              tr.kind === "timed"
                ? `<div class="field">
                    <label>Distribuição</label>
                    <select id="inpDelayType">
                      <option value="Exponential" ${tr.delayType === "Exponential" ? "selected" : ""}>Exponential</option>
                      <option value="Deterministic" ${tr.delayType === "Deterministic" ? "selected" : ""}>Deterministic</option>
                      <option value="Uniform" ${tr.delayType === "Uniform" ? "selected" : ""}>Uniform</option>
                      <option value="Normal" ${tr.delayType === "Normal" ? "selected" : ""}>Normal</option>
                      <option value="Weibull" ${tr.delayType === "Weibull" ? "selected" : ""}>Weibull</option>
                      <option value="Erlang" ${tr.delayType === "Erlang" ? "selected" : ""}>Erlang</option>
                    </select>
                  </div>`
                : `<div class="field"><label>Tipo</label><input type="text" disabled value="Disparo imediato (t=0)" /></div>`
            }
          </div>
          ${
            tr.kind === "timed"
              ? `<div class="field-row">
                  <div class="field">
                    <label>${tr.delayType === "Deterministic" ? "Value (Determinístico)" : "Delay / Média"}</label>
                    <input type="text" id="inpDelayExpr" value="${escapeXml(tr.delayExpr)}" />
                    ${resD !== null && String(resD) !== tr.delayExpr ? `<div style="font-size:10.5px;color:#38bdf8;margin-top:2px;">= ${resD}</div>` : ""}
                  </div>
                  <div class="field">
                    <label>serverType</label>
                    <select id="inpServerType">
                      <option value="" ${!tr.serverType ? "selected" : ""}>(padrão: SingleServer)</option>
                      <option value="SingleServer" ${tr.serverType === "SingleServer" ? "selected" : ""}>SingleServer</option>
                      <option value="InfiniteServer" ${tr.serverType === "InfiniteServer" ? "selected" : ""}>InfiniteServer</option>
                    </select>
                  </div>
                </div>`
              : ""
          }
          <div class="field">
            <label>Guard / Enabling Function (ex.: <code>(#P1=1)AND(#P2=0)</code>)</label>
            <input type="text" id="inpGuard" value="${escapeXml(tr.guard || "")}" placeholder="Nenhuma guarda declarada" style="font-family:var(--font-mono)" />
          </div>
          <div class="field-row">
            <div class="field">
              <label>Priority</label>
              <input type="text" id="inpPriority" value="${escapeXml(tr.priority)}" placeholder="ex.: 1" />
            </div>
            <div class="field">
              <label>Weight</label>
              <input type="text" id="inpWeight" value="${escapeXml(tr.weight)}" placeholder="ex.: 1.0" />
            </div>
          </div>
          <div class="field">
            <label>Área Visual (tirar ou mover de área)</label>
            <select id="inpTrZone">
              <option value="" ${!getNodeZoneId(`T:${tr.name}`) ? "selected" : ""}>(Nenhuma área / livre)</option>
              ${(state.zones || []).map((z) => `<option value="${escapeXml(z.id)}" ${z.id === getNodeZoneId(`T:${tr.name}`) ? "selected" : ""}>${escapeXml(z.label)}</option>`).join("")}
            </select>
          </div>
        </div>
        ${renderArcEditorList(tr.inputs, "in", "Arcos de Entrada (inputs)")}
        ${renderArcEditorList(tr.outputs, "out", "Arcos de Saída (outputs)")}
        ${renderArcEditorList(tr.inhibitors, "inh", "Arcos Inibidores (inhibitors)")}
      `;

      document.getElementById("inpTrName").addEventListener("change", (e) => renameTransition(tr.name, e.target.value));
      document.getElementById("btnDelSelected").addEventListener("click", () => deleteNode("T", tr.name));
      document.getElementById("inpTrKind").addEventListener("change", (e) => {
        tr.kind = e.target.value;
        if (tr.kind === "timed") {
          tr.delayType = tr.delayType === "Immediate" ? "Exponential" : tr.delayType;
          tr.delayExpr = tr.delayExpr || "1.0";
        } else {
          tr.delayType = "Immediate";
        }
        syncVisualToMry(`Classe de '${tr.name}' alterada`);
      });

      if (tr.kind === "timed") {
        document.getElementById("inpDelayType").addEventListener("change", (e) => {
          tr.delayType = e.target.value;
          if (tr.delayType !== "Exponential") {
            tr.delayParams = [{ key: "Value", value: tr.delayExpr || "1.0" }];
          }
          syncVisualToMry(`Distribuição de '${tr.name}' atualizada`);
        });
        document.getElementById("inpDelayExpr").addEventListener("change", (e) => {
          tr.delayExpr = e.target.value.trim() || "1.0";
          if (tr.delayType !== "Exponential") {
            if (!tr.delayParams || tr.delayParams.length === 0) tr.delayParams = [{ key: "Value", value: tr.delayExpr }];
            else tr.delayParams[0].value = tr.delayExpr;
          }
          syncVisualToMry(`Delay de '${tr.name}' atualizado`);
        });
        document.getElementById("inpServerType").addEventListener("change", (e) => {
          tr.serverType = e.target.value || null;
          syncVisualToMry(`serverType de '${tr.name}' atualizado`);
        });
      }

      document.getElementById("inpGuard").addEventListener("change", (e) => {
        tr.guard = e.target.value.trim();
        syncVisualToMry(`Guard de '${tr.name}' atualizado`);
      });
      document.getElementById("inpPriority").addEventListener("change", (e) => {
        tr.priority = e.target.value.trim();
        syncVisualToMry(`Priority de '${tr.name}' atualizada`);
      });
      document.getElementById("inpWeight").addEventListener("change", (e) => {
        tr.weight = e.target.value.trim();
        syncVisualToMry(`Weight de '${tr.name}' atualizado`);
      });
      document.getElementById("inpTrZone").addEventListener("change", (e) => {
        setNodeZone(`T:${tr.name}`, e.target.value);
      });

      // Arc list handlers
      dom.tabBody.querySelectorAll("[data-add-arc]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (state.ast.places.length === 0) return;
          const dir = btn.dataset.addArc;
          const arr = dir === "in" ? tr.inputs : dir === "out" ? tr.outputs : tr.inhibitors;
          arr.push({ place: state.ast.places[0].name, multiplicity: "1", isStringExpr: false, isConditional: false, isNumeric: true });
          syncVisualToMry(`Arco adicionado em '${tr.name}'`);
        });
      });

      dom.tabBody.querySelectorAll("[data-arc-place]").forEach((selEl) => {
        selEl.addEventListener("change", () => {
          const [dir, idxStr] = selEl.dataset.arcPlace.split(":");
          const arr = dir === "in" ? tr.inputs : dir === "out" ? tr.outputs : tr.inhibitors;
          arr[Number(idxStr)].place = selEl.value;
          syncVisualToMry(`Destino do arco atualizado em '${tr.name}'`);
        });
      });

      dom.tabBody.querySelectorAll("[data-arc-mult]").forEach((inpEl) => {
        inpEl.addEventListener("change", () => {
          const [dir, idxStr] = inpEl.dataset.arcMult.split(":");
          const arr = dir === "in" ? tr.inputs : dir === "out" ? tr.outputs : tr.inhibitors;
          const v = inpEl.value.trim() || "1";
          const arc = arr[Number(idxStr)];
          arc.multiplicity = v;
          arc.isConditional = /IF\s*\(/i.test(v) || /#[A-Za-z_]/.test(v);
          arc.isStringExpr = arc.isConditional;
          syncVisualToMry(`Multiplicidade atualizada em '${tr.name}'`);
        });
      });

      dom.tabBody.querySelectorAll("[data-arc-del]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [dir, idxStr] = btn.dataset.arcDel.split(":");
          deleteArc(tr.name, dir, Number(idxStr));
          state.selected = { type: "transition", id: tr.name };
          renderRightPanel();
        });
      });
      return;
    }

    if (sel.type === "arc") {
      const tr = state.ast.transitions.find((t) => t.name === sel.trName);
      if (!tr) return;
      const arr = sel.arcDir === "in" ? tr.inputs : sel.arcDir === "out" ? tr.outputs : tr.inhibitors;
      const arc = arr[sel.arcIdx];
      if (!arc) return;

      const dirLabel = sel.arcDir === "in" ? "Entrada (Lugar → Transição)" : sel.arcDir === "out" ? "Saída (Transição → Lugar)" : "Inibidor (Lugar ○→ Transição)";
      const wpKey = `W:${sel.id}`;
      const customWps = Array.isArray(state.positions[wpKey]) ? state.positions[wpKey] : [];

      dom.tabBody.innerHTML = `
        <div class="section-card">
          <div class="section-title">
            <span>Arco: ${dirLabel}</span>
            <button class="btn sm danger" id="btnDelArc">Remover</button>
          </div>
          <div class="field">
            <label>Transição</label>
            <input type="text" disabled value="${escapeXml(tr.name)}" />
          </div>
          <div class="field">
            <label>Lugar Conectado</label>
            <select id="inpArcPlace">
              ${state.ast.places.map((p) => `<option value="${escapeXml(p.name)}" ${p.name === arc.place ? "selected" : ""}>${escapeXml(p.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Tipo do Arco</label>
            <select id="inpArcDir">
              <option value="in" ${sel.arcDir === "in" ? "selected" : ""}>Entrada (input)</option>
              <option value="out" ${sel.arcDir === "out" ? "selected" : ""}>Saída (output)</option>
              <option value="inh" ${sel.arcDir === "inh" ? "selected" : ""}>Inibidor (inhibitor ○)</option>
            </select>
          </div>
          <div class="field">
            <label>Multiplicidade / Expressão Condicional</label>
            <textarea id="inpArcMult" rows="3" style="font-family:var(--font-mono)">${escapeXml(arc.multiplicity || "1")}</textarea>
            <div style="font-size:10.5px;color:#a1a1aa;margin-top:4px;">
              Exemplos: <code>1</code>, <code>2</code>, <code>#InService_T1</code>, <code>IF(#InService_T1>0):(1)ELSE(0)</code>
            </div>
          </div>
          <button class="btn sm" id="btnGoTransition">Abrir Transição '${escapeXml(tr.name)}'</button>
        </div>

        <div class="section-card">
          <div class="section-title">
            <span>Pontos de Inflexão Fixos (${customWps.length})</span>
            <div style="display:flex;gap:4px;">
              <button class="btn sm" id="btnAddMidWaypoint" title="Criar ponto de inflexão fixo no meio deste conector">+ Ponto</button>
              ${customWps.length > 0 ? `<button class="btn sm danger" id="btnClearWaypoints" title="Remover todas as inflexões fixas">↺ Limpar</button>` : ""}
            </div>
          </div>
          <div style="font-size:10.5px;color:#a1a1aa;margin-bottom:6px;">
            Dê <strong>duplo-clique</strong> em qualquer ponto da seta ou arraste os botões <strong>+</strong> no conector para criar dobras fixas. Segure <strong>Shift</strong> ao arrastar para ângulos retos (90°).
          </div>
          ${
            customWps.length === 0
              ? `<div style="font-size:11px;color:#71717a;">Nenhuma inflexão fixa (roteamento automático ativo).</div>`
              : customWps
                  .map(
                    (wp, idx) => `
                  <div class="arc-item" style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                    <span style="font-family:var(--font-mono);font-size:11px;">#${idx + 1}: (${wp.x}, ${wp.y})</span>
                    <button class="btn sm danger" data-rm-wp="${idx}" title="Remover este ponto de inflexão">×</button>
                  </div>`
                  )
                  .join("")
          }
        </div>
      `;

      document.getElementById("inpArcPlace").addEventListener("change", (e) => {
        arc.place = e.target.value;
        syncVisualToMry("Lugar do arco atualizado");
      });
      document.getElementById("inpArcDir").addEventListener("change", (e) => {
        const newDir = e.target.value;
        if (newDir === sel.arcDir) return;
        arr.splice(sel.arcIdx, 1);
        const destArr = newDir === "in" ? tr.inputs : newDir === "out" ? tr.outputs : tr.inhibitors;
        destArr.push(arc);
        const newIdx = destArr.length - 1;
        state.selected = { type: "arc", id: `${tr.name}:${newDir}:${newIdx}`, trName: tr.name, arcDir: newDir, arcIdx: newIdx };
        syncVisualToMry("Tipo do arco atualizado");
      });
      document.getElementById("inpArcMult").addEventListener("change", (e) => {
        const v = e.target.value.trim() || "1";
        arc.multiplicity = v;
        arc.isConditional = /IF\s*\(/i.test(v) || /#[A-Za-z_]/.test(v);
        arc.isStringExpr = arc.isConditional;
        syncVisualToMry("Expressão do arco atualizada");
      });
      document.getElementById("btnDelArc").addEventListener("click", () => deleteArc(sel.trName, sel.arcDir, sel.arcIdx));
      document.getElementById("btnGoTransition").addEventListener("click", () => {
        state.selected = { type: "transition", id: tr.name };
        renderCanvas();
        renderRightPanel();
      });
      const addMidBtn = document.getElementById("btnAddMidWaypoint");
      if (addMidBtn) {
        addMidBtn.addEventListener("click", () => {
          const rendered = (state.lastRenderedArcs || []).find((a) => a.id === sel.id);
          const mx = rendered ? rendered.lx : 300;
          const my = rendered ? rendered.ly : 200;
          insertArcWaypointAt(sel.id, mx, my);
        });
      }
      const clrWpBtn = document.getElementById("btnClearWaypoints");
      if (clrWpBtn) {
        clrWpBtn.addEventListener("click", () => clearArcWaypoints(sel.id));
      }
      dom.tabBody.querySelectorAll("[data-rm-wp]").forEach((b) => {
        b.addEventListener("click", () => removeArcWaypoint(sel.id, Number(b.dataset.rmWp)));
      });
    }
  }

  function renderRbdInspectorTab() {
    const sel = state.selected;
    const ev = state.audit.rbdEval;
    const allTargets = [...state.ast.blocks.map((b) => b.name), ...state.ast.groups.map((g) => g.name)];

    if (!sel || (sel.type !== "rbdBlock" && sel.type !== "rbdGroup")) {
      dom.tabBody.innerHTML = `
        <div class="section-card">
          <div class="section-title">Modelo RBD: ${escapeXml(state.ast.modelName)}</div>
          <div class="field">
            <label>Nome do modelo RBD</label>
            <input type="text" id="inpModelName" value="${escapeXml(state.ast.modelName)}" />
          </div>
          <div class="field">
            <label>Elemento Raiz (<code>top</code>)</label>
            <select id="inpRbdTop">
              ${allTargets.map((n) => `<option value="${escapeXml(n)}" ${n === state.ast.top ? "selected" : ""}>${escapeXml(n)}</option>`).join("")}
            </select>
          </div>
          <p class="muted-empty">
            Clique em qualquer <strong>Bloco</strong> ou <strong>Grupo (Série/Paralelo/k-de-N)</strong> no diagrama para editar <code>MTTF</code>, <code>MTTR</code>, <code>reliability</code>, <code>availability</code>, <code>k</code> e a hierarquia de filhos.
          </p>
        </div>
      `;
      document.getElementById("inpModelName").addEventListener("change", (e) => {
        const v = e.target.value.trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
          state.ast.modelName = v;
          syncVisualToMry("Nome do modelo RBD atualizado");
        }
      });
      document.getElementById("inpRbdTop").addEventListener("change", (e) => {
        state.ast.top = e.target.value;
        syncVisualToMry(`Top alterado para '${state.ast.top}'`);
        fitView();
      });
      return;
    }

    if (sel.type === "rbdBlock") {
      const b = state.ast.blocks.find((x) => x.name === sel.id);
      if (!b) return;
      const bm = ev.blockMetrics[b.name];
      const isSpof = ev.spofs.includes(b.name);
      dom.tabBody.innerHTML = `
        <div class="section-card">
          <div class="section-title">
            <span>Bloco RBD ${isSpof ? '<span class="pill inh">SPOF</span>' : ""}</span>
            <button class="btn sm danger" id="btnDelRbd">Remover</button>
          </div>
          <div class="field">
            <label>Nome do Componente</label>
            <input type="text" id="inpBlkName" value="${escapeXml(b.name)}" />
          </div>
          <div class="field">
            <label>Tipo de Bloco</label>
            <select id="inpBlkKind">
              <option value="block" ${b.kind === "block" ? "selected" : ""}>block (Exponencial: MTTF / MTTR)</option>
              <option value="hierarchy" ${b.kind === "hierarchy" ? "selected" : ""}>hierarchy (Confiabilidade / Disponibilidade fixa)</option>
            </select>
          </div>
          ${
            b.kind === "hierarchy"
              ? `<div class="field-row">
                  <div class="field">
                    <label>reliability (0..1 ou param)</label>
                    <input type="text" id="inpBlkRel" value="${escapeXml(b.reliability || "")}" placeholder="ex.: R_env ou 0.98" />
                  </div>
                  <div class="field">
                    <label>availability (0..1 ou param)</label>
                    <input type="text" id="inpBlkAv" value="${escapeXml(b.availability || "")}" placeholder="ex.: R_env ou 0.98" />
                  </div>
                </div>`
              : `<div class="field-row">
                  <div class="field">
                    <label>MTTF (horas ou param)</label>
                    <input type="text" id="inpBlkMttf" value="${escapeXml(b.mttf || "")}" />
                    ${bm && bm.mttf !== null && String(bm.mttf) !== String(b.mttf) ? `<div style="font-size:10.5px;color:#38bdf8;margin-top:2px;">= ${bm.mttf}</div>` : ""}
                  </div>
                  <div class="field">
                    <label>MTTR (horas ou param)</label>
                    <input type="text" id="inpBlkMttr" value="${escapeXml(b.mttr || "")}" />
                    ${bm && bm.mttr !== null && String(bm.mttr) !== String(b.mttr) ? `<div style="font-size:10.5px;color:#38bdf8;margin-top:2px;">= ${bm.mttr}</div>` : ""}
                  </div>
                </div>`
          }
          <div style="background:#1e293b;border-radius:6px;padding:7px;font-family:var(--font-mono);font-size:11px;margin-top:6px;">
            <div>A = <strong>${(bm.A * 100).toFixed(5)}%</strong></div>
            <div>R(${ev.missionTime}h) = <strong>${(bm.R * 100).toFixed(5)}%</strong></div>
          </div>
        </div>
      `;

      document.getElementById("btnDelRbd").addEventListener("click", () => deleteRbdElement("block", b.name));
      document.getElementById("inpBlkName").addEventListener("change", (e) => {
        if (renameRbdSymbol(b.name, e.target.value)) {
          state.selected = { type: "rbdBlock", id: e.target.value.trim() };
          syncVisualToMry("Bloco RBD renomeado");
        }
      });
      document.getElementById("inpBlkKind").addEventListener("change", (e) => {
        b.kind = e.target.value;
        if (b.kind === "hierarchy") {
          b.reliability = b.reliability || "0.99";
          b.availability = b.availability || "0.99";
        } else {
          b.mttf = b.mttf || "8760.0";
          b.mttr = b.mttr || "1.0";
        }
        syncVisualToMry(`Tipo de '${b.name}' alterado para ${b.kind}`);
      });
      if (b.kind === "hierarchy") {
        document.getElementById("inpBlkRel").addEventListener("change", (e) => {
          b.reliability = e.target.value.trim();
          syncVisualToMry(`Reliability de '${b.name}' atualizada`);
        });
        document.getElementById("inpBlkAv").addEventListener("change", (e) => {
          b.availability = e.target.value.trim();
          syncVisualToMry(`Availability de '${b.name}' atualizada`);
        });
      } else {
        document.getElementById("inpBlkMttf").addEventListener("change", (e) => {
          b.mttf = e.target.value.trim();
          syncVisualToMry(`MTTF de '${b.name}' atualizado`);
        });
        document.getElementById("inpBlkMttr").addEventListener("change", (e) => {
          b.mttr = e.target.value.trim();
          syncVisualToMry(`MTTR de '${b.name}' atualizado`);
        });
      }
      return;
    }

    if (sel.type === "rbdGroup") {
      const g = state.ast.groups.find((x) => x.name === sel.id);
      if (!g) return;
      const gm = ev.groupMetrics[g.name] || { A: 0, R: 0 };
      const addable = allTargets.filter((n) => n !== g.name);

      dom.tabBody.innerHTML = `
        <div class="section-card">
          <div class="section-title">
            <span>Grupo RBD (${g.kind})</span>
            <button class="btn sm danger" id="btnDelRbd">Remover</button>
          </div>
          <div class="field">
            <label>Nome do Grupo</label>
            <input type="text" id="inpGrpName" value="${escapeXml(g.name)}" />
          </div>
          <div class="field-row">
            <div class="field">
              <label>Arranjo Estrutural</label>
              <select id="inpGrpKind">
                <option value="series" ${g.kind === "series" ? "selected" : ""}>series (Série)</option>
                <option value="parallel" ${g.kind === "parallel" ? "selected" : ""}>parallel (Paralelo 1-de-N)</option>
                <option value="kooN" ${g.kind === "kooN" ? "selected" : ""}>kooN (k-de-N)</option>
              </select>
            </div>
            <div class="field">
              <label>${g.kind === "kooN" ? "Mínimo k (k-de-N)" : "Papel"}</label>
              ${
                g.kind === "kooN"
                  ? `<input type="text" id="inpGrpK" value="${escapeXml(g.k || "1")}" />`
                  : `<input type="text" disabled value="${g.kind === "series" ? "Todos (N-de-N)" : "Pelo menos 1"}" />`
              }
            </div>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px;">
            <button class="btn sm ${state.ast.top === g.name ? "primary" : ""}" id="btnSetTop">
              ${state.ast.top === g.name ? "✓ É o elemento top" : "Definir como top"}
            </button>
          </div>
          <div style="background:#1e293b;border-radius:6px;padding:7px;font-family:var(--font-mono);font-size:11px;">
            <div>A_grupo = <strong>${(gm.A * 100).toFixed(5)}%</strong></div>
            <div>R_grupo(${ev.missionTime}h) = <strong>${(gm.R * 100).toFixed(5)}%</strong></div>
          </div>
        </div>

        <div class="section-card">
          <div class="section-title">Filhos do Grupo (${g.children.length})</div>
          ${g.children
            .map(
              (ch, idx) => `
            <div class="arc-item" style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
              <strong style="font-size:11.5px;flex:1;">${escapeXml(ch)}</strong>
              <button class="btn sm" data-ch-up="${idx}" ${idx === 0 ? "disabled" : ""}>↑</button>
              <button class="btn sm" data-ch-dn="${idx}" ${idx === g.children.length - 1 ? "disabled" : ""}>↓</button>
              <button class="btn sm danger" data-ch-del="${idx}">×</button>
            </div>`
            )
            .join("")}
          <div style="display:flex;gap:5px;margin-top:8px;">
            <select id="selAddChild" style="flex:1;">
              ${addable.map((n) => `<option value="${escapeXml(n)}">${escapeXml(n)}</option>`).join("")}
            </select>
            <button class="btn sm primary" id="btnAddChild">+ Filho</button>
          </div>
        </div>
      `;

      document.getElementById("btnDelRbd").addEventListener("click", () => deleteRbdElement("group", g.name));
      document.getElementById("inpGrpName").addEventListener("change", (e) => {
        if (renameRbdSymbol(g.name, e.target.value)) {
          state.selected = { type: "rbdGroup", id: e.target.value.trim() };
          syncVisualToMry("Grupo RBD renomeado");
        }
      });
      document.getElementById("inpGrpKind").addEventListener("change", (e) => {
        g.kind = e.target.value;
        if (g.kind === "kooN" && !g.k) g.k = "2";
        syncVisualToMry(`Arranjo de '${g.name}' alterado para ${g.kind}`);
        fitView();
      });
      const kInp = document.getElementById("inpGrpK");
      if (kInp) {
        kInp.addEventListener("change", (e) => {
          g.k = e.target.value.trim() || "1";
          syncVisualToMry(`k de '${g.name}' atualizado para ${g.k}`);
        });
      }
      document.getElementById("btnSetTop").addEventListener("click", () => {
        state.ast.top = g.name;
        syncVisualToMry(`'${g.name}' definido como top`);
        fitView();
      });
      document.getElementById("btnAddChild").addEventListener("click", () => {
        const val = document.getElementById("selAddChild").value;
        if (val) {
          g.children.push(val);
          syncVisualToMry(`'${val}' adicionado em '${g.name}'`);
          fitView();
        }
      });
      dom.tabBody.querySelectorAll("[data-ch-up]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = Number(btn.dataset.chUp);
          if (i > 0) {
            [g.children[i - 1], g.children[i]] = [g.children[i], g.children[i - 1]];
            syncVisualToMry("Ordem atualizada");
          }
        });
      });
      dom.tabBody.querySelectorAll("[data-ch-dn]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = Number(btn.dataset.chDn);
          if (i < g.children.length - 1) {
            [g.children[i + 1], g.children[i]] = [g.children[i], g.children[i + 1]];
            syncVisualToMry("Ordem atualizada");
          }
        });
      });
      dom.tabBody.querySelectorAll("[data-ch-del]").forEach((btn) => {
        btn.addEventListener("click", () => {
          g.children.splice(Number(btn.dataset.chDel), 1);
          syncVisualToMry("Filho removido do grupo");
          fitView();
        });
      });
    }
  }

  function renderManifestTab() {
    const items = state.audit.hiddenItems;
    const isRbd = state.ast && state.ast.modelType === "RBD";
    const cats = isRbd
      ? ["ALL", "SPOF", "Bloco Exp.", "Hierárquico", "Série", "Paralelo", "k-de-N"]
      : ["ALL", "Guard", "Peso Condicional", "Inibidor", "Multiplicidade", "Distribuição", "Prioridade/Peso", "ServerType"];
    if (!cats.includes(state.manifestCategory)) state.manifestCategory = "ALL";
    const q = state.manifestSearch.toLowerCase();

    const filtered = items.filter((it) => {
      if (state.manifestCategory !== "ALL" && it.category !== state.manifestCategory) return false;
      if (q && !(`${it.category} ${it.element} ${it.detail}`).toLowerCase().includes(q)) return false;
      return true;
    });

    const pillClass = (cat) => {
      if (cat === "Guard" || cat === "Série") return "guard";
      if (cat === "Peso Condicional" || cat === "Bloco Exp.") return "cond";
      if (cat === "Inibidor" || cat === "SPOF") return "inh";
      if (cat === "Multiplicidade" || cat === "Hierárquico" || cat === "k-de-N") return "mult";
      if (cat === "Distribuição") return "det";
      if (cat === "ServerType" || cat === "Paralelo") return "srv";
      return "prio";
    };

    dom.tabBody.innerHTML = `
      <div class="section-card">
        <div class="section-title">Manifesto "Nada Escondido" (${filtered.length}/${items.length})</div>
        <div class="field">
          <input type="text" id="inpManifestSearch" value="${escapeXml(state.manifestSearch)}" placeholder="Filtrar guards, IF(...), inibidores, serverType..." />
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${cats.map((c) => `<span class="chip ${state.manifestCategory === c ? "active" : ""}" data-mcat="${c}">${c === "ALL" ? "Tudo" : c}</span>`).join("")}
        </div>
      </div>
      ${
        filtered.length === 0
          ? `<div class="muted-empty">Nenhum item encontrado para o filtro atual.</div>`
          : filtered
              .map(
                (it) => `
          <div class="manifest-item" data-focus-node="${escapeXml(it.nodeId || "")}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <strong style="font-size:11.5px;">${escapeXml(it.element)}</strong>
              <span class="pill ${pillClass(it.category)}">${escapeXml(it.category)}</span>
            </div>
            <div class="manifest-detail">${escapeXml(it.detail)}</div>
          </div>`
              )
              .join("")
      }
    `;

    document.getElementById("inpManifestSearch").addEventListener("input", (e) => {
      state.manifestSearch = e.target.value;
      renderManifestTab();
    });
    dom.tabBody.querySelectorAll("[data-mcat]").forEach((el) => {
      el.addEventListener("click", () => {
        state.manifestCategory = el.dataset.mcat;
        renderManifestTab();
      });
    });
    dom.tabBody.querySelectorAll("[data-focus-node]").forEach((el) => {
      el.addEventListener("click", () => {
        const nid = el.dataset.focusNode;
        if (nid) {
          focusNodeById(nid);
          renderRightPanel();
        }
      });
    });
  }

  function renderParamsTab() {
    const params = state.ast.parameters || [];
    const metrics = state.ast.metrics || [];

    dom.tabBody.innerHTML = `
      <div class="section-card">
        <div class="section-title">
          <span>Parâmetros Globais (${params.length})</span>
          <button class="btn sm" id="btnAddParam">+ Parâmetro</button>
        </div>
        ${params.length === 0 ? `<div class="muted-empty">Nenhum parâmetro global declarado.</div>` : ""}
        ${params
          .map(
            (p, idx) => `
          <div class="param-row">
            <input type="text" data-pname="${idx}" value="${escapeXml(p.name)}" />
            <input type="text" data-pval="${idx}" value="${escapeXml(p.value)}" />
            <button class="btn sm danger" data-pdel="${idx}" title="Remover">×</button>
          </div>`
          )
          .join("")}
      </div>

      <div class="section-card">
        <div class="section-title">
          <span>Métricas (${metrics.length})</span>
          <button class="btn sm" id="btnAddMetric">+ Métrica</button>
        </div>
        ${metrics.length === 0 ? `<div class="muted-empty">Nenhuma métrica declarada no bloco SPN.</div>` : ""}
        ${metrics
          .map(
            (m, idx) => `
          <div class="arc-item">
            <div class="arc-item-head">
              <input type="text" data-mname="${idx}" value="${escapeXml(m.name)}" style="flex:1;font-weight:700;" />
              <button class="btn sm danger" data-mdel="${idx}">×</button>
            </div>
            <input type="text" data-mraw="${idx}" value="${escapeXml(m.raw)}" />
          </div>`
          )
          .join("")}
      </div>
    `;

    document.getElementById("btnAddParam").addEventListener("click", () => {
      const existing = new Set(params.map((p) => p.name));
      params.push({ name: uniqueName("param_", existing), value: "1.0" });
      syncVisualToMry("Parâmetro adicionado");
    });
    dom.tabBody.querySelectorAll("[data-pname]").forEach((el) => {
      el.addEventListener("change", () => {
        const v = el.value.trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
          params[Number(el.dataset.pname)].name = v;
          syncVisualToMry("Nome do parâmetro atualizado");
        }
      });
    });
    dom.tabBody.querySelectorAll("[data-pval]").forEach((el) => {
      el.addEventListener("change", () => {
        params[Number(el.dataset.pval)].value = el.value.trim();
        syncVisualToMry("Valor do parâmetro atualizado");
      });
    });
    dom.tabBody.querySelectorAll("[data-pdel]").forEach((el) => {
      el.addEventListener("click", () => {
        params.splice(Number(el.dataset.pdel), 1);
        syncVisualToMry("Parâmetro removido");
      });
    });

    document.getElementById("btnAddMetric").addEventListener("click", () => {
      const existing = new Set(metrics.map((m) => m.name));
      const pName = state.ast.places[0] ? state.ast.places[0].name : "P1";
      metrics.push({
        name: uniqueName("metric_", existing),
        evalType: "stationarySimulation",
        expression: `P{#${pName}>0}`,
        raw: `stationarySimulation(expression="P{#${pName}>0}")`
      });
      syncVisualToMry("Métrica adicionada");
    });
    dom.tabBody.querySelectorAll("[data-mname]").forEach((el) => {
      el.addEventListener("change", () => {
        const v = el.value.trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
          metrics[Number(el.dataset.mname)].name = v;
          syncVisualToMry("Nome da métrica atualizado");
        }
      });
    });
    dom.tabBody.querySelectorAll("[data-mraw]").forEach((el) => {
      el.addEventListener("change", () => {
        metrics[Number(el.dataset.mraw)].raw = el.value.trim();
        syncVisualToMry("Definição da métrica atualizada");
      });
    });
    dom.tabBody.querySelectorAll("[data-mdel]").forEach((el) => {
      el.addEventListener("click", () => {
        metrics.splice(Number(el.dataset.mdel), 1);
        syncVisualToMry("Métrica removida");
      });
    });
  }

  function renderAuditTab() {
    const s = state.audit.stats;
    const warns = state.audit.warnings;

    if (state.ast && state.ast.modelType === "RBD" && state.audit.rbdEval) {
      const ev = state.audit.rbdEval;
      const ninesStr = Number.isFinite(ev.nines) ? ev.nines.toFixed(2) : "∞";

      // Mini SVG Reliability curve R(tau)
      const cw = 290, ch = 110, padL = 32, padR = 10, padT = 10, padB = 22;
      const maxT = ev.curve[ev.curve.length - 1]?.t || 24;
      const minR = Math.max(0, Math.min(...ev.curve.map((p) => p.R)) - 0.02);
      const maxR = 1.0;
      const spanR = Math.max(0.01, maxR - minR);
      const mapX = (tau) => padL + (tau / maxT) * (cw - padL - padR);
      const mapY = (rv) => padT + ((maxR - rv) / spanR) * (ch - padT - padB);
      const ptsStr = ev.curve.map((p) => `${mapX(p.t).toFixed(1)},${mapY(p.R).toFixed(1)}`).join(" ");
      const curX = mapX(ev.missionTime);
      const curY = mapY(ev.sysR);

      dom.tabBody.innerHTML = `
        <div class="stat-grid" style="grid-template-columns:1fr 1fr;">
          <div class="stat-box"><div class="num" style="color:#38bdf8;">${(ev.sysA * 100).toFixed(4)}%</div><div class="lbl">Disponibilidade A (${ninesStr} noves)</div></div>
          <div class="stat-box"><div class="num" style="color:#86efac;">${(ev.sysR * 100).toFixed(4)}%</div><div class="lbl">Confiabilidade R(${ev.missionTime}h)</div></div>
          <div class="stat-box"><div class="num">${ev.downtimeHoursYear.toFixed(2)}h</div><div class="lbl">Downtime / ano</div></div>
          <div class="stat-box"><div class="num" style="color:${ev.spofs.length > 0 ? "#fca5a5" : "#86efac"};">${ev.spofs.length}</div><div class="lbl">SPOFs Críticos</div></div>
        </div>

        <div class="section-card">
          <div class="section-title">Curva de Confiabilidade R(t) — Duração do Evento</div>
          <svg width="100%" viewBox="0 0 ${cw} ${ch}" style="background:#0b1120;border-radius:6px;">
            <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${ch - padB}" stroke="#475569" stroke-width="1" />
            <line x1="${padL}" y1="${ch - padB}" x2="${cw - padR}" y2="${ch - padB}" stroke="#475569" stroke-width="1" />
            <polyline fill="none" stroke="#38bdf8" stroke-width="2" points="${ptsStr}" />
            <circle cx="${curX.toFixed(1)}" cy="${curY.toFixed(1)}" r="4" fill="#22c55e" stroke="#ffffff" stroke-width="1.2" />
            <text x="${padL - 4}" y="${padT + 8}" text-anchor="end" font-size="8.5" fill="#94a3b8">${(maxR * 100).toFixed(0)}%</text>
            <text x="${padL - 4}" y="${ch - padB}" text-anchor="end" font-size="8.5" fill="#94a3b8">${(minR * 100).toFixed(1)}%</text>
            <text x="${padL}" y="${ch - 6}" font-size="8.5" fill="#94a3b8">0h</text>
            <text x="${cw - padR}" y="${ch - 6}" text-anchor="end" font-size="8.5" fill="#94a3b8">${maxT.toFixed(0)}h</text>
            <text x="${Math.min(cw - 45, curX + 6).toFixed(1)}" y="${Math.max(18, curY - 6).toFixed(1)}" font-size="8.5" font-weight="700" fill="#86efac">t=${ev.missionTime}h</text>
          </svg>
        </div>

        <div class="section-card">
          <div class="section-title">Ranking de Gargalos (Ganho em R(t) se perfeito)</div>
          ${ev.importance
            .slice(0, 8)
            .map(
              (im) => `
            <div class="manifest-item" data-warn-node="B:${escapeXml(im.name)}">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong>${escapeXml(im.name)} ${im.isSpof ? '<span class="pill inh">SPOF</span>' : ""}</strong>
                <span style="font-family:var(--font-mono);font-size:10.5px;color:#fbbf24;">+${(im.unreliabilityGain * 100).toFixed(4)}%</span>
              </div>
              <div class="manifest-detail">Birnbaum I_B(R) = ${im.birnbaumR.toFixed(4)} • R_bloco = ${(im.blockR * 100).toFixed(3)}%</div>
            </div>`
            )
            .join("")}
        </div>

        <div class="section-card">
          <div class="section-title">Diagnósticos Estruturais (${warns.length})</div>
          ${warns.length === 0 ? `<div style="color:#86efac;font-size:12px;">✓ Nenhum alerta estrutural.</div>` : warns.map((w) => `<div class="warn-item ${w.severity}" data-warn-node="${escapeXml(w.nodeId || "")}"><strong>[${w.severity.toUpperCase()}]</strong> ${escapeXml(w.message)}</div>`).join("")}
        </div>
      `;

      dom.tabBody.querySelectorAll("[data-warn-node]").forEach((el) => {
        el.addEventListener("click", () => {
          const nid = el.dataset.warnNode;
          if (nid) {
            focusNodeById(nid);
            state.activeTab = "inspector";
            updateTabButtons();
            renderRightPanel();
          }
        });
      });
      return;
    }

    const formalTable = Core.generateTransitionTable(state.ast);

    dom.tabBody.innerHTML = `
      <div class="stat-grid">
        <div class="stat-box"><div class="num">${s.places}</div><div class="lbl">Lugares</div></div>
        <div class="stat-box"><div class="num">${s.transitions}</div><div class="lbl">Transições</div></div>
        <div class="stat-box"><div class="num">${s.totalArcs}</div><div class="lbl">Arcos Totais</div></div>
        <div class="stat-box"><div class="num">${s.expTransitions}</div><div class="lbl">Exponenciais</div></div>
        <div class="stat-box"><div class="num">${s.detTransitions}</div><div class="lbl">Determinísticas</div></div>
        <div class="stat-box"><div class="num">${s.immTransitions}</div><div class="lbl">Imediatas</div></div>
        <div class="stat-box"><div class="num">${s.conditionalArcs}</div><div class="lbl">Arcos IF(...)</div></div>
        <div class="stat-box"><div class="num">${s.inhibitorArcs}</div><div class="lbl">Inibidores ○</div></div>
        <div class="stat-box"><div class="num">${s.guardedTransitions}</div><div class="lbl">Guards</div></div>
      </div>

      <div class="section-card">
        <div class="section-title">Diagnósticos Estruturais (${warns.length})</div>
        ${
          warns.length === 0
            ? `<div style="color:#86efac;font-size:12px;">✓ Nenhum alerta estrutural detectado.</div>`
            : warns
                .map(
                  (w) =>
                    `<div class="warn-item ${w.severity}" data-warn-node="${escapeXml(w.nodeId || "")}">
                      <strong>[${w.severity.toUpperCase()}]</strong> ${escapeXml(w.message)}
                    </div>`
                )
                .join("")
        }
      </div>

      <div class="section-card">
        <div class="section-title">
          <span>Tabela Formal de Regras (${formalTable.rows.length}T)</span>
          <div style="display:flex;gap:4px;">
            <button class="btn sm" id="btnCopyTableMd" title="Copiar tabela formal em Markdown para TCC/relatórios">Markdown</button>
            <button class="btn sm primary" id="btnCopyTableTex" title="Copiar tabela tabular booktabs em LaTeX para Overleaf/IEEE">LaTeX</button>
          </div>
        </div>
        <div class="formal-table-wrap">
          <table class="formal-table">
            <thead>
              <tr>
                <th>Transição</th>
                <th>Pré (In / Inib / G)</th>
                <th>Pós (Out)</th>
              </tr>
            </thead>
            <tbody>
              ${formalTable.rows
                .map(
                  (r) => `
                <tr data-table-tr="${escapeXml(r.name)}">
                  <td><strong style="color:#e2e8f0;">${escapeXml(r.name)}</strong><div style="color:#94a3b8;font-size:9px;">${escapeXml(r.kindStr)}</div></td>
                  <td style="color:#cbd5e1;">${escapeXml(r.pre)}</td>
                  <td style="color:#bae6fd;">${escapeXml(r.post)}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const copyMdBtn = document.getElementById("btnCopyTableMd");
    if (copyMdBtn) {
      copyMdBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(formalTable.markdown).then(() => {
          setParseStatus(true, `Tabela formal (${formalTable.rows.length} transições) copiada em Markdown!`);
          showToast("Tabela copiada em Markdown!");
        });
      });
    }
    const copyTexBtn = document.getElementById("btnCopyTableTex");
    if (copyTexBtn) {
      copyTexBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(formalTable.latex).then(() => {
          setParseStatus(true, `Tabela formal (${formalTable.rows.length} transições) copiada em LaTeX (booktabs)!`);
          showToast("Tabela copiada em LaTeX!");
        });
      });
    }
    dom.tabBody.querySelectorAll("[data-table-tr]").forEach((row) => {
      row.addEventListener("click", () => {
        focusNodeById(`T:${row.dataset.tableTr}`);
        renderCodeHighlight(true);
      });
    });

    dom.tabBody.querySelectorAll("[data-warn-node]").forEach((el) => {
      el.addEventListener("click", () => {
        const nid = el.dataset.warnNode;
        if (nid) {
          focusNodeById(nid);
          state.activeTab = "inspector";
          updateTabButtons();
          renderRightPanel();
        }
      });
    });
  }

  // =========================================================================
  // EXPORT ENGINE (CLEAN .MRY, PUBLICATION SVG WITH LEGEND, 3x PNG)
  // =========================================================================
  function buildStandaloneSvg() {
    if (state.ast && state.ast.modelType === "RBD" && state.rbdLayout && state.audit.rbdEval) {
      const b = state.rbdLayout.bounds;
      const ev = state.audit.rbdEval;
      const padX = 40, padTop = 36, footerH = 74;
      const vx = b.minX - padX;
      const vy = b.minY - padTop;
      const vw = Math.max(700, b.maxX - b.minX + padX * 2);
      const vh = Math.max(380, b.maxY - b.minY + padTop + footerH + 20);
      const fy = b.maxY + 12;
      const ninesStr = Number.isFinite(ev.nines) ? ev.nines.toFixed(2) : "inf";
      const inner = buildRbdSvgContent(true);
      return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(vw)}" height="${Math.round(vh)}" viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}">
  <rect x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" fill="#ffffff" />
  ${inner}
  <rect x="${vx + 20}" y="${fy}" width="${vw - 40}" height="${footerH - 10}" rx="6" fill="#ffffff" stroke="#334155" stroke-width="1" />
  <text x="${vx + 32}" y="${fy + 18}" font-family="Georgia, serif" font-size="11" font-weight="700" fill="#0f172a">RBD Analytical Summary (${escapeXml(state.ast.modelName)} • top = ${escapeXml(ev.topName)} • mission time t = ${ev.missionTime}h):</text>
  <text x="${vx + 32}" y="${fy + 36}" font-family="Consolas, monospace" font-size="10.5" fill="#111827">Availability A = ${(ev.sysA * 100).toFixed(5)}% (${ninesStr} nines)  |  Reliability R(${ev.missionTime}h) = ${(ev.sysR * 100).toFixed(5)}%  |  Downtime = ${ev.downtimeHoursYear.toFixed(2)} h/yr</text>
  <text x="${vx + 32}" y="${fy + 52}" font-family="Consolas, monospace" font-size="10" fill="#334155">Single Points of Failure (${ev.spofs.length}): ${escapeXml(ev.spofs.join(", ") || "None")}</text>
</svg>`;
    }

    const inner = buildSvgContent(true);
    const activeMirrors = state.useMirrors ? (state.lastMirrors || []) : [];

    const pts = Object.entries(state.positions)
      .filter(([k]) => k.startsWith("P:") || k.startsWith("T:"))
      .map(([, v]) => v);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    for (const m of activeMirrors) {
      minX = Math.min(minX, m.x - 45);
      maxX = Math.max(maxX, m.x + 45);
      minY = Math.min(minY, m.y - 30);
      maxY = Math.max(maxY, m.y + 36);
    }
    const padX = 110;
    const padTop = 95;
    const legendLines = state.audit.conditionalLegend || [];
    const extraMirrorNote = activeMirrors.length > 0 ? 18 : 0;
    const legendH = (legendLines.length > 0 && state.arcLabelMode === "tag" ? 36 + legendLines.length * 16 : 20) + extraMirrorNote;
    const padBottom = 80 + legendH;

    const vx = minX - padX;
    const vy = minY - padTop;
    const vw = Math.max(600, maxX - minX + padX * 2);
    const vh = Math.max(400, maxY - minY + padTop + padBottom);

    let legendSvg = "";
    if ((legendLines.length > 0 && state.arcLabelMode === "tag") || activeMirrors.length > 0) {
      const ly = maxY + 78;
      const lRows = [];
      if (legendLines.length > 0 && state.arcLabelMode === "tag") {
        lRows.push(`<text x="${vx + 32}" y="${ly + 17}" font-family="Georgia, serif" font-size="11" font-weight="700" fill="#0f172a">Marking-Dependent Arc Expressions (${legendLines.length} unique expressions — derived deterministically from .mry):</text>`);
        legendLines.forEach((item, idx) => {
          lRows.push(`<text x="${vx + 34}" y="${ly + 34 + idx * 15}" font-family="Consolas, monospace" font-size="10" fill="#111827">${escapeXml(item.tag)} = ${escapeXml(item.expr)}</text>`);
        });
      }
      if (activeMirrors.length > 0) {
        const my = legendLines.length > 0 && state.arcLabelMode === "tag" ? ly + 36 + legendLines.length * 15 : ly + 18;
        lRows.push(`<text x="${vx + 32}" y="${my}" font-family="Georgia, serif" font-size="10" font-style="italic" fill="#374151">Dashed double-ring nodes (↗ PlaceName) denote ${activeMirrors.length} shadow/mirror references to remote places (visual clarity projection; identical .mry semantics).</text>`);
      }
      legendSvg = `
        <g>
          <rect x="${vx + 20}" y="${ly}" width="${vw - 40}" height="${Math.max(28, legendH - 10)}" rx="6" fill="#ffffff" stroke="#334155" stroke-width="1" />
          ${lRows.join("")}
        </g>
      `;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(vw)}" height="${Math.round(vh)}" viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}">
  <rect x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" fill="#ffffff" />
  ${inner}
  ${legendSvg}
</svg>`;
  }

  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPng() {
    const svgStr = buildStandaloneSvg();
    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const scale = 2.5;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = `${state.ast.modelName || "model"}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
      }, "image/png");
    };
    img.src = url;
  }

  function verifyRoundTrip() {
    if (!state.ast) return;
    const mry1 = Core.generateMry(state.ast);
    const ast2 = Core.parseMry(mry1);
    const mry2 = Core.generateMry(ast2);
    const identical = mry1 === mry2;
    const s1 = Core.auditModel(state.ast, { missionTime: state.missionTime }).stats;
    const s2 = Core.auditModel(ast2, { missionTime: state.missionTime }).stats;
    const countsOk = JSON.stringify(s1) === JSON.stringify(s2);

    if (identical && countsOk) {
      const okMsg =
        ast2.modelType === "RBD"
          ? `Round-Trip RBD OK! (${s2.blocks}B, ${s2.groups}G, ${s2.spofs} SPOF)`
          : `Round-Trip SPN OK! (${s2.places}L, ${s2.transitions}T, ${s2.totalArcs}A)`;
      setParseStatus(true, okMsg);
      showToast(`✓ ${okMsg}`);
    } else {
      setParseStatus(false, "Divergência detectada no teste de round-trip!");
      showToast("✗ Divergência no round-trip!", true);
    }
  }

  // =========================================================================
  // TOOLBAR & CONTROLS WIRING
  // =========================================================================
  function setTool(tool) {
    state.activeTool = tool;
    state.connectSource = null;
    state.connectCursor = null;
    document.querySelectorAll("[data-tool]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === tool);
    });
    dom.svgStage.classList.remove("mode-connect", "mode-add", "mode-delete");
    if (tool.startsWith("add")) {
      dom.svgStage.classList.add("mode-add");
      dom.canvasHint.textContent = "Clique em qualquer ponto livre do canvas para criar o novo elemento (Esc volta para Selecionar).";
    } else if (tool === "delete") {
      dom.svgStage.classList.add("mode-delete");
      dom.canvasHint.textContent = "Modo Apagar: clique em um lugar, transição, arco ou título de área para removê-lo.";
    } else {
      updateModeToolbars();
    }
    renderRubberBand();
  }

  document.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tool === "delete" && (state.selected || state.multiSelected.length > 0)) {
        deleteSelectedItem();
        return;
      }
      setTool(btn.dataset.tool);
    });
  });
  dom.btnConnNormal.addEventListener("click", () => setConnectorType("normal"));
  dom.btnConnInhibitor.addEventListener("click", () => setConnectorType("inhibitor"));

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      updateTabButtons();
      renderRightPanel();
    });
  });

  dom.mryEditor.addEventListener("input", () => {
    if (state.suppressEditorInput) return;
    loadFromCode(dom.mryEditor.value, false, false);
    clearTimeout(state.editorDebounceTimer);
    state.editorDebounceTimer = setTimeout(() => commitHistory(), 450);
  });
  dom.mryEditor.addEventListener("scroll", syncCodeScroll);
  dom.mryEditor.addEventListener("mousemove", (e) => {
    const rect = dom.mryEditor.getBoundingClientRect();
    const y = e.clientY - rect.top + dom.mryEditor.scrollTop - 10;
    const lineNo = Math.max(1, Math.floor(y / 18) + 1);
    updateCodeLineCrossHighlight(lineNo);
  });
  dom.mryEditor.addEventListener("mouseleave", () => {
    updateCodeLineCrossHighlight(null);
    updateModeToolbars();
  });
  const syncCaretLine = () => {
    const pos = dom.mryEditor.selectionStart || 0;
    const lineNo = dom.mryEditor.value.slice(0, pos).split("\n").length;
    updateCodeLineCrossHighlight(lineNo);
  };
  dom.mryEditor.addEventListener("click", syncCaretLine);
  dom.mryEditor.addEventListener("keyup", syncCaretLine);

  function showToast(msg, isError = false) {
    if (!dom.toastHost || !msg) return;
    const el = document.createElement("div");
    el.className = "toast-item" + (isError ? " err" : "");
    el.textContent = msg;
    dom.toastHost.innerHTML = "";
    dom.toastHost.appendChild(el);
    clearTimeout(state._toastTimer);
    state._toastTimer = setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 2400);
  }

  function isCompactViewport() {
    return window.innerWidth < 740;
  }

  function syncPanelButtons() {
    const compact = isCompactViewport();
    const codeOpen = compact
      ? dom.workspace.classList.contains("mobile-code-open")
      : !dom.workspace.classList.contains("hide-code");
    const inspOpen = compact
      ? dom.workspace.classList.contains("mobile-inspector-open")
      : !dom.workspace.classList.contains("hide-inspector");
    const gridFocused = !codeOpen && !inspOpen;
    const zenActive = codeOpen && !inspOpen;
    const studioActive = codeOpen && inspOpen;

    if (dom.btnToggleCode) {
      dom.btnToggleCode.classList.toggle("active", zenActive);
      dom.btnToggleCode.setAttribute("aria-pressed", String(zenActive));
    }
    if (dom.btnFocusCanvas) {
      dom.btnFocusCanvas.classList.toggle("active", gridFocused);
      dom.btnFocusCanvas.setAttribute("aria-pressed", String(gridFocused));
    }
    if (dom.btnToggleInspector) {
      dom.btnToggleInspector.classList.toggle("active", studioActive || (compact && inspOpen));
      dom.btnToggleInspector.setAttribute("aria-pressed", String(studioActive || (compact && inspOpen)));
    }
    if (dom.drawerBackdrop) {
      dom.drawerBackdrop.classList.toggle("visible", compact && (codeOpen || inspOpen));
    }
  }

  function setLayoutMode(mode, fitAfter = true) {
    state.layoutMode = mode;
    const compact = isCompactViewport();
    if (compact) {
      if (mode === "zen") {
        dom.workspace.classList.add("mobile-code-open");
        dom.workspace.classList.remove("mobile-inspector-open");
      } else if (mode === "studio") {
        dom.workspace.classList.add("mobile-inspector-open");
        dom.workspace.classList.remove("mobile-code-open");
      } else {
        closeAllMobileDrawers();
      }
      syncPanelButtons();
      return;
    }

    if (mode === "zen") {
      // VS Code Zen Mode: Code on the left + Editable Diagram Preview on the right (no Inspector clutter)
      dom.workspace.classList.remove("hide-code");
      dom.workspace.classList.add("hide-inspector");
    } else if (mode === "canvas") {
      // Figma Canvas Mode: 100% full-bleed diagram canvas
      dom.workspace.classList.add("hide-code", "hide-inspector");
    } else {
      // 3-Pane Studio Mode: Code + Canvas + Inspector
      dom.workspace.classList.remove("hide-code", "hide-inspector");
    }
    syncPanelButtons();
    if (fitAfter) setTimeout(fitView, 150);
  }

  function toggleFocusCanvas(forceFocus = null) {
    const compact = isCompactViewport();
    const currentlyFocused = compact
      ? !dom.workspace.classList.contains("mobile-code-open") && !dom.workspace.classList.contains("mobile-inspector-open")
      : dom.workspace.classList.contains("hide-code") && dom.workspace.classList.contains("hide-inspector");
    const wantFocus = forceFocus !== null ? forceFocus : !currentlyFocused;
    setLayoutMode(wantFocus ? "canvas" : "zen", true);
  }

  // Draggable Pane Splitters (Code <-> Canvas & Canvas <-> Inspector) with localStorage persistence
  const STORAGE_CODE_W = "mry_studio_code_w_v1";
  const STORAGE_INSP_W = "mry_studio_insp_w_v1";

  function applySavedPaneWidths() {
    try {
      const cw = Number(localStorage.getItem(STORAGE_CODE_W));
      if (Number.isFinite(cw) && cw >= 220 && cw <= 760) {
        document.documentElement.style.setProperty("--code-w", `${cw}px`);
      }
      const iw = Number(localStorage.getItem(STORAGE_INSP_W));
      if (Number.isFinite(iw) && iw >= 250 && iw <= 560) {
        document.documentElement.style.setProperty("--inspector-w", `${iw}px`);
      }
    } catch (_) {}
  }
  applySavedPaneWidths();

  function setupPaneSplitter(handleEl, cssVar, storageKey, defaultPx, minPx, maxPx, fromRight = false) {
    if (!handleEl) return;
    handleEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || isCompactViewport()) return;
      e.preventDefault();
      handleEl.classList.add("dragging");
      document.body.classList.add("is-resizing");
      const wsRect = dom.workspace.getBoundingClientRect();

      const onMove = (ev) => {
        const rawW = fromRight ? wsRect.right - ev.clientX : ev.clientX - wsRect.left;
        const clamped = Math.round(Math.max(minPx, Math.min(maxPx, wsRect.width - 280, rawW)));
        if (!fromRight) dom.workspace.classList.remove("wide-code");
        if (dom.btnWideCode && !fromRight) dom.btnWideCode.classList.remove("active");
        document.documentElement.style.setProperty(cssVar, `${clamped}px`);
      };
      const onUp = () => {
        handleEl.classList.remove("dragging");
        document.body.classList.remove("is-resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const finalPx = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10);
        if (Number.isFinite(finalPx)) {
          try { localStorage.setItem(storageKey, String(finalPx)); } catch (_) {}
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    handleEl.addEventListener("dblclick", () => {
      if (!fromRight) dom.workspace.classList.remove("wide-code");
      if (dom.btnWideCode && !fromRight) dom.btnWideCode.classList.remove("active");
      document.documentElement.style.setProperty(cssVar, `${defaultPx}px`);
      try { localStorage.removeItem(storageKey); } catch (_) {}
      showToast("Largura do painel restaurada");
    });
  }

  setupPaneSplitter(dom.splitterCode, "--code-w", STORAGE_CODE_W, 370, 220, 760, false);
  setupPaneSplitter(dom.splitterInspector, "--inspector-w", STORAGE_INSP_W, 340, 250, 560, true);

  // VS Code Style Split Editor (opens second editor pane in the Empty Welcome State!)
  function toggleSplitModel(forceActive = null) {
    if (!dom.appShell || !dom.splitFrame) return;
    const active = forceActive !== null ? forceActive : !dom.appShell.classList.contains("split-active");
    dom.appShell.classList.toggle("split-active", active);
    if (dom.btnSplitModel) {
      dom.btnSplitModel.classList.toggle("active", active);
      dom.btnSplitModel.setAttribute("aria-pressed", String(active));
    }

    if (active) {
      // Newly split editor starts in VS Code Empty Welcome State inviting the user to open a file!
      if (!dom.splitFrame.src || dom.splitFrame.src === "about:blank") {
        dom.splitFrame.src = "index.html?embedded=1&empty=1";
      }
      showToast("Tela dividida — clique no novo editor para abrir um arquivo .mry");
    } else {
      syncPanelButtons();
      setTimeout(fitView, 180);
    }
  }

  // =========================================================================
  // VS CODE EMPTY EDITOR WELCOME STATE
  // =========================================================================
  function renderEmptyEditorRecents() {
    if (!dom.emptyRecentList) return;
    const idx = loadMemoryIndex();
    const customFiles = Object.values(idx)
      .filter((e) => e && e.isCustomFile)
      .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));

    let html = "";
    for (const cf of customFiles.slice(0, 4)) {
      html += `
        <button class="empty-recent-item" type="button" data-empty-open="${escapeXml(cf.key)}">
          <span>${escapeXml(cf.displayName)}</span>
          <span class="tag">memória local</span>
        </button>
      `;
    }
    for (const p of PRESETS) {
      html += `
        <button class="empty-recent-item" type="button" data-empty-open="preset:${escapeXml(p.id)}">
          <span>${escapeXml(p.name)}</span>
          <span class="tag">.mry</span>
        </button>
      `;
    }
    dom.emptyRecentList.innerHTML = html;
    dom.emptyRecentList.querySelectorAll("[data-empty-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.emptyOpen;
        if (key.startsWith("preset:")) {
          const pr = PRESETS.find((x) => x.id === key.slice(7));
          if (pr) openWorkspaceEntry(key, pr.name, pr.code, true);
        } else if (key.startsWith("file:")) {
          const mem = getFileMemory(key);
          if (mem && mem.code) openWorkspaceEntry(key, key.slice(5), mem.code, true);
        }
      });
    });
  }

  function enterEmptyEditorState() {
    state.isEmptyEditor = true;
    if (state.simMode) exitSimMode(true);
    closeAllMobileDrawers();
    if (dom.workspace) dom.workspace.classList.add("is-empty");
    if (dom.emptyEditorState) dom.emptyEditorState.style.display = "flex";
    if (dom.activeFileTab) dom.activeFileTab.style.opacity = "0.45";
    renderEmptyEditorRecents();
  }

  function exitEmptyEditorState() {
    state.isEmptyEditor = false;
    if (dom.workspace) dom.workspace.classList.remove("is-empty");
    if (dom.emptyEditorState) dom.emptyEditorState.style.display = "none";
    if (dom.activeFileTab) dom.activeFileTab.style.opacity = "1";
  }

  function createNewBlankModel(modelType) {
    const isRbd = modelType === "RBD";
    const stamp = Math.floor(100 + Math.random() * 899);
    const name = isRbd ? `NovoRBD_${stamp}` : `NovaSPN_${stamp}`;
    const code = isRbd
      ? `MTTF_A = 1000.0;\nMTTR_A = 4.0;\n\nRBD ${name} {\n    block Comp_A( MTTF = MTTF_A, MTTR = MTTR_A );\n    block Comp_B( MTTF = MTTF_A, MTTR = MTTR_A );\n    series TopSeries( Comp_A, Comp_B );\n    top TopSeries;\n}\n`
      : `lambda = 1.0;\nmu = 2.0;\n\nSPN ${name} {\n    place Idle( tokens = 1 );\n    place Busy;\n\n    timedTransition Start(\n        inputs = [Idle],\n        outputs = [Busy],\n        delay = ( type = "Exponential", parameters = ( Mean = lambda ) )\n    );\n\n    timedTransition Finish(\n        inputs = [Busy],\n        outputs = [Idle],\n        delay = ( type = "Exponential", parameters = ( Mean = mu ) )\n    );\n}\n`;
    openWorkspaceEntry(`file:${name}.mry`, `${name}.mry`, code, false);
    saveCurrentToMemory();
    showToast(`Criado ${name}.mry`);
  }

  if (dom.btnCloseFile) {
    dom.btnCloseFile.addEventListener("click", (e) => {
      e.stopPropagation();
      enterEmptyEditorState();
    });
  }
  if (dom.btnEmptyOpenCenter) {
    dom.btnEmptyOpenCenter.addEventListener("click", () => dom.fileInput.click());
    dom.btnEmptyOpenCenter.addEventListener("dragover", (e) => {
      e.preventDefault();
      dom.btnEmptyOpenCenter.classList.add("drag-over");
    });
    dom.btnEmptyOpenCenter.addEventListener("dragleave", () => {
      dom.btnEmptyOpenCenter.classList.remove("drag-over");
    });
    dom.btnEmptyOpenCenter.addEventListener("drop", (e) => {
      e.preventDefault();
      dom.btnEmptyOpenCenter.classList.remove("drag-over");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const diskCode = String(reader.result || "");
        openWorkspaceEntry("file:" + f.name, f.name, diskCode, false);
        saveCurrentToMemory();
      };
      reader.readAsText(f, "utf-8");
    });
  }
  if (dom.btnEmptyNewSpn) dom.btnEmptyNewSpn.addEventListener("click", () => createNewBlankModel("SPN"));
  if (dom.btnEmptyNewRbd) dom.btnEmptyNewRbd.addEventListener("click", () => createNewBlankModel("RBD"));

  // =========================================================================
  // REAL-TIME COLLABORATIVE EDITING (WEBRTC P2P + BROADCASTCHANNEL)
  // =========================================================================
  function updateCollabUi() {
    const c = state.collab;
    const peerCount = c.remotePeers.size;
    if (dom.collabDot) dom.collabDot.classList.toggle("online", c.active);
    if (dom.collabBtnLabel) {
      dom.collabBtnLabel.textContent = c.active ? `Sala (${peerCount + 1})` : "Colaborar";
    }
    if (dom.btnCollabToggle) {
      dom.btnCollabToggle.textContent = c.active ? "Sair" : "Conectar";
      dom.btnCollabToggle.classList.toggle("danger", c.active);
      dom.btnCollabToggle.classList.toggle("primary", !c.active);
    }
    if (dom.collabStatusRow) dom.collabStatusRow.classList.toggle("online", c.active);
    if (dom.collabStatusText) {
      dom.collabStatusText.textContent = c.active
        ? `Ao vivo na sala '${c.roomId}' • ${peerCount} colega(s) conectado(s)`
        : "Offline (sessão individual)";
    }
    if (dom.btnCollabCopyLink) {
      dom.btnCollabCopyLink.style.display = c.active ? "inline-flex" : "none";
    }
  }

  function renderCollabCursors() {
    if (!dom.svg) return;
    const layer = dom.svg.querySelector("#collabLayer");
    if (!layer) return;
    if (!state.collab.active || state.collab.remotePeers.size === 0) {
      layer.innerHTML = "";
      return;
    }
    const now = Date.now();
    let svg = "";
    for (const [pid, peer] of state.collab.remotePeers.entries()) {
      if (now - (peer.ts || 0) > 25000) {
        state.collab.remotePeers.delete(pid);
        continue;
      }
      if (!Number.isFinite(peer.x) || !Number.isFinite(peer.y)) continue;
      const col = peer.color || "#3b82f6";
      const nm = String(peer.name || "Colega");
      const pillW = Math.max(48, nm.length * 6.2 + 12);
      svg += `
        <g transform="translate(${peer.x.toFixed(1)}, ${peer.y.toFixed(1)})">
          <path d="M 0 0 L 11 4.5 L 6.5 7 L 4.5 11.5 Z" fill="${escapeXml(col)}" stroke="#ffffff" stroke-width="1.1" />
          <rect x="10" y="9" width="${pillW.toFixed(1)}" height="16" rx="4" fill="${escapeXml(col)}" />
          <text x="${(10 + pillW / 2).toFixed(1)}" y="20" text-anchor="middle" font-family="'Inter', sans-serif" font-size="9.5" font-weight="600" fill="#ffffff">${escapeXml(nm)}</text>
        </g>
      `;
    }
    layer.innerHTML = svg;
  }

  function sendCollabPacket(pkt) {
    const c = state.collab;
    if (!c.active) return;
    const payload = { ...pkt, senderId: c.selfId, senderName: c.userName, senderColor: c.userColor, ts: Date.now() };
    if (c.bc) {
      try { c.bc.postMessage(payload); } catch (_) {}
    }
    for (const conn of c.conns.values()) {
      if (conn && conn.open) {
        try { conn.send(payload); } catch (_) {}
      }
    }
  }

  function broadcastCollabCursor(svgPt) {
    const c = state.collab;
    if (!c.active || !svgPt) return;
    const now = performance.now();
    if (now - c.lastCursorSent < 45) return;
    c.lastCursorSent = now;
    sendCollabPacket({ type: "cursor", x: svgPt.x, y: svgPt.y });
  }

  function broadcastCollabState() {
    const c = state.collab;
    if (!c.active || c.suppressBroadcast || state.isEmptyEditor) return;
    sendCollabPacket({
      type: "state",
      code: dom.mryEditor.value,
      positions: state.positions,
      zones: state.zones,
      simMode: state.simMode,
      simMarking: state.simMarking
    });
  }

  function handleCollabPacket(pkt) {
    if (!pkt || pkt.senderId === state.collab.selfId) return;
    const c = state.collab;
    const prev = c.remotePeers.get(pkt.senderId) || {};
    c.remotePeers.set(pkt.senderId, {
      name: pkt.senderName || prev.name || "Colega",
      color: pkt.senderColor || prev.color || "#3b82f6",
      x: pkt.type === "cursor" ? pkt.x : prev.x,
      y: pkt.type === "cursor" ? pkt.y : prev.y,
      ts: Date.now()
    });

    if (pkt.type === "cursor") {
      renderCollabCursors();
      updateCollabUi();
      return;
    }

    if (pkt.type === "hello") {
      updateCollabUi();
      broadcastCollabState();
      return;
    }

    if (pkt.type === "state" && typeof pkt.code === "string") {
      c.suppressBroadcast = true;
      try {
        if (state.isEmptyEditor) exitEmptyEditorState();
        state.suppressEditorInput = true;
        dom.mryEditor.value = pkt.code;
        state.suppressEditorInput = false;
        if (pkt.positions) state.positions = deepClone(pkt.positions);
        if (pkt.zones) state.zones = deepClone(pkt.zones);
        loadFromCode(pkt.code, false, true);
        if (typeof pkt.simMode === "boolean" && pkt.simMode && pkt.simMarking) {
          state.simMode = true;
          state.simMarking = { ...pkt.simMarking };
          updateModeToolbars();
          renderCanvas();
        }
        renderRightPanel();
      } finally {
        c.suppressBroadcast = false;
      }
      updateCollabUi();
    }
  }

  function ensurePeerJsLoaded() {
    if (window.Peer) return Promise.resolve(window.Peer);
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
      s.async = true;
      s.onload = () => resolve(window.Peer || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }

  function attachPeerConnection(conn, isHost) {
    const c = state.collab;
    if (!conn) return;
    conn.on("open", () => {
      c.conns.set(conn.peer, conn);
      updateCollabUi();
      conn.send({
        type: "hello",
        senderId: c.selfId,
        senderName: c.userName,
        senderColor: c.userColor
      });
    });
    conn.on("data", (data) => {
      handleCollabPacket(data);
      // Host relays packets to other WebRTC peers in the room
      if (isHost) {
        for (const [pid, other] of c.conns.entries()) {
          if (pid !== conn.peer && other && other.open) {
            try { other.send(data); } catch (_) {}
          }
        }
      }
    });
    conn.on("close", () => {
      c.conns.delete(conn.peer);
      updateCollabUi();
    });
  }

  async function startCollabSession(roomIdRaw) {
    const cleanRoom = String(roomIdRaw || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-") || "modcs-room";
    stopCollabSession(true);

    const c = state.collab;
    if (dom.inpCollabName && dom.inpCollabName.value.trim()) {
      c.userName = dom.inpCollabName.value.trim();
    }
    if (dom.inpCollabRoom) dom.inpCollabRoom.value = cleanRoom;
    c.roomId = cleanRoom;
    c.active = true;

    // 1. Instant local cross-tab / split-pane BroadcastChannel transport
    if (typeof BroadcastChannel !== "undefined") {
      c.bc = new BroadcastChannel(`mry_studio_collab_${cleanRoom}`);
      c.bc.onmessage = (ev) => handleCollabPacket(ev.data);
    }

    updateCollabUi();
    sendCollabPacket({ type: "hello" });

    // 2. Serverless Internet WebRTC P2P transport via PeerJS public broker
    const PeerCtor = await ensurePeerJsLoaded();
    if (PeerCtor && c.active && c.roomId === cleanRoom) {
      const hostPeerId = `mry-studio-room-${cleanRoom}`;
      try {
        const peer = new PeerCtor(hostPeerId);
        c.peer = peer;
        peer.on("open", () => {
          updateCollabUi();
        });
        peer.on("connection", (conn) => attachPeerConnection(conn, true));
        peer.on("error", (err) => {
          // If host ID is already taken by the room creator, join as a guest peer and connect to host!
          if (err && err.type === "unavailable-id" && c.active) {
            try { peer.destroy(); } catch (_) {}
            const guest = new PeerCtor();
            c.peer = guest;
            guest.on("open", () => {
              const conn = guest.connect(hostPeerId, { reliable: true });
              attachPeerConnection(conn, false);
            });
          }
        });
      } catch (_) {}
    }

    showToast(`Colaboração ativa na sala '${cleanRoom}'`);
  }

  function stopCollabSession(silent = false) {
    const c = state.collab;
    c.active = false;
    if (c.bc) {
      try { c.bc.close(); } catch (_) {}
      c.bc = null;
    }
    for (const conn of c.conns.values()) {
      try { conn.close(); } catch (_) {}
    }
    c.conns.clear();
    if (c.peer) {
      try { c.peer.destroy(); } catch (_) {}
      c.peer = null;
    }
    c.remotePeers.clear();
    renderCollabCursors();
    updateCollabUi();
    if (!silent) showToast("Sessão colaborativa encerrada");
  }

  if (dom.inpCollabName) {
    dom.inpCollabName.value = state.collab.userName;
    dom.inpCollabName.addEventListener("change", () => {
      const v = dom.inpCollabName.value.trim();
      if (v) state.collab.userName = v;
    });
  }
  if (dom.inpCollabRoom) {
    dom.inpCollabRoom.value = "modcs-spn";
  }
  if (dom.btnCollabToggle) {
    dom.btnCollabToggle.addEventListener("click", () => {
      if (state.collab.active) stopCollabSession(false);
      else startCollabSession(dom.inpCollabRoom ? dom.inpCollabRoom.value : "modcs-spn");
    });
  }
  if (dom.btnCollabCopyLink) {
    dom.btnCollabCopyLink.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("room", state.collab.roomId || "modcs-spn");
      navigator.clipboard.writeText(url.toString()).then(() => {
        showToast("Link colaborativo copiado!");
      });
    });
  }

  if (dom.btnToggleCode) dom.btnToggleCode.addEventListener("click", () => setLayoutMode("zen"));
  if (dom.btnFocusCanvas) dom.btnFocusCanvas.addEventListener("click", () => setLayoutMode("canvas"));
  if (dom.btnToggleInspector) {
    dom.btnToggleInspector.addEventListener("click", () => {
      if (isCompactViewport()) {
        toggleInspectorPane();
        return;
      }
      const inspHidden = dom.workspace.classList.contains("hide-inspector");
      setLayoutMode(inspHidden ? "studio" : "zen");
    });
  }
  if (dom.btnSplitModel) dom.btnSplitModel.addEventListener("click", () => toggleSplitModel());
  if (dom.btnCloseEmbeddedSplit) {
    dom.btnCloseEmbeddedSplit.addEventListener("click", () => {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "mry-close-split" }, "*");
      }
    });
  }
  window.addEventListener("message", (ev) => {
    if (ev.data && ev.data.type === "mry-close-split") {
      toggleSplitModel(false);
    }
  });

  if (dom.splitterSplit && dom.appShell) {
    dom.splitterSplit.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dom.splitterSplit.classList.add("dragging");
      document.body.classList.add("is-resizing");
      const rect = dom.appShell.getBoundingClientRect();
      const horizontal = window.innerWidth >= 768;

      const onMove = (ev) => {
        const ratio = horizontal
          ? ((ev.clientX - rect.left) / rect.width) * 100
          : ((ev.clientY - rect.top) / rect.height) * 100;
        const clamped = Math.max(24, Math.min(76, ratio));
        document.documentElement.style.setProperty("--split-ratio", `${clamped.toFixed(1)}%`);
      };
      const onUp = () => {
        dom.splitterSplit.classList.remove("dragging");
        document.body.classList.remove("is-resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    dom.splitterSplit.addEventListener("dblclick", () => {
      document.documentElement.style.setProperty("--split-ratio", "50%");
      showToast("Divisão restaurada para 50 / 50");
    });
  }

  function closeAllMobileDrawers() {
    dom.workspace.classList.remove("mobile-code-open", "mobile-inspector-open");
    syncPanelButtons();
  }

  const toggleCodePane = (forceHide = null) => {
    if (isCompactViewport()) {
      const open = forceHide !== null ? !forceHide : !dom.workspace.classList.contains("mobile-code-open");
      dom.workspace.classList.remove("mobile-inspector-open");
      dom.workspace.classList.toggle("mobile-code-open", open);
      syncPanelButtons();
      return;
    }
    const hide = forceHide !== null ? forceHide : !dom.workspace.classList.contains("hide-code");
    dom.workspace.classList.toggle("hide-code", hide);
    syncPanelButtons();
    setTimeout(fitView, 190);
  };

  const toggleInspectorPane = (forceHide = null) => {
    if (isCompactViewport()) {
      const open = forceHide !== null ? !forceHide : !dom.workspace.classList.contains("mobile-inspector-open");
      dom.workspace.classList.remove("mobile-code-open");
      dom.workspace.classList.toggle("mobile-inspector-open", open);
      syncPanelButtons();
      return;
    }
    const hide = forceHide !== null ? forceHide : !dom.workspace.classList.contains("hide-inspector");
    dom.workspace.classList.toggle("hide-inspector", hide);
    syncPanelButtons();
    setTimeout(fitView, 190);
  };

  dom.btnCollapseCode.addEventListener("click", () => toggleCodePane(true));
  if (dom.btnCloseInspector) dom.btnCloseInspector.addEventListener("click", () => toggleInspectorPane(true));
  if (dom.drawerBackdrop) dom.drawerBackdrop.addEventListener("click", closeAllMobileDrawers);
  dom.btnWideCode.addEventListener("click", () => {
    dom.workspace.classList.remove("hide-code");
    const isWide = dom.workspace.classList.toggle("wide-code");
    dom.btnWideCode.classList.toggle("active", isWide);
    syncPanelButtons();
    setTimeout(fitView, 190);
  });

  // Topbar Popovers: View, Collaborate, Export
  const closeAllMenus = (exceptMenu = null) => {
    [
      [dom.exportMenu, dom.btnExportMenu],
      [dom.viewMenu, dom.btnViewMenu],
      [dom.collabMenu, dom.btnCollabMenu]
    ].forEach(([menu, btn]) => {
      if (!menu || !btn || menu === exceptMenu) return;
      menu.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    });
  };
  const closeExportMenu = () => closeAllMenus(null);

  const wirePopover = (btn, menu) => {
    if (!btn || !menu) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = !menu.classList.contains("open");
      closeAllMenus(menu);
      menu.classList.toggle("open", willOpen);
      btn.setAttribute("aria-expanded", String(willOpen));
    });
  };
  wirePopover(dom.btnExportMenu, dom.exportMenu);
  wirePopover(dom.btnViewMenu, dom.viewMenu);
  wirePopover(dom.btnCollabMenu, dom.collabMenu);

  document.addEventListener("click", (e) => {
    const insideAny = [dom.exportMenu, dom.viewMenu, dom.collabMenu].some((m) => m && m.contains(e.target));
    const isBtn = [dom.btnExportMenu, dom.btnViewMenu, dom.btnCollabMenu].includes(e.target);
    if (!insideAny && !isBtn) closeAllMenus(null);
  });

  // Native-feeling Touch Gestures on Canvas (2-finger Pinch-Zoom + Pan, 1-finger Pan & Node Tap/Drag)
  const touchState = { mode: null, lastDist: 0, lastMid: null, startPt: null, origView: null, nodeDrag: null, lastTap: { id: null, time: 0 } };
  dom.svgStage.addEventListener("touchstart", (e) => {
    // Ignore touches on floating dock / bars / legend
    if (e.target.closest("#figmaDock, #selectionActionBar, #simActionBar, #legendOverlay")) return;

    if (e.touches.length === 2) {
      e.preventDefault();
      const [t1, t2] = e.touches;
      touchState.mode = "pinch";
      touchState.nodeDrag = null;
      touchState.lastDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1;
      touchState.lastMid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      const nodeEl = e.target.closest(".spn-node");
      const mirrorEl = e.target.closest(".spn-mirror");
      const rbdEl = e.target.closest(".rbd-block, .rbd-group");

      if (mirrorEl) {
        e.preventDefault();
        const mirrorId = mirrorEl.dataset.mirrorId;
        const targetId = mirrorEl.dataset.targetId || `P:${mirrorEl.dataset.placeName}`;
        const svgPt = clientToSvg(t.clientX, t.clientY);
        const curX = Number(mirrorEl.dataset.mx) || svgPt.x;
        const curY = Number(mirrorEl.dataset.my) || svgPt.y;
        touchState.mode = "mirror";
        touchState.nodeDrag = {
          mirrorId,
          targetId,
          origX: curX,
          origY: curY,
          startX: t.clientX,
          startY: t.clientY,
          offsetX: svgPt.x - curX,
          offsetY: svgPt.y - curY,
          moved: false
        };
        return;
      }

      if (rbdEl) {
        e.preventDefault();
        if (rbdEl.classList.contains("rbd-block")) {
          state.selected = { type: "rbdBlock", id: rbdEl.dataset.blockName };
        } else {
          state.selected = { type: "rbdGroup", id: rbdEl.dataset.groupName };
        }
        renderCanvas();
        renderRightPanel();
        if (isCompactViewport()) toggleInspectorPane(false);
        return;
      }

      if (nodeEl) {
        e.preventDefault();
        const kind = nodeEl.dataset.nodeKind;
        const name = nodeEl.dataset.nodeName;
        if (state.simMode) {
          if (kind === "T") stepSimFire(name, false);
          else showToast(`Lugar '${name}': ${state.simMarking ? (state.simMarking[name] ?? 0) : 0} token(s)`);
          return;
        }
        const nodeId = `${kind}:${name}`;
        const svgPt = clientToSvg(t.clientX, t.clientY);
        const cur = state.positions[nodeId] || svgPt;
        touchState.mode = "node";
        touchState.nodeDrag = {
          kind, name, nodeId,
          startX: t.clientX, startY: t.clientY,
          offsetX: svgPt.x - cur.x, offsetY: svgPt.y - cur.y,
          moved: false
        };
        return;
      }

      // Empty canvas: 1-finger smooth Pan!
      e.preventDefault();
      touchState.mode = "pan";
      touchState.startPt = { x: t.clientX, y: t.clientY };
      touchState.origView = { x: state.view.x, y: state.view.y };
    }
  }, { passive: false });

  dom.svgStage.addEventListener("touchmove", (e) => {
    if (!touchState.mode) return;
    if (touchState.mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const [t1, t2] = e.touches;
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1;
      const mid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
      const factor = touchState.lastDist / dist;
      const rect = dom.svg.getBoundingClientRect();
      const pt = clientToSvg(mid.x, mid.y);
      const newW = Math.max(240, Math.min(8000, state.view.w * factor));
      const newH = Math.max(160, Math.min(5500, state.view.h * factor));
      const rx = (pt.x - state.view.x) / state.view.w;
      const ry = (pt.y - state.view.y) / state.view.h;
      const panDx = ((mid.x - touchState.lastMid.x) / rect.width) * newW;
      const panDy = ((mid.y - touchState.lastMid.y) / rect.height) * newH;
      state.view.x = pt.x - rx * newW - panDx;
      state.view.y = pt.y - ry * newH - panDy;
      state.view.w = newW;
      state.view.h = newH;
      dom.svg.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
      touchState.lastDist = dist;
      touchState.lastMid = mid;
      return;
    }

    if (touchState.mode === "pan" && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      const rect = dom.svg.getBoundingClientRect();
      const dx = ((t.clientX - touchState.startPt.x) / rect.width) * state.view.w;
      const dy = ((t.clientY - touchState.startPt.y) / rect.height) * state.view.h;
      state.view.x = touchState.origView.x - dx;
      state.view.y = touchState.origView.y - dy;
      dom.svg.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
      return;
    }

    if ((touchState.mode === "node" || touchState.mode === "mirror") && touchState.nodeDrag && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      const nd = touchState.nodeDrag;
      if (!nd.moved && Math.hypot(t.clientX - nd.startX, t.clientY - nd.startY) < 7) return;
      nd.moved = true;
      const pt = clientToSvg(t.clientX, t.clientY);
      const posKey = touchState.mode === "mirror" ? nd.mirrorId : nd.nodeId;
      state.positions[posKey] = {
        x: Math.round((pt.x - nd.offsetX) / 5) * 5,
        y: Math.round((pt.y - nd.offsetY) / 5) * 5
      };
      renderCanvas();
    }
  }, { passive: false });

  dom.svgStage.addEventListener("touchend", () => {
    if (touchState.mode === "mirror" && touchState.nodeDrag) {
      const nd = touchState.nodeDrag;
      if (nd.moved) {
        commitHistory();
      } else {
        focusNodeById(nd.targetId, {
          animate: true,
          fromPt: { x: nd.origX, y: nd.origY },
          keepSimMode: state.simMode
        });
        if (!state.simMode) renderRightPanel();
      }
    } else if (touchState.mode === "node" && touchState.nodeDrag) {
      const nd = touchState.nodeDrag;
      if (nd.moved) {
        commitHistory();
      } else {
        // Quick tap on node: select it; double-tap opens Inspector bottom sheet on mobile!
        state.selected = { type: nd.kind === "P" ? "place" : "transition", id: nd.name };
        state.multiSelected = [];
        renderCanvas();
        renderRightPanel();
        const now = Date.now();
        if (isCompactViewport() && touchState.lastTap.id === nd.nodeId && now - touchState.lastTap.time < 360) {
          toggleInspectorPane(false);
        }
        touchState.lastTap = { id: nd.nodeId, time: now };
      }
    }
    touchState.mode = null;
    touchState.nodeDrag = null;
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      syncPanelButtons();
    }, 120);
  });

  dom.btnUndo.addEventListener("click", performUndo);
  dom.btnRedo.addEventListener("click", performRedo);
  dom.btnResetMemory.addEventListener("click", clearMemoryForCurrentFile);

  window.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    const tag = (active && active.tagName) || "";
    const inTextInput =
      tag === "TEXTAREA" ||
      (tag === "INPUT" && !["checkbox", "radio", "button", "submit", "range", "color"].includes((active.type || "").toLowerCase()));
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey && !inTextInput) {
        e.preventDefault();
        performUndo();
      } else if ((k === "y" || (k === "z" && e.shiftKey)) && !inTextInput) {
        e.preventDefault();
        performRedo();
      }
      return;
    }
    if (inTextInput) return;
    if (e.code === "Space") {
      e.preventDefault();
      state.spacePressed = true;
      dom.svgStage.style.cursor = "grab";
      return;
    }
    if (e.key === "Escape") {
      closeExportMenu();
      if (isCompactViewport() && (dom.workspace.classList.contains("mobile-code-open") || dom.workspace.classList.contains("mobile-inspector-open"))) {
        closeAllMobileDrawers();
      } else if (state.simMode) exitSimMode(false);
      else if (state.connectSource) cancelConnector();
      else if (state.activeTool !== "select") setTool("select");
      else {
        state.selected = null;
        state.multiSelected = [];
        updateModeToolbars();
        renderCanvas();
        renderRightPanel();
      }
    } else if (e.key === "Tab" && state.ast && state.ast.modelType === "SPN" && !state.simMode) {
      e.preventDefault();
      setConnectorType(state.connectorType === "normal" ? "inhibitor" : "normal");
    } else if ((e.key === "Delete" || e.key === "Backspace") && !state.simMode && (state.selected || state.multiSelected.length > 0)) {
      e.preventDefault();
      deleteSelectedItem();
    } else if (!e.shiftKey && !e.altKey && state.ast && state.ast.modelType === "SPN") {
      const k = e.key.toLowerCase();
      if (k === "s") toggleSimMode();
      else if (k === "f") toggleFocusCanvas();
      else if (!state.simMode) {
        if (k === "v") setTool("select");
        else if (k === "p") setTool("addPlace");
        else if (k === "e") setTool("addExp");
        else if (k === "d") setTool("addDet");
        else if (k === "i") setTool("addImm");
      }
    } else if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
      toggleFocusCanvas();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      state.spacePressed = false;
      dom.svgStage.style.cursor = "";
    }
  });

  dom.btnFormatMry.addEventListener("click", () => {
    syncVisualToMry("Código .mry formatado deterministicamente");
    showToast("Código .mry formatado!");
  });
  dom.btnCopyMry.addEventListener("click", () => {
    navigator.clipboard.writeText(dom.mryEditor.value).then(() => {
      setParseStatus(true, "Código .mry copiado!");
      showToast("Código .mry copiado!");
    });
  });
  dom.btnAutoLayout.addEventListener("click", () => {
    if (!state.ast) return;
    if (state.ast.modelType === "RBD") {
      state.rbdLayout = Core.computeRbdLayout(state.ast);
    } else {
      state.positions = Core.computeAutoLayout(state.ast);
    }
    renderCanvas();
    fitView();
    commitHistory();
  });
  dom.btnRbdAddBlock.addEventListener("click", () => addRbdBlock("block"));
  dom.btnAddZone.addEventListener("click", addZone);
  dom.btnFloatNewZone.addEventListener("click", () => createZoneFromSelection([...state.multiSelected]));
  dom.btnFloatClone.addEventListener("click", () => {
    const cloned = cloneMultiSelection([...state.multiSelected], 40, 40);
    if (cloned.length > 0) {
      state.multiSelected = cloned;
      renderCanvas();
      renderRightPanel();
    }
  });
  dom.btnFloatAlignY.addEventListener("click", () => alignSelection("centerY"));
  dom.btnFloatAlignX.addEventListener("click", () => alignSelection("centerX"));
  dom.btnFloatDelete.addEventListener("click", () => deleteMultiSelection([...state.multiSelected]));
  dom.btnRbdAddHier.addEventListener("click", () => addRbdBlock("hierarchy"));
  dom.btnRbdAddSeries.addEventListener("click", () => addRbdGroup("series"));
  dom.btnRbdAddParallel.addEventListener("click", () => addRbdGroup("parallel"));
  dom.btnRbdAddKooN.addEventListener("click", () => addRbdGroup("kooN"));
  dom.inpMissionTime.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    if (Number.isFinite(val) && val >= 0 && state.ast && state.ast.modelType === "RBD") {
      state.missionTime = val;
      state.audit = Core.auditModel(state.ast, { missionTime: val });
      renderCanvas();
      renderRightPanel();
      scheduleAutosave();
    }
  });
  dom.btnFitView.addEventListener("click", fitView);
  dom.btnRoundTrip.addEventListener("click", verifyRoundTrip);

  dom.chkShowMeta.addEventListener("change", (e) => {
    state.showMeta = e.target.checked;
    renderCanvas();
  });
  dom.chkGravity.addEventListener("change", (e) => {
    state.useGravity = e.target.checked;
    renderCanvas();
    scheduleAutosave();
  });
  const setMirrorsEnabled = (enabled) => {
    state.useMirrors = Boolean(enabled);
    if (dom.chkMirrors) dom.chkMirrors.checked = state.useMirrors;
    if (dom.btnQuickMirrors) {
      dom.btnQuickMirrors.classList.toggle("active", state.useMirrors);
      dom.btnQuickMirrors.setAttribute("aria-pressed", String(state.useMirrors));
    }
    renderCanvas();
    scheduleAutosave();
    setParseStatus(
      true,
      state.useMirrors
        ? `Espelhos ativados (${(state.lastMirrors || []).length} espelhos projetados — código .mry inalterado)`
        : "Modo grafo direto restaurado"
    );
  };
  if (dom.chkMirrors) {
    dom.chkMirrors.addEventListener("change", (e) => setMirrorsEnabled(e.target.checked));
  }
  if (dom.btnQuickMirrors) {
    dom.btnQuickMirrors.addEventListener("click", () => setMirrorsEnabled(!state.useMirrors));
  }
  if (dom.btnToggleSim) dom.btnToggleSim.addEventListener("click", toggleSimMode);
  if (dom.btnSimStep) dom.btnSimStep.addEventListener("click", () => stepSimRandom(1));
  if (dom.btnSimStep5) dom.btnSimStep5.addEventListener("click", () => stepSimRandom(5));
  if (dom.btnSimBack) dom.btnSimBack.addEventListener("click", stepSimBack);
  if (dom.btnSimReset) dom.btnSimReset.addEventListener("click", resetSimMarking);
  if (dom.btnSimExit) dom.btnSimExit.addEventListener("click", () => exitSimMode(false));
  if (dom.chkSimImmPrio) {
    dom.chkSimImmPrio.addEventListener("change", (e) => {
      state.simRespectImm = e.target.checked;
      updateSimBar();
      renderCanvas();
      renderRightPanel();
    });
  }
  dom.chkIeeeMode.addEventListener("change", (e) => {
    state.ieeeMode = e.target.checked;
    renderCanvas();
  });
  dom.arcLabelMode.addEventListener("change", (e) => {
    state.arcLabelMode = e.target.value;
    renderCanvas();
    scheduleAutosave();
  });

  dom.btnOpenFile.addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const diskCode = String(reader.result || "");
      const fileKey = "file:" + f.name;
      const prevMem = getFileMemory(fileKey);

      state.fileKey = fileKey;
      state.fileLabel = f.name;
      state.selected = null;
      state.branchFilter = "ALL";
      dom.mryEditor.value = diskCode;

      if (prevMem) {
        // Restore remembered positions & custom zones indexed by this filename while loading fresh disk code!
        state.positions = deepClone(prevMem.positions || {});
        state.zones = deepClone(prevMem.zones || []);
        state.missionTime = prevMem.missionTime ?? null;
        loadFromCode(diskCode, false, true);
        if (prevMem.view && prevMem.view.w) {
          state.view = deepClone(prevMem.view);
          renderCanvas();
        } else {
          fitView();
        }
        setParseStatus(true, `Arquivo '${f.name}' aberto com memória de layout/áreas restaurada`);
      } else {
        state.positions = {};
        state.zones = [];
        state.missionTime = null;
        loadFromCode(diskCode, true, false);
      }
      resetHistory();
      saveCurrentToMemory();
      rebuildPresetDropdown(true);
    };
    reader.readAsText(f, "utf-8");
    dom.fileInput.value = "";
  });

  dom.btnExportMry.addEventListener("click", () => {
    if (!state.ast) return;
    closeExportMenu();
    const code = Core.generateMry(state.ast, { includeLayoutComment: false, ensureMainBlock: true });
    downloadBlob(`${state.ast.modelName || "model"}.mry`, code, "text/plain;charset=utf-8");
    showToast(`Baixado ${state.ast.modelName || "model"}.mry (compatível com Mercury CLI)`);
  });
  dom.btnExportSvg.addEventListener("click", () => {
    if (!state.ast) return;
    closeExportMenu();
    downloadBlob(`${state.ast.modelName || "model"}.svg`, buildStandaloneSvg(), "image/svg+xml;charset=utf-8");
    showToast(`Exportado ${state.ast.modelName || "model"}.svg`);
  });
  dom.btnExportPng.addEventListener("click", () => {
    closeExportMenu();
    exportPng();
    showToast(`Exportando ${state.ast.modelName || "model"}.png...`);
  });
  dom.btnResetMemory.addEventListener("click", () => {
    closeExportMenu();
    showToast("Memória restaurada para o original");
  });

  // Preset & Saved-File Memory Selector
  dom.presetSelect.addEventListener("change", () => {
    const key = dom.presetSelect.value;
    dom.presetSelect.blur();
    if (!key) return;
    if (key.startsWith("preset:")) {
      const pid = key.slice(7);
      const p = PRESETS.find((x) => x.id === pid);
      if (p) openWorkspaceEntry(key, p.name, p.code, true);
    } else if (key.startsWith("file:")) {
      const mem = getFileMemory(key);
      const idx = loadMemoryIndex();
      const label = (idx[key] && idx[key].displayName) || key.slice(5);
      if (mem && mem.code) openWorkspaceEntry(key, label, mem.code, true);
    }
  });

  // Boot: default to VS Code Zen Split (Code + Editable Diagram Preview) on desktop
  if (window.innerWidth < 900 && dom.legendOverlay) {
    dom.legendOverlay.dataset.collapsed = "1";
  }
  setLayoutMode("zen", false);
  rebuildPresetDropdown(false);
  let booted = false;
  try {
    const lastKey = localStorage.getItem(STORAGE_LAST_KEY);
    if (lastKey) {
      if (lastKey.startsWith("preset:")) {
        const pr = PRESETS.find((x) => x.id === lastKey.slice(7));
        if (pr) {
          openWorkspaceEntry(lastKey, pr.name, pr.code, true);
          booted = true;
        }
      } else if (lastKey.startsWith("file:")) {
        const mem = getFileMemory(lastKey);
        if (mem && mem.code) {
          openWorkspaceEntry(lastKey, lastKey.slice(5), mem.code, true);
          booted = true;
        }
      }
    }
  } catch (_) {}

  if (!booted && PRESETS.length > 0) {
    openWorkspaceEntry("preset:" + PRESETS[0].id, PRESETS[0].name, PRESETS[0].code, true);
  }

  // Optional URL parameters for deep-linking / embedded dual-model split (?preset=...&mirrors=1&sim=1&focus=1&zen=1&empty=1&room=...&split=1&embedded=1)
  try {
    const qp = new URLSearchParams(window.location.search);
    if (qp.get("embedded") === "1") {
      if (dom.btnSplitModel) dom.btnSplitModel.style.display = "none";
      if (dom.btnCloseEmbeddedSplit) dom.btnCloseEmbeddedSplit.style.display = "inline-flex";
    }
    const qPreset = qp.get("preset");
    if (qPreset) {
      const pr = PRESETS.find((x) => x.id === qPreset);
      if (pr) openWorkspaceEntry("preset:" + pr.id, pr.name, pr.code, false);
    }
    if (qp.get("mirrors") === "1") {
      setMirrorsEnabled(true);
    }
    if (qp.get("focus") === "1" || qp.get("mode") === "canvas") {
      setLayoutMode("canvas", true);
    } else if (qp.get("mode") === "studio") {
      setLayoutMode("studio", true);
    } else if (qp.get("zen") === "1" || qp.get("mode") === "zen") {
      setLayoutMode("zen", true);
    }
    if (qp.get("empty") === "1") {
      enterEmptyEditorState();
    }
    if (qp.get("room")) {
      startCollabSession(qp.get("room"));
    }
    if (qp.get("split") === "1" && qp.get("embedded") !== "1") {
      toggleSplitModel(true);
    }
    if (qp.get("sim") === "1" && state.ast && state.ast.modelType === "SPN") {
      enterSimMode();
      const steps = Math.max(0, Math.min(20, Number(qp.get("steps") || 0)));
      if (steps > 0) stepSimRandom(steps);
    }
    const qTab = qp.get("tab");
    if (qTab && ["inspector", "manifest", "params", "audit"].includes(qTab)) {
      state.activeTab = qTab;
      updateTabButtons();
      renderRightPanel();
    }
  } catch (_) {}
})();
