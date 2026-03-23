import nodemailer from "nodemailer";
import { getAccount, SmtpConfig, AccountConfig, loadConfig } from "./config.js";
import { getAccessToken } from "./oauth2.js";

async function createTransporter(accountKey: string, acc: AccountConfig) {
  if (!acc.smtp) {
    throw new Error(`Account "${accountKey}" has no SMTP configuration. Add an "smtp" block to accounts.json.`);
  }
  const cfg = acc.smtp;

  // port 587 uses STARTTLS (secure:false + requireTLS:true); port 465 uses implicit TLS (secure:true)
  const secure = cfg.tls && cfg.port !== 587;
  const requireTLS = !secure && cfg.port === 587;

  if (acc.oauth2 && acc.provider && acc.provider !== "generic") {
    const accessToken = await getAccessToken(accountKey, acc.provider, acc.oauth2);
    return nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure,
      requireTLS,
      auth: {
        type: "OAuth2",
        user: cfg.user,
        accessToken,
      },
    });
  }

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure,
    requireTLS,
    auth: { user: cfg.user, pass: cfg.password },
  });
}

export interface SendOptions {
  account?: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
}

export async function sendEmail(options: SendOptions): Promise<string> {
  const accountKey = options.account ?? loadConfig().default;
  const acc = getAccount(options.account);
  const transporter = await createTransporter(accountKey, acc);

  const cfg = acc.smtp!;
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.user}>` : cfg.user;

  let { text, html } = options;

  if (cfg.signature) {
    // Append HTML signature — create an HTML body if there wasn't one
    const base = html ?? (text ? `<pre style="font-family:sans-serif">${text}</pre>` : "");
    html = `${base}<br><br>${cfg.signature}`;
    // Append a plain-text divider + stripped signature to the text part
    if (text) {
      const plainSig = cfg.signature.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      text = `${text}\n\n-- \n${plainSig}`;
    }
  }

  const info = await transporter.sendMail({
    from,
    to: options.to,
    cc: options.cc,
    subject: options.subject,
    text,
    html,
    replyTo: options.replyTo,
    inReplyTo: options.inReplyTo,
    references: options.references,
  });

  return info.messageId;
}
