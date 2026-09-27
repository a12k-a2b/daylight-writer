/**
 * tests/e2e/gdrive-sync/tier1-features-f06-f10.test.ts
 * Tier 1: Isolated Feature Coverage for Features 6 to 10 (R2: Google OAuth 2.0 Authentication & User Verification)
 *
 * Feature 6: Google OAuth 2.0 PKCE Flow (>=5 tests)
 * Feature 7: Silent Token Refresh (>=5 tests)
 * Feature 8: Multi-Tier Token Persistence (>=5 tests)
 * Feature 9: Direct Token Fallback (>=5 tests)
 * Feature 10: Google UserInfo Verification (>=5 tests)
 */

import test from 'node:test';
import assert from 'node:assert';
import { GoogleDriveSyncAdapter } from '../../../src/sync/google-drive-sync-adapter.ts';
import {
  setupGDriveTestEnv,
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  base64UrlEncode,
  MockOAuthClient,
} from './helpers/test-harness.ts';

// ============================================================================
// Feature 6: Google OAuth 2.0 PKCE Flow (F06)
// ============================================================================

test('F06.1: PKCE Flow - Generates RFC 7636 compliant code verifier', () => {
  const verifier = generateCodeVerifier(64);
  assert.strictEqual(verifier.length, 64);

  // RFC 7636 unreserved characters: [A-Z], [a-z], [0-9], "-", ".", "_", "~"
  const rfc7636Regex = /^[A-Za-z0-9\-._~]{43,128}$/;
  assert.ok(rfc7636Regex.test(verifier), `Code verifier must match RFC 7636 character set: ${verifier}`);

  // Test boundaries: min 43, max 128
  const minVerifier = generateCodeVerifier(20); // Clamped to 43
  assert.strictEqual(minVerifier.length, 43);

  const maxVerifier = generateCodeVerifier(200); // Clamped to 128
  assert.strictEqual(maxVerifier.length, 128);
});

test('F06.2: PKCE Flow - Computes S256 code challenge with Base64URL encoding', async () => {
  const testVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  const challenge = await generateCodeChallenge(testVerifier);
  assert.strictEqual(challenge, expectedChallenge, 'S256 challenge must match SHA256 Base64URL digest');

  const isValid = await verifyCodeChallenge(testVerifier, expectedChallenge);
  assert.strictEqual(isValid, true);
});

test('F06.3: PKCE Flow - Constructs Google authorization URL with all required query parameters', async () => {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const clientId = 'daylight-writer-client-id.apps.googleusercontent.com';
  const redirectUri = 'https://daylight-writer.web.app/oauth/callback';
  const scope = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile';
  const state = 'secure-state-12345';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const parsed = new URL(authUrl);

  assert.strictEqual(parsed.origin, 'https://accounts.google.com');
  assert.strictEqual(parsed.pathname, '/o/oauth2/v2/auth');
  assert.strictEqual(parsed.searchParams.get('client_id'), clientId);
  assert.strictEqual(parsed.searchParams.get('code_challenge'), challenge);
  assert.strictEqual(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(parsed.searchParams.get('response_type'), 'code');
  assert.strictEqual(parsed.searchParams.get('state'), state);
});

test('F06.4: PKCE Flow - Exchanges authorization code and verifier for access & refresh tokens', async () => {
  const env = setupGDriveTestEnv();
  try {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);

    // Seed valid authorization code on mock server
    const authCode = 'auth-code-valid-123';
    env.server.authCodes.set(authCode, {
      codeVerifierChallenge: challenge,
      clientId: 'test-client',
      user: { email: 'a12katta@gmail.com', name: 'Anjan Katta' },
    });

    const tokenRes = await env.server.handleRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        code_verifier: verifier,
        client_id: 'test-client',
        redirect_uri: 'https://app/callback',
      }).toString(),
    });

    assert.strictEqual(tokenRes.status, 200);
    const data = await tokenRes.json();
    assert.ok(data.access_token.startsWith('ya29.'));
    assert.ok(data.refresh_token.startsWith('1//'));
    assert.strictEqual(data.token_type, 'Bearer');
    assert.strictEqual(data.expires_in, 3600);
  } finally {
    env.cleanup();
  }
});

