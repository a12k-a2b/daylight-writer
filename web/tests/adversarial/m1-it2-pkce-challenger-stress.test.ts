/**
 * tests/adversarial/m1-it2-pkce-challenger-stress.test.ts
 * Milestone 1 Iteration 2 Adversarial Empirical Challenger Stress Suite
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST FOR:
 * 1. Standalone refreshAccessToken concurrency:
 *    - 50 concurrent refreshAccessToken calls dispatch exactly 1 network request.
 *    - 100 interleaved concurrent calls across 2 different refresh tokens dispatch exactly 2 network calls.
 *    - Network error during concurrent refresh clears inFlightRefreshPromises and allows subsequent retries.
 * 2. Boundary verifier length enforcement in generateCodeChallenge & verifyCodeChallenge:
 *    - Rejects lengths 0, 1, 42, 129, 1000 with OAuthError (code: 'invalid_request', status: 400).
 *    - Succeeds for exact boundary lengths 43 and 128.
 *    - Rejects non-string inputs (null, undefined, numbers, objects, arrays).
 * 3. Timeout guard enforcement:
 *    - exchangeAuthorizationCode aborts on hanging fetch with timeout error (status: 408, code: 'timeout').
 *    - refreshAccessToken aborts on hanging fetch with timeout error (status: 408, code: 'timeout').
 *    - inFlightRefreshPromises cache is cleanly evacuated on timeout.
 * 4. CSRF state mismatch & replay prevention in handleAuthorizationCallback.
 * 5. Token expiration edge-cases (expiresIn: 0) and userInfo cache eviction in OAuthPKCEClient.
 */

import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  exchangeAuthorizationCode,
  refreshAccessToken,
  fetchGoogleUserInfo,
  isTokenExpired,
  OAuthPKCEClient,
  OAuthError,
  inFlightRefreshPromises,
} from '../../src/sync/oauth-pkce.ts';

