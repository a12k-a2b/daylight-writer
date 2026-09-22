# Project: Daylight Writer

## Architecture
Daylight Writer is a distraction-free, landscape typewriter Progressive Web Application tailored specifically for the 10.5" 4:3 LivePaper display on the Daylight Computer (DC1) (1584×1184 landscape viewport).

### Hardware & Display Profile Specification
- **Hardware Platform**: Daylight Computer (DC1) running Sol:OS (VExt jagar).
- **Physical & Logical Dimensions**: 10.5" 4:3 display (1600×1200 physical with +8px inset -> 1584×1184 active logical landscape).
- **Display Technology**: Sharp Custom Reflective / Transflective LCD (LivePaper).
- **Refresh Rate**: Native 60Hz to 120Hz (silky smooth, full fluid framerate, <16ms input latency).
- **Color Depth**: 8-bit Grayscale (256 discrete levels of gray, monochrome).
- **Zero EPD Artifacts**: NO waveforms, NO particle flashes, NO `ACTION_REFRESH_SCREEN` hooks, NO artificial refresh pauses. Driven by standard GPU Skia/HWUI composition.
- **Sol:OS Design Token Neutral Palette**:
  - `--os-0`: `#FFFFFF` (Base paper ground)
  - `--os-50`: `#F7F7F7` (Surface panels, cards, drawer background)
  - `--os-100`: `rgba(0,0,0,0.08)` / `#DCD5C9` (Hairline borders)
  - `--os-150`: `#F5F5F5` (Recessed canvas)
  - `--os-200`: `#CCCCCC` (Disabled text, leader lines)
  - `--os-300`: `#858585` (Low-emphasis inactive text, critique underlines)
  - `--os-400`: `#535353` (Secondary text ink)
  - `--os-800`: `#343434` (Dark fields, pressed states, selection)
  - `--os-900`: `#1A1A1A` (Primary text ink, headlines)
  - `--os-1000`: `#000000` (Max black ink)

### Module Boundaries & Data Flow
1. **Presentation & Viewport Shell**:
   - Manages the 1584×1184 landscape viewport, zero-chrome typewriter view, and dual sliding drawers.
   - Central column: 720px width (65–75 CPL) centered horizontally when drawers are dismissed.
   - Left Drawer: 320px width for Document Library, nested tag filter, and instant search.
   - Right Drawer: 360px width for Thought Margin scratchpad notes.
2. **Editor & Focus Mode Engine**:
   - Typewriter center-scrolling: Active caret strictly maintained at 50% viewport height (592px midpoint) via `calc(50vh - 1.5em)` padding and smoothed rAF lerp.
   - Focus modes: Sentence and paragraph focus using `Intl.Segmenter` (active block at `--os-900`/`--os-1000`, surrounding text dimmed to `--os-300`/`--os-200`).
   - Markdown formatting: Real-time syntax conversion without cursor jumping.
   - Auto-titling: Opening phrase auto-extracted with explicit manual title override lock.
3. **Synchronized Margin Scratchpad Engine**:
   - Notes anchored by paragraph ID.
   - Right drawer scroll position mirrors editor container `scrollTop`.
   - Notes positioned with `top: var(--anchor-top)px` matching paragraph `offsetTop`, with collision offset stacking and leader lines.
4. **Local-First SQLite Persistence Engine**:
   - wa-sqlite with Web Worker OPFS `AccessHandlePoolVFS` + `IDBBatchAtomicVFS` fallback + `MemoryVFS` for tests.
   - In-memory reactive write-ahead cache (0ms input lag) + 250ms debounced WAL commits + synchronous flush on lifecycle events (`beforeunload`, `visibilitychange`, `pagehide`, blur, `Cmd+S`).
   - PowerSync-ready schema (`documents`, `margin_notes`, `tags`, `document_tags`, `sync_queue`, `documents_fts`).
   - Sub-50ms fuzzy search (<3ms benchmark) across title, body, and nested tags (`#project/drafts`).