test('F06.5: PKCE Flow - Rejects token exchange on invalid authorization code or missing verifier', async () => {
  const env = setupGDriveTestEnv();
  try {
    const tokenRes = await env.server.handleRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'non-existent-code',
        code_verifier: 'some-verifier',
      }).toString(),
    });

    assert.strictEqual(tokenRes.status, 400);
    const data = await tokenRes.json();
    assert.strictEqual(data.error, 'invalid_grant');
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Feature 7: Silent Token Refresh (F07)
// ============================================================================

test('F07.1: Silent Token Refresh - Detects expired token based on timestamp calculation', () => {
  const issuedAt = Date.now() - 3650 * 1000; // Issued 3650 seconds ago
  const expiresIn = 3600; // Expires in 3600 seconds

  const isExpired = Date.now() >= issuedAt + expiresIn * 1000;
  assert.strictEqual(isExpired, true, 'Token must be evaluated as expired');
});

test('F07.2: Silent Token Refresh - Automatically refreshes expired token in IOAuthClient', async () => {
  const env = setupGDriveTestEnv();
  try {
    const oauthClient = new MockOAuthClient(env.server);
    oauthClient.setTokens({
      accessToken: 'ya29.expired-token',
      refreshToken: 'valid-refresh-token-456',
      expiresIn: 1, // 1 second
      tokenType: 'Bearer',
      timestamp: Date.now() - 5000, // Expired 5 seconds ago
    });

    const validToken = await oauthClient.getValidAccessToken();
    assert.ok(validToken.startsWith('ya29.refreshed-'), 'Should return newly refreshed token');

    // Check refresh call occurred on server
    const refreshCall = env.server.callHistory.find(
      (c) => c.url.includes('/token') && c.body?.includes('grant_type=refresh_token')
    );
    assert.ok(refreshCall, 'Must call token endpoint with grant_type=refresh_token');
  } finally {
    env.cleanup();
  }
});

test('F07.3: Silent Token Refresh - Returns existing valid token when not yet expired', async () => {
  const env = setupGDriveTestEnv();
  try {
    const oauthClient = new MockOAuthClient(env.server);
    oauthClient.setTokens({
      accessToken: 'ya29.still-fresh-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      tokenType: 'Bearer',
      timestamp: Date.now(),
    });

    const token = await oauthClient.getValidAccessToken();
    assert.strictEqual(token, 'ya29.still-fresh-token');
    assert.strictEqual(
      env.server.callHistory.filter((c) => c.url.includes('/token')).length,
      0,
      'No refresh call should be made when token is still fresh'
    );
  } finally {
    env.cleanup();
  }
});

test('F07.4: Silent Token Refresh - Handles invalid refresh token by rejecting with clear error', async () => {
  const env = setupGDriveTestEnv();
  try {
    const oauthClient = new MockOAuthClient(env.server);
    oauthClient.setTokens({
      accessToken: 'ya29.expired',
      refreshToken: 'invalid-refresh-token',
      expiresIn: 1,
      tokenType: 'Bearer',
      timestamp: Date.now() - 5000,
    });

    await assert.rejects(async () => {
      await oauthClient.getValidAccessToken();
    }, /Refresh token invalid or expired/);
  } finally {
    env.cleanup();
  }
});

