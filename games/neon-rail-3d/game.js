(() => {
  "use strict";

  const canvas = document.getElementById("gameStage");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) return;

  const GAME_SLUG = "neon-rail-3d";
  const progress = window.PlayvexProgress || null;

  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let paused = false;

  const state = {
    w: canvas.width,
    h: canvas.height,
    running: false,
    lane: 1,
    speed: 1,
    score: 0,
    best: 0,
    distance: 0,
    lastTs: 0,
    spawnTimer: 0,
    horizonY: 0,
    touchX: null,
    touchY: null,
    jumpVel: 0,
    jumpHeight: 0,
    slideTimer: 0,
    laneOffset: 0,
    obstacles: [],
    stars: []
  };

  if (progress) {
    const saved = progress.get(GAME_SLUG);
    const best = saved && typeof saved.best === "number" ? saved.best : 0;
    state.best = Math.max(0, Math.floor(best));
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
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
      state.horizonY = h * 0.22;
      seedStars();
    }
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  window.addEventListener("resize", resize, { passive: true });

  function seedStars() {
    state.stars = [];
    const count = Math.round((state.w * state.h) / 58000);
    for (let i = 0; i < count; i++) {
      state.stars.push({
        x: Math.random(),
        y: Math.random() * 0.6,
        s: 0.4 + Math.random() * 1.3,
        tw: Math.random() * Math.PI * 2
      });
    }
  }

  function resetRun() {
    state.running = true;
    state.lane = 1;
    state.speed = 1;
    state.score = 0;
    state.distance = 0;
    state.lastTs = 0;
    state.spawnTimer = 0.4;
    state.jumpVel = 0;
    state.jumpHeight = 0;
    state.slideTimer = 0;
    state.laneOffset = 0;
    state.obstacles.length = 0;
  }

  function endRun() {
    state.running = false;
    state.best = Math.max(state.best, Math.floor(state.score));
    if (progress) {
      progress.merge(GAME_SLUG, {
        best: state.best,
        lastScore: Math.floor(state.score)
      });
    }
  }

  function laneToX(lane) {
    return (lane - 1) * 1.18;
  }

  function tryJump() {
    if (!state.running || state.jumpHeight > 0 || state.slideTimer > 0) return;
    state.jumpVel = 3.5;
  }

  function trySlide() {
    if (!state.running || state.jumpHeight > 0 || state.slideTimer > 0) return;
    state.slideTimer = 0.55;
  }

  function moveLane(dir) {
    state.lane = clamp(state.lane + dir, 0, 2);
  }

  function spawnObstacle() {
    const typePool = ["wall", "wall", "drone", "barrier", "barrier"];
    const type = typePool[Math.floor(Math.random() * typePool.length)];
    state.obstacles.push({
      lane: Math.floor(Math.random() * 3),
      z: 1,
      kind: type
    });
  }

  function project(x, y, z) {
    const horizon = state.horizonY;
    const roadBottom = state.h * 0.95;
    const t = clamp(1 - z, 0, 1);
    const py = horizon + t * (roadBottom - horizon);
    const scale = 0.18 + t * 1.35;
    const px = state.w * 0.5 + x * state.w * 0.17 * scale;
    return { x: px, y: py - y * state.h * 0.2 * scale, scale };
  }

  function update(dt) {
    if (!state.running) return;

    state.distance += dt * (2.6 + state.speed);
    state.speed = Math.min(4.4, 1 + state.distance * 0.05);

    if (state.jumpVel !== 0 || state.jumpHeight > 0) {
      state.jumpVel -= dt * 8.2;
      state.jumpHeight += state.jumpVel * dt;
      if (state.jumpHeight <= 0) {
        state.jumpHeight = 0;
        state.jumpVel = 0;
      }
    }

    if (state.slideTimer > 0) {
      state.slideTimer -= dt;
      if (state.slideTimer < 0) state.slideTimer = 0;
    }

    const targetOffset = laneToX(state.lane);
    state.laneOffset += (targetOffset - state.laneOffset) * Math.min(1, dt * 12);

    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnObstacle();
      const interval = clamp(0.78 - state.speed * 0.1, 0.28, 0.78);
      state.spawnTimer = interval;
    }

    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      o.z -= dt * (0.66 + state.speed * 0.33);

      if (o.z < -0.05) {
        state.obstacles.splice(i, 1);
        state.score += 12;
        continue;
      }

      const near = o.z < 0.2 && o.z > 0;
      const laneHit = o.lane === state.lane;
      if (!near || !laneHit) continue;

      if (o.kind === "barrier") {
        if (state.jumpHeight < 0.28) {
          endRun();
          return;
        }
      } else if (o.kind === "drone") {
        if (state.slideTimer <= 0) {
          endRun();
          return;
        }
      } else {
        endRun();
        return;
      }
    }

    state.score += dt * (22 + state.speed * 9);
  }

  function drawBackground(timeSec) {
    const sky = ctx.createLinearGradient(0, 0, 0, state.h);
    sky.addColorStop(0, "#080914");
    sky.addColorStop(0.42, "#11162b");
    sky.addColorStop(1, "#141414");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, state.w, state.h);

    for (const star of state.stars) {
      const alpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(timeSec * 1.3 + star.tw));
      ctx.fillStyle = `rgba(132, 207, 255, ${alpha.toFixed(3)})`;
      const x = star.x * state.w;
      const y = star.y * state.h;
      const s = star.s * dpr;
      ctx.fillRect(x, y, s, s);
    }

    const glow = ctx.createRadialGradient(
      state.w * 0.5,
      state.horizonY * 0.94,
      state.w * 0.02,
      state.w * 0.5,
      state.horizonY,
      state.w * 0.24
    );
    glow.addColorStop(0, "rgba(99, 231, 255, 0.62)");
    glow.addColorStop(1, "rgba(99, 231, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, state.w, state.h * 0.6);
  }

  function drawRoad(timeSec) {
    const horizon = state.horizonY;
    const bottom = state.h * 0.95;
    const roadHalfTop = state.w * 0.08;
    const roadHalfBottom = state.w * 0.45;

    ctx.beginPath();
    ctx.moveTo(state.w * 0.5 - roadHalfTop, horizon);
    ctx.lineTo(state.w * 0.5 + roadHalfTop, horizon);
    ctx.lineTo(state.w * 0.5 + roadHalfBottom, bottom);
    ctx.lineTo(state.w * 0.5 - roadHalfBottom, bottom);
    ctx.closePath();

    const roadGrad = ctx.createLinearGradient(0, horizon, 0, bottom);
    roadGrad.addColorStop(0, "#161728");
    roadGrad.addColorStop(1, "#202437");
    ctx.fillStyle = roadGrad;
    ctx.fill();

    const pulse = 0.55 + 0.45 * Math.sin(timeSec * 8.5);
    ctx.strokeStyle = `rgba(98, 245, 255, ${(0.35 + pulse * 0.35).toFixed(3)})`;
    ctx.lineWidth = 4 * dpr;
    ctx.stroke();

    for (let lane = -1; lane <= 1; lane++) {
      const shift = lane * 0.32;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const z = 1 - t;
        const p = project(shift, 0, z);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
    }

    const dashSpeed = (state.distance * 0.6) % 1;
    for (let i = 0; i < 22; i++) {
      const t = ((i / 22 + dashSpeed) % 1);
      const p = project(0, 0, 1 - t);
      const w = p.scale * state.w * 0.04;
      const h = p.scale * state.h * 0.008;
      ctx.fillStyle = "rgba(198, 249, 255, 0.9)";
      ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h);
    }
  }

  function drawObstacle(o) {
    const p = project(laneToX(o.lane), 0, o.z);
    if (p.scale <= 0) return;

    if (o.kind === "barrier") {
      const w = state.w * 0.07 * p.scale;
      const h = state.h * 0.045 * p.scale;
      ctx.fillStyle = "#ff5b5b";
      ctx.fillRect(p.x - w / 2, p.y - h, w, h);
      ctx.fillStyle = "#ffd8d8";
      ctx.fillRect(p.x - w / 2, p.y - h, w, h * 0.2);
      return;
    }

    if (o.kind === "drone") {
      const r = state.w * 0.032 * p.scale;
      const y = p.y - state.h * 0.08 * p.scale;
      ctx.fillStyle = "#ffc85e";
      ctx.beginPath();
      ctx.arc(p.x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(p.x - r * 1.6, y);
      ctx.lineTo(p.x + r * 1.6, y);
      ctx.stroke();
      return;
    }

    const w = state.w * 0.08 * p.scale;
    const h = state.h * 0.1 * p.scale;
    ctx.fillStyle = "#c65bff";
    ctx.fillRect(p.x - w / 2, p.y - h, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(p.x - w / 2, p.y - h, w * 0.2, h);
  }

  function drawPlayer() {
    const player = project(state.laneOffset, state.jumpHeight, 0.02);
    const slide = state.slideTimer > 0 ? 0.48 : 1;
    const w = state.w * 0.085 * player.scale;
    const h = state.h * 0.16 * player.scale * slide;

    const grad = ctx.createLinearGradient(player.x, player.y - h, player.x, player.y);
    grad.addColorStop(0, "#66f8ff");
    grad.addColorStop(1, "#1987ff");
    ctx.fillStyle = grad;
    ctx.fillRect(player.x - w / 2, player.y - h, w, h);

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    const visorY = player.y - h + h * 0.2;
    ctx.fillRect(player.x - w * 0.25, visorY, w * 0.5, h * 0.14);

    const shadow = 0.36 - state.jumpHeight * 0.22;
    ctx.fillStyle = `rgba(0,0,0,${clamp(shadow, 0.08, 0.35).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(player.x, player.y + state.h * 0.012, w * 0.55, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHud() {
    const pad = 18 * dpr;
    ctx.fillStyle = "rgba(11, 14, 28, 0.72)";
    ctx.fillRect(pad, pad, state.w - pad * 2, 82 * dpr);

    ctx.fillStyle = "#ffffff";
    ctx.font = `${28 * dpr}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(`Score ${Math.floor(state.score)}`, pad * 1.7, pad * 1.45);

    ctx.fillStyle = "#7ee9ff";
    ctx.font = `${20 * dpr}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillText(`Best ${state.best}`, pad * 1.7, pad * 3.25);

    if (!state.running) {
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(5, 8, 16, 0.75)";
      ctx.fillRect(0, 0, state.w, state.h);

      ctx.fillStyle = "#ffffff";
      ctx.font = `${44 * dpr}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.fillText("Neon Rail 3D", state.w * 0.5, state.h * 0.36);

      ctx.font = `${24 * dpr}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.fillStyle = "#b9d7ff";
      const hint = state.score > 0
        ? "Tap to retry • Swipe to move • ↑ jump • ↓ slide"
        : "Tap to start • Swipe to move • ↑ jump • ↓ slide";
      ctx.fillText(hint, state.w * 0.5, state.h * 0.43);
      ctx.textAlign = "left";
    }
  }

  function draw(ts) {
    const timeSec = ts / 1000;
    drawBackground(timeSec);
    drawRoad(timeSec);

    state.obstacles
      .slice()
      .sort((a, b) => b.z - a.z)
      .forEach(drawObstacle);

    drawPlayer();
    drawHud();
  }

  function frame(ts) {
    if (!paused) {
      if (!state.lastTs) state.lastTs = ts;
      const dt = clamp((ts - state.lastTs) / 1000, 0, 0.05);
      state.lastTs = ts;
      update(dt);
      draw(ts);
    } else {
      state.lastTs = ts;
      draw(ts);
    }
    requestAnimationFrame(frame);
  }

  function onPointerDown(e) {
    if (paused) return;
    if (!state.running) {
      resetRun();
      return;
    }
    state.touchX = e.clientX;
    state.touchY = e.clientY;
  }

  function onPointerUp(e) {
    if (paused || state.touchX == null) return;
    const dx = e.clientX - state.touchX;
    const y = state.touchY;
    state.touchX = null;
    state.touchY = null;
    if (Math.abs(dx) > 22) {
      moveLane(dx > 0 ? 1 : -1);
      return;
    }

    if (typeof y === "number" && y > window.innerHeight * 0.62) trySlide();
    else tryJump();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);

  window.addEventListener("keydown", (e) => {
    if (paused) return;
    if (!state.running && (e.key === " " || e.key === "Enter")) {
      resetRun();
      return;
    }

    if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") moveLane(-1);
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") moveLane(1);
    if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") tryJump();
    if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") trySlide();
  });

  canvas.addEventListener("click", () => {
    if (!state.running && !paused) {
      resetRun();
      return;
    }
    if (state.running) tryJump();
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("playvex:pause", (e) => {
    const slug = e && e.detail && typeof e.detail.slug === "string" ? e.detail.slug : "";
    if (slug && slug !== GAME_SLUG) return;
    paused = true;
  });

  window.addEventListener("playvex:resume", (e) => {
    const slug = e && e.detail && typeof e.detail.slug === "string" ? e.detail.slug : "";
    if (slug && slug !== GAME_SLUG) return;
    paused = false;
  });

  window.addEventListener("playvex:restart", (e) => {
    const slug = e && e.detail && typeof e.detail.slug === "string" ? e.detail.slug : "";
    if (slug && slug !== GAME_SLUG) return;
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    paused = false;
    resetRun();
  });

  resize();
  draw(0);
  requestAnimationFrame(frame);
})();
