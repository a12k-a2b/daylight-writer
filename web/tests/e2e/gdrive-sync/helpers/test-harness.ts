/**
 * tests/e2e/gdrive-sync/helpers/test-harness.ts
 * Hermetic E2E Test Harness for Google Drive & Docs Cloud Synchronization
 *
 * Implements:
 * 1. MockGoogleDriveServer: Complete in-memory HTTP fetch interceptor for Google Drive v3,
 *    Docs v1, UserInfo, and OAuth 2.0 PKCE token endpoints.
 * 2. RFC 7636 PKCE utilities (code verifier, S256 challenge, Base64URL encoding).
 * 3. IOAuthClient reference implementation conforming to PROJECT.md interface contract.
 * 4. DOM & localStorage test environment using happy-dom.
 */

import { Window } from 'happy-dom';
import type { DocumentRecord } from '../../../../src/storage/schema.ts';
import type { GoogleDriveUser } from '../../../../src/sync/google-drive-sync-adapter.ts';

export interface MockDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: string;
  modifiedTime: string;
  createdTime: string;
  version: string;
  revisionId: string;
  webViewLink: string;
  trashed: boolean;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  timestamp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
  timestamp: number;
}

export interface UserInfo {
  email: string;
  name: string;
  picture?: string;
}

export interface IOAuthClient {
  getValidAccessToken(): Promise<string>;
  getUserInfo(): Promise<UserInfo>;
  setDirectToken(token: string): Promise<UserInfo>;
  isAuthenticated(): boolean;
  clearTokens(): void;
}

// ============================================================================
// 1. RFC 7636 PKCE Helper & Cryptographic Oracle
// ============================================================================

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function generateCodeVerifier(length: number = 64): string {
  const safeLength = Math.max(43, Math.min(128, length));
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomBytes = new Uint8Array(safeLength);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < safeLength; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let result = '';
  for (let i = 0; i < safeLength; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hashBuffer));
}

export function verifyCodeChallenge(verifier: string, challenge: string): Promise<boolean> {
  return generateCodeChallenge(verifier).then((derived) => derived === challenge);
}

// ============================================================================
// 2. Mock Google Drive & OAuth Server
// ============================================================================

export class MockGoogleDriveServer {
  public files: Map<string, MockDriveFile> = new Map();
  public folders: Map<string, { id: string; name: string }> = new Map();
  public authTokens: Map<string, { user: UserInfo; refreshToken?: string; expiresAt: number }> = new Map();
  public authCodes: Map<string, { codeVerifierChallenge: string; clientId: string; user: UserInfo }> = new Map();

  public callHistory: RecordedRequest[] = [];
  public simulateFailure: boolean = false;
  public failureStatusCode: number = 500;
  public failureMessage: string = 'Simulated Google Drive API Error';
  public simulateNetworkDelayMs: number = 0;
  public simulateAuthExpired: boolean = false;
  public simulateRateLimit: boolean = false;

  private fileCounter: number = 100;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.files.clear();
    this.folders.clear();
    this.authTokens.clear();
    this.authCodes.clear();
    this.callHistory = [];
    this.simulateFailure = false;
    this.failureStatusCode = 500;
    this.failureMessage = 'Simulated Google Drive API Error';
    this.simulateNetworkDelayMs = 0;
    this.simulateAuthExpired = false;
    this.simulateRateLimit = false;

