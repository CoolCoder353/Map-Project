---
name: Wayfinder
description: A self-hosted planning map where novelty is route data beside time and distance.
colors:
  accent: "#1765cc"
  accent-hover: "#1257b3"
  accent-soft: "#e6effc"
  on-accent: "#ffffff"
  explore: "#0b7d56"
  explore-line: "#13985f"
  explore-soft: "#e3f3ec"
  bg: "#eef0f3"
  surface: "#ffffff"
  surface-2: "#f5f6f8"
  surface-3: "#eceef1"
  text: "#1d2126"
  text-2: "#565d66"
  text-3: "#6f7680"
  border: "#dfe2e6"
  border-strong: "#c7cbd1"
  danger: "#c5221f"
  danger-soft: "#fce8e6"
  warning: "#9a5b00"
  warning-soft: "#fdf1dc"
  success: "#137333"
  success-soft: "#e6f4ea"
  inverse-surface: "#2b2f34"
  inverse-text: "#f1f3f4"
  series-1: "#2a78d6"
  series-2: "#eb6834"
  map-land: "#f3efe6"
  map-water: "#a9d3e6"
  map-park: "#cfe3b8"
  map-motorway: "#f0a35e"
  map-label: "#3d3a33"
  map-fog: "#26303a"
typography:
  stat-lead:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Roboto Variable', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "2rem"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Roboto Variable', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Roboto Variable', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Roboto Variable', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.2
    fontFeature: "tnum"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Roboto Variable', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  body-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Roboto Variable', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  label-md:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Roboto Variable', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Roboto Variable', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.45
  mono:
    fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace"
    fontSize: "0.92em"
  map-label:
    fontFamily: "Noto Sans"
    fontSize: "12px"
    fontWeight: 400
rounded:
  sm: "4px"
  control: "8px"
  panel: "12px"
  pill: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "24px"
  space-6: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label-md}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    typography: "{typography.label-md}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.accent-soft}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    typography: "{typography.label-md}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    typography: "{typography.label-md}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-sm:
    typography: "{typography.label}"
    padding: "0 12px"
    height: "30px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.pill}"
    size: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
  search-box:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 4px 0 12px"
    height: "44px"
  search-box-focus:
    backgroundColor: "{colors.surface}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-2}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "30px"
  chip-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  segmented:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.pill}"
    padding: "3px"
  segmented-option-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label-md}"
    rounded: "{rounded.pill}"
    height: "30px"
  badge:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  badge-new:
    backgroundColor: "{colors.explore-soft}"
    textColor: "{colors.explore}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    width: "400px"
  panel-tab:
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    padding: "8px 4px 10px"
  panel-tab-active:
    textColor: "{colors.accent}"
  route-option:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "12px"
  map-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.control}"
    size: "40px"
  menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "8px 0"
  dialog:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "24px"
    width: "440px"
  toast:
    backgroundColor: "{colors.inverse-surface}"
    textColor: "{colors.inverse-text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  admin-section:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "16px 24px"
  admin-nav-link:
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "36px"
  admin-nav-link-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
---

# Design System: Wayfinder

## Overview

**Creative North Star: "The Quiet Atlas"**

Wayfinder plays the map-app category straight, at the craft level of Google Maps and Apple Maps on the web. The map fills the viewport and the interface floats over it: near-white panels with 12px corners and a soft two-layer shadow, system UI type, neutral greys, and a single blue that means "act here" or "fastest". Nothing decorates the chrome. The map carries the colour and the panel carries the numbers.

The product-specific idea is that novelty is data. Kilometres you have never travelled sit beside minutes and kilometres as a first-class figure, in a second hue (explore green) that always arrives with a second channel: a dashed line on the map, a hatched badge in the panel, words in the label. Blue solid is the fastest route; green dashed is the invitation.

Density suits desk planning: 13 to 15px working text, tabular numerals, compact 30 to 40px controls, 8px list gaps. The admin area (/admin) uses the same tokens in a conventional sidebar-plus-cards layout with dense tables and line or bar charts. Light and dark themes are full peers: both follow the system setting and can be overridden with `data-theme`. The Android app mirrors these tokens in `apps/mobile/src/lib/theme.ts`; it consumes this system but is not documented here.