5. **AI Affordances Service Layer**:
   - `AIServiceAdapter` interface with deterministic `MockAIServiceAdapter`.
   - Inline continuation `+++` with atomic single-step `Cmd+Z` undo/redo transactions.
   - Inline command palette `Cmd+K` with boundary clamping and text transforms.
   - Non-modal critique checks with `--os-300` dotted underlines and heuristic rules.
   - Context query assistant over document + margin notes.
6. **Sync & Export Pipelines**:
   - `SyncAdapter` interface with deterministic `MockGoogleDocsSyncAdapter`.
   - Offline mutation queueing with chronological reconciliation.
   - 100% client-side multi-format export to `.md`, `.txt`, `.docx` (OOXML zip), and `.pdf`.
   - Web Share API & `mailto:` composition hooks.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Sol:OS 8-bit Grayscale CSS Token System | Complete CSS variables `--os-0` to `--os-1000` matching Daylight profile | M1 | Survey 1 |
| F02 | DC1 10.5" 1584x1184 Landscape Viewport Shell | Responsive container configured for active LivePaper dimensions | M1 | Survey 1 |
| F03 | Fluid 60-120fps Animation Standards | Smooth transitions, zero EPD waveforms/flashing hooks | M1 | Survey 1 |
| F04 | Distraction-Free Typewriter Editor Container | Centered 720px 65-75 CPL writing column with distraction-free layout | M2 | Survey 1 |
| F05 | Typewriter Vertical Center-Scrolling Engine | Active cursor maintained vertically at 592px midpoint (50vh) | M2 | Survey 1 |
| F06 | Smooth rAF Lerp Scrolling & User Scroll Suspension | Continuous 60fps tracking without jitter; pause tracking on manual wheel/touch | M2 | Survey 1 |
| F07 | Virtual Keyboard (IME) Dynamic Midpoint Recalibration | Dynamic center target recalculation when onscreen keyboard changes innerHeight | M2 | Survey 1 |
| F08 | iA Writer Paragraph Focus Mode | Dims inactive paragraphs to `--os-300`, active paragraph at `--os-900` | M2 | Survey 1 |
| F09 | iA Writer Sentence Focus Mode via Intl.Segmenter | Accurate sentence segmentation; dims inactive sentences, active at `--os-1000` | M2 | Survey 1 |
| F10 | Real-Time Markdown Syntax Formatting | Real-time headings, bold, italic, lists without caret jumping | M2 | Survey 1 |
| F11 | Dynamic Auto-Titling Derived From Opening Phrase | Automatically titles document from first heading/sentence | M2 | Survey 1 |
| F12 | Manual Title Override Lock | Protects user-customized title against auto-title overwrite | M2 | Survey 1 |
| F13 | Discreet Top-Corner Live Date/Time Indicator | Minimalist Sol:OS date/time indicator in top-right corner | M2 | Survey 1 |
| F14 | Single-Keystroke & Touch Zero-Chrome Dismissal | Restores 100% full-width editor via `Esc`, `Cmd+[`, `Cmd+]`, or backdrop tap | M3 | Survey 1 |
| F15 | Left Drawer Layout & Slide Animation | 320px navigation drawer for document library and search | M3 | Survey 1 |
| F16 | Document Library Date Sorting | Toggle between Last Modified and Date Created sort orders | M3 | Survey 1 |
| F17 | Right Drawer Thought Margin Layout & Animation | 360px margin drawer for anchored thought notes | M3 | Survey 1 |
| F18 | Thought Note Creation Anchored to Paragraph ID | Binds thought notes to specific paragraph elements | M3 | Survey 1 |
| F19 | Synchronous Spatial Scroll Tracking for Margin Notes | Right drawer notes scroll in 1:1 sync with target paragraph Y-offsets | M3 | Survey 1 |
| F20 | Margin Note Stacking & Hairline Leader Lines | Non-destructive vertical stacking when notes collide, with `--os-200` leader lines | M3 | Survey 1 |
| F21 | Orphaned Thought Note Retention | Gracefully handles notes when target paragraph is deleted | M3 | Survey 1 |
| F22 | Drawer Backdrop Light-Dismiss & Keyboard Shortcuts | Modal/drawer dismissal triggers on outside touch or keyboard event | M3 | Survey 1 |
| F23 | Multi-Tier wa-sqlite Web Worker Storage Engine | OPFS AccessHandlePoolVFS + IDB fallback + MemoryVFS for test suite | M1 | Survey 2 |
| F24 | PowerSync-Ready Schema DDL & Migrations | Relational tables for documents, margin_notes, tags, sync_queue, fts | M1 | Survey 2 |
| F25 | In-Memory Reactive Cache with Debounced WAL Disk Flush | 0ms typing response + 250ms debounced SQLite WAL commits | M1 | Survey 2 |
| F26 | Emergency Synchronous Disk Flush on Page Lifecycle | Flushes pending edits on `beforeunload`, `visibilitychange`, `pagehide`, blur | M1 | Survey 2 |
| F27 | Document CRUD Repository Operations | Create, read, update, delete, list documents with soft deletes | M1 | Survey 2 |
| F28 | Margin Note CRUD & Paragraph Association Engine | Create, read, update, delete margin notes bound to document paragraphs | M1 | Survey 2 |
| F29 | Hierarchical Nested Tag Parser | Parses `#category/subcategory` syntax and builds hierarchical tag paths | M1 | Survey 2 |
| F30 | Document-Tag Association Management | Many-to-many relationship linking documents and hierarchical tags | M1 | Survey 2 |
| F31 | Sub-50ms Fuzzy Search Engine | High-performance fuzzy matching across title, body, and tags (<3ms) | M1 | Survey 2 |
| F32 | Nested Tag Tree Browser Query Support | Queries documents by tag prefix or nested taxonomy | M3 | Survey 2 |
| F33 | Offline Mutation Queueing Engine | Queues local mutations with retry count, timestamps, and payload | M5 | Survey 2 |
| F34 | SyncAdapter Pluggable Interface Contract | Formal interface for push, pull, sync, conflict resolution | M5 | Survey 2 |
| F35 | MockGoogleDocsSyncAdapter with Deterministic Simulation | Hermetic mock adapter simulating latency, conflicts, and network disconnect | M5 | Survey 2 |
| F36 | Two-Way Sync Conflict Resolution with Chronological Integrity | Preserves chronological integrity without silent overwrites | M5 | Survey 2 |
| F37 | Network Connectivity Listener & Automatic Sync Trigger | Detects online/offline status and triggers sync on reconnect | M5 | Survey 2 |
| F38 | Sync Status State Machine & UI Indicator | Minimalist sync indicator (synced, syncing, offline, error) in Sol:OS tokens | M5 | Survey 2 |
| F39 | Soft Delete & Tombstone Synchronization Support | Soft deletion tracking via `deleted_at` timestamps for safe replication | M1 | Survey 2 |
| F40 | Database Export & Snapshot Backup Hook | Allows export and restore of the SQLite database binary | M1 | Survey 2 |
| F41 | Search Query Tokenizer & Multi-Attribute Scorer | Weighted scoring for title, tag, and body matches | M1 | Survey 2 |
| F42 | Inline Continuation Trigger Detection (`+++`) | Detects `+++` keystrokes at cursor and triggers AI continuation | M4 | Survey 3 |
| F43 | Streaming Text Continuation Simulation & Injection | Streams generated tokens directly into editor buffer | M4 | Survey 3 |
| F44 | Atomic Single-Step Undo/Redo (`Cmd+Z`) for AI Continuation | Erases entire AI generation in a single `Cmd+Z` keystroke | M4 | Survey 3 |
| F45 | Inline Floating Command Palette (`Cmd+K`) | Lightweight contextual command bar positioned at selection | M4 | Survey 3 |
| F46 | Viewport Boundary Clamping for Command Palette | Clamps palette inside 1584×1184 viewport bounds | M4 | Survey 3 |
| F47 | AI Text Transformations (Summarize, Expand, Tone, Voice) | Contextual text modification operations | M4 | Survey 3 |
| F48 | Non-Modal Critique Mode Engine | Background heuristic linting without blocking typing | M4 | Survey 3 |
| F49 | Sol:OS Monochrome Dotted Underlines & Gutter Markers | Displays critique cues using `--os-300` dotted underlines | M4 | Survey 3 |
| F50 | Heuristic Rule Suite for Passive Voice, Repetition, Structure | High-speed regex checks for common writing issues | M4 | Survey 3 |
| F51 | Context-Aware Query Assistant | Queries document text + linked margin notes for contextual answers | M4 | Survey 3 |
| F52 | AIServiceAdapter Pluggable Interface Contract | Formal interface for continuation, transformation, critique, query | M4 | Survey 3 |
| F53 | Deterministic MockAIServiceAdapter | Configurable mock with canned responses and latency simulation | M4 | Survey 3 |
| F54 | CommonMark Markdown Export Pipeline (`.md`) | Exports document with frontmatter and margin notes appendix | M5 | Survey 3 |
| F55 | UTF-8 Plain Text Export Pipeline (`.txt`) | Exports clean plain text with formatted notes | M5 | Survey 3 |
| F56 | Client-Side OOXML Microsoft Word Export Pipeline (`.docx`) | 100% offline `.docx` generation with styled headings and notes table | M5 | Survey 3 |
| F57 | Client-Side Vector PDF Export Pipeline & Print Stylesheet (`.pdf`) | Generates paginated PDF with Sol:OS grayscale styling | M5 | Survey 3 |
| F58 | Native Web Share API Integration (`navigator.share`) | Invokes device share sheet for files and text | M5 | Survey 3 |
| F59 | Native Email Composition Fallback (`mailto:`) | Launches default email client with safe body length clamping | M5 | Survey 3 |
| F60 | Multi-Format Export Automated Validation Suite | Automated tests verifying valid structure and content for all export formats | M5 | Survey 3 |
| F61 | Sol:OS Grayscale DOM Contrast Verification Script | Programmatic audit verifying DOM elements comply with Sol:OS tokens & WCAG AA/AAA | M6 | Survey 3 |
| F62 | E2E Test Suite Framework & Headless Browser Harness | Test runner and harness for comprehensive end-to-end testing | E2E Track | Survey 3 |
| F63 | Tier 1 Feature Coverage E2E Tests | >=5 test cases per feature covering normal execution paths | E2E Track / M6 | Survey 3 |
| F64 | Tier 2 Boundary & Corner Case E2E Tests | Boundary value analysis and edge cases per feature | E2E Track / M6 | Survey 3 |
| F65 | Tier 3 Cross-Feature & Tier 4 Real-World Application E2E Tests | Pairwise feature interaction and realistic writing workload tests | E2E Track / M6 | Survey 3 |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Independent Opaque-Box Test Suite (Tiers 1-4, Test Infra, TEST_READY.md) | none | DONE |
| M1 | Foundation, Sol:OS Design Tokens & Storage Engine | Project scaffold, Sol:OS tokens, wa-sqlite multi-tier VFS, PowerSync DDL, CRUD repository, fuzzy search | none | DONE |
| M2 | LivePaper Canvas, Typewriter Scrolling & Focus Modes | Distraction-free 1584×1184 canvas, typewriter center-scrolling (592px), iA Writer sentence/paragraph focus, markdown auto-format, auto-titling | M1 | DONE |
| M3 | Dual Synchronized Drawers | Left drawer (library, date sort, fuzzy search UI, nested tags), Right drawer (thought margin, strict Y-coord scroll sync, note stacking), zero-chrome dismissal | M1, M2 | DONE |
| M4 | Lex-Inspired AI Affordances & Pluggable Service Layer | AIServiceAdapter, MockAIServiceAdapter, `+++` inline continuation with atomic undo, `Cmd+K` palette, non-modal critique mode, query assistant | M1, M2, M3 | DONE |
| M5 | Pluggable Offline Sync & Multi-Format Export Pipeline | SyncAdapter, MockGoogleDocsSyncAdapter, offline queueing, .md/.txt/.docx/.pdf export, Web Share & mailto | M1, M2, M3, M4 | DONE |
| M6 | Final Milestone: 100% E2E Test Pass & Adversarial Hardening | Phase 1: Pass 100% E2E test suite (Tiers 1-4). Phase 2: Tier 5 Adversarial coverage hardening & Sol:OS contrast verification | E2E, M1-M5 | DONE |

