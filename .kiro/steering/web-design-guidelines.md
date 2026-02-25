---
inclusion: fileMatch
fileMatchPattern: "apps/admin/src/**/*.{tsx,ts,css}"
---

# Web Interface Guidelines (Vercel)

> Source: https://vercel.com/design/guidelines
> 适用于 Admin 后台 (React 19 + Vite SPA) 的 UI 开发

## Interactions

- Keyboard works everywhere. All flows are keyboard-operable & follow WAI-ARIA Authoring Patterns
- Clear focus. Every focusable element shows a visible focus ring. Prefer `:focus-visible` over `:focus`. Set `:focus-within` for grouped controls
- Manage focus. Use focus traps, move & return focus according to WAI-ARIA Patterns
- Match visual & hit targets. If visual target < 24px, expand hit target to ≥ 24px. Mobile minimum: 44px
- Mobile input size. `<input>` font size ≥ 16px on mobile to prevent iOS Safari auto-zoom
- Respect zoom. Never disable browser zoom
- Hydration-safe inputs. Inputs must not lose focus or value after hydration
- Don't block paste. Never disable paste in `<input>` or `<textarea>`
- Loading buttons. Show a loading indicator & keep the original label
- Minimum loading-state duration. Show-delay ~150–300ms & minimum visible time ~300–500ms to avoid flicker
- URL as state. Persist state in the URL so share, refresh, Back/Forward work (e.g., nuqs)
- Optimistic updates. Update UI immediately when success is likely; reconcile on server response
- Ellipsis for further input & loading states. "Rename…", "Loading…", "Saving…"
- Confirm destructive actions. Require confirmation or provide Undo
- Prevent double-tap zoom. Set `touch-action: manipulation`
- Deep-link everything. Filters, tabs, pagination, expanded panels
- Links are links. Use `<a>` or `<Link>` for navigation, never `<button>` or `<div>`
- Announce async updates. Use polite `aria-live` for toasts & inline validation

## Animations

- Honor `prefers-reduced-motion`. Provide a reduced-motion variant
- Preference: CSS > Web Animations API > JS libraries
- Compositor-friendly. Prioritize `transform`, `opacity`; avoid `width`, `height`, `top`, `left`
- Never `transition: all`. Explicitly list only intended properties
- Cross-browser SVG transforms. Apply to `<g>` wrappers with `transform-box: fill-box; transform-origin: center`

## Layout

- Optical alignment. Adjust ±1px when perception beats geometry
- Deliberate alignment. Every element aligns intentionally
- Responsive coverage. Verify on mobile, laptop, & ultra-wide
- No excessive scrollbars. Fix overflow issues
- Let the browser size things. Prefer flex/grid/intrinsic layout over measuring in JS

## Content

- Inline help first. Prefer inline explanations; tooltips as last resort
- Stable skeletons. Mirror final content exactly to avoid layout shift
- Accurate page titles. `<title>` reflects current context
- No dead ends. Every screen offers a next step or recovery path
- All states designed. Empty, sparse, dense, & error states
- Tabular numbers for comparisons. Use `font-variant-numeric: tabular-nums`
- Redundant status cues. Don't rely on color alone; include text labels
- Icons have labels. Convey meaning with text for non-sighted users
- Semantics before ARIA. Prefer native elements (`button`, `a`, `label`, `table`) before `aria-*`
- Headings & skip link. Hierarchical `<h1–h6>` & "Skip to content" link
- Non-breaking spaces for glued terms. `10&nbsp;MB`, `⌘&nbsp;+&nbsp;K`

## Forms

- Enter submits. When text input focused, Enter submits if only control
- Labels everywhere. Every control has a `<label>` or is associated with one
- Keep submit enabled until submission starts; then disable during in-flight request with spinner
- Don't block typing. Allow any input & show validation feedback
- Error placement. Show errors next to fields; on submit, focus first error
- Autocomplete & names. Set `autocomplete` & meaningful `name` values
- Correct types & input modes. Use right `type` & `inputmode`
- Placeholders signal emptiness. End with ellipsis
- Unsaved changes. Warn before navigation when data could be lost

## Performance

- Track re-renders. Minimize & make re-renders fast
- Minimize layout work. Batch reads/writes; avoid unnecessary reflows
- Large lists. Virtualize with `content-visibility: auto`
- No image-caused CLS. Set explicit image dimensions
- Preconnect to origins. `<link rel="preconnect">` for asset/CDN domains

## Design

- Layered shadows. Mimic ambient + direct light with ≥ 2 layers
- Nested radii. Child radius ≤ parent radius & concentric
- Accessible charts. Use color-blind-friendly palettes
- Minimum contrast. Prefer APCA over WCAG 2
- Interactions increase contrast. `:hover`, `:active`, `:focus` have more contrast than rest
- Set `color-scheme: dark` in dark themes for proper scrollbar contrast
