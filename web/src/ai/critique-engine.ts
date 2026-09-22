/**
 * src/ai/critique-engine.ts
 * Daylight Writer - Non-Modal Critique Engine & Offline Heuristic Suite
 * Optimized for Daylight Computer (DC1) 10.5" LivePaper Display (1584×1184 landscape)
 * Strictly adheres to Sol:OS 8-bit Grayscale Tokens (--os-0 to --os-1000)
 * Features: F48 (Non-Modal Engine), F49 (Underlines & Gutter Dots), F50 (Rule Suite)
 */

import type { TypewriterEditor } from '../editor/editor.ts';
import type { HistoryManager } from '../editor/history.ts';

export type CritiqueIssueType = 'passive_voice' | 'repetition' | 'clarity' | 'structure';

export interface AICritiqueCheck {
  id: string;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  type: CritiqueIssueType;
  message: string;
  suggestion?: string;
  matchedText?: string;
}

export interface CritiqueRule {
  id: string;
  name: string;
  type: CritiqueIssueType;
  execute(text: string, paragraphIndex: number): AICritiqueCheck[];
}

// ----------------------------------------------------------------------------
// 1. Offline Heuristic Rules (F50)
// ----------------------------------------------------------------------------

/**
 * Passive Voice Rule: Flags "to be" + past participle constructions
 */
export const PassiveVoiceRule: CritiqueRule = {
  id: 'rule-passive-voice',
  name: 'Passive Voice',
  type: 'passive_voice',
  execute(text: string, paragraphIndex: number): AICritiqueCheck[] {
    const checks: AICritiqueCheck[] = [];
    const regex = /\b(was|were|is|are|been|being)\s+(?:(\w+ly)\s+)?(\w+ed|written|taken|chosen|seen|observed|analyzed|conducted|discovered|found|built|given|made|held)\b/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const matched = match[0];
      checks.push({
        id: `pv-${paragraphIndex}-${match.index}`,
        paragraphIndex,
        startOffset: match.index,
        endOffset: match.index + matched.length,
        type: 'passive_voice',
        message: `Passive construction "${matched}". Consider active voice.`,
        suggestion: 'active phrasing',
        matchedText: matched,
      });
    }

    return checks;
  },
};

/**
 * Clarity & Wordiness Rule: Flags bloated phrases & clichés
 */
export const ClarityWordinessRule: CritiqueRule = {
  id: 'rule-clarity',
  name: 'Clarity & Wordiness',
  type: 'clarity',
  execute(text: string, paragraphIndex: number): AICritiqueCheck[] {
    const checks: AICritiqueCheck[] = [];
    const phraseMap: Array<{ pattern: RegExp; suggestion: string; message: string }> = [
      {
        pattern: /\bin order to\b/gi,
        suggestion: 'to',
        message: 'Wordy phrase "in order to". Use "to" instead.',
      },
      {
        pattern: /\bat the end of the day\b/gi,
        suggestion: 'ultimately',
        message: 'Cliché "at the end of the day". Use "ultimately".',
      },
      {
        pattern: /\bneedless to say\b/gi,
        suggestion: '',
        message: 'Filler phrase "needless to say". Omit for conciseness.',
      },
      {
        pattern: /\bdue to the fact that\b/gi,
        suggestion: 'because',
        message: 'Wordy phrase "due to the fact that". Use "because".',
      },
      {
        pattern: /\bfor the purpose of\b/gi,
        suggestion: 'to',
        message: 'Wordy phrase "for the purpose of". Use "to".',
      },
      {
        pattern: /\bwith the exception of\b/gi,
        suggestion: 'except',
        message: 'Wordy phrase "with the exception of". Use "except".',
      },
      {
        pattern: /\bin spite of the fact that\b/gi,
        suggestion: 'although',
        message: 'Wordy phrase "in spite of the fact that". Use "although".',
      },
      {
        pattern: /\bas a matter of fact\b/gi,
        suggestion: 'in fact',
        message: 'Wordy phrase "as a matter of fact". Use "in fact".',
      },
      {
        pattern: /\bfirst and foremost\b/gi,
        suggestion: 'first',
        message: 'Wordy cliché "first and foremost". Use "first".',
      },
      {
        pattern: /\ba large number of\b/gi,
        suggestion: 'many',
        message: 'Wordy phrase "a large number of". Use "many".',
      },
      {
        pattern: /\ba majority of\b/gi,
        suggestion: 'most',
        message: 'Wordy phrase "a majority of". Use "most".',
      },
    ];

    for (const item of phraseMap) {
      let match: RegExpExecArray | null;
      while ((match = item.pattern.exec(text)) !== null) {
        checks.push({
          id: `clr-${paragraphIndex}-${match.index}`,
          paragraphIndex,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
          type: 'clarity',
          message: item.message,
          suggestion: item.suggestion,
          matchedText: match[0],
        });
      }
    }

    return checks;
  },
};

