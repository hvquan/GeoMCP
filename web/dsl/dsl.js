/**
 * dsl/dsl.js — DSL Debugger frontend for GeoMCP
 *
 * Flow:
 *   Example select / manual DSL edit (GeoMCP snapshot format)
 *   → POST /api/dsl   { dsl: { objects, constraints, constructions, targets } }
 *   → { canonical, freePoints, scene, svg, warnings }
 *   → Show canonical IR in middle panel
 *   → Show scene graph in scene panel
 *   → Show SVG in right panel (with drag interaction via geo-interact.js)
 *
 * Depends on: geo-interact.js, dsl/examples.js (DSL_EXAMPLES)
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────

const dslInput         = document.getElementById('dsl-input');
const canonicalOut     = document.getElementById('canonical-out');
const svgWrap          = document.getElementById('svg-wrap');
const exportHtmlBtn    = document.getElementById('export-html-btn');
const errBox           = document.getElementById('errors');
const warnBox          = document.getElementById('warnings-box');
const snapshotSelect   = document.getElementById('snapshot-select');
const runBtn           = document.getElementById('run');
const clearInputBtn    = document.getElementById('clear-input');
const copyDslBtn       = document.getElementById('copy-dsl');
const copyCanoBtn      = document.getElementById('copy-canonical');
const copySceneBtn     = document.getElementById('copy-scene');
const sceneOut         = document.getElementById('scene-out');
const sceneContent     = document.getElementById('scene-content');
const scenePlaceholder = document.getElementById('scene-placeholder');

// ── Interaction state ─────────────────────────────────────────────────────────

let currentIr         = null;   // canonical IR from last successful run
let currentFreePoints = {};     // { [pointId]: { x, y } }
let _fixedScale       = null;
let _fixedOffX        = null;
let _fixedOffY        = null;
let _liveFetching     = false;

// ── Populate example selector ─────────────────────────────────────────────────

function loadExamples() {
  if (typeof DSL_EXAMPLES === 'undefined') return;
  const group = document.createElement('optgroup');
  group.label = 'GeoMCP Snapshots';
  snapshotSelect.appendChild(group);
  for (const item of DSL_EXAMPLES) {
    const opt = document.createElement('option');
    opt.value = JSON.stringify(item.dsl);
    opt.textContent = item.label;
    group.appendChild(opt);
  }
}

snapshotSelect.addEventListener('change', () => {
  const val = snapshotSelect.value;
  if (!val) return;
  try {
    const dsl = JSON.parse(val);
    dslInput.value = JSON.stringify(dsl, null, 2);
    runPipeline();
  } catch { /* ignore */ }
});

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function runPipeline() {
  const raw = dslInput.value.trim();
  errBox.textContent  = '';
  warnBox.textContent = '';

  if (!raw) {
    errBox.textContent = 'Empty DSL input.';
    return;
  }

  // Strip JSONC comments
  const stripped = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  let dsl;
  try {
    dsl = JSON.parse(stripped);
  } catch (e) {
    errBox.textContent = 'JSON parse error: ' + e.message;
    return;
  }

  try {
    const resp = await fetch('/api/dsl', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ dsl }),
    });
    const data = await resp.json();

    if (data.error) {
      errBox.textContent = data.error;
      return;
    }

    // Store for interaction
    currentIr         = data.canonical ?? null;
    currentFreePoints = data.freePoints ? { ...data.freePoints } : {};
    _fixedScale = null; _fixedOffX = null; _fixedOffY = null;

    // Show canonical IR
    canonicalOut.value = JSON.stringify(data.canonical, null, 2);

    // Show warnings
    warnBox.textContent = data.warnings?.length
      ? '⚠ ' + data.warnings.join('\n⚠ ')
      : '';

    // Show scene graph
    if (data.scene) showSceneOutput(data.scene);

    // Show SVG + start drag interaction
    if (data.svg) {
      svgWrap.innerHTML = data.svg;
      if (data.scene) {
        lockScale(data.scene, svgWrap.querySelector('svg'));
        startInteraction(data.scene, null);
      }
    } else {
      svgWrap.innerHTML = '<p class="placeholder-msg">No SVG returned</p>';
    }

  } catch (e) {
    errBox.textContent = 'Request failed: ' + e.message;
  }
}

runBtn.addEventListener('click', runPipeline);

