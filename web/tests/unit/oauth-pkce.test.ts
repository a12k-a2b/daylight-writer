/**
 * tests/unit/oauth-pkce.test.ts
 * Unit tests for RFC 7636 PKCE cryptographic functions, Google OAuth 2.0 URL construction,
 * token exchange, silent refresh, UserInfo verification, and OAuthPKCEClient.
 */

import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import type {
  AuthTokens,
  UserInfo,
  OAuthOptions,
  TokenResponse,
} from '../../src/sync/oauth-pkce.ts';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  base64UrlEncode,
  base64UrlDecode,
  generateRandomState,
  normalizeScopes,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  fetchGoogleUserInfo,
  isTokenExpired,
  OAuthPKCEClient,
  OAuthError,
  PKCE_CHARSET,
  GOOGLE_OAUTH_CONFIG,
  inFlightRefreshPromises,
} from '../../src/sync/oauth-pkce.ts';

describe('OAuth 2.0 PKCE Cryptographic Module (RFC 7636)', () => {
  // --------------------------------------------------------------------------
  // 1. Code Verifier Generation
  // --------------------------------------------------------------------------
  describe('generateCodeVerifier', () => {
    test('generates default 64-character verifier adhering to RFC 7636 charset', () => {
      const verifier = generateCodeVerifier();
      assert.strictEqual(verifier.length, 64);

      const rfc7636Regex = /^[A-Za-z0-9\-._~]+$/;
      assert.ok(rfc7636Regex.test(verifier), `Verifier contains only unreserved chars: ${verifier}`);
    });

    test('clamps verifier length within RFC 7636 bounds [43, 128]', () => {
      const clampedMin = generateCodeVerifier(10);
      assert.strictEqual(clampedMin.length, 43, 'Length < 43 must clamp to 43');

      const clampedMax = generateCodeVerifier(250);
      assert.strictEqual(clampedMax.length, 128, 'Length > 128 must clamp to 128');

      const exact = generateCodeVerifier(80);
      assert.strictEqual(exact.length, 80);
    });

    test('produces distinct high-entropy verifiers across multiple invocations', () => {
      const v1 = generateCodeVerifier(64);
      const v2 = generateCodeVerifier(64);
      const v3 = generateCodeVerifier(64);

      assert.notStrictEqual(v1, v2);
      assert.notStrictEqual(v2, v3);
      assert.notStrictEqual(v1, v3);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Code Challenge Generation & RFC 7636 Appendix B Vector
  // --------------------------------------------------------------------------
  describe('generateCodeChallenge', () => {
    test('strictly matches RFC 7636 Appendix B official test vector', async () => {
      // RFC 7636 Appendix B test vector:
      // Code Verifier: dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
      // Code Challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
      const rfcTestVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      const calculatedChallenge = await generateCodeChallenge(rfcTestVerifier);
      assert.strictEqual(
        calculatedChallenge,
        expectedChallenge,
        'SHA-256 S256 challenge must match RFC 7636 Appendix B vector exactly'
      );

      const isValid = await verifyCodeChallenge(rfcTestVerifier, expectedChallenge);
      assert.strictEqual(isValid, true);
    });

    test('verifyCodeChallenge rejects mismatched or tampered challenges', async () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const tamperedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cX';

      const isValid = await verifyCodeChallenge(verifier, tamperedChallenge);
      assert.strictEqual(isValid, false);
    });

    test('rejects verifiers shorter than 43 characters with OAuthError', async () => {
      await assert.rejects(
        async () => {
          await generateCodeChallenge('too-short');
        },
        (err: any) => {
          assert.strictEqual(err instanceof OAuthError, true);
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'invalid_request');
          assert.match(err.message, /between 43 and 128 characters/);
          return true;
        }
      );
    });

    test('rejects verifiers longer than 128 characters (length 129 and 1000) with OAuthError', async () => {
      // Upper bound limit: 128 is valid
      const validBoundaryVerifier = 'B'.repeat(128);
      const ch128 = await generateCodeChallenge(validBoundaryVerifier);
      assert.strictEqual(typeof ch128, 'string');
      assert.strictEqual(ch128.length, 43);

      // Length 129 exceeds RFC 7636 §4.1 limit
      await assert.rejects(
        async () => {
          await generateCodeChallenge('C'.repeat(129));
        },
        (err: any) => {
          assert.strictEqual(err instanceof OAuthError, true);
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'invalid_request');
          assert.match(err.message, /between 43 and 128 characters/);
          return true;
        }
      );

      // Length 1000 exceeds RFC 7636 §4.1 limit
      await assert.rejects(
        async () => {
          await generateCodeChallenge('C'.repeat(1000));
        },
        (err: any) => {
          assert.strictEqual(err instanceof OAuthError, true);
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'invalid_request');
          assert.match(err.message, /between 43 and 128 characters/);
          return true;
        }
      );
    });

    test('rejects non-string verifiers with OAuthError', async () => {
      const nonStringInputs = [null, undefined, 12345, {}, []];
      for (const input of nonStringInputs) {
        await assert.rejects(
          async () => {
            await generateCodeChallenge(input as any);
          },
          (err: any) => {
            assert.strictEqual(err instanceof OAuthError, true);
            assert.strictEqual(err.status, 400);
            assert.strictEqual(err.code, 'invalid_request');
            assert.match(err.message, /between 43 and 128 characters/);
            return true;
          }
        );
      }
    });

    test('verifyCodeChallenge verifies bounds and rejects out-of-range verifiers', async () => {
      const validVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      // Valid matches
      assert.strictEqual(await verifyCodeChallenge(validVerifier, expectedChallenge), true);

      // Bounds violations return false
      assert.strictEqual(await verifyCodeChallenge('too-short', expectedChallenge), false);
      assert.strictEqual(await verifyCodeChallenge('C'.repeat(129), expectedChallenge), false);
      assert.strictEqual(await verifyCodeChallenge('C'.repeat(1000), expectedChallenge), false);
      assert.strictEqual(await verifyCodeChallenge(null as any, expectedChallenge), false);
      assert.strictEqual(await verifyCodeChallenge(undefined as any, expectedChallenge), false);
      assert.strictEqual(await verifyCodeChallenge(validVerifier, ''), false);
      assert.strictEqual(await verifyCodeChallenge(validVerifier, null as any), false);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Base64URL Encoding & Decoding
  // --------------------------------------------------------------------------
  describe('base64UrlEncode & base64UrlDecode', () => {
    test('removes trailing padding and replaces URL-unsafe characters', () => {
      // Buffer that would normally have '+' or '/' and '=' in standard Base64
      const testBytes = new Uint8Array([251, 255, 254, 253]);
      const encoded = base64UrlEncode(testBytes);

      assert.strictEqual(encoded.includes('+'), false);
      assert.strictEqual(encoded.includes('/'), false);
      assert.strictEqual(encoded.includes('='), false);

      const decoded = base64UrlDecode(encoded);
      assert.deepStrictEqual(Array.from(decoded), Array.from(testBytes));
    });

    test('handles empty buffer roundtrip cleanly', () => {
      const empty = new Uint8Array([]);
      const encoded = base64UrlEncode(empty);
      assert.strictEqual(encoded, '');
      const decoded = base64UrlDecode(encoded);
      assert.strictEqual(decoded.length, 0);
    });
  });

  // --------------------------------------------------------------------------
  // 4. State & Scope Helpers
  // --------------------------------------------------------------------------
  describe('State and Scope Helpers', () => {
    test('generateRandomState generates URL-safe nonce with default length', () => {
      const state = generateRandomState();
      assert.ok(state.length >= 32);
      assert.ok(/^[A-Za-z0-9\-_]+$/.test(state));
    });

    test('normalizeScopes expands aliases into full Google OAuth URIs', () => {
      const scopes = ['drive.file', 'userinfo.email', 'custom.scope'];
      const normalized = normalizeScopes(scopes);

      assert.ok(normalized.includes('https://www.googleapis.com/auth/drive.file'));
      assert.ok(normalized.includes('https://www.googleapis.com/auth/userinfo.email'));
      assert.ok(normalized.includes('custom.scope'));
    });
  });

  // --------------------------------------------------------------------------
  // 5. Authorization URL Builder
  // --------------------------------------------------------------------------
  describe('buildAuthorizationUrl', () => {
    const defaultOptions: OAuthOptions = {
      clientId: 'test-client-id-12345.apps.googleusercontent.com',
      redirectUri: 'https://daylight-writer.web.app/oauth/callback',
      scopes: ['drive.file', 'userinfo.email'],
      state: 'nonce-state-abc',
      codeChallenge: 'challenge-s256-string',
      codeChallengeMethod: 'S256',
      accessType: 'offline',
      prompt: 'consent',
    };

    test('constructs valid Google OAuth authorization URL with all parameters', () => {
      const urlStr = buildAuthorizationUrl(defaultOptions);
      const url = new URL(urlStr);

      assert.strictEqual(url.origin, 'https://accounts.google.com');
      assert.strictEqual(url.pathname, '/o/oauth2/v2/auth');
      assert.strictEqual(url.searchParams.get('client_id'), defaultOptions.clientId);
      assert.strictEqual(url.searchParams.get('redirect_uri'), defaultOptions.redirectUri);
      assert.strictEqual(url.searchParams.get('response_type'), 'code');
      assert.strictEqual(url.searchParams.get('access_type'), 'offline');
      assert.strictEqual(url.searchParams.get('prompt'), 'consent');
      assert.strictEqual(url.searchParams.get('state'), 'nonce-state-abc');
      assert.strictEqual(url.searchParams.get('code_challenge'), 'challenge-s256-string');
      assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
      assert.strictEqual(url.searchParams.get('include_granted_scopes'), 'true');
    });

    test('throws error when required fields are missing', () => {
      assert.throws(() => {
        buildAuthorizationUrl({ clientId: '', redirectUri: 'https://app' });
      }, /clientId is required/);

      assert.throws(() => {
        buildAuthorizationUrl({ clientId: 'id', redirectUri: '' });
      }, /redirectUri is required/);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Token Exchange & Refresh
  // --------------------------------------------------------------------------
  describe('exchangeAuthorizationCode & refreshAccessToken', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = originalFetch;
    });

    test('exchangeAuthorizationCode posts parameters and parses JSON tokens', async () => {
      let postedBody = '';
      let postedHeaders: any = null;

      global.fetch = (async (url: string, init: any) => {
        postedBody = init.body;
        postedHeaders = init.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'ya29.mock-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: '1//mock-refresh-token',
          }),
        };
      }) as any;

      try {
        const response = await exchangeAuthorizationCode('auth-code-77', 'test-verifier-abc', {
          clientId: 'client-1',
          redirectUri: 'https://app/callback',
        });

        assert.strictEqual(response.access_token, 'ya29.mock-access-token');
        assert.strictEqual(response.refresh_token, '1//mock-refresh-token');
        assert.strictEqual(response.expires_in, 3600);
        assert.ok(postedBody.includes('grant_type=authorization_code'));
        assert.ok(postedBody.includes('code=auth-code-77'));
        assert.ok(postedBody.includes('code_verifier=test-verifier-abc'));
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('exchangeAuthorizationCode throws OAuthError on server error', async () => {
      global.fetch = (async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'Code expired' }),
      })) as any;

      try {
        await assert.rejects(async () => {
          await exchangeAuthorizationCode('expired-code', 'verifier', {
            clientId: 'c1',
            redirectUri: 'https://app',
          });
        }, (err: any) => {
          assert.strictEqual(err instanceof OAuthError, true);
          assert.strictEqual(err.status, 400);
          assert.ok(err.message.includes('Code expired'));
          return true;
        });
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('refreshAccessToken sends refresh_token grant and preserves existing refresh token', async () => {
      global.fetch = (async (url: string, init: any) => {
        assert.ok(init.body.includes('grant_type=refresh_token'));
        assert.ok(init.body.includes('refresh_token=existing-refresh-token'));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'ya29.new-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            // refresh_token omitted by Google
          }),
        };
      }) as any;

      try {
        const response = await refreshAccessToken('existing-refresh-token', {
          clientId: 'client-1',
          redirectUri: 'https://app',
        });

        assert.strictEqual(response.access_token, 'ya29.new-access-token');
        assert.strictEqual(response.refresh_token, 'existing-refresh-token');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('refreshAccessToken deduplicates 50 concurrent requests into 1 network call', async () => {
      let fetchCount = 0;
      global.fetch = (async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 20));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'ya29.dedup-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        };
      }) as any;

      try {
        const promises = Array.from({ length: 50 }, () =>
          refreshAccessToken('test-refresh-token', {
            clientId: 'dedup-client',
            redirectUri: 'https://app/callback',
          })
        );

        const results = await Promise.all(promises);
        assert.strictEqual(fetchCount, 1, 'Exactly 1 network request must be dispatched');
        assert.strictEqual(results.length, 50);
        assert.ok(results.every((res) => res.access_token === 'ya29.dedup-token'));
        assert.strictEqual(inFlightRefreshPromises.size, 0, 'Deduplication cache must be clean after completion');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('refreshAccessToken aborts and throws OAuthError with 408 status on timeout', async () => {
      global.fetch = (async (url: string, init: any) => {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              const err: any = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }) as any;

      try {
        await assert.rejects(async () => {
          await refreshAccessToken('slow-refresh-token', {
            clientId: 'client-timeout',
            redirectUri: 'https://app/callback',
            timeoutMs: 30,
          });
        }, (err: any) => {
          assert.strictEqual(err instanceof OAuthError, true);
          assert.strictEqual(err.status, 408);
          assert.ok(err.message.includes('timed out'));
          assert.ok(err.message.includes('timeout'));
          assert.strictEqual(err.details?.code, 'timeout');
          return true;
        });

        assert.strictEqual(inFlightRefreshPromises.size, 0, 'Deduplication cache must be clean after timeout');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('exchangeAuthorizationCode aborts and throws OAuthError with 408 status on timeout', async () => {
      global.fetch = (async (url: string, init: any) => {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              const err: any = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }) as any;

      try {
        await assert.rejects(async () => {
          await exchangeAuthorizationCode('slow-code', 'verifier-1234567890123456789012345678901234567890123', {
            clientId: 'client-timeout',
            redirectUri: 'https://app/callback',
            timeoutMs: 30,
          });
        }, (err: any) => {
          assert.strictEqual(err instanceof OAuthError, true);
          assert.strictEqual(err.status, 408);
          assert.ok(err.message.includes('timed out'));
          assert.ok(err.message.includes('timeout'));
          assert.strictEqual(err.details?.code, 'timeout');
          return true;
        });
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // --------------------------------------------------------------------------
  // 7. Google UserInfo Verification & Hermetic Mock
  // --------------------------------------------------------------------------
  describe('fetchGoogleUserInfo', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = originalFetch;
    });

    test('instantly returns mock user for mock-token-* without network calls', async () => {
      let fetchCalled = false;
      global.fetch = (async () => {
        fetchCalled = true;
        throw new Error('Network should not be called for mock token');
      }) as any;

      try {
        const user = await fetchGoogleUserInfo('mock-token-hermetic-test');
        assert.strictEqual(fetchCalled, false, 'Must not dispatch HTTP request');
        assert.strictEqual(user.email, 'a12katta@gmail.com');
        assert.strictEqual(user.name, 'Anjan Katta');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('instantly returns mock user for test-token-* without network calls', async () => {
      let fetchCalled = false;
      global.fetch = (async () => {
        fetchCalled = true;
        throw new Error('Network should not be called');
      }) as any;

      try {
        const user = await fetchGoogleUserInfo('test-token-offline');
        assert.strictEqual(fetchCalled, false);
        assert.strictEqual(user.email, 'a12katta@gmail.com');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('dispatches authenticated request to Google UserInfo endpoint for live tokens', async () => {
      let authHeader = '';
      global.fetch = (async (url: string, init: any) => {
        authHeader = init?.headers?.Authorization;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            email: 'a12katta@gmail.com',
            name: 'Anjan Katta',
            picture: 'https://lh3.googleusercontent.com/avatar',
          }),
        };
      }) as any;

      try {
        const user = await fetchGoogleUserInfo('ya29.live-token-123');
        assert.strictEqual(authHeader, 'Bearer ya29.live-token-123');
        assert.strictEqual(user.email, 'a12katta@gmail.com');
        assert.strictEqual(user.name, 'Anjan Katta');
        assert.strictEqual(user.picture, 'https://lh3.googleusercontent.com/avatar');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('handles timeout via AbortController', async () => {
      global.fetch = (async (url: string, init: any) => {
        return new Promise((resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              const err: any = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }) as any;

      try {
        await assert.rejects(async () => {
          await fetchGoogleUserInfo('ya29.slow-token', { timeoutMs: 50 });
        }, (err: any) => {
          assert.strictEqual(err.status, 408);
          assert.ok(err.message.includes('timed out'));
          return true;
        });
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // --------------------------------------------------------------------------
  // 8. Token Expiration Calculation
  // --------------------------------------------------------------------------
  describe('isTokenExpired', () => {
    test('evaluates fresh and expired tokens accurately', () => {
      const now = Date.now();

      const freshToken: AuthTokens = {
        accessToken: 'ya29.fresh',
        expiresIn: 3600,
        tokenType: 'Bearer',
        timestamp: now,
      };
      assert.strictEqual(isTokenExpired(freshToken), false);

      const expiredToken: AuthTokens = {
        accessToken: 'ya29.expired',
        expiresIn: 3600,
        tokenType: 'Bearer',
        timestamp: now - 3700 * 1000,
      };
      assert.strictEqual(isTokenExpired(expiredToken), true);

      const nearExpirationToken: AuthTokens = {
        accessToken: 'ya29.near-expiration',
        expiresIn: 3600,
        tokenType: 'Bearer',
        timestamp: now - 3560 * 1000, // 40s left, within default 60s buffer
      };
      assert.strictEqual(isTokenExpired(nearExpirationToken, 60), true);
    });

    test('recognizes expiresIn: 0 as immediately expired', () => {
      const immediateExpired: AuthTokens = {
        accessToken: 'ya29.zero-expiry',
        expiresIn: 0,
        tokenType: 'Bearer',
        timestamp: Date.now(),
      };
      assert.strictEqual(isTokenExpired(immediateExpired), true);
    });

    test('returns false when expiresIn is undefined or null', () => {
      const indefiniteToken: AuthTokens = {
        accessToken: 'ya29.indefinite',
        tokenType: 'Bearer',
        timestamp: Date.now(),
      };
      assert.strictEqual(isTokenExpired(indefiniteToken), false);
    });
  });

  // --------------------------------------------------------------------------
  // 9. Stateful OAuthPKCEClient (IOAuthClient)
  // --------------------------------------------------------------------------
  describe('OAuthPKCEClient', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = originalFetch;
    });

    test('initializes with unauthenticated status and manages token state', () => {
      const client = new OAuthPKCEClient({
        clientId: 'client-id',
        redirectUri: 'https://app/callback',
      });

      assert.strictEqual(client.isAuthenticated(), false);
      assert.strictEqual(client.getTokens(), null);

      client.setTokens({
        accessToken: 'ya29.test-token',
        tokenType: 'Bearer',
        timestamp: Date.now(),
      });

      assert.strictEqual(client.isAuthenticated(), true);
      assert.strictEqual(client.getTokens()?.accessToken, 'ya29.test-token');

      client.clearTokens();
      assert.strictEqual(client.isAuthenticated(), false);
      assert.strictEqual(client.getTokens(), null);
    });

    test('setDirectToken works with mock tokens without network', async () => {
      const client = new OAuthPKCEClient({
        clientId: 'client-id',
        redirectUri: 'https://app/callback',
      });

      const user = await client.setDirectToken('mock-token-fast');
      assert.strictEqual(client.isAuthenticated(), true);
      assert.strictEqual(user.email, 'a12katta@gmail.com');
      assert.strictEqual(user.name, 'Anjan Katta');

      const userCached = await client.getUserInfo();
      assert.strictEqual(userCached.email, 'a12katta@gmail.com');
    });

    test('getValidAccessToken automatically refreshes when expired', async () => {
      global.fetch = (async (url: string, init: any) => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'ya29.refreshed-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        };
      }) as any;

      try {
        const client = new OAuthPKCEClient(
          { clientId: 'client-id', redirectUri: 'https://app/callback' },
          {
            accessToken: 'ya29.old-expired',
            refreshToken: 'refresh-token-123',
            expiresIn: 10,
            tokenType: 'Bearer',
            timestamp: Date.now() - 20000, // expired
          }
        );

        const token = await client.getValidAccessToken();
        assert.strictEqual(token, 'ya29.refreshed-access-token');
        assert.strictEqual(client.getTokens()?.accessToken, 'ya29.refreshed-access-token');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('startAuthorizationFlow generates auth URL with PKCE challenge', async () => {
      const client = new OAuthPKCEClient({
        clientId: 'test-client',
        redirectUri: 'https://app/callback',
      });

      const authUrl = await client.startAuthorizationFlow();
      const url = new URL(authUrl);

      assert.strictEqual(url.origin, 'https://accounts.google.com');
      assert.ok(url.searchParams.has('code_challenge'));
      assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(url.searchParams.has('state'));
    });

    test('handleAuthorizationCallback throws OAuthError when savedState exists and returnedState is missing', async () => {
      const client = new OAuthPKCEClient({
        clientId: 'client-test',
        redirectUri: 'https://app/callback',
      });

      const originalSessionStorage = (globalThis as any).sessionStorage;
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => (k === 'daylight_pkce_state' ? 'nonce-valid-123' : 'verifier-'.repeat(8)),
        setItem: () => {},
        removeItem: () => {},
      } as any;

      try {
        await assert.rejects(
          async () => {
            // Callback URL completely omits state
            await client.handleAuthorizationCallback('https://app/callback?code=valid-code');
          },
          (err: any) => {
            assert.strictEqual(err instanceof OAuthError, true);
            assert.strictEqual(err.code, 'state_mismatch');
            assert.strictEqual(err.status, 400);
            assert.ok(err.message.includes('CSRF'));
            return true;
          }
        );
      } finally {
        (globalThis as any).sessionStorage = originalSessionStorage;
      }
    });

    test('handleAuthorizationCallback throws OAuthError when savedState exists and returnedState is mismatched', async () => {
      const client = new OAuthPKCEClient({
        clientId: 'client-test',
        redirectUri: 'https://app/callback',
      });

      const originalSessionStorage = (globalThis as any).sessionStorage;
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => (k === 'daylight_pkce_state' ? 'nonce-valid-123' : 'verifier-'.repeat(8)),
        setItem: () => {},
        removeItem: () => {},
      } as any;

      try {
        await assert.rejects(
          async () => {
            await client.handleAuthorizationCallback('https://app/callback?code=valid-code&state=forged-state');
          },
          (err: any) => {
            assert.strictEqual(err instanceof OAuthError, true);
            assert.strictEqual(err.code, 'state_mismatch');
            assert.strictEqual(err.status, 400);
            assert.ok(err.message.includes('CSRF'));
            return true;
          }
        );
      } finally {
        (globalThis as any).sessionStorage = originalSessionStorage;
      }
    });

    test('setTokens invalidates cached userInfo profile data', async () => {
      const client = new OAuthPKCEClient({
        clientId: 'client-test',
        redirectUri: 'https://app/callback',
      });

      await client.setDirectToken('mock-token-user1');
      const u1 = await client.getUserInfo();
      assert.strictEqual(u1.email, 'a12katta@gmail.com');

      // Update tokens with new credentials without calling clearTokens()
      client.setTokens({
        accessToken: 'ya29.new-user-token',
        tokenType: 'Bearer',
        timestamp: Date.now(),
      });

      // Check that internal cached userInfo is null
      assert.strictEqual((client as any).userInfo, null);
    });
  });
});
