# Dead Rush Highway

Lightweight Three.js + TypeScript + Vite prototype for a first-person zombie auto-runner.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL, click the overlay to lock the pointer, then play.

## Build

```bash
npm run build
```

## Controls

- Mouse: aim
- Left click: shoot
- `A` / `D`: strafe
- `R`: reload
- `Esc`: release pointer lock / pause

## Milestone 1 Notes

- 60-second difficulty ramp, then endless survival
- Primitive-geometry low-poly visuals only
- No backend, login, or external asset downloads

## Asset Workflow

- Runtime pistol asset uses `public/models/weapons/pistol-web.glb`, a browser-friendly optimized build.
- Runtime zombie textures use `public/models/enemies/*/texture-web.glb`. These files are material sources only; the game still uses the rigged `character.glb` files for animation.
- Recommended workflow for new weapon assets:

```bash
npx @gltf-transform/cli resize public/models/weapons/pistol-textured.glb public/models/weapons/pistol-textured-1024.glb --width 1024 --height 1024
npx @gltf-transform/cli webp public/models/weapons/pistol-textured-1024.glb public/models/weapons/pistol-web.glb --quality 85 --effort 6
```

- Keep raw source assets outside `public/` when possible so they do not ship with the game.