/**
 * Repetition Rule: Flags adjacent duplicate words and excessive adverbs
 */
export const RepetitionRule: CritiqueRule = {
  id: 'rule-repetition',
  name: 'Repetition',
  type: 'repetition',
  execute(text: string, paragraphIndex: number): AICritiqueCheck[] {
    const checks: AICritiqueCheck[] = [];

    // Adjacent duplicate words (e.g. "the the")
    const dupRegex = /\b([a-zA-Z]+)\s+\1\b/gi;
    let match: RegExpExecArray | null;
    while ((match = dupRegex.exec(text)) !== null) {
      checks.push({
        id: `rep-${paragraphIndex}-${match.index}`,
        paragraphIndex,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        type: 'repetition',
        message: `Repeated word "${match[1]}".`,
        suggestion: match[1],
        matchedText: match[0],
      });
    }

    return checks;
  },
};

/**
 * Sentence Complexity Rule: Flags overly long runaway sentences
 */
export const ComplexityRule: CritiqueRule = {
  id: 'rule-complexity',
  name: 'Sentence Complexity',
  type: 'structure',
  execute(text: string, paragraphIndex: number): AICritiqueCheck[] {
    const checks: AICritiqueCheck[] = [];
    const sentenceRegex = /[^.!?]+[.!?]*/g;
    let match: RegExpExecArray | null;

    while ((match = sentenceRegex.exec(text)) !== null) {
      const sentence = match[0].trim();
      const words = sentence.split(/\s+/).filter(Boolean);
      const hasInternalPunctuation = /[,;:\-—]/.test(sentence);

      // Warning if >35 words without comma/semicolon or >45 words total
      if ((words.length > 35 && !hasInternalPunctuation) || words.length > 45) {
        checks.push({
          id: `cplx-${paragraphIndex}-${match.index}`,
          paragraphIndex,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
          type: 'structure',
          message: `Complex sentence (${words.length} words). Consider breaking into shorter sentences.`,
          suggestion: 'Split into shorter sentences',
          matchedText: match[0],
        });
      }
    }

    return checks;
  },
};

export const DEFAULT_CRITIQUE_RULES: CritiqueRule[] = [
  PassiveVoiceRule,
  ClarityWordinessRule,
  RepetitionRule,
  ComplexityRule,
];

// ----------------------------------------------------------------------------
// 2. Headless Heuristic Analyzer
// ----------------------------------------------------------------------------

export class CritiqueAnalyzer {
  public rules: CritiqueRule[];

  constructor(rules: CritiqueRule[] = DEFAULT_CRITIQUE_RULES) {
    this.rules = rules;
  }

  public analyzeText(text: string, paragraphIndex: number = 0): AICritiqueCheck[] {
    const checks: AICritiqueCheck[] = [];
    for (const rule of this.rules) {
      checks.push(...rule.execute(text, paragraphIndex));
    }
    checks.sort((a, b) => a.startOffset - b.startOffset);
    return checks;
  }

