# Daylight Writer: Master Design Specification & Redesign Packet for Claude Design

> **Document Version**: 2.0 (Post-Google Drive Sync & LivePaper Dark Mode Release)  
> **Target Hardware**: Daylight Computer (DC1) 10.5" 4:3 LivePaper Display running Sol:OS  
> **Downstream Pipeline**: Compatible with `/claude-to-compose` autonomous Jetpack Compose synthesis  
> **Project Repository**: [https://github.com/makedaylight/experiment-lab](https://github.com/makedaylight/experiment-lab) (`apps/a12k-a2b/daylight-writer`)  
> **Author**: Antigravity Pair Programmer for **Anjan Katta**, Founder & CEO of Daylight Computer Co.

---

## Table of Contents
1. [Executive Brief & Objective](#1-executive-brief--objective)
2. [Physical Hardware & Display Architecture (DC1 & Sol:OS)](#2-physical-hardware--display-architecture-dc1--solos)
3. [Daylight Design System & Design Tokens (Light & Dark Mode)](#3-daylight-design-system--design-tokens-light--dark-mode)
4. [Comprehensive Breakdown of All 9 Surface Areas & UX Details](#4-comprehensive-breakdown-of-all-9-surface-areas--ux-details)
5. [Real DC1 Hardware Screenshots & Visual Reference Gallery](#5-real-dc1-hardware-screenshots--visual-reference-gallery)
6. [Application DOM Structure, Code Architecture & Shortcuts](#6-application-dom-structure-code-architecture--shortcuts)
7. [The Master Copy-Paste Prompt for Claude Design](#7-the-master-copy-paste-prompt-for-claude-design)
8. [The Claude-to-Compose Implementation Guide](#8-the-claude-to-compose-implementation-guide)

---

## 1. Executive Brief & Objective

Daylight Writer is the flagship distraction-free writing environment and native Android application engineered specifically for the revolutionary **Daylight Computer (DC1)**. It marries:
- The monastic, zero-chrome typewriter aesthetic of **iA Writer** (sentence/paragraph focus modes, vertical center-scrolling, pure typography).
- The deep organizational power of **Scrivener** (hierarchical binder, section outlines, scrivenings concatenation mode, and corkboard synopses).
- The warm reflection and visual structure of **Day One iOS** (rich date badges, clean journal cards, pill search, segmented controls).
- Modern AI writing affordances inspired by **Lex.page** (inline continuation `+++`, floating `Cmd+K` command palette, non-modal critique markers).
- Robust local-first persistence via **wa-sqlite (OPFS)** and real-time background sync with **Google Drive & native Google Docs (`application/vnd.google-apps.document`)** inside a dedicated `"Daylight Manuscripts"` folder.

### The Mission for Claude Design
We want Claude Design to craft an **elevated, cohesive, world-class redesign** of Daylight Writer. The redesign must:
1. Elevate all 9 distinct surface areas of the application into a seamless, tactile, premium writing instrument.
2. Introduce a dedicated, bespoke **Sol:OS LivePaper Dark Mode (Chalkboard / Night Paper)** designed specifically for reflective LCD optics.
3. Perfect the multi-theme architecture: **Daylight Sol:OS (Default)**, **Day One (iOS Journaling)**, **Scrivener Studio (Classic macOS)**, and **LivePaper Dark Mode**.
4. Produce a responsive, componentized web artifact (HTML + CSS or Tailwind) that can be shared via `claude.site` or local bundle, which will then be fed into our automated `/claude-to-compose` tool to synthesize native Android Jetpack Compose code with verified visual and UX fidelity.

---

## 2. Physical Hardware & Display Architecture (DC1 & Sol:OS)

When designing for the Daylight Computer (DC1), you are **NOT** designing for a standard glowing iPad OLED, nor are you designing for a sluggish E-Ink Kindle. The DC1 is fundamentally different.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   DAYLIGHT COMPUTER (DC1) DISPLAY SPECS                 │
├─────────────────────────┬──────────────────────────────────────────────┤
│ Display Technology      │ Custom Sharp NT36523N Reflective LCD (LivePaper)│
│ Screen Geometry         │ 10.5-inch diagonal, 4:3 aspect ratio         │
│ Physical Resolution     │ 1600 × 1200 pixels (270 DPI)                 │
│ Active Logical Viewport │ 1584 × 1184 pixels (with +8px hardware inset)│
│ Native Refresh Rate     │ 60Hz to 120Hz fluid refresh (Mode 2: 120.0 fps)│
│ Color Depth             │ 8-bit Grayscale (256 discrete levels of gray)│
│ Frontlight              │ Pure amber eye-safe illumination (0 blue light)│
│ Touch & Digitizer       │ Capacitive multi-touch + Wacom I2C Digitizer │
│ Hardware Key            │ Top Action button (`mtk-kpd` / keycode 142)  │
│ Hall Magnetic Sensor    │ Folio cover closure (`ACTION_SCREEN_OFF`)    │
└─────────────────────────┴──────────────────────────────────────────────┘
```

### Critical Display Invariants (Never Break These)
1. **ZERO E-Ink / EPD Artifacts**: There are NO microcapsules, NO electrophoretic particles, and NO physical ghosting. Never introduce artificial screen flashes, waveform refreshes, or modal dismissal delays.
2. **Fluid 120Hz Rendering**: Transitions, drawer slides, cursor blinking, and typewriter center-scrolling execute at a silky-smooth **120 frames per second** driven by Android SurfaceFlinger, Choreographer, and Skia/HWUI double-buffering. Standard settle time for UI animations is **150ms**.
3. **Sub-16ms Physical Response**: Hardware keys (<Esc>, <Action Button>, <Cmd+K>, <1>, <2>) execute instantaneously.
4. **Reflective Optics & Contrast**: The display reflects ambient daylight (and amber frontlight in the dark). Elements must maintain high contrast against their background. Primary text requires WCAG AAA compliance ($\ge 7.0:1$), and secondary elements must achieve at least $\Delta L^* \ge 15.0$ to prevent color collapse.

---

## 3. Daylight Design System & Design Tokens (Light & Dark Mode)

### 3.1 Official Sol:OS Calibrated Light Grayscale Tokens
The pre-calibrated neutral scale from `tokens.css` ensures maximum legibility and differentiability on the 8-bit reflective panel:

| Token | Hex Value | Decimal (0-255) | Semantic Usage |
|---|---|---|---|
| `--os-0` | `#FFFFFF` | 255 | Base paper ground, canvas background, pure white |
| `--os-50` | `#F7F7F7` | 247 | Drawer surface, card panels, floating dialog canvas |
| `--os-100` | `#DCD5C9` | 215 | Hairline borders (1px), dividers, subtle outlines |
| `--os-150` | `#F5F5F5` | 245 | Recessed search fields, input backgrounds |
| `--os-200` | `#CCCCCC` | 204 | Inactive indicators, disabled states, leader lines |
| `--os-300` | `#858585` | 133 | Low-emphasis text, dimmed focus text, clock badge |
| `--os-400` | `#535353` | 83 | Secondary text ink, snippet previews, sibling sentence |
| `--os-800` | `#343434` | 52 | Pressed control states, active pills, selection chips |
| `--os-900` | `#1A1A1A` | 26 | Primary text ink, document headings, active paragraph |
| `--os-1000` | `#000000` | 0 | Max black ink, active focused sentence |

**Calibrated Brand Grays**:
- Yellow Accent $\rightarrow$ `#CECECE` (206)
- Amber Accent $\rightarrow$ `#9D9D9E` (157)
- Orange Accent $\rightarrow$ `#6C6C6D` (108)

---

### 3.2 The Brand-New LivePaper Dark Mode (Chalkboard / Night Paper)
On a transflective/reflective LCD, dark mode is **NOT** a blinding glowing neon panel like OLED. Instead, black pixels absorb ambient and amber frontlight, while white/gray ink reflects light back to the eye. It creates an enchanting, tactile **"amber chalkboard"** experience.

Here is the official inverted Dark Mode token specification for Claude Design:

```css
/* ==========================================================================
   Daylight Sol:OS LivePaper Dark Mode (Chalkboard / Night Paper)
   ========================================================================== */
[data-theme="dark"], .theme-dark {
  --theme-name: "dark";
  
  /* Inverted Base Canvas & Surfaces */
  --os-dark-0: #000000;         /* 0: Deepest black ground / chalkboard canvas */
  --os-dark-50: #121212;        /* 18: Recessed drawer surface & background panels */
  --os-dark-100: #1F1F1F;       /* 31: Card surface, dialog panels, floating toolbars */
  --os-dark-150: #292929;       /* 41: Recessed input boxes, search fields */
  --os-dark-200: #3D3D3D;       /* 61: 1px hairline borders, subtle card outlines */
  --os-dark-300: #555555;       /* 85: Disabled controls, inactive tab indicators */
  --os-dark-400: #888888;       /* 136: Dimmed focus sentences, tertiary timestamps */
  --os-dark-700: #B8B8B8;       /* 184: Secondary text ink, active sibling sentences */
  --os-dark-900: #EBEBEB;       /* 235: Primary text ink, document headings */
  --os-dark-1000: #FFFFFF;      /* 255: Maximum white ink, active focused sentence */

  /* Semantic Mappings for Dark Mode */
  --color-canvas-bg: var(--os-dark-0);
  --color-surface-panel: var(--os-dark-50);
  --color-surface-card: var(--os-dark-100);
  --color-surface-input: var(--os-dark-150);
  --color-border-hairline: var(--os-dark-200);
  --color-border-focus: var(--os-dark-1000);
  --color-text-primary: var(--os-dark-900);
  --color-text-emphasis: var(--os-dark-1000);
  --color-text-secondary: var(--os-dark-700);
  --color-text-tertiary: var(--os-dark-400);
  --color-text-disabled: var(--os-dark-300);

  /* Amber Night-Writing Glow Accents */
  --accent-amber: #E2A93B;      /* Calibrated warm amber highlight for DC1 */
  --accent-amber-glow: rgba(226, 169, 59, 0.15);
  --accent-color: var(--os-dark-1000);
  --accent-text: var(--os-dark-0);
  
  /* Focus Mode Dimming on Dark Canvas */
  --color-focus-sentence-active: #FFFFFF;
  --color-focus-sentence-sibling: #888888;
  --color-focus-paragraph-dimmed: #444444;
  --color-focus-deep-dimmed: #2A2A2A;
}
```

---

### 3.3 Multi-Theme System Matrix
Claude Design should provide interactive switching between all 4 supported themes:

```
┌─────────────────┬──────────────────┬─────────────────┬─────────────────┬──────────────────┐
│ THEME           │ CANVAS BG        │ PANEL / DRAWER  │ BORDERS         │ PRIMARY TEXT     │
├─────────────────┼──────────────────┼─────────────────┼─────────────────┼──────────────────┤
│ 1. Sol:OS Light │ #FFFFFF (--os-0) │ #F7F7F7 (--os-50)│ #DCD5C9 (--os-100)│ #1A1A1A (--os-900)│
│ 2. Day One iOS  │ #FFFFFF (Warm)   │ #F7F8FA (iOS)   │ 14px Card Shell │ #2468C8 (Blue)   │
│ 3. Scrivener    │ #FAF8F5 (Paper)  │ #EAE6DF (Binder)│ 1.5px Dashed    │ "Charter" Serif  │
│ 4. Sol:OS Dark  │ #000000 (Chalk)  │ #121212 (Night) │ #3D3D3D (Dark)  │ #EBEBEB (White)  │
└─────────────────┴──────────────────┴─────────────────┴─────────────────┴──────────────────┘
```

---

## 4. Comprehensive Breakdown of All 9 Surface Areas & UX Details

### Surface 1: Typewriter Canvas & Focus Mode (iA Writer Archetype)
- **Visual Presentation**: 
  - Centered manuscript column with optimal reading measure: `max-width: 720px` (65 to 75 characters per line).
  - Generous vertical line leading (`line-height: 1.7` / ~34px) with custom typewriter monospace font (`iA Writer Mono`, `JetBrains Mono`).
  - Active sentence is high-contrast black (`--os-1000` or `#FFFFFF` in dark mode).
  - Inactive sibling sentences within the same paragraph are softly dimmed (`--os-400` or `--os-dark-700`).
  - Surrounding paragraphs are deeply dimmed (`--os-300` or `--os-dark-400`).
- **Interactive UX & Motion**:
  - **Typewriter Center-Scrolling**: As the author types, the active cursor line automatically locks to the vertical center of the screen (`--typewriter-midpoint-y: 592px`), scrolling the page smoothly at 120Hz under the cursor.
  - **Zero Chrome Restoration**: Pressing `Esc` or tapping the canvas immediately dismisses all open sidebars, modals, and toolbars, leaving 100% full-screen typography.
  - **Action Button / Top Key (`F12` / Keycode 142)**: Instant physical toggle between Sentence Focus, Paragraph Focus, and Normal Mode in `<16ms`.

---

### Surface 2: Header Navigation & Dynamic Status Bar
- **Visual Presentation**:
  - Subdued, hairline header sitting at the top of the canvas, auto-fading into invisible zero-chrome during active typing bursts.
  - **Document Title**: Clean inline editable heading with subtle auto-titling derived from the opening sentence.
  - **Live Cloud Sync Pill**: Sol:OS pill displaying real-time synchronization states:
    - `● Synced 14:02` (`--os-800` dot on `--os-150` pill)
    - `↻ Syncing (2)...` (with 120Hz micro-spinner)
    - `○ Offline` (hollow circle indicating local SQLite WAL queue)
    - `⚠ Error (Retry)` (retryable network/auth indicator)
  - **Stats & Indicators**: Word count badge, estimated reading time, system time, and battery percentage.
  - **Theme & Mode Fast-Toggles**: Icon buttons for Theme Switcher, Dark Mode toggle, Focus Mode, and Export.

---

### Surface 3: Left Drawer (Library, Search & Scrivener Binder)
- **Visual Presentation**:
  - Collapsible side panel (`width: 320px`, surface `--os-50` / `--os-dark-50`) with clean vertical hairline border.
  - **Search Bar**: Instant sub-15ms fuzzy search input with recessed background (`--os-150`), clear button, and filter tags.
  - **Sort Segmented Control**: Fast toggle between "Modified", "Created", and "Title".
  - **Hierarchical Scrivener Binder View**:
    - Nested tree structure: Manuscript $\rightarrow$ Chapters $\rightarrow$ Scenes.
    - Drag-and-drop reorder handles with persistent tree index.
    - Status stamps (`[DRAFT]`, `[REVISED]`, `[FINAL]`, `[TODO]`).
  - **Day One Journal Card View**:
    - Signature 2-column calendar date badge (Blue `#2468C8` in Day One mode, Sol:OS gray in default mode): Day number (e.g. `27`), month (`SEP`), and time (`2:15 PM`).
    - Title, 2-line snippet preview, nested tags (`#essays/drafts`), and Google Docs sync badge (`docs.google.com/document/d/...`).

---

### Surface 4: Right Drawer (Spatially Synchronized Thought Margin)
- **Visual Presentation**:
  - Collapsible right margin drawer (`width: 360px`, surface `--os-50` / `--os-dark-50`).
  - Corkboard / index card layout in Scrivener mode (`1.5px dashed border`, `SYNOPSIS` header badge).
  - Reflection thought cards in Day One mode (`border-left: 4px solid #2468C8`).
- **Interactive UX & Spatial Alignment**:
  - **Spatial Parallax Pinning**: Each thought note is mathematically anchored to the exact logical Y-coordinate of its matching paragraph in the editor.
  - **Synchronous Scrolling**: Scrolling the main typewriter canvas smoothly translates the margin note cards along the Y-axis in real-time at 120Hz, ensuring the author never loses spatial context between their text and their thoughts.
  - **Add Note Affordance**: Hovering or tapping next to any paragraph reveals a discreet `+` button in the gutter.

---

### Surface 5: AI Writing Affordances (Lex-Inspired Ergonomics)
- **Inline Streaming Continuation (`+++`)**:
  - Typing `+++` anywhere in the document initiates instant inline continuation streaming from the AI.
  - Rendered in subtle italic ink (`--os-400` / `--os-dark-700`) with instant `Cmd+Z` undo recovery or `Tab` to accept.
- **Floating Command Palette (`Cmd+K`)**:
  - Lightweight, non-modal floating palette positioned directly above highlighted text.
  - Actions: *Rewrite Tone*, *Summarize*, *Expand Thought*, *Check Passive Voice*, *Fix Flow*.
  - Instant keyboard navigation with arrow keys and `<Enter>`.
- **Non-Modal Critique & Checks Bar**:
  - Discreet hairline underlines beneath structural issues (e.g. passive voice, repetitive words, clunky syntax).
  - Tapping an underline opens a micro-popover with suggestions without moving the cursor or breaking typing flow.

---

### Surface 6: Settings & Multi-Theme Switcher Modal (`Cmd+,`)
- **Visual Presentation**:
  - Centered floating dialog (`max-width: 600px`, `--os-50` / `--os-dark-100` card, `--os-100` border, soft backdrop overlay).
  - **Visual Theme Selector**:
    - Four rich mini-preview interactive cards representing:
      1. **Daylight Sol:OS** (Minimalist paper, monochrome badges, neutral typography)
      2. **Day One iOS** (Signature blue badge, rounded 14px cards, SF Pro typography)
      3. **Scrivener Studio** (Warm manuscript parchment, binder hierarchy, dashed index cards)
      4. **Sol:OS Dark Mode** (Deep chalkboard black, white typography, amber frontlight accents)
  - **Typography Controls**: Font family selector (Mono vs Serif vs System Proportional), font size slider (16px to 28px), line height adjustment.
  - **Focus Mode Preferences**: Sentence focus vs Paragraph focus vs Typewriter center-lock toggle.

---

### Surface 7: Google Drive & Google Docs Auto-Sync Modal
- **Visual Presentation**:
  - Clean settings panel accessible via clicking the header sync pill or `Cmd+,` $\rightarrow$ Cloud Sync.
  - **Account Badge**: Shows connected Google account (`a12katta@gmail.com`) with verified checkmark.
  - **Target Folder**: Clear visual representation of `Google Drive / "Daylight Manuscripts"`.
  - **Sync Mechanism Highlights**:
    - Explains 1.5s background debounce (zero manual saving needed).
    - Native Google Docs (`application/vnd.google-apps.document`) in-place batch update (zero duplicate files).
  - **Manual Force Sync Trigger**: Instant "Sync Now" button with live progress indicator.
  - **Direct OAuth Token Entry**: Secure fallback textarea for hermetic testing or manual token entry.
  - **Live Telemetry & Activity Log**: Timestamped event log (e.g. `14:02:11 - Pushed 240 chars to doc 1A9b...`).

---

### Surface 8: Multi-Format Document Export Modal (`Cmd+E`)
- **Visual Presentation**:
  - Clean export sheet offering 4 primary export formats:
    - **Markdown (`.md`)**: Full text with YAML frontmatter, tags, and attached margin notes as footnotes.
    - **Plain Text (`.txt`)**: Pure clean ASCII/UTF-8 manuscript text.
    - **Microsoft Word (`.docx`)**: Professional document with formatted headings, margins, and footnotes.
    - **Adobe PDF (`.pdf`)**: Book-ready typeset page layout matching DC1 LivePaper proportions.
  - **Native Android SAF Actions**:
    - "Save to Storage" (triggers Android `ACTION_CREATE_DOCUMENT` file picker for internal storage, SD card, or USB-C drive).
    - "System Share Sheet" (triggers Android `Intent.ACTION_SEND` to beam to teammates, email, or nearby devices).

---

### Surface 9: Scrivenings Concatenation & Corkboard View
- **Visual Presentation**:
  - Multi-document continuous authoring mode (Steven Johnson workflow: "break into pieces to focus, concatenate to see the whole").
  - Selecting a folder or multiple files in the left binder merges their text blocks into one single seamless document.
  - Sections are separated by elegant glyph dividers (`§ Section Title — 850 words`).
  - **Corkboard View Toggle**: Transforms the editor into a tactile grid of index cards showing each section's synopsis, draft status, and target word count progress bars.

---

## 5. Real DC1 Hardware Screenshots & Visual Reference Gallery

All 12 authentic hardware screenshots captured directly from the physical Daylight Computer (DC1) display are available in the project repository and artifact storage. Claude Design should examine these existing designs and elevate them with enhanced polish, clearer spacing, refined micro-interactions, and the new dark mode:

| File Name | Absolute Path | Surface Description & Design Analysis |
|---|---|---|
| `state_9_ia_writer_zero_chrome_hardware.png` | `screenshots/state_9_ia_writer_zero_chrome_hardware.png` | **Zero-Chrome Typewriter View**: 100% full-width immersive canvas. Center-scrolling cursor, clean typography, 0 distracting UI bars. |
| `state_1_focus_mode_hardware.png` | `screenshots/state_1_focus_mode_hardware.png` | **iA Writer Focus Mode**: Active sentence rendered at maximum black (`--os-1000`), surrounding text dimmed to `--os-300` / `--os-400`. |
| `state_2_scrivener_outline_hardware.png` | `screenshots/state_2_scrivener_outline_hardware.png` | **Scrivener Left Binder Drawer**: Hierarchical document tree, chapter folders, nested sections, word count badges. |
| `state_3_scrivenings_concatenation_hardware.png` | `screenshots/state_3_scrivenings_concatenation_hardware.png` | **Scrivenings Mode**: Multiple sub-sections concatenated into a single continuous editing flow with `§` glyph dividers. |
| `state_4_dual_drawers_margin_notes_hardware.png` | `screenshots/state_4_dual_drawers_margin_notes_hardware.png` | **Dual Drawers Active**: Left library binder open simultaneously with right margin thought scratchpad pinned to paragraphs. |
| `state_5_collaboration_modal_hardware.png` | `screenshots/state_5_collaboration_modal_hardware.png` | **Collaboration & AI Modal**: Multi-writer room setup, Y.js peer connections, and AI prompt suggestions. |
| `state_6_export_dialog_hardware.png` | `screenshots/state_6_export_dialog_hardware.png` | **Document Export Dialog**: Multi-format selection (`.md`, `.txt`, `.docx`, `.pdf`), layout options, and Android SAF trigger. |
| `state_7_google_drive_sync_hardware.png` | `screenshots/state_7_google_drive_sync_hardware.png` | **Google Drive & Docs Sync Dialog**: Connected user (`a12katta@gmail.com`), `"Daylight Manuscripts"` target folder, live sync logs. |
| `state_8_native_apk_120hz_hardware.png` | `screenshots/state_8_native_apk_120hz_hardware.png` | **Native Android 120Hz APK**: Running on DC1 with zero Android status/nav bars, full edge-to-edge landscape display. |
| `state_10_dayone_ios_theme_hardware.png` | `screenshots/state_10_dayone_ios_theme_hardware.png` | **Day One iOS Journaling Theme**: Blue 2-column date badges (`27 SEP`), rounded 14px cards, iOS search pill, segmented controls. |
| `state_11_scrivener_theme_hardware.png` | `screenshots/state_11_scrivener_theme_hardware.png` | **Scrivener Studio Theme**: Parchment canvas, Mac binder styling, status stamp chips (`[DRAFT]`, `[REVISED]`), dashed synopsis cards. |
| `state_12_settings_theme_modal_hardware.png` | `screenshots/state_12_settings_theme_modal_hardware.png` | **Settings & Theme Modal**: Interactive theme cards with live mini-previews, focus settings, and typography controls. |

---

## 6. Application DOM Structure, Code Architecture & Shortcuts

Claude Design can reference the actual DOM structure of Daylight Writer to ensure the redesign maps 1:1 with the code components:

```html
<div id="app" class="theme-solos" data-theme="solos">
  <!-- Top Minimal Header (Auto-Hides in Focus Mode) -->
  <header class="app-header">
    <div class="header-left">
      <button id="btn-toggle-library" class="icon-btn" title="Toggle Library (Cmd+[)">☰</button>
      <span id="doc-title-display" class="doc-title" contenteditable="true">The Architecture of Sunlight</span>
    </div>
    <div class="header-center">
      <!-- Real-Time Sync Status Pill -->
      <div id="sync-status-pill" class="sync-pill status-synced" title="Google Drive Sync Status">
        <span class="sync-dot">●</span>
        <span class="sync-text">Synced 14:02</span>
      </div>
    </div>
    <div class="header-right">
      <span id="word-count-badge" class="stat-badge">1,248 words</span>
      <button id="btn-theme-toggle" class="icon-btn" title="Toggle Theme">◐</button>
      <button id="btn-toggle-margin" class="icon-btn" title="Toggle Thought Margin (Cmd+])">✎</button>
      <button id="btn-settings" class="icon-btn" title="Settings (Cmd+,)">⚙</button>
    </div>
  </header>

  <!-- Main 3-Column Studio Workspace -->
  <main class="studio-workspace">
    <!-- Left Drawer: Library & Scrivener Binder -->
    <aside id="drawer-left" class="drawer drawer-left collapsed">
      <div class="drawer-header">
        <input type="search" class="search-input" placeholder="Search manuscripts & tags..." />
        <div class="sort-segmented-control">
          <button class="sort-btn active">Modified</button>
          <button class="sort-btn">Created</button>
          <button class="sort-btn">Binder</button>
        </div>
      </div>
      <div class="drawer-content library-list">
        <!-- Document cards and binder tree nodes rendered here -->
      </div>
    </aside>

    <!-- Center Column: Typewriter Canvas -->
    <section class="editor-viewport">
      <div class="canvas-scroll-container" id="typewriter-scroller">
        <div class="typewriter-canvas" id="editor-canvas">
          <!-- TipTap / Markdown Document Nodes with Focus Classes -->
          <h1 class="node-heading">The Architecture of Sunlight</h1>
          <p class="node-paragraph focus-active">
            <span class="sentence focus-sentence-active">Sunlight on a reflective panel is not a glare to be fought; it is the ink itself.</span>
            <span class="sentence focus-sentence-sibling">The room around me faded into a warm, amber silence.</span>
          </p>
          <p class="node-paragraph focus-dimmed">
            <span class="sentence">Every thought became tangible, pressed onto the page with zero flicker or fatigue.</span>
          </p>
        </div>
      </div>
    </section>

    <!-- Right Drawer: Spatially Synchronized Thought Margin -->
    <aside id="drawer-right" class="drawer drawer-right collapsed">
      <div class="drawer-header">
        <h3 class="margin-title">Thought Margin</h3>
        <button id="btn-add-thought" class="icon-btn">+</button>
      </div>
      <div class="drawer-content margin-notes-track" id="margin-track">
        <!-- Spatially anchored note cards translated along Y-axis -->
        <div class="thought-note-card" style="transform: translateY(240px);">
          <div class="note-meta">Paragraph 1 · Note</div>
          <div class="note-body">Reference Goethe's Theory of Colours regarding ambient illumination.</div>
        </div>
      </div>
    </aside>
  </main>

  <!-- Modals (Rendered dynamically into #modal-container) -->
  <div id="modal-container" class="modal-backdrop hidden"></div>
</div>
```

### Keyboard Shortcuts & Physical Hardware Key Map
- `Esc`: Dismiss all open drawers and modals $\rightarrow$ Restore pure zero-chrome typewriter view.
- `Action Button` (`F12` / Keycode 142): Cycle Focus Mode (Sentence $\rightarrow$ Paragraph $\rightarrow$ Off).
- `Cmd + [`: Toggle Left Library / Binder Drawer.
- `Cmd + ]`: Toggle Right Thought Margin Drawer.
- `Cmd + K`: Open Floating AI Command Bar on selected text.
- `+++` (typed at cursor): Trigger inline AI continuation stream.
- `Cmd + ,`: Open Settings & Theme Selection Modal.
- `Cmd + E`: Open Document Export Dialog.
- `Cmd + S`: Trigger immediate WAL flush & Google Drive sync.

---

## 7. The Master Copy-Paste Prompt for Claude Design

Copy and paste the entire block below directly into **Claude Design (Claude 3.5 Sonnet / Artifacts)**:

````markdown
# Mission: Complete Product & Visual Redesign of Daylight Writer for Daylight Computer (DC1)

You are the Principal Product Designer and Design Systems Architect at **Daylight Computer Co.**, working directly with founder **Anjan Katta**.

Your task is to create a complete, breathtaking, production-grade redesign of **Daylight Writer**—the distraction-free, landscape typewriter writing environment and native Android application built for the **Daylight Computer (DC1)**.

---

## 1. The Physical Canvas & Hardware Profile
You are designing for a revolutionary physical computing device. Adhere strictly to these hardware invariants:
- **Display**: 10.5-inch 4:3 **LivePaper Reflective LCD** (1584×1184 landscape active viewport, 270 DPI).
- **Refresh Rate**: Native **60Hz to 120Hz** fluid refresh rate (VSYNC-synchronized, full GPU acceleration).
- **Color Depth**: **8-bit Grayscale (256 discrete levels of gray)**, monochrome with subtle calibrated tints.
- **ZERO E-Ink Artifacts**: The DC1 is **NOT** an E-Ink panel. There are NO electrophoretic particles, NO ghosting, and NO flashing screen refreshes. Settle time is a fluid 150ms.
- **Optics**: The display reflects ambient daylight with pure eye-safe amber frontlight. Primary text requires high contrast ($\ge 7.0:1$ WCAG AAA).

---

## 2. Design System & Theme Engine
Your design must implement four distinct, switchable themes using pre-calibrated tokens:

### A. Daylight Sol:OS (Default Neutral Grayscale)
- Background: `--os-0: #FFFFFF`
- Surfaces/Cards: `--os-50: #F7F7F7`
- Hairline Borders: `--os-100: #DCD5C9` (1px)
- Recessed Inputs: `--os-150: #F5F5F5`
- Dimmed Text: `--os-300: #858585`
- Secondary Ink: `--os-400: #535353`
- Primary Ink: `--os-900: #1A1A1A`
- Max Black Ink: `--os-1000: #000000`

### B. Sol:OS LivePaper Dark Mode (NEW: Chalkboard / Night Paper)
Tailored specifically for reflective LCD night-writing under pure amber illumination:
- Background: `#000000` (deep light-absorbing black ground)
- Recessed Drawers: `#121212`
- Floating Cards/Modals: `#1F1F1F`
- Hairline Borders: `#3D3D3D` (1px crisp border)
- Dimmed Text: `#555555` / `#888888`
- Secondary Text: `#B8B8B8`
- Primary Ink: `#EBEBEB`
- Active Sentence Ink: `#FFFFFF`
- Amber Warm Accent: `#E2A93B`

### C. Day One (iOS Journaling Aesthetic)
- Rounded cards (`border-radius: 14px`), signature 2-column blue date badges (`#2468C8`), pill search bars, segmented controls, SF Pro typography.

### D. Scrivener Studio (Classic macOS Desktop Aesthetic)
- Warm manuscript parchment (`#FAF8F5`), classic Mac binder drawer (`#EAE6DF`), status stamp chips (`[DRAFT]`, `[REVISED]`), corkboard index cards with dashed borders (`1.5px dashed #C8C2B8`), and "Charter" serif typography.

---

## 3. What You Must Design (All 9 Surface Areas)
Create a comprehensive, interactive single-page web artifact (or multi-view interactive prototype) covering:

1. **Typewriter Canvas & Focus Modes**:
   - Monastic zero-chrome writing column (max-width 720px, 65-75 CPL).
   - iA Writer-style sentence/paragraph focus dimming.
   - Typewriter vertical center-scrolling (cursor locked at 50% viewport height).
2. **Minimal Header & Live Cloud Sync Pill**:
   - Auto-hiding header with document title, word count, reading time, and real-time sync pill (`● Synced 14:02`, `↻ Syncing...`, `○ Offline`).
3. **Left Navigation Drawer (Library & Scrivener Binder)**:
   - Search bar with instant fuzzy matching and tag pills (`#essays/drafts`).
   - Binder hierarchy with drag-and-drop handles and status chips.
   - Day One date badge cards showing month, day, time, and Google Docs sync badges.
4. **Right Thought Margin Drawer (Spatial Parallax Scratchpad)**:
   - Margin notes pinned to corresponding paragraph Y-coordinates.
   - Synchronous scrolling with the editor canvas.
   - Corkboard synopsis cards with dashed borders and section titles.
5. **AI Writing Affordances (Lex-Inspired)**:
   - Inline continuation indicator (`+++`).
   - Floating `Cmd+K` command palette above highlighted text.
   - Non-modal critique markers and flow suggestions.
6. **Settings & Theme Switcher Modal (`Cmd+,`)**:
   - Visual cards with live mini-previews for all 4 themes (including Dark Mode).
   - Typography controls (Font size, leading, font family).
7. **Google Drive & Docs Auto-Sync Dialog**:
   - Shows connected account (`a12katta@gmail.com`), target folder `"Daylight Manuscripts"`, live telemetry log, and force sync trigger.
8. **Document Export Modal (`Cmd+E`)**:
   - Multi-format selection (`.md`, `.txt`, `.docx`, `.pdf`), layout options, and Android SAF trigger.
9. **Scrivenings Multi-Document Concatenation View**:
   - Continuous multi-section editor with `§` dividers, and toggle to corkboard synopsis grid.

---

## 4. Delivery & Output Format Requirements
To allow our automated `/claude-to-compose` pipeline to convert your design into native Android Jetpack Compose Material 3 code:
- Deliver your design as a **self-contained, fully responsive, interactive HTML/CSS/JS artifact**.
- Use clean, semantic HTML5 elements (`<header>`, `<main>`, `<aside>`, `<article>`, `<button>`, `<input>`).
- Enforce touch-friendly ergonomics: all clickable buttons, pills, and list items must have at least **48×48dp** touch target areas (`min-height: 48px`, `min-width: 48px`).
- Include interactive theme switching so we can toggle between **Sol:OS Light**, **Day One**, **Scrivener**, and **LivePaper Dark Mode** in real-time.
- Use vector SVG icons with clear `viewBox` attributes for all icons.
- Avoid hardcoded fixed layout widths; use flexible CSS Grid and Flexbox layouts optimized for landscape 4:3 (1584×1184).

Begin by generating the complete, stunning redesign artifact now!
````

---

## 8. The Claude-to-Compose Implementation Guide

When Claude Design delivers the completed redesign artifact (either as a public `claude.site` URL, a `claude.ai/share/...` link, or a raw HTML/CSS file), we will immediately execute the automated `/claude-to-compose` pipeline.

### Step-by-Step Execution Workflow

1. **Ingest the Redesign Artifact**:
   Run the slash command in Antigravity:
   ```bash
   /claude-to-compose <input-url-or-file> -a ./android -p com.daylight.writer
   ```
   Or invoke the headless extraction CLI:
   ```bash
   node skills/claude-to-compose/workflow.js <input-url-or-file> --android-dir ./android --package com.daylight.writer
   ```

2. **Phase 1: Headless Extraction**:
   - The **Extractor Agent** launches headless Playwright.
   - Pierces iframes, waits for font loading and hydration stabilization.
   - Extracts computed CSS tokens (colors, typography scales, corner radii, borders, shadows).
   - Emits canonical `output/design_spec.json` and multi-viewport screenshots (`mobile_reference.png`, `desktop_reference.png`).

3. **Phase 2: Architectural Jetpack Compose Synthesis**:
   - The **Compose Architect Agent** translates the extracted spec into idiomatic Android Kotlin Jetpack Compose code:
     - `Theme.kt`: Supporting Sol:OS Light, Dark Mode, Day One, and Scrivener.
     - `Color.kt`: M3 `ColorScheme` mapped to `--os-0` through `--os-1000` and dark mode tokens.
     - `Type.kt`: M3 `Typography` scale mapped to `iA Writer Mono` and `Charter`.
     - `components/`: Atomic composables (`AppButton.kt`, `DocumentCard.kt`, `SyncPill.kt`, `MarginNoteCard.kt`, `ThemeCard.kt`).
     - `screen/ClaudeDesignScreen.kt`: The complete responsive 4:3 studio screen assembling the 3-column layout.
   - The **Motion Specialist Agent** adds touch ripples, fluid 150ms transitions, and hoisted reactive states via `rememberSaveable`.

4. **Phase 3: Visual QA & Audit Rubric Verification**:
   - Executes `./gradlew compileDebugKotlin` (ensuring 0 errors).
   - Executes `./gradlew testDebugUnitTest` running Robolectric Native Graphics preview capture.
   - Performs automated Pixelmatch & SSIM diff against the reference screenshots.
   - Evaluates the 10-point Agent-as-Judge rubric ensuring a total score $\ge 90 / 100$ and zero veto violations.
   - Emits the final `verification_report.md`.

5. **Phase 4: Hardware Deployment to DC1**:
   - Reassembles the Android release APK and deploys to the connected DC1 tablet (`rooted 4`, serial `JMBR00405`) at 120Hz native LivePaper refresh rate.
   - Re-runs `daylight_capture_screen` to verify WCAG AAA contrast compliance ($> 7.0:1$) on physical hardware.
