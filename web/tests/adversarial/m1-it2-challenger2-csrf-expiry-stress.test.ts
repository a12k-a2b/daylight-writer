/**
 * tests/adversarial/m1-it2-challenger2-csrf-expiry-stress.test.ts
 * Empirical Adversarial Challenger Verification Suite
 * Milestone 1 Iteration 2: CSRF State Simulation, Token Expiry Boundary, and User Profile Cache Invalidation
 */

import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  OAuthPKCEClient,
  OAuthError,
  isTokenExpired,
  type AuthTokens,
  type UserInfo,
  type OAuthOptions,
} from '../../src/sync/oauth-pkce.ts';

describe('Empirical Challenger M1-IT2: CSRF State & Token Expiry Stress', () => {
  const originalFetch = global.fetch;
  let mockSessionStorage: Record<string, string> = {};

  beforeEach(() => {
    global.fetch = originalFetch;
    mockSessionStorage = {};
    (globalThis as any).sessionStorage = {
      getItem: (key: string) => (key in mockSessionStorage ? mockSessionStorage[key] : null),
      setItem: (key: string, val: string) => {
        mockSessionStorage[key] = String(val);
      },
      removeItem: (key: string) => {
        delete mockSessionStorage[key];
      },
      clear: () => {
        mockSessionStorage = {};
      },
    };
  });

  // ==========================================================================
  // Challenge 1: CSRF Attack Simulation & Exact State Mismatch Error Assertion
  // ==========================================================================
  describe('Challenge 1: CSRF Attack Simulation', () => {
    const defaultOptions: OAuthOptions = {
      clientId: 'dc1-test-client-id.apps.googleusercontent.com',
      redirectUri: 'https://daylight-writer.web.app/oauth/callback',
    };

    const validVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const legitimateState = 'Legitimate-CSRF-Token-XYZ-1234567890';

    function setupSessionStorage(state: string = legitimateState, verifier: string = validVerifier) {
      mockSessionStorage['daylight_pkce_state'] = state;
      mockSessionStorage['daylight_pkce_verifier'] = verifier;
    }

    test('1.1: Missing state parameter in callback triggers exact state_mismatch OAuthError', async () => {
      const client = new OAuthPKCEClient(defaultOptions);
      setupSessionStorage();

      // Attacker intercepts or forges callback without state query param
      const callbackUrl = 'https://daylight-writer.web.app/oauth/callback?code=auth-code-attack-1';

      await assert.rejects(
        async () => {
          await client.handleAuthorizationCallback(callbackUrl);
        },
        (err: any) => {
          assert.strictEqual(err instanceof OAuthError, true, 'Must be instance of OAuthError');
          assert.strictEqual(err.code, 'state_mismatch', 'Error code must be exact "state_mismatch"');
          assert.strictEqual(err.status, 400, 'HTTP status code must be 400');
          assert.match(err.message, /CSRF|state mismatch/i, 'Error message must document CSRF attack / state mismatch');
          return true;
        }
      );
    });

    test('1.2: Empty string state parameter in callback triggers exact state_mismatch OAuthError', async () => {
      const client = new OAuthPKCEClient(defaultOptions);
      setupSessionStorage();

      // State parameter present but set to empty string (?state=)
      const callbackUrl = 'https://daylight-writer.web.app/oauth/callback?code=auth-code-attack-2&state=';

      await assert.rejects(
        async () => {
          await client.handleAuthorizationCallback(callbackUrl);
        },
        (err: any) => {
          assert.strictEqual(err instanceof OAuthError, true);
          assert.strictEqual(err.code, 'state_mismatch');
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /CSRF|state mismatch/i);
          return true;
        }
      );
    });

    test('1.3: Mismatched / forged state parameter triggers exact state_mismatch OAuthError', async () => {
      const client = new OAuthPKCEClient(defaultOptions);
      setupSessionStorage();

      // Attacker passes forged state
      const callbackUrl =
        'https://daylight-writer.web.app/oauth/callback?code=auth-code-attack-3&state=forged-attacker-nonce-999';

      await assert.rejects(
        async () => {
          await client.handleAuthorizationCallback(callbackUrl);
        },
        (err: any) => {
          assert.strictEqual(err instanceof OAuthError, true);
          assert.strictEqual(err.code, 'state_mismatch');
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /CSRF|state mismatch/i);
          return true;
        }
      );
    });

    test('1.4: Subtle state corruption (case alteration, bit-flip, trailing space) is rejected', async () => {
      const client = new OAuthPKCEClient(defaultOptions);

      const subtleVariations = [
        legitimateState.toUpperCase(),
        legitimateState.toLowerCase(),
        legitimateState + ' ',
        ' ' + legitimateState,
        legitimateState.slice(0, -1) + 'X',
        encodeURIComponent(legitimateState + '%00'),
        'null',
        'undefined',
      ];

      for (const tamperedState of subtleVariations) {
        setupSessionStorage();
        await assert.rejects(
          async () => {
            await client.handleAuthorizationCallback(
              `https://daylight-writer.web.app/oauth/callback?code=code-abc&state=${tamperedState}`
            );
          },
          (err: any) => {
            assert.strictEqual(err instanceof OAuthError, true);
            assert.strictEqual(err.code, 'state_mismatch');
            assert.strictEqual(err.status, 400);
            return true;
          },
          `Tampered state "${tamperedState}" must trigger state_mismatch`
        );
      }
    });

    test('1.5: Valid state passes validation and successfully exchanges code for tokens', async () => {
      const client = new OAuthPKCEClient(defaultOptions);
      setupSessionStorage();

      // Mock exchangeAuthorizationCode and fetchGoogleUserInfo
      let exchangeCalled = false;
      global.fetch = (async (url: string, init: any) => {
        if (url.includes('/token')) {
          exchangeCalled = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: 'ya29.legitimate-access-token',
              token_type: 'Bearer',
              expires_in: 3600,
              refresh_token: '1//refresh-legitimate',
            }),
          };
        }
        if (url.includes('/userinfo')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              email: 'a12katta@gmail.com',
              name: 'Anjan Katta',
            }),
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      }) as any;

      const callbackUrl = `https://daylight-writer.web.app/oauth/callback?code=legitimate-code-88&state=${legitimateState}`;
      const result = await client.handleAuthorizationCallback(callbackUrl);

      assert.strictEqual(exchangeCalled, true, 'Code exchange must be executed');
      assert.strictEqual(result.tokens.accessToken, 'ya29.legitimate-access-token');
      assert.strictEqual(result.tokens.refreshToken, '1//refresh-legitimate');
      assert.strictEqual(result.userInfo.email, 'a12katta@gmail.com');
      assert.strictEqual(client.isAuthenticated(), true);
    });

    test('1.6: State replay attack protection (state cleared after first use)', async () => {
      const client = new OAuthPKCEClient(defaultOptions);
      setupSessionStorage();

      global.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'ya29.token-1',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      })) as any;

      const callbackUrl = `https://daylight-writer.web.app/oauth/callback?code=code-1&state=${legitimateState}`;

      // First use succeeds
      await client.handleAuthorizationCallback(callbackUrl);

      // Second use with same URL must fail because state & verifier were consumed from sessionStorage
      await assert.rejects(
        async () => {
          await client.handleAuthorizationCallback(callbackUrl);
        },
        (err: any) => {
          assert.match(err.message, /verifier not found in session storage/i);
          return true;
        }
      );
    });

    test('1.7: Accepts various input representations (URL, search string, URLSearchParams)', async () => {
      const client = new OAuthPKCEClient(defaultOptions);

      global.fetch = (async (url: string) => {
        if (url.includes('/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: 'ya29.format-token',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ email: 'a12katta@gmail.com', name: 'Anjan' }),
        };
      }) as any;

      // Format A: raw query string
      setupSessionStorage();
      const resA = await client.handleAuthorizationCallback(`?code=code-a&state=${legitimateState}`);
      assert.strictEqual(resA.tokens.accessToken, 'ya29.format-token');

      // Format B: param string without leading '?'
      setupSessionStorage();
      const resB = await client.handleAuthorizationCallback(`code=code-b&state=${legitimateState}`);
      assert.strictEqual(resB.tokens.accessToken, 'ya29.format-token');

      // Format C: URLSearchParams instance
      setupSessionStorage();
      const params = new URLSearchParams();
      params.set('code', 'code-c');
      params.set('state', legitimateState);
      const resC = await client.handleAuthorizationCallback(params);
      assert.strictEqual(resC.tokens.accessToken, 'ya29.format-token');
    });
  });

  // ==========================================================================
  // Challenge 2: Immediate & Boundary Token Expiry Tests
  // ==========================================================================
  describe('Challenge 2: Immediate & Boundary Token Expiry', () => {
    test('2.1: expiresIn === 0 evaluates to expired immediately (true)', () => {
      const tokensZero: AuthTokens = {
        accessToken: 'ya29.immediate-zero',
        tokenType: 'Bearer',
        expiresIn: 0,
        timestamp: Date.now(),
      };

      // Even with 0 buffer seconds, expiresIn: 0 is expired
      assert.strictEqual(isTokenExpired(tokensZero, 0), true);
      assert.strictEqual(isTokenExpired(tokensZero, 60), true);
      assert.strictEqual(isTokenExpired(tokensZero, -60), true);
    });

    test('2.2: Negative expiresIn values evaluate to expired (true)', () => {
      const negativeValues = [-1, -10, -60, -3600, -86400, Number.NEGATIVE_INFINITY];

      for (const neg of negativeValues) {
        const tokens: AuthTokens = {
          accessToken: `ya29.neg-${neg}`,
          tokenType: 'Bearer',
          expiresIn: neg,
          timestamp: Date.now(),
        };

        assert.strictEqual(
          isTokenExpired(tokens, 0),
          true,
          `expiresIn: ${neg} must be expired with buffer 0`
        );
        assert.strictEqual(
          isTokenExpired(tokens, 60),
          true,
          `expiresIn: ${neg} must be expired with buffer 60`
        );
      }
    });

    test('2.3: Normal positive durations behave correctly across lifecycle', () => {
      const now = Date.now();

      // Fresh token: 1 hour duration, acquired now
      const freshToken: AuthTokens = {
        accessToken: 'ya29.fresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        timestamp: now,
      };
      assert.strictEqual(isTokenExpired(freshToken, 60), false);
      assert.strictEqual(isTokenExpired(freshToken, 0), false);

      // Mid-life token: 1 hour duration, 30 minutes elapsed (30m remaining)
      const midLifeToken: AuthTokens = {
        accessToken: 'ya29.midlife-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        timestamp: now - 1800 * 1000,
      };
      assert.strictEqual(isTokenExpired(midLifeToken, 60), false);

      // Near-expiry token: 1 hour duration, 3550s elapsed (50s remaining, inside 60s buffer)
      const nearExpiryToken: AuthTokens = {
        accessToken: 'ya29.near-expiry-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        timestamp: now - 3550 * 1000,
      };
      // With default 60s buffer -> expired
      assert.strictEqual(isTokenExpired(nearExpiryToken, 60), true);
      // With 0s buffer -> not yet expired (has 50s left)
      assert.strictEqual(isTokenExpired(nearExpiryToken, 0), false);

      // Exact boundary: 1 hour duration, 3600s elapsed
      const exactExpiredToken: AuthTokens = {
        accessToken: 'ya29.exact-expired-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        timestamp: now - 3600 * 1000,
      };
      assert.strictEqual(isTokenExpired(exactExpiredToken, 0), true);

      // Long expired token: 1 hour duration, 7200s elapsed
      const pastExpiredToken: AuthTokens = {
        accessToken: 'ya29.past-expired-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        timestamp: now - 7200 * 1000,
      };
      assert.strictEqual(isTokenExpired(pastExpiredToken, 60), true);
    });

    test('2.4: Indefinite / non-expiring tokens (undefined / null expiresIn) return false', () => {
      const undefinedExpiry: AuthTokens = {
        accessToken: 'ya29.indefinite-1',
        tokenType: 'Bearer',
        expiresIn: undefined,
        timestamp: Date.now() - 100000000,
      };
      assert.strictEqual(isTokenExpired(undefinedExpiry), false);

      const nullExpiry: AuthTokens = {
        accessToken: 'ya29.indefinite-2',
        tokenType: 'Bearer',
        expiresIn: null as any,
        timestamp: Date.now() - 100000000,
      };
      assert.strictEqual(isTokenExpired(nullExpiry), false);
    });

    test('2.5: expiresIn === 0 expires immediately even if timestamp is in future (clock skew)', () => {
      const futureTokensZero: AuthTokens = {
        accessToken: 'ya29.future-zero',
        tokenType: 'Bearer',
        expiresIn: 0,
        timestamp: Date.now() + 1000000, // 1000s in the future
      };
      assert.strictEqual(isTokenExpired(futureTokensZero), true);
    });
  });

  // ==========================================================================
  // Challenge 3: User Profile Cache Invalidation on setTokens
  // ==========================================================================
  describe('Challenge 3: User Profile Invalidation on setTokens', () => {
    const defaultOptions: OAuthOptions = {
      clientId: 'dc1-test-client.apps.googleusercontent.com',
      redirectUri: 'https://daylight-writer.web.app/oauth/callback',
      userInfoEndpoint: 'https://test-server.example.com/userinfo',
    };

    test('3.1: setTokens clears cached user profile and forces network fetch for fresh profile', async () => {
      const client = new OAuthPKCEClient(defaultOptions);

      // Profile 1: Alice
      const userAlice = {
        email: 'alice@daylight.computer',
        name: 'Alice User',
        picture: 'https://img/alice.png',
      };

      // Profile 2: Bob
      const userBob = {
        email: 'bob@daylight.computer',
        name: 'Bob User',
        picture: 'https://img/bob.png',
      };

      let activeProfile = userAlice;
      let requestedAuthHeaders: string[] = [];

      global.fetch = (async (url: string, init: any) => {
        requestedAuthHeaders.push(init?.headers?.Authorization);
        return {
          ok: true,
          status: 200,
          json: async () => activeProfile,
        };
      }) as any;

      // 1. Set credentials for Alice
      client.setTokens({
        accessToken: 'ya29.token-alice',
        tokenType: 'Bearer',
        expiresIn: 3600,
        timestamp: Date.now(),
      });

      const profile1 = await client.getUserInfo();
      assert.strictEqual(profile1.email, 'alice@daylight.computer');
      assert.strictEqual(profile1.name, 'Alice User');
      assert.strictEqual(requestedAuthHeaders.length, 1);
      assert.strictEqual(requestedAuthHeaders[0], 'Bearer ya29.token-alice');

      // 2. Calling getUserInfo again returns cached profile without second fetch
      const profile1Cached = await client.getUserInfo();
      assert.strictEqual(profile1Cached.email, 'alice@daylight.computer');
      assert.strictEqual(requestedAuthHeaders.length, 1, 'Must use cache on repeat call');

      // 3. Switch accounts: setTokens with Bob credentials
      activeProfile = userBob;
      client.setTokens({
        accessToken: 'ya29.token-bob',
        tokenType: 'Bearer',
        expiresIn: 3600,
        timestamp: Date.now(),
      });

      // 4. Verify internal cached userInfo was invalidated (cleared)
      assert.strictEqual((client as any).userInfo, null, 'Internal userInfo cache must be null after setTokens');

      // 5. Calling getUserInfo must fetch Bob profile and NOT return cached Alice profile
      const profile2 = await client.getUserInfo();
      assert.strictEqual(profile2.email, 'bob@daylight.computer', 'Must return Bob profile, NOT Alice');
      assert.strictEqual(profile2.name, 'Bob User');
      assert.strictEqual(requestedAuthHeaders.length, 2, 'Second fetch must be dispatched for new token');
      assert.strictEqual(requestedAuthHeaders[1], 'Bearer ya29.token-bob');
    });

    test('3.2: Rapid credential churn always delivers correct profile corresponding to active token', async () => {
      const client = new OAuthPKCEClient(defaultOptions);

      const accounts = [
        { token: 'token-usr-1', email: 'usr1@example.com', name: 'User 1' },
        { token: 'token-usr-2', email: 'usr2@example.com', name: 'User 2' },
        { token: 'token-usr-3', email: 'usr3@example.com', name: 'User 3' },
        { token: 'token-usr-4', email: 'usr4@example.com', name: 'User 4' },
      ];

      const profileMap: Record<string, { email: string; name: string }> = {};
      for (const a of accounts) {
        profileMap[`Bearer ${a.token}`] = { email: a.email, name: a.name };
      }

      global.fetch = (async (url: string, init: any) => {
        const auth = init?.headers?.Authorization;
        const prof = profileMap[auth];
        if (!prof) throw new Error(`Unknown auth: ${auth}`);
        return {
          ok: true,
          status: 200,
          json: async () => prof,
        };
      }) as any;

      for (const acc of accounts) {
        client.setTokens({
          accessToken: acc.token,
          tokenType: 'Bearer',
          expiresIn: 3600,
          timestamp: Date.now(),
        });

        const info = await client.getUserInfo();
        assert.strictEqual(info.email, acc.email, `Expected ${acc.email} but got ${info.email}`);
        assert.strictEqual(info.name, acc.name);
      }
    });

    test('3.3: setTokens(null) clears authentication and cached profile', async () => {
      const client = new OAuthPKCEClient(defaultOptions);

      client.setTokens({
        accessToken: 'ya29.active',
        tokenType: 'Bearer',
        expiresIn: 3600,
        timestamp: Date.now(),
      });
      assert.strictEqual(client.isAuthenticated(), true);

      client.setTokens(null);
      assert.strictEqual(client.isAuthenticated(), false);
      assert.strictEqual(client.getTokens(), null);
      assert.strictEqual((client as any).userInfo, null);

      await assert.rejects(async () => {
        await client.getUserInfo();
      }, /No access token available/);
    });

    test('3.4: Alternating between setDirectToken and setTokens correctly manages profile cache', async () => {
      const client = new OAuthPKCEClient(defaultOptions);

      // Start with mock token
      const u1 = await client.setDirectToken('mock-token-initial');
      assert.strictEqual(u1.email, 'a12katta@gmail.com');

      // Now set real tokens via setTokens
      let liveFetchCount = 0;
      global.fetch = (async () => {
        liveFetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ email: 'live@daylight.computer', name: 'Live User' }),
        };
      }) as any;

      client.setTokens({
        accessToken: 'ya29.live-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        timestamp: Date.now(),
      });

      const u2 = await client.getUserInfo();
      assert.strictEqual(u2.email, 'live@daylight.computer');
      assert.strictEqual(liveFetchCount, 1);

      // Repeat call uses cache
      const u2Cached = await client.getUserInfo();
      assert.strictEqual(u2Cached.email, 'live@daylight.computer');
      assert.strictEqual(liveFetchCount, 1);
    });
  });
});
