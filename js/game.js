(function () {
  var CFG = window.LOVERBOY_CONFIG;
  var LEVELS = CFG.levels;

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var W = canvas.width, H = canvas.height;   // logical play-field size; fitCanvas() adapts it to the screen
  var GROUND_H = 20;

  var stageEl = document.getElementById("stage");
  var levelLabel = document.getElementById("levelLabel");
  var progressLabel = document.getElementById("progressLabel");
  var overlay = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlayTitle");
  var overlayText = document.getElementById("overlayText");
  var introDetails = document.getElementById("introDetails");
  var finaleExtra = document.getElementById("finaleExtra");
  var emailForm = document.getElementById("emailForm");
  var emailInput = document.getElementById("emailInput");
  var emailError = document.getElementById("emailError");
  var emailSuccess = document.getElementById("emailSuccess");
  var playAgainBtn = document.getElementById("playAgainBtn");
  var revealEl = document.getElementById("reveal");
  var revealArt = document.getElementById("revealArt");
  var revealTile = document.getElementById("revealTile");
  var revealNum = document.getElementById("revealNum");
  var revealTitle = document.getElementById("revealTitle");
  var revealProgress = document.getElementById("revealProgress");
  var tracksEl = document.getElementById("tracks");

  var GRAVITY = 0.42;
  var FLAP_V = -7.4;
  var RADIUS = 14;
  var PLAYER_X = 150;   // ~23.5% of W
  var PIPE_WIDTH = 58;
  var PIPE_SPACING = 250;
  var PREVIEW_MS = CFG.previewMs || 10000;
  var NO_AUDIO_PREVIEW_MS = 3500;

  var STORAGE_KEY = "loverboy_oclock_progress_v3";
  var EMAIL_KEY = "loverboy_oclock_email_v1";
  var completedLevels = 0;
  try {
    var stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) completedLevels = Math.max(0, Math.min(7, parseInt(stored, 10) || 0));
  } catch (e) {}
  var savedEmail = null;
  try { savedEmail = window.localStorage.getItem(EMAIL_KEY); } catch (e) {}

  function saveProgress() {
    try { window.localStorage.setItem(STORAGE_KEY, String(completedLevels)); } catch (e) {}
  }

  var currentLevel = Math.min(completedLevels, LEVELS.length - 1);
  var state = completedLevels >= LEVELS.length ? "finale" : "intro";
  var player, pipes, pipesPassed, particles;
  var previewTimer = null;
  var currentAudioTrack = -1;

  var audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
  }
  function tone(f1, f2, dur, type, vol) {
    if (!audioCtx) return;
    try {
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f1, audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(f2, audioCtx.currentTime + dur);
      gain.gain.setValueAtTime(vol, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }
  function sfxFlap() { tone(520, 700, 0.09, "sine", 0.16); }
  function sfxFail() { tone(300, 90, 0.35, "sawtooth", 0.18); }
  function sfxUnlock() {
    tone(440, 440, 0.1, "triangle", 0.18);
    setTimeout(function () { tone(554, 554, 0.1, "triangle", 0.18); }, 90);
    setTimeout(function () { tone(659, 659, 0.16, "triangle", 0.18); }, 180);
  }
  // Haptics. Android/Chrome: Vibration API. iPhone Safari has no Vibration API, but (iOS 17.4+)
  // toggling a hidden <input type=checkbox switch> gives the system's light haptic tick.
  var HAPTIC_PATTERNS = { flap: [10], pass: [25], fail: [50, 40, 150], unlock: [30, 50, 30, 50, 100] };
  var HAPTIC_TICKS = { flap: 1, pass: 1, fail: 2, unlock: 3 };
  var canVibrate = typeof navigator.vibrate === "function";
  var hapticLabel = null;
  (function setupSwitchHaptic() {
    if (canVibrate) return;
    try {
      hapticLabel = document.createElement("label");
      hapticLabel.setAttribute("aria-hidden", "true");
      hapticLabel.style.display = "none";
      var sw = document.createElement("input");
      sw.type = "checkbox";
      sw.setAttribute("switch", "");
      hapticLabel.appendChild(sw);
      document.head.appendChild(hapticLabel);
    } catch (e) { hapticLabel = null; }
  })();
  function haptic(kind) {
    if (canVibrate) {
      try { navigator.vibrate(HAPTIC_PATTERNS[kind] || 20); } catch (e) {}
      return;
    }
    if (!hapticLabel) return;
    var n = HAPTIC_TICKS[kind] || 1;
    for (var i = 0; i < n; i++) setTimeout(function () { try { hapticLabel.click(); } catch (e) {} }, i * 70);
  }
  function shakeStage() {
    stageEl.classList.remove("shake");
    void stageEl.offsetWidth;
    stageEl.classList.add("shake");
  }

  // Mobile browsers only let an <audio> element play later (the reveal happens without a tap)
  // if it was started by a real tap once. iOS ignores touchstart for this, so listen for
  // touchend/click/keydown and prime the element muted.
  var audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    ensureAudio();
    try { if (audioCtx && audioCtx.state === "suspended") audioCtx.resume(); } catch (e) {}
    try {
      previewAudio.muted = true;
      previewAudio.src = trackAudioSrc(0);
      var pr = previewAudio.play();
      var done = function () {
        if (currentAudioTrack === -1) { try { previewAudio.pause(); } catch (e) {} }
        previewAudio.muted = false;
      };
      if (pr && pr.then) pr.then(done, done); else done();
    } catch (e) { previewAudio.muted = false; }
  }
  ["touchend", "click", "keydown"].forEach(function (ev) {
    window.addEventListener(ev, unlockAudio, { once: true, passive: true });
  });

  function trackAudioSrc(lv) {
    return "audio/track-" + String(lv + 1).padStart(2, "0") + ".mp3";
  }
  var previewAudio = new Audio();
  previewAudio.loop = true;
  var audioFailed = false;
  previewAudio.addEventListener("error", function () { audioFailed = true; });
  previewAudio.addEventListener("loadstart", function () { audioFailed = false; });

  // Preview length: capped to the real clip length once metadata is known.
  function previewLength() {
    if (audioFailed) return NO_AUDIO_PREVIEW_MS;
    var d = previewAudio.duration;
    if (isFinite(d) && d > 0) return Math.min(PREVIEW_MS, Math.round(d * 1000));
    return PREVIEW_MS;
  }

  // Optional per-level background illustrations; canvas scene is the fallback.
  LEVELS.forEach(function (lv) {
    if (!lv.bg) return;
    var img = new Image();
    img.onload = function () { lv.bgImg = img; };
    img.src = lv.bg;
  });

  // Cut-out frames from the character sheet (assets/sprites/frames/).
  var FRAME_NAMES = ["jump-2", "jump-3", "hurt-1", "death-1", "death-2", "death-3", "death-4"];
  var FRAMES = {};
  FRAME_NAMES.forEach(function (n) {
    var img = new Image();
    img.src = "assets/sprites/frames/" + n + ".png";
    FRAMES[n] = img;
  });
  var SPRITE_SCALE = 0.5;       // source px -> canvas px
  var DEATH_FRAME_MS = 140;
  // Pillar obstacle art, sliced into cap / repeatable shaft / base (source px).
  var PILLAR = { src: "assets/obstacles/pillar-1.png", capH: 28, baseH: 15, tileY: 42, tileH: 28, scale: 1.55 };
  var pillarImg = new Image();
  pillarImg.src = PILLAR.src;
  var pillarTints = {};

  // Per-level colour cast so the stone belongs to each level's palette.
  function pillarFor(lv, L) {
    if (!pillarImg.complete || !pillarImg.naturalWidth) return null;
    if (pillarTints[lv]) return pillarTints[lv];
    var c = document.createElement("canvas");
    c.width = pillarImg.naturalWidth; c.height = pillarImg.naturalHeight;
    var g = c.getContext("2d");
    g.drawImage(pillarImg, 0, 0);
    g.globalCompositeOperation = "color";
    g.globalAlpha = 0.6;
    g.fillStyle = L.glow;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "lighter";   // lift the dark stone toward the level colour
    g.globalAlpha = 0.28;
    g.fillStyle = L.pipe;
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "destination-in";
    g.drawImage(pillarImg, 0, 0);
    pillarTints[lv] = c;
    return c;
  }

  var deathAt = 0;
  var bgPan = 0;
  var BG_PAN = 120;


  function gapMarginedGapY(lv) {
    var margin = 50;
    var gh = LEVELS[lv].gapH;
    return margin + gh / 2 + Math.random() * (H - GROUND_H - margin * 2 - gh);
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // Levels with a `move` block (config.js) get pillars that slide up/down at random.
  // Each moving pillar picks its own trigger points, so nobody can time it.
  function makePipe(x, lv) {
    var L = LEVELS[lv];
    var p = { x: x, gapY: gapMarginedGapY(lv), gapH: L.gapH, passed: false, mv: null };
    if (L.move && Math.random() < L.move.chance) {
      p.mv = {
        left: Math.random() < 0.4 ? 2 : 1,          // 1-2 shifts
        nextX: rand(MOVE_ZONE_MIN + 40, W - 40),    // first shift starts somewhere on screen
        active: false, target: p.gapY
      };
    }
    return p;
  }

  var MOVE_FREEZE_X = PLAYER_X + 60;   // gap locks just before it reaches the player
  var MOVE_ZONE_MIN = PLAYER_X + 150;


  function startMove(p, L) {
    var lo = 50 + p.gapH / 2, hi = H - GROUND_H - 50 - p.gapH / 2;
    var dist = rand(0.45, 1) * L.move.amp;
    var dir = Math.random() < 0.5 ? -1 : 1;
    var t = p.gapY + dir * dist;
    if (t < lo || t > hi) {                      // hit a wall of the play area: go the other way
      dir = -dir;
      t = p.gapY + dir * dist;
    }
    p.mv.target = Math.max(lo, Math.min(hi, t));
    p.mv.active = Math.abs(p.mv.target - p.gapY) > 12;
    if (!p.mv.active) p.mv.left--;
  }

  function stepPipeMove(p, L, dt) {
    var m = p.mv;
    if (!m || m.left <= 0) return;
    if (p.x <= MOVE_FREEZE_X) { m.active = false; m.left = 0; return; }
    if (!m.active) {
      if (p.x < m.nextX) startMove(p, L);
      return;
    }
    var step = L.move.vy * dt, d = m.target - p.gapY;
    if (Math.abs(d) <= step) {
      p.gapY = m.target;
      m.active = false;
      m.left--;
      m.nextX = p.x - rand(60, 130);             // maybe shift again a bit later
    } else {
      p.gapY += Math.sign(d) * step;
    }
  }
  function makeParticles(lv) {
    var arr = [];
    for (var i = 0; i < 16; i++) {
      arr.push({
        x: Math.random() * W,
        y: Math.random() * (H - GROUND_H),
        r: 1.5 + Math.random() * 2.2,
        speed: 0.15 + Math.random() * 0.3,
        drift: (Math.random() - 0.5) * 0.2,
        alpha: 0.15 + Math.random() * 0.25
      });
    }
    return arr;
  }

  function renderTracks() {
    tracksEl.innerHTML = "";
    for (var i = 0; i < LEVELS.length; i++) {
      var unlocked = i < completedLevels;
      var row = document.createElement("div");
      row.className = "track-row " + (unlocked ? "unlocked" : "locked");
      var name = document.createElement("span");
      name.textContent = (i + 1) + ". " + LEVELS[i].track;
      var status = document.createElement("span");
      status.textContent = unlocked ? "unlocked" : "locked";
      row.appendChild(name);
      row.appendChild(status);
      tracksEl.appendChild(row);
    }
  }

  function updateHud() {
    levelLabel.textContent = "Level " + (currentLevel + 1) + " of " + LEVELS.length;
    progressLabel.textContent = pipesPassed + " / " + LEVELS[currentLevel].need;
  }

  function showIntro(lv) {
    fitCanvas();
    overlay.classList.remove("full");
    currentLevel = lv;
    state = "intro";
    finaleExtra.style.display = "none";
    overlayTitle.style.display = "block";
    overlayTitle.className = lv === 0 ? "brand" : "";
    overlayTitle.textContent = lv === 0 ? "Loverboy O'Clock" : "Level " + (lv + 1) + ": " + LEVELS[lv].track;
    finaleExtra.style.display = "none";
    if (lv === 0) {
      overlayText.style.display = "none";
      introDetails.style.display = "flex";
    } else {
      overlayText.style.display = "block";
      overlayText.textContent = "Tap to start the next level.";
      introDetails.style.display = "none";
    }
    overlay.classList.remove("hide");
    pipesPassed = 0;
    particles = makeParticles(lv);
    updateHud();
  }

  function showGameOver() {
    overlay.classList.remove("full");
    state = "gameover";
    deathAt = Date.now();
    finaleExtra.style.display = "none";
    introDetails.style.display = "none";
    overlayTitle.style.display = "block";
    overlayText.style.display = "block";
    overlayTitle.className = "";
    overlayTitle.textContent = "Level failed";
    overlayText.textContent = "You reached " + pipesPassed + " of " + LEVELS[currentLevel].need + ". Tap to retry.";
    overlay.classList.remove("hide");
    try { previewAudio.pause(); } catch (e) {}
    sfxFail();
    haptic("fail");
    shakeStage();
  }

  function showFinale() {
    state = "finale";
    overlay.classList.add("full");
    introDetails.style.display = "none";
    overlayTitle.style.display = "none";
    overlayText.style.display = "none";
    finaleExtra.style.display = "flex";
    if (savedEmail) {
      emailForm.style.display = "none";
      emailSuccess.style.display = "block";
      emailSuccess.textContent = "You're on the list. Thank you for playing.";
    } else {
      emailForm.style.display = "flex";
      emailForm.style.flexDirection = "column";
      emailForm.style.gap = "8px";
      emailSuccess.style.display = "none";
    }
    overlay.classList.remove("hide");
  }

  function startLevel(lv) {
    fitCanvas();
    currentLevel = lv;
    pipesPassed = 0;
    player = { x: PLAYER_X, y: H / 2, vy: 0 };
    pipes = [];
    particles = makeParticles(lv);
    var startX = W + 100;
    for (var i = 0; i < 4; i++) pipes.push(makePipe(startX + i * PIPE_SPACING, lv));
    state = "playing";
    overlay.classList.add("hide");
    updateHud();

    if (lv > 0) {
      var bgIdx = lv - 1;
      if (currentAudioTrack !== bgIdx) {
        previewAudio.src = trackAudioSrc(bgIdx);
        previewAudio.currentTime = 0;
        currentAudioTrack = bgIdx;
      }
      previewAudio.volume = 0.35;
      previewAudio.play().catch(function () {});
    } else {
      try { previewAudio.pause(); } catch (e) {}
    }
  }

  var revealShownAt = 0;
  function triggerReveal(lv) {
    state = "reveal";
    revealShownAt = Date.now();
    overlay.classList.add("hide");
    var L = LEVELS[lv];
    revealArt.style.setProperty("--glow", L.glow);
    if (L.tile) { revealTile.src = L.tile; revealTile.style.display = ""; } else { revealTile.style.display = "none"; }
    revealTile.classList.remove("pop");
    void revealTile.offsetWidth;            // restart the pop-in animation
    revealTile.classList.add("pop");
    revealNum.textContent = String(lv + 1).padStart(2, "0");
    revealTitle.textContent = L.track;
    revealEl.classList.add("show");

    sfxUnlock();
    haptic("unlock");

    previewAudio.src = trackAudioSrc(lv);
    previewAudio.currentTime = 0;
    currentAudioTrack = lv;
    previewAudio.volume = 1.0;
    previewAudio.play().catch(function () {});

    revealProgress.style.transition = "none";
    revealProgress.style.width = "0%";
    void revealProgress.offsetWidth;

    // Wait briefly for clip metadata so the bar matches the real clip length.
    var started = false;
    function startBar() {
      if (started || state !== "reveal") return;
      started = true;
      var ms = previewLength();
      revealProgress.style.transition = "width " + ms + "ms linear";
      revealProgress.style.width = "100%";
      clearTimeout(previewTimer);
      previewTimer = setTimeout(function () { finishReveal(lv); }, ms);
    }
    previewAudio.addEventListener("loadedmetadata", startBar, { once: true });
    previewAudio.addEventListener("error", startBar, { once: true });
    setTimeout(startBar, 600);
  }

  function finishReveal(lv) {
    clearTimeout(previewTimer);
    previewAudio.volume = 0.35;
    revealEl.classList.remove("show");
    var next = lv + 1;
    if (next >= LEVELS.length) {
      showFinale();
    } else {
      showIntro(next);
    }
  }

  function onLevelCleared() {
    completedLevels = Math.max(completedLevels, currentLevel + 1);
    saveProgress();
    renderTracks();
    triggerReveal(currentLevel);
  }

  function flap() {
    ensureAudio();
    if (state === "intro" || state === "gameover") { startLevel(currentLevel); return; }
    if (state === "finale") { return; }
    if (state === "reveal") {
      if (Date.now() - revealShownAt < 900) return;
      finishReveal(currentLevel);
      return;
    }
    if (state === "playing") { player.vy = FLAP_V; sfxFlap(); if (canVibrate) haptic("flap"); }
  }

  // Posts to CFG.email.endpoint (Formspree-style JSON). With no endpoint set,
  // the address is only kept in this browser's localStorage.
  function submitEmail(val) {
    var cfg = CFG.email || {};
    if (!cfg.endpoint) return Promise.resolve();
    var body = {};
    body[cfg.field || "email"] = val;
    return fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); });
  }

  emailForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var val = emailInput.value.trim();
    var valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    if (!valid) {
      emailError.style.display = "block";
      return;
    }
    emailError.style.display = "none";
    emailError.textContent = "Enter a valid email first.";
    var submitBtn = emailForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitEmail(val).then(function () {
      try { window.localStorage.setItem(EMAIL_KEY, val); } catch (e) {}
      savedEmail = val;
      emailForm.style.display = "none";
      emailSuccess.style.display = "block";
      emailSuccess.textContent = "You're on the list (" + val + ") — we'll send your early-access link before release.";
    }).catch(function () {
      emailError.textContent = "Couldn't save that right now — please try again.";
      emailError.style.display = "block";
    }).then(function () { submitBtn.disabled = false; });
  });

  playAgainBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    completedLevels = 0;
    saveProgress();
    renderTracks();
    currentAudioTrack = -1;
    try { previewAudio.pause(); } catch (err) {}
    showIntro(0);
  });

  function update(dt) {
    for (var pi = 0; pi < (particles ? particles.length : 0); pi++) {
      var pt = particles[pi];
      pt.y -= pt.speed * dt;
      pt.x += pt.drift * dt;
      if (pt.y < -5) { pt.y = H - GROUND_H + 5; pt.x = Math.random() * W; }
    }

    if (state === "gameover" && player) {
      var floorY = H - GROUND_H - RADIUS;
      if (player.y < floorY) {
        player.vy += GRAVITY * dt;
        player.y = Math.min(floorY, player.y + player.vy * dt);
      }
    }

    if (state !== "playing") return;
    var L = LEVELS[currentLevel];

    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;

    if (player.y - RADIUS <= 0) { player.y = RADIUS; player.vy = 0; }
    if (player.y + RADIUS >= H - GROUND_H) { showGameOver(); return; }

    for (var i = 0; i < pipes.length; i++) {
      var p = pipes[i];
      p.x -= L.speed * dt;
      stepPipeMove(p, L, dt);

      var withinX = player.x + RADIUS > p.x && player.x - RADIUS < p.x + PIPE_WIDTH;
      if (withinX) {
        var gapTop = p.gapY - p.gapH / 2;
        var gapBottom = p.gapY + p.gapH / 2;
        if (player.y - RADIUS < gapTop || player.y + RADIUS > gapBottom) {
          showGameOver();
          return;
        }
      }

      if (!p.passed && p.x + PIPE_WIDTH < player.x) {
        p.passed = true;
        pipesPassed++;
        updateHud();
        if (pipesPassed < L.need) haptic("pass");
        if (pipesPassed >= L.need) {
          onLevelCleared();
          return;
        }
      }
    }

    if (pipes[0].x + PIPE_WIDTH < -20) {
      pipes.shift();
      pipes.push(makePipe(pipes[pipes.length - 1].x + PIPE_SPACING, currentLevel));
    }
  }

  function drawTower(cx, baseY, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(cx - w / 2, baseY - h, w, h);
    var teeth = 3, tw = w / (teeth * 2);
    for (var t = 0; t < teeth; t++) {
      ctx.fillRect(cx - w / 2 + t * tw * 2, baseY - h - 8, tw, 8);
    }
  }
  function drawHill(cx, baseY, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, baseY, r, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  }
  function drawSunburst(cx, cy, r, fillColor, rayColor) {
    ctx.strokeStyle = rayColor;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 2;
    for (var a = 0; a < 8; a++) {
      var ang = (a / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * (r + 6), cy + Math.sin(ang) * (r + 6));
      ctx.lineTo(cx + Math.cos(ang) * (r + 18), cy + Math.sin(ang) * (r + 18));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSceneForLevel(lv, L, baseY) {
    var cx = W / 2;
    ctx.globalAlpha = 0.6;
    if (lv === 0) {
      drawTower(cx - 60, baseY, 26, 74, L.skyDeep);
      drawTower(cx + 60, baseY, 26, 74, L.skyDeep);
      ctx.fillStyle = L.skyDeep;
      ctx.fillRect(cx - 34, baseY - 34, 68, 34);
      ctx.fillStyle = L.sky;
      ctx.fillRect(cx - 14, baseY - 30, 28, 30);
    } else if (lv === 1) {
      drawTower(cx - 60, baseY, 26, 74, L.skyDeep);
      drawTower(cx + 60, baseY, 26, 74, L.skyDeep);
      ctx.fillStyle = L.skyDeep;
      ctx.fillRect(cx - 34, baseY - 34, 24, 34);
      ctx.fillRect(cx + 10, baseY - 34, 24, 34);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = L.glow;
      ctx.beginPath();
      ctx.arc(cx, baseY - 55, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (lv === 2) {
      ctx.fillStyle = L.skyDeep;
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      var pts = [18, 55, 30, 68, 12, 60, 40, 70, 22];
      var stepX = W / (pts.length - 1);
      for (var i = 0; i < pts.length; i++) ctx.lineTo(i * stepX, baseY - pts[i]);
      ctx.lineTo(W, baseY);
      ctx.closePath();
      ctx.fill();
    } else if (lv === 3) {
      drawHill(cx - 140, baseY, 90, L.skyDeep);
      drawHill(cx + 40, baseY, 110, L.skyDeep);
      drawHill(cx + 220, baseY, 80, L.skyDeep);
      ctx.globalAlpha = 0.8;
      drawSunburst(cx + 60, baseY - 10, 22, L.glow, L.glow);
    } else if (lv === 4) {
      drawHill(cx - 90, baseY, 60, L.skyDeep);
      drawHill(cx + 90, baseY, 60, L.skyDeep);
      ctx.strokeStyle = L.glow;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 90, baseY - 66);
      ctx.lineTo(cx + 90, baseY - 66);
      ctx.stroke();
    } else if (lv === 5) {
      drawHill(cx, baseY, 130, L.skyDeep);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = L.glow;
      ctx.beginPath();
      ctx.arc(cx, baseY - 40, 26, 0, Math.PI * 2);
      ctx.fill();
    } else {
      drawTower(cx - 160, baseY, 24, 60, L.skyDeep);
      drawTower(cx + 160, baseY, 24, 60, L.skyDeep);
      ctx.globalAlpha = 0.9;
      drawSunburst(cx, baseY - 90, 30, L.glow, L.glow);
    }
    ctx.globalAlpha = 1;
  }

  function drawBackdrop(L) {
    ctx.fillStyle = L.sky;
    ctx.fillRect(0, 0, W, H);

    var baseY = H - GROUND_H - 6;
    if (L.bgImg) {
      var s = Math.max(W / L.bgImg.width, H / L.bgImg.height);
      var bw = L.bgImg.width * s, bh = L.bgImg.height * s;
      // Camera starts centred and drifts right by up to BG_PAN px as the level progresses.
      var frac = state === "playing" || state === "gameover" ? pipesPassed / L.need : 0;
      bgPan += (frac - bgPan) * 0.04;
      var pan = Math.min((bw - W) / 2, BG_PAN) * bgPan;
      ctx.drawImage(L.bgImg, (W - bw) / 2 - pan, (H - bh) / 2, bw, bh);
    } else {
      drawSceneForLevel(currentLevel, L, baseY);
    }

    if (particles) {
      ctx.fillStyle = L.glow;
      for (var pi = 0; pi < particles.length; pi++) {
        var pt = particles[pi];
        ctx.globalAlpha = pt.alpha;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // Stone column: shaded shaft, mortar lines, and a wider cap on the gap side.
  function drawPillar(img, cx, y, h, flip) {
    var s = PILLAR.scale, dw = img.width * s;
    var capH = PILLAR.capH * s, baseH = PILLAR.baseH * s;
    if (capH + baseH > h) { var k = h / (capH + baseH); capH *= k; baseH *= k; }
    var shaftH = h - capH - baseH;
    ctx.save();
    if (flip) { ctx.translate(0, 2 * y + h); ctx.scale(1, -1); } // hangs from the ceiling, cap faces the gap
    ctx.translate(cx - dw / 2, 0);
    ctx.drawImage(img, 0, 0, img.width, PILLAR.capH, 0, y, dw, capH);
    if (shaftH > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, y + capH, dw, shaftH); ctx.clip();
      var tileDH = PILLAR.tileH * s;
      for (var yy = y + capH; yy < y + capH + shaftH; yy += tileDH) {
        ctx.drawImage(img, 0, PILLAR.tileY, img.width, PILLAR.tileH, 0, yy, dw, tileDH);
      }
      ctx.restore();
    }
    ctx.drawImage(img, 0, img.height - PILLAR.baseH, img.width, PILLAR.baseH, 0, y + h - baseH, dw, baseH);
    ctx.restore();
  }

  function drawColumn(x, y, h, L, capAtBottom) {
    if (h <= 0) return;
    var art = pillarFor(currentLevel, L);
    if (art) { drawPillar(art, x + PIPE_WIDTH / 2, y, h, capAtBottom); return; }
    var shade = ctx.createLinearGradient(x, 0, x + PIPE_WIDTH, 0);
    shade.addColorStop(0, "rgba(255,255,255,0.14)");
    shade.addColorStop(0.35, "rgba(255,255,255,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.32)");
    ctx.fillStyle = L.pipe;
    ctx.fillRect(x, y, PIPE_WIDTH, h);
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, PIPE_WIDTH, h);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    for (var my = y + 22; my < y + h; my += 22) ctx.fillRect(x, my, PIPE_WIDTH, 2);
    var capH = Math.min(14, h), capY = capAtBottom ? y + h - capH : y;
    ctx.fillStyle = L.pipe;
    ctx.fillRect(x - 4, capY, PIPE_WIDTH + 8, capH);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x - 4, capY, PIPE_WIDTH + 8, 2);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x - 4, capY + capH - 2, PIPE_WIDTH + 8, 2);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, PIPE_WIDTH - 1, h - 1);
  }

  function draw() {
    var L = LEVELS[currentLevel];
    drawBackdrop(L);

    if (state === "playing" || state === "gameover") {
      for (var i = 0; i < pipes.length; i++) {
        var p = pipes[i];
        var gapTop = p.gapY - p.gapH / 2;
        var gapBottom = p.gapY + p.gapH / 2;
        drawColumn(p.x, 0, gapTop, L, true);
        drawColumn(p.x, gapBottom, H - GROUND_H - gapBottom, L, false);
      }
    }

    ctx.fillStyle = L.pipe;
    ctx.fillRect(0, H - GROUND_H, W, GROUND_H);

    if (player) {
      var name, bottomAnchored = false;
      if (state === "gameover") {
        var di = Math.floor((Date.now() - deathAt) / DEATH_FRAME_MS);
        name = di <= 0 ? "hurt-1" : "death-" + Math.min(4, di);
        bottomAnchored = di > 0;
      } else {
        name = player.vy < -1 ? "jump-2" : "jump-3";
      }
      var img = FRAMES[name];
      var angle = state === "gameover" ? 0 : Math.max(-0.35, Math.min(0.5, player.vy * 0.04));

      ctx.save();
      ctx.translate(player.x, player.y);
      if (img && img.complete && img.naturalWidth > 0) {
        var dw = img.naturalWidth * SPRITE_SCALE, dh = img.naturalHeight * SPRITE_SCALE;
        ctx.rotate(angle);
        // Soft rim light so the dark character reads against dark levels.
        ctx.shadowColor = L.glow;
        ctx.shadowBlur = 8;
        var oy = bottomAnchored ? RADIUS - dh : -dh / 2;
        ctx.drawImage(img, -dw / 2, oy, dw, dh);
      } else {
        ctx.beginPath();
        ctx.fillStyle = L.ball;
        ctx.arc(0, 0, RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Desktop / landscape: 640x400 (16:10). Portrait phones: a narrower, slightly taller field (500 wide)
  // so everything is drawn ~25% bigger on a narrow screen. Height follows the stage box but stays
  // within 400-440 so pillar spacing (and difficulty) is basically unchanged.
  var phoneMQ = window.matchMedia("(max-width: 640px) and (orientation: portrait)");
  function fitCanvas() {
    var w = 640, h = 400;
    if (phoneMQ.matches) {
      w = 500;
      var ratio = stageEl.clientHeight / Math.max(1, stageEl.clientWidth);
      h = Math.round(Math.max(400, Math.min(440, w * ratio)));
    }
    if (w === W && h === H) return;
    W = w; H = h;
    canvas.width = w; canvas.height = h;
    PLAYER_X = Math.round(W * 0.235);
    MOVE_FREEZE_X = PLAYER_X + 60;
    MOVE_ZONE_MIN = PLAYER_X + 150;
    if (particles) particles = makeParticles(currentLevel);
  }
  var fitTimer = null;
  function scheduleFit() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(function () { if (state !== "playing") fitCanvas(); }, 150);
  }
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("orientationchange", scheduleFit);
  fitCanvas();

  renderTracks();
  if (state === "intro") {
    showIntro(currentLevel);
  } else {
    particles = makeParticles(currentLevel);
    showFinale();
  }
  draw();

  var lastTime = null;
  function loop(ts) {
    if (lastTime === null) lastTime = ts;
    var dt = Math.min(2, (ts - lastTime) / 16.6667);
    lastTime = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function flapEventHandler(e) {
    var tag = e.target.tagName;
    if (tag === "INPUT" || tag === "BUTTON" || tag === "LABEL" || tag === "FORM") return;
    if (state === "finale") return;   // let the end screen scroll / focus the form
    if (e.type === "touchstart") e.preventDefault();
    flap();
  }
  stageEl.addEventListener("touchend", function (e) {
    if (!canVibrate && state === "playing") haptic("flap");
  }, { passive: true });
  stageEl.addEventListener("click", flapEventHandler);
  stageEl.addEventListener("touchstart", flapEventHandler, { passive: false });
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); flap(); }
  });
})();
