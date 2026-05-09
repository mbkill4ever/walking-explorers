# Walking Explorers — App Icons

This folder contains the source SVG and the rasterized PNGs referenced by `/manifest.webmanifest`, the apple-touch-icon, and the favicons.

## Files

| File              | Purpose                                  | Size       |
|-------------------|------------------------------------------|------------|
| `icon-source.svg` | Master vector — edit this, regenerate PNG | 512x512 vb |
| `icon-512.png`    | PWA manifest "any maskable"              | 512x512    |
| `icon-192.png`    | PWA manifest "any maskable"              | 192x192    |
| `icon-180.png`    | iOS apple-touch-icon                     | 180x180    |

## Manual step: render the PNGs

A subagent can't write binary PNGs directly. Run once (and re-run any time `icon-source.svg` changes):

```bash
npm run icons
```

Or manually:

```bash
npx --yes svg2png-cli ./icons/icon-source.svg --width=512 --output=./icons/icon-512.png
npx --yes svg2png-cli ./icons/icon-source.svg --width=192 --output=./icons/icon-192.png
npx --yes svg2png-cli ./icons/icon-source.svg --width=180 --output=./icons/icon-180.png
```

Or use https://maskable.app or https://realfavicongenerator.net.

## Maskable safety

The artwork sits inside the inner ~80% disc of the 512x512 viewBox so it survives the circular / squircle masks Android and Chrome apply for `purpose: "any maskable"`.

## Theme

- Background: `#FAF7F2` (cream)
- Skyline:    `#1F3864` (navy)
- Accent dot: `#C9A961` (gold)
