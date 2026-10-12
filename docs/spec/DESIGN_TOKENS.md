# Design tokens and component styles

The look must match the prototype as closely as possible (customer requirement). Everything here was taken from the
prototype stylesheet (`extracted.css`) and checked against the 51 screenshots.

- Runtime tokens: `packages/design-tokens/src/tokens.css` (import once in the root layout) and TS mirror
  `packages/design-tokens/src/index.ts` (kept in sync by a unit test).
- Verbatim reference stylesheet: `packages/design-tokens/reference/prototype.css` — port its rules into CSS Modules
  (FE-5 choice: CSS Modules, no Tailwind) keeping values identical; never import it at runtime.
- Assets: `packages/design-tokens/assets/` — `kr-surveys-logo.svg` (header brandmark, 40 px high), `hero-header-bg.jpg`
  (header photo master, `center 38% / cover`; the app serves its `hero-header-1280` and `hero-header-640` AVIF and WebP
  derivatives from `apps/web/public/brand` and preloads the AVIF: it is the LCP element), `kr-mark.svg` (rotated watermark).

## 1. Colour tokens

**Deliberate deviation from the prototype (WCAG 1.4.3, PRODUCT_SPEC §12, known defect D3).** Four secondary text colours
are changed from the prototype so every text/surface pair reaches 4.5:1 (WCAG 2.2 AA, not overridable):

| Token                | Prototype                    | Here      | Why                                                                                                                                                |
| -------------------- | ---------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ink-2` (light)    | `#777777` (4.48 on white)    | `#5e5e5e` | 3.7 to 4.5:1 on the field, red, green and grey tints. Now 5.4:1 or more on every surface.                                                          |
| `--ink-3` (light)    | `#8c8c8c` (3.36 on white)    | `#686868` | 2.8 to 3.4:1 on every surface. Now 4.63:1 (on `--grey-bg`, the worst case) or more. Kept lighter than `--ink-2` so the hierarchy survives.         |
| `--grey-ink` (light) | `#6d6c69` (4.37 on grey-bg)  | `#64635f` | The "Not required" chip, stage count and swatch text. Now 5.0:1 on `--grey-bg`.                                                                    |
| `--ink-3` (dark)     | `#8a8a8a` (3.91 on green-bg) | `#9d9d9d` | 3.9 to 4.2:1 on the red, green, grey and accent tints (the checkpoint number on a red card). Now 4.97:1 or more; still darker than dark `--ink-2`. |

