# Original User Request

## Initial Request — 2026-09-21T04:43:12Z

Build a distraction-free, landscape typewriter writing Progressive Web Application tailored for the 10.5" 4:3 LivePaper display on the Daylight Computer (DC1). The application combines iA Writer's signature focus modes and synchronized margin notes with Lex.page-inspired AI writing affordances, local-first SQLite persistence (PowerSync-ready), offline-first resilience, pluggable Google Docs/Drive sync, and multi-format document export.

Working directory: ~/teamwork_projects/daylight_writer
Integrity mode: development

## Requirements

### R1. Daylight LivePaper Landscape Canvas & Focus Mode
Create a responsive, distraction-free writing environment styled strictly with Daylight Sol:OS neutral grayscale design tokens (`--os-0` to `--os-1000`) optimized for the DC1's 10.5" 4:3 landscape screen (1584×1184 / 1600×1200). Implement iA Writer-style sentence and paragraph focus modes (dimming inactive text to `--os-300` or `--os-200` while keeping the active block sharp at `--os-900` or `--os-1000`), typewriter center-scrolling (keeping the active cursor vertically centered on screen), automatic Markdown syntax formatting, auto-titling derived from the opening phrase with manual override, and a discreet date/time indicator in the top corner.

### R2. Dual Synchronized Drawers (File Library & Margin Scratchpad)
- **Left Drawer (Library):** A swipeable, collapsible navigation drawer organizing documents by last modified or created timestamp, featuring instant keyword and fuzzy search alongside hierarchical/nested tags.
- **Right Drawer (Thought Margin):** A swipeable, collapsible margin drawer that allows writers to dump thoughts and notes anchored directly to corresponding lines or paragraphs in the primary text. Scrolling the primary canvas must synchronously scroll the margin notes to maintain strict spatial alignment with their associated text blocks.
- Both drawers must dismiss with a single touch or keyboard shortcut (`Esc`, `Cmd+[`, `Cmd+]`), restoring a completely chrome-free typewriter view.

### R3. Lex-Inspired AI Writing Affordances
Provide unobtrusive, flow-preserving AI capabilities built directly into the editor canvas:
- Inline continuation triggered by typing shortcuts (e.g., `+++`).
- Inline command palette (`Cmd+K`) to transform highlighted text (summarize, expand, rewrite tone, adjust voice).
- Non-modal AI critique and checks mode offering suggestions on clarity, passive voice, and structure.
- Context-aware query assistant capable of consulting the current document and linked scratchpad notes.

### R4. Local-First SQLite Persistence & Pluggable Offline Sync
Implement local-first storage utilizing browser SQLite (wa-sqlite with OPFS or IndexedDB backend) with a schema prepared for PowerSync bidirectional synchronization. The app must function reliably in full offline environments (e.g. weeks off-grid), persisting all edits synchronously. Changes must queue locally and reconcile cleanly via a pluggable sync adapter designed for Google Docs and Google Drive upon network restoration.

### R5. Document Export & Native Sharing
Provide export pipelines that convert documents and attached margin notes into standard Markdown (`.md`), Plain Text (`.txt`), Microsoft Word (`.docx`), and PDF (`.pdf`), alongside triggering the system Share Sheet and email composition.

### R6. Controlled External Services & Mock Adapters
External network boundaries (Google OAuth / Google Drive APIs and AI completion endpoints) must be decoupled behind pluggable interface adapters. An automated mock adapter must be provided to enable hermetic, deterministic testing without requiring live credentials.

## Acceptance Criteria

### Display & Sol:OS Ergonomics
- [ ] Visual styling exclusively employs Sol:OS calibrated grayscale tokens (`--os-0` background, `--os-50` cards, `--os-900`/`--os-1000` primary text).
- [ ] Display interactions run fluidly at 60fps+ with zero EPD/E-ink screen flash or refresh artifacts.
- [ ] Active sentence/paragraph focus mode reduces opacity of surrounding text while keeping the active text at high contrast (WCAG AA compliant against background).

### Editor & Synchronized Margin Mechanics
- [ ] Entering Markdown formatting (e.g. `# `, `**bold**`, `*italic*`, `- list`) renders rich typography in real time without jumping cursor position.
- [ ] The right margin scratchpad keeps each thought note pinned to the vertical Y-coordinate of its associated paragraph during scrolling and window resizing.
- [ ] Dismissing both drawers yields a 100% full-width, zero-chrome typewriter screen.

### Navigation, Tags & Search
- [ ] Left drawer lists all local documents with sort toggle (Date Modified vs Date Created).
- [ ] Search input performs sub-50ms fuzzy matching and keyword filtering across document titles, bodies, and nested tag structures.
- [ ] Nested tags (e.g., `#project/drafts`, `#ideas/personal`) organize documents with filtering support.

### Local-First Persistence & Sync
- [ ] All document mutations persist to the local SQLite database synchronously, surviving simulated tab reload or process kill without data loss.
- [ ] Offline edits queue correctly while disconnected and successfully sync to the pluggable Google Docs adapter when connectivity resumes.
- [ ] No merge conflicts cause silent data overwrites; edits retain chronological integrity.

### AI Affordances
- [ ] Typing `+++` at cursor initiates inline streaming text generation into the active document node with undo (`Cmd+Z`) recovery.
- [ ] `Cmd+K` opens a lightweight command bar to apply transformations to selected text blocks.

### Export Suite
- [ ] Automated export test validates that a sample document with headings, formatting, and notes produces valid `.md`, `.txt`, `.docx`, and `.pdf` files containing full content.

## Verification Plan

### Automated Test Suite
- Run headless browser tests (e.g., Vitest / Playwright) covering:
  - Editor focus mode toggle, markdown auto-conversion, and typewriter scroll tracking.
  - Coordinate alignment tests verifying margin note offsets match target paragraph offsets under simulated scroll.
  - Local SQLite persistence and query performance (OPFS / wa-sqlite database CRUD and fuzzy search).
  - Offline sync queue resolution against the pluggable Google Docs adapter.
  - Multi-format file export binary/text validation.
- Contrast verification script asserting all rendered color values adhere to Sol:OS grayscale tokens.
