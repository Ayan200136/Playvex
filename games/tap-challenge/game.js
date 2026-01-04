(() => {
  "use strict";

  // Tap Challenge
  // Tap as fast as you can for 10 seconds. Tap again to restart.

  const canvas = document.getElementById("gameStage");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) return;

  const BG = "#0e0f13";
  const PANEL = "rgba(20,22,34,0.92)";
  const BORDER = "rgba(255,255,255,0.10)";
  const ACCENT = "#4cff7a";
  const TEXT = "#ffffff";
  const MUTED = "#b3b3b3";

  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  const state = {
    w: canvas.width,
    h: canvas.height,
    taps: 0,
    best: 0,
    playing: false,
    remaining: 10,
    lastTs: 0,
    flash: 0
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

  function start() {
    state.playing = true;
    document.documentElement.classList.add("noscroll");
    document.body.classList.add("noscroll");
    state.taps = 0;
    state.remaining = 10;
    state.lastTs = 0;
    state.flash = 0;
  }

  function end() {
    state.playing = false;
    document.documentElement.classList.remove("noscroll");
    document.body.classList.remove("noscroll");
    state.best = Math.max(state.best, state.taps);
  }

  canvas.addEventListener("pointerdown", () => {
    if (!state.playing) start();
    if (!state.playing) return;

    state.taps += 1;
    state.flash = 1;

    if (navigator.vibrate) {
      try { navigator.vibrate(8); } catch { /* ignore */ }
    }
  });

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

  function update(dt) {
    state.flash = Math.max(0, state.flash - dt * 6);

    if (!state.playing) return;

    state.remaining -= dt;
    if (state.remaining <= 0) {
      state.remaining = 0;
      end();
    }
  }

  function render() {
    const w = state.w;
    const h = state.h;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    const g = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(76,255,122,0.16)");
    g.addColorStop(1, "rgba(76,255,122,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const pad = Math.round(18 * dpr);

    const boxW = Math.round(w * 0.86);
    const boxH = Math.round(Math.min(320 * dpr, h * 0.38));
    const boxX = Math.round((w - boxW) / 2);
    const boxY = Math.round(h * 0.18);

    ctx.fillStyle = PANEL;
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr));
    drawRoundedRect(boxX, boxY, boxW, boxH, Math.round(18 * dpr));
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = TEXT;
    ctx.font = `${Math.round(22 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(state.playing ? "Tap now" : "Tap to start", boxX + boxW / 2, boxY + Math.round(56 * dpr));

    ctx.fillStyle = MUTED;
    ctx.font = `${Math.round(14 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    const helper = state.playing ? "Every tap counts" : "10 seconds • Beat your best";
    ctx.fillText(helper, boxX + boxW / 2, boxY + Math.round(92 * dpr));

    const big = Math.round(56 * dpr);
    ctx.fillStyle = ACCENT;
    ctx.font = `${big}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(String(state.taps), boxX + boxW / 2, boxY + boxH / 2);

    ctx.fillStyle = MUTED;
    ctx.font = `${Math.round(14 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    const t = state.playing ? `${Math.ceil(state.remaining)}s left` : `Best ${state.best}`;
    ctx.fillText(t, boxX + boxW / 2, boxY + boxH - Math.round(48 * dpr));

    const ringR = Math.round(120 * dpr);
    ctx.strokeStyle = "rgba(76,255,122,0.22)";
    ctx.lineWidth = Math.max(1, Math.round(10 * dpr));
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.78, ringR, 0, Math.PI * 2);
    ctx.stroke();

    const fillAmt = state.playing ? clamp(state.remaining / 10, 0, 1) : 0;
    ctx.strokeStyle = state.playing ? "rgba(76,255,122,0.85)" : "rgba(255,255,255,0.08)";
    ctx.lineWidth = Math.max(1, Math.round(12 * dpr));
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.78, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fillAmt);
    ctx.stroke();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(76,255,122,${0.07 * state.flash})`;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.textAlign = "start";
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
