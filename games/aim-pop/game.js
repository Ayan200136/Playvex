(() => {
  "use strict";

  // Aim Pop
  // Tap targets before they fade. Miss too many and the run ends. Tap to restart.

  const canvas = document.getElementById("gameStage");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) return;

  const BG = "#0e0f13";
  const ACCENT = "#4cff7a";
  const TEXT = "#ffffff";
  const MUTED = "#b3b3b3";

  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  const state = {
    w: canvas.width,
    h: canvas.height,
    running: false,
    score: 0,
    best: 0,
    misses: 0,
    maxMisses: 3,
    lastTs: 0,
    spawnT: 0,
    targets: []
  };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      state.w = w;
      state.h = h;
    }
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  window.addEventListener("resize", resize, { passive: true });
  resize();

  function preventDefault(e) {
    e.preventDefault();
  }
  canvas.addEventListener("touchstart", preventDefault, { passive: false });
  canvas.addEventListener("touchmove", preventDefault, { passive: false });
  canvas.addEventListener("touchend", preventDefault, { passive: false });

  function restart() {
    state.running = true;
    document.documentElement.classList.add("noscroll");
    document.body.classList.add("noscroll");
    state.score = 0;
    state.misses = 0;
    state.targets.length = 0;
    state.spawnT = 0;
    state.lastTs = 0;
  }

  function endRun() {
    state.running = false;
    document.documentElement.classList.remove("noscroll");
    document.body.classList.remove("noscroll");
    state.best = Math.max(state.best, Math.floor(state.score));
  }

  function spawnTarget(level) {
    const w = state.w;
    const h = state.h;

    const r = Math.round((34 - Math.min(level, 12)) * dpr);
    const pad = Math.round(22 * dpr);

    const x = pad + Math.random() * Math.max(1, w - pad * 2);
    const y = pad + Math.random() * Math.max(1, h - pad * 2);

    const life = clamp(1.25 - level * 0.05, 0.55, 1.25);

    state.targets.push({ x, y, r, t: 0, life });
  }

  function hitTest(x, y) {
    for (let i = state.targets.length - 1; i >= 0; i--) {
      const t = state.targets[i];
      const dx = x - t.x;
      const dy = y - t.y;
      if ((dx * dx + dy * dy) <= (t.r * t.r)) {
        state.targets.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / Math.max(1, rect.width) * state.w;
    const y = (e.clientY - rect.top) / Math.max(1, rect.height) * state.h;
    return { x, y };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!state.running) {
      restart();
      return;
    }

    const p = canvasPoint(e);
    const hit = hitTest(p.x, p.y);

    if (hit) {
      const level = Math.min(20, Math.floor(state.score / 8));
      state.score += 1 + Math.floor(level / 3);
      if (navigator.vibrate) {
        try { navigator.vibrate(10); } catch { /* ignore */ }
      }
    } else {
      state.misses += 1;
      if (state.misses >= state.maxMisses) endRun();
    }
  });

  function update(dt) {
    if (!state.running) return;

    const level = Math.min(20, Math.floor(state.score / 10));

    state.spawnT -= dt;
    if (state.spawnT <= 0) {
      spawnTarget(level);
      const interval = clamp(0.9 - level * 0.03, 0.34, 0.9);
      state.spawnT = interval;
    }

    for (let i = state.targets.length - 1; i >= 0; i--) {
      const t = state.targets[i];
      t.t += dt;
      if (t.t >= t.life) {
        state.targets.splice(i, 1);
        state.misses += 1;
        if (state.misses >= state.maxMisses) {
          endRun();
          return;
        }
      }
    }
  }

  function drawRoundedRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function render() {
    const w = state.w;
    const h = state.h;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.5, h * 0.25, 0, w * 0.5, h * 0.25, Math.max(w, h) * 0.9);
    glow.addColorStop(0, "rgba(76,255,122,0.14)");
    glow.addColorStop(1, "rgba(76,255,122,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    for (const t of state.targets) {
      const a = clamp(1 - t.t / t.life, 0, 1);
      const outer = t.r * (1 + (1 - a) * 0.35);

      ctx.fillStyle = `rgba(76,255,122,${0.18 * a})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, outer, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255,255,255,${0.85 * a})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(76,255,122,${0.6 * a})`;
      ctx.lineWidth = Math.max(1, Math.round(3 * dpr));
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(20,22,34,0.88)";
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr));
    drawRoundedRect(Math.round(14 * dpr), Math.round(14 * dpr), Math.round(230 * dpr), Math.round(46 * dpr), Math.round(14 * dpr));
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = TEXT;
    ctx.font = `${Math.round(14 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(`Score ${Math.floor(state.score)}  •  Miss ${state.misses}/${state.maxMisses}`, Math.round(28 * dpr), Math.round(37 * dpr));

    if (!state.running) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, w, h);

      ctx.textAlign = "center";
      ctx.fillStyle = TEXT;
      ctx.font = `${Math.round(22 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText("Tap to start", w / 2, h * 0.42);

      ctx.fillStyle = MUTED;
      ctx.font = `${Math.round(14 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(`Best ${state.best} • Miss limit ${state.maxMisses}`, w / 2, h * 0.48);
      ctx.textAlign = "start";
    }
  }

  function loop(ts) {
    if (!state.lastTs) state.lastTs = ts;
    const dt = clamp((ts - state.lastTs) / 1000, 0, 0.05);
    state.lastTs = ts;

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