**Link ink (known defect D7).** `--accent` (`#d65614`) is 4.03:1 on white and 3.42:1 on the red tint, so orange _text_ (the
conditions checklist's agency and "up" links, "go to" links, the "reset to 90 days" link) uses `--accent-ink` instead: `#b5410e`
in light, `#ee8450` in dark, 4.5:1 or more on every surface and tint in both themes (a unit test pins it). `--accent` stays for
fills, borders and the focus ring.

| Token                                         | Light                                                                                                                               | Dark                              | Used for                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `--bg`                                        | `#61625d`                                                                                                                           | `#141618`                         | Page background (under the noise texture `--tex`)                        |
| `--surface`                                   | `#ffffff`                                                                                                                           | `#1e2023`                         | Panels, cards' inner boxes, buttons                                      |
| `--field`                                     | `#f5f5f3`                                                                                                                           | `#1a1c1f`                         | Inputs, list rows, dialog body                                           |
| `--ink`                                       | `#303133`                                                                                                                           | `#eeeeee`                         | Body text                                                                |
| `--ink-2`                                     | `#5e5e5e`                                                                                                                           | `#b3b3b3`                         | Secondary text (descriptions)                                            |
| `--ink-3`                                     | `#686868`                                                                                                                           | `#9d9d9d`                         | Tertiary text (labels, counts)                                           |
| `--line`                                      | `#eaeaea`                                                                                                                           | `#34373b`                         | Borders, dividers                                                        |
| `--on-bg` / `--on-bg-2`                       | `#f2f2f0` / `#d6d6d2`                                                                                                               | `#eeeeee` / `#a8a8a8`             | Text directly on the page background (labels, footer)                    |
| `--brand` / `--brand-ink`                     | `#141618` / `#ffffff`                                                                                                               | `#0d0e10` / (inherits `#ffffff`)  | Countdown tiles, pressed dashboard filter                                |
| `--accent`                                    | `#d65614`                                                                                                                           | `#e8743a`                         | Primary buttons, header rule, focus ring, panel heading underline, links |
| `--accent-soft`                               | `#fbe9df`                                                                                                                           | `#3d2619`                         | Banner, drop-zone hover, notes                                           |
| `--red-bg` / `--red-line` / `--red-ink`       | `#fce8e6` / `#efbcb6` / `#9b2c22`                                                                                                   | `#3a2320` / `#6a3a33` / `#f0a79d` | Not completed, declined, errors                                          |
| `--green-bg` / `--green-line` / `--green-ink` | `#e3f3e5` / `#a8d6b0` / `#2e6b3a`                                                                                                   | `#1f3324` / `#3d6a47` / `#8fd09c` | Completed, accepted, cleared                                             |
| `--grey-bg` / `--grey-line` / `--grey-ink`    | `#ebeae8` / `#cfcdc9` / `#64635f`                                                                                                   | `#2c2c2a` / `#454542` / `#9a9994` | Not required, excluded stages                                            |
| `--fee` / `--fee-soft`                        | `#7a5d00` / `#fbf0b8`                                                                                                               | `#e9cf62` / `#37301a`             | Client payment tags, folder icon, warnings, "Waiting on client", PENDING |
| `--item` / `--item-soft`                      | `#1f5f8b` / `#e1eef7`                                                                                                               | `#79b3dd` / `#1a2c3a`             | KR payment tags, KR responsibility chip, job chips                       |
| `--claim` / `--claim-soft`                    | `#a3410b` / `#fde2cf`                                                                                                               | `#f0a070` / `#3d2619`             | "ITEM n PAYMENT REQUIRED" progress-claim tags                            |
| `--on-status`                                 | `#ffffff`                                                                                                                           | `#151514`                         | Text on pressed status buttons / coloured countdown tiles                |
| `--shadow`                                    | `0 1px 2px rgba(40,30,20,.06)`                                                                                                      | `none`                            | Summary panels                                                           |
| `--mark-op`                                   | `0.07`                                                                                                                              | `0.04`                            | Watermark opacity                                                        |
| `--accent-hover`                              | `#c04a10`                                                                                                                           | (same)                            | Primary button hover                                                     |
| Bar gradients                                 | green `#8fd09c→--green-ink`, grey `#dcdad6→#aeaca8`, red `#f6c9c3→#e08d83`                                                          | same                              | Progress bars                                                            |
| Hero overlay                                  | `linear-gradient(180deg, rgba(20,22,24,.78) 0%, rgba(20,22,24,.55) 55%, rgba(20,22,24,.8) 100%)` over the photo, fallback `#141618` | same                              | Header                                                                   |
| Dialog backdrop                               | `rgba(20,18,16,.55)`                                                                                                                | same                              | Viewer                                                                   |

Dark mode selectors (exactly as the prototype): `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }`
and `:root[data-theme="dark"] {…}`; `color-scheme: dark` in both. Contrast: all text/background pairs above meet WCAG AA
(4.5:1) except decorative bars; the e2e axe scan runs in both themes.

## 2. Typography

Font: **Yantramanav** 300/400/500/700/900 (Google Fonts, self-hosted via `next/font/google`), fallback
`"Segoe UI", system-ui, Helvetica, Arial, sans-serif`. Base `15px/1.5`. Tabular numerals for counts/percentages.

| Use                                           | Size / weight / case                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Hero H1                                       | `clamp(26px, 4.2vw, 40px)`, 500, upper-case, letter-spacing .01em, line-height 1.1 |
| Hero tag "SUBDIVISION TRACKER"                | 13px, 500, upper-case, letter-spacing .12em                                        |
| Hero subtitle                                 | 17px, 300                                                                          |
| Panel H2 ("SUBDIVISION PROGRESS")             | 15px, 500, upper-case, .04em, 2px accent underline                                 |
| Stage bar name                                | 17px, 500, upper-case, .04em; percentage 18px tabular                              |
| Card title                                    | 16px, 500; number 600 grey; description `--ink-2`                                  |
| Section titles (pkg-t: "JOB NOTES")           | 15px, 500, upper-case, .04em                                                       |
| Dashboard H2                                  | 18px, 500, upper-case                                                              |
| Labels (JOB, STAGES, field labels, dec-label) | 11px, upper-case, letter-spacing .07em, `--ink-3` (or `--on-bg` on the page)       |
| Tags / chips                                  | 11–12.5px, 600                                                                     |
| Small buttons                                 | 12.5px; primary buttons upper-case, letter-spacing 1.5px, 500                      |
| Monospace (email/text viewer)                 | `12.5px/1.5 Consolas, ui-monospace, monospace`                                     |

## 3. Shape, spacing, layout

- Radius **3px** everywhere (bars 9px/5px pill ends, progress ring circle).
- Page: `.wrap` max-width 1180px, inline padding 16px. Header padding 22px 34px (block), grid gap 44px, 4px accent bottom border.
- Gaps: stages 8px, cards 8px, card grid `minmax(0,1fr) 300px` gap 12px 18px, card padding 12px 14px, panels padding
  10px 12px, summary gap 16px, dashboard grid `repeat(auto-fill, minmax(290px, 1fr))` gap 10px.
- Panel indent under card title: `calc(2.6em + 8px)` (removed < 760px).
- Borders 1px `--line`; status surfaces use the matching `*-line`.

## 4. Components (prototype class → React component; WP that owns it)

| Component                                                                                                                                                                                             | Key styles (see reference CSS for full rules)                                                    | Owner |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----- |
| `AppHeader` (`header.top`, `.hero-bar`, `.brandmark`, `.hero-tag`, `.hero-txt`, `.sep`, `.sub`)                                                                                                       | photo + overlay, white text, 90×2px accent rule, logo 40px                                       | WP-03 |
| `Button` (`.btn`, `.primary`, `.small`, `:disabled`)                                                                                                                                                  | 1px border, 7px 12px padding; primary accent bg, white upper-case; disabled opacity .5           | WP-03 |
| `Banner` (`.banner`)                                                                                                                                                                                  | accent-soft bg, 13px, 9px 12px padding                                                           | WP-03 |
| `JobBar` (`.jobbar`)                                                                                                                                                                                  | flex wrap gap 10px; select flex 1 1 260px                                                        | WP-14 |
| `ProgressPanel` (`.panel`, `.prog`, `.pct` conic ring 78px, `.bar` 18px, `.cnt.c/.n/.x`) + `ApprovalDates` (`.appr*`)                                                                                 | ring `conic-gradient(var(--green-ink) calc(var(--pc)*1%), var(--line) 0)` with 72% inner surface | WP-14 |
| `StatusKey` (`.legend`, `.sw`, `.paykey`)                                                                                                                                                             | swatches 18×14px                                                                                 | WP-14 |
| `StageBar` (`.stage-bar[data-s]`, `.chev`, `.sb-*`, `.off`)                                                                                                                                           | 13px 16px padding; chevron rotates 45°/-45°; track 90×7px                                        | WP-14 |
| `CheckpointCard` (`.card[data-s]`, `.ttl`, `.num`, `.det`, `.meta`, `.stat-label`, `.ctrl`, `.seg`, `.row select`)                                                                                    | status colours; seg pressed colours `--green-ink/--red-ink/--grey-ink` with `--on-status`        | WP-15 |
| `Tag` (`.tag.claim/.fee/.krpay/.trig`)                                                                                                                                                                | 11.5px 600, 2px 8px                                                                              | WP-15 |
| `Folder`, `DocRow`, `DropZone` (`.approval`, `.folder*`, `.docs`, `.doc`, `.drop`, `.drop.small`, `.req.ok/.miss`, `.slot*`, `.thumbs`)                                                               | folder icon 18×14 `--fee` with tab; drop 2px dashed, hover accent                                | WP-15 |
| `DecisionPanel` (`.dec`, `.dec-btn.acc/.dcl`, `.dec-form`, `.dec-result[data-v]`, `.dec-c`)                                                                                                           | result green/red boxes, italic comment                                                           | WP-15 |
| `PaidPanel`, `KrNotePanel` (`.paid-box`, `.kn`)                                                                                                                                                       |                                                                                                  | WP-15 |
| `OutcomeBox` + `Countdown` (`.outcome`, `.oc-*`, `.cd`, `.cd-digits`, `.cd-cap`, `.cd-empty`)                                                                                                         | 4px accent left border; tiles min 52px `--brand`, soon `--fee`, past `--red-ink`                 | WP-14 |
| `EmailsPanel` (`.mails`, `.mail`, `.mail-m`)                                                                                                                                                          |                                                                                                  | WP-15 |
| `ConditionsPanel`, `ConditionCard`, `AgencyEvidence` (`details.conds`, `.clist2`, `.ev-c`, `.ev-h`, `.ced`, `.ctick`, `.cstate`, `.cfields`, `.ccm`, `.guess`, `.agency-sel`, `.evid-top`, `.acond*`) | open red / cleared green; struck-through text when cleared                                       | WP-16 |
| `DocumentViewer` (`dialog`, `.dlg-h`, `.dlg-b`, `.dwg-msg`)                                                                                                                                           | `min(960px, 100vw - 32px)`, body `min(72vh, 820px)`                                              | WP-17 |
| `JobNotes` (`.pkg.acc.jobnotes`, `.dn-form`, `.dn-list`, `.dn-meta`, `.jn-for.*`)                                                                                                                     | top border `--brand`                                                                             | WP-17 |
| `JobFiles` (`.pkg`, `.pkg-t`)                                                                                                                                                                         | 3px accent top border                                                                            | WP-17 |
| `Dashboard` (`.dash-head`, `.dash-filter`, `.dash-types`, `.dt`, `.dt-n`, `.dash-sum`, `.cnt.w`, `.dash-grid`, `.dcard`, `.dc-*`) + `NewJobForm` (`form.newjob`)                                      | card 4px left border red/green                                                                   | WP-13 |
| `AccessManager` (`.acc-form`, `.acc-list`, `.acc-e/.acc-j/.acc-r/.acc-s`, `.acc-lock`, `.acc-scope`)                                                                                                  |                                                                                                  | WP-13 |
| Footer (`footer`)                                                                                                                                                                                     | `--on-bg-2`, 12px                                                                                | WP-03 |

New UI (not in the prototype) reuses these primitives: theme control and user menu in `.hero-bar` (small buttons, white
text on the photo), admin tables (`.panel` + `.acc-list` row style), sign-in page (hero header + one `.panel` with a
primary button).

## 5. Breakpoints and motion

`max-width: 760px` stack summary/cards/outcome, remove indents; `640px` condition comment fields stack; `520px` hide stage
track and count (except excluded label), outcome dates stack. Transitions: bar widths .4s, card colours .2s, chevron
.15s — all disabled under `prefers-reduced-motion: reduce`.

## 6. Print

`@media print`: white background, no watermark, hide `.no-pdf` elements (buttons, drop zones, access manager, theme/user
controls), stages expanded, `break-inside: avoid` on cards, outcome box, condition cards.
