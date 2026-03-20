/**
 * OAuth2 token refresh for Gmail and Office 365 / Exchange Online.
 * Uses plain HTTPS — no extra dependencies needed.
 */

import https from "https";
import fs from "fs";
import path from "path";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tenantId?: string;       // Office 365 only; defaults to "common"
  // Cached access token — managed automatically
  _accessToken?: string;
  _accessTokenExpires?: number;
}

export type AccountProvider = "generic" | "gmail" | "office365" | "exchange";

// ── Token cache (in-process, also persisted back to accounts.json) ────────────

const tokenCache = new Map<string, { token: string; expires: number }>();

export async function getAccessToken(
  accountKey: string,
  provider: AccountProvider,
  oauth: OAuthConfig
): Promise<string> {
  const cached = tokenCache.get(accountKey);
  if (cached && cached.expires > Date.now() + 60_000) {
    return cached.token;
  }

  let token: string;
  let expiresIn: number;

  if (provider === "gmail") {
    ({ token, expiresIn } = await refreshGoogleToken(oauth));
  } else if (provider === "office365" || provider === "exchange") {
    ({ token, expiresIn } = await refreshMicrosoftToken(oauth));
  } else {
    throw new Error(`OAuth2 not supported for provider "${provider}"`);
  }

  const expires = Date.now() + expiresIn * 1000;
  tokenCache.set(accountKey, { token, expires });

  // Persist the new access token back to accounts.json so the UI can show it
  persistAccessToken(accountKey, token, expires);

  return token;
}

// ── Google ────────────────────────────────────────────────────────────────────

async function refreshGoogleToken(oauth: OAuthConfig): Promise<{ token: string; expiresIn: number }> {
  const body = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken,
    grant_type: "refresh_token",
  }).toString();

  const data = await httpsPost("oauth2.googleapis.com", "/token", body);
  if (data.error) throw new Error(`Google OAuth2 error: ${data.error_description ?? data.error}`);
  return { token: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

// ── Microsoft ─────────────────────────────────────────────────────────────────

async function refreshMicrosoftToken(oauth: OAuthConfig): Promise<{ token: string; expiresIn: number }> {
  const tenant = oauth.tenantId ?? "common";
  const body = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken,
    grant_type: "refresh_token",
    scope: "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access",
  }).toString();

  const data = await httpsPost(
    "login.microsoftonline.com",
    `/${tenant}/oauth2/v2.0/token`,
    body
  );
  if (data.error) throw new Error(`Microsoft OAuth2 error: ${data.error_description ?? data.error}`);
  return { token: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

// ── Authorization URL helpers (used by config UI) ────────────────────────────

export function getGoogleAuthUrl(clientId: string, redirectUri: string, state?: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://mail.google.com/",
    access_type: "offline",
    prompt: "consent",
    ...(state ? { state } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function getMicrosoftAuthUrl(clientId: string, redirectUri: string, tenantId = "common", state?: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access",
    ...(state ? { state } : {}),
  });
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
}

export async function exchangeGoogleCode(
  code: string, clientId: string, clientSecret: string, redirectUri: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const body = new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, grant_type: "authorization_code",
  }).toString();
  const data = await httpsPost("oauth2.googleapis.com", "/token", body);
  if (data.error) throw new Error(`Google OAuth2 error: ${data.error_description ?? data.error}`);
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export async function exchangeMicrosoftCode(
  code: string, clientId: string, clientSecret: string, redirectUri: string, tenantId = "common"
): Promise<{ accessToken: string; refreshToken: string }> {
  const body = new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, grant_type: "authorization_code",
    scope: "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access",
  }).toString();
  const data = await httpsPost(`login.microsoftonline.com`, `/${tenantId}/oauth2/v2.0/token`, body);
  if (data.error) throw new Error(`Microsoft OAuth2 error: ${data.error_description ?? data.error}`);
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function httpsPost(hostname: string, path: string, body: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("Invalid JSON response")); } });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function persistAccessToken(accountKey: string, token: string, expires: number) {
  try {
    const configPath = path.resolve(process.cwd(), "accounts.json");
    if (!fs.existsSync(configPath)) return;
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (config.accounts?.[accountKey]?.oauth2) {
      config.accounts[accountKey].oauth2._accessToken = token;
      config.accounts[accountKey].oauth2._accessTokenExpires = expires;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
  } catch { /* non-fatal */ }
}