**Key Characteristics:**
- Full-bleed map with floating surface chrome (400px panel, 16px inset).
- One blue accent for primary actions, selection and the fastest route; one green for explore routes and new ground.
- Novelty is never signalled by colour alone: dashed lines, hatched badges, explicit "km you've never been" text.
- System UI type throughout, weights 400/550/600/650, tabular numerals for every figure.
- Pill-shaped actions, 8px controls and cards, 12px floating panels.
- Soft ambient shadows only on things that float; in-panel content is flat and separated by 1px borders.

## Colors

A cool neutral grey interface with one confident blue and one route green, laid over a warm, paper-toned basemap.

### Primary
- **Route Blue** (accent): primary buttons, the active tab underline, selected route cards, active admin nav, focus rings, slider and switch fills, links, the avatar, and the fastest route line on the map. Hover deepens to **Pressed Blue** (accent-hover). **Blue Wash** (accent-soft) backs selected chips, active nav pills, the fastest route swatch and the 3px focus halo on fields.

### Secondary
- **Explore Green** (explore): text and icon colour for anything about unexplored ground: the "new" badge, explore route swatches, explore card selection ring, explore callout text on the map.
- **Trail Green** (explore-line): the brighter stroke used for explore route lines and the outline of recently explored coverage cells.
- **Meadow Wash** (explore-soft): badge and swatch backgrounds behind Explore Green.

### Tertiary
- **Status set**: danger, warning and success, each with a soft wash, used as tinted notice, badge and banner pairs (text in the strong tone on the soft tone). Danger also marks the destination pin and the end search field icon.
- **Chart series** (series-1 Chart Blue, series-2 Chart Orange): admin charts only, assigned by slot. Dark theme uses #3987e5 and #d95926.
- **Basemap** (map-land warm paper, map-water, map-park, map-motorway, map-label): served by the API style (`apps/api/src/style.ts`), deliberately warmer than the UI greys so the chrome reads as floating over terrain. The full basemap palette, including roads, sand, buildings and a matching dark set, lives there.
- **Fog** (map-fog): the unexplored-land veil on the coverage map, #26303a at 34% in light and black at 62% in dark.

### Neutral
- **Desk Grey** (bg): app background behind the map and admin pages.
- **Paper White** (surface): panels, cards, menus, dialogs, map controls, route callout chips.
- **Mist** (surface-2) and **Fog Grey** (surface-3): resting search field fill, hover rows, notices; segmented control track, ghost hover, neutral badges, skeleton base.
- **Ink** (text), **Slate** (text-2), **Pewter** (text-3): primary text; secondary text, metadata, idle icons; placeholders, leading search icons, chevrons.
- **Hairline** (border) and **Rule** (border-strong): list and table dividers, idle route cards; input strokes, chip and secondary button outlines, table header rule.
- **Inverse** (inverse-surface, inverse-text): toasts, which flip to light-on-dark and dark-on-light by theme.

### Dark theme
Same roles, retuned: bg #15171a, surface #202327, surface-2 #272b30, surface-3 #30353b, text #e8eaed, text-2 #aeb4bb, text-3 #969ca4, border #363b41, border-strong #4a5057, accent #7eb0f9 (hover #a2c6fb, soft #1e3452, on-accent #0c1a2e), explore #62d19f (line #49c28c, soft #173a2b), danger #f28b82 / #3c1f1d, warning #f6c26b / #3a2c12, success #81c995 / #1c3424. On-colour text over light accents turns dark (on-accent #0c1a2e; danger button text #2a0c0a).

### Named Rules
**The One Blue Rule.** Route Blue marks exactly three things: the primary action, the current selection, and the fastest route. It never decorates, and it never marks an explore route.

**The Two Channels Rule.** Explore Green is always paired with a non-colour signal: a dash pattern on the map, a hatched fill on the badge, or the words "new" / "you've never been". Remove the green and the meaning must survive.