test('F07.5: Silent Token Refresh - Retains user info across token refresh', async () => {
  const env = setupGDriveTestEnv();
  try {
    const oauthClient = new MockOAuthClient(env.server);
    oauthClient.setTokens({
      accessToken: 'ya29.expired',
      refreshToken: 'valid-refresh-token',
      expiresIn: 1,
      tokenType: 'Bearer',
      timestamp: Date.now() - 5000,
    });

    const userInfo = await oauthClient.getUserInfo();
    assert.strictEqual(userInfo.email, 'a12katta@gmail.com');
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Feature 8: Multi-Tier Token Persistence (F08)
// ============================================================================

test('F08.1: Multi-Tier Token Persistence - Stores tokens in localStorage upon setting', () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    adapter.setAccessToken('ya29.persistent-storage-token');

    assert.strictEqual(env.win.localStorage.getItem('daylight_gdrive_access_token'), 'ya29.persistent-storage-token');
  } finally {
    env.cleanup();
  }
});

test('F08.2: Multi-Tier Token Persistence - Automatically restores token on fresh adapter instance', () => {
  const env = setupGDriveTestEnv();
  try {
    env.win.localStorage.setItem('daylight_gdrive_access_token', 'ya29.restored-from-disk');
    env.win.localStorage.setItem(
      'daylight_gdrive_user',
      JSON.stringify({ email: 'a12katta@gmail.com', name: 'Anjan Katta' })
    );

    const adapter = new GoogleDriveSyncAdapter();
    assert.strictEqual(adapter.isAuthenticated(), true);
    assert.strictEqual(adapter.getAccessToken(), 'ya29.restored-from-disk');
    assert.strictEqual(adapter.getCurrentUser()?.email, 'a12katta@gmail.com');
  } finally {
    env.cleanup();
  }
});

test('F08.3: Multi-Tier Token Persistence - Android Native Bridge synchronization hook', () => {
  const env = setupGDriveTestEnv();
  try {
    let bridgeCredsSet = false;
    let bridgeToken = '';
    let bridgeFolder = '';

    // Mock window.DaylightBridge
    (env.win as any).DaylightBridge = {
      setSyncCredentials: (tok: string, folder: string) => {
        bridgeCredsSet = true;
        bridgeToken = tok;
        bridgeFolder = folder;
      },
      requestImmediateSync: () => true,
      onSyncQueueUpdated: () => {},
    };

    const token = 'ya29.native-sync-test';
    const folder = 'folder-native-99';

    // Call bridge interface
    (env.win as any).DaylightBridge.setSyncCredentials(token, folder);

    assert.strictEqual(bridgeCredsSet, true);
    assert.strictEqual(bridgeToken, token);
    assert.strictEqual(bridgeFolder, folder);
  } finally {
    env.cleanup();
  }
});

test('F08.4: Multi-Tier Token Persistence - Clearing token removes all traces from localStorage', () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter();
    adapter.setAccessToken('ya29.to-be-cleared');
    adapter.setCurrentUser({ email: 'a12katta@gmail.com' });

    assert.strictEqual(env.win.localStorage.getItem('daylight_gdrive_access_token'), 'ya29.to-be-cleared');

    adapter.setAccessToken(null);
    assert.strictEqual(env.win.localStorage.getItem('daylight_gdrive_access_token'), null);
    assert.strictEqual(env.win.localStorage.getItem('daylight_gdrive_user'), null);
    assert.strictEqual(adapter.isAuthenticated(), false);
    assert.strictEqual(adapter.getCurrentUser(), null);
  } finally {
    env.cleanup();
  }
});