clearInputBtn.addEventListener('click', () => {
  dslInput.value = '';
  errBox.textContent  = '';
  warnBox.textContent = '';
  dslInput.focus();
});

dslInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runPipeline();
  }
});

// ── Lock render scale ─────────────────────────────────────────────────────────

function lockScale(scene, svgEl) {
  if (!svgEl) return;
  const pts = scene?.points || [];
  const canvasH = parseFloat(svgEl.getAttribute('height') || '1200');
  for (const p of pts) {
    if (typeof p.x !== 'number') continue;
    const g   = svgEl.querySelector(`g[data-point-id="${CSS.escape(p.id)}"]`);
    const dot = g?.querySelector('circle');
    if (!g || !dot) continue;
    const cx = parseFloat(dot.getAttribute('cx'));
    const cy = parseFloat(dot.getAttribute('cy'));
    for (const p2 of pts) {
      if (p2.id === p.id || typeof p2.x !== 'number') continue;
      const g2   = svgEl.querySelector(`g[data-point-id="${CSS.escape(p2.id)}"]`);
      const dot2 = g2?.querySelector('circle');
      if (!g2 || !dot2) continue;
      const dmx = p2.x - p.x, dmy = p2.y - p.y;
      const dcx = parseFloat(dot2.getAttribute('cx')) - cx;
      const dcy = parseFloat(dot2.getAttribute('cy')) - cy;
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

// ── Interaction helpers ───────────────────────────────────────────────────────

function applyAngleDrag(event, ptEnt, scene) {
  const circEnt  = currentIr.entities.find(e => e.id === ptEnt.construction.circle);
  const centerId = circEnt?.construction?.center;
  const ctr      = currentFreePoints[centerId] ?? scene?.points?.find(p => p.id === centerId);
  if (!ctr) return null;
  const angle  = Math.atan2(event.newY - ctr.y, event.newX - ctr.x);
  const angEnt = currentIr.entities.find(e => e.id === ptEnt.construction.angle);
  if (!angEnt) return null;
  angEnt.construction.value = Math.round(angle * 100000) / 100000;
  return angEnt.id;
}

function applyRadiusDrag(event, scene) {
  if (!currentIr) return null;
  const cirEntity = currentIr.entities.find(e => e.id === event.circleId);
  if (!cirEntity || cirEntity.construction?.type !== 'circle_center_radius') return null;
  const centerId = cirEntity.construction.center;
  const fp       = currentFreePoints[centerId];
  const centerPt = fp ?? scene?.points?.find(p => p.id === centerId);
  if (!centerPt) return null;
  const newR = Math.sqrt((event.mouseX - centerPt.x) ** 2 + (event.mouseY - centerPt.y) ** 2);
  if (!isFinite(newR) || newR < 0.01) return null;
  const radParamId = cirEntity.construction.radius;
  const radEntity  = currentIr.entities.find(e => e.id === radParamId);
  if (radEntity) radEntity.construction.value = Math.round(newR * 10000) / 10000;
  return radParamId;
}

function patchSvgElements(curSvg, newSvg, draggedPointId) {
  for (const ng of newSvg.querySelectorAll('g[data-point-id]')) {
    const pid = ng.getAttribute('data-point-id');
    if (pid === draggedPointId) continue;
    const cg = curSvg.querySelector(`g[data-point-id="${CSS.escape(pid)}"]`);
    if (!cg) continue;
    const ndot = ng.querySelector('circle'), cdot = cg.querySelector('circle');
    if (ndot && cdot) {
      cdot.setAttribute('cx', ndot.getAttribute('cx'));
      cdot.setAttribute('cy', ndot.getAttribute('cy'));
    }
    const ntxt = ng.querySelector('text'), ctxt = cg.querySelector('text');
    if (ntxt && ctxt) {
      ctxt.setAttribute('x', ntxt.getAttribute('x'));
      ctxt.setAttribute('y', ntxt.getAttribute('y'));
    }
  }
  for (const nel of newSvg.querySelectorAll('[data-id]')) {
    const id  = nel.getAttribute('data-id');
    const cel = curSvg.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!cel || nel.tagName !== cel.tagName) continue;
    if (nel.tagName === 'line') {
      for (const a of ['x1','y1','x2','y2']) cel.setAttribute(a, nel.getAttribute(a) ?? '');
    } else if (nel.tagName === 'circle') {
      for (const a of ['cx','cy','r'])       cel.setAttribute(a, nel.getAttribute(a) ?? '');
    } else if (nel.tagName === 'polygon' || nel.tagName === 'polyline') {
      cel.setAttribute('points', nel.getAttribute('points') ?? '');
    } else if (nel.tagName === 'path') {
      cel.setAttribute('d', nel.getAttribute('d') ?? '');
    }
  }
}

// ── Drag-move (live) ──────────────────────────────────────────────────────────

async function onDragMove(event, scene, _vb) {
  if (!currentIr) return;
  if (event.type !== 'drag_point' && event.type !== 'drag_radius') return;
  if (_liveFetching) return;
  _liveFetching = true;

  let draggedPointId = null;
  if (event.type === 'drag_point') {
    const ptEnt = currentIr.entities.find(e => e.id === event.pointId);
    if (ptEnt?.construction?.type === 'point_on_circle' && ptEnt.construction.angle) {
      if (!applyAngleDrag(event, ptEnt, scene)) { _liveFetching = false; return; }
    } else {
      currentFreePoints[event.pointId] = { x: event.newX, y: event.newY };
      draggedPointId = event.pointId;
    }
  } else {
    if (!applyRadiusDrag(event, scene)) { _liveFetching = false; return; }
  }

  try {
    const resp = await fetch('/api/canonical', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ir: currentIr, freePoints: currentFreePoints,
        fixedScale: _fixedScale, fixedOffX: _fixedOffX, fixedOffY: _fixedOffY,
      }),
    });
    const data = await resp.json();
    if (data.svg) {
      const tmp = document.createElement('div');
      tmp.innerHTML = data.svg;
      const newSvg = tmp.querySelector('svg');
      const curSvg = svgWrap.querySelector('svg');
      if (newSvg && curSvg) patchSvgElements(curSvg, newSvg, draggedPointId);
      if (data.scene) showSceneOutput(data.scene);
    }
  } catch (_) { /* ignore live errors */ }
  finally { _liveFetching = false; }
}