**The Chart Slot Rule.** Charts take colour from the series slots, never from accent or explore, so data never borrows the meaning of an action or a route.

## Typography

**UI Font:** system UI stack (SF Pro Text, Segoe UI, Roboto, then Helvetica Neue and Arial)
**Label/Mono Font:** ui-monospace stack (SF Mono, Cascadia Mono, Menlo, Consolas), for invite codes, IDs, stacks and log details
**Map Label Font:** Noto Sans Regular, Bold and Italic, served as glyphs by the API

**Character:** The platform's own face, as in the benchmark apps: neutral, dense and legible. Hierarchy comes from weight (600 and 650) and size, never from a second family.

### Hierarchy
- **Stat lead** (650, 2rem, 1.1, -0.02em): the single headline figure on the coverage tab, with its unit in a smaller 500-weight Slate `small`.
- **Headline** (650, 1.625rem, 1.2): admin page titles.
- **Title** (650, 1.375rem, 1.2): panel detail titles and the sign-in card title.
- **Title small** (650, 1.125rem): brand name, route durations, stat-list values (600).
- **Body** (400, 0.9375rem, 1.45): base text, inputs, route card titles (600). Admin descriptions cap at 70ch.
- **Body small** (400, 0.8125rem): panel intros, menus, tables, notices, route metadata.
- **Label medium** (600, 0.8125rem): buttons, field labels, segmented options, in-panel section headings (650).
- **Label** (600, 0.75rem): tab captions, badges, hints, table headers, slider readouts, small buttons.
- **Map labels** (Noto Sans 11 to 13px, halo 1.5 to 2px): basemap places; route callouts in Noto Sans Bold 12px (13px when selected).

### Named Rules
**The Tabular Figures Rule.** Every number that can change or be compared (durations, distances, new km, table cells, chart axes, the budget readout) uses tabular numerals.

**The Sentence Case Rule.** UI labels, headings, tabs and admin nav group titles are sentence case at their normal tracking. Emphasis comes from weight, not capitals or letterspacing. (Uppercase appears only in basemap state labels, a cartographic convention.)

## Layout

The planner is a full-bleed map with chrome pinned to its corners. At 900px and wider, a 400px panel floats 16px from the top, left and bottom edges: brand row, a five-tab icon-over-caption strip, a search field, then the active tab's content scrolling beneath in 16px-padded sections with 16px gaps. The account avatar sits top-right, zoom, locate and layer controls stack bottom-right, and the scale bar and OSM attribution shift right of the panel. Warning banners float at the top between panel and avatar, capped at 560px.

Below 900px, the panel becomes a bottom sheet at 58% height with a 40x4px grip; collapsing slides it down (transform, 260ms) to show its top 172px, and the map controls and attribution ride above it.

Spacing is a 4px base scale (4, 8, 12, 16, 24, 32). Lists use 8px gaps, rows use 8 to 12px padding, sections 16px, dialogs and auth cards 24 to 32px.

Admin is a 240px sticky sidebar plus a content column (24px/32px padding, max 1280px) of cards on 24px gaps, with 2- and 3-column card grids that collapse to one column at 1100px. At 800px the sidebar becomes a horizontal scrolling nav strip above content.

## Elevation & Depth

A hybrid. Anything floating over the map or over the page uses soft, ambient, two-layer shadows; everything inside a surface is flat and structured by 1px borders, tonal fills and selection rings. Dark theme deepens the shadow opacity instead of lightening surfaces further.

### Shadow Vocabulary
- **Resting float** (`box-shadow: 0 1px 2px rgba(32, 38, 45, 0.18), 0 1px 3px 1px rgba(32, 38, 45, 0.08)`): map controls, avatar, attribution, banners, admin cards and charts, the selected segmented option, primary button hover.
- **Raised float** (`box-shadow: 0 1px 3px rgba(32, 38, 45, 0.2), 0 4px 12px 2px rgba(32, 38, 45, 0.12)`): the planner panel, menus, search suggestions, dialogs, toasts, chart tooltips, the auth card.
- **Focus halo** (`box-shadow: 0 0 0 3px` Blue Wash): focused inputs and the search box, alongside a Route Blue border. Other focus is a 2px Route Blue outline offset 2px.
- **Selection ring** (`box-shadow: 0 0 0 1px` in accent or explore): selected route cards and voice options, doubling the 1px border.

