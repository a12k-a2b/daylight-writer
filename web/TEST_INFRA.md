# Test Infrastructure & Specification: Daylight Writer

## 1. Executive Summary & Test Philosophy

Daylight Writer is an intentional, distraction-free landscape typewriter Progressive Web Application engineered exclusively for the Daylight Computer (DC1) and its 10.5" 4:3 LivePaper display running Sol:OS.

### 1.1 Opaque-Box & Requirement-Driven Testing Philosophy
The Daylight Writer E2E test suite adheres to an **independent, opaque-box, requirement-driven methodology**:
- **Zero Implementation Coupling**: Tests assert behaviors strictly against the user requirements documented in `ORIGINAL_REQUEST.md` (R1–R6) and the formal interface contracts defined in `PROJECT.md`. Tests verify external interfaces, observable DOM state, persistence guarantees, and export artifacts without depending on internal implementation details.
- **100% Hermetic & Deterministic Execution**: All tests execute in a clean, self-contained environment without requiring live external network access, API credentials, or physical device attachments. Mock storage and mock service adapters (`MockAIServiceAdapter`, `MockGoogleDocsSyncAdapter`) provide configurable latency, deterministic fixtures, and simulated failure modes.
- **Strict Hardware Profile Verification**: The test suite enforces the unique hardware characteristics of the Daylight Computer (DC1) LivePaper display:
  - **1584×1184 Active Landscape Viewport** (+8px physical inset from 1600×1200 panel).
  - **8-bit Grayscale Design System**: Strict adherence to official Sol:OS tokens (`--os-0` to `--os-1000`).
  - **Zero EPD/E-Ink Workarounds**: Prohibits EPD screen flashes, waveform hooks, and artificial clearing pauses; mandates fluid 60Hz–120Hz continuous rendering.
  - **Typewriter Ergonomics**: 50% viewport height (592px vertical midpoint) cursor tracking and dynamic virtual keyboard (IME) recalibration.

---

## 2. Feature Inventory Coverage Matrix (F01–F65)