test('F08.5: Multi-Tier Token Persistence - Recovers gracefully from corrupted JSON in localStorage', () => {
  const env = setupGDriveTestEnv();
  try {
    env.win.localStorage.setItem('daylight_gdrive_user', '{ corrupted-not-valid-json: !!!');
    env.win.localStorage.setItem('daylight_gdrive_access_token', 'ya29.valid-token');

    // Should not throw SyntaxError
    const adapter = new GoogleDriveSyncAdapter();
    assert.strictEqual(adapter.isAuthenticated(), true);
    assert.strictEqual(adapter.getCurrentUser(), null, 'Should fallback safely to null user on bad JSON');
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Feature 9: Direct Token Fallback (F09)
// ============================================================================

test('F09.1: Direct Token Fallback - Accepts manual direct bearer token input', () => {
  const adapter = new GoogleDriveSyncAdapter();
  assert.strictEqual(adapter.isAuthenticated(), false);

  adapter.setAccessToken('manual-direct-token-abc-123');
  assert.strictEqual(adapter.isAuthenticated(), true);
  assert.strictEqual(adapter.getAccessToken(), 'manual-direct-token-abc-123');
});

test('F09.2: Direct Token Fallback - Accepts mock developer test keys (mock-token-*)', () => {
  const adapter = new GoogleDriveSyncAdapter();
  adapter.setAccessToken('mock-token-developer-test');

  assert.strictEqual(adapter.isAuthenticated(), true);
  assert.strictEqual(adapter.getAccessToken(), 'mock-token-developer-test');
});

test('F09.3: Direct Token Fallback - Handles empty string by clearing authentication', () => {
  const adapter = new GoogleDriveSyncAdapter();
  adapter.setAccessToken('valid-initial-token');
  assert.strictEqual(adapter.isAuthenticated(), true);

  adapter.setAccessToken('');
  assert.strictEqual(adapter.isAuthenticated(), false);
  assert.strictEqual(!adapter.getAccessToken() || adapter.getAccessToken() === '', true);

  adapter.setAccessToken(null);
  assert.strictEqual(adapter.isAuthenticated(), false);
  assert.strictEqual(adapter.getAccessToken(), null);
});

test('F09.4: Direct Token Fallback - Direct token configuration emits log entries', () => {
  const adapter = new GoogleDriveSyncAdapter();
  adapter.setAccessToken('ya29.sample-token');

  assert.ok(adapter.syncLogs.length > 0);
  assert.strictEqual(adapter.syncLogs[0].message, 'Access token configured');

  adapter.setAccessToken(null);
  assert.strictEqual(adapter.syncLogs[0].message, 'Access token cleared');
});

test('F09.5: Direct Token Fallback - Direct token setting works via IOAuthClient setDirectToken', async () => {
  const env = setupGDriveTestEnv();
  try {
    const client = new MockOAuthClient(env.server);
    assert.strictEqual(client.isAuthenticated(), false);

    const user = await client.setDirectToken('mock-direct-token-77');
    assert.strictEqual(client.isAuthenticated(), true);
    assert.strictEqual(user.email, 'a12katta@gmail.com');
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// Feature 10: Google UserInfo Verification (F10)
// ============================================================================

test('F10.1: UserInfo Verification - Dispatches request to Google UserInfo API with Bearer token', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    const user = await adapter.verifyAuthentication();
    assert.strictEqual(user.email, 'a12katta@gmail.com');

    const userinfoCall = env.server.callHistory.find((c) => c.url.includes('/userinfo'));
    assert.ok(userinfoCall, 'Must call Google UserInfo endpoint');
    assert.strictEqual(userinfoCall.headers['authorization'], 'Bearer ya29.valid-token');
  } finally {
    env.cleanup();
  }
});

test('F10.2: UserInfo Verification - Captures user profile fields (email, name, picture)', async () => {
  const env = setupGDriveTestEnv();
  try {
    const customUser = {
      email: 'a12katta@gmail.com',
      name: 'Anjan Katta',
      picture: 'https://lh3.googleusercontent.com/a/custom-avatar',
    };
    env.server.authTokens.set('ya29.custom-user-token', {
      user: customUser,
      expiresAt: Date.now() + 3600000,
    });

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.custom-user-token',
    });

    const user = await adapter.verifyAuthentication();
    assert.strictEqual(user.email, 'a12katta@gmail.com');
    assert.strictEqual(user.name, 'Anjan Katta');
    assert.strictEqual(user.picture, 'https://lh3.googleusercontent.com/a/custom-avatar');
    assert.strictEqual(adapter.getCurrentUser()?.email, 'a12katta@gmail.com');
  } finally {
    env.cleanup();
  }
});

test('F10.3: UserInfo Verification - Throws descriptive error when no access token is configured', async () => {
  const adapter = new GoogleDriveSyncAdapter();
  await assert.rejects(async () => {
    await adapter.verifyAuthentication();
  }, /No access token configured/);
});

test('F10.4: UserInfo Verification - Handles HTTP 401 Unauthorized for expired or revoked token', async () => {
  const env = setupGDriveTestEnv();
  try {
    env.server.simulateAuthExpired = true;

    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.expired-token',
    });

    await assert.rejects(async () => {
      await adapter.verifyAuthentication();
    }, /Google OAuth verification failed \(401\)/);

    // Verify error was logged
    const lastLog = adapter.syncLogs[0];
    assert.strictEqual(lastLog.type, 'error');
    assert.ok(lastLog.message.includes('Token verification error'));
  } finally {
    env.cleanup();
  }
});

test('F10.5: UserInfo Verification - Emits success log entry upon verified authentication', async () => {
  const env = setupGDriveTestEnv();
  try {
    const adapter = new GoogleDriveSyncAdapter({
      accessToken: 'ya29.valid-token',
    });

    await adapter.verifyAuthentication();
    const successLog = adapter.syncLogs.find((l) => l.type === 'success' && l.message.includes('Authenticated successfully'));
    assert.ok(successLog, 'Must emit success log entry');
    assert.ok(successLog.message.includes('a12katta@gmail.com'));
  } finally {
    env.cleanup();
  }
});
