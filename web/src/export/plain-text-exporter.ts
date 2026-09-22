/**
 * src/export/plain-text-exporter.ts
 * Daylight Writer - UTF-8 Plain Text Export Pipeline (.txt)
 * Features: F55 (Plain Text Export Pipeline), Typewriter ASCII Banner & Notes
 *
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

import type { DocumentRecord, ThoughtNoteRecord } from '../storage/schema.ts';
import {
  type ExportResult,
  sanitizeFilename,
  sortThoughtNotes,
} from './markdown-exporter.ts';

const BANNER_WIDTH = 80;
const DOUBLE_RULE = '='.repeat(BANNER_WIDTH);
const SINGLE_RULE = '-'.repeat(BANNER_WIDTH);

export interface PlainTextExportOptions {
  includeThoughtNotes?: boolean;
  notesSectionHeader?: string;
  bannerWidth?: number;
}

/**
 * ReDoS-safe linear regex markdown stripper.
 * Operates in O(n) without catastrophic backtracking on adversarial input.
 */
export function stripMarkdownFormatting(markdown: string): string {
  if (!markdown) return '';

  let text = markdown;

  // Fenced code blocks: preserve code content
  if (text.includes('```')) {
    text = text.replace(/^```[\w-]*\n([\s\S]*?)\n```$/gm, '$1');
  }

  // Inline code
  if (text.includes('`')) {
    text = text.replace(/`([^`\n]+)`/g, '$1');
  }

  // Headings
  if (text.includes('#')) {
    text = text.replace(/^#{1,6}\s+(.*)$/gm, '$1');
  }

  // Bold italic: ***text*** or ___text___
  if (text.includes('***')) {
    text = text.replace(/\*\*\*([^\*\n]+)\*\*\*/g, '$1');
  }
  if (text.includes('___')) {
    text = text.replace(/___([^_\n]+)___/g, '$1');
  }

  // Bold: **text** or __text__
  if (text.includes('**')) {
    text = text.replace(/\*\*([^\*\n]+)\*\*/g, '$1');
  }
  if (text.includes('__')) {
    text = text.replace(/__([^_\n]+)__/g, '$1');
  }

  // Italic: *text* or _text_
  if (text.includes('*')) {
    text = text.replace(/\*([^\*\n]+)\*/g, '$1');
  }
  if (text.includes('_')) {
    text = text.replace(/_([^_\n]+)_/g, '$1');
  }

  // Strikethrough: ~~text~~
  if (text.includes('~~')) {
    text = text.replace(/~~([^~\n]+)~~/g, '$1');
  }

  // Images and links: require ]( delimiter and disallow unescaped brackets
  if (text.includes('](')) {
    text = text
      .replace(/!\[([^\[\]\n]*)\]\(([^()\n]+)\)/g, (_, alt) =>
        alt ? `[Image: ${alt}]` : ''
      )
      .replace(/\[([^\[\]\n]+)\]\(([^()\n]+)\)/g, '$1 ($2)');
  }

  // Blockquotes: > quote -> quote
  if (text.includes('>')) {
    text = text.replace(/^[ \t]*>[ \t]?(.*)$/gm, '$1');
  }

  // Horizontal rules -> 80 char divider
  text = text.replace(/^[ \t]*([-*_]){3,}[ \t]*$/gm, SINGLE_RULE);

  // List bullets: convert to clean bullet
  text = text.replace(/^[ \t]*[-*+]\s+/gm, '• ');

  // HTML tags strip
  if (text.includes('<')) {
    text = text.replace(/<[^>\n]+>/g, '');
  }

  // Multiple blank lines normalization
  if (text.includes('\n\n\n')) {
    text = text.replace(/\n{3,}/g, '\n\n');
  }

  return text;
}

export function exportToPlainText(
  doc: DocumentRecord,
  notes: ThoughtNoteRecord[] = [],
  tags: string[] = [],
  options: PlainTextExportOptions = {}
): ExportResult {
  const includeNotes = options.includeThoughtNotes ?? true;
  const notesHeader = options.notesSectionHeader || 'MARGIN NOTES:';

  // 1. Title Banner
  const title = (doc.title || 'Untitled').trim();
  const bannerLines: string[] = [
    DOUBLE_RULE,
    title.toUpperCase(),
    `Last Modified: ${new Date(doc.updated_at).toISOString()}`,
  ];

  if (tags && tags.length > 0) {
    const formattedTags = tags
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .join(', ');
    bannerLines.push(`Tags: ${formattedTags}`);
  }
  bannerLines.push(DOUBLE_RULE, '');

  // 2. Body Text
  const cleanBody = stripMarkdownFormatting(doc.content || '');

  let output = bannerLines.join('\n') + '\n' + cleanBody;

  // 3. Margin Notes Section
  const activeNotes = sortThoughtNotes(notes);
  if (includeNotes && activeNotes.length > 0) {
    output += `\n\n${SINGLE_RULE}\n${notesHeader}\n`;
    for (const note of activeNotes) {
      const anchor = note.paragraph_anchor_id;
      const cleanContent = (note.content || '').trim();
      output += `[${anchor}]: ${cleanContent}\n`;
    }
  }

  return {
    filename: sanitizeFilename(doc.title, 'txt'),
    mimeType: 'text/plain; charset=utf-8',
    data: output,
  };
}

export class PlainTextExporter {
  public stripMarkdown(markdown: string): string {
    return stripMarkdownFormatting(markdown);
  }

  public export(
    doc: DocumentRecord,
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = [],
    options: PlainTextExportOptions = {}
  ): ExportResult {
    return exportToPlainText(doc, notes, tags, options);
  }
}