### Named Rules
**The Float Only Rule.** Shadows belong to things that hover over the map or page. Cards inside a panel (route options, place cards, run lists) are bordered, never shadowed.

## Shapes

Three radii carry the whole form language. Actions are pills (999px): buttons, icon buttons, chips, badges, segmented controls, switches, admin nav links. Controls and in-surface containers use 8px: inputs, search, route cards, menus, notices, map control groups, toasts. Floating panels use 12px: the planner panel, dialogs, admin cards, auth card; the mobile sheet rounds only its top corners. 4px is reserved for small details: inline code, legend swatches, chart bar ends and the focus outline. Circles hold identity and place: route swatches (32px), place icons (36px), the avatar (40px), map pins.

On the map, lines have round caps and joins. Route callouts are 8px-radius Paper White chips with a 1.5px Rule stroke, centred on the line.

## Components

### Buttons
Calm, compact and pill-shaped.
- **Shape:** full pill (999px), 36px tall, 16px horizontal padding, 18px icon with an 8px gap.
- **Primary:** Route Blue fill, on-accent text. One per view.
- **Hover / Focus:** hover deepens to Pressed Blue and adds the resting shadow; 120ms ease-out. Focus shows the 2px Route Blue outline.
- **Secondary:** Paper White with a Rule outline and blue text; hover fills Blue Wash.
- **Ghost:** transparent Slate text; hover fills Fog Grey and darkens to Ink.
- **Danger / Danger outline:** danger fill for confirmed destructive actions; outline variant keeps a Rule stroke with danger text and a soft danger hover.
- **Small:** 30px tall, 12px padding, 0.75rem label. **Disabled:** 55% opacity.
- **Icon button:** 36px circle, Slate icon at 20px, Fog Grey hover.

### Chips
- **Style:** 30px pill, Paper White, Rule outline, Slate 0.8125rem/500 text, optional 15px icon.
- **State:** pressed chips drop the border and turn Blue Wash with Route Blue text.

### Segmented control
A Fog Grey pill track with 3px padding; the selected option lifts onto Paper White with the resting shadow and Ink text. Used for Drive/Walk and similar two-to-three-way choices.

### Badges
- **Neutral:** Fog Grey pill, Slate 0.75rem/600 text, 2px/8px padding, optional 13px icon.
- **New ground:** Meadow Wash with Explore Green text and a -45deg hatch (2px stripe every 6px at 9% explore). The hatch is load-bearing, not ornament.
- **Status:** accent, danger, warning and success tints.

### Cards / Containers
- **Planner panel:** Paper White, 12px, raised float, 400px.
- **Route option:** 8px radius, 1px Hairline border, 12px padding. A 32px circular swatch (Blue Wash for fastest, Meadow Wash for explore), a title, metadata row (km, new-ground badge), and the duration right-aligned in title-small with "+N min" beneath. Hover shows a Rule border and Mist fill. Selected: border plus 1px ring in accent (fastest) or explore (explore and round trip), expanding to actions and turn-by-turn steps.
- **Admin card:** Paper White, 12px, resting float, 16px/24px padding, 1rem/650 heading.
- **Notice:** 8px, Mist fill, 12px padding, 18px icon; error and warning use their soft tones.

### Inputs / Fields
- **Style:** 40px tall, 8px radius, 1px Rule stroke on Paper White, 12px padding. Labels sit above in 0.8125rem/600 Slate with a 6px gap; hints in 0.75rem Pewter.
- **Search box:** 44px, borderless Mist fill at rest with a leading 18px icon (neutral for search and start, danger for destination) and a trailing 32px clear button.
- **Focus:** border turns Route Blue with the 3px Blue Wash halo; the search box also lifts to Paper White.
- **Error:** danger border and 0.75rem danger message. Selects draw their chevron from text-2 so it follows the theme.
- **Switch:** 40x24px pill, Rule track turning Route Blue when on, white 18px knob, 150ms slide.

