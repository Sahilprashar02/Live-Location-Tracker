# Live Location Tracker — Design System

> Tokens, primitives, and the layout rules that keep the UI consistent.
> Filled from `frontend/css/style.css` and `frontend/index.html` on 2026-10-20.

---

## 1. Principles

1. **Map-first.** The Leaflet canvas fills the viewport; every control floats
   above it. There is no document scroll and no conventional page chrome.
2. **Dark, translucent glass.** Panels use a dark background with a thin light
   border, blur, and a deep shadow. The map layer can be light, but the UI shell
   stays dark.
3. **Progressive disclosure.** The sidebar, search results, layer picker,
   directions panel, community panel, and tools dock are hidden until needed.
4. **Mobile parity, not a separate design.** At ≤768 px the side panels become
   bottom sheets and a four-button bottom nav replaces the desktop dock.
5. **Immediate local feedback.** The user's own marker is drawn before the
   socket/Kafka round-trip; toasts confirm actions and failures.

These principles are visible in the CSS and `app.js`; they are not a separate
design document that the code follows.

---

## 2. Colour

All colours are defined as CSS custom properties on `:root` in
`frontend/css/style.css`.

| Token | Value | Use |
|---|---|---|
| `--bg-primary` | `#0a0a1a` | Page/map background, theme colour |
| `--bg-secondary` | `#12122a` | Popups, elevated surfaces |
| `--glass-bg` | `rgba(255, 255, 255, 0.04)` | Glass panel/card fill |
| `--glass-border` | `rgba(255, 255, 255, 0.08)` | Panel borders, dividers, scrollbar thumb |
| `--glass-shadow` | `0 8px 32px rgba(0, 0, 0, 0.4)` | Panel/popup shadow |
| `--accent-cyan` | `#00d2ff` | Primary accent, active icons, links, focus cues |
| `--accent-purple` | `#7a2bff` | Secondary accent, geofence circles, gradient end |
| `--accent-gradient` | `linear-gradient(135deg, #00d2ff, #7a2bff)` | Brand gradient, primary buttons, logo glow |
| `--text-primary` | `rgba(255, 255, 255, 0.95)` | Primary text |
| `--text-secondary` | `rgba(255, 255, 255, 0.6)` | Supporting text |
| `--text-muted` | `rgba(255, 255, 255, 0.35)` | Captions, coordinates, disabled states |
| `--success` | `#00e676` | Connected dot, success toast, online state |
| `--warning` | `#ffab40` | Warning state |
| `--danger` | `#ff5252` | Errors, destructive actions |
| `--radius-sm` | `8px` | Small controls |
| `--radius-md` | `14px` | Cards, user panel |
| `--radius-lg` | `20px` | Panels, mobile nav |
| `--radius-xl` | `28px` | Bottom sheets |
| `--font` | `'Inter', -apple-system, BlinkMacSystemFont, sans-serif` | All UI text |
| `--transition` | `0.3s cubic-bezier(0.4, 0, 0.2, 1)` | Hover/open transitions |

Additional colours are used inline or per component (for example the geofence
circle is `#7a2bff`, QR code dark is `#101024`, and the status dot is
`var(--success)`). These are not tokens; prefer the tokens above for new work.

### Theming

There is **no light UI theme**. The default and only shell theme is dark.
Selecting the **Standard**, **Light**, or **Terrain** map layer adds
`body.light-map-active`, which restyles Leaflet controls, popups, and popup
coordinates only. The surrounding glass panels stay dark. The preferred layer
is persisted under `llt_preferred_layer` in `localStorage`.

---

## 3. Typography

Loaded from Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

The stack is `'Inter', -apple-system, BlinkMacSystemFont, sans-serif`.

There is **no centralized type scale**. Sizes are set per component in `rem`.
The values below are the observed roles, not a token system.

| Role | Size | Weight | Example |
|---|---|---|---|
| Display / login title | `1.75rem` (`1.4rem` at ≤768 px) | 800 | `.login-title` |
| Panel / directions heading | `0.85–0.9rem` | 700 | `.sidebar-header`, `.directions-header` |
| Body / input / button | `0.8–0.95rem` | 400–600 | `.search-input`, `.btn-primary`, `.btn-login` |
| Compact list text | `0.78–0.85rem` | 500–700 | `.user-list-name`, `.user-name`, `.popup-name` |
| Caption / metadata | `0.65–0.75rem` | 500–800 | `.user-coords`, `.user-list-dot`, `.layer-label`, `.mobile-badge` |
| Empty-state icon | `2rem` (SVG `32px`) | — | `.empty-icon` |
| Mono | none | — | No monospace role exists |

