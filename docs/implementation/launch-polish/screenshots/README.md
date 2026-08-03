# Paired Dark / Light screenshots

Captured against the **fully integrated** branch, so they show every agent's
work composed — including the real contact form and handle-onboarding UI, not
the mid-session placeholders an earlier capture caught.

## Committed here

Five routes × two themes. These are the pairs that carry the specific visual
claims this pass makes, so they need to outlive the session:

| Pair | What it evidences |
| --- | --- |
| `court-afterbegin-{dark,light}` | The headline light-mode fix. `.roster-board` hardcoded `#17130a`/`#14110a` gradient stops that were never made theme-aware, so the court floor **faded to black in light mode** while empty slot cards stayed near-white. That combination — not the slot styling — is why slots read as "stark white blocks". |
| `rankings-{dark,light}` | Header/row separator was an identical `--border-subtle` at **1.37:1**, under the 3:1 UI floor. Now `--divider-strong` at 3.07–3.57:1 plus a header background band, and a hue-differentiated `--bg-surface-data` panel rather than another lightness step. |
| `home-{dark,light}` | Nav/homepage polish, and the active-route underline that measured **1.29:1** against Arena Day's background using frozen `--peak-accent` directly — functionally invisible. |
| `daily-{dark,light}` | Daily Grid restructured to a single centred column; the analysis column no longer permanently halves the 3×3 board. |
| `contact-{dark,light}` | The contact route, which did not exist before this pass (it was a static `mailto:` to a `.invalid` placeholder). |

## Not committed

The full set is **46 images across 21 routes** — every top-nav destination,
every footer link, both auth entry points, 82-0 practice and history, RTT,
progression, methodology, and the legal pages. At 12 MB it is disproportionate
to commit in full for a one-time visual record, so only the evidence-bearing
subset above is here.

The complete set was captured and reviewed; the remaining routes showed no
light-mode defects. Recording that plainly rather than implying the subset is
all that was checked.

## Verification note

Light mode was verified as a genuinely different palette rather than a recolour,
by measurement rather than by looking at these images:

- Elevation ordering holds independently in each theme, and light's tier deltas
  are **larger** (0.068 vs 0.003) — the tiers are more distinguishable in light,
  not less.
- Naive-inversion ΔE (Lab, CIE76) measures **3.0–7.7** across all three surface
  tokens, well clear of the ΔE < 2 threshold that would suggest an inversion.
- All seven frozen tokens (`--peak-accent` + six `--comp-*`) are **byte-identical**
  across themes.
- Zero `filter: invert(` anywhere in `globals.css`.
- A second `:root[data-theme="light"]` block redefines `--pk-elev-1..4` with a
  different base colour and alpha/blur recipe — structural deployment, not a
  token swap.

Screenshots are the illustration. The measurements above are the evidence.
