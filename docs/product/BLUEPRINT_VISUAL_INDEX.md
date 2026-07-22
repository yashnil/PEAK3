# PEAK3 Blueprint Visual Index

Full-page PNG renders of every page of the source blueprint PDF, generated for
future AI agents and reviewers to inspect diagrams, tables, and layout that
are not fully captured in the hand-picked crops in
[`PEAK3_BLUEPRINT_INDEX.md`](PEAK3_BLUEPRINT_INDEX.md).

## Source

- **Source PDF:** `docs/product/PEAK3_Product_Implementation_Blueprint.pdf`
- **PDF size:** 2,206,231 bytes (2.10 MiB)
- **PDF SHA-256:** `2fdfe6d2a54508c0beffcdac119a18c4fe544d47776c778eb2f0177d176d1311`
- **Page count (pdfinfo):** 69
- **Page size:** 612 × 792 pt (US Letter)
- **PDF producer:** LibreOffice 25.2.3.2 (Creator: Writer)
- **PDF creation date:** 2026-06-27

## Output

- **Output directory:** `docs/product/blueprint_pages/`
- **Files:** `page-01.png` … `page-69.png`, one PNG per PDF page, in page order
- **Total rendered size:** ~22 MB for 69 pages + contact sheet
- **Individual page size:** ~110–420 KB each, varying with diagram/table density

## Exact render command used

```bash
pdftoppm -png -r 180 \
  "docs/product/PEAK3_Product_Implementation_Blueprint.pdf" \
  "docs/product/blueprint_pages/page"
```

- Tool: `pdftoppm` (Poppler 26.06.0, via Homebrew), run entirely locally — no
  network access, no hosted rendering service.
- Resolution: 180 DPI (within the requested 160–220 DPI range).
- `pdftoppm`'s own two-digit zero-padded numbering (`page-01.png` …
  `page-69.png`) matched the required naming exactly for a 69-page document,
  so no rename step was needed.
- No cropping was applied; each PNG is the full page.

## Contact sheet

- **Path:** [`blueprint_pages/contact_sheet.png`](blueprint_pages/contact_sheet.png)
- **Layout:** 8 columns × 9 rows (69 thumbnails, last row partially filled),
  220 px-wide thumbnails with a page-number label (`p01` … `p69`) under each
  tile, dark background for contrast.
- **Generation:** built locally from the already-rendered `page-*.png` files
  using Pillow (installed into the repo's existing `.venv` — no system-wide
  install, no network fetch of page content). Script used:
  `/private/tmp/.../scratchpad/make_contact_sheet.py` (ad hoc, not committed
  to the repo; rerun `pdftoppm` + a Pillow grid script if the contact sheet
  ever needs regenerating).
- **Size:** 1856 × 2862 px, ~2.5 MB.

## Full page list

