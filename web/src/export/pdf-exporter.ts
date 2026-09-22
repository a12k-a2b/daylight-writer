/**
 * src/export/pdf-exporter.ts
 * Daylight Writer - Client-Side Vector PDF 1.4 Binary Generator & Print Engine
 * Features: F57 (Client-Side Vector PDF Export Pipeline & Print Stylesheet)
 *
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 * Zero external npm dependencies.
 */

import type { DocumentRecord, ThoughtNoteRecord } from '../storage/schema.ts';
import {
  type ExportResult,
  sanitizeFilename,
  sortThoughtNotes,
  extractAnchorIndex,
  formatNoteAnchorLabel,
} from './markdown-exporter.ts';

export interface PdfExportOptions {
  pageSize?: 'landscape_dc1' | 'letter_landscape';
  includeThoughtNotes?: boolean;
}

/**
 * Pure TypeScript Vector PDF 1.4 Generator
 */
export class VectorPdfBuilder {
  private objects: string[] = [];
  private pageObjectIds: number[] = [];
  private fontRegularId: number = 0;
  private fontBoldId: number = 0;
  private pageWidth: number = 792; // Standard Landscape Letter (11" = 792pt)
  private pageHeight: number = 612; // 8.5" = 612pt
  private marginX: number = 54;
  private marginY: number = 54;

  constructor(options?: { pageSize?: 'landscape_dc1' | 'letter_landscape' }) {
    if (options?.pageSize === 'landscape_dc1') {
      this.pageWidth = 1056; // 4:3 LivePaper ratio
      this.pageHeight = 792;
    }
  }

  private addObject(content: string): number {
    this.objects.push(content);
    return this.objects.length; // 1-indexed
  }

  public generate(
    doc: DocumentRecord,
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = []
  ): Uint8Array {
    this.objects = [];
    this.pageObjectIds = [];

    // 1. Catalog upfront: Object 1 (references Pages at Object 2)
    this.addObject(`<< /Type /Catalog /Pages 2 0 R >>`);

    // 2. Pages container placeholder upfront: Object 2 (populated in-place)
    const pagesObjIndex = this.addObject('');

    // 3. Fonts: Type 1 standard fonts (Objects 3 & 4)
    this.fontRegularId = this.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`
    );
    this.fontBoldId = this.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`
    );

    // Stream generation with text layout & pagination
    const pagesStreams = this.layoutDocument(doc, notes, tags);