| Feature ID | Feature Description | Assigned Tier(s) | Primary Test File(s) | Verification Strategy |
|---|---|---|---|---|
| **F01** | Sol:OS 8-bit Grayscale CSS Token System | Tier 1, Contrast | `tier1-features/f01-f03-solos-tokens-viewport.test.ts`, `contrast-audit.test.ts` | Token palette mapping (`--os-0` to `--os-1000`), monochrome purity check |
| **F02** | DC1 10.5" 1584×1184 Landscape Viewport Shell | Tier 1 | `tier1-features/f01-f03-solos-tokens-viewport.test.ts` | 4:3 aspect ratio, 1584×1184 active bounds, +8px inset validation |
| **F03** | Fluid 60-120fps Animation Standards | Tier 1 | `tier1-features/f01-f03-solos-tokens-viewport.test.ts` | Assert absence of E-ink screen-flash hooks, zero `ACTION_REFRESH_SCREEN` |
| **F04** | Distraction-Free Typewriter Editor Container | Tier 1 | `tier1-features/f04-f07-typewriter-scroll.test.ts` | 720px max column width (65–75 CPL), horizontal auto-centering |
| **F05** | Typewriter Vertical Center-Scrolling Engine | Tier 1 | `tier1-features/f04-f07-typewriter-scroll.test.ts` | Caret Y-offset maintained at 592px (50% viewport) during input |
| **F06** | Smooth rAF Lerp Scrolling & User Scroll Suspension | Tier 1 | `tier1-features/f04-f07-typewriter-scroll.test.ts` | rAF interpolation tracking; suspension of auto-scroll on manual touch/wheel |
| **F07** | IME Dynamic Midpoint Recalibration | Tier 1, Tier 2 | `tier1-features/f04-f07-typewriter-scroll.test.ts`, `tier2-boundaries/viewport-ime-keyboard-recalibration.test.ts` | Center target shifts to `(viewportHeight - keyboardHeight) / 2` |
| **F08** | iA Writer Paragraph Focus Mode | Tier 1 | `tier1-features/f08-f13-focus-markdown-titling.test.ts` | Active paragraph at `--os-900`/`--os-1000`, non-active paragraphs dimmed to `--os-300` |
| **F09** | iA Writer Sentence Focus Mode via Intl.Segmenter | Tier 1, Tier 2 | `tier1-features/f08-f13-focus-markdown-titling.test.ts`, `tier2-boundaries/sentence-boundary-edge-cases.test.ts` | Unicode `Intl.Segmenter` boundaries; active sentence `--os-1000`, local paragraph `--os-400`, remote `--os-200` |
| **F10** | Real-Time Markdown Syntax Formatting | Tier 1 | `tier1-features/f08-f13-focus-markdown-titling.test.ts` | Headings, bold, italic, list markers parsed inline without jumping caret |
| **F11** | Dynamic Auto-Titling Derived From Opening Phrase | Tier 1 | `tier1-features/f08-f13-focus-markdown-titling.test.ts` | Title extracted from first heading or non-empty sentence up to 40 chars |
| **F12** | Manual Title Override Lock | Tier 1 | `tier1-features/f08-f13-focus-markdown-titling.test.ts` | `is_title_custom = true` protects title against auto-title regeneration |
| **F13** | Discreet Top-Corner Live Date/Time Indicator | Tier 1 | `tier1-features/f08-f13-focus-markdown-titling.test.ts` | Top-right corner minimalist timestamp formatted with Sol:OS tokens |
| **F14** | Single-Keystroke & Touch Zero-Chrome Dismissal | Tier 1 | `tier1-features/f14-f22-dual-drawers-margin.test.ts` | `Esc`, `Cmd+[`, `Cmd+]`, or backdrop tap restores 100% full-width editor |
| **F15** | Left Drawer Layout & Slide Animation | Tier 1 | `tier1-features/f14-f22-dual-drawers-margin.test.ts` | 320px width drawer for document library, sort toggle, and search |
| **F16** | Document Library Date Sorting | Tier 1 | `tier1-features/f14-f22-dual-drawers-margin.test.ts` | Sort order toggle between `updated_at` (modified) and `created_at` |
| **F17** | Right Drawer Thought Margin Layout & Animation | Tier 1 | `tier1-features/f14-f22-dual-drawers-margin.test.ts` | 360px width drawer for anchored thought scratchpad notes |
| **F18** | Thought Note Creation Anchored to Paragraph ID | Tier 1 | `tier1-features/f14-f22-dual-drawers-margin.test.ts` | Binds thought note to specific `paragraph_anchor_id` in document |
| **F19** | Synchronous Spatial Scroll Tracking for Margin Notes | Tier 1 | `tier1-features/f14-f22-dual-drawers-margin.test.ts` | Margin note vertical offset tracks target paragraph offset 1:1 during scroll |
| **F20** | Margin Note Stacking & Hairline Leader Lines | Tier 1 | `tier1-features/f14-f22-dual-drawers-margin.test.ts` | Non-destructive vertical stacking when notes collide, `--os-200` leader lines |
| **F21** | Orphaned Thought Note Retention | Tier 1, Tier 2 | `tier1-features/f14-f22-dual-drawers-margin.test.ts`, `tier2-boundaries/paragraph-deletion-margin-orphans.test.ts` | Preserves margin note with orphan status when target paragraph is deleted |
| **F22** | Drawer Backdrop Light-Dismiss & Keyboard Shortcuts | Tier 1 | `tier1-features/f14-f22-dual-drawers-margin.test.ts` | Backdrop overlay tap dismisses open drawer; keyboard shortcuts toggle |
| **F23** | Multi-Tier wa-sqlite Web Worker Storage Engine | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | Multi-tier persistence (OPFS / IDB / In-Memory for tests) |
| **F24** | PowerSync-Ready Schema DDL & Migrations | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | `documents`, `margin_notes`, `tags`, `document_tags`, `sync_queue`, `fts` tables |
| **F25** | In-Memory Reactive Cache with Debounced WAL Disk Flush | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | 0ms typing lag with 250ms debounced disk write-back |
| **F26** | Emergency Synchronous Disk Flush on Page Lifecycle | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | Flushes pending cache immediately on `beforeunload`, `visibilitychange`, `pagehide` |
| **F27** | Document CRUD Repository Operations | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | Create, read, update, soft-delete, and list documents |
| **F28** | Margin Note CRUD & Paragraph Association Engine | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | Full lifecycle for margin notes associated with document paragraphs |
| **F29** | Hierarchical Nested Tag Parser | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | `#category/subcategory` syntax parsed into structured tag paths |
| **F30** | Document-Tag Association Management | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | Many-to-many relationship linking documents and hierarchical tags |
| **F31** | Sub-50ms Fuzzy Search Engine | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | Fast fuzzy query matching (<3ms) across title, body, and tags |
| **F32** | Nested Tag Tree Browser Query Support | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | Queries documents filtered by parent tag prefix or child tag path |
| **F33** | Offline Mutation Queueing Engine | Tier 1 | `tier1-features/f33-f41-sync-queue-conflict.test.ts` | Queues local mutations with chronological timestamps and retry counts |
| **F34** | SyncAdapter Pluggable Interface Contract | Tier 1 | `tier1-features/f33-f41-sync-queue-conflict.test.ts` | Formal interface verification (`init`, `sync`, `getStatus`, `resolveConflict`) |
| **F35** | MockGoogleDocsSyncAdapter Simulation | Tier 1 | `tier1-features/f33-f41-sync-queue-conflict.test.ts` | Deterministic simulation of cloud push, pull, latency, and simulated errors |
| **F36** | Two-Way Sync Conflict Resolution | Tier 1, Tier 2 | `tier1-features/f33-f41-sync-queue-conflict.test.ts`, `tier2-boundaries/offline-disconnect-reconnect-conflicts.test.ts` | Chronological integrity preservation without silent overwrites |
| **F37** | Network Connectivity Listener & Automatic Sync Trigger | Tier 1 | `tier1-features/f33-f41-sync-queue-conflict.test.ts` | Triggers sync flush automatically upon `online` event dispatch |
| **F38** | Sync Status State Machine & UI Indicator | Tier 1 | `tier1-features/f33-f41-sync-queue-conflict.test.ts` | State transitions (`idle`, `syncing`, `offline`, `error`) rendered in Sol:OS tokens |
| **F39** | Soft Delete & Tombstone Synchronization Support | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | `deleted_at` timestamp marks documents without premature physical deletion |
| **F40** | Database Export & Snapshot Backup Hook | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | Binary snapshot export and import for database backups |
| **F41** | Search Query Tokenizer & Multi-Attribute Scorer | Tier 1 | `tier1-features/f23-f32-sqlite-crud-search.test.ts` | Weighted relevance scoring prioritizing title and tag matches over body |
| **F42** | Inline Continuation Trigger Detection (`+++`) | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Detects `+++` typing suffix and initiates streaming continuation |
| **F43** | Streaming Text Continuation Simulation & Injection | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Streams text chunks into editor node with temporary secondary ink (`--os-400`) |
| **F44** | Atomic Single-Step Undo/Redo (`Cmd+Z`) for Continuation | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Reverts entire generated AI completion in a single `Cmd+Z` keystroke |
| **F45** | Inline Floating Command Palette (`Cmd+K`) | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Contextual popover positioned at text selection bounds |
| **F46** | Viewport Boundary Clamping for Command Palette | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Clamps palette within 1584×1184 bounds and flips above selection near bottom |
| **F47** | AI Text Transformations (Summarize, Expand, Tone, Voice) | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Contextual transformation operations replace selection atomically |
| **F48** | Non-Modal Critique Mode Engine | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Background heuristic linting without blocking typing or frame drops |
| **F49** | Sol:OS Monochrome Dotted Underlines & Gutter Markers | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Underlines rendered with `--os-300` dotted styling; discreet gutter dots |
| **F50** | Heuristic Rule Suite for Passive Voice, Repetition, Structure | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Regex rules detect passive verbs, adjacent duplicate words, and wordy phrases |
| **F51** | Context-Aware Query Assistant | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Consults document content and margin notes with `[¶N]` paragraph citations |
| **F52** | AIServiceAdapter Pluggable Interface Contract | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Interface adherence: `streamContinuation`, `transformText`, `runCritiqueChecks`, `queryContext` |
| **F53** | Deterministic MockAIServiceAdapter | Tier 1 | `tier1-features/f42-f53-ai-affordances.test.ts` | Hermetic mock with canned fixtures, simulated latency, error injection |
| **F54** | CommonMark Markdown Export Pipeline (`.md`) | Tier 1 | `tier1-features/f54-f60-export-pipelines.test.ts` | Valid CommonMark with YAML frontmatter and margin notes appendix |
| **F55** | UTF-8 Plain Text Export Pipeline (`.txt`) | Tier 1 | `tier1-features/f54-f60-export-pipelines.test.ts` | Clean text banner with formatted margin notes reference section |
| **F56** | Client-Side OOXML Microsoft Word Export Pipeline (`.docx`) | Tier 1 | `tier1-features/f54-f60-export-pipelines.test.ts` | 100% offline OOXML ZIP generation with styled headings and notes table |
| **F57** | Client-Side Vector PDF Export Pipeline (`.pdf`) | Tier 1 | `tier1-features/f54-f60-export-pipelines.test.ts` | Paginated PDF with Sol:OS grayscale styling and `@media print` rules |
| **F58** | Native Web Share API Integration (`navigator.share`) | Tier 1 | `tier1-features/f54-f60-export-pipelines.test.ts` | Invokes device share sheet with exported file blob |
| **F59** | Native Email Composition Fallback (`mailto:`) | Tier 1, Tier 2 | `tier1-features/f54-f60-export-pipelines.test.ts`, `tier2-boundaries/mailto-uri-length-clamping.test.ts` | URI length clamped to 1800 characters to prevent browser crashes |
| **F60** | Multi-Format Export Automated Validation Suite | Tier 1 | `tier1-features/f54-f60-export-pipelines.test.ts` | Validates binary/text headers and structure across all 4 export formats |
| **F61** | Sol:OS Grayscale DOM Contrast Verification Script | Contrast | `tests/e2e/contrast-audit.test.ts` | Automated audit asserting `--os-0` to `--os-1000` tokens and WCAG AA/AAA |
| **F62** | E2E Test Suite Framework & Headless Harness | All Tiers | `tests/e2e/helpers/test-harness.ts` | Hermetic test harness configured for 1584×1184 DC1 viewport |
| **F63** | Tier 1 Feature Coverage E2E Tests | Tier 1 | `tests/e2e/tier1-features/*.test.ts` | >=5 isolated tests per feature group |
| **F64** | Tier 2 Boundary & Corner Case E2E Tests | Tier 2 | `tests/e2e/tier2-boundaries/*.test.ts` | Edge cases: empty/extreme doc, sentence boundaries, orphans, IME, sync |
| **F65** | Tier 3 Cross-Feature & Tier 4 Real-World E2E Tests | Tier 3, Tier 4 | `tests/e2e/tier3-combinations/*.test.ts`, `tests/e2e/tier4-scenarios/*.test.ts` | Pairwise interaction tests and realistic long-form authoring workloads |

