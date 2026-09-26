Pillar cut-outs from assets/source/background-sheet.png (the "Obstacle / Pillar assets" row).

Used in the game (slices set in js/game.js, PILLAR_TYPES):
- pillar-1.png  plain brick pillar (all hanging pillars, most standing ones)
- pillar-3.png  banner pillar (standing only)
- pillar-5.png  torch pillar (standing only; the flame counts as part of the pillar)

Decorated pillars are widened so their shaft is never narrower than the collision box.
The mossy / broken pillars are not used: their jagged tops don't match a straight hitbox.