describe('Milestone 1 Iteration 2: Empirical Challenger Stress Harness', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = originalFetch;
    inFlightRefreshPromises.clear();
  });

  // ==========================================================================
  // CHALLENGE 1: Standalone refreshAccessToken Concurrency & Coalescing
  // ==========================================================================
  describe('Challenge 1: Concurrency Deduplication & Coalescing', () => {
    test('Empirical C1.1: 50 concurrent refreshAccessToken calls dispatch EXACTLY 1 network request', async () => {
      let dispatchCount = 0;
      global.fetch = (async (url: string, init: any) => {
        dispatchCount++;
        // Simulate network latency of 30ms
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'ya29.concurrency-test-token-pass',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        };
      }) as any;

      try {
        const promises = Array.from({ length: 50 }, (_, i) =>
          refreshAccessToken('shared-refresh-token-alpha', {
            clientId: 'client-stress-test',
            redirectUri: 'https://app.daylight.computer/oauth/callback',
          })
        );

        // All 50 promises launched simultaneously
        const results = await Promise.all(promises);

        assert.strictEqual(dispatchCount, 1, `Expected exactly 1 network dispatch, got ${dispatchCount}`);
        assert.strictEqual(results.length, 50, 'All 50 calls must return a result');

        for (let i = 0; i < results.length; i++) {
          assert.strictEqual(
            results[i].access_token,
            'ya29.concurrency-test-token-pass',
            `Result ${i} token mismatch`
          );
          assert.strictEqual(
            results[i].refresh_token,
            'shared-refresh-token-alpha',
            `Result ${i} must preserve the refresh_token`
          );
        }

        assert.strictEqual(
          inFlightRefreshPromises.size,
          0,
          'inFlightRefreshPromises map must be empty after all promises settle'
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('Empirical C1.2: 100 interleaved concurrent calls for 2 distinct tokens dispatch EXACTLY 2 requests', async () => {
      let dispatchCount = 0;
      const dispatchedTokens: string[] = [];

      global.fetch = (async (url: string, init: any) => {
        dispatchCount++;
        const bodyStr = String(init?.body || '');
        const match = bodyStr.match(/refresh_token=([^&]+)/);
        const token = match ? decodeURIComponent(match[1]) : 'unknown';
        dispatchedTokens.push(token);

        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: `ya29.token-for-${token}`,
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        };
      }) as any;

      try {
        const promises = Array.from({ length: 100 }, (_, i) => {
          const refreshToken = i % 2 === 0 ? 'token-type-A' : 'token-type-B';
          return refreshAccessToken(refreshToken, {
            clientId: 'client-interleaved',
            redirectUri: 'https://app.daylight.computer/oauth/callback',
          });
        });

        const results = await Promise.all(promises);

        assert.strictEqual(dispatchCount, 2, `Expected exactly 2 network dispatches for 2 keys, got ${dispatchCount}`);
        assert.strictEqual(results.length, 100);
        assert.strictEqual(inFlightRefreshPromises.size, 0);

        for (let i = 0; i < 100; i++) {
          const expectedKey = i % 2 === 0 ? 'token-type-A' : 'token-type-B';
          assert.strictEqual(results[i].access_token, `ya29.token-for-${expectedKey}`);
        }
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('Empirical C1.3: Concurrency failure does not corrupt cache and allows subsequent retry', async () => {
      let attempt = 0;

      global.fetch = (async () => {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, 15));
        if (attempt === 1) {
          return {
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error',
            json: async () => ({ error: 'server_error', error_description: 'Transient 500' }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'ya29.recovered-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        };
      }) as any;

      try {
        // Batch 1: 50 concurrent calls that fail
        const batch1 = Array.from({ length: 50 }, () =>
          refreshAccessToken('failing-token', {
            clientId: 'client-retry',
            redirectUri: 'https://app/callback',
          })
        );

        const results1 = await Promise.allSettled(batch1);
        assert.strictEqual(attempt, 1, 'Only 1 request should have been dispatched for batch 1');
        assert.strictEqual(results1.filter((r) => r.status === 'rejected').length, 50);

        // Cache must be clean
        assert.strictEqual(inFlightRefreshPromises.size, 0, 'Cache must be evicted on failure');

        // Batch 2: Immediate retry call should succeed
        const retryResult = await refreshAccessToken('failing-token', {
          clientId: 'client-retry',
          redirectUri: 'https://app/callback',
        });

        assert.strictEqual(attempt, 2, 'A 2nd request should have been dispatched for the retry');
        assert.strictEqual(retryResult.access_token, 'ya29.recovered-token');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 2: Boundary Verifier Length Enforcement (RFC 7636 §4.1)
  // ==========================================================================
  describe('Challenge 2: PKCE Verifier Length Boundary Tests', () => {
    test('Empirical C2.1: Lengths 0, 1, and 42 throw OAuthError with invalid_request and status 400', async () => {
      const invalidLengths = [0, 1, 42];

      for (const len of invalidLengths) {
        const verifier = 'A'.repeat(len);
        await assert.rejects(
          async () => {
            await generateCodeChallenge(verifier);
          },
          (err: any) => {
            assert.strictEqual(err instanceof OAuthError, true, `Length ${len} must throw OAuthError`);
            assert.strictEqual(err.code, 'invalid_request', `Length ${len} code must be invalid_request`);
            assert.strictEqual(err.status, 400, `Length ${len} status must be 400`);
            assert.match(err.message, /between 43 and 128 characters/, `Length ${len} message check`);
            return true;
          },
          `Expected length ${len} to throw OAuthError(invalid_request)`
        );
      }
    });

    test('Empirical C2.2: Lengths 129 and 1000 throw OAuthError with invalid_request and status 400', async () => {
      const invalidLengths = [129, 1000];

      for (const len of invalidLengths) {
        const verifier = 'B'.repeat(len);
        await assert.rejects(
          async () => {
            await generateCodeChallenge(verifier);
          },
          (err: any) => {
            assert.strictEqual(err instanceof OAuthError, true, `Length ${len} must throw OAuthError`);
            assert.strictEqual(err.code, 'invalid_request', `Length ${len} code must be invalid_request`);
            assert.strictEqual(err.status, 400, `Length ${len} status must be 400`);
            assert.match(err.message, /between 43 and 128 characters/, `Length ${len} message check`);
            return true;
          },
          `Expected length ${len} to throw OAuthError(invalid_request)`
        );
      }
    });

    test('Empirical C2.3: Boundary lengths 43 and 128 SUCCEED and return valid base64url challenge', async () => {
      const validBoundaryLengths = [43, 128];

      for (const len of validBoundaryLengths) {
        const verifier = 'C'.repeat(len);
        const challenge = await generateCodeChallenge(verifier);

        assert.strictEqual(typeof challenge, 'string');
        // SHA-256 output is 32 bytes -> base64url is 43 chars unpadded
        assert.strictEqual(challenge.length, 43, `Challenge for length ${len} must be 43 characters`);
        assert.match(challenge, /^[A-Za-z0-9\-_]+$/, `Challenge must be URL-safe`);

        // Test with verifyCodeChallenge
        const verified = await verifyCodeChallenge(verifier, challenge);
        assert.strictEqual(verified, true, `verifyCodeChallenge must return true for length ${len}`);
      }
    });

    test('Empirical C2.4: Non-string inputs throw OAuthError with invalid_request', async () => {
      const badInputs = [null, undefined, 42, true, {}, [], () => {}];

      for (const input of badInputs) {
        await assert.rejects(
          async () => {
            await generateCodeChallenge(input as any);
          },
          (err: any) => {
            assert.strictEqual(err instanceof OAuthError, true);
            assert.strictEqual(err.code, 'invalid_request');
            assert.strictEqual(err.status, 400);
            return true;
          }
        );

        // verifyCodeChallenge must return false without throwing
        const isValid = await verifyCodeChallenge(input as any, 'dummy-challenge');
        assert.strictEqual(isValid, false, `verifyCodeChallenge must return false for ${typeof input}`);
      }
    });

    test('Empirical C2.5: verifyCodeChallenge rejects out-of-bounds lengths 0, 1, 42, 129, 1000', async () => {
      const dummyChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      assert.strictEqual(await verifyCodeChallenge('', dummyChallenge), false);
      assert.strictEqual(await verifyCodeChallenge('a', dummyChallenge), false);
      assert.strictEqual(await verifyCodeChallenge('a'.repeat(42), dummyChallenge), false);
      assert.strictEqual(await verifyCodeChallenge('a'.repeat(129), dummyChallenge), false);
      assert.strictEqual(await verifyCodeChallenge('a'.repeat(1000), dummyChallenge), false);
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Timeout Guards on exchangeAuthorizationCode & refreshAccessToken
  // ==========================================================================
  describe('Challenge 3: Timeout Guard Protection (408 & timeout code)', () => {
    test('Empirical C3.1: refreshAccessToken aborts hanging fetch and throws OAuthError(408, timeout)', async () => {
      let aborted = false;

      global.fetch = (async (url: string, init: any) => {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              aborted = true;
              const err: any = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }) as any;

      try {
        const start = Date.now();
        await assert.rejects(
          async () => {
            await refreshAccessToken('hanging-refresh-token', {
              clientId: 'test-timeout-client',
              redirectUri: 'https://app/callback',
              timeoutMs: 40,
            });
          },
          (err: any) => {
            assert.strictEqual(err instanceof OAuthError, true, 'Must throw OAuthError');
            assert.strictEqual(err.status, 408, 'Status must be 408');
            assert.strictEqual(err.code, 'timeout', 'Error code must be timeout');
            assert.match(err.message, /timed out after 40ms \(timeout\)/);
            assert.strictEqual(err.details?.code, 'timeout');
            return true;
          }
        );
        const elapsed = Date.now() - start;
        assert.ok(elapsed >= 35, `Timeout elapsed too fast: ${elapsed}ms`);
        assert.ok(aborted, 'Fetch signal must have received abort event');
        assert.strictEqual(inFlightRefreshPromises.size, 0, 'inFlightRefreshPromises must be cleared on timeout');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('Empirical C3.2: exchangeAuthorizationCode aborts hanging fetch and throws OAuthError(408, timeout)', async () => {
      let aborted = false;

      global.fetch = (async (url: string, init: any) => {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              aborted = true;
              const err: any = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }) as any;

      try {
        const start = Date.now();
        await assert.rejects(
          async () => {
            await exchangeAuthorizationCode(
              'hanging-auth-code',
              'verifier-valid-length-at-least-43-chars-long-12345',
              {
                clientId: 'test-timeout-client',
                redirectUri: 'https://app/callback',
                timeoutMs: 40,
              }
            );
          },
          (err: any) => {
            assert.strictEqual(err instanceof OAuthError, true, 'Must throw OAuthError');
            assert.strictEqual(err.status, 408, 'Status must be 408');
            assert.strictEqual(err.code, 'timeout', 'Error code must be timeout');
            assert.match(err.message, /timed out after 40ms \(timeout\)/);
            assert.strictEqual(err.details?.code, 'timeout');
            return true;
          }
        );
        const elapsed = Date.now() - start;
        assert.ok(elapsed >= 35, `Timeout elapsed too fast: ${elapsed}ms`);
        assert.ok(aborted, 'Fetch signal must have received abort event');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('Empirical C3.3: fetchGoogleUserInfo aborts hanging fetch and throws 408 OAuthError', async () => {
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
        await assert.rejects(
          async () => {
            await fetchGoogleUserInfo('ya29.live-hanging-token', { timeoutMs: 30 });
          },
          (err: any) => {
            assert.strictEqual(err.status, 408);
            assert.match(err.message, /timed out after 30ms/);
            return true;
          }
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 4: CSRF State & Replay Hardening in handleAuthorizationCallback
  // ==========================================================================
  describe('Challenge 4: CSRF State & Replay Hardening', () => {
    test('Empirical C4.1: Missing state in callback URL throws OAuthError(state_mismatch, 400)', async () => {
      const client = new OAuthPKCEClient({
        clientId: 'client-csrf',
        redirectUri: 'https://app/callback',
      });

      const originalSessionStorage = (globalThis as any).sessionStorage;
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => (k === 'daylight_pkce_state' ? 'secure-nonce-123' : 'v'.repeat(50)),
        setItem: () => {},
        removeItem: () => {},
      } as any;

      try {
        await assert.rejects(
          async () => {
            // Callback without state parameter
            await client.handleAuthorizationCallback('https://app/callback?code=valid-code-123');
          },
          (err: any) => {
            assert.strictEqual(err instanceof OAuthError, true);
            assert.strictEqual(err.code, 'state_mismatch');
            assert.strictEqual(err.status, 400);
            assert.match(err.message, /CSRF attack/);
            return true;
          }
        );
      } finally {
        (globalThis as any).sessionStorage = originalSessionStorage;
      }
    });

    test('Empirical C4.2: Session storage items removed immediately, preventing replay attacks', async () => {
      const client = new OAuthPKCEClient({
        clientId: 'client-replay',
        redirectUri: 'https://app/callback',
      });

      const store: Record<string, string> = {
        daylight_pkce_state: 'nonce-single-use',
        daylight_pkce_verifier: 'verifier-single-use-123456789012345678901234567',
      };

      const originalSessionStorage = (globalThis as any).sessionStorage;
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => store[k] || null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      } as any;

      global.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'mock-token-session',
          token_type: 'Bearer',
        }),
      })) as any;

      try {
        // First exchange succeeds
        const res1 = await client.handleAuthorizationCallback(
          'https://app/callback?code=c1&state=nonce-single-use'
        );
        assert.strictEqual(res1.tokens.accessToken, 'mock-token-session');

        // Session storage items must have been deleted
        assert.strictEqual(store['daylight_pkce_state'], undefined);
        assert.strictEqual(store['daylight_pkce_verifier'], undefined);

        // Immediate replay of same or different code must fail because verifier was destroyed
        await assert.rejects(
          async () => {
            await client.handleAuthorizationCallback(
              'https://app/callback?code=c1&state=nonce-single-use'
            );
          },
          /code verifier not found/
        );
      } finally {
        (globalThis as any).sessionStorage = originalSessionStorage;
        global.fetch = originalFetch;
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 5: Expiration Invariants & UserInfo Isolation
  // ==========================================================================
  describe('Challenge 5: Expiration Invariants & UserInfo Isolation', () => {
    test('Empirical C5.1: isTokenExpired treats expiresIn: 0 as immediately expired', () => {
      const expiredZero = {
        accessToken: 't',
        expiresIn: 0,
        tokenType: 'Bearer',
        timestamp: Date.now(),
      };
      assert.strictEqual(isTokenExpired(expiredZero), true);
    });

    test('Empirical C5.2: setTokens evicts cached userInfo to prevent cross-account profile leakage', async () => {
      const client = new OAuthPKCEClient({
        clientId: 'client-switch',
        redirectUri: 'https://app/callback',
      });

      // User 1 logs in with mock token
      await client.setDirectToken('mock-token-user1');
      const u1 = await client.getUserInfo();
      assert.strictEqual(u1.email, 'a12katta@gmail.com');

      // User 2 logs in via setTokens
      client.setTokens({
        accessToken: 'ya29.user2-token',
        tokenType: 'Bearer',
        timestamp: Date.now(),
      });

      // Internal cached userInfo must be cleared
      assert.strictEqual((client as any).userInfo, null);
    });
  });
});
