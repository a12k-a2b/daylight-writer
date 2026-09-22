/**
 * src/export/markdown-exporter.ts
 * Daylight Writer - CommonMark Markdown Export Pipeline (.md)
 * Features: F54 (Markdown Export Pipeline), YAML 1.2 Frontmatter & Anchored Notes
 *
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

import type { DocumentRecord, ThoughtNoteRecord } from '../storage/schema.ts';

export interface ExportResult {
  filename: string;
  mimeType: string;
  data: Uint8Array | string;
}

export interface MarkdownExportOptions {
  includeFrontmatter?: boolean;
  includeThoughtNotes?: boolean;
  thoughtNotesHeading?: string;
  bulletStyle?: 'pilcrow' | 'bold_anchor';
  includeDocumentId?: boolean;
}

export function sanitizeFilename(title: string, extension: string): string {
  const base = (title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, '_');
  const cleanExt = extension.startsWith('.') ? extension : `.${extension}`;
  return `${base || 'untitled'}${cleanExt}`;
}

export const UNANCHORED_INDEX = 999999;

export function extractAnchorIndex(anchorId?: string | null): number {
  if (!anchorId) return UNANCHORED_INDEX;
  const match = anchorId.match(/\d+/);
  return match ? parseInt(match[0], 10) : UNANCHORED_INDEX;
}

export function formatNoteAnchorLabel(
  noteOrAnchor?: { paragraph_anchor_id?: string | null; anchor_paragraph_id?: string | null; [key: string]: any } | Partial<ThoughtNoteRecord> | string | null
): string {
  let anchor: string | null | undefined;
  if (typeof noteOrAnchor === 'string' || noteOrAnchor === null || noteOrAnchor === undefined) {
    anchor = noteOrAnchor;
  } else {
    anchor = noteOrAnchor.paragraph_anchor_id ?? (noteOrAnchor as any).anchor_paragraph_id;
  }

  if (!anchor || anchor.trim() === '') {
    return '[unanchored]';
  }

  const trimmed = anchor.trim();
  const idx = extractAnchorIndex(trimmed);
  if (idx !== UNANCHORED_INDEX && idx !== Number.MAX_SAFE_INTEGER) {
    return `[¶${idx}]`;
  }

  return `[${trimmed}]`;
}

export function sortThoughtNotes(notes: ThoughtNoteRecord[]): ThoughtNoteRecord[] {
  return [...notes]
    .filter((n) => n.deleted_at === null)
    .sort((a, b) => {
      const idxA = extractAnchorIndex(a.paragraph_anchor_id ?? (a as any).anchor_paragraph_id);
      const idxB = extractAnchorIndex(b.paragraph_anchor_id ?? (b as any).anchor_paragraph_id);
      if (idxA !== idxB) {
        return idxA - idxB;
      }
      const anchorA = a.paragraph_anchor_id ?? (a as any).anchor_paragraph_id ?? '';
      const anchorB = b.paragraph_anchor_id ?? (b as any).anchor_paragraph_id ?? '';
      const strCmp = anchorA.localeCompare(
        anchorB,
        undefined,
        { numeric: true }
      );
      if (strCmp !== 0) return strCmp;
      return a.created_at - b.created_at; // Stable chronological tie-breaker
    });
}

export function exportToMarkdown(
  doc: DocumentRecord,
  notes: ThoughtNoteRecord[] = [],
  tags: string[] = [],
  options: MarkdownExportOptions = {}
): ExportResult {
  const includeFrontmatter = options.includeFrontmatter ?? true;
  const includeNotes = options.includeThoughtNotes ?? true;
  const heading =
    options.thoughtNotesHeading ||
    (options.bulletStyle === 'bold_anchor'
      ? 'Margin Notes & Annotations'
      : 'Thought Notes');
  const bulletStyle =
    options.bulletStyle ||
    (heading.includes('Margin Notes') ? 'bold_anchor' : 'pilcrow');

  let output = '';

  // 1. YAML Frontmatter
  if (includeFrontmatter) {
    const cleanTags = (tags || []).map((t) => (t.startsWith('#') ? t.slice(1) : t));
    const escapedTitle = (doc.title || 'Untitled')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');

    output += '---\n';
    output += `title: "${escapedTitle}"\n`;
    if (options.includeDocumentId ?? true) {
      output += `id: "${doc.id}"\n`;
    }
    output += `created_at: "${new Date(doc.created_at).toISOString()}"\n`;
    output += `updated_at: "${new Date(doc.updated_at).toISOString()}"\n`;
    output += `tags: [${cleanTags.map((t) => `"${t}"`).join(', ')}]\n`;
    output += '---\n\n';
  }

  // 2. Document Body
  output += (doc.content || '').trimEnd();

  // 3. Thought Notes Appendix
  const activeNotes = sortThoughtNotes(notes);
  if (includeNotes && activeNotes.length > 0) {
    output += `\n\n---\n\n## ${heading}\n\n`;

    for (const note of activeNotes) {
      const anchor = note.paragraph_anchor_id ?? (note as any).anchor_paragraph_id;
      const cleanContent = (note.content || '').trim();

      if (bulletStyle === 'bold_anchor') {
        const anchorLabel = anchor && anchor.trim() !== '' ? anchor.trim() : 'unanchored';
        output += `* **[${anchorLabel}]**: ${cleanContent}\n`;
      } else {
        const label = formatNoteAnchorLabel(note);
        output += `- ${label} ${cleanContent}\n`;
      }
    }
  }

  return {
    filename: sanitizeFilename(doc.title, 'md'),
    mimeType: 'text/markdown; charset=utf-8',
    data: output,
  };
}

export class MarkdownExporter {
  public export(
    doc: DocumentRecord,
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = [],
    options: MarkdownExportOptions = {}
  ): ExportResult {
    return exportToMarkdown(doc, notes, tags, options);
  }
}