---

## Interface Contracts

### 1. Storage Engine ↔ Editor & Drawers
```typescript
export interface DocumentRecord {
  id: string;
  title: string;
  content: string;
  created_at: number; // UTC ms
  updated_at: number; // UTC ms
  deleted_at: number | null;
  is_title_custom: boolean;
  format_version: number;
  sync_status: 'synced' | 'pending' | 'conflict' | 'error';
}

export interface ThoughtNoteRecord {
  id: string;
  document_id: string;
  paragraph_anchor_id: string;
  content: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface TagRecord {
  id: string;
  name: string;
  path: string; // e.g. "project/drafts"
  created_at: number;
}

export interface StorageRepository {
  init(): Promise<void>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  listDocuments(options?: { sortBy?: 'updated_at' | 'created_at'; sortOrder?: 'asc' | 'desc'; tagId?: string }): Promise<DocumentRecord[]>;
  saveDocument(doc: Partial<DocumentRecord> & { id: string }): Promise<DocumentRecord>;
  deleteDocument(id: string): Promise<void>;
  flushPendingEdits(): Promise<void>;
  
  getNotesForDocument(documentId: string): Promise<ThoughtNoteRecord[]>;
  saveNote(note: Partial<ThoughtNoteRecord> & { id: string; document_id: string; paragraph_anchor_id: string }): Promise<ThoughtNoteRecord>;
  deleteNote(id: string): Promise<void>;
  
  searchDocuments(query: string): Promise<Array<{ document: DocumentRecord; score: number; matchHighlights: string[] }>>;
  getTags(): Promise<TagRecord[]>;
  setDocumentTags(documentId: string, tags: string[]): Promise<void>;
}
```

