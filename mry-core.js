/**
 * MRY Visual Studio — Deterministic Bidirectional MRY <-> AST Core Engine
 * Compatible with Mercury 6.2 / 7.0 Scripting Language (.mry)
 * Zero heuristics, zero data loss on round-trip.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MryCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // =========================================================================
  // 1. LEXER
  // =========================================================================
  function tokenize(source) {
    const tokens = [];
    const layoutComments = [];
    let i = 0;
    let line = 1;
    let col = 1;
    const len = source.length;

    function advance(n = 1) {
      for (let k = 0; k < n; k++) {
        if (source[i] === "\n") {
          line++;
          col = 1;
        } else {
          col++;
        }
        i++;
      }
    }

    while (i < len) {
      const ch = source[i];

      // Whitespace
      if (/\s/.test(ch)) {
        advance();
        continue;
      }

      // Single-line comment
      if (ch === "/" && source[i + 1] === "/") {
        const start = i;
        while (i < len && source[i] !== "\n") advance();
        const text = source.slice(start, i);
        if (text.includes("@mry-layout") || text.includes("@mry-koon")) layoutComments.push(text);
        continue;
      }

      // Multi-line comment
      if (ch === "/" && source[i + 1] === "*") {
        const start = i;
        advance(2);
        while (i < len && !(source[i] === "*" && source[i + 1] === "/")) {
          advance();
        }
        if (i < len) advance(2);
        const text = source.slice(start, i);
        if (text.includes("@mry-layout") || text.includes("@mry-koon")) layoutComments.push(text);
        continue;
      }

      // String literal
      if (ch === '"') {
        const startLine = line;
        const startCol = col;
        const startIdx = i;
        advance(); // opening quote
        let val = "";
        while (i < len && source[i] !== '"') {
          if (source[i] === "\\" && i + 1 < len) {
            val += source[i] + source[i + 1];
            advance(2);
          } else {
            val += source[i];
            advance();
          }
        }
        if (i < len && source[i] === '"') {
          advance();
        } else {
          throw new SyntaxError(`String não fechada na linha ${startLine}, coluna ${startCol}`);
        }
        tokens.push({ type: "STRING", value: val, raw: source.slice(startIdx, i), line: startLine, col: startCol, start: startIdx, end: i });
        continue;
      }

      // Punctuation
      if ("{}()[],;=".includes(ch)) {
        tokens.push({ type: ch, value: ch, line, col, start: i, end: i + 1 });
        advance();
        continue;
      }

      // Number (int / float / scientific)
      if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(source[i + 1] || ""))) {
        const startLine = line;
        const startCol = col;
        const startIdx = i;
        if (ch === "-") advance();
        while (i < len && /[0-9]/.test(source[i])) advance();
        if (source[i] === "." && /[0-9]/.test(source[i + 1] || "")) {
          advance();
          while (i < len && /[0-9]/.test(source[i])) advance();
        }
        if ((source[i] === "e" || source[i] === "E") && /[0-9+\-]/.test(source[i + 1] || "")) {
          advance();
          if (source[i] === "+" || source[i] === "-") advance();
          while (i < len && /[0-9]/.test(source[i])) advance();
        }
        const val = source.slice(startIdx, i);
        tokens.push({ type: "NUMBER", value: val, line: startLine, col: startCol, start: startIdx, end: i });
        continue;
      }

      // Identifier
      if (/[A-Za-z_]/.test(ch)) {
        const startLine = line;
        const startCol = col;
        const startIdx = i;
        while (i < len && /[A-Za-z0-9_]/.test(source[i])) advance();
        const val = source.slice(startIdx, i);
        tokens.push({ type: "IDENT", value: val, line: startLine, col: startCol, start: startIdx, end: i });
        continue;
      }

      // Other operator chars (+ - * / . etc.)
      const startLine = line;
      const startCol = col;
      const startIdx = i;
      advance();
      tokens.push({ type: "OP", value: ch, line: startLine, col: startCol, start: startIdx, end: i });
    }

    tokens.push({ type: "EOF", value: "", line, col, start: i, end: i });
    return { tokens, layoutComments };
  }

  // =========================================================================
  // 2. RECURSIVE-DESCENT DETERMINISTIC PARSER
  // =========================================================================
  function parseMry(source) {
    const cleanSource = source.replace(/^\uFEFF/, ""); // Strip UTF-8 BOM if present
    const { tokens, layoutComments } = tokenize(cleanSource);
    let pos = 0;

    function peek(offset = 0) {
      return tokens[Math.min(pos + offset, tokens.length - 1)];
    }

    function next() {
      return tokens[pos++];
    }

    function expect(type) {
      const tok = peek();
      if (tok.type !== type) {
        throw new SyntaxError(
          `Esperado '${type}', mas encontrado '${tok.value || tok.type}' na linha ${tok.line}, coluna ${tok.col}`
        );
      }
      return next();
    }

    function readRawUntil(stopTypes) {
      const startTok = peek();
      let depthParen = 0;
      let depthBrack = 0;
      let depthBrace = 0;
      let endIdx = startTok.start;

      while (peek().type !== "EOF") {
        const t = peek();
        if (depthParen === 0 && depthBrack === 0 && depthBrace === 0 && stopTypes.includes(t.type)) {
          break;
        }
        if (t.type === "(") depthParen++;
        else if (t.type === ")") depthParen--;
        else if (t.type === "[") depthBrack++;
        else if (t.type === "]") depthBrack--;
        else if (t.type === "{") depthBrace++;
        else if (t.type === "}") depthBrace--;
        endIdx = t.end;
        next();
      }
      return cleanSource.slice(startTok.start, endIdx).trim();
    }

    function readBalancedBlock(openChar, closeChar) {
      const openTok = expect(openChar);
      let depth = 1;
      let lastEnd = openTok.end;
      while (peek().type !== "EOF" && depth > 0) {
        const t = next();
        if (t.type === openChar) depth++;
        else if (t.type === closeChar) depth--;
        if (depth > 0) lastEnd = t.end;
      }
      if (depth !== 0) {
        throw new SyntaxError(`Bloco '${openChar}...${closeChar}' não fechado (iniciado na linha ${openTok.line})`);
      }
      return cleanSource.slice(openTok.end, lastEnd);
    }

    function parseArcList() {
      const arcs = [];
      expect("[");
      while (peek().type !== "]" && peek().type !== "EOF") {
        const placeTok = expect("IDENT");
        let multiplicity = "1";
        let isStringExpr = false;

        if (peek().type === "(") {
          next(); // '('
          if (peek().type === "STRING" && peek(1).type === ")") {
            const s = next();
            multiplicity = s.value.trim();
            isStringExpr = true;
            expect(")");
          } else {
            const rawMult = readRawUntil([")"]);
            multiplicity = (rawMult || "1").trim();
            isStringExpr = false;
            expect(")");
          }
        }

        const isConditional =
          isStringExpr ||
          /IF\s*\(/i.test(multiplicity) ||
          /#[A-Za-z_]/.test(multiplicity);
        const isNumeric = !isStringExpr && /^[0-9]+(\.[0-9]+)?$/.test(multiplicity);

        arcs.push({
          place: placeTok.value,
          multiplicity: multiplicity,
          isStringExpr: isStringExpr,
          isConditional: isConditional,
          isNumeric: isNumeric
        });

        if (peek().type === ",") next();
      }
      expect("]");
      return arcs;
    }

    function parseStructuredDelay() {
      // Parses: ( type = "Deterministic", parameters = ( Value = requestTimeout_T1 ) )
      const startTok = peek();
      const rawContent = readBalancedBlock("(", ")").trim();
      const fullRaw = `(${rawContent})`;

      // Extract type and parameters deterministically via sub-tokens
      const sub = tokenize(rawContent).tokens;
      let sp = 0;
      let distType = "Custom";
      const params = [];

      while (sp < sub.length && sub[sp].type !== "EOF") {
        if (sub[sp].type === "IDENT" && sub[sp + 1] && sub[sp + 1].type === "=") {
          const k = sub[sp].value;
          sp += 2;
          if (k === "type" && sub[sp] && sub[sp].type === "STRING") {
            distType = sub[sp].value;
            sp++;
          } else if (k === "parameters" && sub[sp] && sub[sp].type === "(") {
            sp++; // '('
            while (sp < sub.length && sub[sp].type !== ")" && sub[sp].type !== "EOF") {
              if (sub[sp].type === "IDENT" && sub[sp + 1] && sub[sp + 1].type === "=") {
                const pk = sub[sp].value;
                sp += 2;
                let pv = "";
                while (sp < sub.length && sub[sp].type !== "," && sub[sp].type !== ")" && sub[sp].type !== "EOF") {
                  pv += sub[sp].raw || sub[sp].value;
                  sp++;
                }
                params.push({ key: pk, value: pv.trim() });
              } else {
                sp++;
              }
              if (sub[sp] && sub[sp].type === ",") sp++;
            }
            if (sub[sp] && sub[sp].type === ")") sp++;
          } else {
            sp++;
          }
        } else {
          sp++;
        }
        if (sub[sp] && sub[sp].type === ",") sp++;
      }

      return {
        delayType: distType,
        delayExpr: params.length > 0 ? params[0].value : rawContent,
        delayParams: params,
        delayRaw: fullRaw,
        isStructuredDelay: true
      };
    }

    function parsePlaceStatement() {
      const startTok = expect("IDENT"); // "place"
      const nameTok = expect("IDENT");
      let tokensExpr = "0";
      let hasExplicitTokens = false;
      const extraProps = [];

      if (peek().type === "(") {
        next(); // '('
        while (peek().type !== ")" && peek().type !== "EOF") {
          if (peek().type === "IDENT" && peek(1).type === "=") {
            const propKey = next().value;
            next(); // '='
            const propVal = readRawUntil([",", ")"]);
            if (propKey === "tokens") {
              tokensExpr = propVal;
              hasExplicitTokens = true;
            } else {
              extraProps.push({ key: propKey, raw: propVal });
            }
          } else {
            // Shorthand: place P1(10)
            tokensExpr = readRawUntil([",", ")"]);
            hasExplicitTokens = true;
          }
          if (peek().type === ",") next();
        }
        expect(")");
      }
      expect(";");

      return {
        name: nameTok.value,
        tokens: tokensExpr,
        hasExplicitTokens,
        extraProps,
        line: startTok.line
      };
    }

    function parseTransitionStatement(kind) {
      const startTok = next(); // timedTransition or immediateTransition
      const nameTok = expect("IDENT");
      const tr = {
        name: nameTok.value,
        kind: kind, // "timed" | "immediate"
        inputs: [],
        outputs: [],
        inhibitors: [],
        delayType: kind === "timed" ? "Exponential" : "Immediate",
        delayExpr: kind === "timed" ? "1.0" : "",
        delayParams: [],
        delayRaw: "",
        isStructuredDelay: false,
        serverType: null, // null = omitted (SingleServer default for timed)
        guard: "",
        guardKey: "enablingFunction",
        priority: "",
        weight: "",
        policy: "",
        extraProps: [],
        line: startTok.line
      };

      expect("(");
      while (peek().type !== ")" && peek().type !== "EOF") {
        const propKey = expect("IDENT").value;
        expect("=");

        if (propKey === "inputs") {
          tr.inputs = parseArcList();
        } else if (propKey === "outputs") {
          tr.outputs = parseArcList();
        } else if (propKey === "inhibitors" || propKey === "inhibitor") {
          tr.inhibitors = parseArcList();
        } else if (propKey === "delay") {
          if (peek().type === "(") {
            const parsed = parseStructuredDelay();
            tr.delayType = parsed.delayType;
            tr.delayExpr = parsed.delayExpr;
            tr.delayParams = parsed.delayParams;
            tr.delayRaw = parsed.delayRaw;
            tr.isStructuredDelay = true;
          } else {
            const rawVal = readRawUntil([",", ")"]);
            tr.delayType = "Exponential";
            tr.delayExpr = rawVal;
            tr.delayRaw = rawVal;
            tr.isStructuredDelay = false;
          }
        } else if (propKey === "serverType") {
          if (peek().type === "STRING") {
            tr.serverType = next().value;
          } else {
            tr.serverType = readRawUntil([",", ")"]).replace(/^"|"$/g, "");
          }
        } else if (propKey === "guard" || propKey === "enablingFunction" || propKey === "guardExpression") {
          tr.guardKey = kind === "timed" ? "guardExpression" : "enablingFunction";
          if (peek().type === "STRING") {
            tr.guard = next().value.trim();
          } else {
            const rawG = readRawUntil([",", ")"]).replace(/^"|"$/g, "").trim();
            tr.guard = rawG.replace(/==/g, "=").replace(/!=/g, "/=");
          }
        } else if (propKey === "priority") {
          tr.priority = readRawUntil([",", ")"]);
        } else if (propKey === "weight") {
          tr.weight = readRawUntil([",", ")"]);
        } else if (propKey === "policy") {
          if (peek().type === "STRING") tr.policy = next().value;
          else tr.policy = readRawUntil([",", ")"]).replace(/^"|"$/g, "");
        } else {
          const rawVal = readRawUntil([",", ")"]);
          tr.extraProps.push({ key: propKey, raw: rawVal });
        }

        if (peek().type === ",") next();
      }
      expect(")");
      expect(";");

      return tr;
    }

    function parseMetricStatement() {
      const startTok = expect("IDENT"); // "metric"
      const nameTok = expect("IDENT");
      expect("=");
      const rawExpr = readRawUntil([";"]);
      expect(";");

      // Extract evaluation type and expression="..." if present
      const funcMatch = rawExpr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      const evalType = funcMatch ? funcMatch[1] : "custom";
      const exprMatch = rawExpr.match(/expression\s*=\s*"([^"]*)"/);
      const expression = exprMatch ? exprMatch[1] : "";

      return {
        name: nameTok.value,
        evalType,
        expression,
        raw: rawExpr,
        line: startTok.line
      };
    }

    function parseRbdBlockStatement() {
      const startTok = expect("IDENT"); // "block"
      const nameTok = expect("IDENT");
      let mttf = "";
      let mttr = "";
      const extraProps = [];
      expect("(");
      while (peek().type !== ")" && peek().type !== "EOF") {
        const key = expect("IDENT").value;
        expect("=");
        const val = readRawUntil([",", ")"]);
        if (key.toUpperCase() === "MTTF") mttf = val;
        else if (key.toUpperCase() === "MTTR") mttr = val;
        else extraProps.push({ key, raw: val });
        if (peek().type === ",") next();
      }
      expect(")");
      expect(";");
      return { name: nameTok.value, kind: "block", mttf, mttr, extraProps, line: startTok.line };
    }

    function parseRbdHierarchyStatement() {
      const startTok = expect("IDENT"); // "hierarchy"
      const nameTok = expect("IDENT");
      let availability = "";
      let reliability = "";
      const extraProps = [];
      expect("(");
      while (peek().type !== ")" && peek().type !== "EOF") {
        const key = expect("IDENT").value;
        expect("=");
        const val = readRawUntil([",", ")"]);
        if (key.toLowerCase() === "availability") availability = val;
        else if (key.toLowerCase() === "reliability") reliability = val;
        else extraProps.push({ key, raw: val });
        if (peek().type === ",") next();
      }
      expect(")");
      expect(";");
      return { name: nameTok.value, kind: "hierarchy", availability, reliability, extraProps, line: startTok.line };
    }

    function parseRbdGroupStatement(groupKind) {
      const startTok = next(); // series | parallel | kooN | koutofn | kofn | koon
      const nameTok = expect("IDENT");
      const children = [];
      let k = "";
      let n = "";
      let mttf = "";
      let mttr = "";
      expect("(");
      while (peek().type !== ")" && peek().type !== "EOF") {
        if (peek().type === "IDENT" && peek(1).type === "=") {
          const pk = next().value;
          next(); // '='
          const pv = readRawUntil([",", ")"]);
          const pkLow = pk.toLowerCase();
          if (pkLow === "k") k = pv;
          else if (pkLow === "n") n = pv;
          else if (pkLow === "mttf") mttf = pv;
          else if (pkLow === "mttr") mttr = pv;
        } else {
          const item = readRawUntil([",", ")"]);
          if (item) children.push(item);
        }
        if (peek().type === ",") next();
      }
      expect(")");
      expect(";");
      return {
        name: nameTok.value,
        kind: groupKind, // "series" | "parallel" | "kooN"
        k: groupKind === "kooN" ? (k || "1") : "",
        n: groupKind === "kooN" ? n : "",
        mttf: groupKind === "kooN" ? mttf : "",
        mttr: groupKind === "kooN" ? mttr : "",
        children,
        line: startTok.line
      };
    }

    // Parse full file
    const ast = {
      parameters: [],
      modelType: "SPN",
      modelName: "Model",
      places: [],
      transitions: [],
      // RBD-specific fields
      blocks: [],
      groups: [],
      top: "",
      // Shared fields
      metrics: [],
      mainBlock: "",
      layout: {},
      zones: null, // Optional editable visual areas for SPN
      otherStatements: []
    };

    const koonCommentChildren = {};
    // Parse layout/zones and @mry-koon comments if present
    for (const lc of layoutComments) {
      const m = lc.match(/@mry-layout\s+(\{[\s\S]*?\})\s*(?:\*\/)?$/);
      if (m) {
        try {
          const parsed = JSON.parse(m[1]);
          if (parsed && typeof parsed === "object" && (parsed.positions || parsed.zones)) {
            ast.layout = parsed.positions || {};
            if (Array.isArray(parsed.zones)) ast.zones = parsed.zones;
          } else {
            ast.layout = parsed;
          }
        } catch (_) {
          // Ignore malformed layout hint safely
        }
      }
      const km = lc.match(/@mry-koon\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\n*]+?)\s*(?:\*\/)?$/);
      if (km) {
        const gName = km[1].trim();
        const chList = km[2].split(",").map((s) => s.trim()).filter(Boolean);
        if (chList.length > 0) koonCommentChildren[gName] = chList;
      }
    }

    while (peek().type !== "EOF") {
      const t = peek();

      if (t.type === "IDENT" && t.value === "SPN") {
        next(); // SPN
        const spnName = expect("IDENT").value;
        // Skip auto-generated Mercury 6.2 CLI currentSPN bootstrap block (<ModelName>_Init)
        if (/_Init$/.test(spnName)) {
          readBalancedBlock("{", "}");
          continue;
        }
        ast.modelType = "SPN";
        ast.modelName = spnName;
        expect("{");
        while (peek().type !== "}" && peek().type !== "EOF") {
          const st = peek();
          if (st.type === "IDENT" && st.value === "place") {
            ast.places.push(parsePlaceStatement());
          } else if (st.type === "IDENT" && st.value === "timedTransition") {
            ast.transitions.push(parseTransitionStatement("timed"));
          } else if (st.type === "IDENT" && st.value === "immediateTransition") {
            ast.transitions.push(parseTransitionStatement("immediate"));
          } else if (st.type === "IDENT" && st.value === "metric") {
            ast.metrics.push(parseMetricStatement());
          } else {
            const unknownRaw = readRawUntil([";", "}"]);
            if (peek().type === ";") next();
            if (unknownRaw) ast.otherStatements.push(unknownRaw);
          }
        }
        expect("}");
      } else if (t.type === "IDENT" && t.value === "RBD") {
        next(); // RBD
        ast.modelType = "RBD";
        ast.modelName = expect("IDENT").value;
        expect("{");
        while (peek().type !== "}" && peek().type !== "EOF") {
          const st = peek();
          if (st.type === "IDENT" && st.value === "block") {
            ast.blocks.push(parseRbdBlockStatement());
          } else if (st.type === "IDENT" && st.value === "hierarchy") {
            ast.blocks.push(parseRbdHierarchyStatement());
          } else if (st.type === "IDENT" && st.value === "series") {
            ast.groups.push(parseRbdGroupStatement("series"));
          } else if (st.type === "IDENT" && st.value === "parallel") {
            ast.groups.push(parseRbdGroupStatement("parallel"));
          } else if (st.type === "IDENT" && /^(kooN|koon|koutofn|kofn)$/i.test(st.value)) {
            ast.groups.push(parseRbdGroupStatement("kooN"));
          } else if (st.type === "IDENT" && st.value === "top") {
            next(); // top
            ast.top = expect("IDENT").value;
            expect(";");
          } else if (st.type === "IDENT" && st.value === "metric") {
            ast.metrics.push(parseMetricStatement());
          } else {
            const unknownRaw = readRawUntil([";", "}"]);
            if (peek().type === ";") next();
            if (unknownRaw) ast.otherStatements.push(unknownRaw);
          }
        }
        expect("}");
      } else if (t.type === "IDENT" && t.value === "main") {
        next(); // main
        let rawMain = readBalancedBlock("{", "}");
        // Strip auto-injected Mercury CLI bootstrap statements from mainBlock
        rawMain = rawMain
          .replace(/^[ \t]*setIntegerParameters\s*\([^;]*\)\s*;\s*\r?\n?/gm, "")
          .replace(/^[ \t]*_init\s*=\s*solve\s*\(\s*[A-Za-z0-9_]+_Init\s*,\s*_init_m\s*\)\s*;\s*\r?\n?/gm, "");
        ast.mainBlock = rawMain;
      } else if (t.type === "IDENT" && peek(1).type === "=") {
        const paramName = next().value;
        next(); // '='
        const paramVal = readRawUntil([";"]);
        expect(";");
        ast.parameters.push({ name: paramName, value: paramVal, line: t.line });
      } else {
        throw new SyntaxError(
          `Declaração inesperada '${t.value || t.type}' na linha ${t.line}, coluna ${t.col}`
        );
      }
    }

    // Reattach @mry-koon children or synthesize children for pure dictionary koon statements
    if (ast.modelType === "RBD") {
      for (const g of ast.groups || []) {
        if (g.kind === "kooN") {
          if (koonCommentChildren[g.name] && koonCommentChildren[g.name].length > 0) {
            g.children = koonCommentChildren[g.name];
          } else if ((!g.children || g.children.length === 0) && g.n) {
            const nCount = Math.max(1, parseInt(g.n, 10) || 1);
            // Match declared blocks that share (mttf, mttr) if available
            const matching = (ast.blocks || []).filter(
              (b) => b.kind === "block" && (!g.mttf || b.mttf === g.mttf) && (!g.mttr || b.mttr === g.mttr)
            );
            if (matching.length === nCount) {
              g.children = matching.map((b) => b.name);
            } else {
              const synth = [];
              for (let idx = 1; idx <= nCount; idx++) {
                const bName = `${g.name}_B${idx}`;
                if (!(ast.blocks || []).some((b) => b.name === bName)) {
                  ast.blocks.push({
                    name: bName,
                    kind: "block",
                    mttf: g.mttf || "1000.0",
                    mttr: g.mttr || "1.0",
                    extraProps: [],
                    line: g.line
                  });
                }
                synth.push(bName);
              }
              g.children = synth;
            }
          }
        }
      }
    }

    return ast;
  }

  // =========================================================================
  // 3. DETERMINISTIC MRY GENERATOR (AST -> .mry, Formal Mercury 6.2 Grammar)
  // =========================================================================
  // Exact reserved words from org/modcs/tools/parser/lexical/lexico.flex (lines 110-191)
  const MERCURY_RESERVED_WORDS = new Set([
    "P", "E", "in", "out", "up", "top", "set", "arc", "ET",
    "state", "event", "rate", "model", "metric", "reward", "measure",
    "block", "series", "parallel", "koon", "hierarchy", "MTTF", "MTTR",
    "main", "print", "println", "for", "range", "solve", "solve_rm",
    "place", "SPN", "OPN", "SubNet", "subnet", "RBD", "DRBD", "CTMC", "DTMC", "EFM",
    "timedTransition", "timeTransition", "immediateTransition", "substitutionTransition", "eventTransition",
    "inputs", "outputs", "delay", "interval", "inhibitors", "weight", "priority",
    "enablingFunction", "onFiring", "serverType", "guardExpression",
    "if", "then", "else", "IF", "ELSE", "function", "filters", "extends",
    "probability", "component", "SDEP", "SPARE", "SHARED",
    "AND", "OR", "NOT", "true", "false", "tokens"
  ]);

  const MERCURY_IDENT_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

  function stripOuterBalancedParens(str) {
    let s = String(str || "").trim();
    while (s.startsWith("(") && s.endsWith(")")) {
      let depth = 0;
      let balanced = true;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")") depth--;
        if (depth === 0 && i < s.length - 1) {
          balanced = false;
          break;
        }
      }
      if (balanced) s = s.slice(1, -1).trim();
      else break;
    }
    return s;
  }

  function splitTopLevelLogicOps(str) {
    const s = stripOuterBalancedParens(str);
    const parts = [];
    let depth = 0;
    let lastIdx = 0;
    let i = 0;
    while (i < s.length) {
      if (s[i] === "(") {
        depth++;
        i++;
      } else if (s[i] === ")") {
        depth = Math.max(0, depth - 1);
        i++;
      } else if (depth === 0) {
        const rest = s.slice(i);
        const m = rest.match(/^(?:\s+|\b)(AND|OR)(?:\s+|\b|(?=\())/);
        if (m && (i === 0 || /[\s)]/.test(s[i - 1]) || /\b/.test(s.slice(i - 1, i + 1)))) {
          const op = m[1];
          const opStart = i + rest.indexOf(op);
          const opEnd = opStart + op.length;
          const prevCh = opStart > 0 ? s[opStart - 1] : " ";
          const nextCh = opEnd < s.length ? s[opEnd] : " ";
          if (/[\s)]/.test(prevCh) && /[\s(]/.test(nextCh)) {
            parts.push({ type: "clause", text: s.slice(lastIdx, opStart).trim() });
            parts.push({ type: "op", text: op });
            i = opEnd;
            lastIdx = i;
            continue;
          }
        }
        i++;
      } else {
        i++;
      }
    }
    parts.push({ type: "clause", text: s.slice(lastIdx).trim() });
    return parts.filter((p) => p.type === "op" || p.text.length > 0);
  }

  /**
   * Formats a boolean condition into Mercury LogicCondition.java's exact zero-whitespace
   * parenthesized grammar: e.g. "(#Failed>0)" or "((#InService_T1=0)AND(#Queued_T1=0))".
   * Recall LogicCondition.java checks str.charAt(0)=='(' && str.charAt(len-1)==')' WITHOUT .trim()!
   */
  function normalizeMercuryLogicCondition(condStr) {
    let s = stripOuterBalancedParens(condStr)
      .replace(/==/g, "=")
      .replace(/!=/g, "/=");
    if (!s) return "";
    if (/^NOT\s*\(/i.test(s)) {
      const inner = s.replace(/^NOT\s*/i, "");
      return `(NOT${normalizeMercuryLogicCondition(inner)})`;
    }
    const parts = splitTopLevelLogicOps(s);
    if (parts.length <= 1) {
      const atom = stripOuterBalancedParens(s).replace(/\s+/g, "");
      return `(${atom})`;
    }
    const formatted = parts
      .map((p) => (p.type === "op" ? p.text : normalizeMercuryLogicCondition(p.text)))
      .join("");
    return `(${formatted})`;
  }

  /**
   * Formats a guard into Mercury parser.cup top-level booleanExpression format
   * for timedTransition `guardExpression = ...` (where equality is `==` and inequality is `!=`,
   * matching SPNModel.java:208).
   */
  function formatTopLevelGuardExpression(condStr) {
    let s = stripOuterBalancedParens(condStr)
      .replace(/\/=/g, "!=")
      .replace(/(?<![<>!=])=(?!=)/g, "==");
    if (!s) return "(1 == 1)";
    if (/^NOT\s*\(/i.test(s)) {
      const inner = s.replace(/^NOT\s*/i, "");
      return `(NOT ${formatTopLevelGuardExpression(inner)})`;
    }
    const parts = splitTopLevelLogicOps(s);
    if (parts.length <= 1) {
      const atom = stripOuterBalancedParens(s)
        .replace(/\s*(==|!=|>=|<=|>|<)\s*/g, " $1 ")
        .trim();
      return `(${atom})`;
    }
    const formatted = parts
      .map((p) => (p.type === "op" ? ` ${p.text} ` : formatTopLevelGuardExpression(p.text)))
      .join("");
    return `(${formatted})`;
  }

  /**
   * Canonicalizes an IF(...):(...)ELSE(...) arc multiplicity string for Mercury 6.2 CLI:
   * 1. Converts each IF condition to canonical LogicCondition format.
   * 2. Prepends a single leading space inside quotes (" IF...") so SPNModel.java:1807
   *    (`str.startsWith("IF")` without .trim()) skips the broken OPN numeric sub-parser,
   *    while IfElseExpression.java:76 (`str.trim()` at bytecode offset 1) parses it cleanly!
   */
  function formatMercuryIfElseArcString(multStr) {
    const s = String(multStr || "").trim();
    if (!/^IF\s*\(/i.test(s)) return s;
    const canon = s.replace(/IF\s*\(([^:]+)\)\s*:\s*\(([^)]+)\)/gi, (_, cond, thenVal) => {
      return `IF${normalizeMercuryLogicCondition(cond)}:(${String(thenVal).trim()})`;
    });
    return ` ${canon}`;
  }

  function formatArc(arc) {
    const mult = (arc.multiplicity || "1").trim();
    if (!mult || mult === "1") {
      return arc.place;
    }
    const needsQuotes =
      arc.isStringExpr ||
      /IF\s*\(/i.test(mult) ||
      /#[A-Za-z_]/.test(mult) ||
      /[\s><=:]/.test(mult);
    if (needsQuotes) {
      const outMult = /^IF\s*\(/i.test(mult) ? formatMercuryIfElseArcString(mult) : mult;
      return `${arc.place}("${outMult}")`;
    }
    return `${arc.place}(${mult})`;
  }

  function formatArcList(arcs, indent) {
    if (!arcs || arcs.length === 0) return "[]";
    const formatted = arcs.map(formatArc);
    const hasLong = formatted.some((s) => s.length > 26);
    if (!hasLong && formatted.join(", ").length <= 72) {
      return `[${formatted.join(", ")}]`;
    }
    return `[\n${formatted.map((s) => `${indent}    ${s}`).join(",\n")}\n${indent}]`;
  }

  function collectIntegerParameterNames(ast) {
    const paramNames = new Set((ast.parameters || []).map((p) => p.name));
    const intParams = new Set();
    for (const pl of ast.places || []) {
      const tok = String(pl.tokens ?? "").trim();
      if (paramNames.has(tok)) intParams.add(tok);
    }
    for (const tr of ast.transitions || []) {
      const prio = String(tr.priority ?? "").trim();
      if (paramNames.has(prio)) intParams.add(prio);
      for (const a of [...(tr.inputs || []), ...(tr.outputs || []), ...(tr.inhibitors || [])]) {
        const m = String(a.multiplicity ?? "").trim();
        if (paramNames.has(m)) intParams.add(m);
      }
    }
    return Array.from(intParams);
  }

  function spnNeedsCurrentSpnBootstrap(ast) {
    if (!ast.places || ast.places.length === 0) return false;
    for (const tr of ast.transitions || []) {
      if (tr.guard && tr.guard.trim() !== "") return true;
      for (const a of [...(tr.inputs || []), ...(tr.outputs || []), ...(tr.inhibitors || [])]) {
        const m = String(a.multiplicity || "").trim();
        if (/IF\s*\(/i.test(m) || /#[A-Za-z_]/.test(m)) return true;
      }
    }
    return false;
  }

  /**
   * Rewrites legacy hallucinated `solve(model = M, metrics = [m1, m2], ...)` blocks
   * into formal Mercury 6.2 `parser.cup` `solve( M, m1 )` calls.
   */
  function normalizeMainBlockForMercury(rawMain, defaultModelName) {
    if (!rawMain || !rawMain.trim()) return "";
    let body = rawMain;
    // Detect `varName = solve( ... metrics = [m1, m2, ...] ... );`
    const multiSolveRe = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*solve\s*\(([\s\S]*?)\)\s*;\s*(?:println\s*\(\s*\1\s*\)\s*;)?/g;
    body = body.replace(multiSolveRe, (fullMatch, varName, argsContent) => {
      if (!/metrics\s*=\s*\[/.test(argsContent)) return fullMatch;
      const modelMatch = argsContent.match(/model\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/);
      const mName = modelMatch ? modelMatch[1] : defaultModelName;
      const listMatch = argsContent.match(/metrics\s*=\s*\[([^\]]+)\]/);
      if (!listMatch) return fullMatch;
      const metricIds = listMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (metricIds.length === 0) return fullMatch;
      return metricIds
        .map((mId) => `${mId}_val = solve( ${mName}, ${mId} );\n    println("${mId} = " .. ${mId}_val);`)
        .join("\n    ");
    });
    return body;
  }

  function generateMry(ast, options = {}) {
    if (ast.modelType === "RBD") {
      return generateRbdMry(ast, options);
    }
    const lines = [];
    const modelName = ast.modelName || "Model";

    // Global parameters
    for (const p of ast.parameters || []) {
      lines.push(`${p.name} = ${p.value};`);
    }
    if ((ast.parameters || []).length > 0) lines.push("");

    const formatPlaceLines = (targetLines) => {
      for (const pl of ast.places || []) {
        const tok = String(pl.tokens ?? "0").trim();
        const props = [];
        if (pl.hasExplicitTokens || (tok !== "" && tok !== "0")) {
          props.push(`tokens = ${tok}`);
        }
        for (const ep of pl.extraProps || []) {
          props.push(`${ep.key} = ${ep.raw}`);
        }
        if (props.length > 0) {
          targetLines.push(`    place ${pl.name}( ${props.join(", ")} );`);
        } else {
          targetLines.push(`    place ${pl.name};`);
        }
      }
    };

    const synthesizedMain =
      (!ast.mainBlock || !ast.mainBlock.trim()) && options.ensureMainBlock && (ast.metrics || []).length > 0
        ? (ast.metrics || [])
            .map((m) => `${m.name}_val = solve( ${modelName}, ${m.name} );\n    println("${m.name} = " .. ${m.name}_val);`)
            .join("\n    ")
        : "";
    const effectiveMainRaw = (ast.mainBlock && ast.mainBlock.trim() !== "") ? ast.mainBlock : synthesizedMain;
    const hasMain = Boolean(effectiveMainRaw && effectiveMainRaw.trim() !== "");
    const needsBoot = hasMain && spnNeedsCurrentSpnBootstrap(ast);

    // Emit headless Mercury 6.2 CLI currentSPN static singleton bootstrap SPN when needed
    if (needsBoot) {
      const firstPlace = ast.places[0].name;
      lines.push(`SPN ${modelName}_Init {`);
      formatPlaceLines(lines);
      lines.push(`    timedTransition _init_tr( inputs = [${firstPlace}], outputs = [${firstPlace}], delay = 1.0 );`);
      lines.push(`    metric _init_m = stationaryAnalysis( expression = "P{#${firstPlace}>=0}" );`);
      lines.push(`}`);
      lines.push("");
    }

    // Main SPN block
    lines.push(`${ast.modelType || "SPN"} ${modelName} {`);

    // Places
    formatPlaceLines(lines);

    if ((ast.places || []).length > 0 && (ast.transitions || []).length > 0) {
      lines.push("");
    }

    // Transitions
    for (const tr of ast.transitions || []) {
      const kw = tr.kind === "immediate" ? "immediateTransition" : "timedTransition";
      const props = [];

      if (tr.inputs && tr.inputs.length > 0) {
        props.push(`inputs = ${formatArcList(tr.inputs, "        ")}`);
      }
      if (tr.outputs && tr.outputs.length > 0) {
        props.push(`outputs = ${formatArcList(tr.outputs, "        ")}`);
      }
      if (tr.inhibitors && tr.inhibitors.length > 0) {
        props.push(`inhibitors = ${formatArcList(tr.inhibitors, "        ")}`);
      }

      if (tr.kind === "timed") {
        if (tr.delayType && tr.delayType !== "Exponential") {
          const params =
            tr.delayParams && tr.delayParams.length > 0
              ? tr.delayParams.map((dp) => `${dp.key} = ${dp.value}`).join(", ")
              : `Value = ${tr.delayExpr || "1.0"}`;
          props.push(`delay = ( type = "${tr.delayType}", parameters = ( ${params} ) )`);
        } else {
          props.push(`delay = ${tr.delayExpr || "1.0"}`);
        }
        if (tr.serverType) {
          props.push(`serverType = "${tr.serverType}"`);
        }
      }

      if (tr.guard && tr.guard.trim() !== "") {
        if (tr.kind === "timed") {
          // Script.java:1703 requires unquoted guardExpression on timedTransition!
          props.push(`guardExpression = ${formatTopLevelGuardExpression(tr.guard)}`);
        } else {
          // Script.java:1695 accepts quoted enablingFunction on immediateTransition
          props.push(`enablingFunction = "${normalizeMercuryLogicCondition(tr.guard)}"`);
        }
      }
      if (tr.priority !== undefined && String(tr.priority).trim() !== "") {
        props.push(`priority = ${String(tr.priority).trim()}`);
      }
      if (tr.weight !== undefined && String(tr.weight).trim() !== "") {
        props.push(`weight = ${String(tr.weight).trim()}`);
      }
      if (tr.policy && tr.policy.trim() !== "") {
        props.push(`policy = "${tr.policy.trim()}"`);
      }
      for (const ep of tr.extraProps || []) {
        props.push(`${ep.key} = ${ep.raw}`);
      }

      // parser.cup requires non-empty spn_transition_parameter_list
      if (props.length === 0) {
        props.push(tr.kind === "immediate" ? "weight = 1.0" : "delay = 1.0");
      }

      lines.push(`    ${kw} ${tr.name}(`);
      for (let i = 0; i < props.length; i++) {
        const comma = i < props.length - 1 ? "," : "";
        lines.push(`        ${props[i]}${comma}`);
      }
      lines.push(`    );`);
      lines.push("");
    }

    // Metrics
    for (const m of ast.metrics || []) {
      lines.push(`    metric ${m.name} = ${m.raw};`);
    }

    // Other statements
    for (const st of ast.otherStatements || []) {
      lines.push(`    ${st};`);
    }

    lines.push("}");

    // Main block
    if (hasMain) {
      const normalizedMain = normalizeMainBlockForMercury(effectiveMainRaw, modelName).trim();
      const intParams = collectIntegerParameterNames(ast);
      const headerStmts = [];
      if (intParams.length > 0) {
        headerStmts.push(`    setIntegerParameters(${intParams.map((p) => `"${p}"`).join(", ")});`);
      }
      if (needsBoot) {
        headerStmts.push(`    _init = solve(${modelName}_Init, _init_m);`);
      }
      lines.push("");
      if (headerStmts.length > 0) {
        lines.push(`main {\n${headerStmts.join("\n")}\n    ${normalizedMain}\n}`);
      } else {
        lines.push(`main {\n    ${normalizedMain}\n}`);
      }
    }

    // Optional layout & zones comment (disabled by default for clean Mercury CLI export)
    if (options.includeLayoutComment) {
      const payload = {};
      if (ast.layout && Object.keys(ast.layout).length > 0) payload.positions = ast.layout;
      if (Array.isArray(ast.zones)) payload.zones = ast.zones;
      if (Object.keys(payload).length > 0) {
        lines.push("");
        lines.push(`/* @mry-layout ${JSON.stringify(payload)} */`);
      }
    }

    return lines.join("\n") + "\n";
  }

  function generateRbdMry(ast, options = {}) {
    const lines = [];
    const blockByName = {};
    for (const b of ast.blocks || []) blockByName[b.name] = b;

    for (const p of ast.parameters || []) {
      lines.push(`${p.name} = ${p.value};`);
    }
    if ((ast.parameters || []).length > 0) lines.push("");

    lines.push(`RBD ${ast.modelName || "RBDModel"} {`);

    // Blocks and hierarchy blocks
    for (const b of ast.blocks || []) {
      if (b.kind === "hierarchy") {
        const props = [];
        if (b.availability !== undefined && String(b.availability).trim() !== "") {
          props.push(`availability = ${String(b.availability).trim()}`);
        }
        if (b.reliability !== undefined && String(b.reliability).trim() !== "") {
          props.push(`reliability = ${String(b.reliability).trim()}`);
        }
        for (const ep of b.extraProps || []) props.push(`${ep.key} = ${ep.raw}`);
        lines.push(`    hierarchy ${b.name}( ${props.join(", ")} );`);
      } else {
        const props = [];
        if (b.mttf !== undefined && String(b.mttf).trim() !== "") {
          props.push(`MTTF = ${String(b.mttf).trim()}`);
        }
        if (b.mttr !== undefined && String(b.mttr).trim() !== "") {
          props.push(`MTTR = ${String(b.mttr).trim()}`);
        }
        for (const ep of b.extraProps || []) props.push(`${ep.key} = ${ep.raw}`);
        lines.push(`    block ${b.name}( ${props.join(", ")} );`);
      }
    }

    if ((ast.blocks || []).length > 0 && (ast.groups || []).length > 0) {
      lines.push("");
    }

    // Series / Parallel / koon groups (lexico.flex line 131 & RBDKOutOfNBlock.java formal grammar)
    const koonComments = [];
    for (const g of ast.groups || []) {
      const children = g.children || [];
      const childrenStr = children.join(", ");
      if (g.kind === "kooN") {
        const kVal = String(g.k || "1").trim();
        const nVal = String(g.n || (children.length > 0 ? children.length : "1")).trim();
        let mttfExpr = g.mttf ? String(g.mttf).trim() : "";
        let mttrExpr = g.mttr ? String(g.mttr).trim() : "";
        if (!mttfExpr || !mttrExpr) {
          for (const chName of children) {
            const cb = blockByName[chName];
            if (cb && cb.kind === "block" && cb.mttf && cb.mttr) {
              if (!mttfExpr) mttfExpr = String(cb.mttf).trim();
              if (!mttrExpr) mttrExpr = String(cb.mttr).trim();
              break;
            }
          }
        }
        if (!mttfExpr) mttfExpr = (ast.blocks && ast.blocks[0] && ast.blocks[0].mttf) || "1000.0";
        if (!mttrExpr) mttrExpr = (ast.blocks && ast.blocks[0] && ast.blocks[0].mttr) || "1.0";
        lines.push(`    koon ${g.name}( k = ${kVal}, n = ${nVal}, mttf = ${mttfExpr}, mttr = ${mttrExpr} );`);
        if (children.length > 0) {
          koonComments.push(`/* @mry-koon ${g.name}: ${childrenStr} */`);
        }
      } else {
        lines.push(`    ${g.kind} ${g.name}( ${childrenStr} );`);
      }
    }

    if (ast.top) {
      lines.push("");
      lines.push(`    top ${ast.top};`);
    }

    if ((ast.metrics || []).length > 0) {
      lines.push("");
      for (const m of ast.metrics || []) {
        lines.push(`    metric ${m.name} = ${m.raw};`);
      }
    }

    for (const st of ast.otherStatements || []) {
      lines.push(`    ${st};`);
    }

    lines.push("}");

    for (const kc of koonComments) {
      lines.push(kc);
    }

    const rbdModelName = ast.modelName || "RBDModel";
    const rbdSynthMain =
      (!ast.mainBlock || !ast.mainBlock.trim()) && options.ensureMainBlock && (ast.metrics || []).length > 0
        ? (ast.metrics || [])
            .map((m) => `${m.name}_val = solve( ${rbdModelName}, ${m.name} );\n    println("${m.name} = " .. ${m.name}_val);`)
            .join("\n    ")
        : "";
    const effectiveRbdMain = (ast.mainBlock && ast.mainBlock.trim() !== "") ? ast.mainBlock.trim() : rbdSynthMain;
    if (effectiveRbdMain) {
      lines.push("");
      lines.push(`main {\n    ${effectiveRbdMain}\n}`);
    }

    return lines.join("\n") + "\n";
  }

  // =========================================================================
  // 4. PARAMETER RESOLVER & FORMAL AUDIT ENGINE ("NADA ESCONDIDO")
  // =========================================================================
  function buildParamMap(ast) {
    const map = {};
    for (const p of ast.parameters || []) {
      const n = Number(p.value);
      map[p.name] = Number.isFinite(n) ? n : p.value;
    }
    return map;
  }

  function resolveValue(expr, paramMap) {
    if (expr === null || expr === undefined) return null;
    const s = String(expr).trim();
    if (s === "") return null;
    if (Object.prototype.hasOwnProperty.call(paramMap, s)) {
      return paramMap[s];
    }
    const n = Number(s);
    if (Number.isFinite(n)) return n;
    return null;
  }

  function summarizeCondition(expr) {
    // Compact human-readable label for IF(...) expressions while preserving exact formula
    let s = String(expr || "").trim();
    if (/^#[A-Za-z0-9_]+$/.test(s)) return s;
    const m = s.match(/^IF\((.+)\):\((.+)\)ELSE\((.+)\)$/i);
    if (m) {
      const cond = m[1]
        .replace(/#/g, "")
        .replace(/InService_/g, "InSvc_")
        .replace(/DeadlinePending_/g, "Dead_")
        .replace(/Queued_/g, "Q_")
        .replace(/Prepared_/g, "Prep_")
        .replace(/\s+AND\s+/gi, " ∧ ")
        .replace(/\s+OR\s+/gi, " ∨ ");
      const thenV = m[2].replace(/#/g, "").replace(/InService_/g, "InSvc_");
      return `[${cond}]→${thenV}`;
    }
    return s.length > 22 ? s.slice(0, 20) + "…" : s;
  }

  function auditModel(ast, opts = {}) {
    if (ast.modelType === "RBD") {
      return auditRbd(ast, opts.missionTime);
    }
    const paramMap = buildParamMap(ast);
    const placeSet = new Set((ast.places || []).map((p) => p.name));
    const usedParams = new Set();
    const placeInDegree = {};
    const placeOutDegree = {};
    for (const p of ast.places || []) {
      placeInDegree[p.name] = 0;
      placeOutDegree[p.name] = 0;
      if (Object.prototype.hasOwnProperty.call(paramMap, String(p.tokens).trim())) {
        usedParams.add(String(p.tokens).trim());
      }
    }

    const stats = {
      places: (ast.places || []).length,
      transitions: (ast.transitions || []).length,
      expTransitions: 0,
      detTransitions: 0,
      otherTimedTransitions: 0,
      immTransitions: 0,
      totalArcs: 0,
      inputArcs: 0,
      outputArcs: 0,
      inhibitorArcs: 0,
      conditionalArcs: 0,
      multiplicityGt1Arcs: 0,
      guardedTransitions: 0,
      metrics: (ast.metrics || []).length,
      parameters: (ast.parameters || []).length
    };

    const hiddenItems = []; // Complete manifest of guards, inhibitors, multiplicities, IF(...), non-default policies
    const warnings = [];
    const conditionalLegend = []; // Unique conditional expressions w1, w2...
    const condExprToTag = {};
    const immByInputPlace = {};

    function registerCondTag(expr) {
      if (!condExprToTag[expr]) {
        const tag = `w${conditionalLegend.length + 1}`;
        condExprToTag[expr] = tag;
        conditionalLegend.push({ tag, expr, summary: summarizeCondition(expr) });
      }
      return condExprToTag[expr];
    }

    for (const tr of ast.transitions || []) {
      if (tr.kind === "immediate") {
        stats.immTransitions++;
      } else if (tr.delayType === "Deterministic") {
        stats.detTransitions++;
      } else if (tr.delayType === "Exponential") {
        stats.expTransitions++;
      } else {
        stats.otherTimedTransitions++;
      }

      // Check delay parameter usage
      if (tr.kind === "timed") {
        const dExpr = String(tr.delayExpr || "").trim();
        if (Object.prototype.hasOwnProperty.call(paramMap, dExpr)) {
          usedParams.add(dExpr);
        } else if (dExpr && !/^[0-9.eE+\-*/() ]+$/.test(dExpr)) {
          warnings.push({
            severity: "warn",
            nodeId: `T:${tr.name}`,
            message: `Transição '${tr.name}' referencia delay '${dExpr}' que não está declarado nos parâmetros globais.`
          });
        }
        if (tr.delayType === "Deterministic") {
          hiddenItems.push({
            category: "Distribuição",
            element: tr.name,
            nodeId: `T:${tr.name}`,
            detail: `Determinística (Value = ${dExpr}${resolveValue(dExpr, paramMap) !== null ? " = " + resolveValue(dExpr, paramMap) : ""})`
          });
        }
        if (!tr.serverType || tr.serverType === "SingleServer") {
          hiddenItems.push({
            category: "ServerType",
            element: tr.name,
            nodeId: `T:${tr.name}`,
            detail: tr.serverType ? "SingleServer (explícito)" : "SingleServer (implícito por padrão do Mercury)"
          });
        } else {
          hiddenItems.push({
            category: "ServerType",
            element: tr.name,
            nodeId: `T:${tr.name}`,
            detail: `${tr.serverType}`
          });
        }
      }

      if (tr.guard && tr.guard.trim() !== "") {
        stats.guardedTransitions++;
        hiddenItems.push({
          category: "Guard",
          element: tr.name,
          nodeId: `T:${tr.name}`,
          detail: `${tr.guardKey || "enablingFunction"} = "${tr.guard}"`
        });
        if (/\s+(AND|OR)\s+/i.test(tr.guard)) {
          warnings.push({
            severity: "info",
            nodeId: `T:${tr.name}`,
            message: `Guard em '${tr.name}' contém espaços ao redor de AND/OR (verifique se a versão do Mercury exige formato sem espaços: '(#A=1)AND(#B=0)').`
          });
        }
      }

      if (tr.priority !== "" || tr.weight !== "") {
        hiddenItems.push({
          category: "Prioridade/Peso",
          element: tr.name,
          nodeId: `T:${tr.name}`,
          detail: `${tr.priority !== "" ? "priority=" + tr.priority : ""}${tr.priority !== "" && tr.weight !== "" ? ", " : ""}${tr.weight !== "" ? "weight=" + tr.weight : ""}`
        });
      }

      const checkArcs = (arcs, dir) => {
        for (const a of arcs || []) {
          stats.totalArcs++;
          if (dir === "in") {
            stats.inputArcs++;
            if (placeOutDegree[a.place] !== undefined) placeOutDegree[a.place]++;
            if (tr.kind === "immediate") {
              if (!immByInputPlace[a.place]) immByInputPlace[a.place] = [];
              immByInputPlace[a.place].push(tr);
            }
          } else if (dir === "out") {
            stats.outputArcs++;
            if (placeInDegree[a.place] !== undefined) placeInDegree[a.place]++;
          } else if (dir === "inh") {
            stats.inhibitorArcs++;
          }

          if (!placeSet.has(a.place)) {
            warnings.push({
              severity: "error",
              nodeId: `T:${tr.name}`,
              message: `Arco (${dir}) em '${tr.name}' referencia lugar inexistente '${a.place}'.`
            });
          }

          const mult = String(a.multiplicity || "1").trim();
          if (dir === "inh") {
            hiddenItems.push({
              category: "Inibidor",
              element: `${a.place} ○→ ${tr.name}`,
              nodeId: `T:${tr.name}`,
              detail: mult !== "1" ? `Inibidor com multiplicidade ${mult}` : `Inibe disparo quando #${a.place} > 0`
            });
          }

          if (a.isConditional || /IF\s*\(/i.test(mult) || /#[A-Za-z_]/.test(mult)) {
            stats.conditionalArcs++;
            const tag = registerCondTag(mult);
            hiddenItems.push({
              category: "Peso Condicional",
              element: dir === "in" ? `${a.place} → ${tr.name}` : dir === "out" ? `${tr.name} → ${a.place}` : `${a.place} ○→ ${tr.name}`,
              nodeId: `T:${tr.name}`,
              detail: `[${tag}] ${mult}`
            });
          } else if (mult !== "1") {
            stats.multiplicityGt1Arcs++;
            if (Object.prototype.hasOwnProperty.call(paramMap, mult)) usedParams.add(mult);
            hiddenItems.push({
              category: "Multiplicidade",
              element: dir === "in" ? `${a.place} → ${tr.name}` : `${tr.name} → ${a.place}`,
              nodeId: `T:${tr.name}`,
              detail: `Peso = ${mult}`
            });
          }
        }
      };

      checkArcs(tr.inputs, "in");
      checkArcs(tr.outputs, "out");
      checkArcs(tr.inhibitors, "inh");
    }

    // Structural warnings: isolated places and formal Mercury 6.2 identifier rules
    const checkMercuryIdentifier = (id, kindLabel, nodeId) => {
      if (MERCURY_RESERVED_WORDS.has(id)) {
        warnings.push({
          severity: "error",
          nodeId,
          message: `${kindLabel} '${id}' usa uma palavra reservada da gramática JFlex do Mercury 6.2 (lexico.flex). Renomeie para evitar erro de sintaxe no CLI.`
        });
      } else if (!MERCURY_IDENT_RE.test(id)) {
        warnings.push({
          severity: "error",
          nodeId,
          message: `${kindLabel} '${id}' viola a regra léxica do Mercury (deve iniciar por letra ASCII e conter apenas letras, dígitos ou '_').`
        });
      }
    };

    for (const p of ast.parameters || []) checkMercuryIdentifier(p.name, "Parâmetro", null);
    for (const m of ast.metrics || []) {
      checkMercuryIdentifier(m.name, "Métrica", null);
      if (stats.detTransitions > 0 && /^stationaryAnalysis|transientAnalysis$/i.test(m.evalType || "")) {
        warnings.push({
          severity: "warn",
          nodeId: null,
          message: `Métrica '${m.name}' usa '${m.evalType}' em um modelo com transição Determinística. No Mercury 6.2 CLI (SPNServices.java), cadeias não-markovianas exigem 'stationarySimulation' ou 'transientSimulation'.`
        });
      }
    }
    for (const tr of ast.transitions || []) {
      checkMercuryIdentifier(tr.name, "Transição", `T:${tr.name}`);
      const arcCount = (tr.inputs?.length || 0) + (tr.outputs?.length || 0) + (tr.inhibitors?.length || 0);
      if (arcCount === 0) {
        warnings.push({
          severity: "warn",
          nodeId: `T:${tr.name}`,
          message: `Transição '${tr.name}' não possui nenhum arco conectado.`
        });
      }
    }

    for (const p of ast.places || []) {
      checkMercuryIdentifier(p.name, "Lugar", `P:${p.name}`);
      const ind = placeInDegree[p.name] || 0;
      const outd = placeOutDegree[p.name] || 0;
      if (ind === 0 && outd === 0) {
        warnings.push({
          severity: "warn",
          nodeId: `P:${p.name}`,
          message: `Lugar '${p.name}' está completamente isolado (sem arcos de entrada ou saída).`
        });
      }
    }

    // Structural warning: competing immediate transitions without distinct priorities
    for (const [plName, trs] of Object.entries(immByInputPlace)) {
      if (trs.length > 1) {
        // Check if they don't belong to mutually exclusive branches (ignore if they have different origin places like ServerQueue + Queued_Ti)
        const sharedSameSingleInput = trs.filter((t) => t.inputs.length === 1);
        if (sharedSameSingleInput.length > 1) {
          const prios = new Set(sharedSameSingleInput.map((t) => String(t.priority || "0")));
          if (prios.size === 1) {
            warnings.push({
              severity: "info",
              nodeId: `P:${plName}`,
              message: `Transições imediatas (${sharedSameSingleInput.map((t) => t.name).join(", ")}) competem por '${plName}' com a mesma prioridade (desempate probabilístico por weight).`
            });
          }
        }
      }
    }

    // Special domain check: ProcessRequest single-server invariant
    const procTr = (ast.transitions || []).find((t) => t.name === "ProcessRequest");
    const serverFree = (ast.places || []).find((p) => p.name === "ServerFree");
    if (procTr && serverFree) {
      const ackOuts = procTr.outputs.filter((a) => a.place.startsWith("Acknowledgment_") && a.isConditional);
      const cap = resolveValue(serverFree.tokens, paramMap);
      if (ackOuts.length >= 2 && cap !== null && cap > 1) {
        warnings.push({
          severity: "error",
          nodeId: `T:ProcessRequest`,
          message: `Invariante violado: 'ServerFree' tem capacidade ${cap} > 1, mas 'ProcessRequest' dispara ACKs condicionais simultâneos para múltiplas origens em um único disparo (quebra conservação de ServerFree/ServerBusy)!`
        });
      } else if (ackOuts.length >= 2) {
        warnings.push({
          severity: "info",
          nodeId: `T:ProcessRequest`,
          message: `Nota estrutural: 'ProcessRequest' usa arcos condicionais sobre #InService_Ti que pressupõem estritamente ServerFree = 1 (servidor único).`
        });
      }
    }

    // Unused parameters
    for (const p of ast.parameters || []) {
      if (!usedParams.has(p.name)) {
        // Check if used in mainBlock
        const inMain = (ast.mainBlock || "").includes(p.name);
        if (!inMain) {
          warnings.push({
            severity: "info",
            nodeId: null,
            message: `Parâmetro '${p.name} = ${p.value}' declarado mas não referenciado diretamente em lugares ou transições.`
          });
        }
      }
    }

    return { stats, hiddenItems, warnings, conditionalLegend, condExprToTag, paramMap };
  }

  // =========================================================================
  // 5. DETERMINISTIC AUTO-LAYOUT ENGINE (TOPOLOGICAL SUGIYAMA + SYMMETRIC)
  // =========================================================================
  function getNodeBranch(name) {
    const m = name.match(/_(T\d+)$/);
    if (m) return m[1];
    if (/Fail|Repair|^UpServer|^DownServer|^DownTurnstile|^UpTurnstile|_Up$|_Down$/i.test(name)) return "INFRA";
    if (/^Server|ProcessRequest/i.test(name)) return "SHARED";
    return "MAIN";
  }

  /**
   * Context-aware branch classifier:
   * Only separates "INFRA" from "MAIN" if the model actually has an operational
   * request/service pipeline AND a separate failure/repair subsystem (like Silo/Hibrido).
   * Pure dependability models (like ColdStandby or HighAvailabilityPair) stay unified!
   */
  function hasSeparateOperationalFlow(ast) {
    const trs = ast.transitions || [];
    const hasOp = trs.some((t) =>
      /Arriv|Register|Spread|Upload|Download|Sync|Generate|Prepare|Transmit|Send|Process|Validate|Acquire|StartService|FinishService/i.test(t.name)
    );
    const hasUpDown = (ast.places || []).some((p) => /^Up|^Down|_Up$|_Down$/i.test(p.name));
    const hasStandby = (ast.places || []).some((p) => /Standby|Backup|Repairman/i.test(p.name));
    if (hasStandby) return false;
    return hasOp && hasUpDown;
  }

  function getContextualBranch(ast, name) {
    const raw = getNodeBranch(name);
    if (raw === "INFRA" && !hasSeparateOperationalFlow(ast)) {
      return "MAIN";
    }
    return raw;
  }

  function computeDefaultZones(ast) {
    const byKey = {};
    const add = (key, id) => {
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(id);
    };
    for (const p of ast.places || []) add(getContextualBranch(ast, p.name), `P:${p.name}`);
    for (const t of ast.transitions || []) add(getContextualBranch(ast, t.name), `T:${t.name}`);

    const keys = Object.keys(byKey).filter((k) => /^T\d+$/.test(k) || k === "SHARED" || k === "INFRA");
    if (keys.length < 2) {
      if (byKey["INFRA"] && byKey["MAIN"]) {
        return [
          { id: "zone_MAIN", label: "FLUXO OPERACIONAL", color: "#0284c7", members: byKey["MAIN"] },
          { id: "zone_INFRA", label: "DEPENDABILIDADE (FALHA / REPARO)", color: "#ef4444", members: byKey["INFRA"] }
        ];
      }
      return [];
    }

    const sorted = keys.sort((a, b) => {
      if (/^T\d+$/.test(a) && /^T\d+$/.test(b)) return Number(a.slice(1)) - Number(b.slice(1));
      if (a === "SHARED") return 1;
      if (b === "SHARED") return -1;
      return a.localeCompare(b);
    });

    return sorted.map((k) => ({
      id: `zone_${k}`,
      label:
        k === "SHARED"
          ? "SERVIDOR CENTRAL COMPARTILHADO"
          : k === "INFRA"
          ? "DEPENDABILIDADE (FALHA / REPARO)"
          : `SUBMODELO CATRACA ${k}`,
      color: k === "SHARED" ? "#6366f1" : k === "INFRA" ? "#ef4444" : "#0284c7",
      members: byKey[k]
    }));
  }

  function computeAutoLayout(ast) {
    const pos = {};
    const branches = new Set();

    for (const p of ast.places || []) {
      const b = getNodeBranch(p.name);
      if (/^T\d+$/.test(b)) branches.add(b);
    }
    for (const t of ast.transitions || []) {
      const b = getNodeBranch(t.name);
      if (/^T\d+$/.test(b)) branches.add(b);
    }

    const sortedBranches = Array.from(branches).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

    // --- STRATEGY A: Symmetric Multi-Turnstile Cloud-Coordinated Architecture ---
    if (sortedBranches.length >= 1) {
      const colX = {
        0: 110,  // Idle_Ti / Synchronize_Ti
        1: 250,  // GenerateArrival_Ti / Synchronization_Ti
        2: 390,  // Arriving_Ti
        3: 530,  // PrepareTicket_Ti
        4: 700,  // DeadlinePending / Outstanding / Prepared
        5: 860,  // RequestTimeout / TransmitRequest
        6: 1020, // TimedOut / Queued / ServerQueue
        7: 1180, // RecycleTimeout / AcquireServer / ServerFree
        8: 1340, // Acknowledgment / InService / ServerBusy
        9: 1500  // ReceiveAcknowledgment / ProcessRequest
      };

      const branchHeight = 400;
      const sharedBandHeight = 200;
      const topPad = 100;
      const midSplit = Math.ceil(sortedBranches.length / 2);
      const sharedCenterY = topPad + midSplit * branchHeight + sharedBandHeight / 2;

      sortedBranches.forEach((br, idx) => {
        const isLower = idx >= midSplit;
        const baseY = isLower
          ? topPad + midSplit * branchHeight + sharedBandHeight + (idx - midSplit) * branchHeight
          : topPad + idx * branchHeight;

        const rowY = (r) => {
          const rowStep = 105;
          return !isLower ? baseY + r * rowStep : baseY + (3 - r) * rowStep;
        };

        const slots = {
          [`Synchronize_${br}`]:      [colX[0], rowY(0)],
          [`Synchronization_${br}`]:  [colX[2], rowY(0)],
          [`DeadlinePending_${br}`]:  [colX[4], rowY(0)],
          [`RequestTimeout_${br}`]:   [colX[5], rowY(0)],
          [`TimedOut_${br}`]:         [colX[6], rowY(0)],
          [`RecycleTimeout_${br}`]:   [colX[7], rowY(0)],
          [`Acknowledgment_${br}`]:   [colX[8], rowY(0)],

          [`Idle_${br}`]:             [colX[0], rowY(1.5)],
          [`GenerateArrival_${br}`]:  [colX[1], rowY(1.5)],
          [`Arriving_${br}`]:         [colX[2], rowY(1.5)],
          [`PrepareTicket_${br}`]:    [colX[3], rowY(1.5)],
          [`Outstanding_${br}`]:      [colX[5], rowY(1.5)],
          [`ReceiveAcknowledgment_${br}`]: [colX[9], rowY(1.5)],

          [`Prepared_${br}`]:         [colX[4], rowY(3)],
          [`TransmitRequest_${br}`]:  [colX[5], rowY(3)],
          [`Queued_${br}`]:           [colX[6], rowY(3)],
          [`AcquireServer_${br}`]:    [colX[7], rowY(3)],
          [`InService_${br}`]:        [colX[8], rowY(3)]
        };

        let extraCol = 0;
        for (const p of ast.places || []) {
          if (getNodeBranch(p.name) === br) {
            if (slots[p.name]) pos[`P:${p.name}`] = { x: slots[p.name][0], y: slots[p.name][1] };
            else pos[`P:${p.name}`] = { x: colX[0] + extraCol++ * 140, y: rowY(2.2) };
          }
        }
        for (const t of ast.transitions || []) {
          if (getNodeBranch(t.name) === br) {
            if (slots[t.name]) pos[`T:${t.name}`] = { x: slots[t.name][0], y: slots[t.name][1] };
            else pos[`T:${t.name}`] = { x: colX[0] + extraCol++ * 140, y: rowY(2.2) };
          }
        }
      });

      const sharedSlots = {
        ServerQueue: [colX[6], sharedCenterY],
        ServerFree: [colX[7], sharedCenterY],
        ServerBusy: [colX[8], sharedCenterY],
        ProcessRequest: [colX[9], sharedCenterY]
      };
      let sx = colX[2];
      for (const p of ast.places || []) {
        if (!pos[`P:${p.name}`]) {
          if (sharedSlots[p.name]) pos[`P:${p.name}`] = { x: sharedSlots[p.name][0], y: sharedSlots[p.name][1] };
          else { pos[`P:${p.name}`] = { x: sx, y: sharedCenterY }; sx += 150; }
        }
      }
      for (const t of ast.transitions || []) {
        if (!pos[`T:${t.name}`]) {
          if (sharedSlots[t.name]) pos[`T:${t.name}`] = { x: sharedSlots[t.name][0], y: sharedSlots[t.name][1] };
          else { pos[`T:${t.name}`] = { x: sx, y: sharedCenterY }; sx += 150; }
        }
      }

      return pos;
    }

    // --- STRATEGY B: Topological Sugiyama Bipartite Flow + Docked Resources + 2D Dependability Cycles ---
    const mainNodes = [];
    const infraNodes = [];

    for (const p of ast.places || []) {
      const id = `P:${p.name}`;
      if (getContextualBranch(ast, p.name) === "INFRA") infraNodes.push({ id, kind: "P", name: p.name, tokens: p.tokens });
      else mainNodes.push({ id, kind: "P", name: p.name, tokens: p.tokens });
    }
    for (const t of ast.transitions || []) {
      const id = `T:${t.name}`;
      if (getContextualBranch(ast, t.name) === "INFRA") infraNodes.push({ id, kind: "T", name: t.name });
      else mainNodes.push({ id, kind: "T", name: t.name });
    }

    // 1. Detect pure 1-Transition Mutex / Resource Places (e.g. Repairman_Free <-> RepairUnit, ESC_Local <-> Validate)
    // These places only connect to a single transition in mainNodes and should dock vertically below/above it!
    const mainSet = new Set(mainNodes.map((n) => n.id));
    const dockedResourceOf = {}; // placeId -> transitionId
    const dockedByTrans = {};    // transitionId -> [placeId]

    for (const p of mainNodes.filter((n) => n.kind === "P")) {
      const incidentTrans = new Set();
      let isIn = false, isOut = false;
      for (const tr of ast.transitions || []) {
        const tid = `T:${tr.name}`;
        if (!mainSet.has(tid)) continue;
        if ((tr.inputs || []).some((a) => a.place === p.name)) { incidentTrans.add(tid); isIn = true; }
        if ((tr.outputs || []).some((a) => a.place === p.name)) { incidentTrans.add(tid); isOut = true; }
      }
      if (incidentTrans.size === 1 && isIn && isOut && mainNodes.length > 3) {
        const hostTid = Array.from(incidentTrans)[0];
        dockedResourceOf[p.id] = hostTid;
        if (!dockedByTrans[hostTid]) dockedByTrans[hostTid] = [];
        dockedByTrans[hostTid].push(p.id);
      }
    }

    const coreNodes = mainNodes.filter((n) => !dockedResourceOf[n.id]);
    const adj = {};
    const revAdj = {};
    for (const n of coreNodes) { adj[n.id] = []; revAdj[n.id] = []; }

    for (const tr of ast.transitions || []) {
      const tid = `T:${tr.name}`;
      if (!adj[tid]) continue;
      for (const a of tr.inputs || []) {
        const pid = `P:${a.place}`;
        if (adj[pid]) {
          adj[pid].push(tid);
          revAdj[tid].push(pid);
        }
      }
      for (const a of tr.outputs || []) {
        const pid = `P:${a.place}`;
        if (adj[pid]) {
          adj[tid].push(pid);
          revAdj[pid].push(tid);
        }
      }
    }

    // 2. Choose primary root places (Active_Up, FreeSlots, Idle, Arriving) to anchor Column 0
    // Note: use ^Idle so "ServerIdle" is NOT mistaken for an arrival root!
    const layer = {};
    const queue = [];
    const primaryRoots = coreNodes.filter(
      (n) =>
        n.kind === "P" &&
        (/^Idle|^FreeSlots|^Active_Up|^Primary_Up|^Arriving/i.test(n.name) ||
          (n.tokens && n.tokens !== "0" && !/Standby|Backup|ServerIdle|ServerFree|ESC|MeshCapacity/i.test(n.name)))
    );
    const standbyRoots = coreNodes.filter(
      (n) => n.kind === "P" && !primaryRoots.includes(n) && /Standby|Backup/i.test(n.name)
    );
    const secondaryRoots = coreNodes.filter(
      (n) =>
        n.kind === "P" &&
        !primaryRoots.includes(n) &&
        !standbyRoots.includes(n) &&
        (n.tokens && n.tokens !== "0")
    );

    const seedRoots = primaryRoots.length > 0 ? primaryRoots : secondaryRoots.length > 0 ? secondaryRoots : coreNodes.slice(0, 1);
    const secondarySet = new Set(secondaryRoots.map((n) => n.id));
    for (const r of [...seedRoots, ...standbyRoots]) {
      layer[r.id] = 0;
      queue.push(r.id);
    }

    const runForwardBfs = (holdSecondary = false) => {
      while (queue.length > 0) {
        const cur = queue.shift();
        const l = layer[cur];
        for (const nxt of adj[cur] || []) {
          if (holdSecondary && secondarySet.has(nxt)) continue;
          if (layer[nxt] === undefined) {
            layer[nxt] = l + 1;
            queue.push(nxt);
          }
        }
      }
    };

    // Pass 1: unroll the primary forward pipeline (holding back secondary loop places like ServerIdle!)
    runForwardBfs(true);

    // Pass 2: place server/resource loop states (like ServerIdle in M/M/1/K) right under their server loop!
    for (const sr of secondaryRoots) {
      if (layer[sr.id] !== undefined) continue;
      const visitedOutCols = (adj[sr.id] || []).map((tid) => layer[tid]).filter((v) => v !== undefined);
      const visitedInCols = (revAdj[sr.id] || []).map((tid) => layer[tid]).filter((v) => v !== undefined);
      if (visitedOutCols.length > 0 && visitedInCols.length > 0) {
        const minOut = Math.min(...visitedOutCols);
        const maxIn = Math.max(...visitedInCols);
        let midCol = Math.round((minOut + maxIn) / 2);
        if (midCol % 2 !== 0) midCol = Math.max(0, minOut - 1);
        layer[sr.id] = midCol;
      } else if (visitedOutCols.length > 0) {
        layer[sr.id] = Math.max(0, Math.min(...visitedOutCols) - 1);
      } else {
        layer[sr.id] = 0;
      }
      queue.push(sr.id);
      runForwardBfs();
    }

    // Any remaining unvisited core nodes: place relative to neighbors preserving bipartite parity (Places even, Transitions odd)
    for (const n of coreNodes) {
      if (layer[n.id] === undefined) {
        const neighLayers = [...(adj[n.id] || []), ...(revAdj[n.id] || [])]
          .map((id) => layer[id])
          .filter((v) => v !== undefined);
        const rawL = neighLayers.length > 0 ? Math.max(0, Math.min(...neighLayers) - 1) : (n.kind === "P" ? 0 : 1);
        const wantParity = n.kind === "P" ? 0 : 1;
        layer[n.id] = rawL % 2 === wantParity ? rawL : rawL + 1;
      }
    }

    // 3. Group by column & run Barycentric Row Ordering (Sugiyama crossing reduction!)
    const byLayer = {};
    for (const n of coreNodes) {
      const l = layer[n.id] || 0;
      if (!byLayer[l]) byLayer[l] = [];
      byLayer[l].push(n);
    }

    const sortedLayers = Object.keys(byLayer).map(Number).sort((a, b) => a - b);
    const rowOrder = {}; // nodeId -> row index within its layer

    // Initial order in first column: primary roots on top, secondary roots below
    sortedLayers.forEach((l) => {
      const list = byLayer[l];
      list.sort((a, b) => {
        const aPri = primaryRoots.includes(a) ? 0 : secondaryRoots.includes(a) ? 1 : 2;
        const bPri = primaryRoots.includes(b) ? 0 : secondaryRoots.includes(b) ? 1 : 2;
        return aPri - bPri || a.name.localeCompare(b.name);
      });
      list.forEach((n, idx) => { rowOrder[n.id] = idx; });
    });

    // Forward & backward barycenter sweeps
    for (let sweep = 0; sweep < 4; sweep++) {
      for (const l of sortedLayers) {
        const list = byLayer[l];
        if (list.length <= 1) continue;
        list.sort((a, b) => {
          const getBary = (node) => {
            const preds = (revAdj[node.id] || []).filter((id) => layer[id] < l);
            const succs = (adj[node.id] || []).filter((id) => layer[id] > l);
            const refs = preds.length > 0 ? preds : succs;
            if (refs.length === 0) return rowOrder[node.id];
            return refs.reduce((acc, id) => acc + (rowOrder[id] ?? 0), 0) / refs.length;
          };
          return getBary(a) - getBary(b) || a.name.localeCompare(b.name);
        });
        list.forEach((n, idx) => { rowOrder[n.id] = idx; });
      }
    }

    // 4. Assign crisp grid coordinates (snapping single-child horizontal chains to exact same Y!)
    const colStep = 190;
    const rowStep = 176;
    const baseTopY = 160;
    let maxMainY = 260;

    sortedLayers.forEach((l, colIdx) => {
      const list = byLayer[l];
      const x = 140 + colIdx * colStep;
      list.forEach((n, rIdx) => {
        let y = baseTopY + rIdx * rowStep;
        // If single node in this column or direct 1-to-1 continuation from previous column, align horizontally!
        const predsInPrev = (revAdj[n.id] || []).filter((pid) => layer[pid] === l - 1 && pos[pid]);
        if (list.length === 1 && predsInPrev.length === 1) {
          y = pos[predsInPrev[0]].y;
        }
        pos[n.id] = { x, y };
        if (y > maxMainY) maxMainY = y;
      });
    });

    // Position vertically docked 1-Transition Mutex/Resource Places directly below their host transition
    // (accounting for the host transition's inline description & guard boundary so arrows stay taut and clear!)
    for (const [tid, pIds] of Object.entries(dockedByTrans)) {
      const hostPt = pos[tid] || { x: 300, y: 160 };
      const hostTr = (ast.transitions || []).find((t) => `T:${t.name}` === tid);
      const extraGuardGap = hostTr && hostTr.guard && hostTr.guard.trim() !== "" ? 24 : 0;
      pIds.forEach((pid, idx) => {
        const dockY = hostPt.y + (idx + 1) * (rowStep + extraGuardGap);
        pos[pid] = { x: hostPt.x, y: dockY };
        if (dockY > maxMainY) maxMainY = dockY;
      });
    }

    // 5. Arrange separate INFRA failure-repair cycles as clean 2-Row Diamonds (NEVER a 1D colliding line!)
    if (infraNodes.length > 0) {
      const infraY = maxMainY + 185;
      const serverInfra = infraNodes.filter((n) => /Server/i.test(n.name));
      const turnstileInfra = infraNodes.filter((n) => !/Server/i.test(n.name));

      const placeCycle2D = (list, startX, topY) => {
        if (list.length === 0) return;
        const upP = list.find((n) => n.kind === "P" && /Up/i.test(n.name));
        const downP = list.find((n) => n.kind === "P" && /Down|Fail/i.test(n.name) && n !== upP);
        const failT = list.find((n) => n.kind === "T" && /Fail/i.test(n.name));
        const repT = list.find((n) => n.kind === "T" && /Repair/i.test(n.name));

        if (upP && downP && failT && repT && list.length === 4) {
          // Canonical 2-State Availability Cycle:
          // Top row:    [Up] -----> [Fail] -----> [Down]
          // Bottom row:               [Repair]
          pos[upP.id]   = { x: startX,       y: topY };
          pos[failT.id] = { x: startX + 165, y: topY };
          pos[downP.id] = { x: startX + 330, y: topY };
          pos[repT.id]  = { x: startX + 165, y: topY + 125 };
        } else {
          list.forEach((n, idx) => {
            pos[n.id] = { x: startX + idx * 170, y: topY + (idx % 2) * 90 };
          });
        }
      };

      placeCycle2D(turnstileInfra, 140, infraY);
      placeCycle2D(serverInfra, 140 + (turnstileInfra.length > 0 ? 520 : 0), infraY);
    }

    return pos;
  }

  // =========================================================================
  // 5B. DETERMINISTIC REPULSIVE-FIELD ARC ROUTING ("NEGATIVE GRAVITY")
  // =========================================================================
  const SPN_PLACE_R = 28;
  function getSpnTransDim(tr) {
    return tr && tr.kind === "immediate" ? { w: 9, h: 48 } : { w: 20, h: 52 };
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
    const s = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  /**
   * Ray-to-Axis-Aligned-Box Exit Distance:
   * Given a ray starting at (0,0) with unit direction (ux, uy), returns the distance t > 0
   * where the ray exits box [xMin, xMax] x [yMin, yMax] if the ray intersects the box, or 0 otherwise.
   */
  function rayBoxExitT(ux, uy, xMin, xMax, yMin, yMax) {
    let txMin, txMax, tyMin, tyMax;
    if (Math.abs(ux) < 1e-6) {
      if (0 < xMin || 0 > xMax) return 0;
      txMin = -Infinity;
      txMax = Infinity;
    } else {
      const t1 = xMin / ux;
      const t2 = xMax / ux;
      txMin = Math.min(t1, t2);
      txMax = Math.max(t1, t2);
    }
    if (Math.abs(uy) < 1e-6) {
      if (0 < yMin || 0 > yMax) return 0;
      tyMin = -Infinity;
      tyMax = Infinity;
    } else {
      const t1 = yMin / uy;
      const t2 = yMax / uy;
      tyMin = Math.min(t1, t2);
      tyMax = Math.max(t1, t2);
    }
    const tEnter = Math.max(0, txMin, tyMin);
    const tExit = Math.min(txMax, tyMax);
    return tExit > tEnter ? tExit : 0;
  }

  /**
   * Composite Visual Frontier Boxes:
   * Models the exact union of a node's geometric core PLUS its server-type top badge (EXP 1/∞, DET 1, IMM π=...)
   * PLUS its inline bottom labels (name, delay d=..., guard G: ...) so arrows treat all inline text and badges
   * as an integral part of the element's connection boundary!
   */
  function getProtectedEnvelope(isPlace, name, tr, isEnd) {
    const pad = isEnd ? 6 : 4;
    const cleanName = String(name || "");
    const nameHalfW = Math.min(92, Math.max(24, cleanName.length * 3.4 + 6));

    if (isPlace) {
      const coreR = SPN_PLACE_R + (isEnd ? 3 : 1);
      const boxes = [
        // Place bottom inline name label (y = +28..+46)
        {
          xMin: -(nameHalfW + pad),
          xMax: nameHalfW + pad,
          yMin: SPN_PLACE_R - 4,
          yMax: SPN_PLACE_R + 18 + pad
        }
      ];
      return {
        isPlace: true,
        coreR,
        halfW: Math.max(coreR, nameHalfW + pad),
        topH: coreR,
        botH: SPN_PLACE_R + 18 + pad,
        boxes
      };
    }

    const dim = getSpnTransDim(tr);
    const coreHW = dim.w / 2 + pad;
    const coreHH = dim.h / 2 + pad;
    const isImm = tr && tr.kind === "immediate";
    const hasDelay = tr && tr.kind === "timed";
    const hasGuard = tr && tr.guard && tr.guard.trim() !== "";

    // 1. Top server/type badge box (EXP 1, EXP ∞, DET 1, IMM π=1 w=1)
    const srvChars =
      (isImm ? 3 : 4) +
      (hasDelay ? 2 : 0) +
      (tr && tr.priority ? String(tr.priority).length + 3 : 0) +
      (tr && tr.weight ? String(tr.weight).length + 3 : 0);
    const topHalfW = Math.max(20, srvChars * 2.95 + 6) + pad;
    const topBox = {
      xMin: -topHalfW,
      xMax: topHalfW,
      yMin: -(dim.h / 2 + 22 + pad),
      yMax: -(dim.h / 2) + 3
    };

    // 2. Bottom inline transition name box
    const boxes = [
      { xMin: -coreHW, xMax: coreHW, yMin: -coreHH, yMax: coreHH },
      topBox,
      {
        xMin: -(nameHalfW + pad),
        xMax: nameHalfW + pad,
        yMin: dim.h / 2 - 3,
        yMax: dim.h / 2 + 17 + pad
      }
    ];

    let maxHalfW = Math.max(coreHW, topHalfW, nameHalfW + pad);
    let maxBotH = dim.h / 2 + 17 + pad;

    // 3. Bottom inline delay expression box (d=... or D=...)
    if (hasDelay) {
      const dStr = String((tr && tr.delayExpr) || "1");
      const delayHalfW = Math.min(80, Math.max(22, (dStr.length + 2) * 3.1 + 6)) + pad;
      maxBotH = dim.h / 2 + 31 + pad;
      maxHalfW = Math.max(maxHalfW, delayHalfW);
      boxes.push({
        xMin: -delayHalfW,
        xMax: delayHalfW,
        yMin: dim.h / 2 + 10,
        yMax: maxBotH
      });
    }

    // 4. Bottom inline guard badge box (G: ...)
    if (hasGuard) {
      const gStr = String(tr.guard).trim();
      const guardHalfW = Math.min(110, Math.max(28, (gStr.length + 3) * 2.95 + 8)) + pad;
      const gTop = dim.h / 2 + (hasDelay ? 24 : 11);
      maxBotH = gTop + 19 + pad;
      maxHalfW = Math.max(maxHalfW, guardHalfW);
      boxes.push({
        xMin: -guardHalfW,
        xMax: guardHalfW,
        yMin: gTop,
        yMax: maxBotH
      });
    }

    return {
      isPlace: false,
      coreHW,
      coreHH,
      halfW: maxHalfW,
      topH: dim.h / 2 + 22 + pad,
      botH: maxBotH,
      boxes
    };
  }

  function clipProtectedPort(cx, cy, isPlace, name, tr, tx, ty, isEnd, useProtectedFrontier = true) {
    if (!useProtectedFrontier) {
      if (isPlace) return clipCircle(cx, cy, SPN_PLACE_R + (isEnd ? 2 : 0), tx, ty);
      const dim = getSpnTransDim(tr);
      return clipRect(cx, cy, dim.w / 2 + 2, dim.h / 2 + 2, tx, ty);
    }

    const env = getProtectedEnvelope(isPlace, name, tr, isEnd);
    const dx = tx - cx;
    const dy = ty - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

    let tMax = isPlace ? env.coreR : rayBoxExitT(ux, uy, -env.coreHW, env.coreHW, -env.coreHH, env.coreHH);
    for (const b of env.boxes) {
      const tb = rayBoxExitT(ux, uy, b.xMin, b.xMax, b.yMin, b.yMax);
      if (tb > tMax) tMax = tb;
    }
    return {
      x: cx + ux * tMax,
      y: cy + uy * tMax
    };
  }

  /**
   * Composite Connection Frontier for Shadow/Mirror Nodes (Place Mirrors & Incoming Transition Mirrors):
   * Includes both the mirror symbol (double-circle or transition capsule) AND its "↗ Name" label below it
   * so connectors never pass through the mirror's naming text!
   */
  function clipMirrorPort(mNode, tx, ty, isEnd) {
    const pad = isEnd ? 5 : 3;
    const dx = tx - mNode.x;
    const dy = ty - mNode.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

    const isTransMirror = mNode.kind === "transition";
    const coreR = mNode.r || 16;
    const coreBot = isTransMirror ? 18 : coreR;
    let tMax = isTransMirror
      ? rayBoxExitT(ux, uy, -(13 + pad), 13 + pad, -(18 + pad), 18 + pad)
      : coreR + pad;

    const labelStr = String(mNode.label || mNode.place || mNode.trName || "");
    const lblHalfW = Math.min(86, Math.max(24, (labelStr.length + 2) * 3.05 + 6)) + pad;
    const tLbl = rayBoxExitT(ux, uy, -lblHalfW, lblHalfW, coreBot - 3, coreBot + 16 + pad);
    if (tLbl > tMax) tMax = tLbl;

    return {
      x: mNode.x + ux * tMax,
      y: mNode.y + uy * tMax
    };
  }

  function pointToSegClosest(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const l2 = vx * vx + vy * vy;
    if (l2 < 1e-6) return { dist: Math.hypot(px - ax, py - ay), cx: ax, cy: ay, t: 0 };
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
    const cx = ax + t * vx;
    const cy = ay + t * vy;
    return { dist: Math.hypot(px - cx, py - cy), cx, cy, t };
  }

  function pointToSegDist(px, py, ax, ay, bx, by) {
    return pointToSegClosest(px, py, ax, ay, bx, by).dist;
  }

  function segmentsIntersect(a, b, c, d) {
    const ccw = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) - (p2.y - p1.y) * (p3.x - p1.x);
    const d1 = ccw(c, d, a);
    const d2 = ccw(c, d, b);
    const d3 = ccw(a, b, c);
    const d4 = ccw(a, b, d);
    // Strict interior intersection (ignoring tiny shared-endpoint touches)
    const eps = 1e-2;
    return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
           ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
  }

  function simplifyPolyline(pts, tol = 4.5) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = out[out.length - 1];
      const cur = pts[i];
      const next = pts[i + 1];
      if (pointToSegDist(cur.x, cur.y, prev.x, prev.y, next.x, next.y) > tol) {
        out.push(cur);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function tautRoundedPath(rawPts, maxR = 20, preserveInterior = false) {
    const pts = preserveInterior ? rawPts : simplifyPolyline(rawPts, 4.5);
    if (pts.length < 2) return "";
    if (pts.length === 2) {
      return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
    }
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      const r = Math.min(maxR, l1 * 0.36, l2 * 0.36);
      const ax = p1.x - ((p1.x - p0.x) / l1) * r;
      const ay = p1.y - ((p1.y - p0.y) / l1) * r;
      const bx = p1.x + ((p2.x - p1.x) / l2) * r;
      const by = p1.y + ((p2.y - p1.y) / l2) * r;
      d += ` L ${ax.toFixed(1)} ${ay.toFixed(1)} Q ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
    return d;
  }

  function polylineMidpoint(pts) {
    if (pts.length < 2) return pts[0] || { x: 0, y: 0 };
    let total = 0;
    const segLens = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      segLens.push(l);
      total += l;
    }
    let half = total * 0.5;
    for (let i = 0; i < segLens.length; i++) {
      if (half <= segLens[i] || i === segLens.length - 1) {
        const t = segLens[i] > 1e-6 ? half / segLens[i] : 0.5;
        return {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * t
        };
      }
      half -= segLens[i];
    }
    return pts[Math.floor(pts.length / 2)];
  }

  function computeSpnArcGraph(ast, positions, opts = {}) {
    const useGravity = opts.useGravity !== false;
    const useMirrors = Boolean(opts.useMirrors);
    const mirrorDistThreshold = typeof opts.mirrorDistThreshold === "number" ? opts.mirrorDistThreshold : 365;
    const MIRROR_R = 16;
    const transByName = {};
    for (const tr of ast.transitions || []) transByName[tr.name] = tr;

    // 1. Collect all arcs & classify long arcs as mirror candidates when useMirrors is enabled
    const rawArcs = [];
    for (const tr of ast.transitions || []) {
      const pushList = (list, dir) => {
        (list || []).forEach((arc, idx) => {
          const srcId = dir === "out" ? `T:${tr.name}` : `P:${arc.place}`;
          const dstId = dir === "out" ? `P:${arc.place}` : `T:${tr.name}`;
          rawArcs.push({
            id: `${tr.name}:${dir}:${idx}`,
            trName: tr.name,
            trKind: tr.kind,
            place: arc.place,
            dir,
            idx,
            srcId,
            dstId,
            arc
          });
        });
      };
      pushList(tr.inputs, "in");
      pushList(tr.outputs, "out");
      pushList(tr.inhibitors, "inh");
    }

    const directArcs = [];
    const mirrorGroups = new Map(); // key: "trName|place" -> { trName, place, arcs: [...] }

    for (const item of rawArcs) {
      const pSrc = positions[item.srcId];
      const pDst = positions[item.dstId];
      if (!pSrc || !pDst) continue;
      const dist = Math.hypot(pDst.x - pSrc.x, pDst.y - pSrc.y);
      item._dist = dist;
      if (useMirrors && dist > mirrorDistThreshold) {
        const gKey = `${item.trName}|${item.place}`;
        if (!mirrorGroups.has(gKey)) {
          mirrorGroups.set(gKey, { trName: item.trName, place: item.place, arcs: [] });
        }
        mirrorGroups.get(gKey).arcs.push(item);
      } else {
        directArcs.push(item);
      }
    }

    // Sort direct arcs shortest-first so short structural backbone routes cleanly first,
    // and longer arcs choose the side with fewer crossings against the backbone!
    directArcs.sort((a, b) => a._dist - b._dist || a.id.localeCompare(b.id));

    const pairCount = {};
    for (const item of directArcs) {
      const key = [item.srcId, item.dstId].sort().join("|");
      item.pairKey = key;
      pairCount[key] = (pairCount[key] || 0) + 1;
    }

    // 2. Build node obstacle list (nodes + server-type badges + inline name/delay/guard protection halos)
    const realNodeEntries = Object.entries(positions || {}).filter(
      ([id]) => id.startsWith("P:") || id.startsWith("T:")
    );
    const obstacles = [];
    for (const [id, pt] of realNodeEntries) {
      const isPlace = id.startsWith("P:");
      const name = id.slice(2);
      const tr = !isPlace ? transByName[name] : null;
      const env = getProtectedEnvelope(isPlace, name, tr, true);
      obstacles.push({ id, x: pt.x, y: pt.y, r: isPlace ? 54 : 50 });
      // Bottom inline text / description halo (plus flanking circles for wide names/guards)
      obstacles.push({ id, x: pt.x, y: pt.y + (isPlace ? 40 : 44), r: 30 });
      if (env.halfW > 42) {
        const wingX = Math.min(54, env.halfW - 18);
        obstacles.push({ id, x: pt.x - wingX, y: pt.y + (isPlace ? 38 : 42), r: 22 });
        obstacles.push({ id, x: pt.x + wingX, y: pt.y + (isPlace ? 38 : 42), r: 22 });
      }
      if (!isPlace) {
        // Top server-type badge halo (EXP 1/∞, DET 1, IMM)
        obstacles.push({ id, x: pt.x, y: pt.y - 38, r: 26 });
        if (tr && (tr.kind === "timed" || (tr.guard && tr.guard.trim() !== ""))) {
          obstacles.push({ id, x: pt.x, y: pt.y + Math.min(72, env.botH - 6), r: 28 });
        }
      }
    }

    // Helper: count strict crossings of candidate polyline against already-routed direct arcs
    const countCrossingsWith = (candPts, item, routedList) => {
      let crossings = 0;
      for (const other of routedList) {
        if (other.srcId === item.srcId || other.srcId === item.dstId || other.dstId === item.srcId || other.dstId === item.dstId) {
          continue;
        }
        const oPts = other.waypoints;
        for (let i = 0; i < candPts.length - 1; i++) {
          for (let j = 0; j < oPts.length - 1; j++) {
            if (segmentsIntersect(candPts[i], candPts[i + 1], oPts[j], oPts[j + 1])) {
              crossings++;
            }
          }
        }
      }
      return crossings;
    };

    // 3. Initial taut obstacle- and crossing-aware routing for direct arcs
    const pairSeen = {};
    const routed = [];

    for (const item of directArcs) {
      const pSrc = positions[item.srcId];
      const pDst = positions[item.dstId];
      const totalInPair = pairCount[item.pairKey] || 1;
      const seenIdx = pairSeen[item.pairKey] || 0;
      pairSeen[item.pairKey] = seenIdx + 1;

      const dx = pDst.x - pSrc.x;
      const dy = pDst.y - pSrc.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist;
      const ny = dx / dist;
      // Canonical pair normal (independent of A->B vs B->A direction!) so bidirectional pairs always bow to opposite sides!
      const canonSign = item.srcId < item.dstId ? 1 : -1;
      const canonNx = nx * canonSign;
      const canonNy = ny * canonSign;

      const relevantObs = useGravity
        ? obstacles.filter((o) => {
            if (o.id === item.srcId || o.id === item.dstId) return false;
            return pointToSegDist(o.x, o.y, pSrc.x, pSrc.y, pDst.x, pDst.y) < o.r + 65;
          })
        : [];
      const directHits = relevantObs.filter((o) => pointToSegDist(o.x, o.y, pSrc.x, pSrc.y, pDst.x, pDst.y) < o.r);

      let waypoints;
      let isStraight = false;
      const customWpsRaw = positions && Array.isArray(positions[`W:${item.id}`]) ? positions[`W:${item.id}`] : null;
      const customWps = customWpsRaw
        ? customWpsRaw.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ x: p.x, y: p.y }))
        : [];
      const hasCustomWaypoints = customWps.length > 0;

      if (hasCustomWaypoints) {
        // User-pinned fixed inflection points (bend points) take absolute precedence!
        waypoints = [{ x: pSrc.x, y: pSrc.y }, ...customWps, { x: pDst.x, y: pDst.y }];
        isStraight = false;
      } else if (!useGravity || (directHits.length === 0 && totalInPair === 1)) {
        // Pure crisp straight line!
        waypoints = [{ x: pSrc.x, y: pSrc.y }, { x: pDst.x, y: pDst.y }];
        isStraight = true;
      } else if (totalInPair > 1 && directHits.length === 0) {
        // Clean symmetric opposite separation for bidirectional / antiparallel pair
        const off = (seenIdx % 2 === 0 ? 1 : -1) * (24 + Math.floor(seenIdx / 2) * 14);
        waypoints = [
          { x: pSrc.x, y: pSrc.y },
          { x: (pSrc.x + pDst.x) / 2 + canonNx * off, y: (pSrc.y + pDst.y) / 2 + canonNy * off },
          { x: pDst.x, y: pDst.y }
        ];
      } else {
        // Test both gentle corridor nudges (for diagonal chords passing between two rows!)
        // and full outer arches (for long horizontal feedback loops returning along a row!)
        const allY = Object.values(positions || {}).map((p) => p.y);
        const midDiagramY = allY.length > 0 ? (Math.min(...allY) + Math.max(...allY)) / 2 : 240;

        const evalCandidate = (sideSign, archMag) => {
          const numInner = dist > 340 ? 2 : 1;
          const pts = [{ x: pSrc.x, y: pSrc.y }];
          const pairShift = totalInPair > 1 ? (seenIdx % 2 === 0 ? 18 : -18) * canonSign * sideSign : 0;
          const baseArch = archMag + pairShift;
          for (let k = 1; k <= numInner; k++) {
            const t = numInner === 1 ? 0.5 : (k === 1 ? 0.25 : 0.75);
            pts.push({
              x: pSrc.x + dx * t + nx * sideSign * baseArch,
              y: pSrc.y + dy * t + ny * sideSign * baseArch
            });
          }
          pts.push({ x: pDst.x, y: pDst.y });

          // Fast obstacle clearance relaxation keeping segments taut and strictly on the committed sideSign!
          const iters = archMag <= 18 ? 12 : 28;
          for (let it = 0; it < iters; it++) {
            const forces = pts.map(() => ({ fx: 0, fy: 0 }));
            for (let k = 1; k < pts.length - 1; k++) {
              const p = pts[k];
              for (const o of obstacles) {
                if (o.id === item.srcId || o.id === item.dstId) continue;
                const ox = p.x - o.x;
                const oy = p.y - o.y;
                const d = Math.hypot(ox, oy);
                const safeR = o.r + 18;
                if (d < safeR) {
                  const strength = Math.pow((safeR - d) / safeR, 1.3) * 30;
                  // Always push coherently toward the committed sideSign so an obstacle on the far side of the chord
                  // never pushes the curve backward into the obstacle center!
                  const rx = d > 2 ? ox / d : 0;
                  const ry = d > 2 ? oy / d : 0;
                  const align = rx * (nx * sideSign) + ry * (ny * sideSign);
                  const ux = align >= 0.35 ? rx : nx * sideSign;
                  const uy = align >= 0.35 ? ry : ny * sideSign;
                  forces[k].fx += ux * strength;
                  forces[k].fy += uy * strength;
                }
              }
              const prevP = pts[k - 1], nextP = pts[k + 1];
              for (const segMid of [
                { x: (prevP.x + p.x) / 2, y: (prevP.y + p.y) / 2 },
                { x: (p.x + nextP.x) / 2, y: (p.y + nextP.y) / 2 }
              ]) {
                for (const o of obstacles) {
                  if (o.id === item.srcId || o.id === item.dstId) continue;
                  const d = Math.hypot(segMid.x - o.x, segMid.y - o.y);
                  const safeR = o.r + 14;
                  if (d < safeR) {
                    const strength = ((safeR - d) / safeR) * 24;
                    forces[k].fx += nx * sideSign * strength;
                    forces[k].fy += ny * sideSign * strength;
                  }
                }
              }
              forces[k].fx += ((prevP.x + nextP.x) / 2 - p.x) * 0.08;
              forces[k].fy += ((prevP.y + nextP.y) / 2 - p.y) * 0.08;
            }
            // Segment-to-obstacle clearance: if any segment (pts[s] -> pts[s+1]) cuts near an obstacle/label,
            // push BOTH interior endpoints of that segment toward sideSign so the chord clears the label!
            for (let s = 0; s < pts.length - 1; s++) {
              for (const o of obstacles) {
                if (o.id === item.srcId || o.id === item.dstId) continue;
                const cl = pointToSegClosest(o.x, o.y, pts[s].x, pts[s].y, pts[s + 1].x, pts[s + 1].y);
                const safeR = o.r + 16;
                if (cl.dist < safeR) {
                  const push = ((safeR - cl.dist) / safeR) * 26;
                  if (s > 0) {
                    forces[s].fx += nx * sideSign * push;
                    forces[s].fy += ny * sideSign * push;
                  }
                  if (s + 1 < pts.length - 1) {
                    forces[s + 1].fx += nx * sideSign * push;
                    forces[s + 1].fy += ny * sideSign * push;
                  }
                }
              }
            }
            for (let k = 1; k < pts.length - 1; k++) {
              pts[k].x += Math.max(-24, Math.min(24, forces[k].fx));
              pts[k].y += Math.max(-24, Math.min(24, forces[k].fy));
            }
          }

          let penalty = 0;
          let pathLen = 0;
          for (let k = 0; k < pts.length - 1; k++) {
            pathLen += Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y);
            for (const o of obstacles) {
              if (o.id === item.srcId || o.id === item.dstId) continue;
              const sd = pointToSegDist(o.x, o.y, pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y);
              if (sd < o.r) penalty += (o.r - sd) * 140;
            }
          }
          const crossings = countCrossingsWith(pts, item, routed);
          let outerBias = 0;
          if (Math.abs(dx) > 320 && Math.abs(dy) < 90) {
            const avgY = pts.slice(1, -1).reduce((a, p) => a + p.y, 0) / (pts.length - 2);
            const endY = (pSrc.y + pDst.y) / 2;
            if (endY <= midDiagramY && avgY > endY) outerBias += 130;
            if (endY > midDiagramY && avgY < endY) outerBias += 130;
          }
          return { pts, sideSign, score: penalty + crossings * 260 + outerBias + pathLen * 0.08 };
        };

        const cands = [
          evalCandidate(1, 16),
          evalCandidate(-1, 16),
          evalCandidate(1, 44),
          evalCandidate(-1, 44),
          evalCandidate(1, 88),
          evalCandidate(-1, 88),
          evalCandidate(1, 128),
          evalCandidate(-1, 128)
        ];
        cands.sort((a, b) => a.score - b.score);
        waypoints = cands[0].pts;
        item._sideSign = cands[0].sideSign;
      }

      routed.push({
        ...item,
        isMirrored: false,
        isStraight,
        hasCustomWaypoints,
        customWaypoints: customWps,
        waypoints
      });
    }

    // 4. Full-Body Edge-to-Edge Negative Gravity (separates parallel/nearby line bodies cleanly!)
    if (useGravity && routed.length > 1) {
      const ARC_BODY_SAFE = 26;
      for (let pass = 0; pass < 12; pass++) {
        for (let i = 0; i < routed.length; i++) {
          const rA = routed[i];
          if (rA.hasCustomWaypoints || rA.waypoints.length <= 2) continue; // Keep clear straight arcs & user-fixed inflection points strictly locked!
          for (let k = 1; k < rA.waypoints.length - 1; k++) {
            const p = rA.waypoints[k];
            let fx = 0, fy = 0;

            // Repel from every OTHER arc's body segments
            for (let j = 0; j < routed.length; j++) {
              if (i === j) continue;
              const rB = routed[j];
              const sharesNode =
                rA.srcId === rB.srcId || rA.srcId === rB.dstId || rA.dstId === rB.srcId || rA.dstId === rB.dstId;
              const bPts = rB.waypoints;
              for (let s = 0; s < bPts.length - 1; s++) {
                const cl = pointToSegClosest(p.x, p.y, bPts[s].x, bPts[s].y, bPts[s + 1].x, bPts[s + 1].y);
                if (sharesNode && (cl.t < 0.14 || cl.t > 0.86)) continue;
                if (cl.dist < ARC_BODY_SAFE) {
                  const strength = ((ARC_BODY_SAFE - cl.dist) / ARC_BODY_SAFE) * 11;
                  if (cl.dist < 1.5) {
                    // Deterministic tie-breaker normal
                    const sdx = bPts[s + 1].x - bPts[s].x;
                    const sdy = bPts[s + 1].y - bPts[s].y;
                    const sl = Math.hypot(sdx, sdy) || 1;
                    const sign = i < j ? 1 : -1;
                    fx += (-sdy / sl) * sign * strength;
                    fy += (sdx / sl) * sign * strength;
                  } else {
                    fx += ((p.x - cl.cx) / cl.dist) * strength;
                    fy += ((p.y - cl.cy) / cl.dist) * strength;
                  }
                }
              }
            }

            // Still respect node obstacle boundaries during body separation
            for (const o of obstacles) {
              if (o.id === rA.srcId || o.id === rA.dstId) continue;
              const ox = p.x - o.x, oy = p.y - o.y;
              const d = Math.hypot(ox, oy);
              const safeR = o.r + 12;
              if (d < safeR && d > 0.1) {
                const st = ((safeR - d) / safeR) * 18;
                fx += (ox / d) * st;
                fy += (oy / d) * st;
              }
            }

            p.x += Math.max(-10, Math.min(10, fx));
            p.y += Math.max(-10, Math.min(10, fy));
          }
        }
      }
    }

    // 5. Compute initial protected-frontier ports & crossing-free monotonic angular port spreading!
    for (const r of routed) {
      const pSrc = positions[r.srcId];
      const pDst = positions[r.dstId];
      const firstTarget = r.waypoints[1];
      const lastTarget = r.waypoints[r.waypoints.length - 2];
      const srcIsPlace = r.srcId.startsWith("P:");
      const dstIsPlace = r.dstId.startsWith("P:");
      const trObj = transByName[r.trName];

      r.startPt = clipProtectedPort(
        pSrc.x, pSrc.y, srcIsPlace, r.srcId.slice(2), trObj, firstTarget.x, firstTarget.y, false, useGravity
      );
      r.endPt = clipProtectedPort(
        pDst.x, pDst.y, dstIsPlace, r.dstId.slice(2), trObj, lastTarget.x, lastTarget.y, true, useGravity
      );
    }

    if (useGravity) {
      const portsByNode = {};
      const addPort = (nodeId, entry) => {
        if (!portsByNode[nodeId]) portsByNode[nodeId] = [];
        portsByNode[nodeId].push(entry);
      };

      routed.forEach((r, rIdx) => {
        const pS = positions[r.srcId];
        const pD = positions[r.dstId];
        addPort(r.srcId, { rIdx, end: "start", angle: Math.atan2(r.startPt.y - pS.y, r.startPt.x - pS.x) });
        addPort(r.dstId, { rIdx, end: "end", angle: Math.atan2(r.endPt.y - pD.y, r.endPt.x - pD.x) });
      });

      const MIN_SEP = 0.22;
      for (const [nodeId, ports] of Object.entries(portsByNode)) {
        if (ports.length <= 1) continue;
        // Sort monotonically by angle so adjacent ports NEVER swap/cross outside the border!
        ports.sort((a, b) => a.angle - b.angle);
        const center = positions[nodeId];
        const isPlace = nodeId.startsWith("P:");
        const tr = !isPlace ? transByName[nodeId.slice(2)] : null;

        const angles = ports.map((p) => p.angle);
        for (let iter = 0; iter < 14; iter++) {
          for (let i = 0; i < angles.length; i++) {
            const j = (i + 1) % angles.length;
            let diff = angles[j] - angles[i];
            if (j === 0) diff += 2 * Math.PI;
            if (diff < MIN_SEP) {
              const push = (MIN_SEP - diff) * 0.45;
              angles[i] -= push;
              angles[j] += push;
            }
          }
        }

        ports.forEach((p, idx) => {
          const ang = angles[idx];
          const tx = center.x + Math.cos(ang) * 120;
          const ty = center.y + Math.sin(ang) * 120;
          const r = routed[p.rIdx];
          const pt = clipProtectedPort(
            center.x, center.y, isPlace, nodeId.slice(2), tr, tx, ty, p.end === "end", useGravity
          );
          if (p.end === "start") r.startPt = pt;
          else r.endPt = pt;
        });
      }
    }

    // Finalize direct arcs (using crisp tautRoundedPath — straight where clear, rounded corners where bent!)
    const finalDirect = routed.map((r) => {
      const finalPts = [r.startPt, ...r.waypoints.slice(1, -1), r.endPt];
      const pathD = tautRoundedPath(finalPts, r.hasCustomWaypoints ? 14 : 20, Boolean(r.hasCustomWaypoints));
      const labelPt = polylineMidpoint(finalPts);
      return {
        ...r,
        finalPts,
        pathD,
        lx: labelPt.x,
        ly: labelPt.y
      };
    });

    // 6. Structured, Collision-Free Shadow/Mirror Dock Layout (Transition Mirrors + Incoming Place Mirrors!)
    const mirrors = [];
    const mirrorArcRouted = [];
    const placeInputArcs = [];

    const getMirrorEnv = (labelStr, kind) => {
      const halfW = Math.min(72, Math.max(40, (String(labelStr || "").length + 2) * 2.75 + 8));
      return {
        halfW,
        topH: kind === "transition" ? 19 : 18,
        botH: (kind === "transition" ? 18 : MIRROR_R) + 16
      };
    };

    const absAngleDiff = (a1, a2) => {
      const d = a1 - a2;
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    };

    /**
     * Docks a mirror node (either Place mirror around Transition, or Incoming Transition mirror around Place)
     * respecting custom user-dragged coordinates (`positions[mirrorId]`), input/output hemisphere separation,
     * same-host ray angle locking, connector-through-mirror clearance, and automatic arrow shaft lengthening!
     */
    const placeMirrorAroundHost = (
      mirrorId,
      hostId,
      hostPt,
      hostIsPlace,
      hostName,
      hostTr,
      targetPt,
      isOutFromHost,
      labelStr,
      kind
    ) => {
      const mirEnv = getMirrorEnv(labelStr, kind);
      const hostEnv = getProtectedEnvelope(hostIsPlace, hostName, hostTr, true);

      // 1. If user manually dragged & positioned this mirror, honor their custom position!
      const customPt = positions && positions[mirrorId];
      if (customPt && Number.isFinite(customPt.x) && Number.isFinite(customPt.y)) {
        return {
          x: customPt.x,
          y: customPt.y,
          envHalfW: mirEnv.halfW,
          envTopH: mirEnv.topH,
          envBotH: mirEnv.botH
        };
      }

      // 2. Build hemisphere-segregated dock slots that automatically adapt to host & mirror text widths!
      const minSideDx = Math.round(Math.max(130, hostEnv.halfW + mirEnv.halfW + 24) / 5) * 5;
      const outerSideDx = minSideDx + 105;
      const topRowY1 = -(Math.round(Math.max(130, hostEnv.topH + mirEnv.botH + 46) / 5) * 5);
      const botRowY1 = Math.round(Math.max(135, hostEnv.botH + mirEnv.topH + 46) / 5) * 5;
      const topRowY2 = topRowY1 - 65;
      const botRowY2 = botRowY1 + 65;

      const xInSide = [-minSideDx, -outerSideDx];
      const xOutSide = [minSideDx, outerSideDx];
      const ySideRows = [-98, -33, 32, 97, -163, 162];

      const primaryCols = isOutFromHost ? xOutSide : xInSide;
      const secondaryCols = isOutFromHost ? xInSide : xOutSide;
      const candidates = [];

      // Primary hemisphere vertical columns (inputs on left, outputs on right)
      for (const dx of primaryCols) {
        for (const dy of ySideRows) {
          candidates.push({ x: hostPt.x + dx, y: hostPt.y + dy, prefBonus: -28 });
        }
      }

      // Top & bottom horizontal shelves — segregated by input/output hemisphere first, with STAGGERED outer row!
      const priShelfX1 = isOutFromHost ? [115, 0, 225] : [-115, 0, -225];
      const secShelfX1 = isOutFromHost ? [-115, -225] : [115, 225];

      for (const dx of priShelfX1) {
        candidates.push({
          x: hostPt.x + dx,
          y: hostPt.y + (isOutFromHost ? botRowY1 : topRowY1),
          prefBonus: -18
        });
        candidates.push({
          x: hostPt.x + dx,
          y: hostPt.y + (isOutFromHost ? topRowY1 : botRowY1),
          prefBonus: -4
        });
      }
      for (const dx of secShelfX1) {
        candidates.push({ x: hostPt.x + dx, y: hostPt.y + topRowY1, prefBonus: 12 });
        candidates.push({ x: hostPt.x + dx, y: hostPt.y + botRowY1, prefBonus: 12 });
      }

      // Outer staggered shelves (dx = ±65, ±180 — never collinear with dx = 0, ±115!)
      const stagX = isOutFromHost ? [65, 180, -65, -180] : [-65, -180, 65, 180];
      for (const dx of stagX) {
        candidates.push({ x: hostPt.x + dx, y: hostPt.y + topRowY2, prefBonus: 26 });
        candidates.push({ x: hostPt.x + dx, y: hostPt.y + botRowY2, prefBonus: 26 });
      }

      // Secondary hemisphere fallback columns
      for (const dx of secondaryCols) {
        for (const dy of ySideRows) {
          candidates.push({ x: hostPt.x + dx, y: hostPt.y + dy, prefBonus: 20 });
        }
      }

      // Extra wide ring if a shared resource node has many mirrors
      for (const dx of [-290, -195, -95, 95, 195, 290]) {
        for (const dy of [-225, -155, -85, 85, 155, 225]) {
          candidates.push({ x: hostPt.x + dx, y: hostPt.y + dy, prefBonus: 48 });
        }
      }

      const MIN_ARROW_SHAFT = 46;
      let best = null;

      for (const cand of candidates) {
        let cx = Math.round(cand.x / 5) * 5;
        let cy = Math.round(cand.y / 5) * 5;

        // Ensure the clipped arrow shaft between host composite boundary and mirror composite boundary
        // has at least MIN_ARROW_SHAFT length (automatically pushes mirror out if inline text/guard is deep!)
        const tmpMir = { x: cx, y: cy, r: MIRROR_R, kind, label: labelStr };
        const pHostClip = clipProtectedPort(
          hostPt.x, hostPt.y, hostIsPlace, hostName, hostTr, cx, cy, !isOutFromHost, useGravity
        );
        const pMirClip = clipMirrorPort(tmpMir, hostPt.x, hostPt.y, isOutFromHost);
        const curShaft = Math.hypot(pMirClip.x - pHostClip.x, pMirClip.y - pHostClip.y);
        if (curShaft < MIN_ARROW_SHAFT) {
          const rdx = cx - hostPt.x;
          const rdy = cy - hostPt.y;
          const rLen = Math.hypot(rdx, rdy) || 1;
          const extraPush = MIN_ARROW_SHAFT - curShaft + 6;
          cx = Math.round((cx + (rdx / rLen) * extraPush) / 5) * 5;
          cy = Math.round((cy + (rdy / rLen) * extraPush) / 5) * 5;
        }

        const relX = cx - hostPt.x;
        const relY = cy - hostPt.y;
        const candAng = Math.atan2(relY, relX);

        // 1. Never overlap ANY real node (including its full top server badge & bottom inline text/guard envelope!)
        // and never route the mirror connector ray through another real node!
        let blocked = false;
        let nodeRayPen = 0;
        for (const [nid, npt] of realNodeEntries) {
          const nIsPlace = nid.startsWith("P:");
          const nName = nid.slice(2);
          const nTr = !nIsPlace ? transByName[nName] : null;
          const nEnv = getProtectedEnvelope(nIsPlace, nName, nTr, true);
          if (Math.hypot((cx - npt.x) / 86, (cy - (npt.y + 8)) / 68) < 1.0) {
            blocked = true;
            break;
          }
          const minXDist = Math.min(115, nEnv.halfW + mirEnv.halfW * 0.65 + 8);
          const yOverlap =
            cy + mirEnv.botH + 6 > npt.y - nEnv.topH &&
            cy - mirEnv.topH - 6 < npt.y + nEnv.botH;
          if (Math.abs(cx - npt.x) < minXDist && yOverlap) {
            blocked = true;
            break;
          }
          if (nid !== hostId) {
            const dRayNode = pointToSegDist(npt.x, npt.y + 6, hostPt.x, hostPt.y, cx, cy);
            if (dRayNode < 56) {
              nodeRayPen += (56 - dRayNode) * 35 + 650;
            }
          }
        }
        if (blocked) continue;

        // 2. Never overlap ANY already-placed mirror (full label envelope) OR share a ray angle from the same host!
        for (const m of mirrors) {
          const pairHalfW = Math.max(96, ((m.envHalfW || 48) + mirEnv.halfW) * 0.85);
          if (
            Math.hypot((cx - m.x) / pairHalfW, (cy - m.y) / 58) < 1.0 ||
            Math.hypot((cx - m.x) / 80, (cy - m.y) / 48) < 1.0
          ) {
            blocked = true;
            break;
          }
          // Same-Host Ray Angle Lock: forbids placing an outer mirror behind an inner mirror on the same ray!
          if (m.hostId === hostId) {
            const mAng = Math.atan2(m.y - hostPt.y, m.x - hostPt.x);
            if (absAngleDiff(candAng, mAng) < 0.30) {
              blocked = true;
              break;
            }
          }
          // Connector-Through-Mirror-Body Rejection: new connector (hostPt -> cand) cannot pass through existing mirror `m` or its label!
          if (
            pointToSegDist(m.x, m.y, hostPt.x, hostPt.y, cx, cy) < 42 ||
            pointToSegDist(m.x, m.y + 20, hostPt.x, hostPt.y, cx, cy) < 38
          ) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        // 3. New mirror cannot sit on top of any already-routed mirror connector!
        for (const ma of [...mirrorArcRouted, ...placeInputArcs]) {
          if (
            pointToSegDist(cx, cy, ma.startPt.x, ma.startPt.y, ma.endPt.x, ma.endPt.y) < 42 ||
            pointToSegDist(cx, cy + 20, ma.startPt.x, ma.startPt.y, ma.endPt.x, ma.endPt.y) < 38
          ) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        // 4. Count crossings & proximity against direct arcs and existing mirror connectors
        let crossings = 0;
        let lineProxPen = 0;
        for (const da of finalDirect) {
          for (let k = 0; k < da.finalPts.length - 1; k++) {
            const dLine = pointToSegDist(cx, cy + 10, da.finalPts[k].x, da.finalPts[k].y, da.finalPts[k + 1].x, da.finalPts[k + 1].y);
            if (dLine < 42) lineProxPen += (42 - dLine) * 12;
            if (da.srcId !== hostId && da.dstId !== hostId) {
              if (segmentsIntersect(hostPt, { x: cx, y: cy }, da.finalPts[k], da.finalPts[k + 1])) {
                crossings++;
              }
            }
          }
        }
        for (const ma of [...mirrorArcRouted, ...placeInputArcs]) {
          if (segmentsIntersect(hostPt, { x: cx, y: cy }, ma.startPt, ma.endPt)) {
            crossings += 2;
          }
        }

        const dHost = Math.hypot(relX, relY);
        const dOrig = Math.hypot(cx - targetPt.x, cy - targetPt.y);
        const score = dHost * 1.15 + dOrig * 0.08 + crossings * 420 + lineProxPen + nodeRayPen + cand.prefBonus;
        if (!best || score < best.score) {
          best = {
            x: cx,
            y: cy,
            score,
            envHalfW: mirEnv.halfW,
            envTopH: mirEnv.topH,
            envBotH: mirEnv.botH
          };
        }
      }

      if (!best) {
        // Guaranteed collision-free spiral fallback if a shared hub has many mirrors
        for (let r = 150; r <= 420 && !best; r += 45) {
          for (let aIdx = 0; aIdx < 24; aIdx++) {
            const ang = ((aIdx * 15 + (isOutFromHost ? 0 : 180)) * Math.PI) / 180;
            const cx = Math.round((hostPt.x + Math.cos(ang) * r) / 5) * 5;
            const cy = Math.round((hostPt.y + Math.sin(ang) * r) / 5) * 5;
            const hitReal = realNodeEntries.some(([, npt]) => Math.hypot((cx - npt.x) / 86, (cy - npt.y) / 68) < 1.0);
            if (hitReal) continue;
            const hitMir = mirrors.some((m) => Math.hypot((cx - m.x) / 86, (cy - m.y) / 52) < 1.0);
            if (hitMir) continue;
            best = {
              x: cx,
              y: cy,
              envHalfW: mirEnv.halfW,
              envTopH: mirEnv.topH,
              envBotH: mirEnv.botH
            };
            break;
          }
        }
      }
      if (!best) {
        const idx = mirrors.length;
        best = {
          x: hostPt.x + (isOutFromHost ? minSideDx : -minSideDx),
          y: hostPt.y + topRowY1 - idx * 64,
          envHalfW: mirEnv.halfW,
          envTopH: mirEnv.topH,
          envBotH: mirEnv.botH
        };
      }
      return best;
    };

    // Group mirror entries by host transition so inputs & outputs dock symmetrically!
    const groupsByTrans = new Map();
    for (const grp of mirrorGroups.values()) {
      if (!groupsByTrans.has(grp.trName)) groupsByTrans.set(grp.trName, []);
      groupsByTrans.get(grp.trName).push(grp);
    }

    const sortedTransNames = Array.from(groupsByTrans.keys()).sort((a, b) => {
      const pa = positions[`T:${a}`] || { x: 0, y: 0 };
      const pb = positions[`T:${b}`] || { x: 0, y: 0 };
      return pa.y - pb.y || pa.x - pb.x || a.localeCompare(b);
    });

    // 6A. Dock Place Mirrors around their host Transitions (`M:trName:place`)
    for (const trName of sortedTransNames) {
      const hostId = `T:${trName}`;
      const trPt = positions[hostId];
      const trObj = transByName[trName];
      if (!trPt) continue;

      const list = groupsByTrans.get(trName).sort((a, b) => {
        const aOut = a.arcs.every((x) => x.dir === "out") ? 1 : 0;
        const bOut = b.arcs.every((x) => x.dir === "out") ? 1 : 0;
        if (aOut !== bOut) return aOut - bOut;
        const pa = positions[`P:${a.place}`] || { x: 0, y: 0 };
        const pb = positions[`P:${b.place}`] || { x: 0, y: 0 };
        return pa.y - pb.y || pa.x - pb.x || a.place.localeCompare(b.place);
      });

      for (const grp of list) {
        const plPt = positions[`P:${grp.place}`] || trPt;
        const isOutOnly = grp.arcs.every((a) => a.dir === "out");
        const mirrorId = `M:${trName}:${grp.place}`;
        const best = placeMirrorAroundHost(
          mirrorId,
          hostId,
          trPt,
          false,
          trName,
          trObj,
          plPt,
          isOutOnly,
          grp.place,
          "place"
        );

        const mNode = {
          id: mirrorId,
          kind: "place",
          hostId,
          trName,
          place: grp.place,
          label: grp.place,
          x: best.x,
          y: best.y,
          r: MIRROR_R,
          envHalfW: best.envHalfW,
          envTopH: best.envTopH,
          envBotH: best.envBotH,
          dirs: grp.arcs.map((a) => a.dir)
        };
        mirrors.push(mNode);

        const count = grp.arcs.length;
        grp.arcs.forEach((item, aIdx) => {
          const isOut = item.dir === "out";
          const pS = isOut ? trPt : { x: mNode.x, y: mNode.y };
          const pD = isOut ? { x: mNode.x, y: mNode.y } : trPt;
          const cdx = mNode.x - trPt.x;
          const cdy = mNode.y - trPt.y;
          const dist = Math.hypot(cdx, cdy) || 1;
          const cnx = -cdy / dist;
          const cny = cdx / dist;
          const curveOff = count > 1 ? (aIdx % 2 === 0 ? 16 : -16) : 0;
          const mid = { x: (pS.x + pD.x) / 2 + cnx * curveOff, y: (pS.y + pD.y) / 2 + cny * curveOff };

          const customMirWpsRaw = positions && Array.isArray(positions[`W:${item.id}`]) ? positions[`W:${item.id}`] : null;
          const customMirWps = customMirWpsRaw
            ? customMirWpsRaw.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ x: p.x, y: p.y }))
            : [];
          const hasCustomMirWps = customMirWps.length > 0;
          const firstRef = hasCustomMirWps ? customMirWps[0] : mid;
          const lastRef = hasCustomMirWps ? customMirWps[customMirWps.length - 1] : mid;

          const startPt = isOut
            ? clipProtectedPort(trPt.x, trPt.y, false, trName, trObj, firstRef.x, firstRef.y, false, useGravity)
            : clipMirrorPort(mNode, firstRef.x, firstRef.y, false);
          const endPt = isOut
            ? clipMirrorPort(mNode, lastRef.x, lastRef.y, true)
            : clipProtectedPort(trPt.x, trPt.y, false, trName, trObj, lastRef.x, lastRef.y, true, useGravity);

          const finalPts = hasCustomMirWps
            ? [startPt, ...customMirWps, endPt]
            : count > 1
            ? [startPt, mid, endPt]
            : [startPt, endPt];
          const pathD = tautRoundedPath(finalPts, 14, hasCustomMirWps);
          const labelPt = hasCustomMirWps ? polylineMidpoint(finalPts) : null;
          const lx = labelPt ? labelPt.x : count > 1 ? mid.x : startPt.x + (endPt.x - startPt.x) * 0.52;
          const ly = labelPt ? labelPt.y : count > 1 ? mid.y : startPt.y + (endPt.y - startPt.y) * 0.52;

          mirrorArcRouted.push({
            ...item,
            isMirrored: true,
            mirrorId: mNode.id,
            hasCustomWaypoints: hasCustomMirWps,
            customWaypoints: customMirWps,
            startPt,
            endPt,
            waypoints: finalPts,
            finalPts,
            pathD,
            lx,
            ly
          });
        });
      }
    }

    // 6B. Dock Incoming Transition Mirrors at Destination Places (`MT:place:trName`, "entrada em places"!)
    const incomingByPlace = new Map();
    for (const grp of mirrorGroups.values()) {
      const outArcs = grp.arcs.filter((a) => a.dir === "out");
      if (outArcs.length === 0) continue;
      if (!incomingByPlace.has(grp.place)) incomingByPlace.set(grp.place, []);
      incomingByPlace.get(grp.place).push({ trName: grp.trName, place: grp.place, arcs: outArcs });
    }

    const sortedPlaceNames = Array.from(incomingByPlace.keys()).sort((a, b) => {
      const pa = positions[`P:${a}`] || { x: 0, y: 0 };
      const pb = positions[`P:${b}`] || { x: 0, y: 0 };
      return pa.y - pb.y || pa.x - pb.x || a.localeCompare(b);
    });

    for (const placeName of sortedPlaceNames) {
      const hostId = `P:${placeName}`;
      const plPt = positions[hostId];
      if (!plPt) continue;

      const list = incomingByPlace.get(placeName).sort((a, b) => {
        const ta = positions[`T:${a.trName}`] || { x: 0, y: 0 };
        const tb = positions[`T:${b.trName}`] || { x: 0, y: 0 };
        return ta.y - tb.y || ta.x - tb.x || a.trName.localeCompare(b.trName);
      });

      for (const entry of list) {
        const trName = entry.trName;
        const trPt = positions[`T:${trName}`] || plPt;
        const mirrorId = `MT:${placeName}:${trName}`;
        // Incoming to place -> isOutFromHost = false (docks on the input/left/top side of the Place!)
        const best = placeMirrorAroundHost(
          mirrorId,
          hostId,
          plPt,
          true,
          placeName,
          null,
          trPt,
          false,
          trName,
          "transition"
        );

        const mtNode = {
          id: mirrorId,
          kind: "transition",
          hostId,
          trName,
          place: placeName,
          label: trName,
          x: best.x,
          y: best.y,
          r: MIRROR_R,
          envHalfW: best.envHalfW,
          envTopH: best.envTopH,
          envBotH: best.envBotH,
          dirs: ["out"]
        };
        mirrors.push(mtNode);

        const count = entry.arcs.length;
        entry.arcs.forEach((item, aIdx) => {
          const cdx = plPt.x - mtNode.x;
          const cdy = plPt.y - mtNode.y;
          const dist = Math.hypot(cdx, cdy) || 1;
          const cnx = -cdy / dist;
          const cny = cdx / dist;
          const curveOff = count > 1 ? (aIdx % 2 === 0 ? 16 : -16) : 0;
          const mid = {
            x: (mtNode.x + plPt.x) / 2 + cnx * curveOff,
            y: (mtNode.y + plPt.y) / 2 + cny * curveOff
          };

          const pmirId = `${item.id}:pmir`;
          const customPmirWpsRaw = positions && Array.isArray(positions[`W:${pmirId}`]) ? positions[`W:${pmirId}`] : null;
          const customPmirWps = customPmirWpsRaw
            ? customPmirWpsRaw.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ x: p.x, y: p.y }))
            : [];
          const hasCustomPmirWps = customPmirWps.length > 0;
          const firstRef = hasCustomPmirWps ? customPmirWps[0] : mid;
          const lastRef = hasCustomPmirWps ? customPmirWps[customPmirWps.length - 1] : mid;

          const startPt = clipMirrorPort(mtNode, firstRef.x, firstRef.y, false);
          const endPt = clipProtectedPort(plPt.x, plPt.y, true, placeName, null, lastRef.x, lastRef.y, true, useGravity);

          const finalPts = hasCustomPmirWps
            ? [startPt, ...customPmirWps, endPt]
            : count > 1
            ? [startPt, mid, endPt]
            : [startPt, endPt];
          const pathD = tautRoundedPath(finalPts, 14, hasCustomPmirWps);
          const labelPt = hasCustomPmirWps ? polylineMidpoint(finalPts) : null;
          const lx = labelPt ? labelPt.x : count > 1 ? mid.x : startPt.x + (endPt.x - startPt.x) * 0.52;
          const ly = labelPt ? labelPt.y : count > 1 ? mid.y : startPt.y + (endPt.y - startPt.y) * 0.52;

          placeInputArcs.push({
            ...item,
            id: pmirId,
            baseArcId: item.id,
            isMirrored: true,
            isPlaceInputMirror: true,
            mirrorId: mtNode.id,
            hasCustomWaypoints: hasCustomPmirWps,
            customWaypoints: customPmirWps,
            startPt,
            endPt,
            waypoints: finalPts,
            finalPts,
            pathD,
            lx,
            ly
          });
        });
      }
    }

    return {
      arcs: [...finalDirect, ...mirrorArcRouted],
      placeInputArcs,
      mirrors
    };
  }

  function computeSpnArcPaths(ast, positions, opts = {}) {
    return computeSpnArcGraph(ast, positions, { ...opts, useMirrors: false }).arcs;
  }

  // =========================================================================
  // 6. RBD ANALYTICAL EVALUATOR, FORMAL AUDIT & ORTHOGONAL LAYOUT ENGINE
  // =========================================================================
  function evalKofN(probs, k) {
    const n = probs.length;
    if (k <= 0) return 1;
    if (k > n) return 0;
    let dp = new Array(n + 1).fill(0);
    dp[0] = 1;
    for (const p of probs) {
      const next = new Array(n + 1).fill(0);
      for (let j = 0; j < n; j++) {
        next[j] += dp[j] * (1 - p);
        next[j + 1] += dp[j] * p;
      }
      next[n] += dp[n] * (1 - p);
      dp = next;
    }
    let sum = 0;
    for (let j = k; j <= n; j++) sum += dp[j];
    return Math.max(0, Math.min(1, sum));
  }

  function detectDefaultMissionTime(ast, paramMap) {
    for (const m of ast.metrics || []) {
      const tm = String(m.raw || "").match(/reliability\s*\(\s*time\s*=\s*([^)]+)\)/i);
      if (tm) {
        const v = resolveValue(tm[1].trim(), paramMap);
        if (v !== null && v > 0) return v;
      }
    }
    for (const key of ["t", "eventDuration", "missionTime", "T"]) {
      if (typeof paramMap[key] === "number" && paramMap[key] > 0) return paramMap[key];
    }
    return 8.0;
  }

  function evaluateRbd(ast, missionTimeOverride) {
    const paramMap = buildParamMap(ast);
    const t =
      typeof missionTimeOverride === "number" && Number.isFinite(missionTimeOverride) && missionTimeOverride >= 0
        ? missionTimeOverride
        : detectDefaultMissionTime(ast, paramMap);

    const blockMap = {};
    for (const b of ast.blocks || []) blockMap[b.name] = b;
    const groupMap = {};
    for (const g of ast.groups || []) groupMap[g.name] = g;

    const blockMetrics = {};
    for (const b of ast.blocks || []) {
      if (b.kind === "hierarchy") {
        const av = resolveValue(b.availability, paramMap);
        const rel = resolveValue(b.reliability, paramMap);
        const A = av !== null ? av : rel !== null ? rel : 1.0;
        const R = rel !== null ? rel : av !== null ? av : 1.0;
        blockMetrics[b.name] = {
          kind: "hierarchy",
          A: Math.max(0, Math.min(1, A)),
          R: Math.max(0, Math.min(1, R)),
          mttf: null,
          mttr: null,
          hasExplicitA: av !== null,
          hasExplicitR: rel !== null
        };
      } else {
        const mttf = resolveValue(b.mttf, paramMap);
        const mttr = resolveValue(b.mttr, paramMap);
        const validMttf = mttf !== null && mttf > 0 ? mttf : null;
        const validMttr = mttr !== null && mttr >= 0 ? mttr : 0;
        const A = validMttf !== null ? validMttf / (validMttf + validMttr) : 1.0;
        const R = validMttf !== null ? Math.exp(-t / validMttf) : 1.0;
        blockMetrics[b.name] = {
          kind: "block",
          A,
          R,
          mttf: validMttf,
          mttr: validMttr,
          hasExplicitA: true,
          hasExplicitR: true
        };
      }
    }

    function evalNode(name, mode, overrideBlock, overrideVal, visiting) {
      if (!name) return 1.0;
      if (visiting.has(name)) return 1.0;
      if (blockMap[name]) {
        if (overrideBlock === name) return overrideVal;
        return mode === "A" ? blockMetrics[name].A : blockMetrics[name].R;
      }
      const g = groupMap[name];
      if (!g || !g.children || g.children.length === 0) return 1.0;
      visiting.add(name);
      const childProbs = g.children.map((ch) => evalNode(ch, mode, overrideBlock, overrideVal, visiting));
      visiting.delete(name);

      if (g.kind === "series") {
        return childProbs.reduce((acc, p) => acc * p, 1.0);
      } else if (g.kind === "parallel") {
        return 1.0 - childProbs.reduce((acc, p) => acc * (1.0 - p), 1.0);
      } else if (g.kind === "kooN") {
        const kVal = resolveValue(g.k, paramMap) ?? 1;
        return evalKofN(childProbs, Math.round(kVal));
      }
      return 1.0;
    }

    const topName = ast.top || (ast.groups.length > 0 ? ast.groups[ast.groups.length - 1].name : ast.blocks[0]?.name || "");
    const sysA = topName ? evalNode(topName, "A", null, null, new Set()) : 0;
    const sysR = topName ? evalNode(topName, "R", null, null, new Set()) : 0;

    // Group-level metrics
    const groupMetrics = {};
    for (const g of ast.groups || []) {
      groupMetrics[g.name] = {
        A: evalNode(g.name, "A", null, null, new Set()),
        R: evalNode(g.name, "R", null, null, new Set())
      };
    }

    // Birnbaum importance & SPOF detection for every leaf block
    const spofs = new Set();
    const importance = [];
    for (const b of ast.blocks || []) {
      const rUp = evalNode(topName, "R", b.name, 1.0, new Set());
      const rDown = evalNode(topName, "R", b.name, 0.0, new Set());
      const aUp = evalNode(topName, "A", b.name, 1.0, new Set());
      const aDown = evalNode(topName, "A", b.name, 0.0, new Set());
      const isSpof = rDown <= 1e-12 && rUp > 0;
      if (isSpof) spofs.add(b.name);
      importance.push({
        name: b.name,
        kind: b.kind,
        isSpof,
        birnbaumR: rUp - rDown,
        birnbaumA: aUp - aDown,
        unreliabilityGain: rUp - sysR,
        unavailabilityGain: aUp - sysA,
        blockR: blockMetrics[b.name].R,
        blockA: blockMetrics[b.name].A
      });
    }
    importance.sort((x, y) => y.unreliabilityGain - x.unreliabilityGain);

    // Annual downtime (assuming hours) and number of nines
    const downtimeHoursYear = (1.0 - sysA) * 8760.0;
    const nines = sysA >= 1.0 ? Infinity : sysA <= 0 ? 0 : -Math.log10(1.0 - sysA);

    // Reliability curve R(tau) across 0..maxT for quick inspection
    const curveMaxT = Math.max(t * 2, 24);
    const curve = [];
    const evalRAtTime = (tau) => {
      const saved = {};
      for (const b of ast.blocks || []) {
        saved[b.name] = blockMetrics[b.name].R;
        if (b.kind === "block" && blockMetrics[b.name].mttf) {
          blockMetrics[b.name].R = Math.exp(-tau / blockMetrics[b.name].mttf);
        }
      }
      const val = evalNode(topName, "R", null, null, new Set());
      for (const b of ast.blocks || []) blockMetrics[b.name].R = saved[b.name];
      return val;
    };
    for (let s = 0; s <= 12; s++) {
      const tau = (curveMaxT * s) / 12;
      curve.push({ t: tau, R: evalRAtTime(tau) });
    }

    return {
      topName,
      missionTime: t,
      sysA,
      sysR,
      downtimeHoursYear,
      nines,
      blockMetrics,
      groupMetrics,
      spofs: Array.from(spofs),
      importance,
      curve
    };
  }

  function auditRbd(ast, missionTimeOverride) {
    const paramMap = buildParamMap(ast);
    const rbdEval = evaluateRbd(ast, missionTimeOverride);
    const blockSet = new Set((ast.blocks || []).map((b) => b.name));
    const groupSet = new Set((ast.groups || []).map((g) => g.name));
    const allNames = new Set([...blockSet, ...groupSet]);

    const stats = {
      blocks: (ast.blocks || []).length,
      expBlocks: (ast.blocks || []).filter((b) => b.kind === "block").length,
      hierBlocks: (ast.blocks || []).filter((b) => b.kind === "hierarchy").length,
      groups: (ast.groups || []).length,
      seriesGroups: (ast.groups || []).filter((g) => g.kind === "series").length,
      parallelGroups: (ast.groups || []).filter((g) => g.kind === "parallel").length,
      kooNGroups: (ast.groups || []).filter((g) => g.kind === "kooN").length,
      spofs: rbdEval.spofs.length,
      metrics: (ast.metrics || []).length,
      parameters: (ast.parameters || []).length,
      // SPN fields zeroed for unified UI status counters
      places: (ast.blocks || []).length,
      transitions: (ast.groups || []).length,
      totalArcs: (ast.groups || []).reduce((acc, g) => acc + (g.children || []).length, 0)
    };

    const hiddenItems = [];
    const warnings = [];

    const checkRbdMercuryIdentifier = (id, kindLabel, nodeId) => {
      if (MERCURY_RESERVED_WORDS.has(id)) {
        warnings.push({
          severity: "error",
          nodeId,
          message: `${kindLabel} '${id}' usa uma palavra reservada da gramática JFlex do Mercury 6.2 (lexico.flex). Renomeie para evitar erro de sintaxe no CLI.`
        });
      } else if (!MERCURY_IDENT_RE.test(id)) {
        warnings.push({
          severity: "error",
          nodeId,
          message: `${kindLabel} '${id}' viola a regra léxica do Mercury (deve iniciar por letra ASCII e conter apenas letras, dígitos ou '_').`
        });
      }
    };
    for (const p of ast.parameters || []) checkRbdMercuryIdentifier(p.name, "Parâmetro", null);
    for (const m of ast.metrics || []) checkRbdMercuryIdentifier(m.name, "Métrica", null);
    for (const b of ast.blocks || []) checkRbdMercuryIdentifier(b.name, "Bloco RBD", `B:${b.name}`);
    for (const g of ast.groups || []) checkRbdMercuryIdentifier(g.name, "Grupo RBD", `G:${g.name}`);

    for (const b of ast.blocks || []) {
      const m = rbdEval.blockMetrics[b.name];
      const spofTag = rbdEval.spofs.includes(b.name) ? " [SPOF]" : "";
      if (b.kind === "hierarchy") {
        hiddenItems.push({
          category: "Hierárquico",
          element: b.name + spofTag,
          nodeId: `B:${b.name}`,
          detail: `R=${(m.R * 100).toFixed(4)}%, A=${(m.A * 100).toFixed(4)}% (${b.reliability ? "reliability=" + b.reliability : ""}${b.availability ? (b.reliability ? ", " : "") + "availability=" + b.availability : ""})`
        });
      } else {
        hiddenItems.push({
          category: "Bloco Exp.",
          element: b.name + spofTag,
          nodeId: `B:${b.name}`,
          detail: `MTTF=${b.mttf}${m.mttf !== null ? " (" + m.mttf + ")" : ""}, MTTR=${b.mttr}${m.mttr !== null ? " (" + m.mttr + ")" : ""} → A=${(m.A * 100).toFixed(4)}%, R(t=${rbdEval.missionTime})=${(m.R * 100).toFixed(4)}%`
        });
      }
      if (rbdEval.spofs.includes(b.name)) {
        hiddenItems.push({
          category: "SPOF",
          element: b.name,
          nodeId: `B:${b.name}`,
          detail: `Ponto Único de Falha no caminho crítico de '${rbdEval.topName}' (falha derruba sistema para 0).`
        });
      }
    }

    for (const g of ast.groups || []) {
      const gm = rbdEval.groupMetrics[g.name] || { A: 0, R: 0 };
      const label = g.kind === "kooN" ? `${g.k}-de-${g.children.length}` : g.kind.toUpperCase();
      hiddenItems.push({
        category: g.kind === "kooN" ? "k-de-N" : g.kind === "parallel" ? "Paralelo" : "Série",
        element: `${g.name} (${label})`,
        nodeId: `G:${g.name}`,
        detail: `Filhos: [${g.children.join(", ")}] → A=${(gm.A * 100).toFixed(4)}%, R(t)=${(gm.R * 100).toFixed(4)}%`
      });

      if (g.kind === "kooN") {
        const kv = resolveValue(g.k, paramMap);
        if (kv !== null && (kv < 1 || kv > g.children.length)) {
          warnings.push({
            severity: "error",
            nodeId: `G:${g.name}`,
            message: `Grupo k-de-N '${g.name}' tem k=${kv} fora do intervalo válido [1..${g.children.length}].`
          });
        }
        if (kv !== null && kv > 1 && kv < g.children.length) {
          warnings.push({
            severity: "info",
            nodeId: `G:${g.name}`,
            message: `Compatibilidade Mercury 6.2 CLI: 'koon' (${kv}-de-${g.children.length}) é exportado na sintaxe formal 'koon ${g.name}( k = ${kv}, n = ${g.children.length}, mttf = ..., mttr = ... );' (RBDKOutOfNBlock.java).`
          });
        }
      }

      for (const ch of g.children || []) {
        if (!allNames.has(ch)) {
          warnings.push({
            severity: "error",
            nodeId: `G:${g.name}`,
            message: `Grupo '${g.name}' referencia componente inexistente '${ch}'.`
          });
        }
      }
    }

    if (!ast.top) {
      warnings.push({
        severity: "warn",
        nodeId: null,
        message: "Declaração 'top <bloco>;' ausente no RBD (usando último grupo como raiz visual)."
      });
    } else if (!allNames.has(ast.top)) {
      warnings.push({
        severity: "error",
        nodeId: null,
        message: `Bloco 'top ${ast.top}' não existe entre os blocos ou grupos declarados.`
      });
    }

    // Reachability check from top
    const reachable = new Set();
    const visit = (name) => {
      if (!name || reachable.has(name)) return;
      reachable.add(name);
      const g = (ast.groups || []).find((x) => x.name === name);
      if (g) for (const ch of g.children || []) visit(ch);
    };
    visit(rbdEval.topName);

    for (const b of ast.blocks || []) {
      if (!reachable.has(b.name)) {
        warnings.push({
          severity: "warn",
          nodeId: `B:${b.name}`,
          message: `Bloco '${b.name}' não está conectado à árvore de 'top ${rbdEval.topName}' (órfão).`
        });
      }
    }

    if (rbdEval.spofs.length > 0) {
      warnings.push({
        severity: "info",
        nodeId: `B:${rbdEval.spofs[0]}`,
        message: `${rbdEval.spofs.length} Ponto(s) Único(s) de Falha (SPOF) em série no caminho crítico: ${rbdEval.spofs.join(", ")}.`
      });
    }

    return {
      stats,
      hiddenItems,
      warnings,
      conditionalLegend: [],
      condExprToTag: {},
      paramMap,
      rbdEval
    };
  }

  function computeRbdLayout(ast) {
    const blockMap = {};
    for (const b of ast.blocks || []) blockMap[b.name] = b;
    const groupMap = {};
    for (const g of ast.groups || []) groupMap[g.name] = g;

    const LEAF_W = 160;
    const LEAF_H = 82;
    const SERIES_GAP = 44;
    const PAR_GAP_Y = 26;
    const PAR_BUS_X = 38;
    const PAR_PAD_TOP = 42;
    const PAR_PAD_BOT = 20;

    function measure(name, visiting, depth = 0) {
      if (!name || visiting.has(name) || blockMap[name] || !groupMap[name]) {
        return { name, kind: blockMap[name] ? blockMap[name].kind : "missing", w: LEAF_W, h: LEAF_H, children: [] };
      }
      const g = groupMap[name];
      visiting.add(name);
      const kids = (g.children || []).map((ch) => measure(ch, visiting, depth + 1));
      visiting.delete(name);

      if (kids.length === 0) {
        return { name, kind: g.kind, group: g, w: LEAF_W, h: LEAF_H, children: [] };
      }

      if (g.kind === "series") {
        const innerW = kids.reduce((acc, k) => acc + k.w, 0) + SERIES_GAP * Math.max(0, kids.length - 1);
        const innerH = Math.max(...kids.map((k) => k.h));
        const padW = depth > 0 ? 24 : 0;
        const padH = depth > 0 ? 34 : 0;
        return { name, kind: "series", group: g, w: innerW + padW, h: innerH + padH, innerW, innerH, children: kids };
      } else {
        // parallel or kooN
        const innerW = Math.max(...kids.map((k) => k.w));
        const innerH = kids.reduce((acc, k) => acc + k.h, 0) + PAR_GAP_Y * Math.max(0, kids.length - 1);
        return {
          name,
          kind: g.kind,
          group: g,
          w: innerW + PAR_BUS_X * 2,
          h: innerH + PAR_PAD_TOP + PAR_PAD_BOT,
          innerW,
          children: kids
        };
      }
    }

    const topName = ast.top || (ast.groups.length > 0 ? ast.groups[ast.groups.length - 1].name : ast.blocks[0]?.name || "");
    const boxes = [];
    const groupFrames = [];
    const wires = [];

    if (!topName) {
      return { boxes, groupFrames, wires, startPt: { x: 60, y: 200 }, endPt: { x: 260, y: 200 }, bounds: { minX: 0, minY: 0, maxX: 320, maxY: 400 } };
    }

    const tree = measure(topName, new Set());

    function place(node, x0, centerY, depth) {
      if (!node.group) {
        boxes.push({
          name: node.name,
          kind: node.kind,
          block: blockMap[node.name] || null,
          x: x0,
          y: centerY - node.h / 2,
          w: node.w,
          h: node.h,
          cx: x0 + node.w / 2,
          cy: centerY
        });
        return;
      }

      if (node.kind === "series") {
        const padX = depth > 0 ? 12 : 0;
        const innerCenterY = depth > 0 ? centerY + 6 : centerY;
        if (depth > 0) {
          groupFrames.push({
            name: node.name,
            kind: "series",
            group: node.group,
            x: x0,
            y: centerY - node.h / 2,
            w: node.w,
            h: node.h
          });
          // Short horizontal entry/exit wire into padded series frame
          wires.push({ x1: x0, y1: centerY, x2: x0 + padX, y2: innerCenterY });
          wires.push({ x1: x0 + node.w - padX, y1: innerCenterY, x2: x0 + node.w, y2: centerY });
        }
        let cx = x0 + padX;
        node.children.forEach((child, idx) => {
          place(child, cx, innerCenterY, depth + 1);
          if (idx > 0) {
            wires.push({ x1: cx - SERIES_GAP, y1: innerCenterY, x2: cx, y2: innerCenterY });
          }
          cx += child.w + SERIES_GAP;
        });
      } else {
        // parallel or kooN
        const leftBusX = x0 + PAR_BUS_X * 0.45;
        const rightBusX = x0 + node.w - PAR_BUS_X * 0.45;
        const topY = centerY - node.h / 2;

        groupFrames.push({
          name: node.name,
          kind: node.kind,
          group: node.group,
          x: x0 + 4,
          y: topY,
          w: node.w - 8,
          h: node.h
        });

        // Entry & exit stubs on horizontal midline
        wires.push({ x1: x0, y1: centerY, x2: leftBusX, y2: centerY });
        wires.push({ x1: rightBusX, y1: centerY, x2: x0 + node.w, y2: centerY });

        let curY = topY + PAR_PAD_TOP;
        const branchYs = [];
        for (const child of node.children) {
          const childCenterY = curY + child.h / 2;
          branchYs.push(childCenterY);
          const childX0 = x0 + PAR_BUS_X + (node.innerW - child.w) / 2;
          place(child, childX0, childCenterY, depth + 1);
          // Connect left bus -> child left & child right -> right bus
          wires.push({ x1: leftBusX, y1: childCenterY, x2: childX0, y2: childCenterY });
          wires.push({ x1: childX0 + child.w, y1: childCenterY, x2: rightBusX, y2: childCenterY });
          curY += child.h + PAR_GAP_Y;
        }

        if (branchYs.length >= 2) {
          const yMin = Math.min(...branchYs, centerY);
          const yMax = Math.max(...branchYs, centerY);
          wires.push({ x1: leftBusX, y1: yMin, x2: leftBusX, y2: yMax });
          wires.push({ x1: rightBusX, y1: yMin, x2: rightBusX, y2: yMax });
        }
      }
    }

    const startX = 70;
    const treeX0 = startX + 64;
    const centerY = Math.max(240, tree.h / 2 + 110);
    place(tree, treeX0, centerY, 0);

    const endX = treeX0 + tree.w + 64;
    wires.push({ x1: startX + 18, y1: centerY, x2: treeX0, y2: centerY });
    wires.push({ x1: treeX0 + tree.w, y1: centerY, x2: endX - 18, y2: centerY });

    // Place any orphan blocks cleanly below the main RBD so they are NEVER hidden!
    const placedNames = new Set(boxes.map((b) => b.name));
    const orphans = (ast.blocks || []).filter((b) => !placedNames.has(b.name));
    let maxY = centerY + tree.h / 2 + 60;
    if (orphans.length > 0) {
      const orphanY = maxY + 60;
      orphans.forEach((b, idx) => {
        const ox = treeX0 + idx * (LEAF_W + 30);
        boxes.push({
          name: b.name,
          kind: b.kind,
          block: b,
          isOrphan: true,
          x: ox,
          y: orphanY,
          w: LEAF_W,
          h: LEAF_H,
          cx: ox + LEAF_W / 2,
          cy: orphanY + LEAF_H / 2
        });
      });
      maxY = orphanY + LEAF_H + 50;
    }

    return {
      topName,
      boxes,
      groupFrames,
      wires,
      startPt: { x: startX, y: centerY },
      endPt: { x: endX, y: centerY },
      bounds: {
        minX: startX - 50,
        minY: centerY - tree.h / 2 - 80,
        maxX: endX + 60,
        maxY
      }
    };
  }

  // =========================================================================
  // 7. TOKEN GAME ENGINE (DETERMINISTIC MERCURY EXPRESSION & FIRING EVALUATOR)
  // =========================================================================
  function evalMercuryBool(expr, marking, paramMap) {
    const s = String(expr || "").trim();
    if (!s) return true;
    // Strip outer balanced parentheses
    let clean = s;
    while (clean.startsWith("(") && clean.endsWith(")")) {
      let depth = 0, wrapsAll = true;
      for (let i = 0; i < clean.length - 1; i++) {
        if (clean[i] === "(") depth++;
        else if (clean[i] === ")") depth--;
        if (depth === 0) { wrapsAll = false; break; }
      }
      if (wrapsAll) clean = clean.slice(1, -1).trim();
      else break;
    }

    // Split top-level OR (lowest precedence)
    const splitTop = (str, opWord) => {
      const parts = [];
      let depth = 0, last = 0;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === "(") depth++;
        else if (str[i] === ")") depth--;
        else if (depth === 0) {
          const sub = str.slice(i);
          const m = sub.match(new RegExp(`^${opWord}(?![A-Za-z0-9_])`, "i"));
          if (m && (i === 0 || /[\s)]/.test(str[i - 1]))) {
            parts.push(str.slice(last, i).trim());
            i += opWord.length - 1;
            last = i + 1;
          }
        }
      }
      if (parts.length > 0) {
        parts.push(str.slice(last).trim());
        return parts;
      }
      return null;
    };

    const orParts = splitTop(clean, "OR");
    if (orParts) return orParts.some((p) => evalMercuryBool(p, marking, paramMap));

    const andParts = splitTop(clean, "AND");
    if (andParts) return andParts.every((p) => evalMercuryBool(p, marking, paramMap));

    if (/^NOT(?![A-Za-z0-9_])/i.test(clean)) {
      return !evalMercuryBool(clean.slice(3).trim(), marking, paramMap);
    }

    // Comparison operator at top level: >=, <=, !=, <>, =, >, <
    let depth = 0;
    for (let i = 0; i < clean.length; i++) {
      if (clean[i] === "(") depth++;
      else if (clean[i] === ")") depth--;
      else if (depth === 0) {
        const two = clean.slice(i, i + 2);
        const one = clean[i];
        let op = null;
        if (two === ">=" || two === "<=" || two === "!=" || two === "<>" || two === "==") op = two;
        else if (one === "=" || one === ">" || one === "<") op = one;
        if (op) {
          const lhs = evalMercuryNumeric(clean.slice(0, i).trim(), marking, paramMap);
          const rhs = evalMercuryNumeric(clean.slice(i + op.length).trim(), marking, paramMap);
          if (op === "=" || op === "==") return lhs === rhs;
          if (op === "!=" || op === "<>") return lhs !== rhs;
          if (op === ">=") return lhs >= rhs;
          if (op === "<=") return lhs <= rhs;
          if (op === ">") return lhs > rhs;
          if (op === "<") return lhs < rhs;
        }
      }
    }
    return evalMercuryNumeric(clean, marking, paramMap) !== 0;
  }

  function evalMercuryNumeric(expr, marking, paramMap) {
    const s = String(expr ?? "1").trim();
    if (!s) return 0;

    // Handle chained IF(cond):(thenExpr)...ELSE(elseExpr)
    if (/^IF\s*\(/i.test(s)) {
      let idx = 0;
      const readParenGroup = (start) => {
        if (s[start] !== "(") return null;
        let depth = 0;
        for (let i = start; i < s.length; i++) {
          if (s[i] === "(") depth++;
          else if (s[i] === ")") {
            depth--;
            if (depth === 0) return { content: s.slice(start + 1, i), end: i + 1 };
          }
        }
        return null;
      };
      while (idx < s.length) {
        while (idx < s.length && /\s/.test(s[idx])) idx++;
        if (/^IF\s*\(/i.test(s.slice(idx))) {
          const pOpen = s.indexOf("(", idx);
          const condGrp = readParenGroup(pOpen);
          if (!condGrp) break;
          idx = condGrp.end;
          while (idx < s.length && /[\s:]/.test(s[idx])) idx++;
          const thenGrp = readParenGroup(idx);
          if (!thenGrp) break;
          idx = thenGrp.end;
          if (evalMercuryBool(condGrp.content, marking, paramMap)) {
            return evalMercuryNumeric(thenGrp.content, marking, paramMap);
          }
        } else if (/^ELSE\s*\(/i.test(s.slice(idx))) {
          const pOpen = s.indexOf("(", idx);
          const elseGrp = readParenGroup(pOpen);
          if (!elseGrp) break;
          return evalMercuryNumeric(elseGrp.content, marking, paramMap);
        } else {
          break;
        }
      }
      return 0;
    }

    // Substitute #Place tokens and parameter names, then evaluate safe arithmetic
    let replaced = s.replace(/#([A-Za-z_][A-Za-z0-9_]*)/g, (_, pl) => String(marking[pl] ?? 0));
    replaced = replaced.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m) => {
      if (Object.prototype.hasOwnProperty.call(paramMap, m) && typeof paramMap[m] === "number") {
        return String(paramMap[m]);
      }
      return m;
    });
    if (/^[0-9.+\-*/()\s]+$/.test(replaced)) {
      try {
        const val = Function(`"use strict"; return (${replaced});`)();
        return Number.isFinite(val) ? Math.round(val) : 0;
      } catch (_) {
        return 0;
      }
    }
    const n = Number(replaced);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }

  function createInitialMarking(ast) {
    const paramMap = buildParamMap(ast);
    const marking = {};
    for (const pl of ast.places || []) {
      const v = resolveValue(pl.tokens, paramMap);
      marking[pl.name] = v !== null ? Math.max(0, Math.round(v)) : 0;
    }
    return marking;
  }

  function getEnabledTransitions(ast, marking, respectImmPriority = true) {
    const paramMap = buildParamMap(ast);
    const structurallyEnabled = [];

    for (const tr of ast.transitions || []) {
      let ok = true;

      // 1) Guard / enablingFunction
      if (tr.guard && tr.guard.trim() !== "") {
        if (!evalMercuryBool(tr.guard, marking, paramMap)) ok = false;
      }

      // 2) Input arcs (including conditional multiplicity evaluated at current marking)
      if (ok) {
        const neededByPlace = {};
        for (const a of tr.inputs || []) {
          const w = Math.max(0, evalMercuryNumeric(a.multiplicity || "1", marking, paramMap));
          neededByPlace[a.place] = (neededByPlace[a.place] || 0) + w;
        }
        for (const [pl, need] of Object.entries(neededByPlace)) {
          if ((marking[pl] ?? 0) < need) {
            ok = false;
            break;
          }
        }
      }

      // 3) Inhibitor arcs (transition disabled if marking[place] >= inhibitor weight)
      if (ok) {
        for (const a of tr.inhibitors || []) {
          const w = Math.max(1, evalMercuryNumeric(a.multiplicity || "1", marking, paramMap));
          if ((marking[a.place] ?? 0) >= w) {
            ok = false;
            break;
          }
        }
      }

      if (ok) structurallyEnabled.push(tr);
    }

    const immEnabled = structurallyEnabled.filter((t) => t.kind === "immediate");
    if (respectImmPriority && immEnabled.length > 0) {
      const maxPrio = Math.max(...immEnabled.map((t) => resolveValue(t.priority, paramMap) ?? 0));
      const topImm = immEnabled.filter((t) => (resolveValue(t.priority, paramMap) ?? 0) === maxPrio);
      return {
        fireable: new Set(topImm.map((t) => t.name)),
        structurallyEnabled: new Set(structurallyEnabled.map((t) => t.name)),
        immPreempting: true
      };
    }

    return {
      fireable: new Set(structurallyEnabled.map((t) => t.name)),
      structurallyEnabled: new Set(structurallyEnabled.map((t) => t.name)),
      immPreempting: false
    };
  }

  function fireTransition(ast, trName, marking) {
    const tr = (ast.transitions || []).find((t) => t.name === trName);
    if (!tr) return null;
    const paramMap = buildParamMap(ast);
    const next = { ...marking };
    const deltas = [];

    // Evaluate ALL input and output arc weights BEFORE mutating marking (atomic Petri net firing semantics!)
    const inWeights = (tr.inputs || []).map((a) => ({
      place: a.place,
      w: Math.max(0, evalMercuryNumeric(a.multiplicity || "1", marking, paramMap))
    }));
    const outWeights = (tr.outputs || []).map((a) => ({
      place: a.place,
      w: Math.max(0, evalMercuryNumeric(a.multiplicity || "1", marking, paramMap))
    }));

    for (const iw of inWeights) {
      if (iw.w > 0) {
        next[iw.place] = Math.max(0, (next[iw.place] ?? 0) - iw.w);
        deltas.push(`-${iw.w} ${iw.place}`);
      }
    }
    for (const ow of outWeights) {
      if (ow.w > 0) {
        next[ow.place] = (next[ow.place] ?? 0) + ow.w;
        deltas.push(`+${ow.w} ${ow.place}`);
      }
    }

    return { marking: next, deltas };
  }

  function generateTransitionTable(ast) {
    const paramMap = buildParamMap(ast);
    const rows = (ast.transitions || []).map((tr) => {
      const kindStr =
        tr.kind === "immediate"
          ? `Imediata${tr.priority ? ` (π=${tr.priority})` : ""}`
          : `${tr.delayType === "Deterministic" ? "Det." : "Exp."} (${tr.delayExpr}${resolveValue(tr.delayExpr, paramMap) !== null && String(resolveValue(tr.delayExpr, paramMap)) !== tr.delayExpr ? "=" + resolveValue(tr.delayExpr, paramMap) : ""}, ${tr.serverType === "InfiniteServer" ? "∞" : "1"})`;
      const fmtArc = (a) => {
        const m = String(a.multiplicity || "1").trim();
        return m === "1" ? a.place : `${a.place}[${m}]`;
      };
      const pre = [
        ...(tr.inputs || []).map(fmtArc),
        ...(tr.inhibitors || []).map((a) => `¬${fmtArc(a)}`),
        ...(tr.guard ? [`G:(${tr.guard})`] : [])
      ].join(", ");
      const post = (tr.outputs || []).map(fmtArc).join(", ");
      return { name: tr.name, kindStr, pre: pre || "—", post: post || "—" };
    });

    const markdown =
      `| Transição | Tipo / Semântica | Pré-condições (Inputs / Inib. / Guard) | Pós-condições (Outputs) |\n` +
      `| :--- | :--- | :--- | :--- |\n` +
      rows.map((r) => `| \`${r.name}\` | ${r.kindStr} | ${r.pre} | ${r.post} |`).join("\n");

    const escTex = (s) => String(s).replace(/([_#&%{}])/g, "\\$1");
    const latex =
      `\\begin{table*}[t]\n\\centering\n\\caption{Transition firing rules of ${escTex(ast.modelName)}.}\n` +
      `\\begin{tabular}{llll}\n\\toprule\nTransition & Type / Policy & Pre-conditions & Post-conditions \\\\\n\\midrule\n` +
      rows.map((r) => `\\texttt{${escTex(r.name)}} & ${escTex(r.kindStr)} & ${escTex(r.pre)} & ${escTex(r.post)} \\\\`).join("\n") +
      `\n\\bottomrule\n\\end{tabular}\n\\end{table*}`;

    return { rows, markdown, latex };
  }

  function explainTransitionStatus(ast, trName, marking, respectImmPriority = true) {
    const tr = (ast.transitions || []).find((t) => t.name === trName);
    if (!tr) return { fireable: false, reasons: ["Transição não encontrada."] };
    const paramMap = buildParamMap(ast);
    const reasons = [];

    if (tr.guard && tr.guard.trim() !== "") {
      if (!evalMercuryBool(tr.guard, marking, paramMap)) {
        reasons.push(`Guard falsa: ${tr.guard}`);
      }
    }

    const neededByPlace = {};
    for (const a of tr.inputs || []) {
      const w = Math.max(0, evalMercuryNumeric(a.multiplicity || "1", marking, paramMap));
      neededByPlace[a.place] = (neededByPlace[a.place] || 0) + w;
    }
    for (const [pl, need] of Object.entries(neededByPlace)) {
      const have = marking[pl] ?? 0;
      if (have < need) {
        reasons.push(`Falta token em ${pl} (#${pl}=${have} < ${need})`);
      }
    }

    for (const a of tr.inhibitors || []) {
      const w = Math.max(1, evalMercuryNumeric(a.multiplicity || "1", marking, paramMap));
      const have = marking[a.place] ?? 0;
      if (have >= w) {
        reasons.push(`Bloqueada por inibidor ${a.place} (#${a.place}=${have} >= ${w})`);
      }
    }

    if (reasons.length === 0) {
      const en = getEnabledTransitions(ast, marking, respectImmPriority);
      if (en.fireable.has(trName)) {
        return { fireable: true, reasons: ["Pronta para disparar!"] };
      }
      if (en.immPreempting) {
        return { fireable: false, reasons: ["Preemptada por transição imediata de maior prioridade."] };
      }
    }
    return { fireable: false, reasons };
  }

  function detectConservationInvariants(ast, initMarking, curMarking) {
    const placeNames = new Set((ast.places || []).map((p) => p.name));
    const invariants = [];

    // 1) Shared server mutual exclusion (#ServerFree + #ServerBusy)
    if (placeNames.has("ServerFree") && placeNames.has("ServerBusy")) {
      const initSum = (initMarking.ServerFree ?? 0) + (initMarking.ServerBusy ?? 0);
      const curSum = (curMarking.ServerFree ?? 0) + (curMarking.ServerBusy ?? 0);
      invariants.push({
        label: "Exclusão Mútua Servidor",
        expr: "#ServerFree + #ServerBusy",
        expected: initSum,
        current: curSum,
        ok: curSum === initSum
      });
    }

    // 2) Turnstile population conservation (#Idle_Ti + #Arriving_Ti + #Outstanding_Ti)
    const branches = new Set();
    for (const p of placeNames) {
      const m = p.match(/_(T\d+)$/);
      if (m) branches.add(m[1]);
    }
    for (const b of Array.from(branches).sort()) {
      const trio = [`Idle_${b}`, `Arriving_${b}`, `Outstanding_${b}`].filter((n) => placeNames.has(n));
      if (trio.length >= 2) {
        const initSum = trio.reduce((s, n) => s + (initMarking[n] ?? 0), 0);
        const curSum = trio.reduce((s, n) => s + (curMarking[n] ?? 0), 0);
        invariants.push({
          label: `Conservação Catraca ${b}`,
          expr: trio.map((n) => `#${n}`).join(" + "),
          expected: initSum,
          current: curSum,
          ok: curSum === initSum
        });
      }
    }

    // 3) Up/Down availability pairs (e.g., Cloud_Up + Cloud_Down, Net_Up + Net_Down)
    for (const p of placeNames) {
      if (p.endsWith("_Up")) {
        const down = p.slice(0, -3) + "_Down";
        if (placeNames.has(down)) {
          const initSum = (initMarking[p] ?? 0) + (initMarking[down] ?? 0);
          const curSum = (curMarking[p] ?? 0) + (curMarking[down] ?? 0);
          invariants.push({
            label: `Par Up/Down (${p.slice(0, -3)})`,
            expr: `#${p} + #${down}`,
            expected: initSum,
            current: curSum,
            ok: curSum === initSum
          });
        }
      }
    }

    // 4) Always show total token count summary
    const totInit = Object.values(initMarking).reduce((a, b) => a + b, 0);
    const totCur = Object.values(curMarking).reduce((a, b) => a + b, 0);
    invariants.push({
      label: "Total de Tokens na Rede",
      expr: "Σ #P",
      expected: totInit,
      current: totCur,
      ok: true,
      infoOnly: true
    });

    return invariants;
  }

  return {
    tokenize,
    parseMry,
    generateMry,
    generateRbdMry,
    auditModel,
    evaluateRbd,
    auditRbd,
    computeRbdLayout,
    buildParamMap,
    resolveValue,
    summarizeCondition,
    computeAutoLayout,
    computeDefaultZones,
    computeSpnArcPaths,
    computeSpnArcGraph,
    clipProtectedPort,
    clipMirrorPort,
    getProtectedEnvelope,
    getNodeBranch,
    evalMercuryBool,
    evalMercuryNumeric,
    createInitialMarking,
    getEnabledTransitions,
    fireTransition,
    explainTransitionStatus,
    detectConservationInvariants,
    generateTransitionTable
  };
});
