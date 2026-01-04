(() => {
  "use strict";

  // Lane Sprint
  // Swipe left/right to change lanes and dodge blocks. Tap to start.

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
    lane: 1,
    running: false,
    score: 0,
    best: 0,
    t: 0,
    lastTs: 0,
    obstacles: [],
    spawnT: 0,
    swipeStartX: null,
    swipeStartT: 0
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
    state.t = 0;
    state.lastTs = 0;
    state.obstacles.length = 0;
    state.spawnT = 0;
    state.lane = 1;
  }

  function endRun() {
    state.running = false;
    document.documentElement.classList.remove("noscroll");
    document.body.classList.remove("noscroll");
    state.best = Math.max(state.best, Math.floor(state.score));
  }

  function laneCenter(lane) {
    const w = state.w;
    const left = w * 0.18;
    const right = w * 0.82;
    const step = (right - left) / 2;
    return left + step * lane;
  }

  function spawnObstacle(level) {
    const size = Math.round((56 - Math.min(level, 10) * 2) * dpr);
    const lane = Math.floor(Math.random() * 3);
    const speed = (520 + level * 30) * dpr;
    state.obstacles.push({ lane, y: -size, s: size, v: speed });
  }

  function moveLane(dir) {
    state.lane = clamp(state.lane + dir, 0, 2);
  }

  canvas.addEventListener("pointerdown", (e) => {
    state.swipeStartX = e.clientX;
    state.swipeStartT = performance.now();

    if (!state.running) {
      restart();
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (state.swipeStartX == null) return;
    const dx = e.clientX - state.swipeStartX;
    const dt = performance.now() - state.swipeStartT;
    state.swipeStartX = null;

    const minDx = 28;
    if (Math.abs(dx) >= minDx && dt <= 420) {
      moveLane(dx > 0 ? 1 : -1);
    }
  });

  function update(dt) {
    if (!state.running) return;

    state.t += dt;
    const level = Math.min(20, Math.floor(state.t / 2.2));

    state.spawnT -= dt;
    if (state.spawnT <= 0) {
      spawnObstacle(level);
      const interval = clamp(0.62 - level * 0.02, 0.28, 0.62);
      state.spawnT = interval;
    }

    const h = state.h;
    const playerY = h * 0.82;
    const playerS = Math.round(54 * dpr);

    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      o.y += o.v * dt;

      const px = laneCenter(state.lane);
      const ox = laneCenter(o.lane);

      const hitX = Math.abs(px - ox) < playerS * 0.62;
      const hitY = Math.abs(playerY - o.y) < (playerS + o.s) * 0.42;

      if (hitX && hitY) {
        endRun();
        return;
      }

      if (o.y - o.s > h + 10) {
        state.obstacles.splice(i, 1);
      }
    }

    state.score += dt * (16 + level * 3);
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

    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = Math.max(1, Math.round(2 * dpr));

    const left = w * 0.18;
    const right = w * 0.82;
    const mid = (left + right) / 2;

    ctx.beginPath();
    ctx.moveTo(left, h * 0.06);
    ctx.lineTo(left, h * 0.94);
    ctx.moveTo(mid, h * 0.06);
    ctx.lineTo(mid, h * 0.94);
    ctx.moveTo(right, h * 0.06);
    ctx.lineTo(right, h * 0.94);
    ctx.stroke();

    const glow = ctx.createRadialGradient(w * 0.5, h * 0.2, 0, w * 0.5, h * 0.2, Math.max(w, h) * 0.75);
    glow.addColorStop(0, "rgba(76,255,122,0.14)");
    glow.addColorStop(1, "rgba(76,255,122,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    for (const o of state.obstacles) {
      const x = laneCenter(o.lane);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      drawRoundedRect(x - o.s / 2, o.y - o.s / 2, o.s, o.s, Math.round(14 * dpr));
      ctx.fill();
    }

    const playerS = Math.round(54 * dpr);
    const px = laneCenter(state.lane);
    const py = h * 0.82;

    ctx.fillStyle = ACCENT;
    drawRoundedRect(px - playerS / 2, py - playerS / 2, playerS, playerS, Math.round(18 * dpr));
    ctx.fill();

    ctx.fillStyle = "rgba(20,22,34,0.88)";
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr));
    drawRoundedRect(Math.round(14 * dpr), Math.round(14 * dpr), Math.round(210 * dpr), Math.round(46 * dpr), Math.round(14 * dpr));
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = TEXT;
    ctx.font = `${Math.round(14 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(`Score ${Math.floor(state.score)}`, Math.round(28 * dpr), Math.round(37 * dpr));

    if (!state.running) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = TEXT;
      ctx.textAlign = "center";
      ctx.font = `${Math.round(22 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText("Swipe to switch lanes", w / 2, h * 0.42);

      ctx.fillStyle = MUTED;
      ctx.font = `${Math.round(14 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(`Best ${state.best} • Tap to start`, w / 2, h * 0.48);
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