  public analyzeParagraphs(paragraphs: string[]): Map<number, AICritiqueCheck[]> {
    const resultMap = new Map<number, AICritiqueCheck[]>();
    paragraphs.forEach((para, idx) => {
      const paraChecks: AICritiqueCheck[] = [];
      for (const rule of this.rules) {
        paraChecks.push(...rule.execute(para, idx));
      }
      paraChecks.sort((a, b) => a.startOffset - b.startOffset);
      resultMap.set(idx, paraChecks);
    });
    return resultMap;
  }
}

// ----------------------------------------------------------------------------
// 3. Interactive UI Controller (F48, F49)
// ----------------------------------------------------------------------------

export interface CritiqueUIOptions {
  editor: TypewriterEditor;
  history: HistoryManager;
  debounceMs?: number;
  rules?: CritiqueRule[];
}

export class CritiqueEngine {
  public analyzer: CritiqueAnalyzer;
  public editor: TypewriterEditor;
  public history: HistoryManager;
  public isEnabled: boolean = true;
  public debounceMs: number;

  public currentChecks: AICritiqueCheck[] = [];
  private dismissedIds: Set<string> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  public tooltipHideTimeout: ReturnType<typeof setTimeout> | null = null;
  public activeTooltipEl: HTMLElement | null = null;
  public gutterMarkers: HTMLElement[] = [];
  private cleanupListeners: Array<() => void> = [];

  constructor(options: CritiqueUIOptions) {
    this.editor = options.editor;
    this.history = options.history;
    this.debounceMs = options.debounceMs ?? 400;
    this.analyzer = new CritiqueAnalyzer(options.rules ?? DEFAULT_CRITIQUE_RULES);
  }

  public init(): void {
    this.bindEditorEvents();
    this.scheduleEvaluation();
  }