---

## 3. Test Architecture & 4-Tier Structure

### Tier 1: Feature Coverage (`tests/e2e/tier1-features/`)
Tests each feature in isolation with representative inputs (>=5 test cases per feature module):
1. `f01-f03-solos-tokens-viewport.test.ts`: Sol:OS tokens, 1584×1184 landscape geometry, +8px inset, zero EPD refresh flags.
2. `f04-f07-typewriter-scroll.test.ts`: 720px column width, 592px midpoint caret tracking, rAF lerp, user scroll pause, IME keyboard offset.
3. `f08-f13-focus-markdown-titling.test.ts`: Paragraph focus, sentence focus (`Intl.Segmenter`), markdown live format, auto-title, manual override lock, date/time indicator.
4. `f14-f22-dual-drawers-margin.test.ts`: Left drawer (320px), date sort toggle, right drawer (360px), paragraph anchoring, 1:1 scroll sync, note stacking, orphan retention, zero-chrome dismissal shortcuts (`Esc`, `Cmd+[`, `Cmd+]`).
5. `f23-f32-sqlite-crud-search.test.ts`: SQLite schema DDL, reactive cache, 250ms debounced WAL write, emergency lifecycle flush, CRUD, tag parsing, sub-50ms fuzzy search.
6. `f33-f41-sync-queue-conflict.test.ts`: Mutation queueing, MockGoogleDocsSyncAdapter, conflict resolution with chronological integrity, online trigger, sync status indicators.
7. `f42-f53-ai-affordances.test.ts`: `+++` inline continuation, atomic `Cmd+Z` undo, `Cmd+K` palette geometry & actions, non-modal critique rules, query assistant with `[¶N]` citations, MockAIServiceAdapter.
8. `f54-f60-export-pipelines.test.ts`: `.md`, `.txt`, `.docx`, `.pdf` export serialization, Web Share API, `mailto:` composition.

