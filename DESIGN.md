---
name: Growth Briefs
description: Weekly competitor price and catalog changes for Shopify merchants, set as shelf-edge price tickets.
colors:
  ink: "#111111"
  ink-2: "#464a52"
  ink-3: "#62666f"
  shelf: "#f4f5f7"
  stock: "#ffffff"
  edge: "#dadde2"
  hairline: "#eceef1"
  rail: "#d9dce0"
  sticker: "#ffd60a"
  cut: "#d11b23"
  ok: "#1d6f40"
  ok-soft: "#e4f3ea"
  warn: "#8a5100"
  warn-soft: "#fff3d1"
  info: "#23479e"
  info-soft: "#e7edfb"
  bar-muted: "#a8abb2"
typography:
  display:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "36px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  figure:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "38px"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "tnum"
  headline:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "20px"
    fontWeight: 700
  body:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: "tnum"
  body-lead:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.04em"
rounded:
  sticker: "3px"
  ticket: "4px"
  control: "6px"
  card: "8px"
  pill: "9999px"
spacing:
  row: "10px"
  rail: "14px"
  page-x-mobile: "16px"
  card-mobile: "20px"
  card: "24px"
  page-x: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stock}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-bar:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-bar-hover:
    backgroundColor: "{colors.sticker}"
    textColor: "{colors.ink}"
  input-text:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "{spacing.card}"
  rail:
    backgroundColor: "{colors.rail}"
    rounded: "{rounded.card}"
    padding: "{spacing.rail}"
  ticket:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ticket}"
    padding: "12px 12px 10px"
    width: "188px"
  sticker-cut:
    backgroundColor: "{colors.sticker}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sticker}"
    padding: "4px 8px"
  sticker-rise:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stock}"
    rounded: "{rounded.sticker}"
    padding: "4px 8px"
  action-marker:
    backgroundColor: "{colors.sticker}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sticker}"
    size: "24px"
  tag-verified:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  tag-baseline:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  tag-unverified:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  top-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stock}"
    height: "56px"
---

# Design System: Growth Briefs

## Overview

**Creative North Star: "The Shelf-Edge Ticket"**

A competitor's price change is a price ticket clipped to a supermarket shelf edge, and a cut wears a yellow markdown sticker. The evidence is the ticket itself, not a summary tile: white card-stock tickets hang on a grey shelf rail, each showing the old price struck through and the new price in big condensed figures. Everything around the tickets is quiet working paper: white cards on a pale shelf ground, carbon ink, and a carbon top bar.

The system is light and daylight-legible, built for a merchant reading next to their own store admin. Density is that of a working tool: tables over decorative cards, exact numbers everywhere, tabular figures throughout. Colour is information, never decoration: yellow means a cut (or a numbered action), red means a dropped price, and the green, amber and blue soft tags mean verification status. It rejects the category default of KPI tiles on a grey SaaS shell and the earlier dark zinc look.

Motion is limited to 150ms state transitions (colour, opacity, a 2px ticket lift on hover). There is no entrance choreography, and reduced-motion collapses all transitions.

**Key Characteristics:**
- Price tickets on a grey rail are the unit for price changes everywhere (home and brief detail).
- Barlow for UI and reading; Barlow Condensed 800 for week titles, prices and big numbers.
- Tabular figures on the whole document.
- Carbon top bar; white card stock with a 1px edge on a shelf-grey ground.
- Yellow and red are reserved signals, not brand accents.

## Colors

A near-neutral shelf palette with two reserved retail signals (markdown yellow, reduction red) and three soft status tints.

### Primary
- **Carbon Ink** (ink): body headings, primary text, the top bar ground, the primary button, rise stickers and the focus ring.

### Secondary
- **Markdown Sticker Yellow** (sticker): the sticker on a price cut, the numbered "What to do" markers, the active-tab underline in the top bar, the top-bar button hover and text selection.
- **Reduction Red** (cut): the new-price figure on a cut ticket, negative "Biggest move" percentages, cut values in product rows, and form error text and borders. Ships darker than the contract's #E01E26 so 12–13px drop figures clear AA with margin (cited deviation).

### Tertiary (status)
- **Verified Green** (ok) on **Verified Wash** (ok-soft): Verified tags, passed audit, shield icons.
- **Caution Amber** (warn) on **Caution Wash** (warn-soft): Unverified tags, failed audit, the audit warning banner and the run-failure strip.
- **Baseline Blue** (info) on **Baseline Wash** (info-soft): the Baseline status tag only.

