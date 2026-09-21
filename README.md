# Buccaneer Dash

A low-poly pirate sailing game in Three.js. Sail an endless, procedurally generated sea of small and large islands, fish floating treasure out of the water, and race three rival crews at the regattas marked by gold beams of light.

## Run

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist/` (relative paths, so it works on GitHub Pages).

## How it's built

- `src/world.js` streams the sea in 420-unit chunks around the ship, generated from the world seed. Regattas sit one per 1680-unit region, and islands keep clear of their courses.
- `src/islands.js` builds small islands, large tile-grown islands (fort, huts, dock), rocks and wrecks.
- `src/course.js` builds a regatta's buoy course from its seed, so each regatta is the same course every visit.
- `src/ship.js` is the arcade sailing physics and the rival crews' steering.
- Highscores (per regatta), the world seed and the treasure haul are saved in the browser's localStorage.

## Credits

3D models: [Pirate Kit](https://kenney.nl/assets/pirate-kit) by Kenney, CC0 (see `public/models/LICENSE-kenney.txt`). Sound effects are synthesised in code. Font: Pirata One (Google Fonts).