### Tier 2: Boundary & Corner Cases (`tests/e2e/tier2-boundaries/`)
Exhaustive stress tests for edge conditions, limits, and resource constraints:
1. `empty-and-extreme-documents.test.ts`: 0-character empty doc, 1-character doc, 100,000+ words document, extreme titles (500+ chars), zero-height blocks.
2. `sentence-boundary-edge-cases.test.ts`: Abbreviations ("Dr. Smith", "e.g.", "i.e.", "vs."), decimals ("3.1415"), nested quotation marks, trailing ellipses, interrobangs ("?!").
3. `paragraph-deletion-margin-orphans.test.ts`: Bulk paragraph deletion with attached margin notes; retaining notes in orphan pool with intact timestamps and re-anchoring capability.
4. `viewport-ime-keyboard-recalibration.test.ts`: Viewport height shrinkage from 1184px down to 600px when IME opens, instantaneous recalculation of 50% midpoint to 300px.
5. `offline-disconnect-reconnect-conflicts.test.ts`: Rapid edits during complete network disconnection, mutation queue accumulation, reconnect with simulated server conflicts, clock skew handling.
6. `mailto-uri-length-clamping.test.ts`: Long document (>1800 chars) email fallback, truncating body with notice, title percent-encoding without URI overflow.

### Tier 3: Cross-Feature Interactions (`tests/e2e/tier3-combinations/`)
Pairwise combinations verifying that concurrent features do not interfere with each other:
1. `ai-continuation-typewriter-scroll.test.ts`: Streaming `+++` continuation while typewriter center-scrolling is active; asserts continuous 50% caret alignment during streaming and atomic `Cmd+Z` recovery.
2. `cmd-k-transforms-with-margin-notes.test.ts`: Executing `Cmd+K` transformations (summarize, expand, tone) on text containing attached margin notes; asserts paragraph anchor IDs remain intact.
3. `export-with-focus-mode-and-tags.test.ts`: Generating `.docx`, `.pdf`, `.md`, and `.txt` while sentence focus mode is active and nested tags (`#book/draft`) are applied; asserts un-dimmed text and complete metadata.
4. `tag-search-during-sync-reconciliation.test.ts`: Running instant fuzzy search and tag queries concurrently with background offline sync queue reconciliation.

