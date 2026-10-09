# Styling Stamjer

The application uses plain CSS. Keep its blue palette, Inter typography and light surfaces consistent across routes.

## Ownership and loading

Global styles load once, in order, from `src/main.jsx`:

1. `styles/tokens.css`: design values, including colors, spacing, radii and control sizes.
2. `index.css`: fonts, reset, typography, keyboard focus, print and accessibility preferences.
3. `styles/shared.css`: UI primitives, common layouts and states.
4. Application shell, followed by component and lazy page styles.

Page styles own feature-specific layout. Scope selectors under the page root with `:where(...)`; never redefine global `.btn`, `.form-input`, `.card`, `.modal-content` or notification classes in a page file. A reusable component imports its own stylesheet and must work without another page's stylesheet.

The shared entry point imports `controls.css`, `layout.css`, `feedback.css` and `motion.css`. Keep new shared rules in the appropriate file instead of growing another all-purpose stylesheet.

## Shared classes

- Buttons: `btn` plus `btn-primary`, `btn-secondary`, `btn-danger` or `btn-link`. Use `btn-compact` for intentionally small actions.
- Controls: `form-input`, `form-select`, `form-textarea`; `form-input-compact` is reserved for inline editors such as guest names. Use the shared error and disabled states.
- Cards: `card`, optionally `card-elevated` and `card-padded`, with `card-header`, `card-body` and `card-footer`.
- Pages: `page-content`, optionally `page-content-narrow`. `page-header-navigation` visually hides the repeated page heading while keeping it available to assistive technology.
- Forms: `form-group`, `form-grid`, `form-grid-single`, `form-group-full`, `form-actions` and `form-alert`.

Prefer tokens over repeated values. Use explicit variants for intentional differences. Keep runtime-dependent values inline; move static presentation to CSS. Avoid `!important` except for accessibility preferences and documented third-party overrides. Noninteractive panels should stay still on hover.

## Verification

Run `npm run build`, then `npm run test:styles:browser` and `npm run test:groups:browser`. Both browser commands require Chromium and use an isolated in-memory API. Screenshots and reports are saved under `.tmp/groups-browser-*`.

The style checks cover all routes at 320, 390, 768 and 1280 pixels, shared controls, route order, keyboard focus and device appearance preferences. Review screenshots after fonts and finite animations have settled.