    // Create Stream and Page objects (Objects 5, 6, 7, 8, ...)
    for (const stream of pagesStreams) {
      const streamObjId = this.addObject(
        `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`
      );
      const pageObjId = this.addObject(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Contents ${streamObjId} 0 R /Resources << /Font << /F1 ${this.fontRegularId} 0 R /F2 ${this.fontBoldId} 0 R >> >> >>`
      );
      this.pageObjectIds.push(pageObjId);
    }

    // 4. Update Pages container (Object 2) in-place without shifting any indices
    this.objects[pagesObjIndex - 1] =
      `<< /Type /Pages /Kids [${this.pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${this.pageObjectIds.length} >>`;

    return this.serializePdf();
  }

  private layoutDocument(
    doc: DocumentRecord,
    notes: ThoughtNoteRecord[],
    tags: string[]
  ): string[] {
    const pages: string[] = [];
    let currentStream = '';
    let cursorY = this.pageHeight - this.marginY;

    const startNewPage = () => {
      if (currentStream) {
        pages.push(currentStream);
      }
      currentStream = '';
      cursorY = this.pageHeight - this.marginY - 30; // Reserve space for header
    };

    startNewPage();

    // 1. Title
    currentStream += `BT\n/F2 20 Tf\n${this.marginX} ${cursorY} Td\n(${this.escapePdfString(doc.title || 'Untitled')}) Tj\nET\n`;
    cursorY -= 28;

    // 2. Metadata / Tags
    if (tags && tags.length > 0) {
      const tagStr = tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(', ');
      currentStream += `BT\n/F1 10 Tf\n0.33 0.33 0.33 rg\n${this.marginX} ${cursorY} Td\n(${this.escapePdfString(tagStr)}) Tj\n0 0 0 rg\nET\n`;
      cursorY -= 22;
    }

    // 3. Body paragraphs
    const paragraphs = (doc.content || '').split(/\n\n+/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (cursorY < this.marginY + 60) {
        startNewPage();
      }

      if (trimmed.startsWith('# ')) {
        cursorY -= 12;
        currentStream += `BT\n/F2 14 Tf\n${this.marginX} ${cursorY} Td\n(${this.escapePdfString(trimmed.slice(2))}) Tj\nET\n`;
        cursorY -= 20;
      } else {
        const lines = this.wrapText(trimmed, 95);
        for (const line of lines) {
          if (cursorY < this.marginY + 40) {
            startNewPage();
          }
          currentStream += `BT\n/F1 11 Tf\n${this.marginX} ${cursorY} Td\n(${this.escapePdfString(line)}) Tj\nET\n`;
          cursorY -= 16;
        }
        cursorY -= 8;
      }
    }

    // 4. Thought Notes Appendix
    const activeNotes = sortThoughtNotes(notes);
    if (activeNotes.length > 0) {
      cursorY -= 16;
      if (cursorY < this.marginY + 80) {
        startNewPage();
      }

      // Divider line
      currentStream += `0.8 0.8 0.8 RG\n0.5 w\n${this.marginX} ${cursorY} m ${this.pageWidth - this.marginX} ${cursorY} l S\n`;
      cursorY -= 18;

      currentStream += `BT\n/F2 13 Tf\n${this.marginX} ${cursorY} Td\n(Thought Notes & Annotations) Tj\nET\n`;
      cursorY -= 20;

      for (const note of activeNotes) {
        const prefix = `${formatNoteAnchorLabel(note)} `;
        const fullNote = prefix + (note.content || '').trim();
        const lines = this.wrapText(fullNote, 90);

        for (let i = 0; i < lines.length; i++) {
          if (cursorY < this.marginY + 40) {
            startNewPage();
          }
          const isFirst = i === 0;
          currentStream += `BT\n${isFirst ? '/F2' : '/F1'} 10 Tf\n${this.marginX + 12} ${cursorY} Td\n(${this.escapePdfString(lines[i])}) Tj\nET\n`;
          cursorY -= 14;
        }
        cursorY -= 6;
      }
    }

    if (currentStream) {
      pages.push(currentStream);
    }

    return pages;
  }

  private wrapText(text: string, maxCharsPerLine: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const w of words) {
      if ((currentLine + ' ' + w).trim().length <= maxCharsPerLine) {
        currentLine = (currentLine + ' ' + w).trim();
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = w;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  private escapePdfString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private serializePdf(): Uint8Array {
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [0];
    const encoder = new TextEncoder();

    for (let i = 0; i < this.objects.length; i++) {
      offsets.push(encoder.encode(out).length);
      out += `${i + 1} 0 obj\n${this.objects[i]}\nendobj\n`;
    }

    const xrefOffset = encoder.encode(out).length;
    out += `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;

    for (let i = 1; i <= this.objects.length; i++) {
      out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }

    out += `trailer\n<< /Size ${this.objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return encoder.encode(out);
  }
}

export async function exportToPdf(
  doc: DocumentRecord,
  notes: ThoughtNoteRecord[] = [],
  tags: string[] = [],
  options: PdfExportOptions = {}
): Promise<ExportResult> {
  const builder = new VectorPdfBuilder({
    pageSize:
      options.pageSize === 'landscape_dc1'
        ? 'landscape_dc1'
        : 'letter_landscape',
  });
  const data = builder.generate(doc, notes, tags);

  return {
    filename: sanitizeFilename(doc.title, 'pdf'),
    mimeType: 'application/pdf',
    data,
  };
}

/**
 * Triggers Browser Print Dialog via Hidden IFrame
 */
export function printDocument(
  doc: DocumentRecord,
  notes: ThoughtNoteRecord[] = [],
  tags: string[] = []
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';

  document.body.appendChild(iframe);

  const activeNotes = sortThoughtNotes(notes);
  const tagHtml =
    tags.length > 0
      ? `<div class="print-tags">${tags.map((t) => `#${t}`).join(', ')}</div>`
      : '';

  let notesHtml = '';
  if (activeNotes.length > 0) {
    notesHtml = `
      <div class="print-thought-notes">
        <h2>Thought Notes &amp; Annotations</h2>
        ${activeNotes
          .map((n) => {
            const label = formatNoteAnchorLabel(n);
            return `
            <div class="print-note-callout">
              <span class="print-note-badge">${label}</span>
              <span>${n.content}</span>
            </div>`;
          })
          .join('')}
      </div>`;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${doc.title || 'Untitled'}</title>
  <style>
    @page { size: landscape; margin: 18mm 20mm; }
    body {
      font-family: Georgia, serif;
      color: #1A1A1A;
      background: #FFFFFF;
      line-height: 1.6;
      font-size: 11pt;
      margin: 0;
    }
    .print-page-header {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid #DCD5C9;
      padding-bottom: 4pt;
      margin-bottom: 16pt;
      font-size: 9pt;
      color: #858585;
    }
    h1.print-title { font-size: 22pt; margin: 0 0 8pt 0; color: #000000; }
    .print-tags { font-size: 9pt; color: #535353; margin-bottom: 20pt; }
    p { margin-bottom: 12pt; text-align: justify; }
    .print-thought-notes { margin-top: 24pt; border-top: 1px solid #CCCCCC; padding-top: 12pt; }
    .print-note-callout { background: #F7F7F7; border-left: 3px solid #858585; padding: 6pt 10pt; margin-bottom: 8pt; font-size: 10pt; }
    .print-note-badge { font-weight: bold; margin-right: 6pt; }
  </style>
</head>
<body>
  <div class="print-page-header">
    <span>Daylight Writer — ${doc.title}</span>
    <span>${new Date(doc.updated_at).toLocaleDateString()}</span>
  </div>
  <h1 class="print-title">${doc.title || 'Untitled'}</h1>
  ${tagHtml}
  <div class="print-body">
    ${(doc.content || '')
      .split(/\n\n+/)
      .map((p) => `<p>${p}</p>`)
      .join('')}
  </div>
  ${notesHtml}
</body>
</html>`;

  const docFrame = iframe.contentWindow?.document;
  if (docFrame) {
    docFrame.open();
    docFrame.write(html);
    docFrame.close();
    iframe.contentWindow?.focus();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 2000);
    }, 250);
  }
}

export class PdfExporter {
  public export(
    doc: DocumentRecord,
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = [],
    options: PdfExportOptions = {}
  ): ExportResult {
    const builder = new VectorPdfBuilder({
      pageSize:
        options.pageSize === 'landscape_dc1'
          ? 'landscape_dc1'
          : 'letter_landscape',
    });
    const data = builder.generate(doc, notes, tags);

    return {
      filename: sanitizeFilename(doc.title, 'pdf'),
      mimeType: 'application/pdf',
      data,
    };
  }
}
