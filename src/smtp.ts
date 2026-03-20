import nodemailer from "nodemailer";
import { getAccount, SmtpConfig, AccountConfig, loadConfig } from "./config.js";
import { getAccessToken } from "./oauth2.js";

async function createTransporter(accountKey: string, acc: AccountConfig) {
  const cfg = acc.smtp;

  if (acc.oauth2 && acc.provider && acc.provider !== "generic") {
    const accessToken = await getAccessToken(accountKey, acc.provider, acc.oauth2);
    return nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.tls,
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
    secure: cfg.tls,
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

  const cfg = acc.smtp;
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.user}>` : cfg.user;

  const info = await transporter.sendMail({
    from,
    to: options.to,
    cc: options.cc,
    subject: options.subject,
    text: options.text,
    html: options.html,
    replyTo: options.replyTo,
    inReplyTo: options.inReplyTo,
    references: options.references,
  });

  return info.messageId;
}
