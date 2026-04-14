    // ── DOM refs ────────────────────────────────────────────────────────────────
    const promptEl   = document.getElementById("prompt");
    const runBtn     = document.getElementById("run");
    const clearBtn   = document.getElementById("clear");
    const figureArea = document.getElementById("figure-area");
    const outDsl      = document.getElementById("out-dsl");
    const outCanon    = document.getElementById("out-canonical");
    const outScene    = document.getElementById("out-scene");
    const copyDslBtn  = document.getElementById("copy-dsl");
    const copyCanonBtn= document.getElementById("copy-canonical");
    const copySceneBtn= document.getElementById("copy-scene");

    // Stubs required by interactive.js
    let lastFigureState = null;
    const patchBar = { classList: { add: () => {}, remove: () => {} } };

    // ── Copy buttons ─────────────────────────────────────────────────────────────
    function wireCopy(btn, getPre) {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(getPre().textContent || "").then(() => {
          btn.classList.add("copied");
          const prev = btn.textContent;
          btn.textContent = "✓ Copied";
          setTimeout(() => { btn.classList.remove("copied"); btn.textContent = prev; }, 1500);
        });
      });
    }
    wireCopy(copyDslBtn,   () => outDsl);
    wireCopy(copyCanonBtn, () => outCanon);
    wireCopy(copySceneBtn, () => outScene);

    // ── API helpers ──────────────────────────────────────────────────────────────
    const configuredApiBase = (window.GEOMCP_API_BASE || "").replace(/\/$/, "");
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    const apiBase = isLocalHost ? "" : configuredApiBase;
    function apiUrl(path) { return apiBase ? `${apiBase}${path}` : path; }

    // ── Results panel helpers ────────────────────────────────────────────────────
    const PENDING = "…";

    function clearResults() {
      outDsl.textContent   = PENDING;
      outCanon.textContent = PENDING;
      outScene.textContent = PENDING;
    }

    function setResult(pre, data) {
      pre.textContent = data == null ? "(none)" :
        typeof data === "string" ? data : JSON.stringify(data, null, 2);
    }

    // ── Figure helpers ───────────────────────────────────────────────────────────
    function showLoading(message) {
      figureArea.innerHTML = "";
      const div = document.createElement("div");
      div.className = "loading-state";
      const spinner = document.createElement("span");
      spinner.className = "loader";
      div.appendChild(spinner);
      const text = document.createElement("span");
      text.textContent = message || "Processing…";
      div.appendChild(text);
      figureArea.appendChild(div);
      return text;
    }

    function showError(message) {
      figureArea.innerHTML = "";
      const div = document.createElement("div");
      div.className = "error-msg";
      div.textContent = message;
      figureArea.appendChild(div);
    }

    // ── Geo-interaction state (geo-interact.js / /api/canonical) ─────────────────
    let _currentIr         = null;
    let _currentFreePoints = {};
    let _fixedScale        = null;
    let _fixedOffX         = null;
    let _fixedOffY         = null;
    let _liveFetching      = false;
    let _activeSvgWrap     = null;

    function _lockScale(scene, svgEl) {
      if (!svgEl) return;
      const pts = scene?.points || [];
      const canvasH = parseFloat(svgEl.getAttribute("height") || "1200");
      for (const p of pts) {
        if (typeof p.x !== "number") continue;
        const g   = svgEl.querySelector(`g[data-point-id="${CSS.escape(p.id)}"]`);
        const dot = g?.querySelector("circle");
        if (!g || !dot) continue;
        const cx = parseFloat(dot.getAttribute("cx"));
        const cy = parseFloat(dot.getAttribute("cy"));
        for (const p2 of pts) {
          if (p2.id === p.id || typeof p2.x !== "number") continue;
          const g2   = svgEl.querySelector(`g[data-point-id="${CSS.escape(p2.id)}"]`);
          const dot2 = g2?.querySelector("circle");
          if (!g2 || !dot2) continue;
          const dmx = p2.x - p.x, dmy = p2.y - p.y;
          const dcx = parseFloat(dot2.getAttribute("cx")) - cx;
          const dcy = parseFloat(dot2.getAttribute("cy")) - cy;
          if (Math.abs(dmx) < 1e-6 && Math.abs(dmy) < 1e-6) continue;
          const scale = Math.abs(dmx) > Math.abs(dmy) ? dcx / dmx : -dcy / dmy;
          if (!isFinite(scale) || Math.abs(scale) < 0.01) continue;
          _fixedScale = scale;
          _fixedOffX  = cx - p.x * scale;
          _fixedOffY  = canvasH - cy - p.y * scale;
          return;
        }
      }
    }

    function _applyAngleDrag(event, ptEnt, scene) {
      const circEnt  = _currentIr.entities.find(e => e.id === ptEnt.construction.circle);
      const centerId = circEnt?.construction?.center;
      const ctr      = _currentFreePoints[centerId] ?? scene?.points?.find(p => p.id === centerId);
      if (!ctr) return null;
      const angle  = Math.atan2(event.newY - ctr.y, event.newX - ctr.x);
      const angEnt = _currentIr.entities.find(e => e.id === ptEnt.construction.angle);
      if (!angEnt) return null;
      angEnt.construction.value = Math.round(angle * 100000) / 100000;
      return angEnt.id;
    }

    function _applyRadiusDrag(event, scene) {
      if (!_currentIr) return null;
      const cirEntity = _currentIr.entities.find(e => e.id === event.circleId);
      if (!cirEntity || cirEntity.construction?.type !== "circle_center_radius") return null;
      const centerId = cirEntity.construction.center;
      const fp       = _currentFreePoints[centerId];
      const centerPt = fp ?? scene?.points?.find(p => p.id === centerId);
      if (!centerPt) return null;
      const newR = Math.sqrt((event.mouseX - centerPt.x) ** 2 + (event.mouseY - centerPt.y) ** 2);
      if (!isFinite(newR) || newR < 0.01) return null;
      const radParamId = cirEntity.construction.radius;
      const radEntity  = _currentIr.entities.find(e => e.id === radParamId);
      if (radEntity) radEntity.construction.value = Math.round(newR * 10000) / 10000;
      return radParamId;
    }

    function _patchSvgElements(curSvg, newSvg, draggedPointId) {
      for (const ng of newSvg.querySelectorAll("g[data-point-id]")) {
        const pid = ng.getAttribute("data-point-id");
        if (pid === draggedPointId) continue;
        const cg = curSvg.querySelector(`g[data-point-id="${CSS.escape(pid)}"]`);
        if (!cg) continue;
        const ndot = ng.querySelector("circle"), cdot = cg.querySelector("circle");
        if (ndot && cdot) {
          cdot.setAttribute("cx", ndot.getAttribute("cx"));
          cdot.setAttribute("cy", ndot.getAttribute("cy"));
        }
        const ntxt = ng.querySelector("text"), ctxt = cg.querySelector("text");
        if (ntxt && ctxt) {
          ctxt.setAttribute("x", ntxt.getAttribute("x"));
          ctxt.setAttribute("y", ntxt.getAttribute("y"));
        }
      }
      for (const nel of newSvg.querySelectorAll("[data-id]")) {
        const id  = nel.getAttribute("data-id");
        const cel = curSvg.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (!cel || nel.tagName !== cel.tagName) continue;
        if (nel.tagName === "line") {
          for (const a of ["x1","y1","x2","y2"]) cel.setAttribute(a, nel.getAttribute(a) ?? "");
        } else if (nel.tagName === "circle") {
          for (const a of ["cx","cy","r"])       cel.setAttribute(a, nel.getAttribute(a) ?? "");
        } else if (nel.tagName === "polygon" || nel.tagName === "polyline") {
          cel.setAttribute("points", nel.getAttribute("points") ?? "");
        } else if (nel.tagName === "path") {
          cel.setAttribute("d", nel.getAttribute("d") ?? "");
        }
      }
    }

    async function _onGeoInteractMove(event, scene, _vb) {
      if (!_currentIr) return;
      if (event.type !== "drag_point" && event.type !== "drag_radius") return;
      if (_liveFetching) return;
      _liveFetching = true;
      let draggedPointId = null;
      if (event.type === "drag_point") {
        const ptEnt = _currentIr.entities.find(e => e.id === event.pointId);
        if (ptEnt?.construction?.type === "point_on_circle" && ptEnt.construction.angle) {
          if (!_applyAngleDrag(event, ptEnt, scene)) { _liveFetching = false; return; }
        } else {
          _currentFreePoints[event.pointId] = { x: event.newX, y: event.newY };
          draggedPointId = event.pointId;
        }
      } else {
        if (!_applyRadiusDrag(event, scene)) { _liveFetching = false; return; }
      }
      try {
        const resp = await fetch(apiUrl("/api/canonical"), {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            ir: _currentIr, freePoints: _currentFreePoints,
            fixedScale: _fixedScale, fixedOffX: _fixedOffX, fixedOffY: _fixedOffY,
          }),
        });
        const data = await resp.json();
        if (data.svg) {
          const tmp = document.createElement("div");
          tmp.innerHTML = data.svg;
          const newSvg = tmp.querySelector("svg");
          const curSvg = _activeSvgWrap?.querySelector("svg");
          if (newSvg && curSvg) _patchSvgElements(curSvg, newSvg, draggedPointId);
        }
      } catch (_) { /* ignore live errors */ }
      finally { _liveFetching = false; }
    }

    async function _onGeoInteractEnd(event, _scene, savedVB) {
      if (!_currentIr) return;
      if (event.type !== "drag_point" && event.type !== "drag_radius") return;
      if (event.type === "drag_point") {
        const ptEnt = _currentIr.entities.find(e => e.id === event.pointId);
        if (ptEnt?.construction?.type === "point_on_circle" && ptEnt.construction.angle) {
          _applyAngleDrag(event, ptEnt, _scene);
        } else {
          _currentFreePoints[event.pointId] = { x: event.newX, y: event.newY };
        }
      } else {
        _applyRadiusDrag(event, _scene);
      }
      try {
        const resp = await fetch(apiUrl("/api/canonical"), {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            ir: _currentIr, freePoints: _currentFreePoints,
            fixedScale: _fixedScale, fixedOffX: _fixedOffX, fixedOffY: _fixedOffY,
          }),
        });
        const data = await resp.json();
        if (data.svg && _activeSvgWrap) {
          _activeSvgWrap.innerHTML = data.svg;
          _startInteraction(data.scene, savedVB);
        }
      } catch (_err) { /* ignore */ }
    }

    function _startInteraction(scene, restoreViewBox) {
      if (!_activeSvgWrap) return;
      interactSvg(_activeSvgWrap, scene, restoreViewBox, {
        onDragEnd:  _onGeoInteractEnd,
        onDragMove: _onGeoInteractMove,
      });
    }

    function showFigure(payload) {
      figureArea.innerHTML = "";

      const inner = document.createElement("div");
      inner.className = "figure-inner";

      const wrap = document.createElement("div");
      wrap.className = "svg-wrap";
      wrap.innerHTML = payload.svg;
      inner.appendChild(wrap);

      const toolbar = document.createElement("div");
      toolbar.className = "figure-toolbar";
      const exportBtn = document.createElement("button");
      exportBtn.className = "ghost";
      exportBtn.textContent = "Export HTML";
      exportBtn.addEventListener("click", () => {
        const svgEl = wrap.querySelector("svg");
        if (!svgEl) return;
        const html = buildExportHtml(svgEl, null);
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "geometry-figure.html";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
      toolbar.appendChild(exportBtn);
      inner.appendChild(toolbar);

      if (payload.viewportTransform) wrap._viewportTransform = payload.viewportTransform;
      figureArea.appendChild(inner);

      // Use geo-interact.js + /api/canonical when we have the full scene/IR
      _currentIr         = payload.canonical ?? null;
      _currentFreePoints = payload.freePoints ? { ...payload.freePoints } : {};
      _fixedScale = null; _fixedOffX = null; _fixedOffY = null;
      _activeSvgWrap = wrap;
      if (payload.scene && _currentIr) {
        _lockScale(payload.scene, wrap.querySelector("svg"));
        _startInteraction(payload.scene, null);
      } else {
        // Fallback: free-drag only (no constraint enforcement)
        enhanceInteractiveSvg(wrap, null, null);
      }

      // Fill the three result panes from the pipeline steps
      if (payload.pipelineSteps) {
        for (const s of payload.pipelineSteps) {
          if (s.label === "DSL result")       setResult(outDsl,   s.data);
          if (s.label === "Canonical result") setResult(outCanon, s.data);
          if (s.label === "Scene graph")      setResult(outScene, s.data);
        }
      }
    }

    // ── Export ───────────────────────────────────────────────────────────────────
    function buildExportHtml(svgEl, parsed) {
      let svgStr = new XMLSerializer().serializeToString(svgEl);
      svgStr = svgStr.replace(/<g\s[^>]*data-overlay="tangents"[^>]*>[\s\S]*?<\/g>/g, "");
      const parsedJson = JSON.stringify(parsed || null);
      const helpers = [distance.toString(), parseNumber.toString(), findNearestPoint.toString()].join("\n\n");
      let enhanceFn = enhanceInteractiveSvg.toString();
      enhanceFn = enhanceFn.replace("lastFigureState = { points, parsed, svgEl: svg };", "/* export */");
      enhanceFn = enhanceFn.replace('patchBar.classList.add("visible");', "/* export */");

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Geometry Figure</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #f4efe6; overflow: hidden; }
    #container { width: 100vw; height: 100vh; display: flex; flex-direction: column; }
    .svg-wrap { flex: 1; background: #fff; overflow: hidden; display: flex; justify-content: center; align-items: center; }
    .svg-wrap svg { display: block; width: 100%; height: 100%; touch-action: none; }
    .toolbar { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 6px 12px; background: #f4efe6; border-top: 1px solid #e5dcc8; font-family: system-ui, sans-serif; font-size: 12px; color: #475569; flex-shrink: 0; }
    .toolbar button { border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; background: #fff; color: #1f2937; }
    .toolbar button:hover { background: #e2e8f0; }
    .dragging-point { cursor: grabbing; }
    circle[data-center-id] { cursor: col-resize; }
  </style>
</head>
<body>
  <div id="container">
    <div class="svg-wrap" id="svg-wrap">\${svgStr}</div>
    <div class="toolbar">
      <span>Drag points &bull; Scroll to zoom &bull; Drag background to pan</span>
      <button id="btn-fullscreen">&#x26F6; Full screen</button>
    </div>
  </div>
  <script>
    const PARSED = \${parsedJson};
    \${helpers}
    \${enhanceFn}
    window.addEventListener("DOMContentLoaded", function () {
      enhanceInteractiveSvg(document.getElementById("svg-wrap"), PARSED, null);
      document.getElementById("btn-fullscreen").addEventListener("click", function () {
        const el = document.documentElement;
        if (!document.fullscreenElement) { el.requestFullscreen && el.requestFullscreen(); }
        else { document.exitFullscreen && document.exitFullscreen(); }
      });
      document.addEventListener("fullscreenchange", function () {
        const btn = document.getElementById("btn-fullscreen");
        btn.textContent = document.fullscreenElement ? "\u29F5 Exit full screen" : "\u26F6 Full screen";
      });
    });
  <\/script>
</body>
</html>`;
    }

    // ── Streaming solve ──────────────────────────────────────────────────────────
    async function streamSolve(payload, onProgress) {
      const url = apiUrl("/api/solve/stream");
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || "Cannot start streaming");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload = null;
      const pipelineSteps = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const event = JSON.parse(trimmed);
          if (event.type === "progress") {
            onProgress(`${event.stage}: ${event.message}`);
          } else if (event.type === "step") {
            pipelineSteps.push({ step: event.step, label: event.label, data: event.data });
            // Live-fill panels as steps arrive
            if (event.label === "DSL result")       setResult(outDsl,   event.data);
            if (event.label === "Canonical result") setResult(outCanon, event.data);
            if (event.label === "Scene graph")      setResult(outScene, event.data);
          } else if (event.type === "result") {
            finalPayload = event.payload;
          } else if (event.type === "error") {
            throw new Error(event.message || "Unknown stream error");
          }
        }
      }

      if (!finalPayload) throw new Error("No result returned from stream");
      return { ...finalPayload, pipelineSteps };
    }

    // ── Submit ───────────────────────────────────────────────────────────────────
    async function submit() {
      const message = promptEl.value.trim();
      if (!message) { promptEl.focus(); return; }

      runBtn.disabled = true;
      clearResults();
      const progressText = showLoading("Initializing…");

      try {
        const data = await streamSolve({
          message,
          solverIterations: 180
        }, (msg) => { progressText.textContent = msg; });

        showFigure(data);
      } catch (error) {
        showError(error.message || String(error));
      } finally {
        runBtn.disabled = false;
      }
    }

    // ── Event listeners ──────────────────────────────────────────────────────────
    runBtn.addEventListener("click", submit);
    clearBtn.addEventListener("click", () => {
      promptEl.value = "";
      clearResults();
      promptEl.focus();
    });
    promptEl.addEventListener("keydown", (evt) => {
      if ((evt.metaKey || evt.ctrlKey) && evt.key === "Enter") submit();
    });