| Page | File |
|---:|---|
| 01 | [page-01.png](blueprint_pages/page-01.png) |
| 02 | [page-02.png](blueprint_pages/page-02.png) |
| 03 | [page-03.png](blueprint_pages/page-03.png) |
| 04 | [page-04.png](blueprint_pages/page-04.png) |
| 05 | [page-05.png](blueprint_pages/page-05.png) |
| 06 | [page-06.png](blueprint_pages/page-06.png) |
| 07 | [page-07.png](blueprint_pages/page-07.png) |
| 08 | [page-08.png](blueprint_pages/page-08.png) |
| 09 | [page-09.png](blueprint_pages/page-09.png) |
| 10 | [page-10.png](blueprint_pages/page-10.png) |
| 11 | [page-11.png](blueprint_pages/page-11.png) |
| 12 | [page-12.png](blueprint_pages/page-12.png) |
| 13 | [page-13.png](blueprint_pages/page-13.png) |
| 14 | [page-14.png](blueprint_pages/page-14.png) |
| 15 | [page-15.png](blueprint_pages/page-15.png) |
| 16 | [page-16.png](blueprint_pages/page-16.png) |
| 17 | [page-17.png](blueprint_pages/page-17.png) |
| 18 | [page-18.png](blueprint_pages/page-18.png) |
| 19 | [page-19.png](blueprint_pages/page-19.png) |
| 20 | [page-20.png](blueprint_pages/page-20.png) |
| 21 | [page-21.png](blueprint_pages/page-21.png) |
| 22 | [page-22.png](blueprint_pages/page-22.png) |
| 23 | [page-23.png](blueprint_pages/page-23.png) |
| 24 | [page-24.png](blueprint_pages/page-24.png) |
| 25 | [page-25.png](blueprint_pages/page-25.png) |
| 26 | [page-26.png](blueprint_pages/page-26.png) |
| 27 | [page-27.png](blueprint_pages/page-27.png) |
| 28 | [page-28.png](blueprint_pages/page-28.png) |
| 29 | [page-29.png](blueprint_pages/page-29.png) |
| 30 | [page-30.png](blueprint_pages/page-30.png) |
| 31 | [page-31.png](blueprint_pages/page-31.png) |
| 32 | [page-32.png](blueprint_pages/page-32.png) |
| 33 | [page-33.png](blueprint_pages/page-33.png) |
| 34 | [page-34.png](blueprint_pages/page-34.png) |
| 35 | [page-35.png](blueprint_pages/page-35.png) |
| 36 | [page-36.png](blueprint_pages/page-36.png) |
| 37 | [page-37.png](blueprint_pages/page-37.png) |
| 38 | [page-38.png](blueprint_pages/page-38.png) |
| 39 | [page-39.png](blueprint_pages/page-39.png) |
| 40 | [page-40.png](blueprint_pages/page-40.png) |
| 41 | [page-41.png](blueprint_pages/page-41.png) |
| 42 | [page-42.png](blueprint_pages/page-42.png) |
| 43 | [page-43.png](blueprint_pages/page-43.png) |
| 44 | [page-44.png](blueprint_pages/page-44.png) |
| 45 | [page-45.png](blueprint_pages/page-45.png) |
| 46 | [page-46.png](blueprint_pages/page-46.png) |
| 47 | [page-47.png](blueprint_pages/page-47.png) |
| 48 | [page-48.png](blueprint_pages/page-48.png) |
| 49 | [page-49.png](blueprint_pages/page-49.png) |
| 50 | [page-50.png](blueprint_pages/page-50.png) |
| 51 | [page-51.png](blueprint_pages/page-51.png) |
| 52 | [page-52.png](blueprint_pages/page-52.png) |
| 53 | [page-53.png](blueprint_pages/page-53.png) |
| 54 | [page-54.png](blueprint_pages/page-54.png) |
| 55 | [page-55.png](blueprint_pages/page-55.png) |
| 56 | [page-56.png](blueprint_pages/page-56.png) |
| 57 | [page-57.png](blueprint_pages/page-57.png) |
| 58 | [page-58.png](blueprint_pages/page-58.png) |
| 59 | [page-59.png](blueprint_pages/page-59.png) |
| 60 | [page-60.png](blueprint_pages/page-60.png) |
| 61 | [page-61.png](blueprint_pages/page-61.png) |
| 62 | [page-62.png](blueprint_pages/page-62.png) |
| 63 | [page-63.png](blueprint_pages/page-63.png) |
| 64 | [page-64.png](blueprint_pages/page-64.png) |
| 65 | [page-65.png](blueprint_pages/page-65.png) |
| 66 | [page-66.png](blueprint_pages/page-66.png) |
| 67 | [page-67.png](blueprint_pages/page-67.png) |
| 68 | [page-68.png](blueprint_pages/page-68.png) |
| 69 | [page-69.png](blueprint_pages/page-69.png) |

For a topic-by-page mapping (which part of the blueprint each page covers),
see Appendix A of `PEAK3_GAME_PLATFORM_MASTER_PLAN.md` at the repo root,
which cross-references the same 69 pages against blueprint part numbers.

## Note for future AI agents

- These per-page PNGs are the authoritative visual source for diagrams,
  tables, and layout in the blueprint. Prose extraction or summaries can miss
  or misrepresent visual structure (flywheel diagrams, architecture
  diagrams, table layouts) — inspect the actual page image when a task
  touches product structure, gameplay, navigation, design, competition
  systems, formula/attribute exploration, or architecture.
- `docs/product/blueprint_pages/` and this index are not regenerated
  automatically. If the source PDF changes, rerun the `pdftoppm` command
  above and regenerate the contact sheet.
- `data/web/`, `docs/product/blueprint_pages/`, and other generated
  directories are not implied to be committed by their presence here — check
  `.gitignore` before assuming any generated artifact is tracked.