### 2. AIServiceAdapter ↔ Editor & Assistant
```typescript
export interface AIContinuationOptions {
  documentText: string;
  cursorOffset: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface AITransformOptions {
  selectedText: string;
  instruction: 'summarize' | 'expand' | 'concise' | 'poetic' | 'analytical' | 'casual' | 'fix_grammar';
  surroundingContext?: string;
}

export interface AICritiqueCheck {
  id: string;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  type: 'passive_voice' | 'repetition' | 'clarity' | 'structure';
  message: string;
  suggestion?: string;
}

export interface AIServiceAdapter {
  streamContinuation(options: AIContinuationOptions, onChunk: (chunk: string) => void): Promise<string>;
  transformText(options: AITransformOptions): Promise<string>;
  runCritiqueChecks(text: string): Promise<AICritiqueCheck[]>;
  queryContext(prompt: string, documentText: string, notes: ThoughtNoteRecord[]): Promise<string>;
}
```

### 3. SyncAdapter ↔ Storage Engine
```typescript
export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncedAt: number | null;
  pendingCount: number;
  error?: string;
}

export interface SyncAdapter {
  init(): Promise<void>;
  sync(): Promise<{ pushedCount: number; pulledCount: number }>;
  getStatus(): SyncStatus;
  resolveConflict(localDoc: DocumentRecord, remoteDoc: DocumentRecord): Promise<DocumentRecord>;
}
```

