/**
 * src/export/share-service.ts
 * Daylight Writer - Native Web Share API & RFC 6068 Email Composer
 * Features: F58 (Web Share API), F59 (Native Email Fallback)
 *
 * Tailored for Daylight Computer (DC1) running Sol:OS
 */

import type { DocumentRecord, ThoughtNoteRecord } from '../storage/schema.ts';

export interface ExportResult {
  filename: string;
  mimeType: string;
  data: Uint8Array | string;
}

export interface ShareOptions {
  doc: DocumentRecord;
  notes?: ThoughtNoteRecord[];
  tags?: string[];
  format?: 'md' | 'txt' | 'docx' | 'pdf' | 'text';
  exportResult?: ExportResult;
}

export interface ShareResult {
  success: boolean;
  method: 'web-share-files' | 'web-share-text' | 'download-fallback' | 'aborted';
  filename?: string;
  error?: string;
}

export interface EmailComposeResult {
  url: string;
  truncated: boolean;
  charCount: number;
}

export class ShareService {
  /**
   * Checks whether the current runtime environment supports the Web Share API.
   */
  public static canShare(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  /**
   * Checks whether the browser can share specific File objects.
   */
  public static canShareFiles(files: File[]): boolean {
    if (!ShareService.canShare() || typeof navigator.canShare !== 'function') {
      return false;
    }
    try {
      return navigator.canShare({ files });
    } catch {
      return false;
    }
  }

  /**
   * Shares a document using the Web Share API, falling back to direct download
   * if unavailable, disallowed, or rejected by the platform.
   */
  public async shareDocument(options: ShareOptions): Promise<ShareResult> {
    const { doc, exportResult } = options;

    // 1. If an export result is provided, attempt file-based Web Share
    if (exportResult && ShareService.canShare()) {
      try {
        const file = this.createFileFromExportResult(exportResult);
        if (ShareService.canShareFiles([file])) {
          await navigator.share({
            title: doc.title || 'Daylight Writer Document',
            files: [file],
          });
          return {
            success: true,
            method: 'web-share-files',
            filename: exportResult.filename,
          };
        }
      } catch (err: any) {
        // AbortError indicates user cancelled the share sheet - this is normal behavior
        if (err?.name === 'AbortError') {
          return { success: false, method: 'aborted' };
        }
        // Fall through to download fallback on other errors (e.g. NotAllowedError, TypeError)
      }
    }

    // 2. If no export file or file share failed, attempt text-based Web Share
    if (
      ShareService.canShare() &&
      (!exportResult || typeof exportResult.data === 'string')
    ) {
      try {
        await navigator.share({
          title: doc.title || 'Daylight Writer Document',
          text:
            (typeof exportResult?.data === 'string'
              ? exportResult.data
              : doc.content) || '',
        });
        return { success: true, method: 'web-share-text' };
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return { success: false, method: 'aborted' };
        }
      }
    }

    // 3. Fallback: Trigger direct client-side file download if an export file exists
    if (exportResult) {
      this.downloadFile(exportResult);
      return {
        success: true,
        method: 'download-fallback',
        filename: exportResult.filename,
      };
    }

    return {
      success: false,
      method: 'download-fallback',
      error: 'No export data available to share.',
    };
  }

  /**
   * Formulates an RFC 6068 compliant mailto: URI with deterministic length clamping.
   * Guarantees total URI length <= 2500 characters and safe URI encoding.
   */
  public composeEmail(doc: DocumentRecord): EmailComposeResult {
    const rawTitle =
      doc.title && doc.title.trim().length > 0 ? doc.title.trim() : 'Untitled';
    let subject = encodeURIComponent(`Daylight Writer Document: ${rawTitle}`);
    if (subject.length > 250) {
      subject = subject.slice(0, 240);
      const lastPct = subject.lastIndexOf('%');
      if (lastPct > subject.length - 3) {
        subject = subject.slice(0, lastPct);
      }
      subject += '...';
    }

    let body = doc.content || '';
    let truncated = false;

    // URL safe limit threshold: clamp content if raw text exceeds 1500 characters
    const TRUNCATION_THRESHOLD = 1500;
    const TRUNCATION_NOTICE =
      '\n\n[...Content truncated due to email URI length limit...]';

    if (body.length > TRUNCATION_THRESHOLD) {
      body = body.slice(0, TRUNCATION_THRESHOLD) + TRUNCATION_NOTICE;
      truncated = true;
    }

    const encodedBody = encodeURIComponent(body);
    let url = `mailto:?subject=${subject}&body=${encodedBody}`;

    // Hard safety clamp: ensure total URL length strictly <= 2500 characters
    const MAX_SAFE_URL_LENGTH = 2500;
    if (url.length > MAX_SAFE_URL_LENGTH) {
      truncated = true;
      const encodedNotice = encodeURIComponent(TRUNCATION_NOTICE);
      const prefix = `mailto:?subject=${subject}&body=`;
      const availableBodyLength =
        MAX_SAFE_URL_LENGTH - prefix.length - encodedNotice.length;

      if (availableBodyLength > 0) {
        // Slice encoded body safely to fit within remaining budget
        const safeEncodedSlice = encodedBody.slice(0, availableBodyLength);
        // Avoid breaking midway through a %XX hex escape sequence
        const lastPercent = safeEncodedSlice.lastIndexOf('%');
        const cleanSlice =
          lastPercent > safeEncodedSlice.length - 3
            ? safeEncodedSlice.slice(0, lastPercent)
            : safeEncodedSlice;

        url = `${prefix}${cleanSlice}${encodedNotice}`;
      } else {
        let clamped = url.slice(0, MAX_SAFE_URL_LENGTH);
        const lastPercent = clamped.lastIndexOf('%');
        if (lastPercent > clamped.length - 3) {
          clamped = clamped.slice(0, lastPercent);
        }
        url = clamped;
      }
    }

    if (url.length > MAX_SAFE_URL_LENGTH) {
      let clamped = url.slice(0, MAX_SAFE_URL_LENGTH);
      const lastPercent = clamped.lastIndexOf('%');
      if (lastPercent > clamped.length - 3) {
        clamped = clamped.slice(0, lastPercent);
      }
      url = clamped;
    }

    return {
      url,
      truncated,
      charCount: url.length,
    };
  }

  /**
   * Composes and triggers email composition via mailto: URL scheme.
   */
  public launchEmail(doc: DocumentRecord): EmailComposeResult {
    const result = this.composeEmail(doc);

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      try {
        const link = document.createElement('a');
        link.href = result.url;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          if (link.parentNode) link.parentNode.removeChild(link);
        }, 100);
      } catch {
        window.location.href = result.url;
      }
    }

    return result;
  }

  /**
   * Client-side direct file download fallback via Blob and temporary <a download>.
   */
  public downloadFile(result: ExportResult): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const blob =
      result.data instanceof Uint8Array
        ? new Blob([result.data as unknown as BlobPart], { type: result.mimeType })
        : new Blob([result.data as unknown as BlobPart], {
            type: result.mimeType || 'text/plain;charset=utf-8',
          });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  /**
   * Helper to construct a File object from an ExportResult.
   */
  private createFileFromExportResult(res: ExportResult): File {
    const bytes =
      typeof res.data === 'string'
        ? new TextEncoder().encode(res.data)
        : res.data;

    return new File([bytes as unknown as BlobPart], res.filename, {
      type: res.mimeType,
      lastModified: Date.now(),
    });
  }
}
