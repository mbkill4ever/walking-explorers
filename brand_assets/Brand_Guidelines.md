# Walking Explorers — Brand Guidelines

**Version:** 1.0
**Date:** 2026-05-09
**Owner:** Nova (founder)
**Status:** Internal — public version planned at Series A

This is the single source of truth for how Walking Explorers looks, sounds, and feels. If a surface contradicts this doc, the doc wins.

---

## 1. Logo

Walking Explorers has three lockups, all in the `brand_assets/` folder:

| Asset | When to use |
|---|---|
| `logo.svg` (full lockup) | Default — headers, footers, deck title slides, business cards |
| `logo-mark.svg` (skyline only) | Favicons, app icons, social avatars, loading states, anywhere under 80px |
| `wordmark.svg` (text only) | Sub-headers and embedded contexts where the mark is already shown elsewhere on the same screen |

### The logo mark IS the skyline.

The hand-drawn NYC skyline silhouette is the brand's signature visual. It is recognizable Manhattan-from-Brooklyn — One World Trade on the left, Empire State and Chrysler in the middle, Met Life clock tower, Brooklyn Bridge on the right. This is not interchangeable with a generic city silhouette. Don't redraw it. Don't substitute another skyline for another city.

### Clear space

Minimum padding around the full lockup = the height of the M in "walking" on all four sides. Don't stack other text or logos inside this clear-space buffer.

### Minimum size

| Lockup | Minimum width |
|---|---|
| `logo.svg` (full) | 120px |
| `logo-mark.svg` (mark only) | 24px |
| `wordmark.svg` (text only) | 100px |

Below these sizes, the gold dot disappears and the skyline reads as noise. Use the mark alone instead.

### Do

- Use the SVG sources, never re-rasterize at small sizes
- Use `currentColor` to recolor the mark and wordmark text — the gold dot stays gold always
- Place on cream, navy, or white backgrounds with sufficient contrast

### Do not

- Don't tilt, skew, or distort the lockup
- Don't change the gold dot color (it is the brand verb)
- Don't re-letter the wordmark in a different typeface
- Don't add a tagline inside the clear-space zone
- Don't use the mark on busy photographic backgrounds without a scrim

---

## 2. Color palette

All values live in `tokens.css`. Hex codes here are reference only — never hard-code them in a stylesheet, always use the variable.

### Primary

| Token | Hex | Role |
|---|---|---|
| `--navy` | `#1F3864` | Primary brand color — backgrounds, headers, primary buttons |
| `--gold` | `#E0B341` | Accent — the dot, CTAs on navy, highlights |
| `--cream` | `#FAF7F2` | Default background — page surfaces, cards |

### Supporting

| Token | Hex | Role |
|---|---|---|
| `--navy-2` | `#162B4A` | Hover states, deeper navy fields |
| `--navy-3` | `#0E1B30` | Footers, deepest fills |
| `--blue` | `#2E75B6` | Links, gradient mid-stops |
| `--blue-soft` | `#5C9FE0` | Soft blue — used sparingly |
| `--gold-soft` | `#F2D67D` | Eyebrows on navy, soft gold highlights |
| `--gold-dark` | `#B8941F` | Gold-on-cream text — passes WCAG AA at 16px+ |
| `--gold-text` | `#8C6F12` | Gold-on-cream small text — passes WCAG AAA |
| `--cream-2` | `#F4EFE6` | Subtle alternation, card-on-card fills |

### Ink and mute

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#0E1320` | Body copy on cream |
| `--ink-2` | `#2C3142` | Secondary text, captions |
| `--mute` | `#6B7280` | Disabled, helper text |
| `--mute-2` | `#9CA3AF` | Placeholder text |
| `--line` | `#E8E2D6` | Standard borders |
| `--line-2` | `#F1ECDF` | Subtle dividers |

### Semantic

| Token | Hex | Role |
|---|---|---|
| `--good` | `#15803D` | Success states |
| `--love` | `#DC2626` | Errors, destructive |
| `--warn` | `#C2410C` | Warnings, caution |

### Approved contrast pairs

| Foreground | Background | Use |
|---|---|---|
| `--ink` | `--cream` | Default body |
| `--navy` | `--cream` | Headers |
| `--gold-dark` | `--cream` | Eyebrow / accent text (16px+) |
| `--gold-text` | `--cream` | Small accent text |
| white | `--navy` | Inverted blocks |
| `--gold` | `--navy` | CTA text on navy buttons |
| `--gold-soft` | `--navy` | Eyebrows on navy |

---

## 3. Typography

The brand is set in **Inter** — weights 400, 500, 600, 700, 800. Loaded via Google Fonts on every surface. JetBrains Mono is the secondary face for code, tokens, and metadata.