Line heights are mostly left at the browser default or set per component; there
is no global line-height token.

---

## 4. Spacing and Radius

There is **no spacing scale token**. Common values in the stylesheet are
`4`, `6`, `8`, `10`, `12`, `14`, `16`, `18`, `20`, `24`, `32`, `36`, and `48`
pixels. New components should reuse the nearest existing value rather than
introduce a one-off.

Radius is tokenized:

| Token | Value | Typical use |
|---|---|---|
| `--radius-sm` | 8px | Small icon buttons, tags |
| `--radius-md` | 14px | Cards, mobile user panel |
| `--radius-lg` | 20px | Floating panels, mobile bottom nav |
| `--radius-xl` | 28px | Mobile bottom sheets |

The app logo uses a one-off `24px` radius (and a floating animation).

---

## 5. Components

| Component | Purpose | Variants |
|---|---|---|
| `.glass-panel` / `.glass-card` | Translucent blurred surface | Panel, compact card |
| `.screen` | Full-viewport screen container | Login, map |
| `.login-card` | Centred sign-in card | Single variant, max-width 440px |
| `.btn-login` | Google sign-in button | Single |
| `.btn-primary` | Main action button | Single gradient variant |
| `.btn-share-location` | Share/stop-sharing control in the user panel | Inactive, `.active` (Sharing) |
| `.btn-icon` / `.btn-small` | Square icon buttons | 36px, 28px |
| `.btn-danger-quiet` | Low-emphasis destructive action (remove/stop/delete) | Single |
| `.btn-primary-small` | Compact primary action (Accept) | Single |
| `#status-bar` | Connection dot, status text, online count | Connected / disconnected / failed |
| `#user-panel` | Self avatar, name, coordinates, weather, share/logout | Desktop, mobile |
| `#users-sidebar` | Online users list | Expanded, collapsed, mobile-open |
| `.search-container` / `.search-bar` / `.search-results` | Place search, recent searches, POIs, context menu | Loading, results, empty, error |
| `.layer-picker` / `.layer-option` | Basemap chooser | Dark, Standard, Light, Satellite, Terrain |
| `.directions-panel` | Routing inputs, profiles, summary, steps, results | Desktop side panel, mobile bottom sheet |
| `.tools-dock` | Measure distance/area, pin, coordinates, fullscreen | Desktop only |
| `.community-panel` | Share links, friends, arrival alerts | Tabs: Share / Friends / Alerts |
| `.compact-card` | Row inside share/friend/geofence lists | Single |
| `.toast` | Transient success/info/error message | `success`, `info`, `error` |
| `.tracking-banner` | Guest share viewer status | Visible on `/track/:code` |
| `.custom-marker` / `.marker-pulse` / `.marker-avatar` | Live user marker | Self, other |
| `.dark-popup` | Leaflet popup for a user | Self, other |
| `.mobile-bottom-nav` | Four-action mobile bar (Search, Directions, People, Locate) | Mobile only |
| `.empty-state` / `.search-empty` / `.panel-empty` | Empty states | Users, search, share/friends/geofences |

Use these classes rather than creating a second button or a second panel style.
There is no component framework and no build-time CSS pipeline beyond Vite.

---

## 6. Layout Rules

- The map is a full-viewport canvas; `html, body` are `height: 100%` and
  `overflow: hidden`.
- Panels float above the map. Desktop anchors:
  - search: top-left (360px wide)
  - online users sidebar: left side below search (360px, collapsible)
  - directions: left side below search (360px)
  - community: left side below search (360px)
  - layer picker: bottom-right (280px)
  - tools dock: bottom-left
- The login screen is the exception: a centred card with `max-width: 440px`,
  `padding: 48px 36px`, over three animated gradient orbs.
