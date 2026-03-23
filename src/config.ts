import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  fromName?: string;
  signature?: string;   // HTML signature appended to every outgoing email
}

export type AccountProvider = "generic" | "gmail" | "office365" | "exchange";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tenantId?: string;          // Office 365 / Exchange only
  _accessToken?: string;      // cached, managed automatically
  _accessTokenExpires?: number;
}

export interface AccountConfig {
  name: string;
  type?: string;              // free-form tag: "personal", "work", "freelance" …
  provider?: AccountProvider; // "gmail" | "office365" | "exchange" | "generic"
  oauth2?: OAuthConfig;       // present when using OAuth2 instead of password
  imap: ImapConfig;
  smtp: SmtpConfig;
}

export interface AccountsFile {
  default: string;
  accounts: Record<string, AccountConfig>;
}

let _cache: AccountsFile | null = null;

export function loadConfig(): AccountsFile {
  if (_cache) return _cache;

  const configPath = path.resolve(process.cwd(), "accounts.json");

  if (fs.existsSync(configPath)) {
    _cache = JSON.parse(fs.readFileSync(configPath, "utf8")) as AccountsFile;
    console.error(`Loaded ${Object.keys(_cache.accounts).length} account(s) from accounts.json`);
    return _cache;
  }

  console.error("No accounts.json found — falling back to .env single-account config");
  _cache = {
    default: "default",
    accounts: {
      default: {
        name: "Default",
        type: "personal",
        imap: {
          host: process.env.IMAP_HOST!,
          port: Number(process.env.IMAP_PORT ?? 993),
          user: process.env.IMAP_USER!,
          password: process.env.IMAP_PASSWORD!,
          tls: process.env.IMAP_TLS !== "false",
        },
        smtp: {
          host: process.env.SMTP_HOST!,
          port: Number(process.env.SMTP_PORT ?? 465),
          user: process.env.SMTP_USER!,
          password: process.env.SMTP_PASSWORD!,
          tls: process.env.SMTP_TLS !== "false",
          fromName: process.env.SMTP_FROM_NAME,
        },
      },
    },
  };
  return _cache;
}

/** Resolve a single account by key, or fall back to the default. Throws if not found. */
export function getAccount(name?: string): AccountConfig {
  const config = loadConfig();
  const key = name ?? config.default;
  const account = config.accounts[key];
  if (!account) {
    const available = Object.keys(config.accounts).join(", ");
    throw new Error(`Account "${key}" not found. Available accounts: ${available}`);
  }
  return account;
}

/** Return all accounts that match a given type tag (case-insensitive). */
export function getAccountsByType(type: string): Array<{ key: string; account: AccountConfig }> {
  const config = loadConfig();
  return Object.entries(config.accounts)
    .filter(([, acc]) => acc.type?.toLowerCase() === type.toLowerCase())
    .map(([key, account]) => ({ key, account }));
}

/** Return all account keys + a human-readable summary line. */
export function listAccountNames(): string[] {
  const config = loadConfig();
  return Object.keys(config.accounts).map((key) => {
    const acc = config.accounts[key];
    const isDefault = key === config.default;
    const typeTag = acc.type ? ` [${acc.type}]` : "";
    return `${key}${typeTag}${isDefault ? " (default)" : ""} — ${acc.imap.user}`;
  });
}

/** Return all unique account types currently configured. */
export function listAccountTypes(): string[] {
  const config = loadConfig();
  const types = new Set(
    Object.values(config.accounts)
      .map((a) => a.type)
      .filter(Boolean) as string[]
  );
  return [...types];
}
