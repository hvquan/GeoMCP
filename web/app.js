    const messages = document.getElementById("messages");
    const promptEl = document.getElementById("prompt");
    const fileEl = document.getElementById("file");
    const sendBtn = document.getElementById("send");
    const clearBtn = document.getElementById("clear");
    const modeEl = document.getElementById("mode");
    const patchBar = document.getElementById("patch-bar");
    const btnSolve = document.getElementById("btn-solve");
    const btnPatch = document.getElementById("btn-patch");

    // ── DSL Replay tab ────────────────────────────────────────────────────────
    const tabChat   = document.getElementById("tab-chat");
    const tabReplay = document.getElementById("tab-replay");
    const panelChat   = document.getElementById("panel-chat");
    const panelReplay = document.getElementById("panel-replay");
    const dslInput    = document.getElementById("dsl-input");
    const dslInputText = document.getElementById("dsl-input-text");
    const dslSendBtn  = document.getElementById("dsl-send");
    const dslClearBtn = document.getElementById("dsl-clear");

    tabChat.addEventListener("click", () => {
      tabChat.classList.add("active"); tabReplay.classList.remove("active");
      panelChat.style.display = ""; panelReplay.style.display = "none";
    });
    tabReplay.addEventListener("click", () => {
      tabReplay.classList.add("active"); tabChat.classList.remove("active");
      panelReplay.style.display = ""; panelChat.style.display = "none";
    });
    dslClearBtn.addEventListener("click", () => {
      fetch(apiUrl("/api/session/clear"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      }).catch(() => undefined).finally(() => {
        messages.innerHTML = "";
        promptEl.value = "";
        fileEl.value = "";
        dslInput.value = "";
        dslInputText.value = "";
        lastFigureState = null;
        patchMode = false;
        patchBar.classList.remove("visible");
        btnSolve.classList.add("active");
        btnPatch.classList.remove("active");
        pushBubble("assistant", "Conversation cleared. Send a new problem to get started.");
      });
    });

    dslSendBtn.addEventListener("click", async () => {
      const rawDsl = dslInput.value.trim();
      if (!rawDsl) return;
      const inputText = dslInputText.value.trim();
      const userLabel = inputText ? `[DSL Replay] ${inputText}` : "[DSL Replay]";
      pushBubble("user", userLabel);
      const progressUI = createProgressBubble();
      progressUI.progress.textContent = "Replaying DSL...";

      try {
        const data = await streamSolve(
          { dsl: rawDsl, input: inputText, solverIterations: 180, sessionId },
          (msg) => { progressUI.progress.textContent = msg; },
          (step, label, stepData) => {
            const stepDetails = document.createElement("details");
            stepDetails.style.cssText = "border:1px solid #e2e8f0;border-radius:6px;padding:0";
            const stepSummary = document.createElement("summary");
            stepSummary.style.cssText = "padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;user-select:none;background:#f8fafc;border-radius:6px";
            stepSummary.textContent = `[${step}] ${label}`;
            stepDetails.appendChild(stepSummary);
            const pre = document.createElement("pre");
            pre.style.cssText = "white-space:pre-wrap;font-size:11px;padding:8px 10px;margin:0;overflow:auto;max-height:400px;background:#fff";
            pre.textContent = typeof stepData === "string" ? stepData : JSON.stringify(stepData, null, 2);
            stepDetails.appendChild(pre);
            progressUI.pipelineContainer.appendChild(stepDetails);
            messages.scrollTop = messages.scrollHeight;
          },
          apiUrl("/api/replay-dsl")
        );
        progressUI.waiting.remove();
        console.log("[replay] pipelineSteps count:", data.pipelineSteps?.length, data.pipelineSteps);
        pushAssistantWithSvg(data);
      } catch (err) {
        progressUI.waiting.remove();
        pushBubble("error", err.message || String(err));
      }
    });

    // Tracks the last rendered interactive figure state so patch mode can add to it.
    let lastFigureState = null; // { points, parsed, svg }
    let patchMode = false;

    btnSolve.addEventListener("click", () => {
      patchMode = false;
      btnSolve.classList.add("active");
      btnPatch.classList.remove("active");
    });
    btnPatch.addEventListener("click", () => {
      if (!lastFigureState) return;
      patchMode = true;
      btnPatch.classList.add("active");
      btnSolve.classList.remove("active");
    });
    const SESSION_KEY = "geomcp_chat_session_id";
    const configuredApiBase = (window.GEOMCP_API_BASE || "").replace(/\/$/, "");
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    const apiBase = isLocalHost ? "" : configuredApiBase;

    function apiUrl(path) {
      return apiBase ? `${apiBase}${path}` : path;
    }

    function ensureSessionId() {
      let id = localStorage.getItem(SESSION_KEY);
      if (!id) {
        id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(SESSION_KEY, id);
      }
      return id;
    }

    const sessionId = ensureSessionId();

    function pushBubble(role, text) {
      const div = document.createElement("div");
      div.className = `bubble ${role}`;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
      return div;
    }

    const COPY_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

    function makeCopyBtn(getTextFn) {
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.innerHTML = COPY_ICON + " Copy";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        navigator.clipboard.writeText(getTextFn()).then(() => {
          btn.classList.add("copied");
          btn.textContent = "✓ Copied";
          setTimeout(() => {
            btn.classList.remove("copied");
            btn.innerHTML = COPY_ICON + " Copy";
          }, 1500);
        });
      });
      return btn;
    }

    function pushAssistantWithSvg(payload) {
      const div = document.createElement("div");
      div.className = "bubble assistant";

      const summary = document.createElement("div");
      const lines = [
        `Parser: ${payload.parserVersion}`,
        `Diagnostics: ${(payload.diagnostics || []).length}`,
        payload.recognizedText ? `Recognized text:\n${payload.recognizedText}` : ""
      ].filter(Boolean).join("\n\n");
      summary.textContent = lines;
      div.appendChild(summary);

      if (payload.warnings && payload.warnings.length) {
        const warn = document.createElement("div");
        warn.className = "meta";
        warn.textContent = `Warnings: ${payload.warnings.join(" | ")}`;
        div.appendChild(warn);
      }

      const wrap = document.createElement("div");
      wrap.className = "svg-wrap";
      wrap.innerHTML = payload.svg;
      div.appendChild(wrap);

      let dragGraphPre = null;
      if (payload.parsed) {
        dragGraphPre = document.createElement("pre");
        dragGraphPre.style.cssText = "white-space:pre-wrap;font-size:11px;margin-top:6px;padding:6px 8px;background:#f0f4ff;border:1px solid #c7d2fe;border-radius:4px;max-height:400px;overflow:auto";
        dragGraphPre.textContent = "(drag a point to see the constraint graph)";
        const liveGraphSummary = document.createElement("summary");
        liveGraphSummary.style.cssText = "display:flex;align-items:center;gap:6px";
        const liveGraphLabel = document.createElement("span");
        liveGraphLabel.textContent = "Dependency Graph (cập nhật khi kéo điểm)";
        liveGraphSummary.appendChild(liveGraphLabel);
        liveGraphSummary.appendChild(makeCopyBtn(() => dragGraphPre.textContent));
        const liveGraphDetails = document.createElement("details");
        liveGraphDetails.open = true;
        liveGraphDetails.appendChild(liveGraphSummary);
        liveGraphDetails.appendChild(dragGraphPre);
        div.appendChild(liveGraphDetails);

        const interactionPre = document.createElement("pre");
        const interactionDetails = document.createElement("details");
        const interactionSummary = document.createElement("summary");
        interactionSummary.style.cssText = "display:flex;align-items:center;gap:6px";
        const interactionLabel = document.createElement("span");
        interactionLabel.textContent = "Interaction Debug (drivers vs derived)";
        interactionSummary.appendChild(interactionLabel);
        interactionSummary.appendChild(makeCopyBtn(() => interactionPre.textContent));
        interactionDetails.appendChild(interactionSummary);
        interactionPre.style.whiteSpace = "pre-wrap";
        interactionPre.style.fontSize = "12px";
        interactionPre.style.marginTop = "8px";
        interactionPre.textContent = JSON.stringify(summarizeInteractionModel(payload.parsed), null, 2);
        interactionDetails.appendChild(interactionPre);

        div.appendChild(interactionDetails);
      }

      const helpRow = document.createElement("div");
      helpRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap";

      const help = document.createElement("div");
      help.className = "svg-help";
      help.style.flex = "1";
      help.textContent = "Interactive viewer: drag points to adjust, scroll to zoom, drag background to pan.";
      helpRow.appendChild(help);

      const exportBtn = document.createElement("button");
      exportBtn.className = "ghost";
      exportBtn.style.cssText = "font-size:12px;padding:5px 12px;flex-shrink:0";
      exportBtn.textContent = "Export HTML";
      exportBtn.addEventListener("click", () => {
        const svgEl = wrap.querySelector("svg");
        if (!svgEl) return;
        const html = buildExportHtml(svgEl, payload.parsed || null);
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
      helpRow.appendChild(exportBtn);
      div.appendChild(helpRow);

      // Cache the viewport transform so syncDragToServer can pass math-space coords.
      // The server already stores points in math-space; screenToSvg() (SVG CTM inverse)
      // already returns math-space coords, so no further conversion is needed when the
      // SVG uses the server-set viewBox.  We cache it for reference and future use.
      if (payload.viewportTransform) {
        wrap._viewportTransform = payload.viewportTransform;
      }

      enhanceInteractiveSvg(wrap, payload.parsed || null, dragGraphPre);

      if (payload.pipelineSteps && payload.pipelineSteps.length) {
        const pipeDetails = document.createElement("details");
        pipeDetails.open = true;
        const pipeSummary = document.createElement("summary");
        pipeSummary.style.cssText = "display:flex;align-items:center;gap:6px";
        const pipeLabel = document.createElement("span");
        pipeLabel.style.flex = "1";
        pipeLabel.textContent = `Pipeline (${payload.pipelineSteps.length} steps)`;
        pipeSummary.appendChild(pipeLabel);
        pipeSummary.appendChild(makeCopyBtn(() =>
          payload.pipelineSteps.map((s) =>
            `=== [${s.step}] ${s.label} ===\n` +
            (typeof s.data === "string" ? s.data : JSON.stringify(s.data, null, 2))
          ).join("\n\n")
        ));
        pipeDetails.appendChild(pipeSummary);

        const container = document.createElement("div");
        container.style.cssText = "margin-top:8px;display:flex;flex-direction:column;gap:4px";

        for (const s of payload.pipelineSteps) {
          const stepDetails = document.createElement("details");
          stepDetails.style.cssText = "border:1px solid #e2e8f0;border-radius:6px;padding:0";

          const pre = document.createElement("pre");
          pre.style.cssText = "white-space:pre-wrap;font-size:11px;padding:8px 10px;margin:0;overflow:auto;max-height:400px;background:#fff";
          pre.textContent = typeof s.data === "string" ? s.data : JSON.stringify(s.data, null, 2);
          const stepSummary = document.createElement("summary");
          stepSummary.style.cssText = "padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;user-select:none;background:#f8fafc;border-radius:6px;display:flex;align-items:center;gap:6px";
          const stepLabel = document.createElement("span");
          stepLabel.style.flex = "1";
          stepLabel.textContent = `[${s.step}] ${s.label}`;
          stepSummary.appendChild(stepLabel);
          stepSummary.appendChild(makeCopyBtn(() => pre.textContent));
          stepDetails.appendChild(stepSummary);
          stepDetails.appendChild(pre);

          container.appendChild(stepDetails);
        }

        pipeDetails.appendChild(container);
        div.appendChild(pipeDetails);
      }

      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function summarizeInteractionModel(parsed) {
      const pointIds = Array.isArray(parsed?.points) ? parsed.points.map((it) => String(it).toUpperCase()) : [];
      const derived = new Set();

      for (const rel of Array.isArray(parsed?.midpoints) ? parsed.midpoints : []) {
        if (rel?.point) derived.add(String(rel.point).toUpperCase());
      }
      for (const rel of Array.isArray(parsed?.pointsOnSegments) ? parsed.pointsOnSegments : []) {
        if (rel?.point) derived.add(String(rel.point).toUpperCase());
      }
      for (const rel of Array.isArray(parsed?.lineIntersections) ? parsed.lineIntersections : []) {
        if (rel?.point) derived.add(String(rel.point).toUpperCase());
      }
      for (const rel of Array.isArray(parsed?.perpendicularThroughPointIntersections) ? parsed.perpendicularThroughPointIntersections : []) {
        if (rel?.intersection) derived.add(String(rel.intersection).toUpperCase());
      }
      for (const rel of Array.isArray(parsed?.tangentIntersections) ? parsed.tangentIntersections : []) {
        if (rel?.intersection) derived.add(String(rel.intersection).toUpperCase());
      }
      for (const rel of Array.isArray(parsed?.namedTangents) ? parsed.namedTangents : []) {
        if (rel?.linePoint) derived.add(String(rel.linePoint).toUpperCase());
      }

      return {
        drivers: pointIds.filter((id) => !derived.has(id)),
        derivedPoints: pointIds.filter((id) => derived.has(id)),
        constraintCounts: {
          pointsOnCircles: Array.isArray(parsed?.pointsOnCircles) ? parsed.pointsOnCircles.length : 0,
          circlesByDiameter: Array.isArray(parsed?.circlesByDiameter) ? parsed.circlesByDiameter.length : 0,
          midpoints: Array.isArray(parsed?.midpoints) ? parsed.midpoints.length : 0,
          pointsOnSegments: Array.isArray(parsed?.pointsOnSegments) ? parsed.pointsOnSegments.length : 0,
          lineIntersections: Array.isArray(parsed?.lineIntersections) ? parsed.lineIntersections.length : 0,
          perpendiculars: Array.isArray(parsed?.perpendiculars) ? parsed.perpendiculars.length : 0,
          perpendicularThroughPointIntersections: Array.isArray(parsed?.perpendicularThroughPointIntersections)
            ? parsed.perpendicularThroughPointIntersections.length
            : 0,
          namedTangents: Array.isArray(parsed?.namedTangents) ? parsed.namedTangents.length : 0,
          tangentIntersections: Array.isArray(parsed?.tangentIntersections) ? parsed.tangentIntersections.length : 0
        }
      };
    }

    function buildExportHtml(svgEl, parsed) {
      let svgStr = new XMLSerializer().serializeToString(svgEl);
      // Strip any baked-in overlay groups (tangent overlay lines drawn at render time).
      // enhanceInteractiveSvg will recreate them dynamically when the exported file loads,
      // so keeping the serialized copies would leave ghost lines at the original positions.
      svgStr = svgStr.replace(/<g\s[^>]*data-overlay="tangents"[^>]*>[\s\S]*?<\/g>/g, "");
      const parsedJson = JSON.stringify(parsed || null);

      const helpers = [
        distance.toString(),
        parseNumber.toString(),
        findNearestPoint.toString()
      ].join("\n\n");

      let enhanceFn = enhanceInteractiveSvg.toString();
      enhanceFn = enhanceFn.replace(
        "lastFigureState = { points, parsed, svgEl: svg };",
        "/* export: no patch mode */"
      );
      enhanceFn = enhanceFn.replace(
        'patchBar.classList.add("visible");',
        "/* export: no patch mode */"
      );

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
    .svg-wrap {
      flex: 1;
      background: #fff;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .svg-wrap svg { display: block; width: 100%; height: 100%; touch-action: none; }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 6px 12px;
      background: #f4efe6;
      border-top: 1px solid #e5dcc8;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      color: #475569;
      flex-shrink: 0;
    }
    .toolbar button {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
      background: #fff;
      color: #1f2937;
    }
    .toolbar button:hover { background: #e2e8f0; }
    .dragging-point { cursor: grabbing; }
    circle[data-center-id] { cursor: col-resize; }
  </style>
</head>
<body>
  <div id="container">
    <div class="svg-wrap" id="svg-wrap">${svgStr}</div>
    <div class="toolbar">
      <span>Drag points &bull; Scroll to zoom &bull; Drag background to pan</span>
      <button id="btn-fullscreen">&#x26F6; Full screen</button>
    </div>
  </div>
  <script>
    const PARSED = ${parsedJson};
    ${helpers}
    ${enhanceFn}
    window.addEventListener("DOMContentLoaded", function () {
      enhanceInteractiveSvg(document.getElementById("svg-wrap"), PARSED, null);
      document.getElementById("btn-fullscreen").addEventListener("click", function () {
        const el = document.documentElement;
        if (!document.fullscreenElement) {
          el.requestFullscreen && el.requestFullscreen();
        } else {
          document.exitFullscreen && document.exitFullscreen();
        }
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


    function renderTurn(turn) {
      pushBubble("user", turn.userText || "[empty]");
      pushAssistantWithSvg({
        parserVersion: turn.parserVersion,
        diagnostics: turn.diagnostics,
        recognizedText: turn.recognizedText,
        warnings: turn.warnings,
        svg: turn.svg,
        parsed: turn.parsed || null,
        llmDebug: turn.llmDebug || null
      });
    }

    async function loadHistory() {
      try {
        const resp = await fetch(apiUrl(`/api/session?sessionId=${encodeURIComponent(sessionId)}`));
        if (!resp.ok) {
          return;
        }
        const data = await resp.json();
        if (!data.ok || !Array.isArray(data.turns)) {
          return;
        }
        if (data.turns.length === 0) {
          pushBubble("assistant", "Hello! Send a geometry problem as text or image and I'll draw it as an SVG.");
          return;
        }
        for (const turn of data.turns) {
          renderTurn(turn);
        }
      } catch (_err) {
        pushBubble("assistant", "Hello! Send a geometry problem as text or image and I'll draw it as an SVG.");
      }
    }

    function createProgressBubble() {
      const waiting = document.createElement("div");
      waiting.className = "bubble assistant";
      const title = document.createElement("div");
      title.innerHTML = '<span class="loader"></span>Processing...';
      waiting.appendChild(title);

      const progress = document.createElement("div");
      progress.className = "progress";
      progress.textContent = "Initializing";
      waiting.appendChild(progress);

      const pipelineContainer = document.createElement("div");
      pipelineContainer.style.cssText = "margin-top:10px;display:flex;flex-direction:column;gap:4px";
      waiting.appendChild(pipelineContainer);

      messages.appendChild(waiting);
      messages.scrollTop = messages.scrollHeight;
      return { waiting, progress, pipelineContainer };
    }

    async function streamSolve(payload, onProgress, onStep, endpoint) {
      const url = endpoint || apiUrl("/api/solve/stream");
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
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          const event = JSON.parse(trimmed);
          if (event.type === "progress") {
            onProgress(`${event.stage}: ${event.message}`);
          } else if (event.type === "step") {
            pipelineSteps.push({ step: event.step, label: event.label, data: event.data });
            onStep?.(event.step, event.label, event.data);
          } else if (event.type === "result") {
            finalPayload = event.payload;
          } else if (event.type === "error") {
            throw new Error(event.message || "Unknown stream error");
          }
        }
      }

      if (!finalPayload) {
        throw new Error("No result returned from stream");
      }

      return { ...finalPayload, pipelineSteps };
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Cannot read image"));
        reader.readAsDataURL(file);
      });
    }

    async function submitPatch() {
      const message = promptEl.value.trim();
      if (!message || !lastFigureState) return;

      pushBubble("user", message);
      const progressUI = createProgressBubble();
      progressUI.progress.textContent = "Adding to figure...";

      try {
        // Collect current interactive positions from the live points array.
        const existingPoints = lastFigureState.points.map((p) => ({ id: p.id, x: p.x, y: p.y }));

        // Collect current visual segments from the SVG (last rendered canvas).
        const lastSvg = lastFigureState.svgEl;
        const existingSegments = lastSvg
          ? Array.from(lastSvg.querySelectorAll("line[data-a][data-b]")).map((l) => ({
              a: l.getAttribute("data-a"),
              b: l.getAttribute("data-b")
            })).filter((s) => s.a && s.b)
          : [];

        // Collect current circles.
        const existingCircles = lastSvg
          ? Array.from(lastSvg.querySelectorAll("circle[data-center-id]")).map((c) => ({
              centerId: c.getAttribute("data-center-id"),
              r: parseFloat(c.getAttribute("r") || "0")
            })).filter((c) => c.centerId && c.r > 0)
          : [];

        const resp = await fetch(apiUrl("/api/patch"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            message,
            existingParsed: lastFigureState.parsed,
            existingPoints,
            existingSegments,
            existingCircles,
            parserMode: modeEl.value
          })
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        progressUI.waiting.remove();
        promptEl.value = "";
        fileEl.value = "";
        pushAssistantWithSvg(data);
      } catch (error) {
        progressUI.waiting.remove();
        pushBubble("error", error.message || String(error));
      }
    }

    async function submit() {
      if (patchMode && lastFigureState) {
        await submitPatch();
        return;
      }

      const message = promptEl.value.trim();
      const file = fileEl.files && fileEl.files[0];
      if (!message && !file) {
        pushBubble("error", "Please enter a problem or select an image before sending.");
        return;
      }

      let imageDataUrl = "";
      if (file) {
        imageDataUrl = await readFileAsDataUrl(file);
      }

      const userPreview = message || "[Image sent for OCR]";
      pushBubble("user", userPreview);

      const progressUI = createProgressBubble();

      try {
        const data = await streamSolve({
          sessionId,
          message,
          imageDataUrl,
          parserMode: modeEl.value,
          solverIterations: 180
        }, (msg) => {
          progressUI.progress.textContent = msg;
        }, (step, label, stepData) => {
          const stepDetails = document.createElement("details");
          stepDetails.style.cssText = "border:1px solid #e2e8f0;border-radius:6px;padding:0";

          const stepSummary = document.createElement("summary");
          stepSummary.style.cssText = "padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;user-select:none;background:#f8fafc;border-radius:6px";
          stepSummary.textContent = `[${step}] ${label}`;
          stepDetails.appendChild(stepSummary);

          const pre = document.createElement("pre");
          pre.style.cssText = "white-space:pre-wrap;font-size:11px;padding:8px 10px;margin:0;overflow:auto;max-height:400px;background:#fff";
          pre.textContent = typeof stepData === "string" ? stepData : JSON.stringify(stepData, null, 2);
          stepDetails.appendChild(pre);

          progressUI.pipelineContainer.appendChild(stepDetails);
          messages.scrollTop = messages.scrollHeight;
        });

        progressUI.waiting.remove();
        promptEl.value = "";
        fileEl.value = "";
        pushAssistantWithSvg(data);
      } catch (error) {
        progressUI.waiting.remove();
        pushBubble("error", error.message || String(error));
      }
    }

    sendBtn.addEventListener("click", submit);
    promptEl.addEventListener("keydown", (evt) => {
      if ((evt.metaKey || evt.ctrlKey) && evt.key === "Enter") {
        submit();
      }
    });
    clearBtn.addEventListener("click", () => {
      fetch(apiUrl("/api/session/clear"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      }).catch(() => undefined).finally(() => {
        messages.innerHTML = "";
        promptEl.value = "";
        fileEl.value = "";
        lastFigureState = null;
        patchMode = false;
        patchBar.classList.remove("visible");
        btnSolve.classList.add("active");
        btnPatch.classList.remove("active");
        pushBubble("assistant", "Conversation cleared. Send a new problem to get started.");
      });
    });

    if (window.location.hostname.endsWith("github.io") && !apiBase) {
      pushBubble("error", "GEOMCP_API_BASE is not configured in web/config.js. Please set it to your backend URL.");
    }

    loadHistory();
