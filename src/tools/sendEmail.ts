import { z } from "zod";
import { sendEmail } from "../smtp.js";
import { getEmail } from "../imap.js";

export const sendEmailSchema = z.object({
  account: z.string().optional().describe("Account key to send from (omit for default)"),
  to: z.string().describe("Recipient email address(es), comma-separated"),
  subject: z.string().describe("Email subject"),
  text: z.string().optional().describe("Plain text body"),
  html: z.string().optional().describe("HTML body"),
  cc: z.string().optional().describe("CC recipients, comma-separated"),
});

export async function handleSendEmail(args: z.infer<typeof sendEmailSchema>) {
  try {
    const messageId = await sendEmail(args);
    return { content: [{ type: "text", text: `Email sent successfully. Message-ID: ${messageId}` }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

export const replyEmailSchema = z.object({
  account: z.string().optional().describe("Account key to send from (omit for default)"),
  to: z.string().describe("Recipient email address"),
  subject: z.string().describe("Reply subject (usually 'Re: original subject')"),
  text: z.string().describe("Reply body (plain text)"),
  inReplyTo: z.string().optional().describe("Message-ID of the original email"),
  references: z.string().optional().describe("References header from the original email"),
});

export async function handleReplyEmail(args: z.infer<typeof replyEmailSchema>) {
  try {
    const messageId = await sendEmail({
      account: args.account,
      to: args.to,
      subject: args.subject,
      text: args.text,
      inReplyTo: args.inReplyTo,
      references: args.references,
    });
    return { content: [{ type: "text", text: `Reply sent successfully. Message-ID: ${messageId}` }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

export const forwardEmailSchema = z.object({
  account: z.string().optional().describe("Account key to forward from (omit for default)"),
  uid: z.number().describe("UID of the email to forward"),
  folder: z.string().optional().default("INBOX").describe("Folder containing the original email"),
  to: z.string().describe("Recipient to forward to"),
  note: z.string().optional().describe("Optional note to prepend above the forwarded message"),
});

export async function handleForwardEmail(args: z.infer<typeof forwardEmailSchema>) {
  try {
    const original = await getEmail(args.uid, args.folder, args.account);
    if (!original) {
      return { content: [{ type: "text", text: `Email UID ${args.uid} not found.` }], isError: true };
    }

    const subject = original.subject.startsWith("Fwd:")
      ? original.subject
      : `Fwd: ${original.subject}`;

    const divider = "-------- Forwarded Message --------";
    const header = [
      `From: ${original.from}`,
      `Date: ${original.date}`,
      `Subject: ${original.subject}`,
      `To: ${original.to}`,
    ].join("\n");

    const note = args.note ? `${args.note}\n\n` : "";
    const text = `${note}${divider}\n${header}\n\n${original.text || "(no body)"}`;

    const messageId = await sendEmail({
      account: args.account,
      to: args.to,
      subject,
      text,
      references: original.messageId,
    });
    return { content: [{ type: "text", text: `Email forwarded successfully. Message-ID: ${messageId}` }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