    // Default pre-authorized test user
    this.authTokens.set('ya29.valid-token', {
      user: {
        email: 'a12katta@gmail.com',
        name: 'Anjan Katta',
        picture: 'https://example.com/avatar.png',
      },
      refreshToken: 'mock-refresh-token-xyz',
      expiresAt: Date.now() + 3600 * 1000,
    });
  }

  public seedFolder(id: string, name: string): void {
    this.folders.set(id, { id, name });
  }

  public seedFile(file: Partial<MockDriveFile> & { id: string; name: string }): MockDriveFile {
    const fullFile: MockDriveFile = {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType || 'application/vnd.google-apps.document',
      parents: file.parents || [],
      content: file.content || '',
      modifiedTime: file.modifiedTime || new Date().toISOString(),
      createdTime: file.createdTime || new Date().toISOString(),
      version: file.version || '1',
      revisionId: file.revisionId || `rev-${Date.now()}`,
      webViewLink: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`,
      trashed: file.trashed || false,
    };
    this.files.set(file.id, fullFile);
    return fullFile;
  }

  public handleRequest(urlStr: string, init?: RequestInit): Response {
    const now = Date.now();
    const method = (init?.method || 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((val, key) => {
          headers[key.toLowerCase()] = val;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) {
          headers[k.toLowerCase()] = v;
        }
      } else {
        for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
          headers[k.toLowerCase()] = v;
        }
      }
    }

    const bodyStr = typeof init?.body === 'string' ? init.body : null;
    this.callHistory.push({
      url: urlStr,
      method,
      headers,
      body: bodyStr,
      timestamp: now,
    });

    // 1. Failure simulations
    if (this.simulateFailure) {
      return new Response(JSON.stringify({ error: { message: this.failureMessage, code: this.failureStatusCode } }), {
        status: this.failureStatusCode,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (this.simulateRateLimit) {
      return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded', code: 429 } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
      });
    }

    const authHeader = headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (this.simulateAuthExpired && !urlStr.includes('/oauth2/v4/token') && !urlStr.includes('/token')) {
      return new Response(JSON.stringify({ error: { message: 'Invalid Credentials (expired)', code: 401 } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(urlStr);

    // 2. Google OAuth UserInfo Endpoint
    if (url.pathname.includes('/userinfo')) {
      if (!token) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }
      const tokenData = this.authTokens.get(token);
      if (token.startsWith('mock-') || token === 'valid-bearer-token' || token.startsWith('ya29.')) {
        return new Response(
          JSON.stringify(
            tokenData?.user || {
              email: 'a12katta@gmail.com',
              name: 'Anjan Katta',
              picture: 'https://lh3.googleusercontent.com/a/default-user',
            }
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
    }

    // 3. OAuth Token Exchange / Refresh Endpoint
    if (url.pathname.includes('/token')) {
      let params: URLSearchParams;
      if (bodyStr) {
        params = new URLSearchParams(bodyStr);
      } else {
        params = url.searchParams;
      }

      const grantType = params.get('grant_type');
      if (grantType === 'authorization_code') {
        const code = params.get('code');
        const verifier = params.get('code_verifier');
        const authData = code ? this.authCodes.get(code) : null;

        if (!authData || !verifier) {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        }

        const newAccessToken = `ya29.access-${Date.now()}`;
        const newRefreshToken = `1//refresh-${Date.now()}`;
        this.authTokens.set(newAccessToken, {
          user: authData.user,
          refreshToken: newRefreshToken,
          expiresAt: Date.now() + 3600 * 1000,
        });

        return new Response(
          JSON.stringify({
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'https://www.googleapis.com/auth/drive.file',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } else if (grantType === 'refresh_token') {
        const refreshToken = params.get('refresh_token');
        if (!refreshToken || refreshToken === 'invalid-refresh-token') {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        }

        const newAccessToken = `ya29.refreshed-${Date.now()}`;
        this.authTokens.set(newAccessToken, {
          user: {
            email: 'a12katta@gmail.com',
            name: 'Anjan Katta',
          },
          refreshToken,
          expiresAt: Date.now() + 3600 * 1000,
        });

        return new Response(
          JSON.stringify({
            access_token: newAccessToken,
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 4. Google Drive v3 Files Search & List (GET /drive/v3/files)
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const matchingFiles: Array<{
        id: string;
        name: string;
        mimeType: string;
        modifiedTime?: string;
        createdTime?: string;
        version?: string;
        revisionId?: string;
        webViewLink?: string;
        trashed?: boolean;
      }> = [];

      // Check folder search
      if (q.includes("mimeType = 'application/vnd.google-apps.folder'") || q.includes('application/vnd.google-apps.folder')) {
        for (const [folderId, folder] of this.folders.entries()) {
          if (q.includes(`'${folder.name}'`) || q.includes(folder.name)) {
            matchingFiles.push({
              id: folderId,
              name: folder.name,
              mimeType: 'application/vnd.google-apps.folder',
            });
          }
        }
        return new Response(JSON.stringify({ files: matchingFiles }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check files in parent folder
      const parentMatch = q.match(/parents\s+in\s+'([^']+)'/i) || q.match(/'([^']+)'\s+in\s+parents/i);
      const parentFolderId = parentMatch ? parentMatch[1] : null;

      for (const file of this.files.values()) {
        if (file.trashed && !q.includes('trashed = true')) continue;
        if (parentFolderId && !file.parents.includes(parentFolderId)) continue;
        matchingFiles.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          createdTime: file.createdTime,
          version: file.version,
          revisionId: file.revisionId,
          webViewLink: file.webViewLink,
          trashed: file.trashed,
        });
      }

      return new Response(JSON.stringify({ files: matchingFiles }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 5. Google Drive v3 Folder Creation (POST /drive/v3/files)
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      let data: any = {};
      try {
        data = JSON.parse(bodyStr || '{}');
      } catch {}

      const folderId = `folder-${Date.now()}`;
      const folderName = data.name || 'Daylight Manuscripts';
      this.folders.set(folderId, { id: folderId, name: folderName });

      return new Response(
        JSON.stringify({
          id: folderId,
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. Multipart Upload: Document Creation (POST /upload/drive/v3/files?uploadType=multipart)
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const uploadType = url.searchParams.get('uploadType');
      if (uploadType === 'multipart') {
        const fileId = `gdoc-${Date.now()}-${++this.fileCounter}`;
        let parsedMetadata: any = {};
        let parsedContent = '';

        if (bodyStr) {
          // Extract JSON metadata part
          const metaMatch = bodyStr.match(/\{[\s\S]*?\}/);
          if (metaMatch) {
            try {
              parsedMetadata = JSON.parse(metaMatch[0]);
            } catch {}
          }
          // Extract content part after second boundary header
          const parts = bodyStr.split(/\r?\n--[^\r\n]+\r?\n/);
          if (parts.length >= 3) {
            const contentPart = parts[2];
            const contentBodyStart = contentPart.indexOf('\r\n\r\n');
            if (contentBodyStart !== -1) {
              parsedContent = contentPart.slice(contentBodyStart + 4).replace(/\r?\n--[^\r\n]+--/, '');
            } else {
              parsedContent = contentPart;
            }
          }
        }

        const name = parsedMetadata.name || 'Untitled Document';
        const mimeType = parsedMetadata.mimeType || 'application/vnd.google-apps.document';
        const parents = parsedMetadata.parents || [];

        const createdFile: MockDriveFile = {
          id: fileId,
          name,
          mimeType,
          parents,
          content: parsedContent,
          modifiedTime: new Date().toISOString(),
          createdTime: new Date().toISOString(),
          version: '1',
          revisionId: `rev-${Date.now()}-1`,
          webViewLink: `https://docs.google.com/document/d/${fileId}/edit`,
          trashed: false,
        };

        this.files.set(fileId, createdFile);

        return new Response(
          JSON.stringify({
            id: fileId,
            name: createdFile.name,
            mimeType: createdFile.mimeType,
            webViewLink: createdFile.webViewLink,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 6b. Google Docs API v1: GET Document (GET /v1/documents/{documentId})
    const docGetMatch = url.pathname.match(/\/v1\/documents\/([^/:]+)$/);
    if (docGetMatch && method === 'GET') {
      const docId = docGetMatch[1];
      const file = this.files.get(docId);
      if (!file || file.trashed) {
        return new Response(JSON.stringify({ error: { message: 'Document not found', code: 404 } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const contentLen = (file.content || '').length;
      const structuralElements: any[] = [{ endIndex: 1, sectionBreak: {} }];
      if (contentLen > 0) {
        structuralElements.push({
          startIndex: 1,
          endIndex: 1 + contentLen + 1,
          paragraph: {
            elements: [
              {
                startIndex: 1,
                endIndex: 1 + contentLen + 1,
                textRun: { content: file.content + '\n' },
              },
            ],
          },
        });
      }

      return new Response(
        JSON.stringify({
          documentId: file.id,
          title: file.name,
          body: { content: structuralElements },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6c. Google Docs API v1: batchUpdate (POST /v1/documents/{documentId}:batchUpdate)
    const docBatchMatch = url.pathname.match(/\/v1\/documents\/([^/:]+):batchUpdate$/);
    if (docBatchMatch && method === 'POST') {
      const docId = docBatchMatch[1];
      const file = this.files.get(docId);
      if (!file || file.trashed) {
        return new Response(JSON.stringify({ error: { message: 'Document not found', code: 404 } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let payload: any = {};
      try {
        payload = JSON.parse(bodyStr || '{}');
      } catch {}

      const requests = payload.requests || [];
      for (const req of requests) {
        if (req.deleteContentRange) {
          file.content = '';
        } else if (req.insertText) {
          file.content = (file.content || '') + (req.insertText.text || '');
        }
      }

      file.modifiedTime = new Date().toISOString();
      const currentVer = parseInt(file.version || '1', 10);
      file.version = String(currentVer + 1);
      file.revisionId = `rev-${Date.now()}-${file.version}`;

      return new Response(
        JSON.stringify({
          documentId: file.id,
          replies: requests.map(() => ({})),
          revisionId: file.revisionId,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6d. Google Drive v3 Metadata PATCH (PATCH /drive/v3/files/{id})
    const metaPatchMatch = url.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
    if (metaPatchMatch && method === 'PATCH') {
      const fileId = metaPatchMatch[1];
      const file = this.files.get(fileId);
      if (!file || file.trashed) {
        return new Response(JSON.stringify({ error: { message: 'File not found', code: 404 } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let data: any = {};
      try {
        data = JSON.parse(bodyStr || '{}');
      } catch {}

      if (data.name !== undefined) file.name = data.name;
      if (data.trashed !== undefined) file.trashed = Boolean(data.trashed);
      file.modifiedTime = new Date().toISOString();

      return new Response(
        JSON.stringify({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          version: file.version,
          webViewLink: file.webViewLink,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 7. Media Patch: Update Existing Google Doc (PATCH /upload/drive/v3/files/{id}?uploadType=media)
    const patchMatch = url.pathname.match(/\/upload\/drive\/v3\/files\/([^/]+)/);
    if (patchMatch && method === 'PATCH') {
      const fileId = patchMatch[1];
      const existing = this.files.get(fileId);
      if (!existing) {
        return new Response(JSON.stringify({ error: { message: 'File not found', code: 404 } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      existing.content = bodyStr || '';
      existing.modifiedTime = new Date().toISOString();
      existing.revisionId = `rev-${Date.now()}-${parseInt(existing.version || '1') + 1}`;
      existing.version = String(parseInt(existing.version || '1') + 1);

      return new Response(
        JSON.stringify({
          id: existing.id,
          name: existing.name,
          mimeType: existing.mimeType,
          webViewLink: existing.webViewLink,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 8. Export Google Doc Content (GET /drive/v3/files/{id}/export)
    const exportMatch = url.pathname.match(/\/drive\/v3\/files\/([^/]+)\/export/);
    if (exportMatch && method === 'GET') {
      const fileId = exportMatch[1];
      const file = this.files.get(fileId);
      if (!file) {
        return new Response('File not found', { status: 404 });
      }
      return new Response(file.content, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // Default 404
    return new Response(JSON.stringify({ error: 'Not found', path: url.pathname }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ============================================================================
// 3. Mock IOOAuthClient Reference Implementation
// ============================================================================

export class MockOAuthClient implements IOAuthClient {
  private tokens: AuthTokens | null = null;
  private userInfo: UserInfo | null = null;
  public server: MockGoogleDriveServer;

  constructor(server: MockGoogleDriveServer) {
    this.server = server;
  }

  public async getValidAccessToken(): Promise<string> {
    if (!this.tokens) {
      throw new Error('Not authenticated: no access token');
    }

    // Check expiry
    const now = Date.now();
    const expiry = this.tokens.timestamp + (this.tokens.expiresIn || 3600) * 1000;
    if (now >= expiry && this.tokens.refreshToken) {
      // Refresh
      const refreshed = await this.refreshToken(this.tokens.refreshToken);
      this.tokens = refreshed;
    }

    return this.tokens.accessToken;
  }

  public async getUserInfo(): Promise<UserInfo> {
    if (this.userInfo) return this.userInfo;
    const token = await this.getValidAccessToken();
    const res = await this.server.handleRequest('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`UserInfo query failed (${res.status})`);
    const data = await res.json();
    this.userInfo = {
      email: data.email || 'a12katta@gmail.com',
      name: data.name || 'Anjan Katta',
      picture: data.picture,
    };
    return this.userInfo;
  }

  public async setDirectToken(token: string): Promise<UserInfo> {
    this.tokens = {
      accessToken: token,
      tokenType: 'Bearer',
      timestamp: Date.now(),
      expiresIn: 3600,
    };
    return this.getUserInfo();
  }

  public isAuthenticated(): boolean {
    return !!this.tokens?.accessToken;
  }

  public clearTokens(): void {
    this.tokens = null;
    this.userInfo = null;
  }

  public setTokens(tokens: AuthTokens): void {
    this.tokens = tokens;
  }

  public async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const res = await this.server.handleRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!res.ok) throw new Error('Refresh token invalid or expired');
    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in || 3600,
      tokenType: data.token_type || 'Bearer',
      timestamp: Date.now(),
    };
  }
}

// ============================================================================
// 4. In-Memory Test Storage Repository with Full Google Drive Fields
// ============================================================================

export class GDriveTestStorageRepository {
  private documents: Map<string, DocumentRecord> = new Map();

  async init(): Promise<void> {}

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const doc = this.documents.get(id);
    if (!doc) return null;
    return { ...doc };
  }

  async listDocuments(options?: { includeDeleted?: boolean }): Promise<DocumentRecord[]> {
    let list = Array.from(this.documents.values());
    if (!options?.includeDeleted) {
      list = list.filter((d) => d.deleted_at === null);
    }
    return list.map((d) => ({ ...d }));
  }

  async saveDocument(doc: Partial<DocumentRecord> & { id: string }): Promise<DocumentRecord> {
    const now = Date.now();
    const existing = this.documents.get(doc.id);

    const fullDoc: DocumentRecord = {
      id: doc.id,
      title: doc.title !== undefined ? (doc.title.trim().length > 0 ? doc.title : 'Untitled') : (existing?.title ?? 'Untitled'),
      content: doc.content ?? existing?.content ?? '',
      created_at: existing?.created_at ?? doc.created_at ?? now,
      updated_at: doc.updated_at ?? now,
      deleted_at: doc.deleted_at !== undefined ? doc.deleted_at : (existing?.deleted_at ?? null),
      is_title_custom: doc.is_title_custom ?? existing?.is_title_custom ?? false,
      format_version: doc.format_version ?? existing?.format_version ?? 1,
      sync_status: doc.sync_status ?? existing?.sync_status ?? 'pending',
      google_drive_file_id: doc.google_drive_file_id !== undefined ? doc.google_drive_file_id : (existing?.google_drive_file_id ?? null),
      google_drive_revision_id: doc.google_drive_revision_id !== undefined ? doc.google_drive_revision_id : (existing?.google_drive_revision_id ?? null),
      last_synced_at: doc.last_synced_at !== undefined ? doc.last_synced_at : (existing?.last_synced_at ?? null),
      version_vector: doc.version_vector ?? existing?.version_vector ?? 1,
      parent_id: doc.parent_id !== undefined ? doc.parent_id : (existing?.parent_id ?? null),
      sort_order: doc.sort_order !== undefined ? doc.sort_order : (existing?.sort_order ?? 0),
      synopsis: doc.synopsis !== undefined ? doc.synopsis : (existing?.synopsis ?? ''),
      item_type: doc.item_type !== undefined ? doc.item_type : (existing?.item_type ?? 'document'),
    };

    this.documents.set(doc.id, fullDoc);
    return { ...fullDoc };
  }

  async deleteDocument(id: string): Promise<void> {
    const existing = this.documents.get(id);
    if (existing) {
      existing.deleted_at = Date.now();
      existing.updated_at = Date.now();
      existing.sync_status = 'pending';
    }
  }

  async findByDriveFileId(fileId: string): Promise<DocumentRecord | null> {
    for (const doc of this.documents.values()) {
      if (doc.google_drive_file_id === fileId) {
        return { ...doc };
      }
    }
    return null;
  }

  async flushPendingEdits(): Promise<void> {}

  async updateSyncMetadata(
    id: string,
    metadata: {
      google_drive_file_id?: string | null;
      google_drive_revision_id?: string | null;
      last_synced_at?: number | null;
      sync_status?: DocumentRecord['sync_status'];
    }
  ): Promise<void> {
    const doc = this.documents.get(id);
    if (doc) {
      if (metadata.google_drive_file_id !== undefined) doc.google_drive_file_id = metadata.google_drive_file_id;
      if (metadata.google_drive_revision_id !== undefined) doc.google_drive_revision_id = metadata.google_drive_revision_id;
      if (metadata.last_synced_at !== undefined) doc.last_synced_at = metadata.last_synced_at;
      if (metadata.sync_status !== undefined) doc.sync_status = metadata.sync_status;
    }
  }
}

// ============================================================================
// 5. Test Environment Setup & Teardown
// ============================================================================

export interface TestEnv {
  win: Window;
  server: MockGoogleDriveServer;
  oauthClient: MockOAuthClient;
  cleanup: () => void;
}

export function setupGDriveTestEnv(): TestEnv {
  const win = new Window();
  const server = new MockGoogleDriveServer();
  const oauthClient = new MockOAuthClient(server);

  const prevWindow = (globalThis as any).window;
  const prevDoc = (globalThis as any).document;
  const prevStorage = (globalThis as any).localStorage;
  const prevFetch = globalThis.fetch;
  const prevHTMLElement = (globalThis as any).HTMLElement;
  const prevKeyboardEvent = (globalThis as any).KeyboardEvent;

  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).localStorage = win.localStorage;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).HTMLInputElement = win.HTMLInputElement;
  (globalThis as any).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as any).HTMLAnchorElement = win.HTMLAnchorElement;
  (globalThis as any).KeyboardEvent = win.KeyboardEvent;
  (globalThis as any).MouseEvent = win.MouseEvent;
  (globalThis as any).Event = win.Event;

  // Intercept fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    return Promise.resolve(server.handleRequest(url, init));
  }) as any;

  const cleanup = () => {
    server.reset();
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDoc;
    (globalThis as any).localStorage = prevStorage;
    (globalThis as any).HTMLElement = prevHTMLElement;
    (globalThis as any).KeyboardEvent = prevKeyboardEvent;
    globalThis.fetch = prevFetch;
  };

  return { win, server, oauthClient, cleanup };
}