### Hierarchy

| Style | Token | Weight | Tracking | Example |
|---|---|---|---|---|
| H1 / Display | `--fs-4xl` 44px | 800 | `--ls-tight` | Where curiosity meets the city. |
| H2 | `--fs-3xl` 32px | 800 | `--ls-snug` | Maps are functional. Loops are emotional. |
| H3 | `--fs-2xl` 24px | 700 | `--ls-snug` | Your city memory starts here. |
| H4 / Lede | `--fs-xl` 20px | 500 | `--ls-normal` | AI-curated walks through NYC. |
| Body | `--fs-base` 15px | 400 | `--ls-normal` | Tap any walk to begin. |
| Caption | `--fs-sm` 13px | 500 | `--ls-normal` | Beta status: invite-only |
| Eyebrow | `--fs-xs` 11px | 800 UPPER | `--ls-eyebrow` 0.08em | WALKING EXPLORERS · PRIVATE NYC BETA |
| Mono | `--ff-mono` 13px | 500 | normal | `code: d7Tn-fkX3` |

Line height: `--lh-tight` 1.15 for display, `--lh-base` 1.5 for body, `--lh-loose` 1.7 for long-form.

---

## 4. Voice & tone

### Three brand adjectives

**Editorial. NYC. Handcrafted.**

Every sentence should pass the test: would a New Yorker write this? Would a New Yorker read it without rolling their eyes?

### Do / don't pairs

| Do | Don't |
|---|---|
| Where curiosity meets the city. | Discover hidden gems near you! |
| Welcome back, explorer. | Hello, user |
| Maps are functional. Loops are emotional. | Our AI-powered route engine optimizes for engagement. |
| That code didn't work. Double-check and try again. | Error 401: Authentication failed |
| Your city memory starts here. | No walks yet — get started! |

### Five canonical phrases

1. **CTA on navy:** "Enter the beta →"
2. **Empty state:** "Your city memory starts here."
3. **Loading:** "Drawing your loop…"
4. **Error:** "Couldn't reach the server. Try again in a moment."
5. **Success:** "Welcome — redirecting…"

### Things we never say

- "Hidden gems" (overused, every tourism app says this)
- "Personalized for you" (everyone says this)
- "AI-powered" as a leading phrase (it's how, not why)
- Any phrase ending in an emoji

---

## 5. Photography direction

The audit identified zero real photography as the #1 credibility gap. Until that's solved:

- **No people in beta phase.** Faces date a product fast and we don't have model releases.
- **Warm-tone landmark and texture photos.** Brick, brownstone, fire escapes, café interiors, neon signage, awnings. Cream-leaning whites, never pure-white storefronts.
- **Aspect ratios:** 16:9 for hero, 4:5 for vertical cards, 1:1 for grid tiles. Never freeform.
- **Always full-bleed, never with a white border.** White borders read as stock-photo placeholders.
- **Until we have real photos:** the gold-on-navy skyline carries the visual weight. Don't substitute generic city stock.

When real photography arrives, the bar is *Monocle* and *The New Yorker* photo essays — flat warm tone, no Instagram filter, no high-saturation HDR.

---

## 6. The skyline asset — meaning and applications

The skyline silhouette in `logo-mark.svg` is the brand's universal frame.

### What it means

It's not "a city skyline." It's *this* city, drawn by hand, viewed from Brooklyn. It says: we know this place. We're not a generic discovery app retargeted to NYC.

### Where it shows up

- **Logo:** the wordmark sits adjacent to the mark; the mark alone for small-format
- **App icon:** mark in gold on navy, rounded corners
- **Splash / loading:** the skyline draws itself in left-to-right (CSS `stroke-dasharray` 800ms)
- **Loop completion:** the user's GPS route renders in the same line treatment overlaid on the skyline
- **OG / social:** the wordmark sits centered, skyline along the bottom third
- **Empty states:** subtle background watermark at 8% opacity
- **Pitch deck:** title slide and closing slide
- **Email signature:** mark only, 32px

### What it never does

- Doesn't appear flipped, rotated, or in mirror
- Doesn't appear partial (always the full skyline)
- Doesn't carry text overlaid on it — wordmark sits beside, not on
- Never combined with a different city's skyline

---

## 7. Quick reference card

```
Colors:    navy #1F3864 · gold #E0B341 · cream #FAF7F2
Type:      Inter 400-800 + JetBrains Mono
Voice:     editorial · NYC · handcrafted
Mark:      hand-drawn Manhattan-from-Brooklyn skyline
Verb:      the gold dot — pulsing, alive, NYC
```

---

*This doc is owned by the founder. Updates require a brand review — not a contractor's call.*