### Neutral
- **Shelf Grey-White** (shelf): page ground; also empty-state insets inside cards and disabled input fill.
- **Card Stock** (stock): cards, tickets, tables, the Add store panel.
- **Card Edge** (edge): the 1px border around cards and tables, and table header rules.
- **Hairline** (hairline): row dividers inside tables, lists and the audit grid; lighter than the card edge.
- **Shelf Rail** (rail): the grey band tickets hang on.
- **Ink 2** (ink-2): secondary body text, summaries, recommendation text.
- **Ink 3** (ink-3): metadata, sublines, column labels, placeholders, counts.
- **Bar Muted** (bar-muted): inactive tabs and idle status text on the carbon top bar.

### Named Rules
**The Sticker Means a Cut Rule.** Yellow appears only on real price cuts, the numbered action markers and the active-tab / hover affordances of the top bar. A price rise gets a carbon sticker. Yellow is never a decorative highlight, badge fill or section accent.

**The Red Is a Drop Rule.** Reduction red marks a lower price (and a form error). Never use it for warnings, failure states or emphasis; failures are amber.

## Typography

**Display Font:** Barlow Condensed (fallback Barlow, ui-sans-serif)
**Body Font:** Barlow (fallback ui-sans-serif, system-ui)

**Character:** Retail signage meets a working ledger: the condensed heavy cut reads like a printed shelf price, the regular Barlow stays plain and legible for dense rows.

### Hierarchy
- **Display** (Barlow Condensed 800, 36px; 32px on phones; line-height 1.05, tight tracking): the week title ("Week of …") and page titles.
- **Figure** (Barlow Condensed 800, 38px, line-height 1): the new price on a ticket. Stickers use the same cut at 16px; action numbers at 15px.
- **Headline** (Barlow Condensed 800, 26px; 22px for card-level section titles): "Changes by store", "Enkrypt AI audit", "More from the analyst". Store names use 22px at 700.
- **Title** (Barlow Condensed 700, 20px): in-card section heads such as "What to do", "Movements", "Biggest price moves"; also markdown h2/h3 in briefs.
- **Body lead** (Barlow 400, 16px, line-height 1.625, max 70ch): the executive summary and first-use copy.
- **Body** (Barlow 400–600, 14px): table cells, product rows, recommendations, form labels (600). Metadata drops to 12–13px in ink-3.
- **Label** (Barlow 600, 11px, uppercase, 0.04em tracking): table column headers only; status tags use 11px 600 in sentence case.

### Named Rules
**The Condensed Is for Numbers and Titles Rule.** Barlow Condensed carries prices, percentages on stickers, action numbers, week and section titles. Running text, table cells and labels stay in Barlow.

**The Tabular Rule.** Figures are tabular across the whole document so columns of prices and counts align.

## Layout

A single centred column, max 1280px, with 16px side padding on phones and 32px from 640px up; pages pad 24px vertically (32px from 640px). On the overview the grid becomes a main column plus a 380px right column from 1024px (28px column gap, 24px row gap): summary card and Movements table on the left, a sticky "What to do" card with the trust and tracking lines on the right (sticky at 80px below the top). Below 1024px the right column drops between the summary card and the Movements table.

The rail scrolls horizontally on phones, bleeding to the screen edge; from 640px it wraps. Product-change lists are capped at 640px wide and show 8 items before a "Show all N" disclosure. Store sections put the analyst's notes in a 340px side column from 1024px, separated by a hairline rule; below that they stack under a top rule.

Tables keep a minimum width (720–760px) and scroll inside their card; the Movements table switches to one block per store with a five-figure labelled grid below 640px. Stacks between cards use 24px; content inside cards uses 20px padding on phones and 24px from 640px. Below 640px the top bar drops the wordmark and folds the run timer into the button label.

## Elevation & Depth

Flat paper, with exactly one physical object: the ticket. Cards, tables and the rail sit flat on the shelf with a 1px edge border and no shadow. Tickets carry a short soft shadow plus a hard 1px bottom line, like card stock clipped to a rail, and lift 2px on hover. The only other shadow is the soft drop under the Add store panel that opens below the top bar.

### Shadow Vocabulary
- **Ticket** (`box-shadow: 0 1px 2px rgb(17 17 17 / 0.12), 0 1px 0 #b9bdc4`): price tickets only.
- **Drop panel** (`box-shadow: 0 8px 20px rgb(17 17 17 / 0.08)`): the inline Add store panel under the sticky top bar.

### Named Rules
**The Only Ticket Lifts Rule.** Containers are bordered, not shadowed. The ticket shadow belongs to tickets; giving it to cards turns every surface into evidence.

## Shapes

