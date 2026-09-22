/**
 * src/ai/service-adapter.ts
 * Daylight Writer - Pluggable AI Service Adapter Interface Contract
 * Supports streaming continuation, text transformations, critique linting, and context queries.
 */

import type { ThoughtNoteRecord } from '../storage/schema.ts';

/**
 * Stream chunk delivery callback.
 */
export type StreamChunkCallback = (chunk: string) => void;

/**
 * AI Context container passed into query and generation routines.
 */
export interface AIContext {
  documentText: string;
  cursorOffset?: number;
  selectedText?: string;
  title?: string;
  marginNotes?: ThoughtNoteRecord[];
}

/**
 * Options for inline continuation generation.
 */
export interface AIContinuationOptions {
  documentText: string;
  cursorOffset: number;
  maxTokens?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
}

/**
 * Supported text transformation instructions for Cmd+K palette.
 */
export type TransformInstruction =
  | 'summarize'
  | 'expand'
  | 'concise'
  | 'poetic'
  | 'analytical'
  | 'casual'
  | 'fix_grammar'
  | 'custom';

/**
 * Options for text transformation.
 */
export interface AITransformOptions {
  selectedText: string;
  instruction: TransformInstruction;
  customPrompt?: string;
  surroundingContext?: string;
  signal?: AbortSignal;
}

/**
 * Non-modal critique suggestions for style, clarity, and grammar.
 */
export interface CritiqueSuggestion {
  id: string;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  type: 'passive_voice' | 'repetition' | 'clarity' | 'structure';
  message: string;
  suggestion?: string;
}

/**
 * Backward-compatible alias matching PROJECT.md and E2E test suites.
 */
export type AICritiqueCheck = CritiqueSuggestion;

/**
 * Pluggable AIServiceAdapter interface contract.
 */
export interface AIServiceAdapter {
  /**
   * Generates a complete continuation synchronously (waits for full generation).
   */
  complete(options: AIContinuationOptions): Promise<string>;

  /**
   * Streams completion tokens incrementally via callback.
   */
  streamCompletion(options: AIContinuationOptions, onChunk: StreamChunkCallback): Promise<string>;

  /**
   * Alias for streamCompletion matching PROJECT.md and E2E test contracts.
   */
  streamContinuation(options: AIContinuationOptions, onChunk: StreamChunkCallback): Promise<string>;

  /**
   * Applies inline transformation to selected text.
   */
  transformText(options: AITransformOptions): Promise<string>;

  /**
   * Performs non-modal heuristic or LLM critique analysis.
   */
  critiqueText(text: string): Promise<CritiqueSuggestion[]>;

  /**
   * Alias for critiqueText matching PROJECT.md and E2E test contracts.
   */
  runCritiqueChecks(text: string): Promise<CritiqueSuggestion[]>;

  /**
   * Queries context across document and attached thought notes.
   * Supports both (prompt, docText, notes) and (prompt, AIContext).
   */
  queryContext(
    prompt: string,
    documentTextOrContext: string | AIContext,
    notes?: ThoughtNoteRecord[]
  ): Promise<string>;
}
