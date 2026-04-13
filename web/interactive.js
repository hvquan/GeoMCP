    function enhanceInteractiveSvg(container, parsed, liveGraphPre) {
      const svg = container.querySelector("svg");
      if (!svg) {
        return;
      }

      svg.style.maxWidth = "100%";
      svg.style.width = "100%";
      svg.style.height = "auto";
      svg.style.touchAction = "none";

      const vb0 = (svg.getAttribute("viewBox") || "0 0 800 600").split(/\s+/).map(Number);
      let viewBox = {
        x: vb0[0] || 0,
        y: vb0[1] || 0,
        w: vb0[2] || 800,
        h: vb0[3] || 600
      };

      function applyViewBox() {
        svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
      }

      // ── ID helpers ───────────────────────────────────────────────────────────
      // Strip type prefix from a namespaced ID for display/comparison purposes.
      //   "point:O"  → "O"   "circle:O" → "O"   "line:L1" → "L1"   "O" → "O"
      function displayLabel(id) {
        const m = (id || "").match(/^(?:point|circle|line|seg|ray|len):(.+)$/i);
        return m ? m[1] : (id || "");
      }

      // ── Point-type classification ────────────────────────────────────────────
      // derivedPointIds   → fixed (red):   fully determined by constraints, not draggable
      // segmentConstraintOf → constrained-segment (purple): freely placed on one segment,
      //                        drags along that segment
      // pointOnCircleByPointId (built later) → constrained-circle (purple): slides along arc
      // Everything else   → free (blue): drags anywhere

      const derivedPointIds = new Set();

      // Midpoints are fully determined.
      for (const rel of Array.isArray(parsed?.midpoints) ? parsed.midpoints : []) {
        if (rel?.point) derivedPointIds.add(String(rel.point).toUpperCase());
      }
      // Altitude / median / angle-bisector feet are fully determined.
      for (const rel of Array.isArray(parsed?.altitudes) ? parsed.altitudes : []) {
        if (rel?.foot) derivedPointIds.add(String(rel.foot).toUpperCase());
      }
      for (const rel of Array.isArray(parsed?.medians) ? parsed.medians : []) {
        if (rel?.foot) derivedPointIds.add(String(rel.foot).toUpperCase());
      }
      for (const rel of Array.isArray(parsed?.angleBisectors) ? parsed.angleBisectors : []) {
        if (rel?.foot) derivedPointIds.add(String(rel.foot).toUpperCase());
      }
      // Intersection points are fully determined.
      for (const rel of Array.isArray(parsed?.lineIntersections) ? parsed.lineIntersections : []) {
        if (rel?.point) derivedPointIds.add(String(rel.point).toUpperCase());
      }
      for (const rel of Array.isArray(parsed?.perpendicularThroughPointIntersections) ? parsed.perpendicularThroughPointIntersections : []) {
        if (rel?.intersection) derivedPointIds.add(String(rel.intersection).toUpperCase());
      }
      for (const rel of Array.isArray(parsed?.tangentIntersections) ? parsed.tangentIntersections : []) {
        if (rel?.intersection) derivedPointIds.add(String(rel.intersection).toUpperCase());
      }
      for (const rel of Array.isArray(parsed?.namedTangents) ? parsed.namedTangents : []) {
        if (rel?.linePoint) derivedPointIds.add(String(rel.linePoint).toUpperCase());
      }
      // namedTangent linePoints are direction anchors derived from touch-point + center.
      // They MUST NOT be in driverPointIds — ensure they are not treated as free after the
      // driverPointIds set is built (the set is populated inside the points loop below).
      const namedTangentLinePoints = new Set(
        (Array.isArray(parsed?.namedTangents) ? parsed.namedTangents : [])
          .filter((r) => r?.linePoint)
          .map((r) => String(r.linePoint).toUpperCase())
      );
      // Incircle centers (e.g. K = incenter) are derived: placed by weighted-incenter formula.
      // Mark them non-draggable so they follow A,B,C instead of being free points.
      for (const ic of (Array.isArray(parsed?.incircles) ? parsed.incircles : [])) {
        if (ic?.center) derivedPointIds.add(String(ic.center).toUpperCase());
      }

      // pointsOnSegments: a point is a "foot" (fixed/red) when there is also a perpendicular
      // constraint whose base matches the segment and whose other line contains the point.
      // Otherwise it is "freely placed on segment" (constrained-segment / purple).
      // segmentConstraintOf: pid → { a, b }  (the segment to slide along)
      const segmentConstraintOf = new Map();
      (function classifySegmentPoints() {
        const perps = Array.isArray(parsed?.perpendiculars) ? parsed.perpendiculars : [];
        for (const rel of Array.isArray(parsed?.pointsOnSegments) ? parsed.pointsOnSegments : []) {
          if (!rel?.point) continue;
          const pid   = String(rel.point).toUpperCase();
          const baseA = String(rel.a || "").toUpperCase();
          const baseB = String(rel.b || "").toUpperCase();
          if (derivedPointIds.has(pid)) continue; // already fixed by another constraint
          let isFoot = false;
          for (const perp of perps) {
            const l1a = String(perp?.line1?.a || "").toUpperCase();
            const l1b = String(perp?.line1?.b || "").toUpperCase();
            const l2a = String(perp?.line2?.a || "").toUpperCase();
            const l2b = String(perp?.line2?.b || "").toUpperCase();
            const l1IsBase = (l1a === baseA && l1b === baseB) || (l1a === baseB && l1b === baseA);
            const l2IsBase = (l2a === baseA && l2b === baseB) || (l2a === baseB && l2b === baseA);
            if ((l1IsBase && (l2a === pid || l2b === pid)) ||
                (l2IsBase && (l1a === pid || l1b === pid))) {
              isFoot = true;
              break;
            }
          }
          if (isFoot) {
            derivedPointIds.add(pid);
          } else {
            segmentConstraintOf.set(pid, { a: rel.a, b: rel.b });
          }
        }
      })();

      const driverPointIds = new Set();

      const pointGroups = Array.from(svg.querySelectorAll("g")).filter((g) => {
        const c = g.querySelector("circle");
        const t = g.querySelector("text");
        return Boolean(c && t && !g.closest("defs"));
      });

      const points = pointGroups
        .map((g) => {
          const circle = g.querySelector("circle");
          const text = g.querySelector("text");
          if (!circle || !text) {
            return null;
          }
          const id = (g.getAttribute("data-point-id") || text.textContent || "").trim();
          if (!id || displayLabel(id).startsWith("t_")) {
            g.style.display = "none";
            return null;
          }
          const x = parseNumber(circle.getAttribute("cx"));
          const y = parseNumber(circle.getAttribute("cy"));
          // Hidden helper points (e.g. _f_l1 foot of perpendicular): keep in pointById so
          // addEdge/computeOf can reference them, but do not show them to the user.
          if (displayLabel(id).startsWith("_")) {
            g.style.display = "none";
            return { id, group: g, circle, text, x, y, prevX: x, prevY: y, draggable: false, lines: [], centeredCircles: [], radiusCircles: [] };
          }
          const draggable = !derivedPointIds.has(String(id).toUpperCase());
          if (draggable) {
            driverPointIds.add(String(id).toUpperCase());
          }
          g.style.cursor = draggable ? "grab" : "default";
          return { id, group: g, circle, text, x, y, prevX: x, prevY: y, draggable, lines: [], centeredCircles: [], radiusCircles: [] };
        })
        .filter(Boolean);

      const pointById = new Map(points.map((p) => [p.id.toUpperCase(), p]));

      function getPoint(id) {
        if (!id || typeof id !== "string") {
          return null;
        }
        const upper = id.toUpperCase();
        return pointById.get(upper) || pointById.get(`POINT:${upper}`) || null;
      }

      let pointsOnCirclesData = Array.isArray(parsed?.pointsOnCircles) ? [...parsed.pointsOnCircles] : [];
      if (parsed && !Array.isArray(parsed.pointsOnCircles)) {
        parsed.pointsOnCircles = pointsOnCirclesData;
      }
      const pointOnCircleByPointId = new Map(
        pointsOnCirclesData
          .filter((it) => it && it.point && it.center)
          .map((it) => [String(it.point).toUpperCase(), String(it.center).toUpperCase()])
      );
      const radiusDriverKeys = new Set();
      for (const it of Array.isArray(parsed?.circleConstraints) ? parsed.circleConstraints : []) {
        if (it?.centerPointId && it?.pointOnCircleId) {
          radiusDriverKeys.add(`${String(it.centerPointId).toUpperCase()}:${String(it.pointOnCircleId).toUpperCase()}`);
        }
      }
      for (const it of Array.isArray(parsed?.circlesByDiameter) ? parsed.circlesByDiameter : []) {
        const centerId = String(it?.centerId || "O").toUpperCase();
        // Only the first diameter endpoint (a = C) is the radius anchor.
        // The second endpoint (b = D) slides along the circle; C follows via the constraint graph.
        if (it?.a) {
          radiusDriverKeys.add(`${centerId}:${String(it.a).toUpperCase()}`);
        }
      }
      const diameterEndpointIds = new Set(
        (Array.isArray(parsed?.circlesByDiameter) ? parsed.circlesByDiameter : [])
          .flatMap((it) => [it?.a, it?.b])
          .filter(Boolean)
          .map((id) => String(id).toUpperCase())
      );

      const lines = Array.from(svg.querySelectorAll("line"));
      const lineElementsByUndirectedKey = new Map();

      function undirectedKey(a, b) {
        const aa = String(a || "").toUpperCase();
        const bb = String(b || "").toUpperCase();
        return aa < bb ? `${aa}:${bb}` : `${bb}:${aa}`;
      }

      for (const line of lines) {
        const la = line.getAttribute("data-a");
        const lb = line.getAttribute("data-b");
        if (la && lb) {
          const k = undirectedKey(la, lb);
          const list = lineElementsByUndirectedKey.get(k) || [];
          list.push(line);
          lineElementsByUndirectedKey.set(k, list);
        }

        const p1 = getPoint(line.getAttribute("data-a") || "") || findNearestPoint(points, parseNumber(line.getAttribute("x1")), parseNumber(line.getAttribute("y1")), 8);
        const p2 = getPoint(line.getAttribute("data-b") || "") || findNearestPoint(points, parseNumber(line.getAttribute("x2")), parseNumber(line.getAttribute("y2")), 8);
        if (p1) {
          p1.lines.push({ line, end: 1, other: p2 || null });
        }
        if (p2) {
          p2.lines.push({ line, end: 2, other: p1 || null });
        }
      }

      const circleEls = Array.from(svg.querySelectorAll("circle")).filter((c) => {
        const r = parseNumber(c.getAttribute("r"));
        return r > 6; // geometry circles, not point dots
      });

      const circleByCenterId = new Map();
      const svgNs = "http://www.w3.org/2000/svg";
      const tangentOverlayLayer = document.createElementNS(svgNs, "g");
      tangentOverlayLayer.setAttribute("data-overlay", "tangents");
      svg.appendChild(tangentOverlayLayer);
      const tangentOverlayByKey = new Map();

      for (const c of circleEls) {
        const cx = parseNumber(c.getAttribute("cx"));
        const cy = parseNumber(c.getAttribute("cy"));
        const centerPoint = getPoint(c.getAttribute("data-center-id") || "") || findNearestPoint(points, cx, cy, 8);
        if (centerPoint) {
          centerPoint.centeredCircles.push(c);
          circleByCenterId.set(centerPoint.id, c);
        }

        if (centerPoint) {
          for (const p of points) {
            const key = `${String(centerPoint.id).toUpperCase()}:${String(p.id).toUpperCase()}`;
            if (radiusDriverKeys.has(key)) {
              p.radiusCircles.push(c);
            }
          }
        }
      }

      function addCircleAnchorPointIfMissing() {
        for (const [centerId, cEl] of circleByCenterId.entries()) {
          const centerKeyId = String(centerId || "").toUpperCase();
          if (!centerKeyId) {
            continue;
          }

          let hasPointOnThisCircle = false;
          for (const [, cid] of pointOnCircleByPointId.entries()) {
            if (cid === centerKeyId) {
              hasPointOnThisCircle = true;
              break;
            }
          }
          if (hasPointOnThisCircle) {
            continue;
          }

          const center = getPoint(centerId);
          const r = parseNumber(cEl.getAttribute("r"), 0);
          if (!center || r <= 1) {
            continue;
          }

          const baseId = `R_${displayLabel(centerId)}`;
          let helperId = baseId;
          let suffix = 1;
          while (pointById.has(helperId)) {
            helperId = `${baseId}${suffix++}`;
          }

          const g = document.createElementNS(svgNs, "g");
          g.setAttribute("data-point-id", helperId);

          const titleEl = document.createElementNS(svgNs, "title");
          titleEl.textContent = "Drag to resize circle";

          const dot = document.createElementNS(svgNs, "circle");
          dot.setAttribute("cx", String(center.x + r));
          dot.setAttribute("cy", String(center.y));
          dot.setAttribute("r", "5");
          dot.setAttribute("fill", "none");
          dot.setAttribute("stroke", "#6b7280");
          dot.setAttribute("stroke-width", "1.5");
          dot.setAttribute("stroke-dasharray", "3 2");

          const label = document.createElementNS(svgNs, "text");
          label.setAttribute("x", String(center.x + r + 8));
          label.setAttribute("y", String(center.y - 8));
          label.textContent = ""; // helper anchor — no label shown

          g.appendChild(titleEl);
          g.appendChild(dot);
          g.appendChild(label);
          svg.appendChild(g);

          const p = {
            id: helperId,
            group: g,
            circle: dot,
            text: label,
            x: center.x + r,
            y: center.y,
            prevX: center.x + r,
            prevY: center.y,
            draggable: true,
            lines: [],
            centeredCircles: [],
            radiusCircles: []
          };

          g.style.cursor = "grab";
          points.push(p);
          pointById.set(helperId, p);
          driverPointIds.add(helperId);
          pointOnCircleByPointId.set(helperId, centerKeyId);

          const rel = { point: helperId, center: centerKeyId };
          pointsOnCirclesData.push(rel);
          if (parsed && Array.isArray(parsed.pointsOnCircles)) {
            parsed.pointsOnCircles.push(rel);
          }

          console.log("[DEBUG] Added helper on-circle point:", helperId, "for center", centerKeyId);
        }
      }

      addCircleAnchorPointIfMissing();

      // Infer pointsOnCircles from geometry: any named point that lies on a circle
      // (within 4px tolerance) but is not already tracked gets added automatically.
      // This handles cases where the parser misses "E be a point on circle (O)".
      (function inferPointsOnCircles() {
        const alreadyConstrained = new Set(
          [...pointOnCircleByPointId.keys()].map((id) => String(id).toUpperCase())
        );
        for (const [centerId, cEl] of circleByCenterId.entries()) {
          const center = getPoint(centerId);
          if (!center) continue;
          const r = parseNumber(cEl.getAttribute("r"), 0);
          if (r <= 1) continue;
          for (const p of points) {
            const pid = String(p.id).toUpperCase();
            if (alreadyConstrained.has(pid)) continue;
            // Skip the center itself and diameter endpoints – they're not "on circle" constraints.
            const isDiamEndpoint = diameterEndpointIds.has(pid);
            const isCenter = String(centerId).toUpperCase() === pid;
            if (isCenter || isDiamEndpoint) continue;
            const d = distance(p.x, p.y, center.x, center.y);
            if (Math.abs(d - r) <= 4) {
              const rel = { point: p.id, center: centerId };
              pointsOnCirclesData.push(rel);
              if (parsed && Array.isArray(parsed.pointsOnCircles)) {
                parsed.pointsOnCircles.push(rel);
              }
              pointOnCircleByPointId.set(pid, String(centerId).toUpperCase());
              alreadyConstrained.add(pid);
            }
          }
        }
      })();

      // ── Apply point-type colours ──────────────────────────────────────────────
      // red   (#e53e3e): fixed — position fully determined; not draggable
      // purple (#7c3aed): constrained — slides along circle or segment
      // blue  (#2563eb): free — drags anywhere
      // R_*   helper: synthetic circle-resize anchor — styled separately, no fill override
      (function applyPointColors() {
        for (const p of points) {
          const pid = String(p.id || "").toUpperCase();
          // Skip synthetic circle-resize anchors — they have their own dashed-ring style
          if (pid.startsWith("R_")) {
            p.group.style.cursor = "ew-resize";
            continue;
          }
          let fill;
          if (derivedPointIds.has(pid)) {
            fill = "#e53e3e";
            p.group.style.cursor = "not-allowed";
          } else if (pointOnCircleByPointId.has(pid) || segmentConstraintOf.has(pid)) {
            fill = "#7c3aed";
            p.group.style.cursor = "grab";
          } else {
            fill = "#2563eb";
            p.group.style.cursor = "grab";
          }
          if (p.circle) p.circle.setAttribute("fill", fill);
        }
      })();

      lastFigureState = { points, parsed, svgEl: svg };
      patchBar.classList.add("visible");

      function screenToSvg(clientX, clientY) {
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const ctm = svg.getScreenCTM();
        if (!ctm) {
          return { x: 0, y: 0 };
        }
        const out = pt.matrixTransform(ctm.inverse());
        return { x: out.x, y: out.y };
      }

      function ensureOverlayLine(key, stroke) {
        let line = tangentOverlayByKey.get(key);
        if (!line) {
          line = document.createElementNS(svgNs, "line");
          line.setAttribute("fill", "none");
          line.setAttribute("stroke", stroke);
          line.setAttribute("stroke-width", "2.5");
          tangentOverlayLayer.appendChild(line);
          tangentOverlayByKey.set(key, line);
        }
        return line;
      }

      function updateTangentOverlays() {
        const activeKeys = new Set();
        const hiddenBaseKeys = new Set();

        for (const rel of Array.isArray(parsed?.namedTangents) ? parsed.namedTangents : []) {
          const at = getPoint(rel.at);
          const center = getPoint(rel.center || rel.centerId || "O") || getPoint("O");
          const linePoint = getPoint(rel.linePoint);
          if (!at || !center) {
            continue;
          }
          const rvx = at.x - center.x;
          const rvy = at.y - center.y;
          const rlen = Math.sqrt(rvx * rvx + rvy * rvy) || 1;
          let dx = -rvy / rlen;
          let dy = rvx / rlen;
          let len = linePoint ? Math.max(distance(at.x, at.y, linePoint.x, linePoint.y), 80) : 80;
          if (linePoint) {
            const dot = (linePoint.x - at.x) * dx + (linePoint.y - at.y) * dy;
            if (dot < 0) {
              dx = -dx;
              dy = -dy;
            }
          }
          // Extend the line to cover any intersection points known to lie on it.
          // A can fall on either side of C depending on where E is, so track both ends.
          const ntAtId = String(rel.at || "").toUpperCase();
          const ntLpId = String(rel.linePoint || "").toUpperCase();
          const onThisLine = (it) => {
            const wa = String(it?.withLine?.a || "").toUpperCase();
            const wb = String(it?.withLine?.b || "").toUpperCase();
            return (wa === ntAtId && wb === ntLpId) || (wa === ntLpId && wb === ntAtId);
          };
          let negExtend = 8; // extension behind C (x1 side)
          for (const src of [
            Array.isArray(parsed?.perpendicularThroughPointIntersections) ? parsed.perpendicularThroughPointIntersections : [],
            Array.isArray(parsed?.tangentIntersections) ? parsed.tangentIntersections : [],
          ]) {
            for (const it of src) {
              if (!onThisLine(it)) continue;
              const ipt = getPoint(it.intersection);
              if (!ipt) continue;
              const proj = (ipt.x - at.x) * dx + (ipt.y - at.y) * dy;
              if (proj > len) len = proj + 16;
              if (proj < -negExtend) negExtend = -proj + 16;
            }
          }
          const key = `named:${rel.at}`;
          const line = ensureOverlayLine(key, "#475569");
          line.setAttribute("x1", String(at.x - dx * negExtend));
          line.setAttribute("y1", String(at.y - dy * negExtend));
          line.setAttribute("x2", String(at.x + dx * len));
          line.setAttribute("y2", String(at.y + dy * len));
          activeKeys.add(key);
          hiddenBaseKeys.add(undirectedKey(rel.at, rel.linePoint));

          // Keep the linePoint SVG dot in sync with the tangent endpoint so it stays
          // on the tangent line even when dragging C or O. The constraint graph handles
          // this too, but updateTangentOverlays fires on every update and is the safest place.
          if (linePoint) {
            const lpTargetX = at.x + dx * len;
            const lpTargetY = at.y + dy * len;
            if (Math.abs(linePoint.x - lpTargetX) > 0.5 || Math.abs(linePoint.y - lpTargetY) > 0.5) {
              linePoint.x = lpTargetX;
              linePoint.y = lpTargetY;
              linePoint.circle.setAttribute("cx", String(lpTargetX));
              linePoint.circle.setAttribute("cy", String(lpTargetY));
              linePoint.text.setAttribute("x", String(lpTargetX + 8));
              linePoint.text.setAttribute("y", String(lpTargetY - 8));
              for (const item of linePoint.lines) {
                if (item.end === 1) { item.line.setAttribute("x1", String(lpTargetX)); item.line.setAttribute("y1", String(lpTargetY)); }
                else { item.line.setAttribute("x2", String(lpTargetX)); item.line.setAttribute("y2", String(lpTargetY)); }
              }
            }
          }
        }

        for (const rel of Array.isArray(parsed?.tangentIntersections) ? parsed.tangentIntersections : []) {
          const at = getPoint(rel.at);
          const center = getPoint(rel.center || rel.centerId || "O") || getPoint("O");
          const inter = getPoint(rel.intersection);
          if (!at || !center) {
            continue;
          }
          const rvx = at.x - center.x;
          const rvy = at.y - center.y;
          const rlen = Math.sqrt(rvx * rvx + rvy * rvy) || 1;
          let dx = -rvy / rlen;
          let dy = rvx / rlen;
          const proj = inter ? (inter.x - at.x) * dx + (inter.y - at.y) * dy : 0;
          if (proj < 0) {
            dx = -dx;
            dy = -dy;
          }
          const len = inter ? Math.max(distance(at.x, at.y, inter.x, inter.y) + 24, 80) : 80;
          const key = `inter:${rel.at}:${rel.intersection}`;
          const line = ensureOverlayLine(key, "#334155");
          line.setAttribute("x1", String(at.x - dx * 16));
          line.setAttribute("y1", String(at.y - dy * 16));
          line.setAttribute("x2", String(at.x + dx * len));
          line.setAttribute("y2", String(at.y + dy * len));
          activeKeys.add(key);
          hiddenBaseKeys.add(undirectedKey(rel.at, rel.intersection));
        }

        for (const [key, line] of tangentOverlayByKey.entries()) {
          if (!activeKeys.has(key)) {
            line.remove();
            tangentOverlayByKey.delete(key);
          }
        }

        // Hide base segments that duplicate tangent overlays so users don't see double lines from D/C.
        for (const [key, elems] of lineElementsByUndirectedKey.entries()) {
          const hide = hiddenBaseKeys.has(key);
          for (const el of elems) {
            el.style.opacity = hide ? "0" : "1";
            el.style.pointerEvents = hide ? "none" : "auto";
          }
        }
      }

      let dragPoint = null;
      let dragCircle = null; // { cEl, centerPoint } — rim drag to resize
      let panStart = null;
      let isApplyingConstraints = false;
      let lockPointId = null;
      let staticGraphPrinted = false;

      function setCircleFromCenterAndAnchor(centerPoint, anchorPoint) {
        const cEl = circleByCenterId.get(centerPoint.id);
        if (!cEl) {
          return;
        }
        cEl.setAttribute("cx", String(centerPoint.x));
        cEl.setAttribute("cy", String(centerPoint.y));
        cEl.setAttribute("r", String(distance(centerPoint.x, centerPoint.y, anchorPoint.x, anchorPoint.y)));
      }

      function applyCircleConstraints(initialChangedIds = []) {
        if (isApplyingConstraints) {
          return;
        }
        isApplyingConstraints = true;
        const data = parsed || {};
        const circlesByDiameter = Array.isArray(data.circlesByDiameter) ? data.circlesByDiameter : [];
        const pointsOnCircles = Array.isArray(data.pointsOnCircles) ? data.pointsOnCircles : [];

        // Normalise high-level constructions into the primitive arrays read by buildConstraintGraph.
        // altitude {from, foot, baseA, baseB}  →  altitudeSynthetic (direct projection)
        // median   {from, foot, baseA, baseB}  →  midpoints + pointsOnSegments
        // bisector {from, foot, sideA, sideB}  →  bisectorSynthetic (direction-line intersection)
        const rawMidpoints     = Array.isArray(data.midpoints)          ? data.midpoints          : [];
        const rawPointsOnSegs  = Array.isArray(data.pointsOnSegments)   ? data.pointsOnSegments   : [];
        const rawPerpendiculars = Array.isArray(data.perpendiculars)    ? data.perpendiculars     : [];
        const rawEqualAngles   = Array.isArray(data.equalAngles)        ? data.equalAngles        : [];

        const altitudeSynthetic  = [];  // {from, foot, baseA, baseB} — foot computed via projection
        const medianSynthetic    = [];  // → midpoints
        const bisectorSynthetic  = [];  // → pointsOnSegments (treated as foot-of-bisector)

        const posKey = (p) => String(p || "").toUpperCase();
        const segKey = (a, b) => [posKey(a), posKey(b)].sort().join(":");

        for (const alt of (data.altitudes || [])) {
          // Collect for direct projection computation (section 4c below).
          altitudeSynthetic.push(alt);
        }

        for (const med of (data.medians || [])) {
          // M is midpoint of BC
          const alreadyMid = rawMidpoints.some((m) => posKey(m.point) === posKey(med.foot));
          if (!alreadyMid) {
            medianSynthetic.push({ point: med.foot, a: med.baseA, b: med.baseB });
          }
          // M on segment BC
          const alreadyOnSeg = rawPointsOnSegs.some(
            (r) => posKey(r.point) === posKey(med.foot) && segKey(r.a, r.b) === segKey(med.baseA, med.baseB)
          );
          if (!alreadyOnSeg) {
            rawPointsOnSegs.push({ point: med.foot, a: med.baseA, b: med.baseB });
          }
        }

        for (const bis of (data.angleBisectors || [])) {
          // K on segment sideA–sideB (treated as a foot-on-segment with bisector semantics)
          const alreadyOnSeg = rawPointsOnSegs.some(
            (r) => posKey(r.point) === posKey(bis.foot) && segKey(r.a, r.b) === segKey(bis.sideA, bis.sideB)
          );
          if (!alreadyOnSeg) {
            rawPointsOnSegs.push({ point: bis.foot, a: bis.sideA, b: bis.sideB });
          }
          bisectorSynthetic.push(bis);
        }

        const midpoints      = [...rawMidpoints, ...medianSynthetic];
        const pointsOnSegments = rawPointsOnSegs;
        const lineIntersections = Array.isArray(data.lineIntersections) ? data.lineIntersections : [];
        const centroids      = Array.isArray(data.centroids) ? data.centroids : [];
        const perpendiculars = rawPerpendiculars;
        const lineEntities = Array.isArray(data.lineEntities) ? data.lineEntities : [];
        const perpThroughInters = Array.isArray(data.perpendicularThroughPointIntersections)
          ? data.perpendicularThroughPointIntersections
          : [];
        const tangents = Array.isArray(data.tangents) ? data.tangents : [];
        const namedTangents = Array.isArray(data.namedTangents) ? data.namedTangents : [];
        const tangentIntersections = Array.isArray(data.tangentIntersections) ? data.tangentIntersections : [];
        const pointsOnCircleSet = new Set(pointsOnCircles.map((r) => String(r.point || "").toUpperCase()));
        const protectedPointIds = new Set();
        const EPS = 1e-3;
        const fullRecompute = Array.isArray(initialChangedIds) && initialChangedIds.length >= points.length;
        const seedIds = (Array.isArray(initialChangedIds) && initialChangedIds.length
          ? initialChangedIds
          : points.map((p) => p.id))
          .map((id) => String(id || "").toUpperCase())
          .filter(Boolean);
        let frontier = new Set(
          (fullRecompute ? [...driverPointIds] : seedIds)
            .map((id) => String(id || "").toUpperCase())
            .filter(Boolean)
        );
        let nextFrontier = new Set();

        function lineIntersection(a1, a2, b1, b2) {
          const den = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
          if (Math.abs(den) < 1e-9) {
            return null;
          }
          const px =
            ((a1.x * a2.y - a1.y * a2.x) * (b1.x - b2.x) - (a1.x - a2.x) * (b1.x * b2.y - b1.y * b2.x)) / den;
          const py =
            ((a1.x * a2.y - a1.y * a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x * b2.y - b1.y * b2.x)) / den;
          return { x: px, y: py };
        }

        const lineEntityById = new Map(
          lineEntities
            .filter((it) => it && it.id && it.a && it.b)
            .map((it) => [String(it.id).toUpperCase(), { a: String(it.a).toUpperCase(), b: String(it.b).toUpperCase() }])
        );
        const pointOnSegmentsByPoint = new Map();
        for (const rel of pointsOnSegments) {
          const key = String(rel?.point || "").toUpperCase();
          if (!key) {
            continue;
          }
          const list = pointOnSegmentsByPoint.get(key) || [];
          list.push(rel);
          pointOnSegmentsByPoint.set(key, list);
        }

        function asLineRef(lineOrId) {
          if (!lineOrId) {
            return null;
          }

          if (typeof lineOrId === "object" && lineOrId.a && lineOrId.b) {
            return { a: String(lineOrId.a).toUpperCase(), b: String(lineOrId.b).toUpperCase() };
          }

          const key = String(lineOrId).toUpperCase();
          if (lineEntityById.has(key)) {
            return lineEntityById.get(key);
          }

          // Fallback for compact names like "CD" or prefixed IDs like "line:CD".
          // Strip any type prefix first, then extract the two endpoint letters.
          // IMPORTANT: return "point:X" prefixed IDs so that addEdge() can find them in
          // pointById (which uses "POINT:X" keys). Bare-letter returns like {a:"A",b:"D"}
          // silently pass the addEdge guard check and produce an empty constraint graph.
          const rawName = key.includes(":") ? displayLabel(key).toUpperCase() : key;
          const compact = rawName.replace(/[^A-Z]/g, "");
          if (compact.length >= 2) {
            return { a: `point:${compact[0]}`, b: `point:${compact[1]}` };
          }

          return null;
        }

        // ── Directed constraint graph ─────────────────────────────────────────
        // Each constraint has a clear direction: parents → child.
        // When a parent changes, the child is recomputed AFTER all its parents
        // have settled (Kahn's topological sort ensures correct ordering).
        // This replaces the old undirected BFS + iterative convergence loop.

        function buildConstraintGraph() {
          const childrenOf = new Map(); // parentId → Set<childId>
          const computeOf  = new Map(); // derivedPointId → () => {x,y}|null
          const effects    = new Map(); // effectId → () => void  (virtual nodes, not real points)
          const norm  = (id) => String(id || "").toUpperCase();
          const addEdge = (parent, child) => {
            const p = norm(parent), c = norm(child);
            if (!p || !c || p === c) return;
            if (!pointById.has(p) || !pointById.has(c)) return;
            if (!childrenOf.has(p)) childrenOf.set(p, new Set());
            childrenOf.get(p).add(c);
          };
          // addEffectEdge: like addEdge but the child is a virtual effect node (not in pointById).
          const addEffectEdge = (parent, effectId) => {
            const p = norm(parent);
            if (!p || !pointById.has(p)) return;
            if (!childrenOf.has(p)) childrenOf.set(p, new Set());
            childrenOf.get(p).add(effectId);
          };

          // 1. Midpoints: M depends on A, B
          console.log("[graph:1] midpoints array:", midpoints.map(r => `${r.point}=mid(${r.a},${r.b})`));
          for (const rel of midpoints) {
            if (driverPointIds.has(norm(rel.point))) continue;
            addEdge(rel.a, rel.point);
            addEdge(rel.b, rel.point);
            const { a, b, point } = rel;
            console.log(`[graph:1] registered computeOf for ${norm(point)} = midpoint(${norm(a)}, ${norm(b)})`);
            computeOf.set(norm(point), () => {
              const pa = getPoint(a), pb = getPoint(b);
              const result = pa && pb ? { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } : null;
              console.log(`[midpoint CALLED] ${norm(point)} = midpoint(${norm(a)}, ${norm(b)})`,
                pa ? `${norm(a)}=(${pa.x.toFixed(1)},${pa.y.toFixed(1)})` : `${norm(a)}=MISSING`,
                pb ? `${norm(b)}=(${pb.x.toFixed(1)},${pb.y.toFixed(1)})` : `${norm(b)}=MISSING`,
                result ? `→ result=(${result.x.toFixed(1)},${result.y.toFixed(1)})` : "→ result=null (missing parents)");
              return result;
            });
          }

          // 2. CirclesByDiameter: direction depends on which point is locked/dragged
          for (const dc of circlesByDiameter) {
            const cId = dc.centerId || "O";
            const lockedCenter = lockPointId && sameId(lockPointId, cId);
            const lockedA = lockPointId && sameId(lockPointId, dc.a);
            const lockedB = lockPointId && sameId(lockPointId, dc.b);
            const { a, b } = dc;
            if (lockedCenter) {
              // O moved → B = 2*O - A
              addEdge(cId, b); addEdge(a, b);
              computeOf.set(norm(b), () => {
                const o = getPoint(cId), pa = getPoint(a);
                return o && pa ? { x: 2 * o.x - pa.x, y: 2 * o.y - pa.y } : null;
              });
            } else if (lockedA) {
              addEdge(a, b); addEdge(cId, b);
              computeOf.set(norm(b), () => {
                const o = getPoint(cId), pa = getPoint(a);
                return o && pa ? { x: 2 * o.x - pa.x, y: 2 * o.y - pa.y } : null;
              });
            } else if (lockedB) {
              addEdge(b, a); addEdge(cId, a);
              computeOf.set(norm(a), () => {
                const o = getPoint(cId), pb = getPoint(b);
                return o && pb ? { x: 2 * o.x - pb.x, y: 2 * o.y - pb.y } : null;
              });
            } else {
              // Default: O = midpoint(A, B)
              addEdge(a, cId); addEdge(b, cId);
              computeOf.set(norm(cId), () => {
                const pa = getPoint(a), pb = getPoint(b);
                return pa && pb ? { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } : null;
              });
            }
          }

          // 3. PointsOnCircles: constrained point depends on center + radius drivers.
          // NOTE: we do NOT skip driver points here — E is draggable but must still
          // snap back to the circle when O/C/D move. propagateFromSeeds skips seeds,
          // so when E itself is dragged nothing bad happens.
          //
          // IMPORTANT: diameter endpoints (C, D) are also added to pointsOnCircles by
          // enrichModelForV2. Do NOT register computeOf for them here — constraint 2
          // already owns their formula (D = 2*O - C). If we overwrite it here with the
          // generic "snap to circle along current OD direction" formula, dragging O stops
          // updating D correctly because the snap uses the old radius instead of reflecting
          // across O.
          const diameterEndpointNorms = new Set(
            circlesByDiameter.flatMap((dc) => [norm(dc.a), norm(dc.b)])
          );
          for (const rel of pointsOnCircles) {
            const { point, center } = rel;
            // Skip diameter endpoints entirely — their position is governed by constraint 2.
            // Adding edges O→C and D→C here would create cycles (C↔D↔C) that block
            // Kahn's topological sort and prevent ALL derived nodes from being recomputed.
            if (diameterEndpointNorms.has(norm(point))) continue;
            addEdge(rel.center, rel.point);
            for (const dc of circlesByDiameter) {
              if (!sameId(dc.centerId || "O", rel.center)) continue;
              addEdge(dc.a, rel.point);
              addEdge(dc.b, rel.point);
            }
            computeOf.set(norm(point), () => {
              const p = getPoint(point), ctr = getPoint(center);
              if (!p || !ctr) return null;
              const r = radiusFromDiameterCenterId(center) || circleRadiusByCenterId(center);
              if (!r) return null;
              const vx = p.x - ctr.x, vy = p.y - ctr.y;
              const len = Math.sqrt(vx * vx + vy * vy) || 1;
              return { x: ctr.x + (vx / len) * r, y: ctr.y + (vy / len) * r };
            });
          }

          // 4. PointsOnSegments: projection (foot) or line-line intersection
          // segmentConstraintOf points ARE in driverPointIds (draggable) but still need
          // a computeOf so they re-project when the parent segment endpoints move.
          // Skip points already handled by section 1 (midpoints) — their formula must
          // not be overwritten with a projectPointToLine here.
          for (const [pointId, rels] of pointOnSegmentsByPoint.entries()) {
            if (driverPointIds.has(pointId) && !segmentConstraintOf.has(pointId)) continue;
            if (computeOf.has(pointId)) {
              console.log(`[graph:4] SKIP ${pointId} — computeOf already registered (midpoint/bisector takes priority)`);
              continue; // already registered (e.g. midpoint from section 1)
            }
            if (rels.length === 1) {
              const rel = rels[0];
              addEdge(rel.a, pointId);
              addEdge(rel.b, pointId);
              const foot = findFootConstruction(pointId);
              if (foot) {
                addEdge(foot.sourceId, pointId);
                computeOf.set(pointId, () => {
                  const src = getPoint(foot.sourceId), a = getPoint(foot.baseA), b = getPoint(foot.baseB);
                  return src && a && b ? projectPointToLine(src, a, b) : null;
                });
              } else {
                const pId = pointId, r = rel;
                computeOf.set(pId, () => {
                  const p = getPoint(pId), a = getPoint(r.a), b = getPoint(r.b);
                  return p && a && b ? projectPointToLine(p, a, b) : null;
                });
              }
            } else if (rels.length >= 2) {
              const first = rels[0], second = rels[1];
              for (const id of [first.a, first.b, second.a, second.b]) addEdge(id, pointId);
              computeOf.set(pointId, () => {
                const a1 = getPoint(first.a), a2 = getPoint(first.b);
                const b1 = getPoint(second.a), b2 = getPoint(second.b);
                return a1 && a2 && b1 && b2 ? lineIntersection(a1, a2, b1, b2) : null;
              });
            }
          }

          // 4b. Bisector feet: direction-line intersection.
          // Direction: normalize(unit_V→A + unit_V→B) — bisector of angle AVB.
          // Foot D = intersection of ray(V, dir) with line(sideA, sideB).
          for (const bis of bisectorSynthetic) {
            const footN = norm(bis.foot);
            if (driverPointIds.has(footN)) continue;
            addEdge(bis.from,  footN);
            addEdge(bis.sideA, footN);
            addEdge(bis.sideB, footN);
            const { from, foot, sideA, sideB } = bis;
            computeOf.set(footN, () => {
              const pFrom = getPoint(from), pA = getPoint(sideA), pB = getPoint(sideB);
              if (!pFrom || !pA || !pB) return null;
              const uAx = pA.x - pFrom.x, uAy = pA.y - pFrom.y;
              const uBx = pB.x - pFrom.x, uBy = pB.y - pFrom.y;
              const lenA = Math.hypot(uAx, uAy), lenB = Math.hypot(uBx, uBy);
              if (lenA < 1e-9 || lenB < 1e-9) return null;
              // Bisector direction (sum of unit vectors — no need to normalize for intersection)
              const dx = uAx / lenA + uBx / lenB;
              const dy = uAy / lenA + uBy / lenB;
              // Ray(pFrom, dx, dy) ∩ Line(pA, pB)
              const den = dx * (pB.y - pA.y) - dy * (pB.x - pA.x);
              if (Math.abs(den) < 1e-9) return null;
              const t = ((pA.x - pFrom.x) * (pB.y - pA.y) - (pA.y - pFrom.y) * (pB.x - pA.x)) / den;
              return { x: pFrom.x + t * dx, y: pFrom.y + t * dy };
            });
          }

          // 4c. Altitude feet: direct orthogonal projection.
          // H = projectPointToLine(from, baseA, baseB).
          // Depends on: from + both base endpoints. No line rotation needed.
          for (const alt of altitudeSynthetic) {
            const footN = norm(alt.foot);
            if (driverPointIds.has(footN)) continue;
            addEdge(alt.from,  footN);
            addEdge(alt.baseA, footN);
            addEdge(alt.baseB, footN);
            const { from, foot, baseA, baseB } = alt;
            computeOf.set(footN, () => {
              const pFrom = getPoint(from), pA = getPoint(baseA), pB = getPoint(baseB);
              return pFrom && pA && pB ? projectPointToLine(pFrom, pA, pB) : null;
            });
          }

          // 5. LineIntersections: X depends on all four endpoints of the two lines.
          // addEdge always runs (maintains graph structure / collinearity awareness),
          // but computeOf is only registered if midpoint/bisector hasn't claimed it first —
          // e.g. M = intersection(AM, BC) is geometrically true but M is computed as
          // midpoint(B,C), not via lineIntersection.
          for (const rel of lineIntersections) {
            if (driverPointIds.has(norm(rel.point))) continue;
            const l1 = asLineRef(rel.line1), l2 = asLineRef(rel.line2);
            if (!l1 || !l2) continue;
            for (const id of [l1.a, l1.b, l2.a, l2.b]) addEdge(id, rel.point);
            if (computeOf.has(norm(rel.point))) continue; // midpoint/bisector owns the formula
            const { point } = rel;
            computeOf.set(norm(point), () => {
              const a1 = getPoint(l1.a), a2 = getPoint(l1.b);
              const b1 = getPoint(l2.a), b2 = getPoint(l2.b);
              return a1 && a2 && b1 && b2 ? lineIntersection(a1, a2, b1, b2) : null;
            });
          }

          // 6. PerpendicularThroughPointIntersections: I depends on through-point + both lines.
          // If withLine.b is not a visible SVG point (e.g. "X" in the named tangent Cx),
          // synthesize a direction point from the namedTangent geometry at withLine.a.
          for (const rel of perpThroughInters) {
            if (driverPointIds.has(norm(rel.intersection))) continue;
            for (const id of [rel.through, rel.toLine?.a, rel.toLine?.b, rel.withLine?.a, rel.withLine?.b]) {
              addEdge(id, rel.intersection);
            }
            const r = rel;
            computeOf.set(norm(rel.intersection), () => {
              const through = getPoint(r.through);
              const toA = getPoint(r.toLine?.a), toB = getPoint(r.toLine?.b);
              const w1 = getPoint(r.withLine?.a);
              let w2 = getPoint(r.withLine?.b);
              if (!w2 && w1) {
                // withLine.b not in SVG — synthesize from namedTangent direction at w1
                const nt = namedTangents.find((nt) =>
                  sameId(nt.at, r.withLine?.a) && sameId(nt.linePoint, r.withLine?.b)
                );
                if (nt) {
                  const ctr = getPoint(resolveCenterId(nt));
                  if (ctr) {
                    const rx = w1.x - ctr.x, ry = w1.y - ctr.y;
                    const rlen = Math.sqrt(rx * rx + ry * ry) || 1;
                    // Tangent at w1 is perpendicular to OC: direction = (-ry, rx) / rlen
                    w2 = { x: w1.x + (-ry / rlen) * 100, y: w1.y + (rx / rlen) * 100 };
                  }
                }
              }
              if (!through || !toA || !toB || !w1 || !w2) return null;
              const vx = toB.x - toA.x, vy = toB.y - toA.y;
              return lineIntersection(through, { x: through.x - vy, y: through.y + vx }, w1, w2);
            });
          }

          // 7. TangentIntersections: intersection depends on touch-point, center, and the other line
          for (const rel of tangentIntersections) {
            if (driverPointIds.has(norm(rel.intersection))) continue;
            const cId = resolveCenterId(rel);
            for (const id of [rel.at, cId, rel.withLine?.a, rel.withLine?.b]) addEdge(id, rel.intersection);
            const r = rel;
            computeOf.set(norm(rel.intersection), () => {
              const at = getPoint(r.at), center = getPoint(resolveCenterId(r));
              const w1 = getPoint(r.withLine?.a), w2 = getPoint(r.withLine?.b);
              if (!at || !center || !w1 || !w2) return null;
              const rvx = at.x - center.x, rvy = at.y - center.y;
              return lineIntersection(at, { x: at.x - rvy, y: at.y + rvx }, w1, w2);
            });
          }

          // 8. NamedTangents: linePoint depends on touch-point + center.
          // NOTE: the linePoint (e.g. X) may not exist as a visible SVG point — it is just a
          // label for the ray direction. We still register computeOf so downstream nodes
          // can use the synthesized tangent direction even if X itself has no SVG element.
          // IMPORTANT: direction is purely perpendicular to OC — do NOT use E or A here
          // (they're computed later in the topo order). Using them would give stale values.
          for (const rel of namedTangents) {
            if (driverPointIds.has(norm(rel.linePoint))) continue;
            const cId = resolveCenterId(rel);
            addEdge(rel.at, rel.linePoint);
            addEdge(cId, rel.linePoint);
            const r = rel;
            computeOf.set(norm(rel.linePoint), () => {
              const at = getPoint(r.at), center = getPoint(resolveCenterId(r));
              if (!at || !center) return null;
              // Tangent direction is fully determined by C and O — always perpendicular to OC.
              // Do NOT use the stale linePoint position for orientation: after C moves, the old X
              // is relative to the old C, making the prevDot check unreliable and causing X to
              // flip to the wrong side. The canonical direction is sufficient and stable.
              const dir = tangentDirection(at, center);
              const rv = radiusFromDiameterCenterId(resolveCenterId(r)) || circleRadiusByCenterId(resolveCenterId(r)) || 80;
              const len = Math.max(60, rv * 0.75);
              return { x: at.x + dir.x * len, y: at.y + dir.y * len };
            });
          }

          // 9. Perpendiculars: the non-locked endpoint of line2 depends on line1's direction
          for (const rel of perpendiculars) {
            const l1 = asLineRef(rel.line1), l2 = asLineRef(rel.line2);
            if (!l1 || !l2) continue;
            if (l2.b && displayLabel(String(l2.b)).startsWith("t_")) continue; // skip tangent helpers
            const l2bNorm = norm(l2.b);
            if (!l2bNorm || driverPointIds.has(l2bNorm)) continue;
            if (computeOf.has(l2bNorm)) continue; // higher-priority section (e.g. namedTangent) already owns this point
            if (lockPointId && sameId(lockPointId, l2.b)) continue;
            addEdge(l1.a, l2bNorm); addEdge(l1.b, l2bNorm); addEdge(l2.a, l2bNorm);
            computeOf.set(l2bNorm, () => {
              const p1 = getPoint(l1.a), p2 = getPoint(l1.b), q1 = getPoint(l2.a), q2 = getPoint(l2.b);
              if (!p1 || !p2 || !q1 || !q2) return null;
              const vx = p2.x - p1.x, vy = p2.y - p1.y;
              const llen = Math.sqrt(vx * vx + vy * vy) || 1;
              const perp = { x: -vy / llen, y: vx / llen };
              const keepLen = distance(q1.x, q1.y, q2.x, q2.y) || 80;
              return { x: q1.x + perp.x * keepLen, y: q1.y + perp.y * keepLen };
            });
          }

          // 10. Incircles: incenter K = weighted average of triangle vertices.
          // When any triangle vertex moves, K must be recomputed: K = (a*A + b*B + c*C) / (a+b+c)
          // where a=|BC|, b=|CA|, c=|AB| (side lengths opposite to vertices A,B,C).
          for (const ic of (Array.isArray(data.incircles) ? data.incircles : [])) {
            if (!ic.center || !ic.triangle) continue;
            const cNorm = norm(ic.center);
            if (computeOf.has(cNorm)) continue; // already owned
            const [vA, vB, vC] = ic.triangle;
            addEdge(vA, ic.center); addEdge(vB, ic.center); addEdge(vC, ic.center);
            computeOf.set(cNorm, () => {
              const pA = getPoint(vA), pB = getPoint(vB), pC = getPoint(vC);
              if (!pA || !pB || !pC) return null;
              const a = Math.hypot(pB.x - pC.x, pB.y - pC.y);
              const b = Math.hypot(pA.x - pC.x, pA.y - pC.y);
              const c = Math.hypot(pA.x - pB.x, pA.y - pB.y);
              const p = a + b + c || 1;
              return { x: (a * pA.x + b * pB.x + c * pC.x) / p, y: (a * pA.y + b * pB.y + c * pC.y) / p };
            });
          }

          // Post-processing: for each derived point that is an endpoint of a line
          // used in a lineIntersection, propagate its parents as parents of the intersection.
          // This ensures correct topo ordering: e.g. B,C → D (midpoint) → G (intersection AD∩BE)
          // without needing B,C → G edges explicitly at section 5 time.
          for (const rel of lineIntersections) {
            const gN = norm(rel.point);
            if (!computeOf.has(gN)) continue; // not owned by lineIntersection
            const l1 = asLineRef(rel.line1), l2 = asLineRef(rel.line2);
            if (!l1 || !l2) continue;
            for (const endpointId of [l1.a, l1.b, l2.a, l2.b]) {
              const eN = norm(endpointId);
              if (!computeOf.has(eN)) continue; // only derived endpoints need transitive edges
              // Add edge from every parent of eN to gN
              for (const [parent, children] of childrenOf.entries()) {
                if (children.has(eN)) addEdge(parent, gN);
              }
            }
          }

          // 11. Angle-arc equality markers: each EqualAngle pair gets an effect node
          //     that re-renders its two arc marks when any of the 3 defining points change.
          //     Effect nodes are virtual (not in pointById) — processed via effects map.
          (function registerArcEffects() {
            const angleMarks = Array.isArray(data.angleMarks) ? data.angleMarks : [];
            if (!angleMarks.length) return;
            let arcGroup = svg.querySelector('g[data-constraint="equal-angle"]');
            if (!arcGroup) {
              arcGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
              arcGroup.setAttribute("data-constraint", "equal-angle");
              svg.appendChild(arcGroup);
            }

            // Build group → ordinal map so equal-angle pairs share tick count.
            const groupOrdinals = new Map();
            for (const mark of angleMarks) {
              const g = mark.group;
              if (g !== undefined && !groupOrdinals.has(g)) groupOrdinals.set(g, groupOrdinals.size);
            }

            function normVec2(dx, dy) {
              const len = Math.hypot(dx, dy);
              return len < 1e-9 ? [0, 0] : [dx / len, dy / len];
            }

            // Render arc + ticks for one angle mark (vx/vy = vertex, px/py and qx/qy = arm ends).
            // tickCount: 1 = single arc, 2 = double arc, 3 = triple arc (extra arcs offset by 4px).
            function arcMarkSvg(vx, vy, px, py, qx, qy, tickCount) {
              const ARC_R = 22, TICK_L = 5, ARC_STEP = 4;
              const [dpx, dpy] = normVec2(px - vx, py - vy);
              const [dqx, dqy] = normVec2(qx - vx, qy - vy);
              if ((dpx === 0 && dpy === 0) || (dqx === 0 && dqy === 0)) return "";
              const cross = dpx * dqy - dpy * dqx;
              if (Math.abs(cross) < 1e-6) return "";
              const sweep = cross > 0 ? 1 : 0;
              let [dbx, dby] = normVec2(dpx + dqx, dpy + dqy);
              if (dbx === 0 && dby === 0) { dbx = -dpy; dby = dpx; }
              const pwx = -dby, pwy = dbx;
              let out = "";
              for (let t = 0; t < tickCount; t++) {
                const r = ARC_R + t * ARC_STEP;
                const sx = (vx + r * dpx).toFixed(1), sy = (vy + r * dpy).toFixed(1);
                const ex = (vx + r * dqx).toFixed(1), ey = (vy + r * dqy).toFixed(1);
                out += `<path d="M ${sx} ${sy} A ${r} ${r} 0 0 ${sweep} ${ex} ${ey}" fill="none" stroke="#1f2937" stroke-width="1.2"/>`;
              }
              const r0 = ARC_R + Math.floor(tickCount / 2) * ARC_STEP;
              const mx = vx + r0 * dbx, my = vy + r0 * dby;
              out += `<line x1="${(mx - TICK_L * pwx).toFixed(1)}" y1="${(my - TICK_L * pwy).toFixed(1)}" x2="${(mx + TICK_L * pwx).toFixed(1)}" y2="${(my + TICK_L * pwy).toFixed(1)}" stroke="#1f2937" stroke-width="1.2"/>`;
              return out;
            }

            // One effect node per AngleMark. Depends on its 3 points [P, vertex, Q].
            function renderMark(mark, idx) {
              const lk = (id) => { const p = getPoint(id); return p ? [p.x, p.y] : null; };
              const [pid, vid, qid] = mark.points;
              const [pm, vm, qm] = [lk(pid), lk(vid), lk(qid)];
              const ticks = (mark.group !== undefined ? (groupOrdinals.get(mark.group) ?? 0) : 0) + 1;
              return pm && vm && qm ? arcMarkSvg(vm[0], vm[1], pm[0], pm[1], qm[0], qm[1], ticks) : "";
            }

            angleMarks.forEach((mark, idx) => {
              const effectId = `__arc_${idx}__`;
              const [pid, vid, qid] = mark.points;
              for (const pt of [pid, vid, qid]) addEffectEdge(pt, effectId);

              effects.set(effectId, () => {
                let el = arcGroup.querySelector(`[data-arc-idx="${idx}"]`);
                if (!el) {
                  el = document.createElementNS("http://www.w3.org/2000/svg", "g");
                  el.setAttribute("data-arc-idx", String(idx));
                  arcGroup.appendChild(el);
                }
                el.innerHTML = renderMark(mark, idx);
              });
            });

            // Initial draw with current point positions.
            arcGroup.innerHTML = angleMarks.map((mark, idx) =>
              `<g data-arc-idx="${idx}">${renderMark(mark, idx)}</g>`
            ).join("");
          })();

          // 12. Right-angle box marks: one effect node per perpendicular junction.
          //     Sources: altitudes (foot), perpendicularThroughPointIntersections (intersection).
          //     Effect re-draws the small square corner symbol whenever any of the 3 points moves.
          (function registerRightAngleEffects() {
            const raMarks = Array.isArray(data.rightAngleMarks) ? data.rightAngleMarks : [];
            if (!raMarks.length) return;

            // Build line lookup: canonical key "A:B" → { a, b } from lineEntities.
            const lineByKey = new Map();
            for (const le of (Array.isArray(data.lineEntities) ? data.lineEntities : [])) {
              const key = [le.a, le.b].sort().join(":");
              lineByKey.set(key, le);
            }

            const BOX_SIZE = 12;
            function normVec2RA(dx, dy) {
              const len = Math.hypot(dx, dy);
              return len < 1e-9 ? [0, 0] : [dx / len, dy / len];
            }

            // Given a line { a, b } and a vertex point ID, return the endpoint ID
            // that gives the best (longest) direction vector away from the vertex.
            // When the vertex IS one of the endpoints, return the other endpoint.
            // When the vertex is an interior foot (e.g. altitude foot E on line AC),
            // return the FARTHER endpoint so the direction is never near-zero.
            function rayEndpoint(line, vertexId) {
              if (line.a === vertexId) return line.b;
              if (line.b === vertexId) return line.a;
              const V = getPoint(vertexId);
              const pA = getPoint(line.a), pB = getPoint(line.b);
              if (!V || !pA || !pB) return line.a;
              const dA = Math.hypot(pA.x - V.x, pA.y - V.y);
              const dB = Math.hypot(pB.x - V.x, pB.y - V.y);
              return dA >= dB ? line.a : line.b;
            }

            function rightAnglePathSvg(vx, vy, px, py, qx, qy, size) {
              const sz = size ?? BOX_SIZE;
              const [d1x, d1y] = normVec2RA(px - vx, py - vy);
              const [d2x, d2y] = normVec2RA(qx - vx, qy - vy);
              if ((d1x === 0 && d1y === 0) || (d2x === 0 && d2y === 0)) return "";
              const x1 = (vx + sz * d1x).toFixed(1), y1 = (vy + sz * d1y).toFixed(1);
              const xc = (vx + sz * d1x + sz * d2x).toFixed(1);
              const yc = (vy + sz * d1y + sz * d2y).toFixed(1);
              const x2 = (vx + sz * d2x).toFixed(1), y2 = (vy + sz * d2y).toFixed(1);
              return `<path d="M ${x1} ${y1} L ${xc} ${yc} L ${x2} ${y2}" fill="none" stroke="#1f2937" stroke-width="1.2"/>`;
            }

            function renderMark(mark) {
              const lk = (id) => { const p = getPoint(id); return p ? [p.x, p.y] : null; };
              const line1 = lineByKey.get(mark.line1Id);
              const line2 = lineByKey.get(mark.line2Id);
              if (!line1 || !line2) return "";
              const V = lk(mark.pointId);
              const P = lk(rayEndpoint(line1, mark.pointId));
              const Q = lk(rayEndpoint(line2, mark.pointId));
              return (V && P && Q) ? rightAnglePathSvg(V[0], V[1], P[0], P[1], Q[0], Q[1], mark.size) : "";
            }

            let raGroup = svg.querySelector('g[data-constraint="right-angle"]');
            if (!raGroup) {
              raGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
              raGroup.setAttribute("data-constraint", "right-angle");
              svg.appendChild(raGroup);
            }

            raMarks.forEach((mark, idx) => {
              const effectId = `__ra_${idx}__`;
              // Watch: vertex + both endpoints of each line.
              const line1 = lineByKey.get(mark.line1Id);
              const line2 = lineByKey.get(mark.line2Id);
              const involved = [mark.pointId,
                ...(line1 ? [line1.a, line1.b] : []),
                ...(line2 ? [line2.a, line2.b] : [])
              ].filter(Boolean);
              for (const pt of new Set(involved)) addEffectEdge(pt, effectId);

              effects.set(effectId, () => {
                let el = raGroup.querySelector(`[data-ra-idx="${idx}"]`);
                if (!el) {
                  el = document.createElementNS("http://www.w3.org/2000/svg", "g");
                  el.setAttribute("data-ra-idx", String(idx));
                  raGroup.appendChild(el);
                }
                el.innerHTML = renderMark(mark);
              });
            });

            // Initial draw with current point positions.
            raGroup.innerHTML = raMarks.map((mark, idx) =>
              `<g data-ra-idx="${idx}">${renderMark(mark)}</g>`
            ).join("");
          })();

          // 13. Segment equality tick marks.
          (function registerSegmentMarkEffects() {
            const segMarks = Array.isArray(data.segmentMarks) ? data.segmentMarks : [];
            if (!segMarks.length) return;

            // Group → ordinal so same-group segments share tick count.
            const groupOrdinals = new Map();
            for (const m of segMarks) {
              if (m.group !== undefined && !groupOrdinals.has(m.group)) {
                groupOrdinals.set(m.group, groupOrdinals.size);
              }
            }

            const TICK_L = 5, TICK_SP = 4;

            function norm2(dx, dy) {
              const len = Math.hypot(dx, dy);
              return len < 1e-9 ? [0, 0] : [dx / len, dy / len];
            }

            function ticksSvg(ax, ay, bx, by, tickCount) {
              const mx = (ax + bx) / 2, my = (ay + by) / 2;
              const [dx, dy] = norm2(bx - ax, by - ay);
              if (dx === 0 && dy === 0) return "";
              const [px, py] = [-dy, dx]; // perpendicular
              const offsets = [];
              if (tickCount === 1) offsets.push(0);
              else if (tickCount === 2) offsets.push(-TICK_SP / 2, TICK_SP / 2);
              else for (let i = 0; i < tickCount; i++) offsets.push((i - (tickCount - 1) / 2) * TICK_SP);
              return offsets.map(off => {
                const cx = mx + off * dx, cy = my + off * dy;
                return `<line x1="${(cx - TICK_L * px).toFixed(1)}" y1="${(cy - TICK_L * py).toFixed(1)}" ` +
                  `x2="${(cx + TICK_L * px).toFixed(1)}" y2="${(cy + TICK_L * py).toFixed(1)}" ` +
                  `stroke="#1f2937" stroke-width="1.2"/>`;
              }).join("");
            }

            function renderSegMark(mark) {
              const lk = (id) => { const p = getPoint(id); return p ? [p.x, p.y] : null; };
              const A = lk(mark.a), B = lk(mark.b);
              const ticks = (mark.group !== undefined ? (groupOrdinals.get(mark.group) ?? 0) : 0) + 1;
              return (A && B) ? ticksSvg(A[0], A[1], B[0], B[1], ticks) : "";
            }

            let segMarkGroup = svg.querySelector('g[data-constraint="equal-length"]');
            if (!segMarkGroup) {
              segMarkGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
              segMarkGroup.setAttribute("data-constraint", "equal-length");
              svg.appendChild(segMarkGroup);
            }

            segMarks.forEach((mark, idx) => {
              const effectId = `__sm_${idx}__`;
              for (const pt of [mark.a, mark.b]) addEffectEdge(pt, effectId);
              effects.set(effectId, () => {
                let el = segMarkGroup.querySelector(`[data-sm-idx="${idx}"]`);
                if (!el) {
                  el = document.createElementNS("http://www.w3.org/2000/svg", "g");
                  el.setAttribute("data-sm-idx", String(idx));
                  segMarkGroup.appendChild(el);
                }
                el.innerHTML = renderSegMark(mark);
              });
            });

            // Initial draw.
            segMarkGroup.innerHTML = segMarks.map((mark, idx) =>
              `<g data-sm-idx="${idx}">${renderSegMark(mark)}</g>`
            ).join("");
          })();

          // Print static dependency graph on first call (before any drag).
          if (!staticGraphPrinted && liveGraphPre) {
            staticGraphPrinted = true;
            const allParents = [...childrenOf.keys()];
            const allChildren = [...new Set([...childrenOf.values()].flatMap(s => [...s]))];
            const freePoints = allParents.filter(p => !computeOf.has(p) && !effects.has(p));
            const derivedPoints = allChildren.filter(p => computeOf.has(p));
            const effectNodes = allChildren.filter(p => effects.has(p));
            const edgeLines = [];
            for (const [par, chSet] of childrenOf.entries()) {
              for (const ch of chSet) {
                const kind = computeOf.has(ch) ? "point" : effects.has(ch) ? "effect" : "?";
                edgeLines.push(`  ${par} [${computeOf.has(par) ? "derived" : effects.has(par) ? "effect" : "free"}] → ${ch} [${kind}]`);
              }
            }
            liveGraphPre.textContent = [
              `=== Dependency Graph (static) ===`,
              ``,
              `Free: [${freePoints.join(", ") || "none"}]`,
              `Derived: [${derivedPoints.join(", ") || "none"}]`,
              `Effects: [${effectNodes.join(", ") || "none"}]`,
              ``,
              `Edges (parent → child):`,
              ...(edgeLines.length ? edgeLines : ["  (none)"]),
              ``,
              `computeOf: [${[...computeOf.keys()].join(", ") || "none"}]`,
              `effects:   [${[...effects.keys()].join(", ") || "none"}]`,
            ].join("\n");
          }

          return { childrenOf, computeOf, effects };
        }

        // Topological propagation from seed points using Kahn's algorithm.
        // Guarantees each derived point is computed exactly once, after ALL its
        // parents have their new positions — no iteration needed.
        function propagateFromSeeds(seedIds) {
          const { childrenOf, computeOf, effects } = buildConstraintGraph();
          const norm = (id) => String(id || "").toUpperCase();

          // BFS to find all reachable derived nodes from seeds (forward reachability).
          const reachable = new Set();
          const queue = [];
          for (const id of seedIds) {
            const k = norm(id);
            if (!k || reachable.has(k)) continue;
            reachable.add(k);
            queue.push(k);
          }
          for (let qi = 0; qi < queue.length; qi++) {
            for (const ch of (childrenOf.get(queue[qi]) || [])) {
              if (!reachable.has(ch)) { reachable.add(ch); queue.push(ch); }
            }
          }

          // Expand reachable: pull in any derived POINT whose output feeds a reachable node.
          // Effect nodes are deliberately excluded (they only consume, never produce points).
          let expanded = true;
          while (expanded) {
            expanded = false;
            for (const [parent, children] of childrenOf.entries()) {
              if (!computeOf.has(parent)) continue; // only pull in derived points, not effects
              if (reachable.has(parent)) continue;
              for (const ch of children) {
                if (reachable.has(ch)) {
                  reachable.add(parent);
                  expanded = true;
                  break;
                }
              }
            }
          }

          // Compute in-degree of each reachable node within the reachable subgraph
          const inDeg = new Map();
          for (const id of reachable) inDeg.set(id, 0);
          for (const id of reachable) {
            for (const ch of (childrenOf.get(id) || [])) {
              if (reachable.has(ch)) inDeg.set(ch, inDeg.get(ch) + 1);
            }
          }

          // Kahn's algorithm: process nodes layer by layer (F0, F1, F2, ...)
          const seeds = new Set(seedIds.map(norm));
          const topoQueue = [];
          for (const [id, deg] of inDeg.entries()) {
            if (deg === 0) topoQueue.push(id);
          }

          // Build layers via Kahn's algorithm
          const layerMap = new Map();
          for (const id of topoQueue) layerMap.set(id, 0);

          let processed = 0;
          while (processed < topoQueue.length) {
            const id = topoQueue[processed++];
            const myLayer = layerMap.get(id) || 0;
            for (const ch of (childrenOf.get(id) || [])) {
              if (!reachable.has(ch)) continue;
              const newDeg = inDeg.get(ch) - 1;
              inDeg.set(ch, newDeg);
              layerMap.set(ch, Math.max(layerMap.get(ch) || 0, myLayer + 1));
              if (newDeg === 0) topoQueue.push(ch);
            }
          }

          // Collect layers
          const layers = [];
          for (const [id, layer] of layerMap.entries()) {
            if (seeds.has(id)) continue;
            while (layers.length <= layer) layers.push([]);
            layers[layer].push(id);
          }
          const layerLog = layers
            .filter(l => l.length > 0)
            .map((l, i) => `F${i + 1}=[${l.join(",")}]`)
            .join(" ");
          if (layerLog) console.log("[GRAPH] seed=[" + [...seeds].join(",") + "] " + layerLog);

          // Compute derived points / fire render effects in topological order.
          // Seed nodes are already at their new positions — skip them.
          const computeResults = [];
          for (const id of topoQueue) {
            if (seeds.has(id)) continue;

            // Virtual effect node (e.g. angle-arc re-render): fire and continue.
            if (effects.has(id)) {
              effects.get(id)();
              computeResults.push(`  ${id}: effect fired`);
              continue;
            }

            const fn = computeOf.get(id);
            if (!fn) {
              computeResults.push(`  ${id}: NO computeOf registered`);
              console.log(`[compute] ${id}: NO computeOf — topoQueue has it but map missing key`);
              continue;
            }
            console.log(`[compute] calling fn for ${id} (pointById has it: ${!!pointById.get(id)})`);
            const result = fn();
            if (!result) {
              computeResults.push(`  ${id}: computeOf returned null (missing parents?)`);
              console.log(`[compute] ${id}: fn() returned null`);
              continue;
            }
            const p = getPoint(id);
            if (!p) {
              computeResults.push(`  ${id}: point not found in SVG`);
              console.log(`[compute] ${id}: getPoint returned null`);
              continue;
            }
            const moved = distance(p.x, p.y, result.x, result.y) >= EPS;
            console.log(`[compute] ${id}: current=(${p.x.toFixed(1)},${p.y.toFixed(1)}) result=(${result.x.toFixed(1)},${result.y.toFixed(1)}) moved=${moved}`);
            computeResults.push(`  ${id}: (${result.x.toFixed(1)}, ${result.y.toFixed(1)})${moved ? " ← updated" : " (no change)"}`);
            if (moved) updatePoint(p, result.x, result.y, true);
          }

          if (liveGraphPre) {
            const edgeLines = [];
            for (const [parent, children] of childrenOf.entries()) {
              for (const ch of children) {
                const kind = computeOf.has(ch) ? "point" : effects.has(ch) ? "effect" : "?";
                edgeLines.push(`  ${parent} → ${ch}  [${kind}]`);
              }
            }
            const lines = [
              `=== Dependency Graph (drag: seed=[${[...seeds].join(", ")}]) ===${layerLog ? "  " + layerLog : ""}`,
              "",
              `Edges (parent → child  [type]):`,
              ...(edgeLines.length ? edgeLines : ["  (none)"]),
              "",
              `computeOf: [${[...computeOf.keys()].join(", ")}]`,
              `effects:   [${[...effects.keys()].join(", ")}]`,
              "",
              `Compute results:`,
              ...(computeResults.length ? computeResults : ["  (no derived nodes reachable]"]),
            ];
            liveGraphPre.textContent = lines.join("\n");
          }

          // Refresh circle SVG attributes and incircle centers after propagation.
          // (Arc markers are now handled entirely by effect nodes in the graph above.)
          for (const dc of circlesByDiameter) {
            const center = getPoint(dc.centerId || "O");
            const anchor = getPoint(dc.a) || getPoint(dc.b);
            if (center && anchor) setCircleFromCenterAndAnchor(center, anchor);
          }
          for (const rel of pointsOnCircles) {
            const center = getPoint(rel.center);
            if (!center) continue;
            const cEl = circleByCenterId.get(center.id);
            if (cEl) { cEl.setAttribute("cx", String(center.x)); cEl.setAttribute("cy", String(center.y)); }
          }
          // Refresh incircles: recompute center position + inradius from triangle vertices
          for (const ic of (Array.isArray(data.incircles) ? data.incircles : [])) {
            if (!ic.center || !ic.triangle) continue;
            const [vA, vB, vC] = ic.triangle;
            const pA = getPoint(vA), pB = getPoint(vB), pC = getPoint(vC);
            const center = getPoint(ic.center);
            if (!pA || !pB || !pC || !center) continue;
            const cEl = circleByCenterId.get(center.id);
            if (!cEl) continue;
            const a = Math.hypot(pB.x - pC.x, pB.y - pC.y);
            const b = Math.hypot(pA.x - pC.x, pA.y - pC.y);
            const c = Math.hypot(pA.x - pB.x, pA.y - pB.y);
            const perim = a + b + c || 1;
            const area2 = Math.abs((pB.x - pA.x) * (pC.y - pA.y) - (pB.y - pA.y) * (pC.x - pA.x));
            const inradius = Math.max(area2 / perim, 1);
            cEl.setAttribute("cx", String(center.x));
            cEl.setAttribute("cy", String(center.y));
            cEl.setAttribute("r", String(inradius));
          }
        }

        if (!fullRecompute) {
          propagateFromSeeds(seedIds);
          isApplyingConstraints = false;
          updateTangentOverlays();
          return;
        }

        function projectPointToLine(p, a, b) {
          const vx = b.x - a.x;
          const vy = b.y - a.y;
          const len2 = vx * vx + vy * vy || 1;
          const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
          return { x: a.x + t * vx, y: a.y + t * vy };
        }

        function findFootConstruction(pointId) {
          const rels = pointOnSegmentsByPoint.get(String(pointId || "").toUpperCase()) || [];
          if (rels.length !== 1) {
            return null;
          }
          const onSeg = rels[0];
          const baseA = String(onSeg.a || "").toUpperCase();
          const baseB = String(onSeg.b || "").toUpperCase();

          for (const rel of perpendiculars) {
            const l1 = asLineRef(rel.line1);
            const l2 = asLineRef(rel.line2);
            if (!l1 || !l2) {
              continue;
            }
            const pointKey = String(pointId || "").toUpperCase();

            const l1MatchesBase = (l1.a === baseA && l1.b === baseB) || (l1.a === baseB && l1.b === baseA);
            const l2MatchesBase = (l2.a === baseA && l2.b === baseB) || (l2.a === baseB && l2.b === baseA);

            if (l1MatchesBase && (l2.a === pointKey || l2.b === pointKey)) {
              const sourceId = l2.a === pointKey ? l2.b : l2.a;
              return { sourceId, baseA, baseB };
            }

            if (l2MatchesBase && (l1.a === pointKey || l1.b === pointKey)) {
              const sourceId = l1.a === pointKey ? l1.b : l1.a;
              return { sourceId, baseA, baseB };
            }
          }

          return null;
        }

        function isDeterministicDerivedPoint(pointId) {
          const pid = String(pointId || "").toUpperCase();
          if (!pid) {
            return false;
          }
          if (midpoints.some((rel) => String(rel?.point || "").toUpperCase() === pid)) {
            return true;
          }
          if (lineIntersections.some((rel) => String(rel?.point || "").toUpperCase() === pid)) {
            return true;
          }
          if (perpThroughInters.some((rel) => String(rel?.intersection || "").toUpperCase() === pid)) {
            return true;
          }
          if (tangentIntersections.some((rel) => String(rel?.intersection || "").toUpperCase() === pid)) {
            return true;
          }
          if (namedTangents.some((rel) => String(rel?.linePoint || "").toUpperCase() === pid)) {
            return true;
          }
          if (bisectorSynthetic.some((rel) => String(rel?.foot || "").toUpperCase() === pid)) {
            return true;
          }
          if (altitudeSynthetic.some((rel) => String(rel?.foot || "").toUpperCase() === pid)) {
            return true;
          }
          const segRels = pointOnSegmentsByPoint.get(pid) || [];
          if (segRels.length >= 2) {
            return true;
          }
          return Boolean(findFootConstruction(pid));
        }

        function setDependentPoint(p, x, y) {
          if (!p) {
            return false;
          }
          const pId = String(p.id || "").toUpperCase();
          if (protectedPointIds.has(pId)) {
            return false;
          }
          if (lockPointId && String(p.id || "").toUpperCase() === String(lockPointId).toUpperCase()) {
            return false;
          }
          if (distance(p.x, p.y, x, y) < EPS) {
            return false;
          }
          updatePoint(p, x, y, true);
          nextFrontier.add(String(p.id || "").toUpperCase());
          return true;
        }

        function seedDerivedPoint(p, x, y) {
          if (!p) {
            return false;
          }
          const pId = String(p.id || "").toUpperCase();
          if (protectedPointIds.has(pId)) {
            return false;
          }
          if (lockPointId && pId === String(lockPointId).toUpperCase()) {
            return false;
          }
          if (distance(p.x, p.y, x, y) < EPS) {
            return false;
          }
          updatePoint(p, x, y, true);
          frontier.add(pId);
          return true;
        }

        function hasAnyChanged(ids) {
          for (const id of ids) {
            if (!id) {
              continue;
            }
            if (frontier.has(String(id).toUpperCase())) {
              return true;
            }
          }
          return false;
        }

        function hasRadiusDriverChanged(centerId) {
          const cid = String(centerId || "").toUpperCase();
          if (!cid) {
            return false;
          }
          for (const dc of circlesByDiameter) {
            const dcCenterId = String(dc.centerId || "O").toUpperCase();
            if (dcCenterId !== cid) {
              continue;
            }
            if (hasAnyChanged([dc.a, dc.b, dc.centerId || "O"])) {
              return true;
            }
          }
          return false;
        }

        function resolveCenterId(rel) {
          return rel.center || rel.centerId || rel.circleCenter || circlesByDiameter[0]?.centerId || "O";
        }

        function tangentTouchId(rel) {
          return rel?.at || rel?.pointId || rel?.point || null;
        }

        function centerKey(centerId) {
          return String(centerId || "").toUpperCase();
        }

        function circleRadiusByCenterId(centerId) {
          const p = getPoint(centerId);
          if (!p) {
            return 0;
          }
          const cEl = circleByCenterId.get(p.id);
          if (!cEl) {
            return 0;
          }
          return parseNumber(cEl.getAttribute("r"), 0);
        }

        function radiusFromDiameterCenterId(centerId) {
          const center = getPoint(centerId);
          if (!center) {
            return 0;
          }
          for (const dc of circlesByDiameter) {
            const cid = dc.centerId || "O";
            if (!sameId(cid, centerId)) {
              continue;
            }
            const a = getPoint(dc.a);
            const b = getPoint(dc.b);
            if (a) {
              return distance(center.x, center.y, a.x, a.y);
            }
            if (b) {
              return distance(center.x, center.y, b.x, b.y);
            }
          }
          return 0;
        }

        function sameId(a, b) {
          return String(a || "").toUpperCase() === String(b || "").toUpperCase();
        }

        // If user drags a point constrained on a circle (e.g., E), keep the diameter skeleton fixed
        // so propagation updates dependent constructions instead of drifting the whole figure.
        const lockId = String(lockPointId || "").toUpperCase();
        if (lockId) {
          for (const rel of pointsOnCircles) {
            const pId = String(rel.point || "").toUpperCase();
            if (pId !== lockId) {
              continue;
            }
            const centerId = String(rel.center || "O").toUpperCase();
            let lockIsDiameterEndpoint = false;
            for (const dc of circlesByDiameter) {
              const dcCenterId = String(dc.centerId || "O").toUpperCase();
              if (dcCenterId !== centerId) {
                continue;
              }

              const aId = String(dc.a || "").toUpperCase();
              const bId = String(dc.b || "").toUpperCase();
              if (lockId === aId || lockId === bId) {
                lockIsDiameterEndpoint = true;
              }

              // For non-diameter circle points (e.g. E), keep diameter skeleton fixed.
              if (!lockIsDiameterEndpoint) {
                if (aId) {
                  protectedPointIds.add(aId);
                }
                if (bId) {
                  protectedPointIds.add(bId);
                }
              }
            }

            // Always keep center fixed while dragging any point on its circle.
            if (centerId) {
              protectedPointIds.add(centerId);
            }
          }
        }

        function resolveTangentEndpoint(atPoint, preferredId, centerId) {
          if (!atPoint) {
            return null;
          }

          const byName = getPoint(preferredId);
          if (byName) {
            return byName;
          }

          // Fallback when parser naming differs: pick a non-radius endpoint connected to touch point.
          for (const link of atPoint.lines) {
            const other = link.other;
            if (!other) {
              continue;
            }
            if (sameId(other.id, centerId)) {
              continue;
            }
            if (!pointsOnCircleSet.has(String(other.id || "").toUpperCase())) {
              return other;
            }
          }

          for (const link of atPoint.lines) {
            const other = link.other;
            if (other && !sameId(other.id, centerId)) {
              return other;
            }
          }
          return null;
        }

        function tangentDirection(at, center) {
          const rvx = at.x - center.x;
          const rvy = at.y - center.y;
          const rlen = Math.sqrt(rvx * rvx + rvy * rvy) || 1;
          return { x: -rvy / rlen, y: rvx / rlen };
        }

        function orientNamedTangentDirection(rel, centerId) {
          const at = getPoint(rel?.at);
          const center = getPoint(centerId);
          if (!at || !center) {
            return null;
          }

          let dir = tangentDirection(at, center);
          const target = perpThroughInters.find((it) => {
            const sameForward = String(it?.withLine?.a || "").toUpperCase() === String(rel?.at || "").toUpperCase()
              && String(it?.withLine?.b || "").toUpperCase() === String(rel?.linePoint || "").toUpperCase();
            const sameReverse = String(it?.withLine?.a || "").toUpperCase() === String(rel?.linePoint || "").toUpperCase()
              && String(it?.withLine?.b || "").toUpperCase() === String(rel?.at || "").toUpperCase();
            return sameForward || sameReverse;
          });

          if (!target) {
            return dir;
          }

          const through = getPoint(target.through);
          const toA = getPoint(target.toLine?.a);
          const toB = getPoint(target.toLine?.b);
          if (!through || !toA || !toB) {
            return dir;
          }

          const vx = toB.x - toA.x;
          const vy = toB.y - toA.y;
          const perpEnd = { x: through.x - vy, y: through.y + vx };
          const tangentEnd = { x: at.x + dir.x, y: at.y + dir.y };
          const hit = lineIntersection(at, tangentEnd, through, perpEnd);
          if (!hit) {
            return dir;
          }

          const dot = (hit.x - at.x) * dir.x + (hit.y - at.y) * dir.y;
          if (dot < 0) {
            dir = { x: -dir.x, y: -dir.y };
          }
          return dir;
        }

        function moveEndpointAlongTangent(at, center, endpoint) {
          if (!at || !center || !endpoint) {
            return;
          }
          const dir = tangentDirection(at, center);
          const keepLen = distance(endpoint.x, endpoint.y, at.x, at.y) || 80;
          setDependentPoint(endpoint, at.x + dir.x * keepLen, at.y + dir.y * keepLen);
        }

        function namedTangentLength(centerId, atId) {
          const r = radiusFromDiameterCenterId(centerId) || circleRadiusByCenterId(centerId) || 80;
          const at = getPoint(atId);
          if (!at) {
            return Math.max(60, r * 0.75);
          }
          const relatedIntersections = perpThroughInters.filter((it) =>
            String(it.withLine?.a || "").toUpperCase() === String(atId).toUpperCase() ||
            String(it.withLine?.b || "").toUpperCase() === String(atId).toUpperCase()
          );
          for (const rel of relatedIntersections) {
            const inter = getPoint(rel.intersection);
            if (inter) {
              return Math.max(distance(at.x, at.y, inter.x, inter.y) * 1.25, Math.max(60, r * 0.75));
            }
          }
          return Math.max(60, r * 0.75);
        }

        function enforcePerpendicular(line1, line2) {
          const p1 = getPoint(line1?.a);
          const p2 = getPoint(line1?.b);
          const q1 = getPoint(line2?.a);
          const q2 = getPoint(line2?.b);
          if (!p1 || !p2 || !q1 || !q2) {
            return;
          }

          const vx = p2.x - p1.x;
          const vy = p2.y - p1.y;
          const len = Math.sqrt(vx * vx + vy * vy) || 1;
          const perp = { x: -vy / len, y: vx / len };

          const q1Locked = lockPointId && sameId(lockPointId, q1.id);
          const q2Locked = lockPointId && sameId(lockPointId, q2.id);

          if (q1Locked && q2Locked) {
            return;
          }

          if (q1Locked) {
            const keepLen = distance(q1.x, q1.y, q2.x, q2.y) || 80;
            setDependentPoint(q2, q1.x + perp.x * keepLen, q1.y + perp.y * keepLen);
            return;
          }

          if (q2Locked) {
            const keepLen = distance(q1.x, q1.y, q2.x, q2.y) || 80;
            setDependentPoint(q1, q2.x - perp.x * keepLen, q2.y - perp.y * keepLen);
            return;
          }

          const keepLen = distance(q1.x, q1.y, q2.x, q2.y) || 80;
          setDependentPoint(q2, q1.x + perp.x * keepLen, q1.y + perp.y * keepLen);
        }

        function enforceDiameter(dc) {
          const a = getPoint(dc.a);
          const b = getPoint(dc.b);
          const centerId = dc.centerId || "O";
          const center = getPoint(centerId);
          if (!a || !b || !center) {
            return;
          }

          const lockedCenter = lockPointId && sameId(lockPointId, center.id);
          const lockedA = lockPointId && sameId(lockPointId, a.id);
          const lockedB = lockPointId && sameId(lockPointId, b.id);

          if (lockedCenter) {
            // Center moved: keep a (anchor) fixed, update b = 2*O - a so radius changes.
            setDependentPoint(b, 2 * center.x - a.x, 2 * center.y - a.y);
          } else if (lockedA) {
            setDependentPoint(b, 2 * center.x - a.x, 2 * center.y - a.y);
          } else if (lockedB) {
            setDependentPoint(a, 2 * center.x - b.x, 2 * center.y - b.y);
          } else {
            setDependentPoint(center, (a.x + b.x) / 2, (a.y + b.y) / 2);
          }

          const centerNow = getPoint(centerId);
          const anchorNow = getPoint(dc.a) || getPoint(dc.b);
          if (centerNow && anchorNow) {
            setCircleFromCenterAndAnchor(centerNow, anchorNow);
          }
        }

        const radiusByCenter = new Map();
        for (const dc of circlesByDiameter) {
          const cid = centerKey(dc.centerId || "O");
          if (!cid || radiusByCenter.has(cid)) {
            continue;
          }
          radiusByCenter.set(cid, circleRadiusByCenterId(dc.centerId || "O"));
        }
        for (const rel of pointsOnCircles) {
          const cid = centerKey(rel.center);
          if (!cid || radiusByCenter.has(cid)) {
            continue;
          }
          radiusByCenter.set(cid, circleRadiusByCenterId(rel.center));
        }

        const maxLayers = 1; // kept for compatibility, not used in propagation

        if (fullRecompute) {
          // Seed circle and on-circle positions from SVG initial render before propagation.
          for (const dc of circlesByDiameter) {
            enforceDiameter(dc);
          }
          for (const rel of pointsOnCircles) {
            const pointId = String(rel?.point || "").toUpperCase();
            if (!pointId) continue;
            const p = getPoint(rel.point), center = getPoint(rel.center);
            if (!p || !center) continue;
            const r = radiusFromDiameterCenterId(rel.center) || circleRadiusByCenterId(rel.center);
            if (!r) continue;
            const vx = p.x - center.x, vy = p.y - center.y;
            const len = Math.sqrt(vx * vx + vy * vy) || 1;
            updatePoint(p, center.x + (vx / len) * r, center.y + (vy / len) * r, true);
          }
        }

        // Directed topological propagation (both fullRecompute and incremental drag).
        propagateFromSeeds(fullRecompute ? [...driverPointIds] : seedIds);

        isApplyingConstraints = false;
        updateTangentOverlays();
      }

      function updatePoint(p, x, y, skipConstraints = false) {
        p.prevX = p.x;
        p.prevY = p.y;
        p.x = x;
        p.y = y;
        p.circle.setAttribute("cx", String(x));
        p.circle.setAttribute("cy", String(y));
        p.text.setAttribute("x", String(x + 8));
        p.text.setAttribute("y", String(y - 8));

        for (const item of p.lines) {
          if (item.end === 1) {
            item.line.setAttribute("x1", String(x));
            item.line.setAttribute("y1", String(y));
          } else {
            item.line.setAttribute("x2", String(x));
            item.line.setAttribute("y2", String(y));
          }
        }

        for (const c of p.centeredCircles) {
          c.setAttribute("cx", String(x));
          c.setAttribute("cy", String(y));
        }

        for (const c of p.radiusCircles) {
          const cx = parseNumber(c.getAttribute("cx"));
          const cy = parseNumber(c.getAttribute("cy"));
          c.setAttribute("r", String(distance(x, y, cx, cy)));
        }

        updateTangentOverlays();

        if (!skipConstraints) {
          // Recompute all derived constraints after each direct drag update.
          // This mirrors interactive-demo's model: keep a small set of driver points,
          // then deterministically rebuild dependent geometry each frame.
          applyCircleConstraints([p.id]);
        }
      }

      svg.addEventListener("pointerdown", (evt) => {
        const targetGroup = evt.target.closest("g");
        const p = points.find((it) => it.group === targetGroup);
        if (p?.draggable) {
          evt.preventDefault();
          dragPoint = p;
          lockPointId = p.id;
          p.group.classList.add("dragging-point");
          svg.setPointerCapture(evt.pointerId);
          return;
        }

        // Circle rim drag — resize the circle by dragging its border.
        const hitCircle = circleEls.find((c) => c === evt.target);
        if (hitCircle) {
          const centerId = hitCircle.getAttribute("data-center-id");
          const cp = centerId ? getPoint(centerId) : null;
          if (cp) {
            evt.preventDefault();
            dragCircle = { cEl: hitCircle, centerPoint: cp };
            lockPointId = cp.id;
            svg.setPointerCapture(evt.pointerId);
            return;
          }
        }

        panStart = {
          pointerId: evt.pointerId,
          clientX: evt.clientX,
          clientY: evt.clientY,
          viewX: viewBox.x,
          viewY: viewBox.y
        };
        svg.setPointerCapture(evt.pointerId);
      });

      svg.addEventListener("pointermove", (evt) => {
        if (dragCircle) {
          evt.preventDefault();
          const raw = screenToSvg(evt.clientX, evt.clientY);
          const center = dragCircle.centerPoint;
          const newR = Math.max(10, distance(raw.x, raw.y, center.x, center.y));
          dragCircle.cEl.setAttribute("r", String(newR));
          const changed = [center.id];
          // Update circlesByDiameter endpoints (e.g. C and D)
          const cByDiam = Array.isArray(parsed?.circlesByDiameter) ? parsed.circlesByDiameter : [];
          for (const dc of cByDiam) {
            if (String(dc?.centerId || "O").toUpperCase() !== String(center.id).toUpperCase()) continue;
            const aPoint = getPoint(dc.a);
            const bPoint = getPoint(dc.b);
            if (!aPoint || !bPoint) continue;
            const ax = aPoint.x - center.x, ay = aPoint.y - center.y;
            const aLen = Math.sqrt(ax * ax + ay * ay) || 1;
            const newAx = center.x + (ax / aLen) * newR;
            const newAy = center.y + (ay / aLen) * newR;
            updatePoint(aPoint, newAx, newAy, true);
            updatePoint(bPoint, 2 * center.x - newAx, 2 * center.y - newAy, true);
            changed.push(aPoint.id, bPoint.id);
          }
          // Update circleConstraints radius anchor point
          const cCons = Array.isArray(parsed?.circleConstraints) ? parsed.circleConstraints : [];
          for (const cc of cCons) {
            if (String(cc?.centerPointId || "").toUpperCase() !== String(center.id).toUpperCase()) continue;
            const anchorPoint = getPoint(cc.pointOnCircleId);
            if (!anchorPoint) continue;
            const ax = anchorPoint.x - center.x, ay = anchorPoint.y - center.y;
            const aLen = Math.sqrt(ax * ax + ay * ay) || 1;
            updatePoint(anchorPoint, center.x + (ax / aLen) * newR, center.y + (ay / aLen) * newR, true);
            changed.push(anchorPoint.id);
          }
          applyCircleConstraints(changed);
          return;
        }

        if (dragPoint) {
          evt.preventDefault();
          const raw = screenToSvg(evt.clientX, evt.clientY);
          const dragId = String(dragPoint.id || "").toUpperCase();
          const p = { x: raw.x, y: raw.y };

          const onCircleCenterId = pointOnCircleByPointId.get(String(dragPoint.id || "").toUpperCase());
          if (onCircleCenterId) {
            const center = getPoint(onCircleCenterId);
            const cEl = center ? circleByCenterId.get(center.id) : null;
            if (center && cEl) {
              const vx = p.x - center.x;
              const vy = p.y - center.y;
              const len = Math.sqrt(vx * vx + vy * vy) || 1;

              // All on-circle points slide along the circle at the CURRENT radius.
              // The circle does NOT resize when a point is dragged — use rim drag for that.
              // If the dragged point is a diameter endpoint (C or D), the antipodal
              // endpoint is updated so CD always passes through O.
              const currentR = parseNumber(cEl.getAttribute("r"), 0) || len;
              const newX = center.x + (vx / len) * currentR;
              const newY = center.y + (vy / len) * currentR;
              updatePoint(dragPoint, newX, newY, true);

              const changed = [dragPoint.id];
              const circlesByDiameter = Array.isArray(parsed?.circlesByDiameter) ? parsed.circlesByDiameter : [];
              for (const dc of circlesByDiameter) {
                const dcCenterId = String(dc?.centerId || "O").toUpperCase();
                if (dcCenterId !== String(center.id).toUpperCase()) continue;
                const cx = center.x, cy = center.y;
                const dcA = String(dc.a || "").toUpperCase();
                const dcB = String(dc.b || "").toUpperCase();
                if (dragId === dcB) {
                  // D dragged → C = 2·O − D
                  const other = getPoint(dc.a);
                  if (other) { updatePoint(other, 2 * cx - newX, 2 * cy - newY, true); changed.push(other.id); }
                } else if (dragId === dcA) {
                  // C dragged → D = 2·O − C
                  const other = getPoint(dc.b);
                  if (other) { updatePoint(other, 2 * cx - newX, 2 * cy - newY, true); changed.push(other.id); }
                }
              }
              applyCircleConstraints(changed);
            } else {
              updatePoint(dragPoint, p.x, p.y);
            }
          } else if (segmentConstraintOf.has(dragId)) {
            // Constrained-segment point: project the cursor position onto the segment.
            const sc = segmentConstraintOf.get(dragId);
            const sa = getPoint(sc.a);
            const sb = getPoint(sc.b);
            if (sa && sb) {
              const vx = sb.x - sa.x, vy = sb.y - sa.y;
              const len2 = vx * vx + vy * vy || 1;
              const t = Math.max(0, Math.min(1, ((p.x - sa.x) * vx + (p.y - sa.y) * vy) / len2));
              updatePoint(dragPoint, sa.x + t * vx, sa.y + t * vy, true);
              applyCircleConstraints([dragPoint.id]);
            }
          } else {
            // Free point drag. If this is a circle center, explicitly update diameter
            // endpoints and circle radius here — do not rely solely on the constraint
            // graph, which can silently fail if lockPointId is cleared prematurely.
            updatePoint(dragPoint, p.x, p.y, true); // skipConstraints during explicit update
            const circlesByDiameterNow = Array.isArray(parsed?.circlesByDiameter) ? parsed.circlesByDiameter : [];
            const changed = [dragPoint.id];
            for (const dc of circlesByDiameterNow) {
              const dcCenterId = String(dc?.centerId || "O").toUpperCase();
              if (dcCenterId !== dragId) continue;
              // This point is the center of a diameter circle.
              const aPoint = getPoint(dc.a);
              const bPoint = getPoint(dc.b);
              if (!aPoint || !bPoint) continue;
              // Preserve the original direction vector C→D while re-centering at the new O.
              const halfDx = (bPoint.x - aPoint.x) / 2;
              const halfDy = (bPoint.y - aPoint.y) / 2;
              const newAx = p.x - halfDx, newAy = p.y - halfDy;
              const newBx = p.x + halfDx, newBy = p.y + halfDy;
              updatePoint(aPoint, newAx, newAy, true);
              updatePoint(bPoint, newBx, newBy, true);
              setCircleFromCenterAndAnchor(dragPoint, aPoint);
              changed.push(aPoint.id, bPoint.id);
            }
            // Propagate midpoints: if the dragged point is A or B of a midpoint M=(A+B)/2,
            // update M in real-time so it follows during drag.
            for (const mp of Array.isArray(parsed?.midpoints) ? parsed.midpoints : []) {
              const mpA = String(mp?.a || "").toUpperCase();
              const mpB = String(mp?.b || "").toUpperCase();
              if (mpA !== dragId && mpB !== dragId) continue;
              const pa = getPoint(mp.a);
              const pb = getPoint(mp.b);
              const pm = getPoint(mp.point);
              if (!pa || !pb || !pm) continue;
              updatePoint(pm, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2, true);
              changed.push(pm.id);
            }
            // Propagate centroids: if dragged point is a vertex, update centroid G.
            for (const c of Array.isArray(parsed?.centroids) ? parsed.centroids : []) {
              const ca = String(c?.a || "").toUpperCase();
              const cb = String(c?.b || "").toUpperCase();
              const cc = String(c?.c || "").toUpperCase();
              if (ca !== dragId && cb !== dragId && cc !== dragId) continue;
              const pa = getPoint(c.a);
              const pb = getPoint(c.b);
              const pc = getPoint(c.c);
              const pg = getPoint(c.point);
              if (!pa || !pb || !pc || !pg) continue;
              updatePoint(pg, (pa.x + pb.x + pc.x) / 3, (pa.y + pb.y + pc.y) / 3, true);
              changed.push(pg.id);
            }
            applyCircleConstraints(changed);
          }
          return;
        }

        if (panStart && panStart.pointerId === evt.pointerId) {
          evt.preventDefault();
          const dx = (evt.clientX - panStart.clientX) * (viewBox.w / svg.clientWidth);
          const dy = (evt.clientY - panStart.clientY) * (viewBox.h / svg.clientHeight);
          viewBox.x = panStart.viewX - dx;
          viewBox.y = panStart.viewY - dy;
          applyViewBox();
        }
      });

      svg.addEventListener("pointerup", (evt) => {
        if (dragCircle) {
          dragCircle = null;
          lockPointId = null;
        }
        if (dragPoint) {
          const finalPoint = dragPoint;
          finalPoint.group.classList.remove("dragging-point");
          dragPoint = null;
          lockPointId = null;
          // Client constraint graph handles all propagation — no server round-trip needed.
        }
        if (panStart && panStart.pointerId === evt.pointerId) {
          panStart = null;
        }
      });

      svg.addEventListener("pointercancel", () => {
        if (dragCircle) {
          dragCircle = null;
          lockPointId = null;
        }
        if (dragPoint) {
          dragPoint.group.classList.remove("dragging-point");
          dragPoint = null;
          lockPointId = null;
        }
        panStart = null;
      });

      svg.addEventListener("wheel", (evt) => {
        evt.preventDefault();
        const zoom = evt.deltaY < 0 ? 0.9 : 1.1;
        const p = screenToSvg(evt.clientX, evt.clientY);

        const nw = viewBox.w * zoom;
        const nh = viewBox.h * zoom;
        const ratioX = (p.x - viewBox.x) / viewBox.w;
        const ratioY = (p.y - viewBox.y) / viewBox.h;

        viewBox.x = p.x - ratioX * nw;
        viewBox.y = p.y - ratioY * nh;
        viewBox.w = Math.max(80, Math.min(5000, nw));
        viewBox.h = Math.max(60, Math.min(4000, nh));
        applyViewBox();
      }, { passive: false });

      // Snap initial geometry to key circle constraints to avoid visible drift.
      applyCircleConstraints(points.map((p) => p.id));
      updateTangentOverlays();

    }