### Tier 4: Real-World Scenarios (`tests/e2e/tier4-scenarios/`)
Realistic, multi-step authoring workflows replicating authentic Daylight Computer user sessions:
1. `book-chapter-authoring-session.test.ts`: Distraction-free book chapter workflow: creating a new document, auto-titling from the opening phrase, authoring three chapter sections, creating margin thoughts on key arguments, enabling sentence focus mode, dismissing all drawers into zero-chrome view, triggering `+++` continuation, and exporting to `.md` and `.docx`.
2. `research-essay-tagging-export.test.ts`: Academic writing workflow: organizing with hierarchical tags (`#research/fieldwork`, `#methodology/interviews`), running critique checks for passive voice and wordiness, transforming a complex paragraph with `Cmd+K`, consulting the query assistant over text + margin thoughts, and generating vector `.pdf`.

---

## 4. Sol:OS Grayscale Contrast Verification Infrastructure

The DC1 utilizes a custom Sharp reflective LCD (LivePaper). Legibility requires strict adherence to calibrated grayscale tokens and WCAG 2.1 standards.

### 4.1 Contrast Calculation Formula
- Relative Luminance ($L$):
  $$L = 0.2126 \cdot R + 0.7152 \cdot G + 0.0722 \cdot B$$
  where each color channel $C \in \{R, G, B\}$ is converted from sRGB:
  $$C = \begin{cases} \frac{c}{12.92} & \text{if } c \le 0.03928 \\ \left(\frac{c + 0.055}{1.055}\right)^{2.4} & \text{if } c > 0.03928 \end{cases} \quad (c = C_{\text{8bit}} / 255)$$