Small, practical corners. Cards, tables, the rail and banners use 8px; buttons and inputs 6px; tickets 4px; stickers and action markers 3px (the focus ring follows at 3px). Status tags are full pills. Stickers sit off the ticket's top-right corner, rotated 4 degrees, as if slapped on by hand; nothing else in the system rotates. Borders are 1px; the active tab is a 3px yellow underline flush with the bar's bottom.

## Components

### Buttons
- **Shape:** gently rounded (6px).
- **Primary:** carbon ink with white 14px semibold text, 40px tall, 16px side padding, optional 15px leading icon; hover darkens to a near-black grey; disabled goes mid-grey.
- **Top-bar action:** white on the carbon bar, 13px semibold, 6px by 12px; hover fills with sticker yellow; disabled sits dark grey with light grey text while a run is in flight and shows a spinner plus elapsed time.
- **Text actions:** inline links in ink, underlined on hover (or underlined at rest when they are a call to action inside a quiet line, as in the tracking line).
- **Focus:** 2px carbon outline, 2px offset, on every interactive element.

### Chips (status tags)
- **Style:** full pill, 11px semibold, 4px by 10px, soft tint with its strong ink: Verified (green), Baseline (blue), Unverified / Didn't pass (amber), Passed (green).
- **State:** read-only labels; never clickable, never used for counts.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** card stock on the shelf ground.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px card edge.
- **Internal Padding:** 20px on phones, 24px from 640px.
- **Empty states:** a shelf-grey 8px inset inside the card with one plain sentence that says why there is nothing to show.

### Inputs / Fields
- **Style:** card stock, 1px mid-grey stroke, 6px corners, 40px tall, 14px text, ink-3 placeholder; hover darkens the stroke to ink-3.
- **Focus:** stroke turns carbon (plus the global focus outline).
- **Error / Disabled:** invalid turns the stroke reduction red and the help line below red; disabled fills shelf grey.

### Navigation
- **Style:** a 56px sticky carbon bar, wordmark in Barlow Condensed 800 22px, two tabs in 14px Barlow. Inactive tabs are bar-muted and whiten on hover; the active tab is white semibold with a 3px yellow underline. Run status sits right in 13px muted text, then the top-bar action.
- **Mobile:** below 640px the wordmark is hidden and the status text moves into the button label.

### Price Ticket (signature)
A 188px white card-stock ticket: product title (13px semibold, two lines max), store name in 11px ink-3, "was" plus the struck old price in 12px ink-3, then the new price as a 38px condensed figure, red on a cut and ink on a rise. The percentage sits on a sticker off the top-right corner: yellow with ink text on a cut, carbon with white text on a rise. The whole ticket links to the product and lifts 2px on hover. Tickets always hang on the rail: a grey band with 8px corners and 14px padding, 12px between tickets.

### Numbered Action Marker
A 24px yellow square with 3px corners and a condensed 15px number, leading each recommendation row in "What to do". Rows are split by hairlines.

### Data Tables
Card-stock tables with a 1px edge and 8px corners. Headers are the 11px uppercase label style in ink-3 under an edge rule; rows divide with hairlines and take a barely-there grey on hover. Numbers right-align. Sortable headers carry a 12px sort icon outside the label box so figures align under the header text; the active sort icon shows full strength. The first column pairs a semibold link with a 12px ink-3 subline.

### Change Rows
Product-change lists: name (medium weight, external-link icon fades in on hover) with a 12px ink-3 detail line on the left, the figure right-aligned semibold on the right (red when it is a cut), hairline-divided.

### Trust and Tracking Lines
One quiet 12px ink-2 line with a 14px shield (green or amber) or calendar icon, sitting under the right-column card: the audit verdict links to the audit; the tracking line states when the set is next checked. They never become cards or banners unless the audit failed.

## Do's and Don'ts

### Do:
- **Do** show every price change as a ticket on the grey rail, with the new price in Barlow Condensed 800 and the old price struck through.
- **Do** put the yellow sticker only on real cuts; a rise gets the carbon sticker.
- **Do** keep reduction red for lower prices and form errors, and use amber for failures and warnings.
- **Do** keep cards flat with a 1px edge border; reserve the ticket shadow for tickets.
- **Do** keep figures tabular and right-aligned in tables.
- **Do** state empty and baseline states in one plain sentence on a shelf-grey inset.
- **Do** keep transitions at 150ms on colour, opacity and the ticket lift, with no entrance animation.

### Don't:
- **Don't** build KPI tiles or summary stat cards; the ticket and the table are the evidence.
- **Don't** use yellow as a decorative highlight, section accent or badge fill.
- **Don't** give cards, tables or tags the ticket shadow or any rotation.
- **Don't** set running text, table cells or labels in Barlow Condensed.
- **Don't** return to a dark theme shell; the system is light only.
