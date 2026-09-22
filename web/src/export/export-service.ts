/**
 * src/export/export-service.ts
 * Daylight Writer - Multi-Format Document Export Service Orchestrator
 * Features: F54-F57, F60 (Multi-Format Export Pipelines)
 *
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

import type { DocumentRecord, ThoughtNoteRecord } from '../storage/schema.ts';
import {
  type ExportResult,
  exportToMarkdown as exportMd,
  sanitizeFilename,
  type MarkdownExportOptions,
} from './markdown-exporter.ts';
import {
  exportToPlainText as exportTxt,
  type PlainTextExportOptions,
} from './plain-text-exporter.ts';
import {
  exportToDocx as exportDocx,
  type DocxExportOptions,
} from './docx-exporter.ts';
import {
  exportToPdf as exportPdf,
  type PdfExportOptions,
} from './pdf-exporter.ts';
import { ShareService, type EmailComposeResult } from './share-service.ts';

export type { ExportResult };
export { sanitizeFilename };

export interface ExportOptions
  extends MarkdownExportOptions,
    PlainTextExportOptions,
    DocxExportOptions,
    PdfExportOptions {}

export interface IExportService {
  exportToMarkdown(
    doc: DocumentRecord,
    notes?: ThoughtNoteRecord[],
    tags?: string[],
    options?: ExportOptions
  ): ExportResult;
  exportToPlainText(
    doc: DocumentRecord,
    notes?: ThoughtNoteRecord[],
    tags?: string[],
    options?: ExportOptions
  ): ExportResult;
  exportToDocx(
    doc: DocumentRecord,
    notes?: ThoughtNoteRecord[],
    tags?: string[],
    options?: ExportOptions
  ): Promise<ExportResult>;
  exportToPdf(
    doc: DocumentRecord,
    notes?: ThoughtNoteRecord[],
    tags?: string[],
    options?: ExportOptions
  ): Promise<ExportResult>;
  shareDocument(
    doc: DocumentRecord,
    format: 'md' | 'txt' | 'docx' | 'pdf',
    notes?: ThoughtNoteRecord[],
    tags?: string[]
  ): Promise<boolean>;
  composeEmail(doc: DocumentRecord): { url: string; truncated: boolean };
}

export class ExportService implements IExportService {
  private shareService: ShareService;

  constructor(shareService?: ShareService) {
    this.shareService = shareService || new ShareService();
  }

  public exportToMarkdown(
    doc: DocumentRecord,
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = [],
    options: ExportOptions = {}
  ): ExportResult {
    return exportMd(doc, notes, tags, options);
  }

  public exportToPlainText(
    doc: DocumentRecord,
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = [],
    options: ExportOptions = {}
  ): ExportResult {
    return exportTxt(doc, notes, tags, options);
  }

  public async exportToDocx(
    doc: DocumentRecord,
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = [],
    options: ExportOptions = {}
  ): Promise<ExportResult> {
    return exportDocx(doc, notes, tags, options);
  }

  public async exportToPdf(
    doc: DocumentRecord,
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = [],
    options: ExportOptions = {}
  ): Promise<ExportResult> {
    return exportPdf(doc, notes, tags, options);
  }

  public async exportDocument(
    doc: DocumentRecord,
    format: 'md' | 'txt' | 'docx' | 'pdf',
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = [],
    options: ExportOptions = {}
  ): Promise<ExportResult> {
    switch (format) {
      case 'md':
        return this.exportToMarkdown(doc, notes, tags, options);
      case 'txt':
        return this.exportToPlainText(doc, notes, tags, options);
      case 'docx':
        return await this.exportToDocx(doc, notes, tags, options);
      case 'pdf':
        return await this.exportToPdf(doc, notes, tags, options);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  public async shareDocument(
    doc: DocumentRecord,
    format: 'md' | 'txt' | 'docx' | 'pdf',
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = []
  ): Promise<boolean> {
    let exportRes: ExportResult;
    switch (format) {
      case 'md':
        exportRes = this.exportToMarkdown(doc, notes, tags);
        break;
      case 'txt':
        exportRes = this.exportToPlainText(doc, notes, tags);
        break;
      case 'docx':
        exportRes = await this.exportToDocx(doc, notes, tags);
        break;
      case 'pdf':
        exportRes = await this.exportToPdf(doc, notes, tags);
        break;
    }

    const shareRes = await this.shareService.shareDocument({
      doc,
      notes,
      tags,
      format,
      exportResult: exportRes,
    });
    return shareRes.success;
  }

  public composeEmail(doc: DocumentRecord): { url: string; truncated: boolean } {
    return this.shareService.composeEmail(doc);
  }
}

/**
 * Direct file download helper via Blob and temporary <a> anchor
 */
export function downloadExportResult(result: ExportResult): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const blob =
    typeof result.data === 'string'
      ? new Blob([result.data], { type: result.mimeType })
      : new Blob([result.data as unknown as BlobPart], { type: result.mimeType });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 1000);
}
