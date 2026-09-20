# Loverboy O'Clock

A browser game companion to TD's album *Loverboy O'Clock*. Tap to flap through seven levels, one per track. Clear a level to unlock its song.

## Run it

```bash
npm start        # serves http://localhost:5173 (no dependencies)
```

It is a plain static site (HTML, CSS, JS), so it can be hosted on Netlify, Cloudflare Pages, GitHub Pages, etc.

## Layout

| Path | What |
|---|---|
| `index.html`, `css/`, `js/` | the game |
| `js/config.js` | levels, difficulty, pillar movement, unlock tiles, email endpoint |
| `assets/` | sprites, backgrounds, pillars, unlock tiles, fonts (`assets/source/` holds the original sheets) |
| `audio/` | add `track-01.mp3` to `track-07.mp3` here (see `audio/README.md`) |
| `prototype/` | the original single-file prototype |

## Still to do

- Add the audio clips
- Connect an email service (`email.endpoint` in `js/config.js`)
- Pick hosting for the album site

See `loverboy-oclock-handoff-notes.md` for full project notes. Fonts are OFL-licensed (`assets/fonts/README.md`).
