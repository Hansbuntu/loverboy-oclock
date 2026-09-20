# Loverboy O'Clock — Game Handoff Notes

Context to paste into Claude Code (or read from) when picking this project back up.

## The project
A browser game companion to TD's album *Loverboy O'Clock* (Afrobeat / Afro-swing / RnB-Alt, 7 tracks). The game mirrors the album's arc — TD guarded and closed off after past heartbreak, gradually opening up to love — through a tap-to-flap flying game where each level is one track.

**Tracklist / level order:**
1. Do You Love Me
2. Lady In Red
3. The End Is Near ft. Cronax
4. Nakupenda
5. Bonnie And Clyde
6. I No Fit Lie
7. The End

## How the game currently works
- **Mechanic:** tap/space to flap, gravity pulls down, fly through gaps between obstacles — one-handed, one input.
- **Structure:** 7 discrete levels, one per track. Nothing is unlocked at the start — you must clear a level (pass its required number of gaps) to unlock that track. Difficulty (gap size, scroll speed) steps up per level.
- **Unlock reveal:** clearing a level pauses the game and shows a reveal card (track number, title, art tile) with a 10-second audio preview and a progress bar. Tapping skips it early (after a short grace period so it can't be accidentally skipped instantly). The unlocked track then keeps playing at low volume through the next level's attempt, pausing on a fail and resuming — not restarting — on retry.
- **Progression persistence:** which levels are completed is saved to the browser's localStorage, so it survives reloads.
- **End screen:** after all 7 are unlocked, shows a short thank-you message and an email capture form ("want early access?"). **Important limitation:** this only saves the email to localStorage right now — it is NOT actually collecting emails anywhere real. A public link shared with fans can't write to any of Claude's built-in storage (that only works for people signed into the same Anthropic org as the creator). This needs a real integration in Claude Code — Mailchimp, ConvertKit, a Google Form, Formspree, or a custom backend. Ask the artist which one they want before building it.
- **Character:** a handful of frames were hand-cropped from the full sprite sheet (idle, a tucked mid-air pose, a hurt pose) and embedded directly as base64 PNGs in the HTML for a quick preview. The character stays in the airborne/tucked pose the whole time (not the standing pose) with a bit of rotation tied to vertical speed, so it reads as flying rather than walking. This is NOT a proper sprite/animation system — just 3 static frames swapped by game state.
- **Backgrounds:** currently hand-drawn with canvas shapes (no images) — a distinct silhouette scene per level (castle/gate, storm skyline, hills, mirrored towers, etc.), tinted to each level's color palette, plus drifting ambient particles.
- **Sound:** flap/fail/unlock sound effects are synthesized live via the Web Audio API (no files needed). Haptic vibration fires on fail where supported (Android/Chrome; not iOS Safari).

## Assets ready to bring in
- **Character sprite sheet** (full, uploaded separately) — idle/walk/run/crouch/jump/attack/hurt/death sequences, plus UI icons. Only idle + one jump pose + one hurt pose are used so far; the rest (walk/run/crouch/attack/death) are unused unless the mechanic changes.
- **7 environment background illustrations** (uploaded separately) — one per level, generated from a matching prompt pack, already following the same structural-change-per-level logic as the current canvas art (closed gate → cracked gate with ember → storm → open hills → mirrored duo → quiet dome → wide-open gate with sunburst).
- **Obstacle/pillar, platform tile, unlock tile, and collectible icon assets** (from the same generation) — platform tiles and collectibles don't have a use in the current mechanic yet; treat as optional/unused material unless the mechanic is revisited.
- **Art prompt pack** (published artifact) with the exact hex palettes per level, for generating anything further in the same style: https://claude.ai/artifact/GX6cyb9ULrz1rMM1kL552v

## Known open decisions (flagged, not yet resolved)
1. **Character vs. background art style mismatch** — the generated backgrounds are much more detailed/painterly than the flat, simple character sprite. Needs a decision: regenerate the character to match, simplify the backgrounds, or pair them as-is and see how it reads.
2. **Audio files not yet added.** The game expects exact filenames, in this order:
   ```
   audio/track-01.mp3   → Do You Love Me
   audio/track-02.mp3   → Lady In Red
   audio/track-03.mp3   → The End Is Near ft. Cronax
   audio/track-04.mp3   → Nakupenda
   audio/track-05.mp3   → Bonnie And Clyde
   audio/track-06.mp3   → I No Fit Lie
   audio/track-07.mp3   → The End
   ```
   If clips are shorter than 10 seconds, the reveal's progress bar will finish after the audio goes quiet — either trim clips to ~10s or change the bar to match each clip's real duration.
3. **Email capture backend** — needs a real service connected (see above).
4. **Hosting** — the artist wants this on a dedicated website for the album release, not just a claude.ai artifact link.

## The file
The current working prototype is attached to this handoff — a single self-contained HTML file (`loverboy-oclock-game.html`). Everything (styles, game logic, embedded character frames) is in that one file; only the audio folder and any new background images are missing.

## Build status (2026-09-18)
- Project split into `index.html`, `css/`, `js/` (`config.js` holds levels/email/preview settings), `assets/`. Run locally with `npm start` (http://localhost:5173). Original single-file prototype kept in `prototype/`.
- Character: cut-out frames in `assets/sprites/frames/` (jump-2/3 for flight, hurt-1 + death-1..4 for the fail animation). Source sheet kept in `assets/source/`.
- Backgrounds: `assets/backgrounds/level-01..07.png` cropped from the generated sheet; cover-fitted with a slow camera drift as the level progresses. Obstacles are canvas-drawn stone columns (pillar/tile/collectible art from the sheet is not used yet).
- Still open: audio clips, email service, hosting.
- Difficulty ramp (2026-09-19): from level 4 ("Nakupenda") onward some pillars slide up/down at random moments (1-2 shifts each, random trigger point/direction/distance). The gap locks in ~60px before it reaches the player. Tune per level with `move: { chance, amp, vy }` in `js/config.js`.
- Mobile (2026-09-19): game area keeps the 16:10 shape (so difficulty is identical everywhere) but goes full-width on phones and never taller than the viewport (landscape). The end screen and song preview become full-screen layers on phones (`.overlay.full`, `.reveal` in the mobile media query in `css/style.css`); the end screen is two columns in landscape. Audio is primed on the first real tap (touchend/click/keydown) so the reveal preview can autoplay on iOS/Android — untested on a physical iPhone until audio files exist.
- Unlock tiles (2026-09-20): the reveal card now shows the tile art from the sheet (`assets/tiles/`, one `tile` per level in `js/config.js`) instead of a coloured square, with a level-coloured glow, a pop-in animation and a track-number badge. Current mapping: 1 leaf, 2 heart, 3 star, 4 sun, 5 heart, 6 leaf, 7 crown (only 5 tiles exist for 7 tracks, so heart and leaf repeat).