// ── Drag-end (commit) ─────────────────────────────────────────────────────────

async function onDragEnd(event, _scene, savedVB) {
  if (!currentIr) return;
  if (event.type !== 'drag_point' && event.type !== 'drag_radius') return;

  if (event.type === 'drag_point') {
    const ptEnt = currentIr.entities.find(e => e.id === event.pointId);
    if (ptEnt?.construction?.type === 'point_on_circle' && ptEnt.construction.angle) {
      applyAngleDrag(event, ptEnt, _scene);
    } else {
      currentFreePoints[event.pointId] = { x: event.newX, y: event.newY };
    }
  } else {
    applyRadiusDrag(event, _scene);
  }

  try {
    const resp = await fetch('/api/canonical', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ir: currentIr, freePoints: currentFreePoints,
        fixedScale: _fixedScale, fixedOffX: _fixedOffX, fixedOffY: _fixedOffY,
      }),
    });
    const data = await resp.json();
    if (data.svg) {
      svgWrap.innerHTML = data.svg;
      startInteraction(data.scene, savedVB);
      if (data.scene) showSceneOutput(data.scene);
    }
    if (data.errors?.length) {
      errBox.textContent = data.errors.map(e => `[${e.path ?? '?'}] ${e.message}`).join('\n');
    }
  } catch (err) {
    errBox.textContent = 'Interact error: ' + err.message;
  }
}

function startInteraction(scene, restoreViewBox) {
  interactSvg(svgWrap, scene, restoreViewBox, {
    onDragEnd,
    onDragMove,
  });
}

// ── Copy buttons ──────────────────────────────────────────────────────────────

function copyText(text, btn) {
  navigator.clipboard.writeText(text);
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = btn.dataset.label || 'COPY'; }, 1200);
}

copyDslBtn.addEventListener('click',   () => copyText(dslInput.value,          copyDslBtn));
copyCanoBtn.addEventListener('click',  () => copyText(canonicalOut.value,      copyCanoBtn));
copySceneBtn.addEventListener('click', () => copyText(sceneContent.textContent, copySceneBtn));

function showSceneOutput(scene) {
  sceneContent.textContent = JSON.stringify(scene, null, 2);
  scenePlaceholder.style.display = 'none';
  sceneOut.style.display = '';
}

// ── Export HTML ───────────────────────────────────────────────────────────────

