# 适中 Shizhong — Design System (v2)

**Direction: warm, calm, clear.** A life-services app people open several times a day. Content
(photos, prices, people) carries the colour; the chrome stays quiet. The panda-logo red and yellow
are brand accents, not wallpaper. One visual language across all five tabs — the Me tab, gift shop
and VIP pages must not look like a different app.

## 1. Tokens (core/tokens.css) — never hard-code values

| Use | Token |
|---|---|
| Page background | `--c-bg` (warm off-white) |
| Cards, sheets, bars | `--c-surface`; nested / inputs-readonly `--c-surface-2`; pressed `--c-surface-3` |
| Borders / hairlines | `--c-border`; stronger outlines `--c-border-strong` |
| Text | `--c-text` primary, `--c-text-2` secondary, `--c-text-3` captions (all ≥ 4.5:1) |
| Brand fill (primary buttons, active tab bar, selected) | `--c-brand` + `--c-on-brand` |
| Brand-coloured text (prices, links, "view all") | `--c-brand-text` |
| Soft brand backgrounds | `--c-brand-soft` |
| Panda yellow (check-in, highlights) | `--c-accent` + `--c-on-accent` |
| Premium / VIP | `--c-gold`, `--c-gold-soft`, `--c-gold-line` |
| Status | `--c-success/-soft`, `--c-warning/-soft`, `--c-danger/-soft`, `--c-info/-soft` |
| Live rooms, calls, video (always dark) | `--c-immersive-*` |

Type scale: `--fs-11` (badges/legal only) · `--fs-12` captions · `--fs-13` secondary · `--fs-14`
small body/buttons · `--fs-15` body · `--fs-16` inputs/large body · `--fs-18` section titles ·
`--fs-20` page titles · `--fs-24/28/34` hero numbers. Weights 400/500/600/700 only.
**Nothing readable below 11px; information (price, time, distance, status) ≥ 12px.**

Spacing: 4px grid (`--sp-1`…`--sp-10`), page gutter `--gutter` 16px. Radius: `--r-xs` 6 (tags) ·
`--r-sm` 10 (small buttons, thumbnails) · `--r-md` 14 (buttons, inputs, list thumbs) · `--r-lg` 20
(cards, sheets) · `--r-xl` 28 (hero cards) · `--r-full`. Elevation: `--shadow-1` resting cards,
`--shadow-2` floating, `--shadow-3` toasts/menus. Borders are preferred over shadows on light
surfaces. Stacking: `--z-*` tokens only.

Colours outside tokens are allowed only inside illustrations/gift art and data-driven accents
(category tint, gift accent) — pass them as CSS custom properties from data.

## 2. Components (core/components.css)

* **Buttons** `.btn` + `.btn-primary | .btn-secondary | .btn-outline | .btn-tonal | .btn-ghost |
  .btn-danger | .btn-accent`, sizes `.btn-lg` (50px, main CTA) / default (44px) / `.btn-sm` (34px
  visual, 44px hit area), `.btn-block`. One primary button per view. Icon-only: `.icon-button`
  (44×44) with `aria-label`.
* **Chips** `.chip` in a `.chip-row` (horizontal scroll, no scrollbar). Selected =
  `aria-pressed="true"` (filters) — dark fill, not red.
* **Tabs** `.tabs` > `.tab[role=tab][aria-selected]` inside `role="tablist"`: text tabs with a
  short red underline. Two-to-four equal options inside a card: `.segmented`.
* **Lists** `.list` (rounded surface) > `.list-row` (min 56px, 16px padding, inset hairline).
  Trailing value `.row-value`, chevron `icon('chevron','chevron')`.
* **Cards** `.card` (+`.card-pad`). Section = `.section` > `.section-header` > `.section-title`.
* **Forms** `.form-group` > `.form-label` (+`.required`) + `.field` + `.form-hint` / `.form-error`.
  Two fields side by side: `.form-row`. Toggles: `button.switch[role=switch][aria-checked]`.
* **Tags** `.tag` (+`-brand|-gold|-success|-warning|-info`), **badges** `.badge`, `.dot`.
* **Avatars** `.avatar.avatar-24|32|40|48|56|72|96` — always round.
* **Feedback** `toast()`, `SZ.confirm()`, `.empty-state` (icon, title, one line, one action),
  `.skeleton` for loading placeholders. Every list has loading, empty and error states.

## 3. Page anatomy

**Tab roots** (Home, Discover, Live, Messages, Me):
`.app-bar` (sticky, 56px): left = page title (`.app-bar-title`, 20px/700; Home shows the logo
lockup instead), right = `.city-pill` where location matters (Home, Discover, Live) + up to two
`.icon-button`s. No slogan headlines as page titles — a short subtitle line may sit under the
app bar only where it adds meaning. Then tabs / chips, then content sections with 16px gutters.

**Overlays**: screens (full height, header 56px: back button, centered 17px/600 title, optional
right action) for navigation depth; sheets (rounded top 20px, handle, title + close) for short
tasks and pickers. Primary CTA of a task sits at the bottom in a sticky footer
(`position: sticky; bottom: 0`, surface background, safe-area padding).

**Bottom navigation**: five equal tabs, 58px + safe area, icon 24 + label 11/500. Active = brand
colour icon+label. No raised middle button. Badges use `.badge`.

**Immersive screens** (live room, 1:1 call, voice/video call): dark, content-first; controls on
translucent dark pills (`--c-immersive-surface`), text ≥ 12px, at most one row of floating chips.

## 4. Content & imagery

* Photos: rounded `--r-md`/`--r-lg`, `object-fit: cover`, fixed aspect ratios (4:3 cards,
  1:1 thumbs, 3:4 live covers), `loading="lazy"`, meaningful `alt` (name of the thing).
* Prices: `.price` (brand text, tabular numbers). "Starting at" prices keep the word
  (`t('catalog.priceFrom', …)`). Currency always via `SZ.fmt.money`.
* Status colours: pending = warning, confirmed/in service = info, done = success,
  cancelled = neutral (`--c-text-3`).
* Numbers: `SZ.fmt.compact` for large counts (1.2万 / 12K); never show raw 1000000000.
* Demo disclaimers: one quiet line per screen at most (`.caption`), not on every list header.

## 5. Interaction

* Hit targets ≥ 44×44. Visible focus via `:focus-visible` ring (token `--focus-ring`).
* Destructive actions: `SZ.confirm({ danger: true })` or an undo toast. Never silent.
* Motion: 120–320ms, `--ease-out`; respect `prefers-reduced-motion` (core already shortens all
  animations; big effects should also offer skip).
* Loading > 300ms shows a skeleton or the top progress bar; errors show a retry.
* Text must survive translation: no fixed-width text boxes; allow 2 lines where labels are long
  in English; test at 320px and in `--locale en`.

## 6. Dark mode

`[data-theme="dark"]` swaps the token values. If every colour comes from tokens, dark mode
works automatically. Check contrast of any image-on-colour areas in both themes.

## 7. Accessibility checklist per screen

Semantic headings (h1 page / h2 sections), buttons are `<button>`, icons `aria-hidden`, icon-only
buttons have `aria-label`, images have `alt` (decorative `alt=""`), tabs use tablist semantics,
live regions for async results, `lang` attribute on text in another language, contrast ≥ 4.5:1.
