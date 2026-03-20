/**
 * Email server auto-discovery.
 * Priority: hardcoded known providers → Mozilla ISPDB → common patterns.
 */

import https from "https";
import net from "net";

export interface ServerSettings {
  imap: { host: string; port: number; tls: boolean };
  smtp: { host: string; port: number; tls: boolean };
  provider: "gmail" | "office365" | "exchange" | "generic";
}

// ── Known providers ───────────────────────────────────────────────────────────

const KNOWN: Record<string, ServerSettings> = {
  "gmail.com":        { provider: "gmail",     imap: { host: "imap.gmail.com",          port: 993, tls: true  }, smtp: { host: "smtp.gmail.com",          port: 465, tls: true  } },
  "googlemail.com":   { provider: "gmail",     imap: { host: "imap.gmail.com",          port: 993, tls: true  }, smtp: { host: "smtp.gmail.com",          port: 465, tls: true  } },
  "outlook.com":      { provider: "office365", imap: { host: "outlook.office365.com",   port: 993, tls: true  }, smtp: { host: "smtp.office365.com",      port: 587, tls: false } },
  "hotmail.com":      { provider: "office365", imap: { host: "outlook.office365.com",   port: 993, tls: true  }, smtp: { host: "smtp.office365.com",      port: 587, tls: false } },
  "live.com":         { provider: "office365", imap: { host: "outlook.office365.com",   port: 993, tls: true  }, smtp: { host: "smtp.office365.com",      port: 587, tls: false } },
  "msn.com":          { provider: "office365", imap: { host: "outlook.office365.com",   port: 993, tls: true  }, smtp: { host: "smtp.office365.com",      port: 587, tls: false } },
  "yahoo.com":        { provider: "generic",   imap: { host: "imap.mail.yahoo.com",     port: 993, tls: true  }, smtp: { host: "smtp.mail.yahoo.com",     port: 465, tls: true  } },
  "yahoo.de":         { provider: "generic",   imap: { host: "imap.mail.yahoo.com",     port: 993, tls: true  }, smtp: { host: "smtp.mail.yahoo.com",     port: 465, tls: true  } },
  "icloud.com":       { provider: "generic",   imap: { host: "imap.mail.me.com",        port: 993, tls: true  }, smtp: { host: "smtp.mail.me.com",        port: 587, tls: false } },
  "me.com":           { provider: "generic",   imap: { host: "imap.mail.me.com",        port: 993, tls: true  }, smtp: { host: "smtp.mail.me.com",        port: 587, tls: false } },
  "gmx.de":           { provider: "generic",   imap: { host: "imap.gmx.net",            port: 993, tls: true  }, smtp: { host: "mail.gmx.net",            port: 465, tls: true  } },
  "gmx.com":          { provider: "generic",   imap: { host: "imap.gmx.com",            port: 993, tls: true  }, smtp: { host: "mail.gmx.com",            port: 465, tls: true  } },
  "gmx.net":          { provider: "generic",   imap: { host: "imap.gmx.net",            port: 993, tls: true  }, smtp: { host: "mail.gmx.net",            port: 465, tls: true  } },
  "web.de":           { provider: "generic",   imap: { host: "imap.web.de",             port: 993, tls: true  }, smtp: { host: "smtp.web.de",             port: 587, tls: false } },
  "t-online.de":      { provider: "generic",   imap: { host: "secureimap.t-online.de",  port: 993, tls: true  }, smtp: { host: "securesmtp.t-online.de",  port: 465, tls: true  } },
  "freenet.de":       { provider: "generic",   imap: { host: "mx.freenet.de",           port: 993, tls: true  }, smtp: { host: "mx.freenet.de",           port: 587, tls: false } },
  "protonmail.com":   { provider: "generic",   imap: { host: "127.0.0.1",              port: 1143, tls: false }, smtp: { host: "127.0.0.1",              port: 1025, tls: false } },
  "proton.me":        { provider: "generic",   imap: { host: "127.0.0.1",              port: 1143, tls: false }, smtp: { host: "127.0.0.1",              port: 1025, tls: false } },
  "fastmail.com":     { provider: "generic",   imap: { host: "imap.fastmail.com",       port: 993, tls: true  }, smtp: { host: "smtp.fastmail.com",       port: 465, tls: true  } },
  "zoho.com":         { provider: "generic",   imap: { host: "imap.zoho.com",           port: 993, tls: true  }, smtp: { host: "smtp.zoho.com",           port: 465, tls: true  } },
};

