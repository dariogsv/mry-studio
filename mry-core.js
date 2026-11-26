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
        if (text.includes("@mry-layout")) layoutComments.push(text);
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
        if (text.includes("@mry-layout")) layoutComments.push(text);
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
            multiplicity = s.value;
            isStringExpr = true;
            expect(")");
          } else {
            const rawMult = readRawUntil([")"]);
            multiplicity = rawMult || "1";
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
          tr.guardKey = propKey;
          if (peek().type === "STRING") {
            tr.guard = next().value;
          } else {
            tr.guard = readRawUntil([",", ")"]).replace(/^"|"$/g, "");
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
      const startTok = next(); // series | parallel | kooN | koutofn | kofn
      const nameTok = expect("IDENT");
      const children = [];
      let k = "";
      expect("(");
      while (peek().type !== ")" && peek().type !== "EOF") {
        if (peek().type === "IDENT" && peek(1).type === "=") {
          const pk = next().value;
          next(); // '='
          const pv = readRawUntil([",", ")"]);
          if (pk.toLowerCase() === "k") k = pv;
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

    // Parse layout/zones comment if present
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
    }

    while (peek().type !== "EOF") {
      const t = peek();

      if (t.type === "IDENT" && t.value === "SPN") {
        next(); // SPN
        ast.modelType = "SPN";
        ast.modelName = expect("IDENT").value;
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
          } else if (st.type === "IDENT" && /^(kooN|koutofn|kofn)$/i.test(st.value)) {
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
        ast.mainBlock = readBalancedBlock("{", "}");
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

    return ast;
  }

  // =========================================================================
  // 3. DETERMINISTIC MRY GENERATOR (AST -> .mry)
  // =========================================================================
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
      return `${arc.place}("${mult}")`;
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

  function generateMry(ast, options = {}) {
    if (ast.modelType === "RBD") {
      return generateRbdMry(ast, options);
    }
    const lines = [];

    // Global parameters
    for (const p of ast.parameters || []) {
      lines.push(`${p.name} = ${p.value};`);
    }
    if ((ast.parameters || []).length > 0) lines.push("");

    // SPN block
    lines.push(`${ast.modelType || "SPN"} ${ast.modelName || "Model"} {`);

    // Places
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
        lines.push(`    place ${pl.name}( ${props.join(", ")} );`);
      } else {
        lines.push(`    place ${pl.name};`);
      }
    }

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
        const gKey = tr.guardKey || "enablingFunction";
        props.push(`${gKey} = "${tr.guard.trim()}"`);
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
    if (ast.mainBlock && ast.mainBlock.trim() !== "") {
      lines.push("");
      lines.push(`main {${ast.mainBlock}}`);
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

    // Series / Parallel / kooN groups
    for (const g of ast.groups || []) {
      const childrenStr = (g.children || []).join(", ");
      if (g.kind === "kooN") {
        const kVal = String(g.k || "1").trim();
        lines.push(`    kooN ${g.name}( k = ${kVal}${childrenStr ? ", " + childrenStr : ""} );`);
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

    if (ast.mainBlock && ast.mainBlock.trim() !== "") {
      lines.push("");
      lines.push(`main {${ast.mainBlock}}`);
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

    // Structural warnings: isolated places
    for (const p of ast.places || []) {
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
  // 5. DETERMINISTIC AUTO-LAYOUT ENGINE (SYMMETRIC MULTI-BRANCH + LAYERED)
  // =========================================================================
  function getNodeBranch(name) {
    const m = name.match(/_(T\d+)$/);
    if (m) return m[1];
    if (/^Server|ProcessRequest/i.test(name)) return "SHARED";
    if (/Fail|Repair|UpServer|DownServer|DownTurnstile|UpTurnstile/i.test(name)) return "INFRA";
    return "MAIN";
  }

  function computeDefaultZones(ast) {
    const byKey = {};
    const add = (key, id) => {
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(id);
    };
    for (const p of ast.places || []) add(getNodeBranch(p.name), `P:${p.name}`);
    for (const t of ast.transitions || []) add(getNodeBranch(t.name), `T:${t.name}`);

    const keys = Object.keys(byKey).filter((k) => /^T\d+$/.test(k) || k === "SHARED" || k === "INFRA");
    if (keys.length < 2) {
      // Single-group models (e.g., Silo/Hibrido with INFRA): still group MAIN + INFRA if INFRA exists
      if (byKey["INFRA"] && byKey["MAIN"]) {
        return [
          { id: "zone_MAIN", label: "FLUXO PRINCIPAL", color: "#0284c7", members: byKey["MAIN"] },
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

      // Compute vertical Y baseline for each branch (mirroring bottom branches around shared server band!)
      const sharedCenterY = topPad + midSplit * branchHeight + sharedBandHeight / 2;

      sortedBranches.forEach((br, idx) => {
        const isLower = idx >= midSplit;
        const baseY = isLower
          ? topPad + midSplit * branchHeight + sharedBandHeight + (idx - midSplit) * branchHeight
          : topPad + idx * branchHeight;

        // If lower half, mirror rows so Queued/AcquireServer/InService sit CLOSEST to the shared server band!
        const rowY = (r) => {
          // r in [0..3]: 0 = outer edge (Sync/Timeout), 3 = inner edge closest to shared server (Queued/Acquire/InService)
          const rowStep = 105;
          if (!isLower) {
            return baseY + r * rowStep;
          } else {
            return baseY + (3 - r) * rowStep;
          }
        };

        // Place & Transition deterministic slot mapping by base name
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

      // Shared central server nodes
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

    // --- STRATEGY B: Deterministic Layered Flow Layout (Generic SPNs: Silo, P2P, Hibrido, custom) ---
    const mainNodes = [];
    const infraNodes = [];

    for (const p of ast.places || []) {
      const id = `P:${p.name}`;
      if (getNodeBranch(p.name) === "INFRA") infraNodes.push({ id, kind: "P", name: p.name, tokens: p.tokens });
      else mainNodes.push({ id, kind: "P", name: p.name, tokens: p.tokens });
    }
    for (const t of ast.transitions || []) {
      const id = `T:${t.name}`;
      if (getNodeBranch(t.name) === "INFRA") infraNodes.push({ id, kind: "T", name: t.name });
      else mainNodes.push({ id, kind: "T", name: t.name });
    }

    // Build directed adjacency for main nodes
    const adj = {};
    const inDeg = {};
    for (const n of mainNodes) { adj[n.id] = []; inDeg[n.id] = 0; }

    for (const tr of ast.transitions || []) {
      const tid = `T:${tr.name}`;
      if (!adj[tid]) continue;
      for (const a of tr.inputs || []) {
        const pid = `P:${a.place}`;
        if (adj[pid]) { adj[pid].push(tid); inDeg[tid]++; }
      }
      for (const a of tr.outputs || []) {
        const pid = `P:${a.place}`;
        if (adj[pid]) { adj[tid].push(pid); inDeg[pid]++; }
      }
    }

    // BFS layer assignment starting from Idle/initial-token places or zero-indegree nodes
    const layer = {};
    const queue = [];
    const roots = mainNodes.filter(
      (n) => n.kind === "P" && (/Idle|Arriving/i.test(n.name) || (n.tokens && n.tokens !== "0" && !/ESC|MeshCapacity/i.test(n.name)))
    );
    const startNodes = roots.length > 0 ? roots : mainNodes.slice(0, 1);
    for (const r of startNodes) {
      layer[r.id] = 0;
      queue.push(r.id);
    }

    while (queue.length > 0) {
      const cur = queue.shift();
      const l = layer[cur];
      for (const nxt of adj[cur] || []) {
        if (layer[nxt] === undefined) {
          layer[nxt] = l + 1;
          queue.push(nxt);
        }
      }
    }

    // Place remaining unvisited main nodes (e.g., ESC / MeshCapacity) near their connected transitions
    for (const n of mainNodes) {
      if (layer[n.id] === undefined) {
        const connected = (adj[n.id] || []).map((id) => layer[id]).filter((v) => v !== undefined);
        layer[n.id] = connected.length > 0 ? Math.max(0, Math.min(...connected) - 1) : 0;
      }
    }

    // Group by layer
    const byLayer = {};
    for (const n of mainNodes) {
      const l = layer[n.id] || 0;
      if (!byLayer[l]) byLayer[l] = [];
      byLayer[l].push(n);
    }

    const colStep = 175;
    const rowStep = 145;
    let maxMainY = 260;

    for (const lKey of Object.keys(byLayer).sort((a, b) => Number(a) - Number(b))) {
      const l = Number(lKey);
      const list = byLayer[l];
      const startY = Math.max(100, 240 - ((list.length - 1) * rowStep) / 2);
      list.forEach((n, idx) => {
        const y = startY + idx * rowStep;
        pos[n.id] = { x: 120 + l * colStep, y };
        if (y > maxMainY) maxMainY = y;
      });
    }

    // Arrange infrastructure/dependability failure-repair subsystem cleanly in a dedicated lower band
    const infraY = maxMainY + 190;
    const serverInfra = infraNodes.filter((n) => /Server/i.test(n.name));
    const turnstileInfra = infraNodes.filter((n) => !/Server/i.test(n.name));

    const placeBand = (list, startX, y) => {
      list.forEach((n, idx) => {
        pos[n.id] = { x: startX + idx * 170, y };
      });
    };

    placeBand(turnstileInfra, 140, infraY);
    placeBand(serverInfra, 140 + Math.max(turnstileInfra.length, 1) * 170 + 80, infraY);

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

  function clipAsymRect(cx, cy, leftW, rightW, topH, botH, tx, ty) {
    const dx = tx - cx;
    const dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const sx = dx > 0 ? rightW / dx : dx < 0 ? leftW / (-dx) : Infinity;
    const sy = dy > 0 ? botH / dy : dy < 0 ? topH / (-dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  /**
   * Protected Connection Frontier:
   * Expands the connection boundary vertically over top badges (EXP/DET/IMM)
   * and bottom text (node name, delay, guard) so arrows NEVER cross text or tags,
   * while keeping clean side attachment when approaching horizontally.
   */
  function getProtectedEnvelope(isPlace, name, tr, isEnd) {
    const pad = isEnd ? 5 : 3;
    const nameHalfW = Math.min(62, Math.max(28, String(name || "").length * 3.1 + 6));
    if (isPlace) {
      return {
        // Circle core + lower text zone (name sits around y + 28..46)
        coreR: SPN_PLACE_R + (isEnd ? 3 : 1),
        leftW: Math.max(SPN_PLACE_R + pad, nameHalfW * 0.72),
        rightW: Math.max(SPN_PLACE_R + pad, nameHalfW * 0.72),
        topH: SPN_PLACE_R + pad,
        botH: SPN_PLACE_R + 21 + pad // clears place name below circle
      };
    }
    const dim = getSpnTransDim(tr);
    const hasDelay = tr && tr.kind === "timed";
    const hasGuard = tr && tr.guard && tr.guard.trim() !== "";
    const topTagH = dim.h / 2 + 23 + pad; // clears top EXP/DET/IMM badge
    const botTextH = dim.h / 2 + 19 + (hasDelay ? 13 : 0) + (hasGuard ? 16 : 0) + pad;
    return {
      coreHW: dim.w / 2 + pad,
      coreHH: dim.h / 2 + pad,
      leftW: Math.max(dim.w / 2 + pad + 8, nameHalfW * 0.62),
      rightW: Math.max(dim.w / 2 + pad + 8, nameHalfW * 0.62),
      topH: topTagH,
      botH: botTextH
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

    if (isPlace) {
      // Only expand when approaching/leaving through the bottom name cone (uy > 0.35)
      if (uy > 0.35) {
        const ptEnv = clipAsymRect(cx, cy, env.leftW, env.rightW, env.topH, env.botH, tx, ty);
        // Smooth blend near cone boundary (0.35..0.60) to avoid sudden jump
        const ptCirc = clipCircle(cx, cy, env.coreR, tx, ty);
        const alpha = Math.min(1, (uy - 0.35) / 0.25);
        return {
          x: ptCirc.x + (ptEnv.x - ptCirc.x) * alpha,
          y: ptCirc.y + (ptEnv.y - ptCirc.y) * alpha
        };
      }
      return clipCircle(cx, cy, env.coreR, tx, ty);
    }

    // Transition: clear BOTH top badge cone (uy < -0.32) AND bottom name/delay/guard cone (uy > 0.32)
    // While keeping horizontal arrows cleanly attached to the transition bar!
    const absUy = Math.abs(uy);
    const ptBar = clipRect(cx, cy, env.coreHW, env.coreHH, tx, ty);
    if (absUy <= 0.30) {
      return ptBar;
    }
    const ptEnv = clipAsymRect(cx, cy, env.leftW, env.rightW, env.topH, env.botH, tx, ty);
    const alpha = Math.min(1, (absUy - 0.30) / 0.25);
    return {
      x: ptBar.x + (ptEnv.x - ptBar.x) * alpha,
      y: ptBar.y + (ptEnv.y - ptBar.y) * alpha
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

  function tautRoundedPath(rawPts, maxR = 20) {
    const pts = simplifyPolyline(rawPts, 4.5);
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

    // 2. Build node obstacle list (nodes + label protection halos)
    const obstacles = [];
    for (const [id, pt] of Object.entries(positions || {})) {
      const isPlace = id.startsWith("P:");
      obstacles.push({ id, x: pt.x, y: pt.y, r: isPlace ? 54 : 52 });
      obstacles.push({ id, x: pt.x, y: pt.y + (isPlace ? 42 : 44), r: 27 });
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

      const relevantObs = useGravity
        ? obstacles.filter((o) => {
            if (o.id === item.srcId || o.id === item.dstId) return false;
            return pointToSegDist(o.x, o.y, pSrc.x, pSrc.y, pDst.x, pDst.y) < o.r + 65;
          })
        : [];
      const directHits = relevantObs.filter((o) => pointToSegDist(o.x, o.y, pSrc.x, pSrc.y, pDst.x, pDst.y) < o.r);

      let waypoints;
      let isStraight = false;

      if (!useGravity || (directHits.length === 0 && totalInPair === 1)) {
        // Pure crisp straight line!
        waypoints = [{ x: pSrc.x, y: pSrc.y }, { x: pDst.x, y: pDst.y }];
        isStraight = true;
      } else if (totalInPair > 1 && directHits.length === 0) {
        // Clean symmetric subtle separation for bidirectional pair (single gentle bend, not wavy!)
        const off = (seenIdx === 0 ? 1 : -1) * 24;
        waypoints = [
          { x: pSrc.x, y: pSrc.y },
          { x: (pSrc.x + pDst.x) / 2 + nx * off, y: (pSrc.y + pDst.y) / 2 + ny * off },
          { x: pDst.x, y: pDst.y }
        ];
      } else {
        // Taut minimal-bend detour: only 1 or 2 interior corners (NOT 5 wavy control points!)
        const evalSide = (sideSign) => {
          const numInner = dist > 420 ? 2 : 1;
          const pts = [{ x: pSrc.x, y: pSrc.y }];
          const baseArch = Math.min(86, Math.max(48, dist * 0.11)) + seenIdx * 18;
          for (let k = 1; k <= numInner; k++) {
            const t = numInner === 1 ? 0.5 : (k === 1 ? 0.28 : 0.72);
            pts.push({
              x: pSrc.x + dx * t + nx * sideSign * baseArch,
              y: pSrc.y + dy * t + ny * sideSign * baseArch
            });
          }
          pts.push({ x: pDst.x, y: pDst.y });

          // Fast obstacle clearance relaxation keeping segments taut
          for (let it = 0; it < 26; it++) {
            const forces = pts.map(() => ({ fx: 0, fy: 0 }));
            for (let k = 1; k < pts.length - 1; k++) {
              const p = pts[k];
              for (const o of obstacles) {
                if (o.id === item.srcId || o.id === item.dstId) continue;
                const ox = p.x - o.x;
                const oy = p.y - o.y;
                const d = Math.hypot(ox, oy);
                const safeR = o.r + 14;
                if (d < safeR) {
                  const strength = Math.pow((safeR - d) / safeR, 1.4) * 26;
                  if (d < 4) {
                    forces[k].fx += nx * sideSign * strength;
                    forces[k].fy += ny * sideSign * strength;
                  } else {
                    const rx = ox / d, ry = oy / d;
                    const align = rx * (nx * sideSign) + ry * (ny * sideSign);
                    forces[k].fx += (align >= -0.15 ? rx : nx * sideSign) * strength;
                    forces[k].fy += (align >= -0.15 ? ry : ny * sideSign) * strength;
                  }
                }
              }
              // Check segment midpoints against obstacles so chord never clips a node
              const prevP = pts[k - 1], nextP = pts[k + 1];
              for (const segMid of [
                { x: (prevP.x + p.x) / 2, y: (prevP.y + p.y) / 2 },
                { x: (p.x + nextP.x) / 2, y: (p.y + nextP.y) / 2 }
              ]) {
                for (const o of obstacles) {
                  if (o.id === item.srcId || o.id === item.dstId) continue;
                  const d = Math.hypot(segMid.x - o.x, segMid.y - o.y);
                  const safeR = o.r + 10;
                  if (d < safeR) {
                    const strength = ((safeR - d) / safeR) * 20;
                    forces[k].fx += nx * sideSign * strength;
                    forces[k].fy += ny * sideSign * strength;
                  }
                }
              }
              // Mild tautness toward straight chord
              forces[k].fx += ((prevP.x + nextP.x) / 2 - p.x) * 0.14;
              forces[k].fy += ((prevP.y + nextP.y) / 2 - p.y) * 0.14;
            }
            for (let k = 1; k < pts.length - 1; k++) {
              pts[k].x += Math.max(-22, Math.min(22, forces[k].fx));
              pts[k].y += Math.max(-22, Math.min(22, forces[k].fy));
            }
          }

          let penalty = 0;
          let pathLen = 0;
          for (let k = 0; k < pts.length - 1; k++) {
            pathLen += Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y);
            for (const o of obstacles) {
              if (o.id === item.srcId || o.id === item.dstId) continue;
              const sd = pointToSegDist(o.x, o.y, pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y);
              if (sd < o.r) penalty += (o.r - sd) * 55;
            }
          }
          const crossings = countCrossingsWith(pts, item, routed);
          let outerBias = 0;
          if (Math.abs(dx) > 380 && Math.abs(dy) < 120) {
            const avgY = pts.slice(1, -1).reduce((a, p) => a + p.y, 0) / (pts.length - 2);
            for (const o of obstacles) {
              if (Math.abs(o.y - avgY) < 60 && o.x > Math.min(pSrc.x, pDst.x) && o.x < Math.max(pSrc.x, pDst.x)) {
                outerBias += 110;
              }
            }
          }
          return { pts, score: penalty + crossings * 220 + outerBias + pathLen * 0.07 };
        };

        const candPos = evalSide(1);
        const candNeg = evalSide(-1);
        waypoints = candPos.score <= candNeg.score ? candPos.pts : candNeg.pts;
      }

      routed.push({
        ...item,
        isMirrored: false,
        isStraight,
        waypoints
      });
    }

    // 4. Full-Body Edge-to-Edge Negative Gravity (separates parallel/nearby line bodies cleanly!)
    if (useGravity && routed.length > 1) {
      const ARC_BODY_SAFE = 26;
      for (let pass = 0; pass < 12; pass++) {
        for (let i = 0; i < routed.length; i++) {
          const rA = routed[i];
          if (rA.waypoints.length <= 2) continue; // Keep clear straight arcs strictly straight!
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
      const pathD = tautRoundedPath(finalPts, 20);
      const labelPt = polylineMidpoint(finalPts);
      return {
        ...r,
        finalPts,
        pathD,
        lx: labelPt.x,
        ly: labelPt.y
      };
    });

    // 6. Structured, Grid-Aligned & Zero-Crossing Shadow/Mirror Place Dock Layout!
    const mirrors = [];
    const mirrorArcRouted = [];
    const realNodeEntries = Object.entries(positions || {});

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

    for (const trName of sortedTransNames) {
      const trPt = positions[`T:${trName}`];
      const trObj = transByName[trName];
      if (!trPt) continue;

      const list = groupsByTrans.get(trName).sort((a, b) => {
        // Order: inputs first, then outputs, then by original place Y/X
        const aOut = a.arcs.every((x) => x.dir === "out") ? 1 : 0;
        const bOut = b.arcs.every((x) => x.dir === "out") ? 1 : 0;
        if (aOut !== bOut) return aOut - bOut;
        const pa = positions[`P:${a.place}`] || { x: 0, y: 0 };
        const pb = positions[`P:${b.place}`] || { x: 0, y: 0 };
        return pa.y - pb.y || pa.x - pb.x || a.place.localeCompare(b.place);
      });

      // Structured architectural dock slots around the transition (grid-aligned shelves, NOT random angles!)
      const buildDockSlots = (isOutOnly) => {
        const shelves = [];
        // Preferred side: inputs dock Left/Top, outputs dock Right/Bottom (fallback to all shelves if occupied)
        const xLeft = [-122, -218];
        const xRight = [122, 218];
        const yRows = [-102, -36, 36, 108, -166, 174];
        const topRowX = [-105, 0, 105, -205, 205];

        // Side shelves (clean vertical columns!)
        const primaryCols = isOutOnly ? xRight : xLeft;
        const secondaryCols = isOutOnly ? xLeft : xRight;
        for (const dx of primaryCols) {
          for (const dy of yRows) shelves.push({ x: trPt.x + dx, y: trPt.y + dy, prefBonus: -22 });
        }
        // Top & Bottom horizontal shelves (clean horizontal rows!)
        for (const dx of topRowX) {
          shelves.push({ x: trPt.x + dx, y: trPt.y - 108, prefBonus: isOutOnly ? 8 : -10 });
          shelves.push({ x: trPt.x + dx, y: trPt.y + 116, prefBonus: isOutOnly ? -10 : 8 });
          shelves.push({ x: trPt.x + dx, y: trPt.y - 172, prefBonus: 24 });
          shelves.push({ x: trPt.x + dx, y: trPt.y + 180, prefBonus: 24 });
        }
        for (const dx of secondaryCols) {
          for (const dy of yRows) shelves.push({ x: trPt.x + dx, y: trPt.y + dy, prefBonus: 14 });
        }
        return shelves;
      };

      for (const grp of list) {
        const plPt = positions[`P:${grp.place}`] || trPt;
        const isOutOnly = grp.arcs.every((a) => a.dir === "out");
        const candidates = buildDockSlots(isOutOnly);

        let best = null;
        for (const cand of candidates) {
          const cx = Math.round(cand.x / 5) * 5;
          const cy = Math.round(cand.y / 5) * 5;

          // Never cover host transition's name or top tag
          const relX = cx - trPt.x;
          const relY = cy - trPt.y;
          if (Math.abs(relX) < 82 && relY > 8 && relY < 76) continue;
          if (Math.abs(relX) < 52 && relY < -14 && relY > -70) continue;

          // Zero overlap with ALL real nodes (including label envelopes)
          let blocked = false;
          for (const [, npt] of realNodeEntries) {
            if (Math.hypot((cx - npt.x) / 94, (cy - (npt.y + 10)) / 74) < 1.0) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;

          // Zero overlap with ALL already placed mirrors (including ↗ Name labels)
          for (const m of mirrors) {
            if (Math.hypot((cx - m.x) / 106, (cy - m.y) / 62) < 1.0) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;

          // Count crossings of connector (trPt -> cand) AND proximity of mirror node/label to direct arcs!
          let crossings = 0;
          let lineProxPen = 0;
          for (const da of finalDirect) {
            for (let k = 0; k < da.finalPts.length - 1; k++) {
              const dLine = pointToSegDist(cx, cy + 8, da.finalPts[k].x, da.finalPts[k].y, da.finalPts[k + 1].x, da.finalPts[k + 1].y);
              if (dLine < 38) lineProxPen += (38 - dLine) * 10;
              if (da.srcId !== `T:${trName}` && da.dstId !== `T:${trName}`) {
                if (segmentsIntersect(trPt, { x: cx, y: cy }, da.finalPts[k], da.finalPts[k + 1])) {
                  crossings++;
                }
              }
            }
          }
          for (const ma of mirrorArcRouted) {
            if (ma.trName === trName) continue;
            if (segmentsIntersect(trPt, { x: cx, y: cy }, ma.startPt, ma.endPt)) {
              crossings++;
            }
          }

          // Prefer close, crossing-free, direction-consistent structured dock slot
          const dHost = Math.hypot(relX, relY);
          const dOrig = Math.hypot(cx - plPt.x, cy - plPt.y);
          const score = dHost * 1.15 + dOrig * 0.08 + crossings * 360 + lineProxPen + cand.prefBonus;
          if (!best || score < best.score) {
            best = { x: cx, y: cy, score };
          }
        }

        if (!best) {
          const idx = mirrors.length;
          best = { x: trPt.x + (isOutOnly ? 130 : -130), y: trPt.y - 110 - (idx % 4) * 64 };
        }

        const mirrorId = `M:${trName}:${grp.place}`;
        const mNode = {
          id: mirrorId,
          trName,
          place: grp.place,
          x: best.x,
          y: best.y,
          r: MIRROR_R,
          dirs: grp.arcs.map((a) => a.dir)
        };
        mirrors.push(mNode);

        // Route crisp straight (or subtle symmetric pair) connector between T and M
        const count = grp.arcs.length;
        grp.arcs.forEach((item, aIdx) => {
          const isOut = item.dir === "out";
          const pS = isOut ? trPt : { x: mNode.x, y: mNode.y };
          const pD = isOut ? { x: mNode.x, y: mNode.y } : trPt;
          const dx = pD.x - pS.x;
          const dy = pD.y - pS.y;
          const dist = Math.hypot(dx, dy) || 1;
          const nx = -dy / dist;
          const ny = dx / dist;
          const curveOff = count > 1 ? (aIdx === 0 ? 15 : -15) : 0;
          const mid = { x: (pS.x + pD.x) / 2 + nx * curveOff, y: (pS.y + pD.y) / 2 + ny * curveOff };

          const startPt = isOut
            ? clipProtectedPort(trPt.x, trPt.y, false, trName, trObj, mid.x, mid.y, false, useGravity)
            : clipCircle(mNode.x, mNode.y, MIRROR_R + 2, mid.x, mid.y);
          const endPt = isOut
            ? clipCircle(mNode.x, mNode.y, MIRROR_R + 5, mid.x, mid.y)
            : clipProtectedPort(trPt.x, trPt.y, false, trName, trObj, mid.x, mid.y, true, useGravity);

          const finalPts = count > 1 ? [startPt, mid, endPt] : [startPt, endPt];
          const pathD = tautRoundedPath(finalPts, 16);
          const lx = count > 1 ? mid.x : startPt.x + (endPt.x - startPt.x) * 0.52;
          const ly = count > 1 ? mid.y : startPt.y + (endPt.y - startPt.y) * 0.52;

          mirrorArcRouted.push({
            ...item,
            isMirrored: true,
            mirrorId: mNode.id,
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
            message: `Nota de compatibilidade Mercury 6.2 CLI: 'kooN' (${kv}-de-${g.children.length}) é avaliado analiticamente aqui com exatidão; no script do Mercury 6.2, k=1 usa 'parallel' e k=N usa 'series' (para 1<k<N use Mercury GUI/7.0 ou expansão SPN/CTMC).`
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
