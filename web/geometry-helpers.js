    function distance(x1, y1, x2, y2) {
      const dx = x1 - x2;
      const dy = y1 - y2;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function parseNumber(v, fallback = 0) {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }

    function findNearestPoint(points, x, y, threshold = 10) {
      let best = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (const p of points) {
        const d = distance(p.x, p.y, x, y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (!best || bestD > threshold) {
        return null;
      }
      return best;
    }
