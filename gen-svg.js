import('./dist/parser.js').then(p => {
  import('./dist/layout.js').then(l => {
    import('./dist/svg.js').then(s => {
      const text = 'Given circle (O) with diameter CD, the tangent at C is line Cx. Let E be a point on circle (O). Through O draw a line perpendicular to CE, intersecting Cx at A. Through D draw a tangent to circle (O), this tangent intersects AE at B. Draw EH perpendicular to CD at H.';
      const parsed = p.parseGeometryProblem(text);
      const layout = l.buildLayout(parsed);
      const svg = s.renderSvg(layout);
      console.log(svg);
    });
  });
});