- Contrast Ratio ($CR$):
  $$CR = \frac{L_1 + 0.05}{L_2 + 0.05} \quad (L_1 > L_2)$$

### 4.2 Compliance Thresholds
1. **WCAG 2.1 AA**:
   - Normal text: $\ge 4.5:1$
   - Large text ($\ge 18\text{pt}$ or $\ge 14\text{pt}$ bold) & UI elements: $\ge 3.0:1$
2. **WCAG 2.1 AAA**:
   - Normal text: $\ge 7.0:1$
   - Large text: $\ge 4.5:1$
3. **Monochrome Purity**:
   - Max channel difference: $\max(|R - G|, |R - B|, |G - B|) \le 14$ (permitting warm hairline borders `--os-100` `#DCD5C9`).
   - Rejects any saturated chromatic colors (blue, red, green).

---

## 5. Execution Commands & Verification Matrix

### Execution Commands
```bash
# Run all E2E tests across all 4 tiers (using native Node 26 TypeScript engine)
npm run test:e2e
# or
node --experimental-strip-types --test 'tests/e2e/**/*.test.ts'

# Run individual tiers
npm run test:tier1    # Tier 1: Feature Coverage (F01–F60)
npm run test:tier2    # Tier 2: Boundary & Corner Cases
npm run test:tier3    # Tier 3: Cross-Feature Interactions
npm run test:tier4    # Tier 4: Real-World Scenarios
npm run test:contrast # Sol:OS Grayscale Contrast Audit
```

### Coverage Thresholds & Quality Gates
- **Tier 1 Pass Rate**: 100% (All isolated feature paths pass).
- **Tier 2 Pass Rate**: 100% (All edge cases, limits, and extreme inputs handled gracefully).
- **Tier 3 Pass Rate**: 100% (No cross-feature regressions or state corruptions).
- **Tier 4 Pass Rate**: 100% (Complete real-world workflows complete end-to-end).
- **Contrast Violations**: 0 (Zero chromatic colors, 100% WCAG AA compliance against background).
