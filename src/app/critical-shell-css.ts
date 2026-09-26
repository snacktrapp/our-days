/**
 * Rules the first paint needs for the journal canvas, top bar, navigation,
 * and the first card. Selectors match globals.css so the full sheet, once
 * it loads, keeps the same winning values. Not a restyle.
 */
export const criticalShellCss = `
:root {
  --grid-surface: #101216;
  --paper: #101216;
  --ink: #edf0f5;
  --muted: #a1abba;
  --hairline: rgba(176, 190, 210, 0.2);
  --line: #343c49;
  --cream: #1b2028;
  --surface-raised: #242b35;
  --teal: #79adff;
  --action: #79adff;
  --action-ink: #101216;
  --clay: #c77c80;
  --ochre: #c59a56;
  --slate: #8b98ad;
  --moss: #82a472;
  --accent: var(--teal);
  --font-interface: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-record: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --font-serif: Georgia, "Times New Roman", serif;
  --chrome-meta: 400 10px / 1.35 var(--font-record);
  --bottom-nav-float-gap: 10px;
  --bottom-nav-inline-gap: 12px;
  --nav-pill-fill: rgba(27, 32, 40, 0.88);
  --nav-pill-blur: 14px;
  --journal-grid-line: rgba(139, 160, 190, 0.085);
  --journal-grid-size: 28px;
  --journal-grid-image: linear-gradient(var(--journal-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--journal-grid-line) 1px, transparent 1px);
  --timeline-media-max-height: min(90dvh, calc(min(100vw, 430px) * 16 / 9));
  --vv-offset-top: 0px;
  --vv-bottom-inset: 0px;
  --timeline-inline-inset: 16px;
  color-scheme: dark;
}
:root[data-theme="light"] {
  color-scheme: light;
  --grid-surface: #edf0f4;
  --paper: #edf0f4;
  --ink: #1b2431;
  --muted: #596678;
  --hairline: rgba(56, 73, 98, 0.18);
  --line: #c8d1de;
  --cream: #ffffff;
  --surface-raised: #f2f5f9;
  --teal: #2764be;
  --action: #2764be;
  --action-ink: #ffffff;
  --clay: #a8525c;
  --ochre: #9b6d24;
  --slate: #59677d;
  --moss: #58764e;
  --nav-pill-fill: rgba(255, 255, 255, 0.88);
  --journal-grid-line: rgba(74, 96, 128, 0.075);
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  width: 100%;
  max-width: 100%;
  min-height: 100dvh;
  margin: 0;
  background-color: var(--grid-surface);
  color: var(--ink);
  font-family: var(--font-interface);
}
img, svg, video { max-width: 100%; }
h1, p { margin: 0; }
button, a { font: inherit; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.app-shell {
  width: 100%;
  min-height: 100dvh;
  display: grid;
  place-items: start center;
  position: relative;
  overflow: hidden;
  background-color: var(--grid-surface);
  background-image: none;
}
.app-shell::before {
  content: "";
  position: fixed;
  z-index: 0;
  inset: calc(-1 * env(safe-area-inset-top, 0px)) calc(-1 * env(safe-area-inset-right, 0px)) calc(-1 * env(safe-area-inset-bottom, 0px)) calc(-1 * env(safe-area-inset-left, 0px));
  pointer-events: none;
  background-image: var(--journal-grid-image);
  background-size: var(--journal-grid-size) var(--journal-grid-size);
}
.phone-stage {
  width: min(100%, 430px);
  min-height: 100dvh;
  position: relative;
  z-index: 1;
  overflow: hidden;
  padding-top: calc(78px + var(--bottom-nav-float-gap) + env(safe-area-inset-top) + var(--vv-offset-top));
  padding-bottom: calc(78px + var(--bottom-nav-float-gap) + env(safe-area-inset-bottom) + var(--vv-bottom-inset));
  background-color: transparent;
  background-image: none;
}
.topbar {
  height: 56px;
  min-height: 56px;
  padding: 3px 8px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  position: fixed;
  z-index: 160;
  top: calc(var(--bottom-nav-float-gap) + env(safe-area-inset-top) + var(--vv-offset-top));
  left: 0;
  right: 0;
  width: min(calc(100% - 2 * var(--bottom-nav-inline-gap)), calc(430px - 2 * var(--bottom-nav-inline-gap)));
  margin-inline: auto;
  overflow: visible;
  border: 1px solid var(--hairline);
  border-radius: 18px;
  background-color: var(--nav-pill-fill);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(var(--nav-pill-blur));
  -webkit-backdrop-filter: blur(var(--nav-pill-blur));
}
.topbar > .title-switcher, .topbar > .title-lockup {
  grid-column: 1 / -1;
  grid-row: 1;
  justify-self: center;
  align-self: center;
  z-index: 1;
  width: max-content;
  max-width: calc(100% - 192px);
  pointer-events: none;
  text-align: center;
}
.title-lockup { text-align: center; }
.our-days-wordmark {
  display: block;
  width: 104px;
  max-width: 100%;
  height: 20px;
  margin: 0 auto 4px;
  background: var(--ink);
  mask: url("/our-days-wordmark.svg") center / contain no-repeat;
}
.title-switcher-heading {
  position: relative;
  min-width: 0;
  max-width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.topbar .title-lockup h1 {
  font: var(--chrome-meta);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.topbar > .header-settings, .topbar-leading-spacer {
  width: 44px;
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
  grid-column: 1;
  grid-row: 1;
  z-index: 2;
  justify-self: start;
  color: var(--muted);
  text-decoration: none;
}
.header-settings svg, .theme-toggle svg, .notification-trigger svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.topbar-actions {
  display: flex;
  align-items: center;
  grid-column: 3;
  grid-row: 1;
  z-index: 2;
  justify-self: end;
}
.topbar-actions > :is(button, a), .theme-toggle, .notification-trigger {
  width: 44px;
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.bottom-nav {
  height: 56px;
  position: fixed;
  z-index: 160;
  bottom: calc(var(--bottom-nav-float-gap) + env(safe-area-inset-bottom) + var(--vv-bottom-inset));
  left: 0;
  right: 0;
  width: min(calc(100% - 2 * var(--bottom-nav-inline-gap)), calc(430px - 2 * var(--bottom-nav-inline-gap)));
  margin-inline: auto;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 3px 8px;
  border: 1px solid var(--hairline);
  border-radius: 18px;
  background-color: var(--nav-pill-fill);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(var(--nav-pill-blur));
  -webkit-backdrop-filter: blur(var(--nav-pill-blur));
}
.nav-item {
  flex: 1 1 0;
  min-width: 0;
  height: 49px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-family: var(--font-record);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-decoration: none;
}
.nav-item.active { color: var(--action); }
.nav-symbol { width: 21px; height: 21px; display: grid; place-items: center; }
.nav-symbol svg {
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.55;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.journal-route-content { display: contents; }
.route-pending-field {
  min-height: calc(100dvh - 156px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  background: transparent;
}
.route-pending-skeleton {
  position: relative;
  min-height: calc(100dvh - 56px - env(safe-area-inset-bottom));
}
.timeline {
  position: relative;
  max-width: 100%;
  padding: 4px var(--timeline-inline-inset) 76px;
}
.time-rail {
  width: 1px;
  position: absolute;
  z-index: 0;
  top: 0;
  bottom: 0;
  left: 50%;
  background: linear-gradient(to bottom, transparent, var(--line) 18px, var(--line) calc(100% - 26px), transparent);
}
.date-marker {
  height: 42px;
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.date-marker span {
  padding: 5px 9px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--paper);
  color: #bdc6c0;
  font-family: var(--font-record);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}
.moment { position: relative; z-index: 1; max-width: 100%; margin-bottom: 30px; }
.connection {
  min-height: 38px;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 3;
}
.connection::after { content: ""; width: 1px; height: 10px; background: var(--line); }
.avatar-node {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  color: white;
  font-size: 9px;
  font-weight: 700;
  border-radius: 7px;
  box-shadow: 0 0 0 2px var(--paper);
}
.moment-meta { color: var(--ink); }
.moment-meta strong {
  display: block;
  color: var(--ink);
  font-size: 10px;
  font-weight: 650;
}
.moment-meta span {
  color: var(--muted);
  font-family: var(--font-record);
  font-size: 8px;
}
.moment-card {
  width: 100%;
  position: relative;
  border: 1px solid var(--hairline);
  border-radius: 12px;
  background: var(--cream);
  box-shadow: none;
  overflow: hidden;
}
.timeline .moment-card {
  width: calc(100% + 2 * var(--timeline-inline-inset));
  max-width: none;
  margin-inline: calc(-1 * var(--timeline-inline-inset));
  border: 0;
  border-radius: 0;
}
.photo-frame {
  height: auto;
  max-height: var(--timeline-media-max-height);
  position: relative;
  display: grid;
  justify-items: center;
  align-items: center;
  overflow: hidden;
  background: var(--cream);
}
.photo-frame-sizer {
  grid-area: 1 / 1;
  display: block;
  width: 100%;
  height: auto;
  pointer-events: none;
}
.photo-frame.has-reserved-frame > :not(.photo-frame-sizer) {
  grid-area: 1 / 1;
  align-self: stretch;
  justify-self: stretch;
  width: 100%;
  height: 100%;
  min-height: 0;
  max-height: none;
}
.photo-frame img, .photo-frame video {
  width: 100%;
  height: auto;
  max-height: var(--timeline-media-max-height);
  display: block;
  object-fit: contain;
  object-position: center;
}
.card-copy { padding: 14px 15px 12px; }
.card-copy > p {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14px;
  line-height: 1.48;
  color: var(--ink);
}
.theme-teal { --accent: var(--teal); }
.theme-clay { --accent: var(--clay); }
.theme-ochre { --accent: var(--ochre); }
.theme-slate { --accent: var(--slate); }
.theme-moss { --accent: var(--moss); }
.dot-teal { background: var(--teal); }
.dot-clay { background: var(--clay); }
.dot-ochre { background: var(--ochre); }
.dot-slate { background: var(--slate); }
.dot-moss { background: var(--moss); }
`.trim();
