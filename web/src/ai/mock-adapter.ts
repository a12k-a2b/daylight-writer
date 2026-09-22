/**
 * src/ai/mock-adapter.ts
 * Daylight Writer - Deterministic Mock AI Service Adapter
 * Provides configurable streaming, canned transforms, heuristic critique,
 * and error simulation for resilience and E2E testing.
 */

import type {
  AIServiceAdapter,
  AIContinuationOptions,
  AITransformOptions,
  CritiqueSuggestion,
  StreamChunkCallback,
  AIContext,
  TransformInstruction,
} from './service-adapter.ts';
import type { ThoughtNoteRecord } from '../storage/schema.ts';

export interface MockAIServiceConfig {
  simulatedDelayMs?: number;
  shouldFail?: boolean;
  errorMessage?: string;
  cannedContinuationText?: string;
}

export class MockAIServiceAdapter implements AIServiceAdapter {
  public simulatedDelayMs: number = 0;
  public shouldFail: boolean = false;
  public errorMessage: string = 'Simulated AI Service Error';
  public cannedContinuationText: string =
    'the landscape unfolds with deliberate quietude, allowing thought to settle.';
  public cannedTransforms: Partial<Record<TransformInstruction, (text: string, customPrompt?: string) => string>> = {};

  // Diagnostics and call recording
  public callLog: Array<{ method: string; timestamp: number; args: any }> = [];

  constructor(config: MockAIServiceConfig = {}) {
    if (config.simulatedDelayMs !== undefined) this.simulatedDelayMs = config.simulatedDelayMs;
    if (config.shouldFail !== undefined) this.shouldFail = config.shouldFail;
    if (config.errorMessage !== undefined) this.errorMessage = config.errorMessage;
    if (config.cannedContinuationText !== undefined) this.cannedContinuationText = config.cannedContinuationText;
  }

  /**
   * Streams completion tokens word-by-word with configurable latency and abort handling.
   */
  public async streamCompletion(
    options: AIContinuationOptions,
    onChunk: StreamChunkCallback
  ): Promise<string> {
    this.recordCall('streamCompletion', options);

    if (this.shouldFail) {
      throw new Error(this.errorMessage);
    }
    if (options.signal?.aborted) {
      return '';
    }

    const words = this.cannedContinuationText.trim().split(/\s+/);
    let accumulated = '';

    for (let i = 0; i < words.length; i++) {
      if (options.signal?.aborted) {
        break;
      }

      // Prepend leading space before word
      const chunk = (i === 0 ? ' ' : ' ') + words[i];
      accumulated += chunk;
      onChunk(chunk);

      if (this.simulatedDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
      }
    }

    return accumulated;
  }

  /**
   * Alias for streamCompletion satisfying PROJECT.md contract.
   */
  public async streamContinuation(
    options: AIContinuationOptions,
    onChunk: StreamChunkCallback
  ): Promise<string> {
    return this.streamCompletion(options, onChunk);
  }

  /**
   * Complete synchronously without chunking delays.
   */
  public async complete(options: AIContinuationOptions): Promise<string> {
    this.recordCall('complete', options);
    if (this.shouldFail) throw new Error(this.errorMessage);
    if (options.signal?.aborted) return '';
    return ' ' + this.cannedContinuationText.trim();
  }

  /**
   * Transforms selected text according to instructions.
   */
  public async transformText(options: AITransformOptions): Promise<string> {
    this.recordCall('transformText', options);
    if (this.shouldFail) throw new Error(this.errorMessage);

    const { selectedText, instruction, customPrompt } = options;

    // Custom override hook
    if (this.cannedTransforms[instruction]) {
      return this.cannedTransforms[instruction]!(selectedText, customPrompt);
    }

    switch (instruction) {
      case 'summarize':
        return `Summary: ${selectedText.slice(0, 40)}...`;

      case 'expand':
        return `${selectedText} This insight reveals the profound underpinnings of our core thesis.`;

      case 'concise':
        return selectedText.replace(/\b(?:very|really|quite|extremely)\s+/gi, '');

      case 'poetic':
        return `Like quiet amber light upon paper: ${selectedText}`;

      case 'analytical':
        return `Empirical observation reveals: ${selectedText.toLowerCase()}`;

      case 'casual':
        return `Basically, ${selectedText.toLowerCase()}`;

      case 'fix_grammar':
        return selectedText
          .replace(/\bthe the\b/gi, (m) => (m[0] === 'T' ? 'The' : 'the'))
          .replace(/\bwas written by\b/gi, 'wrote');

      case 'custom':
        return `[Transformed per "${customPrompt || ''}"]: ${selectedText}`;

      default:
        return selectedText;
    }
  }

  /**
   * Heuristic critique checks identifying passive voice, repetition, and wordiness.
   */
  public async critiqueText(text: string): Promise<CritiqueSuggestion[]> {
    this.recordCall('critiqueText', { textLength: text.length });
    if (this.shouldFail) throw new Error(this.errorMessage);

    const checks: CritiqueSuggestion[] = [];

    // 1. Passive voice check
    const passiveRegex = /\b(was|were|is|are|been|being)\s+(\w+ed|written|taken|chosen|seen)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = passiveRegex.exec(text)) !== null) {
      checks.push({
        id: `pv-${match.index}`,
        paragraphIndex: 0,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        type: 'passive_voice',
        message: `Passive construction "${match[0]}". Consider active voice.`,
        suggestion: 'active phrasing',
      });
    }

    // 2. Adjacent duplicate words (repetition)
    const dupRegex = /\b(\w+)\s+\1\b/gi;
    while ((match = dupRegex.exec(text)) !== null) {
      checks.push({
        id: `rep-${match.index}`,
        paragraphIndex: 0,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        type: 'repetition',
        message: `Repeated word "${match[1]}".`,
        suggestion: match[1],
      });
    }

    // 3. Clarity check: wordy phrases
    const wordyRegex = /\bin order to\b/gi;
    while ((match = wordyRegex.exec(text)) !== null) {
      checks.push({
        id: `clr-${match.index}`,
        paragraphIndex: 0,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        type: 'clarity',
        message: 'Wordy phrase "in order to". Use "to" instead.',
        suggestion: 'to',
      });
    }

    return checks;
  }

  /**
   * Alias for critiqueText satisfying PROJECT.md contract.
   */
  public async runCritiqueChecks(text: string): Promise<CritiqueSuggestion[]> {
    return this.critiqueText(text);
  }

  /**
   * Context-aware query assistant synthesizing answers from document & margin notes.
   */
  public async queryContext(
    prompt: string,
    documentTextOrContext: string | AIContext,
    notes?: ThoughtNoteRecord[]
  ): Promise<string> {
    this.recordCall('queryContext', { prompt });
    if (this.shouldFail) throw new Error(this.errorMessage);

    let notesList: ThoughtNoteRecord[] = [];
    if (typeof documentTextOrContext === 'string') {
      notesList = notes || [];
    } else {
      notesList = documentTextOrContext.marginNotes || [];
    }

    const notesSummary =
      notesList.length > 0
        ? ` Referenced margin notes: ${notesList.map((n) => `[Note:${n.paragraph_anchor_id}]`).join(', ')}.`
        : '';

    return `In response to "${prompt}": The core thesis is established in [¶1].${notesSummary}`;
  }

  private recordCall(method: string, args: any): void {
    this.callLog.push({ method, timestamp: Date.now(), args });
  }
}