// ── Main entry point ──────────────────────────────────────────────────────────

export async function discoverSettings(email: string): Promise<ServerSettings | null> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  // 1. Hardcoded known providers
  if (KNOWN[domain]) return KNOWN[domain];

  // 2. Mozilla ISPDB
  const ispdb = await queryISPDB(domain);
  if (ispdb) return ispdb;

  // 3. Common subdomain patterns (imap.domain.com, mail.domain.com, etc.)
  const guessed = await guessFromPatterns(domain);
  if (guessed) return guessed;

  return null;
}

// ── Mozilla ISPDB ─────────────────────────────────────────────────────────────

async function queryISPDB(domain: string): Promise<ServerSettings | null> {
  try {
    const xml = await httpsGet(`autoconfig.thunderbird.net`, `/v1.1/${domain}`);
    return parseISPDB(xml);
  } catch {
    try {
      // Some providers host it themselves
      const xml = await httpsGet(`autoconfig.${domain}`, `/mail/config-v1.1.xml`);
      return parseISPDB(xml);
    } catch {
      return null;
    }
  }
}

function parseISPDB(xml: string): ServerSettings | null {
  try {
    const imap = extractXmlServer(xml, "imap");
    const smtp = extractXmlServer(xml, "smtp");
    if (!imap || !smtp) return null;
    return { provider: "generic", imap, smtp };
  } catch {
    return null;
  }
}

function extractXmlServer(xml: string, type: "imap" | "smtp"): { host: string; port: number; tls: boolean } | null {
  const block = xml.match(new RegExp(`<incomingServer type="${type}"[^>]*>([\\s\\S]*?)</incomingServer>`, "i"))
    ?? xml.match(new RegExp(`<outgoingServer type="smtp"[^>]*>([\\s\\S]*?)</outgoingServer>`, "i"));
  if (!block) return null;
  const content = type === "smtp"
    ? (xml.match(/<outgoingServer type="smtp"[^>]*>([\s\S]*?)<\/outgoingServer>/i)?.[1] ?? "")
    : (xml.match(/<incomingServer type="imap"[^>]*>([\s\S]*?)<\/incomingServer>/i)?.[1] ?? "");

  const host = content.match(/<hostname>([^<]+)<\/hostname>/i)?.[1];
  const port = parseInt(content.match(/<port>(\d+)<\/port>/i)?.[1] ?? "0");
  const socket = content.match(/<socketType>([^<]+)<\/socketType>/i)?.[1]?.toUpperCase();
  if (!host || !port) return null;
  const tls = socket === "SSL" || socket === "SSL/TLS";
  return { host, port, tls };
}

// ── Pattern guessing ──────────────────────────────────────────────────────────

async function guessFromPatterns(domain: string): Promise<ServerSettings | null> {
  const imapHosts = [`imap.${domain}`, `mail.${domain}`, `imap.mail.${domain}`];
  const smtpHosts = [`smtp.${domain}`, `mail.${domain}`, `smtp.mail.${domain}`];

  const imapHost = await findReachable(imapHosts, 993) ?? await findReachable(imapHosts, 143);
  const smtpHost = await findReachable(smtpHosts, 465) ?? await findReachable(smtpHosts, 587);

  if (!imapHost || !smtpHost) return null;

  return {
    provider: "generic",
    imap: { host: imapHost.host, port: imapHost.port, tls: imapHost.port === 993 },
    smtp: { host: smtpHost.host, port: smtpHost.port, tls: smtpHost.port === 465 },
  };
}

function findReachable(hosts: string[], port: number): Promise<{ host: string; port: number } | null> {
  return Promise.any(
    hosts.map(
      (host) =>
        new Promise<{ host: string; port: number }>((resolve, reject) => {
          const sock = net.createConnection({ host, port, timeout: 3000 });
          sock.once("connect", () => { sock.destroy(); resolve({ host, port }); });
          sock.once("error",   () => { sock.destroy(); reject();               });
          sock.once("timeout", () => { sock.destroy(); reject();               });
        })
    )
  ).catch(() => null);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function httpsGet(hostname: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname, path, timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}
