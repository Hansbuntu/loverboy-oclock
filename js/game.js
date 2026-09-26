(function () {
  var CFG = window.LOVERBOY_CONFIG;
  var LEVELS = CFG.levels;

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  // All game maths runs in a logical play-field (W x H). The canvas backing store is sized to the
  // screen's real pixels (SCALE = device px per logical px) so art and text stay sharp on phones.
  var W = 640, H = 400;
  var SCALE = 1;
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
  var readyHint = document.getElementById("readyHint");
  var readyTitle = document.getElementById("readyTitle");
  var failCard = document.getElementById("failCard");
  var failTitle = document.getElementById("failTitle");
  var failScore = document.getElementById("failScore");
  var failBest = document.getElementById("failBest");
  var overlayKicker = document.getElementById("overlayKicker");
  var readyKicker = document.getElementById("readyKicker");
  var clockEl = document.getElementById("clock");
  var clockMin = document.getElementById("clockMin");
  var clockHour = document.getElementById("clockHour");
  var clockFill = document.getElementById("clockFill");

  // Physics runs at a fixed 60 steps/second (same numbers the levels were tuned with), so jump
  // height and speed are identical on 60, 90 and 120 Hz screens. Rendering interpolates between steps.
  var STEP_MS = 1000 / 60;
  var GRAVITY = 0.42;
  var FLAP_V = -7.4;
  var RADIUS = 14;
  var PLAYER_X = 150;   // ~23.5% of W
  var PIPE_WIDTH = 58;
  var PIPE_SPACING = 250;
  var NEAR_MISS_PX = 9;   // clearance that counts as a "close!" pass
  var RETRY_LOCK_MS = 420;
  var PREVIEW_MS = CFG.previewMs || 10000;
  var NO_AUDIO_PREVIEW_MS = 3500;
  var MUSIC_VOL = 0.35;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var STORAGE_KEY = "loverboy_oclock_progress_v3";
  var EMAIL_KEY = "loverboy_oclock_email_v1";
  var BEST_KEY = "loverboy_oclock_best_v1";
  var completedLevels = 0;
  try {
    var stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) completedLevels = Math.max(0, Math.min(7, parseInt(stored, 10) || 0));
  } catch (e) {}
  var savedEmail = null;
  try { savedEmail = window.localStorage.getItem(EMAIL_KEY); } catch (e) {}
  var best = [];
  try { best = JSON.parse(window.localStorage.getItem(BEST_KEY)) || []; } catch (e) { best = []; }

  function saveProgress() {
    try { window.localStorage.setItem(STORAGE_KEY, String(completedLevels)); } catch (e) {}
  }
  function saveBest() {
    try { window.localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch (e) {}
  }

  var currentLevel = Math.min(completedLevels, LEVELS.length - 1);
  // intro -> ready (hovering, waiting for first tap) -> playing -> dying -> gameover (retry)
  //                                                           \-> clear -> reveal -> intro (next) / finale
  var state = completedLevels >= LEVELS.length ? "finale" : "intro";
  var stateT = 0;          // ms spent in the current state (advanced by the fixed step)
  var player = null, pipes = [], pipesPassed = 0, fx = [];
  var hitStop = 0, trauma = 0, flash = 0, flashColor = "#fff", bgPan = 0, failShownAt = 0;
  var groundX = 0, pGroundX = 0, heartBoost = 0;
  var previewTimer = null;
  var currentAudioTrack = -1;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) { var c = hexRgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function mix(hexA, hexB, t) {
    var a = hexRgb(hexA), b = hexRgb(hexB);
    return "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")";
  }

  // =====================================================================================
  // Sound: everything is synthesized with Web Audio (no files). Chimes share a small echo.
  // =====================================================================================
  var audioCtx = null, sfxBus = null, verbSend = null, noiseBuf = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    }
    if (audioCtx.state !== "running") { try { audioCtx.resume(); } catch (e) {} }
    if (!sfxBus) buildSfxBus();
  }
  function buildSfxBus() {
    try {
      var comp = audioCtx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
      comp.connect(audioCtx.destination);
      sfxBus = audioCtx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(comp);
      verbSend = audioCtx.createGain();
      verbSend.gain.value = 0.28;
      var d = audioCtx.createDelay(1);
      d.delayTime.value = 0.19;
      var fb = audioCtx.createGain();
      fb.gain.value = 0.33;
      var lp = audioCtx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 2600;
      verbSend.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(comp);
      noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
      var ch = noiseBuf.getChannelData(0);
      for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    } catch (e) { sfxBus = null; }
  }
  // One oscillator: fast attack, exponential decay, optional pitch glide / lowpass / echo.
  function voice(type, f0, f1, t, dur, peak, opts) {
    opts = opts || {};
    var o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + (opts.glide || dur));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    var out = g;
    if (opts.lp) {
      var f = audioCtx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = opts.lp;
      g.connect(f); out = f;
    }
    out.connect(sfxBus);
    if (opts.verb) out.connect(verbSend);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noise(t, dur, peak, type, f0, f1, q) {
    var s = audioCtx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    var f = audioCtx.createBiquadFilter();
    f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }
  function sfx(fn) {
    if (!audioCtx || !sfxBus) return;
    try { fn(audioCtx.currentTime + 0.005); } catch (e) {}
  }
  var PENTA = [0, 2, 4, 7, 9];
  function noteHz(base, step) {
    return base * Math.pow(2, (PENTA[step % 5] + 12 * Math.floor(step / 5)) / 12);
  }
  function sfxFlap() {
    sfx(function (t) {
      noise(t, 0.13, 0.2, "bandpass", 700, 1900, 1.4);   // whoosh
      voice("sine", 190, 290, t, 0.08, 0.06);
    });
  }
  // Each gap passed plays the next note of a pentatonic scale, so a run builds a little melody.
  function sfxPass(n) {
    sfx(function (t) {
      var f = noteHz(392, n);
      voice("sine", f, f, t, 0.5, 0.2, { verb: true });
      voice("triangle", f * 2, f * 2, t, 0.22, 0.05, { verb: true });
    });
  }
  function sfxNear() {
    sfx(function (t) {
      voice("sine", 1568, 1568, t + 0.04, 0.12, 0.09, { verb: true });
      voice("sine", 2093, 2093, t + 0.1, 0.2, 0.09, { verb: true });
      noise(t + 0.04, 0.12, 0.04, "highpass", 5000, 0, 0.7);
    });
  }
  function sfxCrash() {
    sfx(function (t) {
      voice("sine", 150, 42, t, 0.32, 0.55, { glide: 0.25 });                           // thud
      noise(t, 0.2, 0.3, "lowpass", 1400, 300, 0.8);                                    // crunch
      voice("sawtooth", 330, 38, t + 0.04, 0.62, 0.08, { glide: 0.6, lp: 1100, attack: 0.02 }); // tape winding down
    });
  }
  function sfxLand() {
    sfx(function (t) {
      voice("sine", 110, 50, t, 0.16, 0.22);
      noise(t, 0.1, 0.1, "lowpass", 600, 200);
    });
  }
  function sfxClear() {
    sfx(function (t) {
      var f = 659.25;                                   // bell (inharmonic partials) + sparkle
      [1, 2.76, 5.4, 8.93].forEach(function (m, i) {
        voice("sine", f * m, f * m, t, 1.6 - i * 0.3, 0.16 / (i + 1), { verb: true });
      });
      [0, 1, 2, 3].forEach(function (i) {
        var n = noteHz(784, i * 2);
        voice("triangle", n, n, t + 0.08 + i * 0.06, 0.3, 0.05, { verb: true });
      });
    });
  }
  function sfxThunder() {
    sfx(function (t) {
      noise(t, 1.9, 0.3, "lowpass", 240, 70, 0.7);
      voice("sine", 55, 36, t, 1.5, 0.16, { attack: 0.08 });
    });
  }
  function sfxUnlock() {
    sfx(function (t) {
      [523.25, 659.25, 783.99, 987.77].forEach(function (f, i) {
        voice("triangle", f, f, t + i * 0.07, 1.3, 0.1, { verb: true, attack: 0.02 });
        voice("sine", f / 2, f / 2, t + i * 0.07, 1.1, 0.05);
      });
    });
  }

  // =====================================================================================
  // Haptics. Android/Chrome: Vibration API. iPhone Safari has no Vibration API, but (iOS 17.4+)
  // toggling a hidden <input type=checkbox switch> gives the system's light haptic tick.
  // =====================================================================================
  var HAPTIC_PATTERNS = { flap: [10], pass: [25], near: [14, 30, 14], land: [30], fail: [50, 40, 150], unlock: [30, 50, 30, 50, 100] };
  var HAPTIC_TICKS = { flap: 1, pass: 1, near: 2, land: 1, fail: 2, unlock: 3 };
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

  // =====================================================================================
  // Music: the unlocked tracks. Routed through Web Audio when possible so it can be muffled
  // (lowpass) under menus and its volume actually works on iPhone (iOS ignores element.volume).
  // =====================================================================================
  function trackAudioSrc(lv) {
    return "audio/track-" + String(lv + 1).padStart(2, "0") + ".mp3";
  }
  var previewAudio = new Audio();
  previewAudio.loop = true;
  previewAudio.preload = "auto";
  // Let the pitch drop with the speed, like a cassette stopping.
  try { previewAudio.preservesPitch = false; previewAudio.mozPreservesPitch = false; previewAudio.webkitPreservesPitch = false; } catch (e) {}
  var audioFailed = false;
  previewAudio.addEventListener("error", function () { audioFailed = true; });
  previewAudio.addEventListener("loadstart", function () { audioFailed = false; });

  var musicFx = null;   // { lp, gain } once routed through Web Audio
  var tape = null;      // tape-stop ramp in progress
  var elFade = null;    // element-volume fade (fallback path)
  var musicTarget = 0;  // volume the music should be at (applied when Web Audio routing comes online)
  var musicWanted = false;
  function connectMusic() {
    if (musicFx || !audioCtx) return;
    try {
      var src = audioCtx.createMediaElementSource(previewAudio);
      var lp = audioCtx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 20000; lp.Q.value = 0.7;
      var g = audioCtx.createGain();
      g.gain.value = musicTarget;
      src.connect(lp); lp.connect(g); g.connect(audioCtx.destination);
      elFade = null;
      previewAudio.volume = 1;
      musicFx = { lp: lp, gain: g };
    } catch (e) { musicFx = null; }
  }
  function setMusicVolume(v, seconds) {
    seconds = seconds || 0.25;
    musicTarget = v;
    if (musicFx) {
      var t = audioCtx.currentTime;
      musicFx.gain.gain.cancelScheduledValues(t);
      musicFx.gain.gain.setTargetAtTime(v, t, seconds / 3);
    } else {
      elFade = { from: previewAudio.volume, to: v, t0: performance.now(), dur: seconds * 1000 };
    }
  }
  function setMusicVolumeNow(v) {
    musicTarget = v;
    if (musicFx) {
      var t = audioCtx.currentTime;
      musicFx.gain.gain.cancelScheduledValues(t);
      musicFx.gain.gain.setValueAtTime(v, t);
    } else {
      elFade = null;
      try { previewAudio.volume = v; } catch (e) {}
    }
  }
  function muffle(on) {
    if (!musicFx) return;
    var t = audioCtx.currentTime;
    musicFx.lp.frequency.cancelScheduledValues(t);
    musicFx.lp.frequency.setTargetAtTime(on ? 650 : 20000, t, 0.12);
  }
  function tapeStop() {
    if (previewAudio.paused || currentAudioTrack < 0) return;
    tape = { t0: performance.now(), dur: 750 };
    musicWanted = false;
    if (musicFx) setMusicVolume(0, 0.75);
  }
  function tickAudio(now) {
    if (tape) {
      var p = Math.min(1, (now - tape.t0) / tape.dur);
      try { previewAudio.playbackRate = Math.max(0.2, 1 - 0.8 * p * p); } catch (e) {}
      if (!musicFx) { try { previewAudio.volume = Math.max(0, MUSIC_VOL * (1 - p)); } catch (e) {} }
      if (p >= 1) {
        tape = null;
        try { previewAudio.pause(); previewAudio.playbackRate = 1; } catch (e) {}
      }
    }
    if (elFade) {
      var q = Math.min(1, (now - elFade.t0) / elFade.dur);
      try { previewAudio.volume = clamp(lerp(elFade.from, elFade.to, q), 0, 1); } catch (e) {}
      if (q >= 1) elFade = null;
    }
  }
  // Level N plays the track unlocked by level N-1 quietly underneath; it resumes (not restarts) on retry.
  function playMusicFor(lv) {
    if (lv <= 0) {
      musicWanted = false;
      tape = null;
      try { previewAudio.pause(); } catch (e) {}
      return;
    }
    var idx = lv - 1;
    tape = null;
    if (currentAudioTrack !== idx) {
      previewAudio.src = trackAudioSrc(idx);
      previewAudio.currentTime = 0;
      currentAudioTrack = idx;
    }
    try { previewAudio.playbackRate = 1; } catch (e) {}
    if (previewAudio.paused) setMusicVolumeNow(0);
    muffle(false);
    setMusicVolume(MUSIC_VOL, 0.6);
    musicWanted = true;
    previewAudio.play().catch(function () {});
  }

  // Mobile browsers only let an <audio> element play later (the reveal happens without a tap)
  // if it was started by a real tap once. iOS ignores touchstart for this, so listen for
  // touchend/click/keydown and prime the element muted.
  var audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    ensureAudio();
    connectMusic();
    if (currentAudioTrack !== -1) {
      if (musicWanted) previewAudio.play().catch(function () {});
      return;
    }
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
    window.addEventListener(ev, unlockAudio, { once: true, passive: true, capture: true });
  });

  // Preview length: capped to the real clip length once metadata is known.
  function previewLength() {
    if (audioFailed) return NO_AUDIO_PREVIEW_MS;
    var d = previewAudio.duration;
    if (isFinite(d) && d > 0) return Math.min(PREVIEW_MS, Math.round(d * 1000));
    return PREVIEW_MS;
  }

  // =====================================================================================
  // Asset loading. Only what the first screen needs is awaited behind the loading screen; the other
  // levels' backgrounds stream in afterwards. Images are decoded before use so the first frame doesn't hitch.
  // =====================================================================================
  function loadImg(src) {
    return new Promise(function (res) {
      var i = new Image();
      i.onload = function () { (i.decode ? i.decode() : Promise.resolve()).catch(function () {}).then(function () { res(i); }); };
      i.onerror = function () { res(null); };
      i.src = src;
    });
  }
  function whenReady(img) {
    return new Promise(function (res) {
      if (img.complete && img.naturalWidth) { res(); return; }
      img.addEventListener("load", function () { res(); }, { once: true });
      img.addEventListener("error", function () { res(); }, { once: true });
    });
  }
  // Optional per-level background illustrations; the canvas scene is the fallback.
  function loadBg(idx) {
    var lv = LEVELS[idx];
    if (!lv || !lv.bg) return Promise.resolve();
    if (!lv._bgPromise) lv._bgPromise = loadImg(lv.bg).then(function (img) { if (img) lv.bgImg = img; });
    return lv._bgPromise;
  }
  var BG_PAN = 120;
  // Pre-scaled, pre-cropped copy of the background at device resolution: only the strip the camera
  // can pan across, so each frame is a cheap 1:1 blit.
  function bgCanvasFor(L) {
    var img = L.bgImg;
    if (!img) return null;
    var key = W + "x" + H + "@" + SCALE;
    if (L._bgCache && L._bgCache.key === key) return L._bgCache;
    var s = Math.max(W / img.width, H / img.height);
    var bw = img.width * s, bh = img.height * s;
    var panMax = Math.max(0, Math.min((bw - W) / 2, BG_PAN));
    var vw = W + panMax;
    var c = document.createElement("canvas");
    c.width = Math.ceil(vw * SCALE);
    c.height = Math.ceil(H * SCALE);
    var g = c.getContext("2d");
    g.imageSmoothingEnabled = s * SCALE < 2;
    g.drawImage(img, ((bw - W) / 2) / s, ((bh - H) / 2) / s, vw / s, H / s, 0, 0, c.width, c.height);
    L._bgCache = { key: key, canvas: c, panMax: panMax, vw: vw, bw: bw, bh: bh, offX: (bw - W) / 2, offY: (bh - H) / 2 };
    return L._bgCache;
  }
  // Where a point of the background image (u, v as fractions) currently is on screen.
  function bgPoint(L, u, v) {
    var bg = L._bgCache;
    if (!bg) return null;
    var pan = Math.round(bg.panMax * bgPan * SCALE) / SCALE;
    return { x: u * bg.bw - bg.offX - pan, y: v * bg.bh - bg.offY };
  }
  function releaseOtherBgCaches(keep) {
    LEVELS.forEach(function (lv, i) { if (i !== keep) lv._bgCache = null; });
  }
  // Warm the HTTP cache so the reveal preview starts instantly when the level is cleared.
  var warmed = {};
  function warmAudio(lv) {
    if (warmed[lv] || typeof fetch !== "function") return;
    warmed[lv] = true;
    try { fetch(trackAudioSrc(lv), { cache: "force-cache" }).catch(function () {}); } catch (e) {}
  }

  // Cut-out frames from the character sheet (assets/sprites/frames/). fly-1 is jump-1 without its ground shadow.
  var FRAME_NAMES = ["fly-1", "jump-2", "jump-3", "hurt-1", "death-1", "death-2", "death-3", "death-4"];
  var FRAMES = {};
  FRAME_NAMES.forEach(function (n) {
    var img = new Image();
    img.src = "assets/sprites/frames/" + n + ".png";
    FRAMES[n] = img;
  });
  var SPRITE_SCALE = 0.5;       // source px -> logical px
  var DEATH_FRAME_MS = 110;
  // Character frame with its rim glow baked in, at device resolution (shadowBlur every frame is slow on phones).
  var glowCache = {};
  var GLOW_PAD = 14;
  function glowSprite(name, lv, L) {
    var key = name + "|" + lv;
    var hit = glowCache[key];
    if (hit) return hit;
    var img = FRAMES[name];
    if (!img || !img.complete || !img.naturalWidth) return null;
    var dw = img.naturalWidth * SPRITE_SCALE, dh = img.naturalHeight * SPRITE_SCALE, k = SCALE;
    var c = document.createElement("canvas");
    c.width = Math.ceil((dw + GLOW_PAD * 2) * k);
    c.height = Math.ceil((dh + GLOW_PAD * 2) * k);
    var g = c.getContext("2d");
    g.imageSmoothingEnabled = SPRITE_SCALE * k < 2;
    g.shadowColor = L.glow;
    g.shadowBlur = 8 * k;
    g.drawImage(img, GLOW_PAD * k, GLOW_PAD * k, dw * k, dh * k);
    hit = glowCache[key] = { canvas: c, w: dw, h: dh };
    return hit;
  }

  // Recolour art toward a level's palette (keeps the pixel detail, changes the cast).
  function tinted(src, L) {
    var w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var g = c.getContext("2d");
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = "color";
    g.globalAlpha = 0.6;
    g.fillStyle = L.glow;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";   // lift the dark stone toward the level colour
    g.globalAlpha = 0.28;
    g.fillStyle = L.pipe;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "destination-in";
    g.drawImage(src, 0, 0);
    return c;
  }

  // Pillar art, sliced into a decorated cap / repeatable shaft / base (source px). Hanging pillars are
  // always "plain"; standing ones are sometimes a banner or torch pillar. Each type is widened so its
  // shaft is never narrower than the collision box (shaftW source px -> SHAFT_W logical px): the art
  // may overhang the hitbox a little (forgiving), but never the other way round.
  var PILLAR_SCALE = 1.55, SHAFT_W = 56;
  var PILLAR_TYPES = {
    plain:  { src: "assets/obstacles/pillar-1.png", capH: 28, baseH: 15, tileY: 42, tileH: 28, shaftW: 36 },
    banner: { src: "assets/obstacles/pillar-3.png", capH: 54, baseH: 27, tileY: 58, tileH: 20, shaftW: 29 },
    torch:  { src: "assets/obstacles/pillar-5.png", capH: 40, baseH: 19, tileY: 52, tileH: 30, shaftW: 26, flameY: 8 }
  };
  var SPECIAL_PILLARS = ["banner", "torch"];
  Object.keys(PILLAR_TYPES).forEach(function (k) {
    var t = PILLAR_TYPES[k];
    t.sx = Math.max(PILLAR_SCALE, SHAFT_W / t.shaftW);
    t.img = new Image();
    t.img.src = t.src;
  });
  var pillarImg = PILLAR_TYPES.plain.img;
  var pillarTints = {};
  function pillarFor(lv, L, variant) {
    var t = PILLAR_TYPES[variant] || PILLAR_TYPES.plain;
    if (!t.img.complete || !t.img.naturalWidth) return null;
    var key = lv + "|" + variant;
    return pillarTints[key] || (pillarTints[key] = tinted(t.img, L));
  }

  // Ground: a stone-and-moss strip from the platform tiles, mirrored every other tile, tinted per level.
  var groundImg = new Image();
  groundImg.src = "assets/ground/ground-tile.png";
  var GROUND_SCALE = 0.75;
  function groundStripFor(L) {
    if (L._ground) return L._ground;
    if (!groundImg.complete || !groundImg.naturalWidth) return null;
    var tw = groundImg.naturalWidth, th = groundImg.naturalHeight;
    var u = document.createElement("canvas");
    u.width = tw * 2; u.height = th;
    var g = u.getContext("2d");
    g.drawImage(groundImg, 0, 0);
    g.translate(tw * 2, 0);
    g.scale(-1, 1);
    g.drawImage(groundImg, 0, 0);
    return (L._ground = tinted(u, L));
  }

  // =====================================================================================
  // Pillars
  // =====================================================================================
  function gapMarginedGapY(lv) {
    var margin = 50;
    var gh = LEVELS[lv].gapH;
    return margin + gh / 2 + Math.random() * (H - GROUND_H - margin * 2 - gh);
  }
  var MOVE_FREEZE_X = PLAYER_X + 60;   // gap locks just before it reaches the player
  var MOVE_ZONE_MIN = PLAYER_X + 150;

  // Levels with a `move` block (config.js) get pillars that slide up/down at random.
  // Each moving pillar picks its own trigger points, so nobody can time it.
  function makePipe(x, lv) {
    var L = LEVELS[lv];
    var p = { x: x, px: x, gapH: L.gapH, passed: false, mv: null, minClear: 999 };
    p.gapY = p.pgy = gapMarginedGapY(lv);
    if (L.move && Math.random() < L.move.chance) {
      p.mv = {
        left: Math.random() < 0.4 ? 2 : 1,          // 1-2 shifts
        nextX: rand(MOVE_ZONE_MIN + 40, W - 40),    // first shift starts somewhere on screen
        active: false, target: p.gapY
      };
    }
    // Decorated standing pillars need room for their cap + base, even after a slide.
    p.variant = "plain";
    p.seed = Math.random() * 1000;
    if (Math.random() < 0.5) {
      var room = H - GROUND_H - (p.gapY + p.gapH / 2) - (p.mv ? L.move.amp : 0);
      var fits = SPECIAL_PILLARS.filter(function (k) {
        var t = PILLAR_TYPES[k];
        return room >= (t.capH + t.baseH) * PILLAR_SCALE + 14;
      });
      if (fits.length) p.variant = pick(fits);
    }
    return p;
  }
  function startMove(p, L) {
    var lo = 50 + p.gapH / 2, hi = H - GROUND_H - 50 - p.gapH / 2;
    var dist = rand(0.45, 1) * L.move.amp;
    var dir = Math.random() < 0.5 ? -1 : 1;
    var t = p.gapY + dir * dist;
    if (t < lo || t > hi) {                      // hit a wall of the play area: go the other way
      dir = -dir;
      t = p.gapY + dir * dist;
    }
    p.mv.target = clamp(t, lo, hi);
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

  // =====================================================================================
  // Particles: level atmosphere (weather, foreground, vignette) plus effects (heart puffs, dust, sparks, stone debris, rings, text)
  // =====================================================================================
  // ---- Atmosphere: per-level weather (config fx.weather) + light on features painted in the background
  var weather = { lv: -1, type: "", parts: [], birds: [], t: 0 };
  var glowSprites = {};
  // Soft round glow in one colour, cached at device resolution; drawn scaled with "lighter".
  function glowDot(color) {
    var key = color + "@" + SCALE;
    if (glowSprites[key]) return glowSprites[key];
    var n = Math.max(8, Math.ceil(64 * SCALE)), c = document.createElement("canvas");
    c.width = c.height = n;
    var g = c.getContext("2d"), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, rgba(color, 1));
    gr.addColorStop(0.25, rgba(color, 0.55));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, n, n);
    return (glowSprites[key] = c);
  }
  function glowAt(color, x, y, r, a) {
    ctx.globalAlpha = a;
    ctx.drawImage(glowDot(color), x - r, y - r, r * 2, r * 2);
  }
  function newPetal(cols, anywhere) {
    return { k: "petal", x: rand(0, W + 60), y: anywhere ? rand(-20, H) : rand(-30, -8), vx: -rand(0.4, 1.2), vy: rand(0.5, 1.1),
      rot: rand(0, 6.28), vr: rand(-0.08, 0.08), ph: rand(0, 6.28), s: rand(2.2, 3.6), c: pick(cols) };
  }
  function newEmber(anywhere) {
    return { k: "ember", x: rand(0, W), y: anywhere ? rand(0, H) : H + rand(0, 20), vx: rand(-0.3, 0.3), vy: -rand(0.5, 1.3),
      ph: rand(0, 6.28), r: rand(1.3, 2.6), c: pick(["#ffb347", "#ff7a3d", "#ffd27a"]) };
  }
  function newBird(anywhere) {
    return { x: anywhere ? rand(W * 0.2, W + 80) : W + rand(20, 160), y: rand(H * 0.08, H * 0.34), vx: -rand(0.35, 0.75), ph: rand(0, 6.28), s: rand(3, 5) };
  }
  var PETALS_RED = ["#e0506f", "#ff7a93", "#b9344f"], PETALS_GOLD = ["#ffe7a3", "#ffd06b", "#fff6d8"];
  function initWeather(lv) {
    var L = LEVELS[lv], type = (L.fx && L.fx.weather) || "", floor = H - GROUND_H, i;
    weather = { lv: lv, type: type, parts: [], birds: [], t: 0, boltT: -1, nextBolt: rand(2500, 5000), thunderAt: Infinity, laser: 1 };
    var P = weather.parts;
    if (type === "mist") {
      for (i = 0; i < 26; i++) P.push({ k: "star", x: rand(0, W), y: rand(4, H * 0.42), r: rand(0.6, 1.3), ph: rand(0, 6.28), sp: rand(0.03, 0.08) });
      for (i = 0; i < 7; i++) P.push({ k: "fog", x: rand(-60, W + 60), y: rand(H * 0.4, floor), r: rand(70, 140), vx: -rand(0.12, 0.35), a: rand(0.05, 0.09), front: i < 3 });
    } else if (type === "petals" || type === "sunrise") {
      for (i = 0; i < 24; i++) P.push(newPetal(type === "petals" ? PETALS_RED : PETALS_GOLD, true));
    } else if (type === "storm") {
      for (i = 0; i < 80; i++) P.push({ k: "rain", x: rand(0, W + 60), y: rand(-H, H), len: rand(10, 18), v: rand(9, 13) });
    } else if (type === "fireflies") {
      for (i = 0; i < 18; i++) P.push({ k: "fly", bx: rand(0, W), by: rand(H * 0.3, floor - 10), ph: rand(0, 6.28), sp: rand(0.006, 0.014), ax: rand(14, 34), ay: rand(8, 20), drift: -rand(0.05, 0.2) });
      for (i = 0; i < 3; i++) weather.birds.push(newBird(true));
    } else if (type === "embers") {
      for (i = 0; i < 34; i++) P.push(newEmber(true));
    } else if (type === "dust") {
      for (i = 0; i < 30; i++) P.push({ k: "mote", x: rand(0, W), y: rand(0, floor), vx: rand(-0.25, 0.05), vy: rand(-0.12, 0.08), ph: rand(0, 6.28), r: rand(1, 2.2) });
    }
    P.forEach(function (p) { if (p.x === undefined) { p.x = p.bx; p.y = p.by; } p.px = p.x; p.py = p.y; });
  }
  function stepWeather() {
    var w = weather, floor = H - GROUND_H;
    w.t += STEP_MS;
    for (var i = 0; i < w.parts.length; i++) {
      var p = w.parts[i];
      p.px = p.x; p.py = p.y;
      if (p.k === "star") { p.ph += p.sp; }
      else if (p.k === "fog") { p.x += p.vx; if (p.x < -p.r) p.x = p.px = W + p.r; }
      else if (p.k === "petal") {
        p.ph += 0.03; p.x += p.vx + Math.sin(p.ph) * 0.4; p.y += p.vy; p.rot += p.vr;
        if (p.y > H + 10 || p.x < -20) { var np = newPetal(w.type === "petals" ? PETALS_RED : PETALS_GOLD, false); np.px = np.x; np.py = np.y; w.parts[i] = np; }
      } else if (p.k === "rain") {
        p.x -= 2.6; p.y += p.v;
        if (p.y > floor) { p.y = p.py = rand(-40, 0); p.x = p.px = rand(0, W + 80); }
      } else if (p.k === "fly") {
        p.ph += p.sp; p.bx += p.drift;
        if (p.bx < -40) p.bx += W + 80;
        p.x = p.bx + Math.sin(p.ph) * p.ax; p.y = p.by + Math.sin(p.ph * 1.7) * p.ay;
        if (Math.abs(p.x - p.px) > 50) p.px = p.x;
      } else if (p.k === "ember") {
        p.ph += 0.1; p.x += p.vx + Math.sin(p.ph * 0.3) * 0.3; p.y += p.vy;
        if (p.y < -10) { var ne = newEmber(false); ne.px = ne.x; ne.py = ne.y; w.parts[i] = ne; }
      } else if (p.k === "mote") {
        p.ph += 0.02; p.x += p.vx; p.y += p.vy + Math.sin(p.ph) * 0.05;
        if (p.x < -5) p.x = p.px = W + 5;
        if (p.y < -5) p.y = p.py = floor;
        if (p.y > floor + 5) p.y = p.py = 0;
      }
    }
    for (var b = 0; b < w.birds.length; b++) {
      var bd = w.birds[b];
      bd.px = bd.x; bd.x += bd.vx; bd.ph += 0.18;
      if (bd.x < -20) { w.birds[b] = newBird(false); w.birds[b].px = w.birds[b].x; }
    }
    if (w.type === "storm") {
      var live = state !== "reveal" && state !== "finale";
      if (w.t > w.nextBolt) { w.boltT = 0; w.nextBolt = w.t + rand(3500, 7500); if (live) w.thunderAt = w.t + rand(250, 900); }
      if (w.boltT >= 0) { w.boltT += STEP_MS; if (w.boltT > 700) w.boltT = -1; }
      if (w.t >= w.thunderAt) { w.thunderAt = Infinity; if (live) sfxThunder(); }
    }
    if (w.type === "embers" && Math.random() < 0.25) w.laser = rand(0.55, 1);
  }
  // Lightning: a double flicker, then a fade.
  function boltAlpha() {
    var t = weather.boltT;
    if (t < 0) return 0;
    if (t < 60) return 0.5;
    if (t < 130) return 0.08;
    if (t < 210) return 0.42;
    return 0.42 * Math.max(0, 1 - (t - 210) / 490);
  }
  function drawRays(cx, cy, n, spin, width, alpha, color) {
    var R = Math.max(W, H) * 1.3;
    var gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    gr.addColorStop(0, rgba(color, alpha));
    gr.addColorStop(0.55, rgba(color, alpha * 0.35));
    gr.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var a = spin + (i / n) * Math.PI * 2, wv = width * (0.7 + 0.3 * Math.sin(i * 2.3));
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a - wv) * R, cy + Math.sin(a - wv) * R);
      ctx.lineTo(cx + Math.cos(a + wv) * R, cy + Math.sin(a + wv) * R);
      ctx.closePath();
    }
    ctx.fill();
  }
  function drawWeatherBack(L, alpha) {
    var w = weather, f = L.fx || {}, i, p, x, y, t = w.t;
    if (w.lv !== currentLevel) return;
    ctx.globalCompositeOperation = "lighter";
    if (f.sun) {
      var s = bgPoint(L, f.sun.x, f.sun.y);
      if (s) {
        if (w.type === "sunrise") {
          drawRays(s.x, s.y, 14, t * 0.00006, 0.05, 0.1, "#fff1c2");
          glowAt("#ffe8a8", s.x, s.y, 70 + Math.sin(t / 900) * 6, 0.35);
        } else {
          drawRays(s.x, s.y, 6, 2.2 + Math.sin(t / 4000) * 0.08, 0.06, 0.07, "#fff0cc");
          glowAt("#ffe2b0", s.x, s.y, 44, 0.25);
        }
      }
    }
    if (f.crack) {
      var c0 = bgPoint(L, f.crack.x, f.crack.y0), c1 = bgPoint(L, f.crack.x, f.crack.y1);
      if (c0) {
        var pulse = 0.55 + 0.45 * Math.pow(Math.sin(t / 520), 2);
        for (y = c0.y; y <= c1.y; y += 9) glowAt("#ff5a3a", c0.x, y, 16, 0.14 * pulse);
        ctx.globalAlpha = 0.5 * pulse;
        ctx.fillStyle = "#ffb07a";
        ctx.fillRect(c0.x - 0.8, c0.y, 1.6, c1.y - c0.y);
      }
    }
    if (f.laser) {
      var l0 = bgPoint(L, f.laser.x0, f.laser.y), l1 = bgPoint(L, f.laser.x1, f.laser.y);
      if (l0) {
        var fl = w.laser;
        ctx.globalAlpha = 0.28 * fl;
        ctx.fillStyle = "#ff503c";
        ctx.fillRect(l0.x, l0.y - 3, l1.x - l0.x, 6);
        ctx.globalAlpha = 0.85 * fl;
        ctx.fillStyle = "#ffd6c8";
        ctx.fillRect(l0.x, l0.y - 0.7, l1.x - l0.x, 1.4);
        glowAt("#ff6a4a", l0.x, l0.y, 16, 0.5 * fl);
        glowAt("#ff6a4a", l1.x, l1.y, 16, 0.5 * fl);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    for (i = 0; i < w.parts.length; i++) {
      p = w.parts[i];
      x = lerp(p.px, p.x, alpha); y = lerp(p.py, p.y, alpha);
      if (p.k === "star") {
        ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(p.ph));
        ctx.fillStyle = "#dfe6ff";
        ctx.fillRect(x, y, p.r, p.r);
      } else if (p.k === "fog" && !p.front) {
        ctx.globalAlpha = p.a;
        ctx.drawImage(glowDot("#c9d3e6"), x - p.r, y - p.r * 0.45, p.r * 2, p.r * 0.9);
      } else if (p.k === "fly") {
        var pul = 0.5 + 0.5 * Math.sin(p.ph * 6);
        ctx.globalCompositeOperation = "lighter";
        glowAt("#f5e27a", x, y, 7 + pul * 4, 0.35 + 0.4 * pul);
        ctx.globalCompositeOperation = "source-over";
      } else if (p.k === "ember") {
        ctx.globalCompositeOperation = "lighter";
        var fk = 0.55 + 0.45 * Math.sin(p.ph * 3);
        glowAt("#ff7a3d", x + p.r / 2, y + p.r / 2, p.r * 4, 0.35 * fk);
        ctx.globalAlpha = fk;
        ctx.fillStyle = p.c;
        ctx.fillRect(x, y, p.r, p.r);
        ctx.globalCompositeOperation = "source-over";
      } else if (p.k === "mote") {
        ctx.globalCompositeOperation = "lighter";
        glowAt("#ffe7b0", x, y, p.r * 3, 0.3 + 0.2 * Math.sin(p.ph * 3));
        ctx.globalCompositeOperation = "source-over";
      }
    }
    if (w.birds.length) {
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "rgba(45,28,40,1)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (i = 0; i < w.birds.length; i++) {
        var bd = w.birds[i], bx = lerp(bd.px, bd.x, alpha), wing = Math.sin(bd.ph) * bd.s * 0.6;
        ctx.moveTo(bx - bd.s, bd.y - wing);
        ctx.lineTo(bx, bd.y);
        ctx.lineTo(bx + bd.s, bd.y - wing);
      }
      ctx.stroke();
    }
    if (w.type === "fireflies") {
      var hz = ctx.createLinearGradient(0, H * 0.45, 0, H);
      hz.addColorStop(0, "rgba(255,160,90,0)");
      hz.addColorStop(1, "rgba(255,160,90,0.16)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = hz;
      ctx.fillRect(0, H * 0.45, W, H * 0.55);
    }
    ctx.globalAlpha = 1;
  }
  function drawWeatherFront(L, alpha) {
    var w = weather, i, p, x, y;
    if (w.lv !== currentLevel) return;
    if (w.type === "storm") {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "#b9c6ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (i = 0; i < w.parts.length; i++) {
        p = w.parts[i];
        x = lerp(p.px, p.x, alpha); y = lerp(p.py, p.y, alpha);
        ctx.moveTo(x, y);
        ctx.lineTo(x + p.len * 0.25, y - p.len);
      }
      ctx.stroke();
    }
    for (i = 0; i < w.parts.length; i++) {
      p = w.parts[i];
      if (p.k === "petal") {
        x = lerp(p.px, p.x, alpha); y = lerp(p.py, p.y, alpha);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = p.c;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot);
        ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(p.ph * 2)));   // tumbling
        ctx.fillRect(-p.s, -p.s * 0.55, p.s * 2, p.s * 1.1);
        ctx.restore();
      } else if (p.k === "fog" && p.front) {
        x = lerp(p.px, p.x, alpha);
        ctx.globalAlpha = p.a * 0.8;
        ctx.drawImage(glowDot("#c9d3e6"), x - p.r, H - GROUND_H - p.r * 0.35, p.r * 2, p.r * 0.7);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- Foreground: dark rocks and grass along the bottom edge, scrolling faster than the pillars (depth)
  var FG_TW = 520, FG_H = 48, FG_SPEED = 1.35;
  function fgStripFor(L, lv) {
    var key = W + "x" + H + "@" + SCALE;
    if (L._fg && L._fg.key === key) return L._fg;
    var c = document.createElement("canvas");
    c.width = Math.ceil(FG_TW * SCALE);
    c.height = Math.ceil(FG_H * SCALE);
    var g = c.getContext("2d");
    g.scale(SCALE, SCALE);
    g.fillStyle = mix(L.skyDeep, "#000000", 0.6);
    var seed = lv * 9973 + 17;
    function sr() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    function wrapped(fn) { fn(0); fn(-FG_TW); fn(FG_TW); }   // shapes wrap around so the strip tiles
    var i;
    // rocks: irregular polygons, a few big, most small
    for (i = 0; i < 7; i++) {
      var rx = sr() * FG_TW, rw = i < 2 ? 22 + sr() * 16 : 8 + sr() * 12, rh = rw * (0.45 + sr() * 0.35), pts = [];
      var n = 5 + Math.floor(sr() * 3);
      for (var q = 0; q <= n; q++) {
        var tq = q / n;
        pts.push([rx - rw + tq * rw * 2, FG_H - Math.sin(tq * Math.PI) * rh * (0.75 + sr() * 0.4)]);
      }
      wrapped(function (o) {
        g.beginPath();
        g.moveTo(pts[0][0] + o, FG_H);
        pts.forEach(function (pt) { g.lineTo(pt[0] + o, pt[1]); });
        g.lineTo(pts[pts.length - 1][0] + o, FG_H);
        g.closePath();
        g.fill();
      });
    }
    // grass tufts, some tall
    for (i = 0; i < 34; i++) {
      var gx = sr() * FG_TW, nb = 3 + Math.floor(sr() * 6), gh = 6 + sr() * (i % 6 === 0 ? 30 : 14), blades = [];
      for (var bI = 0; bI < nb; bI++) blades.push({ dx: (bI - nb / 2) * 2, lean: (sr() - 0.5) * 8, h: gh * (0.55 + sr() * 0.45) });
      wrapped(function (o) {
        blades.forEach(function (bl) {
          g.beginPath();
          g.moveTo(gx + o + bl.dx - 1.1, FG_H);
          g.quadraticCurveTo(gx + o + bl.dx + bl.lean * 0.3, FG_H - bl.h * 0.6, gx + o + bl.dx + bl.lean, FG_H - bl.h);
          g.lineTo(gx + o + bl.dx + 1.1, FG_H);
          g.fill();
        });
      });
    }
    g.fillRect(0, FG_H - 4, FG_TW, 4);
    L._fg = { key: key, canvas: c };
    return L._fg;
  }

  // ---- Vignette: stronger in the guarded early hours, lifting as the story opens up
  var vignetteCache = null;
  function vignette() {
    var key = W + "x" + H + "@" + SCALE;
    if (vignetteCache && vignetteCache.key === key) return vignetteCache.canvas;
    var c = document.createElement("canvas");
    c.width = Math.ceil(W * SCALE); c.height = Math.ceil(H * SCALE);
    var g = c.getContext("2d");
    g.scale(SCALE, SCALE);
    var gr = g.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.32, W / 2, H * 0.48, Math.max(W, H) * 0.78);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    vignetteCache = { key: key, canvas: c };
    return c;
  }

  var MAX_FX = 180;
  function addFx(p) {
    if (fx.length >= MAX_FX) fx.shift();
    p.px = p.x; p.py = p.y;
    p.max = p.life;
    fx.push(p);
    return p;
  }
  function flapPuff(L) {
    for (var i = 0; i < 4; i++) {
      addFx({ k: "heart", layer: 0, x: player.x - 10 + rand(-6, 6), y: player.y + 14 + rand(-4, 4),
        vx: -rand(0.8, 2.4), vy: rand(0.3, 1.4), g: -0.015, drag: 0.97, life: Math.round(rand(30, 46)),
        size: rand(1.3, 1.9), color: i === 0 ? "#ff8fb1" : L.glow });
    }
    for (var j = 0; j < 3; j++) {
      addFx({ k: "dust", layer: 0, x: player.x - 6 + rand(-6, 6), y: player.y + 16,
        vx: -rand(0.5, 1.6), vy: rand(0.2, 0.9), g: 0, drag: 0.94, life: Math.round(rand(16, 26)),
        r: rand(2, 3.5), grow: 0.18, color: "rgba(255,255,255,0.55)" });
    }
  }
  function sparkBurst(x, y, n, color, speed) {
    for (var i = 0; i < n; i++) {
      var a = rand(0, Math.PI * 2), v = rand(0.4, 1) * (speed || 4);
      addFx({ k: "spark", layer: 1, x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.08, drag: 0.93,
        life: Math.round(rand(14, 26)), color: color || "#fff3c4" });
    }
  }
  function debrisBurst(x, y, color) {
    for (var i = 0; i < 10; i++) {
      addFx({ k: "deb", layer: 1, x: x + rand(-4, 4), y: y + rand(-4, 4), vx: rand(-3.2, 1.6), vy: rand(-4.5, -0.5),
        g: 0.32, drag: 0.99, life: Math.round(rand(40, 70)), s: rand(2, 4.5), rot: rand(0, 6), vr: rand(-0.3, 0.3), color: color });
    }
  }
  function dustBurst(x, y) {
    for (var i = 0; i < 8; i++) {
      addFx({ k: "dust", layer: 1, x: x + rand(-10, 10), y: y - rand(0, 4), vx: rand(-1.6, 1.6), vy: -rand(0.2, 1.1),
        g: 0.01, drag: 0.93, life: Math.round(rand(22, 36)), r: rand(3, 5), grow: 0.22, color: "rgba(230,220,205,0.6)" });
    }
  }
  function ringFx(x, y, color, r0, r1) {
    addFx({ k: "ring", layer: 1, x: x, y: y, vx: 0, vy: 0, g: 0, drag: 1, life: 20, r0: r0 || 14, r1: r1 || 40, color: color });
  }
  function textFx(x, y, str, color) {
    addFx({ k: "text", layer: 1, x: x, y: y, vx: 0, vy: -0.9, g: 0.02, drag: 0.98, life: 44, str: str, color: color });
  }
  function stepFx() {
    var floor = H - GROUND_H;
    for (var i = fx.length - 1; i >= 0; i--) {
      var p = fx[i];
      p.px = p.x; p.py = p.y;
      p.vy += p.g;
      p.vx *= p.drag; p.vy *= p.drag;
      p.x += p.vx; p.y += p.vy;
      if (p.k === "deb") {
        p.rot += p.vr;
        if (p.y > floor - 1) { p.y = floor - 1; p.vy *= -0.35; p.vx *= 0.6; p.vr *= 0.5; }
      }
      if (p.grow) p.r += p.grow;
      if (--p.life <= 0) fx.splice(i, 1);
    }
  }
  // 7x6 pixel heart
  var HEART = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
  function drawHeart(x, y, size, color, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    var ox = x - 3.5 * size, oy = y - 3 * size;
    for (var r = 0; r < 6; r++) {
      var row = HEART[r];
      for (var c = 0; c < 7; c++) if (row.charCodeAt(c) === 49) ctx.fillRect(ox + c * size, oy + r * size, size + 0.05, size + 0.05);
    }
  }
  function drawFx(layer, alpha) {
    for (var i = 0; i < fx.length; i++) {
      var p = fx[i];
      if (p.layer !== layer) continue;
      var x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha), t = p.life / p.max;
      if (p.k === "heart") {
        drawHeart(x, y, p.size * (0.5 + 0.5 * t), p.color, Math.min(1, t * 1.6) * 0.9);
      } else if (p.k === "dust") {
        ctx.globalAlpha = t * 0.7;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (p.k === "spark") {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = t;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 2.2, y - p.vy * 2.2); ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      } else if (p.k === "deb") {
        ctx.globalAlpha = Math.min(1, t * 3);
        ctx.fillStyle = p.color;
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
        ctx.restore();
      } else if (p.k === "ring") {
        var e = 1 - t;
        ctx.globalAlpha = t * 0.55;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2 * t + 0.5;
        ctx.beginPath(); ctx.arc(x, y, lerp(p.r0, p.r1, 1 - (1 - e) * (1 - e)), 0, Math.PI * 2); ctx.stroke();
      } else if (p.k === "text") {
        var pop = p.max - p.life < 6 ? 0.7 + 0.3 * ((p.max - p.life) / 6) * 1.15 : 1;
        ctx.globalAlpha = Math.min(1, t * 2.5);
        ctx.font = "700 " + Math.round(15 * pop) + 'px "Pixelify Sans", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(10,8,14,0.75)";
        ctx.strokeText(p.str, x, y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.str, x, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  // =====================================================================================
  // HUD, tracklist
  // =====================================================================================
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
  // HUD clock: the hour hand points at the level's hour, the minute hand sweeps once per level.
  (function buildClockTicks() {
    var g = document.getElementById("clockTicks");
    for (var i = 0; i < 12; i++) {
      var ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      var major = i % 3 === 0;
      ln.setAttribute("x1", "20"); ln.setAttribute("y1", "4.6");
      ln.setAttribute("x2", "20"); ln.setAttribute("y2", major ? "8.4" : "6.8");
      ln.setAttribute("transform", "rotate(" + i * 30 + " 20 20)");
      if (major) ln.setAttribute("class", "major");
      g.appendChild(ln);
    }
  })();
  var CLOCK_C = 2 * Math.PI * 8.5;
  function setClock(lv, frac, instant) {
    if (instant) { clockMin.style.transition = "none"; clockFill.style.transition = "none"; }
    clockMin.style.transform = "rotate(" + (frac * 360) + "deg)";
    clockHour.style.transform = "rotate(" + (((lv + 1) % 12) * 30) + "deg)";
    clockFill.style.strokeDasharray = (frac * CLOCK_C).toFixed(2) + " " + CLOCK_C.toFixed(2);
    if (instant) {
      void clockMin.getBoundingClientRect();
      clockMin.style.transition = ""; clockFill.style.transition = "";
    }
  }
  function strikeClock() {
    clockEl.classList.remove("strike");
    void clockEl.getBoundingClientRect();
    clockEl.classList.add("strike");
  }
  function hourLabel(lv) { return (lv + 1) + " O'Clock"; }
  function updateHud(bump) {
    var need = LEVELS[currentLevel].need;
    levelLabel.innerHTML = '<span class="hud-hour">' + hourLabel(currentLevel) + "</span><small>" + (currentLevel + 1) + "/" + LEVELS.length + "</small>";
    progressLabel.textContent = pipesPassed + " / " + need;
    setClock(currentLevel, Math.min(1, pipesPassed / need), !bump);
    if (bump) {
      progressLabel.classList.remove("bump");
      void progressLabel.offsetWidth;
      progressLabel.classList.add("bump");
    }
  }

  // =====================================================================================
  // Screens and flow
  // =====================================================================================
  function newPlayer() {
    var y = H * 0.45;
    return { x: PLAYER_X, ppx: PLAYER_X, y: y, py: y, vy: 0, rot: 0, prot: 0, s: 0, sv: 0,
      flapT: 999, spin: 0, grounded: false, groundT: 0 };
  }
  function setupLevel(lv) {
    fitCanvas();
    currentLevel = lv;
    releaseOtherBgCaches(lv);
    loadBg(lv + 1);
    warmAudio(lv);
    pipesPassed = 0;
    player = newPlayer();
    pipes = [];
    fx.length = 0;
    hitStop = 0; flash = 0; trauma = 0; heartBoost = 0;
    stageEl.style.setProperty("--level-glow", LEVELS[lv].glow);
    initWeather(lv);
    var startX = W + 100;
    for (var i = 0; i < 4; i++) pipes.push(makePipe(startX + i * PIPE_SPACING, lv));
    updateHud();
  }
  function hideFailCard() {
    failCard.classList.remove("show");
    stageEl.classList.remove("failed");
  }

  function showIntro(lv) {
    fitCanvas();
    overlay.classList.remove("full");
    currentLevel = lv;
    state = "intro";
    stateT = 0;
    player = null;
    pipes = [];
    fx.length = 0;
    hideFailCard();
    readyHint.classList.remove("show");
    finaleExtra.style.display = "none";
    overlayTitle.style.display = "block";
    overlayTitle.className = lv === 0 ? "brand" : "";
    overlayTitle.textContent = lv === 0 ? "Loverboy O'Clock" : LEVELS[lv].track;
    overlayKicker.textContent = "Level " + (lv + 1) + " \u00b7 " + hourLabel(lv);
    overlayKicker.style.display = lv === 0 ? "none" : "";
    stageEl.style.setProperty("--level-glow", LEVELS[lv].glow);
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
    initWeather(lv);
    muffle(true);
    updateHud();
  }

  // Hover in place until the first tap; gravity only starts when the player chooses.
  function enterReady(lv) {
    setupLevel(lv);
    state = "ready";
    stateT = 0;
    overlay.classList.add("hide");
    hideFailCard();
    readyTitle.textContent = LEVELS[lv].track;
    readyKicker.textContent = hourLabel(lv);
    readyHint.classList.add("show");
    playMusicFor(lv);
  }

  function startPlay() {
    state = "playing";
    stateT = 0;
    readyHint.classList.remove("show");
    doFlap();
  }

  function doFlap() {
    player.vy = FLAP_V;
    player.flapT = 0;
    player.s = 1;          // stretch upward, springs back
    player.sv = 0;
    flapPuff(LEVELS[currentLevel]);
    sfxFlap();
    if (canVibrate) haptic("flap");
  }

  function addTrauma(v) { trauma = Math.min(1, trauma + v * (reduceMotion ? 0.35 : 1)); }

  // kind: "ground", "top" (hit the hanging pillar) or "bottom" (hit the standing pillar)
  function crash(kind, hx, hy) {
    var L = LEVELS[currentLevel];
    flashColor = "#fff";
    state = "dying";
    stateT = 0;
    hitStop = 5;                                   // brief freeze-frame on impact
    addTrauma(kind === "ground" ? 0.55 : 0.75);
    flash = reduceMotion ? 0.3 : 0.75;
    player.vy = kind === "top" ? 1.5 : kind === "bottom" ? -5 : -3.5;   // knocked away from what was hit, then tumbles
    player.spin = (Math.random() < 0.5 ? -1 : 1) * rand(0.14, 0.22);
    player.grounded = false;
    if (kind !== "ground") debrisBurst(hx, hy, L.ball);
    sparkBurst(hx, hy, 12, "#ffffff", 4.5);
    sfxCrash();
    haptic("fail");
    tapeStop();
    muffle(true);
    readyHint.classList.remove("show");
  }

  function showFailCard() {
    if (state === "gameover") return;
    state = "gameover";
    failShownAt = performance.now();
    var lv = currentLevel, need = LEVELS[lv].need, prev = best[lv] || 0;
    var isBest = pipesPassed > prev;
    if (isBest) { best[lv] = pipesPassed; saveBest(); }
    failTitle.textContent = pipesPassed === need - 1 ? "So close!" : isBest && prev > 0 ? "New best" : pipesPassed === 0 ? "Try again" : "Keep going";
    failScore.textContent = pipesPassed + " / " + need;
    var bestNow = Math.max(prev, pipesPassed);
    failBest.textContent = "Best " + bestNow;
    failBest.style.display = bestNow > 0 ? "" : "none";
    failBest.classList.toggle("new", isBest && prev > 0);
    failCard.classList.add("show");
    stageEl.classList.add("failed");
  }

  function showFinale() {
    state = "finale";
    player = null;
    pipes = [];
    hideFailCard();
    readyHint.classList.remove("show");
    overlay.classList.add("full");
    introDetails.style.display = "none";
    overlayTitle.style.display = "none";
    overlayText.style.display = "none";
    overlayKicker.style.display = "none";
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

  // Last gap: a short slow-motion glide with a bell before the unlock card.
  function beginClear() {
    var L = LEVELS[currentLevel];
    state = "clear";
    stateT = 0;
    sparkBurst(player.x, player.y, 22, "#fff3c4", 5);
    ringFx(player.x, player.y, L.glow, 16, 70);
    for (var i = 0; i < 8; i++) {
      var ang = (i / 8) * Math.PI * 2;
      addFx({ k: "heart", layer: 1, x: player.x + Math.cos(ang) * 26, y: player.y + Math.sin(ang) * 26, vx: Math.cos(ang) * 1.6, vy: Math.sin(ang) * 1.6 - 1.2,
        g: 0.03, drag: 0.97, life: Math.round(rand(40, 60)), size: rand(1.1, 1.7), color: i % 2 ? "#ff8fb1" : L.glow });
    }
    heartBoost = 1;
    strikeClock();
    if (currentLevel === LEVELS.length - 1) {
      // 7 O'Clock: the heart finally bursts open
      flash = reduceMotion ? 0.25 : 0.55;
      flashColor = "#ffe7b0";
      ringFx(player.x, player.y, "#ff4d7a", 20, 120);
      ringFx(player.x, player.y, "#ffd27a", 10, 90);
      for (var j = 0; j < 22; j++) {
        var a2 = rand(0, Math.PI * 2), v2 = rand(2, 5);
        addFx({ k: "heart", layer: 1, x: player.x, y: player.y, vx: Math.cos(a2) * v2, vy: Math.sin(a2) * v2 - 1, g: 0.05, drag: 0.96,
          life: Math.round(rand(50, 80)), size: rand(1.4, 2.4), color: pick(["#ff4d7a", "#ff8fb1", "#ffd27a"]) });
      }
    }
    sfxClear();
    haptic("pass");
    if ((best[currentLevel] || 0) < L.need) { best[currentLevel] = L.need; saveBest(); }
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

    tape = null;
    previewAudio.src = trackAudioSrc(lv);
    previewAudio.currentTime = 0;
    currentAudioTrack = lv;
    try { previewAudio.playbackRate = 1; } catch (e) {}
    muffle(false);
    setMusicVolumeNow(0);
    setMusicVolume(1, 0.4);
    musicWanted = true;
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
    setMusicVolume(MUSIC_VOL, 0.5);
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
    if (state === "intro") { enterReady(currentLevel); return; }
    if (state === "ready") { startPlay(); return; }
    if (state === "gameover") {
      if (performance.now() - failShownAt >= RETRY_LOCK_MS) enterReady(currentLevel);
      return;
    }
    if (state === "finale" || state === "dying" || state === "clear") return;
    if (state === "reveal") {
      if (Date.now() - revealShownAt < 900) return;
      finishReveal(currentLevel);
      return;
    }
    if (state === "playing") doFlap();
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
    tape = null;
    musicWanted = false;
    try { previewAudio.pause(); } catch (err) {}
    showIntro(0);
  });

  // =====================================================================================
  // Simulation (one fixed 60 Hz step)
  // =====================================================================================
  function stepPlayerFeel() {
    // squash & stretch spring
    player.sv += -player.s * 0.3;
    player.sv *= 0.7;
    player.s += player.sv;
    player.flapT += STEP_MS;
    var target = clamp(player.vy * 0.055, -0.38, 0.75);
    player.rot += (target - player.rot) * 0.22;
  }

  function update() {
    // snapshot for render interpolation
    if (player) { player.ppx = player.x; player.py = player.y; player.prot = player.rot; }
    for (var s = 0; s < pipes.length; s++) { pipes[s].px = pipes[s].x; pipes[s].pgy = pipes[s].gapY; }

    flash *= 0.84;
    trauma = Math.max(0, trauma - 0.03);
    heartBoost *= 0.96;
    pGroundX = groundX;
    if (hitStop > 0) { hitStop--; return; }

    stateT += STEP_MS;
    var L = LEVELS[currentLevel];

    if (weather.lv >= 0) stepWeather();
    // ground + foreground scroll with the world (they keep moving while hovering, stop on a crash)
    var worldV = state === "playing" || state === "ready" ? L.speed : state === "clear" ? L.speed * Math.max(0.12, 1 - stateT / 700) : 0;
    groundX += worldV;
    stepFx();

    var frac = state === "playing" || state === "dying" || state === "gameover" || state === "clear" ? pipesPassed / L.need : 0;
    bgPan += (frac - bgPan) * 0.04;

    if (!player) return;

    if (state === "ready") {
      // tread air: gentle bob, frames alternate in draw()
      player.y = H * 0.45 + Math.sin(stateT / 260) * 7;
      player.vy = 0;
      player.rot = -0.06 + Math.sin(stateT / 260) * 0.05;
      player.sv += -player.s * 0.3; player.sv *= 0.7; player.s += player.sv;
      return;
    }

    if (state === "dying" || state === "gameover") {
      var floorY = H - GROUND_H - RADIUS;
      if (!player.grounded) {
        player.vy += GRAVITY;
        player.y = Math.max(RADIUS, player.y + player.vy);
        player.x -= 0.8;
        player.rot += player.spin;
        if (player.y >= floorY) {
          player.y = floorY;
          player.grounded = true;
          player.groundT = 0;
          player.rot = player.prot = 0;
          player.s = -0.9; player.sv = 0;   // squash on landing
          dustBurst(player.x, H - GROUND_H);
          addTrauma(0.25);
          sfxLand();
          haptic("land");
          showFailCard();
        }
      } else {
        player.groundT += STEP_MS;
        player.sv += -player.s * 0.3; player.sv *= 0.7; player.s += player.sv;
      }
      if (state === "dying" && stateT > 2500) showFailCard();
      return;
    }

    if (state === "clear") {
      var ts = Math.max(0.12, 1 - stateT / 700);   // world slows to a crawl
      for (var c = 0; c < pipes.length; c++) pipes[c].x -= L.speed * ts;
      player.vy = player.vy * 0.9 - 0.05;          // float gently
      player.y = clamp(player.y + player.vy * ts, RADIUS + 10, H - GROUND_H - RADIUS - 10);
      stepPlayerFeel();
      if (Math.random() < 0.3) sparkBurst(player.x + rand(-20, 20), player.y + rand(-20, 20), 1, L.glow, 1.5);
      if (stateT >= 950) onLevelCleared();
      return;
    }

    if (state !== "playing") return;

    player.vy += GRAVITY;
    player.y += player.vy;
    stepPlayerFeel();

    if (player.y - RADIUS <= 0) { player.y = RADIUS; player.vy = 0; }
    if (player.y + RADIUS >= H - GROUND_H) {
      player.y = H - GROUND_H - RADIUS;
      crash("ground", player.x, H - GROUND_H);
      return;
    }

    for (var i = 0; i < pipes.length; i++) {
      var p = pipes[i];
      p.x -= L.speed;
      stepPipeMove(p, L, 1);
      if (p.variant === "torch" && p.x > -40 && p.x < W && Math.random() < 0.18) {
        addFx({ k: "spark", layer: 0, x: p.x + PIPE_WIDTH / 2 + rand(-4, 4), y: p.gapY + p.gapH / 2 + PILLAR_TYPES.torch.flameY * PILLAR_SCALE,
          vx: -L.speed * 0.85 + rand(-0.3, 0.3), vy: -rand(0.6, 1.5), g: -0.01, drag: 0.99, life: Math.round(rand(18, 34)), color: "#ffb45a" });
      }

      var withinX = player.x + RADIUS > p.x && player.x - RADIUS < p.x + PIPE_WIDTH;
      if (withinX) {
        var gapTop = p.gapY - p.gapH / 2;
        var gapBottom = p.gapY + p.gapH / 2;
        var clearTop = (player.y - RADIUS) - gapTop, clearBottom = gapBottom - (player.y + RADIUS);
        var closest = Math.min(clearTop, clearBottom);
        if (closest < p.minClear) { p.minClear = closest; p.nearTop = clearTop < clearBottom; }
        if (clearTop < 0 || clearBottom < 0) {
          var hx = Math.max(p.x, player.x - RADIUS);
          crash(clearTop < 0 ? "top" : "bottom", hx, clearTop < 0 ? gapTop : gapBottom);
          return;
        }
      }

      if (!p.passed && p.x + PIPE_WIDTH < player.x) {
        p.passed = true;
        pipesPassed++;
        updateHud(true);
        sfxPass(pipesPassed - 1);
        if (p.minClear < NEAR_MISS_PX) {
          var ey = p.nearTop ? p.gapY - p.gapH / 2 : p.gapY + p.gapH / 2;
          sparkBurst(p.x + PIPE_WIDTH, ey, 10, L.glow, 3.5);
          textFx(player.x + 8, player.y - 30, "Close!", "#ffe39a");
          sfxNear();
          haptic("near");
        } else {
          ringFx(player.x, player.y, L.glow);
          if (pipesPassed < L.need) haptic("pass");
        }
        if (pipesPassed >= L.need) { beginClear(); return; }
      }
    }

    if (pipes[0].x + PIPE_WIDTH < -20) {
      pipes.shift();
      pipes.push(makePipe(pipes[pipes.length - 1].x + PIPE_SPACING, currentLevel));
    }
  }

  // =====================================================================================
  // Rendering
  // =====================================================================================
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
  // Fallback silhouettes, used only if a level's background image is missing.
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

  function drawBackdrop(L, alpha) {
    ctx.fillStyle = L.sky;
    ctx.fillRect(0, 0, W, H);
    var bg = bgCanvasFor(L);
    if (bg) {
      // Camera starts centred and drifts right as the level progresses; snapped to device pixels.
      var pan = Math.round(bg.panMax * bgPan * SCALE) / SCALE;
      ctx.drawImage(bg.canvas, -pan, 0, bg.vw, H);
    } else {
      drawSceneForLevel(currentLevel, L, H - GROUND_H - 6);
    }
  }

  function drawPillar(img, T, cx, y, h, flip) {
    var s = PILLAR_SCALE, dw = img.width * T.sx;
    var capH = T.capH * s, baseH = T.baseH * s;
    if (capH + baseH > h) { var k = h / (capH + baseH); capH *= k; baseH *= k; }
    var shaftH = h - capH - baseH;
    ctx.save();
    if (flip) { ctx.translate(0, 2 * y + h); ctx.scale(1, -1); } // hangs from the ceiling, cap faces the gap
    ctx.translate(cx - dw / 2, 0);
    ctx.drawImage(img, 0, 0, img.width, T.capH, 0, y, dw, capH);
    if (shaftH > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, y + capH, dw, shaftH); ctx.clip();
      var tileDH = T.tileH * s;
      for (var yy = y + capH; yy < y + capH + shaftH; yy += tileDH) {
        ctx.drawImage(img, 0, T.tileY, img.width, T.tileH, 0, yy, dw, tileDH);
      }
      ctx.restore();
    }
    ctx.drawImage(img, 0, img.height - T.baseH, img.width, T.baseH, 0, y + h - baseH, dw, baseH);
    ctx.restore();
  }
  // Canvas-drawn fallback column, used only until the pillar art has loaded.
  function drawColumn(x, y, h, L, capAtBottom, variant) {
    if (h <= 0) return;
    var art = pillarFor(currentLevel, L, variant), T = PILLAR_TYPES[variant];
    if (!art) { art = pillarFor(currentLevel, L, "plain"); T = PILLAR_TYPES.plain; }
    if (art) { drawPillar(art, T, x + PIPE_WIDTH / 2, y, h, capAtBottom); return; }
    ctx.fillStyle = L.pipe;
    ctx.fillRect(x, y, PIPE_WIDTH, h);
    var capH = Math.min(14, h), capY = capAtBottom ? y + h - capH : y;
    ctx.fillRect(x - 4, capY, PIPE_WIDTH + 8, capH);
  }

  function frameName() {
    if (state === "ready") return Math.floor(stateT / 260) % 2 ? "jump-2" : "jump-3";
    if (state === "dying" || state === "gameover") {
      if (!player.grounded) return "hurt-1";
      return "death-" + Math.min(4, 1 + Math.floor(player.groundT / DEATH_FRAME_MS));
    }
    if (player.flapT < 100) return "fly-1";
    return player.vy < -1.5 ? "jump-2" : "jump-3";
  }

  // The heart he carries: locked and dim at 1 O'Clock, brighter every hour, bursting open at 7.
  function heartbeat(ms) {
    var t = ms % 900;
    function bump(c) { var d = (t - c) / 70; return Math.exp(-d * d); }
    return Math.max(bump(70), 0.65 * bump(290));   // lub-dub
  }
  function drawChestHeart(now) {
    var k = currentLevel / (LEVELS.length - 1);
    var beat = heartbeat(now) * (0.35 + 0.65 * k);
    var size = 1.3 * (1 + 0.16 * beat + 0.5 * heartBoost);
    var gr = 5 + 15 * k + 14 * heartBoost;
    ctx.globalCompositeOperation = "lighter";
    glowAt("#ff4d7a", 0, 0, gr, Math.min(1, (0.12 + 0.5 * k) * (0.7 + 0.3 * beat) + 0.5 * heartBoost));
    ctx.globalCompositeOperation = "source-over";
    drawHeart(0, 0, size, mix("#5b2a38", "#ff3d6e", Math.min(1, k + heartBoost * 0.5)), 1);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#ffd1dc";
    ctx.fillRect(-2.2 * size, -2 * size, size, size);   // highlight
    if (currentLevel === 0) {                            // still locked
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#e0b04a";
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.arc(0, -0.4, 1.3, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = "#e0b04a";
      ctx.fillRect(-1.8, -0.4, 3.6, 2.8);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer(L, alpha) {
    var name = frameName();
    var sp = glowSprite(name, currentLevel, L);
    var x = lerp(player.ppx, player.x, alpha), y = lerp(player.py, player.y, alpha);
    var rot = lerp(player.prot, player.rot, alpha);
    var sy = 1 + 0.16 * player.s, sx = 1 - 0.12 * player.s;
    ctx.save();
    ctx.translate(x, y);
    if (sp) {
      ctx.imageSmoothingEnabled = true;
      var dw = sp.w, dh = sp.h;
      if (player.grounded) {
        // lying on the ground: anchor to the feet
        ctx.translate(0, RADIUS);
        ctx.scale(sx, sy);
        ctx.drawImage(sp.canvas, -dw / 2 - GLOW_PAD, -dh - GLOW_PAD, dw + GLOW_PAD * 2, dh + GLOW_PAD * 2);
      } else {
        ctx.rotate(rot);
        ctx.scale(sx, sy);
        ctx.drawImage(sp.canvas, -dw / 2 - GLOW_PAD, -dh / 2 - GLOW_PAD, dw + GLOW_PAD * 2, dh + GLOW_PAD * 2);
        if (state !== "dying" && state !== "gameover") {
          ctx.translate(1, 6);
          drawChestHeart(performance.now());
        }
      }
    } else {
      ctx.beginPath();
      ctx.fillStyle = L.ball;
      ctx.arc(0, 0, RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(alpha) {
    var L = LEVELS[currentLevel];
    var k = SCALE;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.save();
    if (trauma > 0.001) {
      var amp = trauma * trauma * 14;
      ctx.translate(Math.round(rand(-amp, amp) * k) / k, Math.round(rand(-amp, amp) * k) / k);
    }

    drawBackdrop(L, alpha);
    drawWeatherBack(L, alpha);

    if (pipes.length && state !== "intro" && state !== "reveal" && state !== "finale") {
      ctx.imageSmoothingEnabled = PILLAR_SCALE * k < 2;
      for (var i = 0; i < pipes.length; i++) {
        var p = pipes[i];
        var px = Math.round(lerp(p.px, p.x, alpha) * k) / k;
        if (px > W + 20 || px < -PIPE_WIDTH - 30) continue;
        var gy = lerp(p.pgy, p.gapY, alpha);
        var gapTop = gy - p.gapH / 2;
        var gapBottom = gy + p.gapH / 2;
        drawColumn(px, 0, gapTop, L, true, "plain");
        drawColumn(px, gapBottom, H - GROUND_H - gapBottom, L, false, p.variant);
        if (p.variant === "torch" && PILLAR_TYPES.torch.img.naturalWidth) {
          var fy = gapBottom + PILLAR_TYPES.torch.flameY * PILLAR_SCALE, fl = 0.8 + 0.2 * Math.sin(weather.t / 70 + p.seed) * Math.sin(weather.t / 113 + p.seed);
          ctx.globalCompositeOperation = "lighter";
          glowAt("#ff9a3c", px + PIPE_WIDTH / 2, fy, 30 * fl, 0.5 * fl);
          glowAt("#ffe0a0", px + PIPE_WIDTH / 2, fy + 2, 11 * fl, 0.55);
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
        }
      }
    }

    // ground: tinted stone strip scrolling with the pillars
    ctx.fillStyle = mix(L.pipe, "#000000", 0.35);
    ctx.fillRect(-20, H - GROUND_H, W + 40, GROUND_H + 20);
    var gs = groundStripFor(L);
    if (gs) {
      var gw = gs.width * GROUND_SCALE, gh = gs.height * GROUND_SCALE;
      var gx0 = -(((lerp(pGroundX, groundX, alpha)) % gw) + gw) % gw;
      gx0 = Math.round(gx0 * k) / k;
      ctx.imageSmoothingEnabled = GROUND_SCALE * k < 2;
      for (var gxx = gx0; gxx < W + 2; gxx += gw) ctx.drawImage(gs, gxx, H - GROUND_H - 5, gw + 0.5, gh);
    }
    // foreground silhouettes: nearer to the camera, so they slide past faster
    var fg = fgStripFor(L, currentLevel);
    var fx0 = -(((lerp(pGroundX, groundX, alpha) * FG_SPEED) % FG_TW) + FG_TW) % FG_TW;
    fx0 = Math.round(fx0 * k) / k;
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.96;
    for (var fxx = fx0; fxx < W + 2; fxx += FG_TW) ctx.drawImage(fg.canvas, fxx, H - FG_H, FG_TW + 0.5, FG_H);
    ctx.globalAlpha = 1;

    drawFx(0, alpha);
    if (player) drawPlayer(L, alpha);
    drawFx(1, alpha);
    drawWeatherFront(L, alpha);
    ctx.restore();

    ctx.globalAlpha = lerp(0.55, 0.22, currentLevel / (LEVELS.length - 1));
    ctx.drawImage(vignette(), 0, 0, W, H);
    ctx.globalAlpha = 1;

    var bolt = weather.type === "storm" && weather.lv === currentLevel ? boltAlpha() : 0;
    if (bolt > 0.01) {
      ctx.globalAlpha = bolt;
      ctx.fillStyle = "#dfe6ff";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (flash > 0.01) {
      ctx.globalAlpha = flash;
      ctx.fillStyle = flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // =====================================================================================
  // Canvas sizing
  // =====================================================================================
  // Desktop / landscape: 640x400 (16:10). Portrait phones: a narrower, slightly taller field (500 wide)
  // so everything is drawn ~25% bigger on a narrow screen. Height follows the stage box but stays
  // within 400-440 so pillar spacing (and difficulty) is basically unchanged.
  var phoneMQ = window.matchMedia("(max-width: 640px) and (orientation: portrait)");
  var MAX_BACKING_PX = 2400000;
  function fitCanvas(resolutionOnly) {
    var w = W, h = H;
    if (!resolutionOnly) {
      w = 640; h = 400;
      if (phoneMQ.matches) {
        w = 500;
        var ratio = stageEl.clientHeight / Math.max(1, stageEl.clientWidth);
        h = Math.round(Math.max(400, Math.min(440, w * ratio)));
      }
    }
    var cssW = stageEl.clientWidth || w;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var k = Math.max(0.5, (cssW * dpr) / w);
    if (w * h * k * k > MAX_BACKING_PX) k = Math.sqrt(MAX_BACKING_PX / (w * h));
    var bw = Math.round(w * k), bh = Math.round(h * k);
    var dimsChanged = w !== W || h !== H;
    if (!dimsChanged && bw === canvas.width && bh === canvas.height) return;
    W = w; H = h;
    SCALE = bw / w;
    canvas.width = bw;
    canvas.height = bh;
    glowCache = {};
    LEVELS.forEach(function (lv) { lv._bgCache = null; });
    if (dimsChanged) {
      PLAYER_X = Math.round(W * 0.235);
      MOVE_FREEZE_X = PLAYER_X + 60;
      MOVE_ZONE_MIN = PLAYER_X + 150;
      if (weather.lv >= 0) initWeather(weather.lv);
    }
  }
  var fitTimer = null;
  function scheduleFit() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(function () {
      var live = state === "playing" || state === "dying" || state === "clear" || state === "ready";
      fitCanvas(live);   // mid-level: only sharpen/resample, never change the play-field
    }, 150);
  }
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("orientationchange", scheduleFit);
  fitCanvas();

  // =====================================================================================
  // Boot + main loop
  // =====================================================================================
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    renderTracks();
    if (state === "intro") {
      showIntro(currentLevel);
    } else {
      initWeather(currentLevel);
      showFinale();
    }
    draw(1);
    requestAnimationFrame(loop);
    // Reveal the game only once a real frame has been painted underneath
    // (with a timer fallback in case the browser is throttling animation frames).
    var hidden = false;
    function hideLoader() {
      if (hidden) return;
      hidden = true;
      loaderEl.classList.add("hide");
      setTimeout(function () { loaderEl.style.display = "none"; }, 400);
    }
    requestAnimationFrame(function () { requestAnimationFrame(hideLoader); });
    setTimeout(hideLoader, 1200);
    // Everything else streams in quietly, next levels first.
    setTimeout(function () {
      for (var k = 1; k < LEVELS.length; k++) loadBg((currentLevel + k) % LEVELS.length);
      LEVELS.forEach(function (lv) { if (lv.tile) loadImg(lv.tile); });
      warmAudio(currentLevel);
    }, 300);
  }

  var lastTime = null, acc = 0;
  function loop(ts) {
    if (lastTime === null) lastTime = ts;
    acc += Math.min(100, ts - lastTime);   // after a stall, don't fast-forward the world
    lastTime = ts;
    var steps = 0;
    while (acc >= STEP_MS && steps < 8) {
      update();
      acc -= STEP_MS;
      steps++;
    }
    if (steps >= 8) acc = 0;
    draw(clamp(acc / STEP_MS, 0, 1));
    tickAudio(performance.now());
    requestAnimationFrame(loop);
  }

  function flapEventHandler(e) {
    if (!booted) return;
    var tag = e.target.tagName;
    if (tag === "INPUT" || tag === "BUTTON" || tag === "LABEL" || tag === "FORM") return;
    if (state === "finale") return;   // let the end screen scroll / focus the form
    if (e.type === "touchstart") e.preventDefault();
    flap();
  }
  stageEl.addEventListener("touchend", function () {
    if (!canVibrate && state === "playing") haptic("flap");
  }, { passive: true });
  stageEl.addEventListener("click", flapEventHandler);
  stageEl.addEventListener("touchstart", flapEventHandler, { passive: false });
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); if (booted) flap(); }
  });

  // ---- loading screen: wait for fonts, character, pillars and this level's background ----
  var loaderEl = document.getElementById("loader");
  var loaderFill = document.getElementById("loaderFill");
  (function preload() {
    var fontLoads = ['700 20px "Pixelify Sans"', 'italic 20px "Instrument Serif"', "20px Shrikhand", '20px "DM Serif Display"']
      .map(function (f) { return document.fonts && document.fonts.load ? document.fonts.load(f).catch(function () {}) : Promise.resolve(); });
    var art = Object.keys(PILLAR_TYPES).map(function (k) { return whenReady(PILLAR_TYPES[k].img); }).concat([whenReady(groundImg)]);
    var jobs = fontLoads.concat(art, FRAME_NAMES.map(function (n) { return whenReady(FRAMES[n]); }), [loadBg(currentLevel)]);
    var done = 0;
    jobs.forEach(function (p) {
      p.then(function () { done++; loaderFill.style.width = Math.round((done / jobs.length) * 100) + "%"; });
    });
    var timeout = new Promise(function (res) { setTimeout(res, 9000); });   // slow network: start anyway
    Promise.race([Promise.all(jobs), timeout]).then(boot);
  })();
})();