### 4. Export Service ↔ Application
```typescript
export interface ExportResult {
  filename: string;
  mimeType: string;
  data: Uint8Array | string;
}

export interface ExportService {
  exportToMarkdown(doc: DocumentRecord, notes: ThoughtNoteRecord[]): ExportResult;
  exportToPlainText(doc: DocumentRecord, notes: ThoughtNoteRecord[]): ExportResult;
  exportToDocx(doc: DocumentRecord, notes: ThoughtNoteRecord[]): Promise<ExportResult>;
  exportToPdf(doc: DocumentRecord, notes: ThoughtNoteRecord[]): Promise<ExportResult>;
  shareDocument(doc: DocumentRecord, format: 'md' | 'txt' | 'docx' | 'pdf'): Promise<boolean>;
  composeEmail(doc: DocumentRecord): void;
}
```

---

## Code Layout
```
/Users/anjan/teamwork_projects/daylight_writer/
├── index.html                   # PWA HTML shell with 1584x1184 viewport meta
├── manifest.webmanifest         # PWA Manifest (landscape, standalone)
├── package.json                 # Project dependencies and test scripts
├── tsconfig.json                # TypeScript strict configuration
├── vite.config.ts               # Vite configuration with workers and PWA support
├── vitest.config.ts             # Vitest configuration for unit, integration, and E2E
├── public/                      # Static assets and icons
│   ├── favicon.ico
│   └── icons/
├── src/
│   ├── main.ts                  # Application bootstrap
│   ├── styles/
│   │   ├── tokens.css           # Official Daylight Sol:OS tokens (--os-0 to --os-1000)
│   │   ├── reset.css            # Base styles and fluid typography
│   │   └── main.css             # Viewport layout and drawer animations
│   ├── storage/
│   │   ├── schema.ts            # PowerSync-ready SQLite DDL definitions
│   │   ├── sqlite-vfs.ts        # wa-sqlite OPFS/IDB/Memory VFS factory
│   │   ├── repository.ts        # StorageRepository implementation with WAL flush
│   │   └── search.ts            # Sub-50ms fuzzy search & tag hierarchy parser
│   ├── editor/
│   │   ├── editor.ts            # Core typewriter editor with center-scrolling
│   │   ├── focus-mode.ts        # Sentence and paragraph focus engine via Intl.Segmenter
│   │   ├── markdown-rules.ts    # Real-time Markdown syntax formatting
│   │   ├── auto-title.ts        # Opening phrase extractor with override lock
│   │   └── history.ts           # Undo/Redo transaction manager (Cmd+Z)
│   ├── drawers/
│   │   ├── left-library.ts      # Left drawer: document list, sort, search, tags
│   │   ├── right-margin.ts      # Right drawer: thought margin scratchpad
│   │   └── sync-scroll.ts       # Coordinate spatial synchronization engine
│   ├── ai/
│   │   ├── ai-adapter.ts        # AIServiceAdapter interface & factory
│   │   ├── mock-ai-adapter.ts   # Deterministic MockAIServiceAdapter
│   │   ├── inline-continue.ts   # +++ continuation trigger & streaming
│   │   ├── command-palette.ts   # Cmd+K floating command palette
│   │   ├── critique-engine.ts   # Non-modal critique mode with --os-300 dotted underlines
│   │   └── query-assistant.ts   # Context-aware query assistant
│   ├── sync/
│   │   ├── sync-adapter.ts      # SyncAdapter interface & queue manager
│   │   ├── mock-sync-adapter.ts # Deterministic MockGoogleDocsSyncAdapter
│   │   └── network-listener.ts  # Online/offline state detector
│   ├── export/
│   │   ├── export-service.ts    # Multi-format export coordinator & Web Share
│   │   ├── md-exporter.ts       # Markdown serializer with frontmatter & notes
│   │   ├── txt-exporter.ts      # Plain text serializer
│   │   ├── docx-exporter.ts     # Client-side OOXML package generator
│   │   └── pdf-exporter.ts      # PDF generator & print CSS
│   └── utils/
│       ├── contrast-audit.ts    # Sol:OS computed DOM contrast auditor script
│       └── datetime.ts          # Minimalist live date/time formatter
├── tests/
│   ├── setup.ts                 # Test environment setup (DOM & mock storage)
│   ├── unit/                    # Unit tests for storage, search, serializers, AI
│   ├── integration/             # Integration tests for focus mode, scroll, sync
│   └── e2e/                     # End-to-end automated tests (Tiers 1-4)
│       ├── tier1-features/
│       ├── tier2-boundaries/
│       ├── tier3-combinations/
│       └── tier4-scenarios/
└── .agents/                     # Coordination metadata
```
