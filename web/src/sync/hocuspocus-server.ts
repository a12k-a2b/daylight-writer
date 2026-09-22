/**
 * src/sync/hocuspocus-server.ts
 * Daylight Writer - Embedded Hocuspocus 4 CRDT Backend Server
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 * Sol:OS 8-bit Grayscale Design Tokens (--os-0 to --os-1000)
 */

import { Server as HocuspocusServer } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { SqliteDatabase } from '../storage/sqlite-vfs.ts';

export interface HocuspocusServerOptions {
  port?: number;
  db?: SqliteDatabase | null;
  quiet?: boolean;
  onDocumentChange?: (docName: string, document: Y.Doc) => void | Promise<void>;
  onAgentTrigger?: (docName: string, document: Y.Doc, activeBlockId?: string) => void;
}

export class DaylightHocuspocusServer {
  public server: HocuspocusServer;
  public port: number;
  public isRunning = false;
  private db: SqliteDatabase | null;
  private inMemoryStorage = new Map<string, Uint8Array>();

  constructor(options: HocuspocusServerOptions = {}) {
    this.port = options.port ?? 0;
    this.db = options.db || null;

    this.server = new HocuspocusServer({
      port: this.port,
      quiet: options.quiet ?? true,

      /**
       * 1. Load CRDT state on document request
       */
      onLoadDocument: async (data) => {
        const docName = data.documentName;

        // Try to load binary snapshot from in-memory cache or SQLite
        const cachedUpdate = this.inMemoryStorage.get(docName);
        if (cachedUpdate) {
          Y.applyUpdate(data.document, cachedUpdate);
          return data.document;
        }

        if (this.db) {
          try {
            const rows = await this.db.executeSql<{ content: string }>(
              'SELECT content FROM documents WHERE id = ? LIMIT 1;',
              [docName]
            );
            if (rows.length > 0 && rows[0].content) {
              const textContent = rows[0].content;
              if (typeof textContent === 'string' && textContent.length > 0) {
                const fragment = data.document.getXmlFragment('prosemirror');
                if (fragment.length === 0) {
                  const p = new Y.XmlElement('paragraph');
                  const t = new Y.XmlText(textContent);
                  p.insert(0, [t]);
                  fragment.insert(0, [p]);
                }
              }
            }
          } catch (err) {
            console.warn(`[HocuspocusServer] Failed to load document ${docName} from SQLite:`, err);
          }
        }

        return data.document;
      },

      /**
       * 2. Store CRDT state when changes are committed
       */
      onStoreDocument: async (data) => {
        const docName = data.documentName;
        const update = Y.encodeStateAsUpdate(data.document);
        this.inMemoryStorage.set(docName, update);

        if (this.db) {
          try {
            // Update the document timestamp or update record in SQLite
            await this.db.executeSql(
              'UPDATE documents SET updated_at = ? WHERE id = ?;',
              [Date.now(), docName]
            );
          } catch (err) {
            console.warn(`[HocuspocusServer] Failed to persist document ${docName} to SQLite:`, err);
          }
        }
      },

      /**
       * 3. Real-time change observer (AI Agent event loop)
       */
      onChange: async (data) => {
        if (options.onDocumentChange) {
          await options.onDocumentChange(data.documentName, data.document);
        }
      },
    });
  }

  public async start(): Promise<string> {
    if (this.isRunning) {
      return this.getWebSocketUrl();
    }

    await this.server.listen();
    this.isRunning = true;
    return this.getWebSocketUrl();
  }

  public getWebSocketUrl(): string {
    return this.server.webSocketURL.replace('//0.0.0.0:', '//127.0.0.1:');
  }

  public getHttpUrl(): string {
    return this.server.httpURL.replace('//0.0.0.0:', '//127.0.0.1:');
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    await this.server.destroy();
    this.isRunning = false;
  }

  /**
   * Directly get or inspect stored binary snapshot for testing
   */
  public getStoredSnapshot(documentName: string): Uint8Array | undefined {
    return this.inMemoryStorage.get(documentName);
  }

  public setStoredSnapshot(documentName: string, snapshot: Uint8Array): void {
    this.inMemoryStorage.set(documentName, snapshot);
  }
}