  public destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.tooltipHideTimeout) clearTimeout(this.tooltipHideTimeout);
    this.hideTooltip();
    this.clearGutterMarkers();
    this.clearInlineHighlights();
    for (const cleanup of this.cleanupListeners) {
      cleanup();
    }
    this.cleanupListeners = [];
  }

  public toggle(): boolean {
    this.isEnabled = !this.isEnabled;
    if (!this.isEnabled) {
      this.hideTooltip();
      this.clearGutterMarkers();
      this.clearInlineHighlights();
    } else {
      this.scheduleEvaluation();
    }
    return this.isEnabled;
  }

  public runChecks(text: string): AICritiqueCheck[] {
    return this.analyzer.analyzeText(text).filter((c) => !this.dismissedIds.has(c.id));
  }

  public scheduleEvaluation(): void {
    if (!this.isEnabled) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.evaluateDocument();
    }, this.debounceMs);
  }

  public evaluateDocument(): void {
    if (!this.editor?.canvas) {
      const content = this.editor ? this.editor.getContent() : '';
      this.currentChecks = this.runChecks(content);
      return;
    }
    this.renderGutterMarkers();
  }

  // --------------------------------------------------------------------------
  // Gutter Markers, Inline Highlights & Tooltip UI
  // --------------------------------------------------------------------------

  public clearGutterMarkers(): void {
    for (const marker of this.gutterMarkers) {
      marker.remove();
    }
    this.gutterMarkers = [];
  }

  public renderGutterMarkers(): void {
    this.clearGutterMarkers();
    this.clearInlineHighlights();
    if (!this.editor?.canvas || !this.isEnabled) {
      this.currentChecks = [];
      return;
    }

    const blockElements = Array.from(
      this.editor.canvas.querySelectorAll('.editor-paragraph')
    ) as HTMLElement[];

    const allActiveChecks: AICritiqueCheck[] = [];

    blockElements.forEach((blockEl, idx) => {
      const blockText = blockEl.textContent || '';
      if (!blockText.trim()) return;

      const pIdx = blockEl.dataset.blockId?.startsWith('p-')
        ? parseInt(blockEl.dataset.blockId.slice(2), 10)
        : idx;
      const effectiveIdx = isNaN(pIdx) ? idx : pIdx;

      // Scoped paragraph rule execution (resolves Defect 4)
      const issues = this.analyzer
        .analyzeText(blockText, effectiveIdx)
        .filter((c) => !this.dismissedIds.has(c.id));

      if (issues.length > 0) {
        allActiveChecks.push(...issues);

        // 1. Render 6px margin gutter marker dot (F49)
        const doc = blockEl.ownerDocument || document;
        const marker = doc.createElement('div');
        marker.className = 'critique-gutter-marker';
        marker.dataset.paragraphIndex = String(effectiveIdx);
        marker.title = `${issues.length} writing suggestion${issues.length > 1 ? 's' : ''}`;
        marker.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showTooltipForCheck(issues[0], marker);
        });
        marker.addEventListener('mouseenter', () => {
          if (this.tooltipHideTimeout) {
            clearTimeout(this.tooltipHideTimeout);
            this.tooltipHideTimeout = null;
          }
          this.showTooltipForCheck(issues[0], marker);
        });
        marker.addEventListener('mouseleave', () => {
          this.scheduleHideTooltip(300);
        });

        blockEl.style.position = 'relative';
        blockEl.appendChild(marker);
        this.gutterMarkers.push(marker);

        // 2. Render inline highlight spans (.critique-highlight)
        this.renderInlineHighlightsForParagraph(blockEl, issues, effectiveIdx);
      }
    });

    this.currentChecks = allActiveChecks;
  }

  private renderInlineHighlightsForParagraph(
    blockEl: HTMLElement,
    issues: AICritiqueCheck[],
    paraIdx: number
  ): void {
    const doc = blockEl.ownerDocument || document;
    const blockText = blockEl.textContent || '';

    // Filter overlapping intervals, prioritizing specific spans
    const sortedForOverlap = [...issues].sort((a, b) => {
      if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset;
      return (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset);
    });

    const nonOverlapping: AICritiqueCheck[] = [];
    let lastEnd = -1;
    for (const check of sortedForOverlap) {
      if (
        check.startOffset >= lastEnd &&
        check.endOffset <= blockText.length &&
        check.startOffset < check.endOffset
      ) {
        nonOverlapping.push(check);
        lastEnd = check.endOffset;
      }
    }

    // Insert spans strictly from right to left so offsets remain invariant
    nonOverlapping.sort((a, b) => b.startOffset - a.startOffset);
    for (const check of nonOverlapping) {
      const range = this.createRangeFromOffsets(blockEl, check.startOffset, check.endOffset);
      if (range) {
        const span = doc.createElement('span');
        const category = check.type === 'passive_voice' ? 'passive' : check.type;
        span.className = `critique-highlight critique-highlight-${category}`;
        span.dataset.checkId = check.id;
        span.dataset.paragraphIndex = String(paraIdx);
        span.title = check.message;

        span.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showTooltipForCheck(check, span);
        });
        span.addEventListener('mouseenter', () => {
          if (this.tooltipHideTimeout) {
            clearTimeout(this.tooltipHideTimeout);
            this.tooltipHideTimeout = null;
          }
          this.showTooltipForCheck(check, span);
        });
        span.addEventListener('mouseleave', () => {
          this.scheduleHideTooltip(300);
        });

        try {
          const contents = range.extractContents();
          span.appendChild(contents);
          range.insertNode(span);
        } catch {
          // Gracefully handle boundary exceptions
        }
      }
    }
  }

  public clearInlineHighlights(
    root: HTMLElement = this.editor?.canvas,
    preserveCaret: boolean = true
  ): void {
    if (!root) return;
    const spans = Array.from(root.querySelectorAll('.critique-highlight')) as HTMLElement[];
    if (spans.length === 0) return;

    const doc = root.ownerDocument || document;
    const sel = doc.defaultView?.getSelection() || (typeof window !== 'undefined' ? window.getSelection() : null);
    let activeBlock: HTMLElement | null = null;
    let savedOffset = -1;

    if (preserveCaret && sel && sel.rangeCount > 0 && root.contains(sel.anchorNode)) {
      activeBlock = this.findEnclosingParagraph(sel.anchorNode);
      if (activeBlock) {
        savedOffset = this.getCaretOffset(activeBlock);
      }
    }

    const affectedParagraphs = new Set<HTMLElement>();
    for (const span of spans) {
      const parent = span.parentNode;
      if (parent) {
        if (parent.nodeType === 1) {
          affectedParagraphs.add(parent as HTMLElement);
        }
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
      }
    }

    for (const para of affectedParagraphs) {
      para.normalize();
    }

    if (preserveCaret && activeBlock && savedOffset >= 0) {
      this.setCaretOffset(activeBlock, savedOffset);
    }
  }

  public showTooltipForCheck(check: AICritiqueCheck, anchorEl: HTMLElement): void {
    this.hideTooltip();

    const doc = anchorEl.ownerDocument || document;
    const tooltip = doc.createElement('div');
    tooltip.className = 'critique-tooltip-card';
    tooltip.setAttribute('role', 'dialog');
    tooltip.setAttribute('aria-label', 'Writing Suggestion');

    const badgeClass = `critique-badge-${check.type}`;
    const badgeLabel = check.type.replace('_', ' ').toUpperCase();

    tooltip.innerHTML = `
      <div class="critique-card-header">
        <span class="critique-badge ${badgeClass}">${badgeLabel}</span>
        <button class="critique-close-btn" aria-label="Close">×</button>
      </div>
      <div class="critique-card-body">
        <p class="critique-message">${escapeHtml(check.message)}</p>
        ${
          check.suggestion !== undefined && check.suggestion !== null && check.suggestion !== ''
            ? `<div class="critique-suggestion-row">
                 <span class="critique-label">Suggestion:</span>
                 <code class="critique-suggestion-code">${escapeHtml(check.suggestion)}</code>
               </div>`
            : check.suggestion === ''
            ? `<div class="critique-suggestion-row">
                 <span class="critique-label">Suggestion:</span>
                 <code class="critique-suggestion-code">(omit phrase)</code>
               </div>`
            : ''
        }
      </div>
      <div class="critique-card-actions">
        <button class="btn-critique-dismiss">Dismiss</button>
        ${check.suggestion !== undefined && check.suggestion !== null ? `<button class="btn-critique-accept">Accept</button>` : ''}
      </div>
    `;

    tooltip.addEventListener('mouseenter', () => {
      if (this.tooltipHideTimeout) {
        clearTimeout(this.tooltipHideTimeout);
        this.tooltipHideTimeout = null;
      }
    });
    tooltip.addEventListener('mouseleave', () => {
      this.scheduleHideTooltip(300);
    });

    // Bind Actions
    tooltip.querySelector('.critique-close-btn')?.addEventListener('click', () => this.hideTooltip());
    tooltip.querySelector('.btn-critique-dismiss')?.addEventListener('click', () => {
      this.dismissCheck(check.id);
      this.hideTooltip();
    });

    tooltip.querySelector('.btn-critique-accept')?.addEventListener('click', () => {
      this.acceptCheck(check);
      this.hideTooltip();
    });

    const body = doc.body || doc.documentElement;
    body.appendChild(tooltip);
    this.positionTooltip(tooltip, anchorEl);
    this.activeTooltipEl = tooltip;
  }

  public scheduleHideTooltip(delayMs: number = 300): void {
    if (this.tooltipHideTimeout) clearTimeout(this.tooltipHideTimeout);
    this.tooltipHideTimeout = setTimeout(() => {
      this.hideTooltip();
    }, delayMs);
  }

  public hideTooltip(): void {
    if (this.tooltipHideTimeout) {
      clearTimeout(this.tooltipHideTimeout);
      this.tooltipHideTimeout = null;
    }
    if (this.activeTooltipEl) {
      this.activeTooltipEl.remove();
      this.activeTooltipEl = null;
    }
  }

  private positionTooltip(tooltip: HTMLElement, anchorEl: HTMLElement): void {
    let rect = { left: 600, top: 400, bottom: 430, width: 20 };
    if (typeof anchorEl.getBoundingClientRect === 'function') {
      const domRect = anchorEl.getBoundingClientRect();
      if (domRect.width > 0 || domRect.height > 0) {
        rect = {
          left: domRect.left,
          top: domRect.top,
          bottom: domRect.bottom,
          width: domRect.width,
        };
      } else if (anchorEl.offsetTop > 0) {
        rect = {
          left: anchorEl.offsetLeft || 600,
          top: anchorEl.offsetTop,
          bottom: anchorEl.offsetTop + (anchorEl.offsetHeight || 24),
          width: anchorEl.offsetWidth || 40,
        };
      }
    }

    const tooltipWidth = 300;
    const tooltipHeight = 160;

    // Viewport clamping (1584x1184 landscape)
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    left = Math.max(16, Math.min(left, 1584 - tooltipWidth - 16));

    let top = rect.bottom + 8;
    if (top + tooltipHeight > 1160) {
      top = rect.top - tooltipHeight - 8;
    }

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  public dismissCheck(checkId: string): void {
    this.dismissedIds.add(checkId);
    this.evaluateDocument();
  }

  public acceptCheck(check: AICritiqueCheck): void {
    if (check.suggestion === undefined || !check.matchedText || !this.editor) return;

    this.clearInlineHighlights();
    const currentContent = this.editor.getContent();
    const paragraphElements = this.editor.canvas
      ? (Array.from(this.editor.canvas.querySelectorAll('.editor-paragraph')) as HTMLElement[])
      : [];

    const paragraphTexts =
      paragraphElements.length > 0
        ? paragraphElements.map((p) => (p.textContent || '').trimEnd())
        : currentContent.split(/\n\n+/);

    // Compute global character boundaries for each paragraph
    let runningOffset = 0;
    const paragraphRanges: Array<{ index: number; start: number; end: number; text: string }> = [];
    for (let i = 0; i < paragraphTexts.length; i++) {
      const pText = paragraphTexts[i];
      const pStart = runningOffset;
      const pEnd = pStart + pText.length;
      paragraphRanges.push({ index: i, start: pStart, end: pEnd, text: pText });
      runningOffset = pEnd + 2; // account for \n\n separator
    }

    // Determine target paragraph index & local offset within target paragraph
    let targetParaIdx = -1;
    let localOffset = -1;

    // Strategy 1: check.paragraphIndex if valid
    if (
      typeof check.paragraphIndex === 'number' &&
      check.paragraphIndex >= 0 &&
      check.paragraphIndex < paragraphTexts.length
    ) {
      const candidateText = paragraphTexts[check.paragraphIndex];
      const matchIdx = candidateText.indexOf(check.matchedText);

      // If paragraphIndex === 0 but startOffset is beyond paragraph 0, prefer startOffset
      if (
        check.paragraphIndex === 0 &&
        paragraphRanges.length > 0 &&
        check.startOffset > paragraphRanges[0].end
      ) {
        const range = paragraphRanges.find(
          (r) => check.startOffset >= r.start && check.startOffset <= r.end + check.matchedText!.length
        );
        if (range && range.text.indexOf(check.matchedText) !== -1) {
          targetParaIdx = range.index;
          localOffset = range.text.indexOf(check.matchedText);
        } else if (matchIdx !== -1) {
          targetParaIdx = check.paragraphIndex;
          localOffset = matchIdx;
        }
      } else if (matchIdx !== -1) {
        targetParaIdx = check.paragraphIndex;
        // Check if startOffset matches exactly within candidateText
        if (
          check.startOffset >= 0 &&
          check.startOffset + check.matchedText.length <= candidateText.length &&
          candidateText.slice(check.startOffset, check.startOffset + check.matchedText.length) === check.matchedText
        ) {
          localOffset = check.startOffset;
        } else {
          localOffset = matchIdx;
        }
      }
    }

    // Strategy 2: Determine paragraph from global startOffset
    if (targetParaIdx === -1 && typeof check.startOffset === 'number') {
      const range = paragraphRanges.find(
        (r) => check.startOffset >= r.start && check.startOffset <= r.end + check.matchedText!.length
      );
      if (range && range.text.indexOf(check.matchedText) !== -1) {
        targetParaIdx = range.index;
        localOffset = range.text.indexOf(check.matchedText);
      }
    }

    // Strategy 3: Check ID parsing (e.g., 'pv-2-14')
    if (targetParaIdx === -1 && check.id) {
      const parts = check.id.split('-');
      if (parts.length >= 3) {
        const parsedIdx = parseInt(parts[1], 10);
        if (!isNaN(parsedIdx) && parsedIdx >= 0 && parsedIdx < paragraphTexts.length) {
          const matchIdx = paragraphTexts[parsedIdx].indexOf(check.matchedText);
          if (matchIdx !== -1) {
            targetParaIdx = parsedIdx;
            localOffset = matchIdx;
          }
        }
      }
    }

    // Strategy 4: Fallback to first paragraph containing matchedText
    if (targetParaIdx === -1) {
      for (let i = 0; i < paragraphTexts.length; i++) {
        const matchIdx = paragraphTexts[i].indexOf(check.matchedText);
        if (matchIdx !== -1) {
          targetParaIdx = i;
          localOffset = matchIdx;
          break;
        }
      }
    }

    if (targetParaIdx === -1) return;

    const targetParaText = paragraphTexts[targetParaIdx];
    if (
      localOffset === -1 ||
      targetParaText.slice(localOffset, localOffset + check.matchedText.length) !== check.matchedText
    ) {
      localOffset = targetParaText.indexOf(check.matchedText);
    }
    if (localOffset === -1) return;

    const beforeState = currentContent;
    const suggestion = check.suggestion ?? '';
    const newParaText =
      targetParaText.slice(0, localOffset) +
      suggestion +
      targetParaText.slice(localOffset + check.matchedText.length);

    const globalTargetOffset =
      paragraphRanges.length > targetParaIdx
        ? paragraphRanges[targetParaIdx].start + localOffset
        : localOffset;

    // Apply targeted replacement preserving paragraph data-block-id
    if (paragraphElements.length > targetParaIdx && paragraphElements[targetParaIdx]) {
      const targetBlockEl = paragraphElements[targetParaIdx];
      const blockId = targetBlockEl.dataset.blockId || `p-${targetParaIdx}`;
      targetBlockEl.textContent = newParaText;
      targetBlockEl.dataset.blockId = blockId;

      const newContent = this.editor.getContent();

      this.history.beginAtomicTransaction('atomic', beforeState, globalTargetOffset);
      this.history.commitAtomicTransaction(
        newContent,
        globalTargetOffset + suggestion.length
      );

      if (this.editor.callbacks.onContentChange) {
        this.editor.callbacks.onContentChange(newContent);
      }
    } else {
      paragraphTexts[targetParaIdx] = newParaText;
      const newContent = paragraphTexts.join('\n\n');

      this.history.beginAtomicTransaction('atomic', beforeState, globalTargetOffset);
      this.editor.setContent(newContent);
      this.history.commitAtomicTransaction(
        newContent,
        globalTargetOffset + suggestion.length
      );

      if (this.editor.callbacks.onContentChange) {
        this.editor.callbacks.onContentChange(newContent);
      }
    }

    this.dismissCheck(check.id);
  }

  private bindEditorEvents(): void {
    if (this.editor?.callbacks) {
      const originalOnContent = this.editor.callbacks.onContentChange;
      this.editor.callbacks.onContentChange = (content: string) => {
        this.clearInlineHighlights();
        if (originalOnContent) originalOnContent(content);
        this.scheduleEvaluation();
      };
    }

    if (this.editor?.canvas) {
      const onBeforeInput = () => {
        this.clearInlineHighlights();
      };
      this.editor.canvas.addEventListener('beforeinput', onBeforeInput);
      this.cleanupListeners.push(() => {
        this.editor?.canvas?.removeEventListener('beforeinput', onBeforeInput);
      });
    }

    const doc = this.editor?.canvas?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (doc) {
      const onDocClick = (e: MouseEvent) => {
        if (this.activeTooltipEl && !this.activeTooltipEl.contains(e.target as Node)) {
          const target = e.target as HTMLElement;
          if (!target.closest?.('.critique-highlight') && !target.closest?.('.critique-gutter-marker')) {
            this.hideTooltip();
          }
        }
      };
      doc.addEventListener('click', onDocClick);
      this.cleanupListeners.push(() => doc.removeEventListener('click', onDocClick));

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.activeTooltipEl) {
          this.hideTooltip();
        }
      };
      doc.addEventListener('keydown', onKeyDown);
      this.cleanupListeners.push(() => doc.removeEventListener('keydown', onKeyDown));
    }
  }

  // --------------------------------------------------------------------------
  // Range & Caret Helpers
  // --------------------------------------------------------------------------

  private createRangeFromOffsets(root: Node, startOffset: number, endOffset: number): Range | null {
    const doc = root.ownerDocument || document;
    if (typeof doc.createTreeWalker !== 'function' || typeof doc.createRange !== 'function') {
      return null;
    }
    const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, null);
    let current = 0;
    let startNode: Text | null = null;
    let startNodeOffset = 0;
    let endNode: Text | null = null;
    let endNodeOffset = 0;
    let node = walker.nextNode() as Text | null;

    while (node) {
      if (node.parentElement && node.parentElement.classList.contains('critique-gutter-marker')) {
        node = walker.nextNode() as Text | null;
        continue;
      }
      const len = node.nodeValue?.length || 0;
      if (!startNode && current + len >= startOffset) {
        startNode = node;
        startNodeOffset = Math.max(0, startOffset - current);
      }
      if (!endNode && current + len >= endOffset) {
        endNode = node;
        endNodeOffset = Math.min(len, endOffset - current);
        break;
      }
      current += len;
      node = walker.nextNode() as Text | null;
    }

    if (!startNode || !endNode) return null;

    const range = doc.createRange();
    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);
    return range;
  }

  private findEnclosingParagraph(node: Node | null): HTMLElement | null {
    let curr = node;
    while (curr && curr !== this.editor?.canvas) {
      if (curr.nodeType === 1 /* ELEMENT_NODE */) {
        const el = curr as HTMLElement;
        if (el.classList.contains('editor-paragraph') || el.hasAttribute('data-block-id')) {
          return el;
        }
      }
      curr = curr.parentNode;
    }
    return null;
  }

  private getCaretOffset(element: HTMLElement): number {
    const doc = element.ownerDocument || document;
    const sel = doc.defaultView?.getSelection() || (typeof window !== 'undefined' ? window.getSelection() : null);
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return 0;

    const preRange = range.cloneRange();
    preRange.selectNodeContents(element);
    try {
      preRange.setEnd(range.endContainer, range.endOffset);
      return preRange.toString().length;
    } catch {
      return 0;
    }
  }

  private setCaretOffset(element: HTMLElement, targetOffset: number): boolean {
    const doc = element.ownerDocument || document;
    if (typeof doc.createTreeWalker !== 'function') return false;
    const walker = doc.createTreeWalker(element, 4 /* SHOW_TEXT */, null);
    let currentOffset = 0;
    let textNode = walker.nextNode() as Text | null;
    let lastNode: Text | null = null;

    while (textNode) {
      lastNode = textNode;
      const len = textNode.nodeValue?.length || 0;
      if (currentOffset + len >= targetOffset) {
        const offsetInNode = Math.min(len, Math.max(0, targetOffset - currentOffset));
        const sel = doc.defaultView?.getSelection() || (typeof window !== 'undefined' ? window.getSelection() : null);
        if (sel && typeof doc.createRange === 'function') {
          const r = doc.createRange();
          r.setStart(textNode, offsetInNode);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          return true;
        }
      }
      currentOffset += len;
      textNode = walker.nextNode() as Text | null;
    }

    if (lastNode) {
      const sel = doc.defaultView?.getSelection() || (typeof window !== 'undefined' ? window.getSelection() : null);
      if (sel && typeof doc.createRange === 'function') {
        const r = doc.createRange();
        r.setStart(lastNode, lastNode.nodeValue?.length || 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }
    }
    return false;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
