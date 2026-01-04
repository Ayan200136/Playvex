(() => {
  "use strict";

  // Neon Dodge (example game)
  // Drag to move horizontally. Dodge blocks. Tap to restart after a hit.

  const canvas = document.getElementById("gameStage");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) return;

  const BG = "#0e0f13";
  const ACCENT = "#4cff7a";
  const TEXT = "#ffffff";
  const MUTED = "#b3b3b3";

  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  const progress = window.PlayvexProgress || null;
  const settings = window.PlayvexSettings || null;
  let paused = false;

  window.addEventListener("playvex:pause", (e) => {
    const s = e && e.detail && typeof e.detail.slug === "string" ? e.detail.slug : "";
    if (s && s !== "example-game") return;
    paused = true;
  });

  window.addEventListener("playvex:resume", (e) => {
    const s = e && e.detail && typeof e.detail.slug === "string" ? e.detail.slug : "";
    if (s && s !== "example-game") return;
    paused = false;
  });

  window.addEventListener("playvex:restart", (e) => {
    const s = e && e.detail && typeof e.detail.slug === "string" ? e.detail.slug : "";
    if (s && s !== "example-game") return;
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    paused = false;
    restart();
  });

  const state = {
    w: canvas.width,
    h: canvas.height,
    running: true,
    score: 0,
    best: 0,
    time: 0,
    lastTs: 0,
    player: { x: 0.5, y: 0.86, r: 18 },
    obstacles: [],
    spawnT: 0,
    difficultyT: 0,
    pointerDown: false,
    pointerX: null
  };

  if (progress) {
    const saved = progress.get("example-game");
    const best = saved && typeof saved.best === "number" ? saved.best : 0;
    state.best = Math.max(0, Math.floor(best));
  }

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

  function normalizeX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    return clamp(x, 0, 1);
  }

  function preventDefault(e) {
    if (paused) return;
    if (!state.running) return;
    const t = e && e.touches && e.touches[0];
    if (t) {
      const edge = 18;
      const w = window.innerWidth || 0;
      if (t.clientX <= edge || t.clientX >= w - edge) return;
    }
    e.preventDefault();
  }

  canvas.addEventListener("touchstart", preventDefault, { passive: false });
  canvas.addEventListener("touchmove", preventDefault, { passive: false });
  canvas.addEventListener("touchend", preventDefault, { passive: false });

  canvas.addEventListener("pointerdown", (e) => {
    if (paused) return;
    if (e && e.pointerType === "touch") {
      const edge = 18;
      const w = window.innerWidth || 0;
      if (e.clientX <= edge || e.clientX >= w - edge) return;
    }
    state.pointerDown = true;
    state.pointerX = normalizeX(e.clientX);

    if (!state.running) {
      restart();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (paused) return;
    if (!state.pointerDown) return;
    state.pointerX = normalizeX(e.clientX);
  });

  const endPointer = () => {
    state.pointerDown = false;
    state.pointerX = null;
  };

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", endPointer);

  function restart() {
    state.running = true;
    state.score = 0;
    state.time = 0;
    state.lastTs = 0;
    state.obstacles.length = 0;
    state.spawnT = 0;
    state.difficultyT = 0;
    state.player.x = 0.5;
  }

  function endRun() {
    state.running = false;
    state.best = Math.max(state.best, Math.floor(state.score));

    if (progress) {
      progress.merge("example-game", {
        best: state.best,
        lastScore: Math.floor(state.score)
      });
    }
  }

  function spawnObstacle(level) {
    const w = state.w;
    const h = state.h;

    const size = Math.round((18 + Math.random() * 18) * dpr);
    const x = Math.random() * (w - size) + size / 2;
    const speed = (260 + level * 22 + Math.random() * 80) * dpr;

    state.obstacles.push({ x, y: -size, s: size, v: speed });
  }

  function circleRectCollide(cx, cy, r, rx, ry, rw, rh) {
    const closestX = clamp(cx, rx, rx + rw);
    const closestY = clamp(cy, ry, ry + rh);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return (dx * dx + dy * dy) <= (r * r);
  }

  function update(dt) {
    state.time += dt;

    const level = Math.min(18, Math.floor(state.time / 2.6));

    if (state.pointerX != null) {
      const lerp = 1 - Math.pow(0.001, dt);
      state.player.x = state.player.x + (state.pointerX - state.player.x) * lerp;
    }

    state.spawnT -= dt;
    if (state.spawnT <= 0) {
      spawnObstacle(level);
      const interval = clamp(0.62 - level * 0.02, 0.26, 0.62);
      state.spawnT = interval;
    }

    const w = state.w;
    const h = state.h;
    const px = state.player.x * w;
    const py = state.player.y * h;
    const pr = Math.round(16 * dpr);

    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      o.y += o.v * dt;

      const rx = o.x - o.s / 2;
      const ry = o.y - o.s / 2;

      if (circleRectCollide(px, py, pr, rx, ry, o.s, o.s)) {
        endRun();
        return;
      }

      if (o.y - o.s > h + 10) {
        state.obstacles.splice(i, 1);
      }
    }

    state.score += dt * (10 + level * 2.5);
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

    const accentGlow = ctx.createRadialGradient(w * 0.18, h * 0.12, 0, w * 0.18, h * 0.12, Math.max(w, h) * 0.9);
    accentGlow.addColorStop(0, "rgba(76,255,122,0.18)");
    accentGlow.addColorStop(1, "rgba(76,255,122,0)");
    ctx.fillStyle = accentGlow;
    ctx.fillRect(0, 0, w, h);

    const px = state.player.x * w;
    const py = state.player.y * h;
    const pr = Math.round(16 * dpr);

    for (const o of state.obstacles) {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      drawRoundedRect(o.x - o.s / 2, o.y - o.s / 2, o.s, o.s, Math.round(6 * dpr));
      ctx.fill();
    }

    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.arc(px - pr * 0.25, py - pr * 0.25, pr * 0.5, 0, Math.PI * 2);
    ctx.fill();

    const pad = Math.round(12 * dpr);
    const panelH = Math.round(44 * dpr);
    const panelW = Math.round(190 * dpr);

    ctx.fillStyle = "rgba(20,22,34,0.88)";
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr));
    drawRoundedRect(pad, pad, panelW, panelH, Math.round(12 * dpr));
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = TEXT;
    ctx.font = `${Math.round(14 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(`Score ${Math.floor(state.score)}`, pad + Math.round(12 * dpr), pad + panelH / 2);

    if (!state.running) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, w, h);

      const boxW = Math.round(w * 0.84);
      const boxH = Math.round(Math.min(h * 0.34, 280 * dpr));
      const boxX = Math.round((w - boxW) / 2);
      const boxY = Math.round(h * 0.22);

      ctx.fillStyle = "rgba(20,22,34,0.94)";
      ctx.strokeStyle = "rgba(76,255,122,0.22)";
      ctx.lineWidth = Math.max(1, Math.round(1.5 * dpr));
      drawRoundedRect(boxX, boxY, boxW, boxH, Math.round(18 * dpr));
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = TEXT;
      ctx.font = `${Math.round(20 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("Run ended", boxX + boxW / 2, boxY + Math.round(58 * dpr));

      ctx.fillStyle = MUTED;
      ctx.font = `${Math.round(14 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(`Score: ${Math.floor(state.score)}  •  Best: ${state.best}`, boxX + boxW / 2, boxY + Math.round(98 * dpr));

      const btnW = Math.round(Math.min(boxW - 36 * dpr, 320 * dpr));
      const btnH = Math.round(48 * dpr);
      const btnX = Math.round(boxX + (boxW - btnW) / 2);
      const btnY = Math.round(boxY + boxH - btnH - 26 * dpr);

      ctx.fillStyle = "rgba(76,255,122,0.16)";
      ctx.strokeStyle = "rgba(76,255,122,0.55)";
      drawRoundedRect(btnX, btnY, btnW, btnH, Math.round(14 * dpr));
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = TEXT;
      ctx.font = `${Math.round(16 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText("Tap to restart", btnX + btnW / 2, btnY + btnH / 2);

      ctx.textAlign = "start";
    }
  }

  function loop(ts) {
    if (!state.lastTs) state.lastTs = ts;
    if (paused) {
      state.lastTs = ts;
      render();
      requestAnimationFrame(loop);
      return;
    }

    const dt = clamp((ts - state.lastTs) / 1000, 0, 0.05);
    state.lastTs = ts;

    if (state.running) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
