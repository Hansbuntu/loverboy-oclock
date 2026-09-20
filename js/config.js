// Loverboy O'Clock — game configuration.
// Edit this file for content/deploy settings; game logic lives in game.js.
window.LOVERBOY_CONFIG = {
  // One entry per track/level. `bg` is an optional background illustration
  // (drop the file in assets/backgrounds/); if missing, the canvas scene is used.
  // `tile` is the unlock tile shown on the reveal card (assets/tiles/).
  // `move` (levels 4-7): pillars slide up/down at random moments.
  //   chance = share of pillars that move, amp = max shift in px, vy = slide speed in px/frame.
  levels: [
    { track: "Do You Love Me", bg: "assets/backgrounds/level-01.png", tile: "assets/tiles/leaf.png", sky: "#26303d", skyDeep: "#1c2530", pipe: "#3d4759", ball: "#8a94a3", glow: "#6b7683", need: 5, gapH: 150, speed: 3.0 },
    { track: "Lady In Red", bg: "assets/backgrounds/level-02.png", tile: "assets/tiles/heart.png", sky: "#3a3342", skyDeep: "#2c2734", pipe: "#4a3d55", ball: "#c0607f", glow: "#ed93b1", need: 6, gapH: 144, speed: 3.2 },
    { track: "The End Is Near ft. Cronax", bg: "assets/backgrounds/level-03.png", tile: "assets/tiles/star.png", sky: "#2e2a38", skyDeep: "#221f2b", pipe: "#453b52", ball: "#7d6a8a", glow: "#9a86ad", need: 6, gapH: 138, speed: 3.4 },
    { track: "Nakupenda", bg: "assets/backgrounds/level-04.png", tile: "assets/tiles/sun.png", sky: "#6b5b73", skyDeep: "#584a5f", pipe: "#8b6f47", ball: "#d69e6b", glow: "#f0c98a", need: 7, gapH: 132, speed: 3.6, move: { chance: 0.4, amp: 60, vy: 1.0 } },
    { track: "Bonnie And Clyde", bg: "assets/backgrounds/level-05.png", tile: "assets/tiles/heart.png", sky: "#a24e6b", skyDeep: "#873f58", pipe: "#e2725b", ball: "#ffb347", glow: "#ffd27a", need: 7, gapH: 126, speed: 3.8, move: { chance: 0.55, amp: 75, vy: 1.2 } },
    { track: "I No Fit Lie", bg: "assets/backgrounds/level-06.png", tile: "assets/tiles/leaf.png", sky: "#c98a6b", skyDeep: "#ab7159", pipe: "#e0a377", ball: "#ffd39b", glow: "#ffe6bf", need: 8, gapH: 120, speed: 4.0, move: { chance: 0.7, amp: 90, vy: 1.4 } },
    { track: "The End", bg: "assets/backgrounds/level-07.png", tile: "assets/tiles/crown.png", sky: "#f6ad55", skyDeep: "#d99248", pipe: "#f6c343", ball: "#ffe066", glow: "#fff3b0", need: 8, gapH: 115, speed: 4.2, move: { chance: 0.85, amp: 105, vy: 1.6 } }
  ],

  // Email capture. Leave endpoint empty to keep saving to localStorage only.
  // Formspree: https://formspree.io/f/<id>   (POSTs JSON, expects 2xx)
  email: {
    endpoint: "https://formspree.io/f/xyezewgl",
    field: "email"
  },

  // Reveal preview length (ms). Capped to the real clip duration when known.
  previewMs: 10000
};