async function buildExportHtml(svgEl) {
  let svgStr = new XMLSerializer().serializeToString(svgEl);
  svgStr = svgStr.replace(/<g\s[^>]*data-overlay="tangents"[^>]*>[\s\S]*?<\/g>/g, '');

  const [engineJs, interactJs] = await Promise.all([
    fetch('/geo-engine.js').then(r => r.text()),
    fetch('/geo-interact.js').then(r => r.text()),
  ]);

  const irJson         = JSON.stringify(currentIr         ?? null);
  const freePointsJson = JSON.stringify(currentFreePoints ?? {});
  const sceneJson      = JSON.stringify(null); // will be re-derived on first drag
  const fixedScaleJson = JSON.stringify(_fixedScale ?? null);
  const fixedOffXJson  = JSON.stringify(_fixedOffX  ?? null);
  const fixedOffYJson  = JSON.stringify(_fixedOffY  ?? null);

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
    <div class="svg-wrap" id="svg-wrap">${svgStr}</div>
    <div class="toolbar">
      <span>Drag points &bull; Scroll to zoom &bull; Drag background to pan</span>
      <button id="btn-fullscreen">&#x26F6; Full screen</button>
    </div>
  </div>
  <script>
${engineJs}
  <\/script>
  <script>
${interactJs}
  <\/script>
  <script>
    var _ir         = ${irJson};
    var _freePoints = ${freePointsJson};
    var _scene      = ${sceneJson};
    var _fixedScale = ${fixedScaleJson};
    var _fixedOffX  = ${fixedOffXJson};
    var _fixedOffY  = ${fixedOffYJson};
    var _container  = null;
    var _liveDragging = false;

    function _applyAngleDrag(event) {
      var ptEnt = _ir.entities.find(function(e) { return e.id === event.pointId; });
      if (!ptEnt || !ptEnt.construction || ptEnt.construction.type !== 'point_on_circle' || !ptEnt.construction.angle) return false;
      var circEnt  = _ir.entities.find(function(e) { return e.id === ptEnt.construction.circle; });
      var centerId = circEnt && circEnt.construction && circEnt.construction.center;
      var ctr      = (centerId && _freePoints[centerId]) || (_scene && _scene.points && _scene.points.find(function(p) { return p.id === centerId; }));
      if (!ctr) return false;
      var angle  = Math.atan2(event.newY - ctr.y, event.newX - ctr.x);
      var angEnt = _ir.entities.find(function(e) { return e.id === ptEnt.construction.angle; });
      if (!angEnt) return false;
      angEnt.construction.value = Math.round(angle * 100000) / 100000;
      return true;
    }

    function _applyRadiusDrag(event) {
      var cirEntity = _ir.entities.find(function(e) { return e.id === event.circleId; });
      if (!cirEntity || !cirEntity.construction || cirEntity.construction.type !== 'circle_center_radius') return false;
      var centerId = cirEntity.construction.center;
      var centerPt = _freePoints[centerId] || (_scene && _scene.points && _scene.points.find(function(p) { return p.id === centerId; }));
      if (!centerPt) return false;
      var newR = Math.sqrt(Math.pow(event.mouseX - centerPt.x, 2) + Math.pow(event.mouseY - centerPt.y, 2));
      if (!isFinite(newR) || newR < 0.01) return false;
      var radEntity = _ir.entities.find(function(e) { return e.id === cirEntity.construction.radius; });
      if (radEntity) radEntity.construction.value = Math.round(newR * 10000) / 10000;
      return true;
    }

    function _patchSvgElements(curSvg, newSvg, skipId) {
      newSvg.querySelectorAll('g[data-point-id]').forEach(function(ng) {
        var pid = ng.getAttribute('data-point-id');
        if (pid === skipId) return;
        var cg = curSvg.querySelector('g[data-point-id="' + CSS.escape(pid) + '"]');
        if (!cg) return;
        var ndot = ng.querySelector('circle'), cdot = cg.querySelector('circle');
        if (ndot && cdot) { cdot.setAttribute('cx', ndot.getAttribute('cx')); cdot.setAttribute('cy', ndot.getAttribute('cy')); }
        var ntxt = ng.querySelector('text'), ctxt = cg.querySelector('text');
        if (ntxt && ctxt) { ctxt.setAttribute('x', ntxt.getAttribute('x')); ctxt.setAttribute('y', ntxt.getAttribute('y')); }
      });
      newSvg.querySelectorAll('[data-id]').forEach(function(nel) {
        var id = nel.getAttribute('data-id');
        var cel = curSvg.querySelector('[data-id="' + CSS.escape(id) + '"]');
        if (!cel || nel.tagName !== cel.tagName) return;
        if (nel.tagName === 'line') {
          ['x1','y1','x2','y2'].forEach(function(a) { cel.setAttribute(a, nel.getAttribute(a) || ''); });
        } else if (nel.tagName === 'circle') {
          ['cx','cy','r'].forEach(function(a) { cel.setAttribute(a, nel.getAttribute(a) || ''); });
        } else if (nel.tagName === 'polygon' || nel.tagName === 'polyline') {
          cel.setAttribute('points', nel.getAttribute('points') || '');
        } else if (nel.tagName === 'path') {
          cel.setAttribute('d', nel.getAttribute('d') || '');
        }
      });
    }

    function _runAndPatch(draggedId) {
      var result = GeoEngine.runFromCanonical(_ir, _freePoints, _fixedScale, _fixedOffX, _fixedOffY);
      var tmp = document.createElement('div');
      tmp.innerHTML = result.svg;
      var newSvg = tmp.querySelector('svg');
      var curSvg = _container.querySelector('svg');
      if (newSvg && curSvg) _patchSvgElements(curSvg, newSvg, draggedId);
      _scene = result.scene || _scene;
    }

    function _onDragMove(event, scene, vb) {
      if (!_ir || _liveDragging) return;
      if (event.type !== 'drag_point' && event.type !== 'drag_radius') return;
      _liveDragging = true;
      var draggedId = null;
      if (event.type === 'drag_point') {
        if (!_applyAngleDrag(event)) {
          _freePoints = Object.assign({}, _freePoints);
          _freePoints[event.pointId] = { x: event.newX, y: event.newY };
          draggedId = event.pointId;
        }
      } else { if (!_applyRadiusDrag(event)) { _liveDragging = false; return; } }
      try { _runAndPatch(draggedId); } catch(_e) {}
      _liveDragging = false;
    }

    function _onDragEnd(event, scene, savedVB) {
      if (!_ir) return;
      if (event.type === 'drag_point') {
        if (!_applyAngleDrag(event)) {
          _freePoints = Object.assign({}, _freePoints);
          _freePoints[event.pointId] = { x: event.newX, y: event.newY };
        }
      } else if (event.type === 'drag_radius') {
        _applyRadiusDrag(event);
      }
      var result = GeoEngine.runFromCanonical(_ir, _freePoints, _fixedScale, _fixedOffX, _fixedOffY);
      _scene = result.scene || _scene;
      _container.innerHTML = result.svg;
      _startInteraction(savedVB);
    }

    function _startInteraction(restoreViewBox) {
      interactSvg(_container, _scene, restoreViewBox, { onDragEnd: _onDragEnd, onDragMove: _onDragMove });
    }

    window.addEventListener('DOMContentLoaded', function () {
      _container = document.getElementById('svg-wrap');
      if (_ir) {
        var result = GeoEngine.runFromCanonical(_ir, _freePoints, _fixedScale, _fixedOffX, _fixedOffY);
        _scene = result.scene;
        _container.innerHTML = result.svg;
        _startInteraction(null);
      }
      document.getElementById('btn-fullscreen').addEventListener('click', function () {
        var el = document.documentElement;
        if (!document.fullscreenElement) { el.requestFullscreen && el.requestFullscreen(); }
        else { document.exitFullscreen && document.exitFullscreen(); }
      });
      document.addEventListener('fullscreenchange', function () {
        var btn = document.getElementById('btn-fullscreen');
        btn.textContent = document.fullscreenElement ? '\u29F5 Exit full screen' : '\u26F6 Full screen';
      });
    });
  <\/script>
</body>
</html>`;
}

exportHtmlBtn.addEventListener('click', async () => {
  const svgEl = svgWrap.querySelector('svg');
  if (!svgEl) return;
  exportHtmlBtn.disabled = true;
  exportHtmlBtn.textContent = 'Exporting\u2026';
  try {
    const html = await buildExportHtml(svgEl);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'geometry-figure.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } finally {
    exportHtmlBtn.disabled = false;
    exportHtmlBtn.textContent = 'Export HTML';
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadExamples();
