/**
 * geo-interact.js — Shared SVG drag/hover/pan/zoom interaction.
 *
 * Used by both the Scene Graph page (index.html / app.js) and
 * the Canonical IR page (canonical.html / canonical.js).
 *
 * API:
 *   interactSvg(container, scene, restoreViewBox, opts)
 *
 * opts.onDragEnd(event, scene, savedViewBox)
 *   Called when a drag gesture is released. The caller is responsible for
 *   making the server request, updating the DOM, and re-calling interactSvg.
 *
 *   event shapes:
 *     { type: "drag_point",  pointId, newX, newY }
 *     { type: "drag_radius", circleId, mouseX, mouseY }
 *
 *   scene        — the scene value that was passed to this interactSvg call
 *   savedViewBox — { x, y, w, h } snapshot at the time of release
 */
function interactSvg(container, scene, restoreViewBox = null, opts = {}) {
  const svg = container.querySelector("svg");
  if (!svg) return;

  svg.style.touchAction = "none";
  svg.style.cursor      = "grab";

  // ── viewBox state (pan + zoom) ────────────────────────────────────────────
  const svgW = parseFloat(svg.getAttribute("width")  ?? "1000");
  const svgH = parseFloat(svg.getAttribute("height") ?? "900");
  const vb0 = restoreViewBox
    ? [restoreViewBox.x, restoreViewBox.y, restoreViewBox.w, restoreViewBox.h]
    : (svg.getAttribute("viewBox") || `0 0 ${svgW} ${svgH}`).split(/\s+/).map(Number);
  let viewBox = { x: vb0[0], y: vb0[1], w: vb0[2], h: vb0[3] };
  if (restoreViewBox) applyViewBox();

  function applyViewBox() {
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
  }

  // ── coordinate helper ─────────────────────────────────────────────────────
  function svgPt(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  }

  // ── collect draggable elements ────────────────────────────────────────────
  const pointGroups = svg.querySelectorAll("g[data-point-id]");
  const circleEls   = svg.querySelectorAll("circle[data-id]");

  for (const g of pointGroups) {
    let meta = null;
    try { meta = JSON.parse(g.getAttribute("data-interaction") || "null"); } catch {}
    const isDraggable = meta?.draggable === true &&
      (meta?.editMode === "move_point" || meta?.editMode === "change_angle");
    const dot = g.querySelector("circle");
    if (dot) dot.setAttribute("fill", isDraggable ? "#2563eb" : "#e53e3e");
    g.style.cursor = isDraggable ? "grab" : "not-allowed";
  }

  for (const c of circleEls) {
    let meta = null;
    try { meta = JSON.parse(c.getAttribute("data-interaction") || "null"); } catch {}
    if (meta?.editMode === "change_radius") c.style.cursor = "ew-resize";
  }

  // ── inject interaction styles ─────────────────────────────────────────────
  const svgStyle = document.createElementNS("http://www.w3.org/2000/svg", "style");
  svgStyle.textContent = `
    .geo-point circle          { transition: r .08s, fill .08s; }
    .geo-point.hovered  circle { r: 6px; fill: #f97316; }
    .geo-point.dragging circle { r: 8px; fill: #2563eb; filter: drop-shadow(0 0 3px #2563eb88); }
    .geo-circle                { transition: stroke-width .08s, stroke .08s; }
    .geo-circle.hovered        { stroke-width: 3.5 !important; stroke: #f97316 !important; }
    .geo-circle.dragging       { stroke-width: 4   !important; stroke: #ef4444 !important; }
    .hover-ring { pointer-events: none; transition: opacity .1s; }
  `;
  svg.prepend(svgStyle);
  for (const g of pointGroups) g.classList.add("geo-point");
  for (const c of circleEls)   c.classList.add("geo-circle");

  // ── hover ring ────────────────────────────────────────────────────────────
  const hoverRing = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hoverRing.classList.add("hover-ring");
  hoverRing.setAttribute("r",            "13");
  hoverRing.setAttribute("fill",         "none");
  hoverRing.setAttribute("stroke",       "#f97316");
  hoverRing.setAttribute("stroke-width", "1.5");
  hoverRing.setAttribute("opacity",      "0");
  svg.appendChild(hoverRing);

  // ── hover state ───────────────────────────────────────────────────────────
  let hoveredEl = null;

  function clearHover() {
    if (hoveredEl) { hoveredEl.classList.remove("hovered"); hoveredEl = null; }
    hoverRing.setAttribute("opacity", "0");
  }

  function setHover(el, ringX, ringY) {
    if (hoveredEl === el) return;
    clearHover();
    if (!el) return;
    el.classList.add("hovered");
    hoveredEl = el;
    if (ringX != null) {
      hoverRing.setAttribute("cx", String(ringX));
      hoverRing.setAttribute("cy", String(ringY));
      hoverRing.setAttribute("opacity", "0.5");
    }
  }

  // ── segment + circle-by-center lookup ────────────────────────────────────
  const linesForPoint = new Map();
  for (const line of svg.querySelectorAll("line[data-a]")) {
    const a = line.getAttribute("data-a");
    const b = line.getAttribute("data-b");
    if (a) { if (!linesForPoint.has(a)) linesForPoint.set(a, []); linesForPoint.get(a).push({ el: line, end: 1 }); }
    if (b) { if (!linesForPoint.has(b)) linesForPoint.set(b, []); linesForPoint.get(b).push({ el: line, end: 2 }); }
  }

  const circleByCenter = new Map();
  for (const c of circleEls) {
    const cid = c.getAttribute("data-center-id");
    if (cid) circleByCenter.set(cid, c);
  }

  // ── canvas → math coordinate inverter ────────────────────────────────────
  // Renderer: canvasX = offX + mathX*scale, canvasY = H - (offY + mathY*scale)
  // Recover scale + offsets from two known scene points and their SVG positions.
  let canvasToMath = null;

  function buildCanvasToMath() {
    const pts = scene?.points || [];
    for (const p of pts) {
      if (typeof p.x !== "number") continue;
      const g = svg.querySelector(`g[data-point-id="${CSS.escape(p.id)}"]`);
      const dot = g?.querySelector("circle");
      if (!g || !dot) continue;
      const cx = parseFloat(dot.getAttribute("cx"));
      const cy = parseFloat(dot.getAttribute("cy"));
      for (const p2 of pts) {
        if (p2.id === p.id || typeof p2.x !== "number") continue;
        const g2   = svg.querySelector(`g[data-point-id="${CSS.escape(p2.id)}"]`);
        const dot2 = g2?.querySelector("circle");
        if (!g2 || !dot2) continue;
        const cx2 = parseFloat(dot2.getAttribute("cx"));
        const cy2 = parseFloat(dot2.getAttribute("cy"));
        const dmx = p2.x - p.x, dmy = p2.y - p.y;
        const dcx = cx2 - cx,   dcy = cy2 - cy;
        if (Math.abs(dmx) < 1e-6 && Math.abs(dmy) < 1e-6) continue;
        const scale = Math.abs(dmx) > Math.abs(dmy) ? dcx / dmx : -dcy / dmy;
        if (!isFinite(scale) || Math.abs(scale) < 0.01) continue;
        const offX    = cx - p.x * scale;
        const canvasH = parseFloat(svg.getAttribute("height") || "900");
        const offY    = canvasH - cy - p.y * scale;
        canvasToMath  = (cvx, cvy) => ({
          x: (cvx - offX) / scale,
          y: (canvasH - cvy - offY) / scale,
        });
        return;
      }
    }
  }
  buildCanvasToMath();

  // ── drag + pan state ──────────────────────────────────────────────────────
  let drag     = null;
  let panStart = null;

  // ── pointer down ──────────────────────────────────────────────────────────
  svg.addEventListener("pointerdown", (e) => {
    const pos = svgPt(e.clientX, e.clientY);

    // 1. Hit-test draggable points (within 14px)
    for (const g of pointGroups) {
      let meta = null;
      try { meta = JSON.parse(g.getAttribute("data-interaction") || "null"); } catch {}
      if (!meta?.draggable) continue;
      const dot = g.querySelector("circle");
      if (!dot) continue;
      const cx = parseFloat(dot.getAttribute("cx"));
      const cy = parseFloat(dot.getAttribute("cy"));
      if (Math.sqrt((pos.x - cx) ** 2 + (pos.y - cy) ** 2) > 14) continue;
      const pointId = g.getAttribute("data-point-id");
      const mathPos = canvasToMath ? canvasToMath(cx, cy) : null;
      drag = { mode: "point", pointId, g, dot,
               startSvg: { x: cx, y: cy }, startMathX: mathPos?.x ?? 0, startMathY: mathPos?.y ?? 0 };
      clearHover();
      g.classList.add("dragging");
      g.style.cursor = "grabbing";
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 2. Hit-test resizable circle borders (within 12px of circumference)
    for (const c of circleEls) {
      let meta = null;
      try { meta = JSON.parse(c.getAttribute("data-interaction") || "null"); } catch {}
      if (meta?.editMode !== "change_radius") continue;
      const cx = parseFloat(c.getAttribute("cx"));
      const cy = parseFloat(c.getAttribute("cy"));
      const r  = parseFloat(c.getAttribute("r"));
      if (Math.abs(Math.sqrt((pos.x - cx) ** 2 + (pos.y - cy) ** 2) - r) > 12) continue;
      drag = { mode: "radius", circleEl: c,
               centerId: c.getAttribute("data-center-id"),
               centerSvgX: cx, centerSvgY: cy,
               circleId: c.getAttribute("data-id") };
      clearHover();
      c.classList.add("dragging");
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 3. Pan
    panStart = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY,
                 viewX: viewBox.x, viewY: viewBox.y };
    svg.style.cursor = "grabbing";
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  // ── pointer move ──────────────────────────────────────────────────────────
  svg.addEventListener("pointermove", (e) => {
    if (panStart && panStart.pointerId === e.pointerId) {
      const dx = (e.clientX - panStart.clientX) * (viewBox.w / svg.clientWidth);
      const dy = (e.clientY - panStart.clientY) * (viewBox.h / svg.clientHeight);
      viewBox.x = panStart.viewX - dx;
      viewBox.y = panStart.viewY - dy;
      applyViewBox();
      return;
    }

    const pos = svgPt(e.clientX, e.clientY);

    if (!drag) {
      // Idle hover
      let found = null, ringX = null, ringY = null;
      for (const g of pointGroups) {
        let meta = null;
        try { meta = JSON.parse(g.getAttribute("data-interaction") || "null"); } catch {}
        if (!meta?.hoverable) continue;
        const dot = g.querySelector("circle");
        if (!dot) continue;
        const cx = parseFloat(dot.getAttribute("cx")), cy = parseFloat(dot.getAttribute("cy"));
        if (Math.sqrt((pos.x - cx) ** 2 + (pos.y - cy) ** 2) <= 14) { found = g; ringX = cx; ringY = cy; break; }
      }
      if (!found) {
        for (const c of circleEls) {
          let meta = null;
          try { meta = JSON.parse(c.getAttribute("data-interaction") || "null"); } catch {}
          if (!meta?.hoverable) continue;
          const cx = parseFloat(c.getAttribute("cx")), cy = parseFloat(c.getAttribute("cy"));
          const r  = parseFloat(c.getAttribute("r"));
          if (Math.abs(Math.sqrt((pos.x - cx) ** 2 + (pos.y - cy) ** 2) - r) <= 12) { found = c; break; }
        }
      }
      setHover(found, ringX, ringY);
      return;
    }

    // Visual-only drag feedback
    if (drag.mode === "point") {
      drag.dot.setAttribute("cx", String(pos.x));
      drag.dot.setAttribute("cy", String(pos.y));
      const text = drag.g.querySelector("text");
      if (text) { text.setAttribute("x", String(pos.x + 8)); text.setAttribute("y", String(pos.y - 8)); }
      for (const { el, end } of linesForPoint.get(drag.pointId) || []) {
        if (end === 1) { el.setAttribute("x1", String(pos.x)); el.setAttribute("y1", String(pos.y)); }
        else           { el.setAttribute("x2", String(pos.x)); el.setAttribute("y2", String(pos.y)); }
      }
      const cc = circleByCenter.get(drag.pointId);
      if (cc) { cc.setAttribute("cx", String(pos.x)); cc.setAttribute("cy", String(pos.y)); }
      // Live callback (fires on every move, no debounce)
      if (opts?.onDragMove && canvasToMath) {
        const mathPos = canvasToMath(pos.x, pos.y);
        opts.onDragMove({
          type:    "drag_point",
          pointId: drag.pointId,
          newX:    Math.round(mathPos.x * 1000) / 1000,
          newY:    Math.round(mathPos.y * 1000) / 1000,
        }, scene, { ...viewBox });
      }
    }

    if (drag.mode === "radius") {
      drag.circleEl.setAttribute("r", String(Math.max(
        Math.sqrt((pos.x - drag.centerSvgX) ** 2 + (pos.y - drag.centerSvgY) ** 2), 4
      )));
      if (opts?.onDragMove && canvasToMath) {
        const mathPos = canvasToMath(pos.x, pos.y);
        opts.onDragMove({
          type:     "drag_radius",
          circleId: drag.circleId,
          mouseX:   Math.round(mathPos.x * 1000) / 1000,
          mouseY:   Math.round(mathPos.y * 1000) / 1000,
        }, scene, { ...viewBox });
      }
    }
  });

  // ── pointer up ────────────────────────────────────────────────────────────
  svg.addEventListener("pointerup", (e) => {
    panStart = null;
    svg.style.cursor = "grab";
    if (!drag) return;

    const pos         = svgPt(e.clientX, e.clientY);
    const currentDrag = drag;
    drag = null;
    const savedViewBox = { ...viewBox };

    if (currentDrag.mode === "point") {
      currentDrag.g.classList.remove("dragging");
      currentDrag.g.style.cursor = "grab";
      if (!canvasToMath || !opts?.onDragEnd) return;
      const mathPos = canvasToMath(pos.x, pos.y);
      opts.onDragEnd({
        type: "drag_point",
        pointId: currentDrag.pointId,
        newX: Math.round(mathPos.x * 1000) / 1000,
        newY: Math.round(mathPos.y * 1000) / 1000,
      }, scene, savedViewBox);
    }

    if (currentDrag.mode === "radius") {
      currentDrag.circleEl.classList.remove("dragging");
      if (!canvasToMath || !opts?.onDragEnd) return;
      const mathPos = canvasToMath(pos.x, pos.y);
      opts.onDragEnd({
        type: "drag_radius",
        circleId: currentDrag.circleId,
        mouseX: Math.round(mathPos.x * 1000) / 1000,
        mouseY: Math.round(mathPos.y * 1000) / 1000,
      }, scene, savedViewBox);
    }
  });

  svg.addEventListener("pointercancel", () => { drag = null; panStart = null; svg.style.cursor = "grab"; });
  svg.addEventListener("pointerleave",  () => { if (!drag) clearHover(); });

  // ── wheel zoom ────────────────────────────────────────────────────────────
  svg.addEventListener("wheel", (evt) => {
    evt.preventDefault();
    const p = svgPt(evt.clientX, evt.clientY);
    const zoom = evt.deltaY < 0 ? 0.9 : 1.1;
    const nw = viewBox.w * zoom;
    const nh = viewBox.h * zoom;
    const ratioX = (p.x - viewBox.x) / viewBox.w;
    const ratioY = (p.y - viewBox.y) / viewBox.h;
    viewBox.x = p.x - ratioX * nw;
    viewBox.y = p.y - ratioY * nh;
    viewBox.w = Math.max(80,  Math.min(5000, nw));
    viewBox.h = Math.max(60, Math.min(4000, nh));
    applyViewBox();
  }, { passive: false });
}