### Navigation
- **Planner tabs:** icon (20px) over a 0.75rem/600 caption, equal width, Slate at rest; active turns Route Blue with a 3px underline. Horizontal scroll if space runs out.
- **Admin sidebar:** grouped links under sentence-case 0.75rem/650 Pewter group titles; links are 36px pills with 18px icons, Fog Grey hover, Blue Wash and Route Blue at 650 when active. A "Back to the map" ghost link pins to the bottom.
- **Menus:** 220px min, 8px radius, raised float, 8px/16px items with 18px Slate icons, Fog Grey hover, Hairline separators.

### Map chrome
- **Controls:** 40px Paper White squares at 8px radius with the resting shadow; zoom in/out join into one group split by a Hairline. Pressed toggles (such as the coverage layer) turn Blue Wash with a blue icon.
- **Route lines:** the selected fastest route is 7px Route Blue on an 11px white casing (#0b0d10 in dark); a selected explore route is 7px Trail Green dashed [2, 0.6] on the same casing. Unselected routes are 5px at 60 to 65% opacity on an 8px surface casing (explore dashed [2, 1]) and thicken by 2px on hover.
- **Callouts:** "37 min · 22 km new" chips beside each route, text in the route's colour; the selected callout always shows, others yield on collision.
- **Pins:** 7 to 8px circles with a 2.5 to 3px contrasting stroke; destination in danger, start and via stroked in Ink.
- **Coverage:** unexplored land is fogged; explored H3 cells are cut out, tinted Route Blue at 6 to 22% (10 to 32% dark) by fraction explored and outlined in blue; cells reached in the last week take a heavier Trail Green outline. The legend repeats all three as swatches.

### Charts (admin)
Recharts lines (2px, no dots, 4px active dot ringed in surface) and bars (4px end radius, 1px surface separators when stacked) on Hairline gridlines with 11px Slate ticks. Every chart has a title, a one-line description, a legend when there are two or more series, a surface tooltip with the raised float, and a table view toggle.

### Feedback
Toasts centre at the bottom on the inverse surface, 8px radius, 280 to 520px wide, rising 8px over 220ms. Skeletons shimmer between Fog Grey and Mist at the shape of the content they replace. Spinners are 18px currentColor rings.

## Do's and Don'ts

### Do:
- **Do** float every piece of map chrome on Paper White with the resting (controls) or raised (panels, menus, dialogs) shadow, inset 16px from the viewport edge.
- **Do** show every route comparison as minutes, km and new km together, with durations in tabular title-small.
- **Do** draw fastest routes solid in Route Blue and explore routes dashed in Trail Green, each on a light casing so they read over any basemap.
- **Do** pair every use of Explore Green with a dash, a hatch or explicit "new" wording.
- **Do** use pills for actions and chips, 8px for fields and in-panel cards, 12px for floating surfaces.
- **Do** read the product name from runtime config in the brand slot; the brand mark is an inline SVG.
- **Do** define each new colour in both themes, flipping on-colour text to dark over the lighter dark-theme accents.
- **Do** honour reduced motion; all transitions sit between 120 and 260ms on the ease-out curve (cubic-bezier(0.16, 1, 0.3, 1)).

### Don't:
- **Don't** use Route Blue for explore routes, decorative icons or chart series.
- **Don't** encode route type, novelty or coverage by hue alone.
- **Don't** shadow cards that sit inside a panel; use the 1px Hairline border and selection ring.
- **Don't** add a display or brand typeface, uppercase UI labels or letterspaced labels; hierarchy comes from weight and size in the system UI stack.
- **Don't** hard-code hex values in components; take them from the tokens so both themes follow.
- **Don't** stretch phone patterns onto the desk layout; the bottom sheet is for widths below 900px only.
