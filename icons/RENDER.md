# Icon rendering instructions

This folder contains the **SVG sources** for every raster icon Walking Explorers ships. The PNGs themselves are not in git — generate them locally with one of the recipes below before deploying, or commit the PNGs after first generation.

---

## What needs to exist (file paths the app expects)

| File | Size | Source SVG | Used by |
|---|---|---|---|
| `icons/icon-192.png` | 192×192 | `icons/icon-source.svg` | PWA manifest standard |
| `icons/icon-512.png` | 512×512 | `icons/icon-source.svg` | PWA manifest large + splash |
| `icons/icon-maskable-512.png` | 512×512 | `icons/icon-maskable-source.svg` | Android adaptive icon (purpose: maskable) |
| `icons/icon-180.png` | 180×180 | `icons/apple-touch-source.svg` | `<link rel="apple-touch-icon">` |
| `icons/og-image.png` | 1200×630 | `brand_assets/og-image-source.svg` | OpenGraph + Twitter card |
| `icons/favicon-32.png` | 32×32 | `brand_assets/logo-mark.svg` | Browser tab favicon |

---

## Recipe 1 — resvg (recommended, no install)

From the repo root:

```
npx @resvg/resvg-cli icons/icon-source.svg          icons/icon-192.png            -w 192  -h 192
npx @resvg/resvg-cli icons/icon-source.svg          icons/icon-512.png            -w 512  -h 512
npx @resvg/resvg-cli icons/icon-maskable-source.svg icons/icon-maskable-512.png   -w 512  -h 512
npx @resvg/resvg-cli icons/apple-touch-source.svg   icons/icon-180.png            -w 180  -h 180
npx @resvg/resvg-cli brand_assets/og-image-source.svg icons/og-image.png          -w 1200 -h 630
npx @resvg/resvg-cli brand_assets/logo-mark.svg     icons/favicon-32.png          -w 32   -h 32
```

resvg is the fastest path for a non-technical founder — npx fetches it on demand, no global install.

---

## Recipe 2 — ImageMagick / rsvg-convert

If you already have these:

```
rsvg-convert -w 192 -h 192 icons/icon-source.svg -o icons/icon-192.png
rsvg-convert -w 512 -h 512 icons/icon-source.svg -o icons/icon-512.png
```

or

```
magick -background none -density 300 -resize 512x512 icons/icon-source.svg icons/icon-512.png
```

---

## Recipe 3 — Online (no terminal)

Drop the source SVG into one of these and download the PNG at the right pixel size:

- https://www.svgviewer.dev/ (Export → PNG)
- https://cloudconvert.com/svg-to-png
- https://resvg.app/ (browser-based resvg)

---

## Verifying the OG image

After rendering `icons/og-image.png`, verify it on:

- https://www.opengraph.xyz/?url=https://www.walkingexplorers.com
- Twitter card validator: https://cards-dev.twitter.com/validator

The image must be < 5 MB and exactly 1200×630 for the no-crop result.

---

## When to re-render

- The skyline mark changed in `brand_assets/logo-mark.svg`
- The OG copy changed in `brand_assets/og-image-source.svg`
- A new device size enters the manifest (e.g. iPad pro variants)

The SVG sources are the canonical asset; PNGs are derivatives.
