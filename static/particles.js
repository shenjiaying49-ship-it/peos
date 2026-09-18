/* PEOS 粒子背景 — 星链网络。纯 canvas，无依赖。 */
(() => {
  const c = document.getElementById("particles");
  if (!c) return;
  const ctx = c.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, pts = [], raf = null;

  const count = () => Math.max(36, Math.min(110, Math.floor(innerWidth * innerHeight / 16000)));

  function resize() {
    W = c.width = innerWidth;
    H = c.height = innerHeight;
  }

  function init() {
    pts = Array.from({ length: count() }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .28, vy: (Math.random() - .5) * .28,
      r: Math.random() * 1.3 + .4,
      o: Math.random() * .45 + .12,
    }));
  }

  const LINK = 130;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fillStyle = `rgba(255,255,255,${p.o})`;
      ctx.fill();
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < LINK * LINK) {
          const t = 1 - Math.sqrt(d2) / LINK;
          ctx.strokeStyle = `rgba(255,255,255,${(t * .11).toFixed(3)})`;
          ctx.lineWidth = .6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
  }

  function frame() {
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
    }
    draw();
    raf = requestAnimationFrame(frame);
  }

  resize();
  init();
  addEventListener("resize", () => { resize(); init(); });
  if (reduced) draw();       // 静态一帧
  else frame();
})();
