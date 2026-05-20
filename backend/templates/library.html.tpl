<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>La Gran Biblioteca</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a12; color: #e0e0e0; font-family: monospace; overflow: hidden; }
    #graph { width: 100vw; height: 100vh; display: block; }
    #tooltip {
      position: absolute; padding: 8px 12px; background: rgba(20,20,30,0.95);
      border: 1px solid #444; border-radius: 4px; font-size: 12px; max-width: 300px;
    }
    #tooltip.hidden { display: none; }
  </style>
</head>
<body>
  <canvas id="graph"></canvas>
  <div id="tooltip" class="hidden"></div>
  <script>
    const graph = __GRAPH_JSON__;
    const STYLE = __STYLE_JSON__;
    const canvas = document.getElementById('graph');
    const ctx = canvas.getContext('2d');
    const tooltip = document.getElementById('tooltip');
    let transform = { x: 0, y: 0, k: 1 };

    function resize() {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width; canvas.height = r.height;
      draw();
    }
    window.addEventListener('resize', resize);
    resize();

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      transform.k = Math.min(10, Math.max(0.1, transform.k - e.deltaY * 0.001));
      draw();
    });

    let pan = false;
    canvas.addEventListener('mousedown', e => { if (e.button === 0) pan = true; });
    canvas.addEventListener('mousemove', e => {
      if (pan) { transform.x += e.movementX; transform.y += e.movementY; draw(); }
      handleTooltip(e);
    });
    canvas.addEventListener('mouseup', () => pan = false);

    function getNodeRadius(n) {
      return (STYLE.nodeRadius || {})[n.type] || (STYLE.nodeRadius || {}).default || 12;
    }

    function getNodeColor(n) {
      return (STYLE.nodeColor || {})[n.type] || (STYLE.nodeColor || {}).default || '#BDC3C7';
    }

    function draw() {
      const k = transform.k;
      ctx.save(); ctx.setTransform(k, 0, 0, k, transform.x, transform.y);
      ctx.clearRect(-transform.x/k, -transform.y/k, canvas.width/k, canvas.height/k);

      graph.edges.forEach(e => {
        const s = graph.nodes.find(n => n.id === e.source);
        const t = graph.nodes.find(n => n.id === e.target);
        if (!s?.position || !t?.position) return;
        ctx.beginPath(); ctx.moveTo(s.position.x, s.position.y); ctx.lineTo(t.position.x, t.position.y);
        ctx.strokeStyle = (STYLE.edgeColor || {})[e.type] || (STYLE.edgeColor || {}).default || '#666';
        ctx.lineWidth = 1; ctx.stroke();
      });

      graph.nodes.forEach(n => {
        if (!n.position) return;
        const r = getNodeRadius(n);
        ctx.beginPath(); ctx.arc(n.position.x, n.position.y, r, 0, Math.PI*2);
        ctx.fillStyle = getNodeColor(n); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
        ctx.fillText(n.label.substring(0,12), n.position.x, n.position.y + r + 12);
      });

      ctx.restore();
    }

    function handleTooltip(e) {
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left - transform.x) / transform.k;
      const my = (e.clientY - r.top - transform.y) / transform.k;
      const n = graph.nodes.find(n => n.position && (mx - n.position.x)**2 + (my - n.position.y)**2 <= getNodeRadius(n)**2);
      if (n) {
        tooltip.classList.remove('hidden');
        tooltip.style.left = e.clientX + 10 + 'px'; tooltip.style.top = e.clientY + 10 + 'px';
        tooltip.innerHTML = '<strong>' + n.label + '</strong><br><em>' + n.type + '</em>';
      } else tooltip.classList.add('hidden');
    }
  </script>
</body>
</html>