- Tracking mode (`body.tracking-mode`, used by `/track/:code`) hides the status
  bar, user panel, users sidebar, directions toggle, tools dock, live
  coordinates, and mobile bottom nav; only the map and tracking banner remain.
- There is no global content max-width or grid. New panels should match the
  existing 360px panel width unless they are a picker/tool.

---

## 7. Responsive Behaviour

| Breakpoint | Width | Behaviour |
|---|---|---|
| Desktop | >768px | Floating left/right panels, tools dock, status bar, hover states |
| Mobile | ≤768px | Users sidebar becomes a bottom sheet (`max-height: 50vh`); directions and community panels become bottom sheets (`70vh` / `78vh`); search spans the top; user panel spans the bottom above the nav; status bar, tools dock, and live coordinates are hidden; four-button bottom nav appears |
| Narrow mobile | ≤380px | Login feature gap and label size shrink; no other layout change |

The mobile sidebar closes when the user taps outside it. Opening directions or
the community panel closes the other panels. The tracking viewer hides the
mobile nav.

---

## 8. Accessibility

| Requirement | Status |
|---|---|
| Accessible name on icon-only buttons | **Mixed.** Many buttons use `title` (for example the layer toggle and sidebar toggle); some have `aria-label` (search clear, share, logout, directions, layer). There is no systematic check. |
| Keyboard operation of custom controls | **Partial.** Native `<button>`/`<input>` elements work, but the map, marker popups, and some custom result rows have no explicit keyboard handlers. |
| Visible focus styles | **Partial.** The search bar has `:focus-within` and `.directions-input` has `:focus`; several inputs set `outline: none` without a replacement. There are no `:focus-visible` rules, so most controls fall back to the browser default. |
| Focus trap / focus restore for panels | **Missing.** Panels are CSS-transformed containers, not modal dialogs; there is no focus trap or `aria-modal`. |
| Screen-reader semantics for the online list and results | **Partial.** Lists are `<div>`s; result rows are clickable `<div>`s. There are no `role="listbox"`/`option` semantics. |
| Colour contrast | **Not audited.** Muted text uses `rgba(255,255,255,0.35)` on `#0a0a1a`; it is likely below WCAG AA for small text. **INFERRED** |
| Live-region announcements for toasts/alerts | **Missing.** Toasts are appended to the DOM without `role="status"`/`aria-live`. |
| Reduced motion | **Missing.** Orb, logo, marker pulse, and panel transitions run regardless of `prefers-reduced-motion`. |
| Map alternative | **Missing.** The Leaflet map has no text alternative or keyboard location list. |

Accessibility was not tested with a screen reader or an automated axe run.
Treat this table as code review, not a compliance audit.

---

## 9. Loading, Empty and Error States

| View | Loading | Empty | Error |
|---|---|---|---|
| Auth check | The login screen is shown until `/auth/me` resolves; there is no spinner | Login screen | Falls back to the login screen (auth check failure is silent apart from a console error) |
| Online users | No skeleton; the list starts with the local user | “No users online” with a people icon | Socket failure changes the status to “Connection failed” and shows a toast |
| Place search | `.search-loading` with a spinner after the 350 ms debounce | `.search-empty` with an icon and message | `.search-empty` text with the escaped error message |
| Nearby POIs | Loading row/text | “No … found” empty text | Escaped error text |
| Directions | Route summary/instructions are replaced when a route resolves; a loading state is shown for search results | “No results found” for place autocomplete | Search failure text; route failure toast/error (no silent success) |
| Share sessions | No skeleton; list refreshes after create/stop | “No share links yet.” | Toast on create failure; list stays as-is on load failure |
| Friends | No skeleton | “Add a friend by email.” | Toast for request failure; accepted/removed lists refresh |
| Geofences | No skeleton | “No arrival alerts yet.” | Toast on create failure; list refresh |
| Share viewer | Tracking banner appears immediately | No latest point until the owner sends one; banner still shows the owner name | Banner shows the API error message; `share-session-ended` changes the banner to “Sharing ended” |
| Weather | Hidden until the first successful fetch | Hidden if the API fails | Console warning only; no user-facing error |
| Map tiles | Leaflet’s own tile loading | Blank tiles if the provider fails | No explicit error state |

Toasts auto-dismiss after 3.5 seconds; there is no persistent error log in the
UI.
