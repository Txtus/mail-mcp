import { z } from "zod";
import { getEmail } from "../imap.js";

export const getEmailSchema = z.object({
  account: z.string().optional().describe("Account name to use (omit for default)"),
  uid: z.number().describe("The UID of the email to retrieve"),
  folder: z.string().optional().default("INBOX").describe("Mailbox folder"),
});

export async function handleGetEmail(args: z.infer<typeof getEmailSchema>) {
  try {
    const email = await getEmail(args.uid, args.folder, args.account);
    if (!email) {
      return { content: [{ type: "text", text: `Email with UID ${args.uid} not found.` }] };
    }
    const text = [
      `From: ${email.from}`,
      `To: ${email.to}`,
      email.cc ? `CC: ${email.cc}` : null,
      `Subject: ${email.subject}`,
      `Date: ${email.date}`,
      `Read: ${email.seen ? "Yes" : "No"}`,
      "",
      "--- Body ---",
      email.text || email.html || "(no body)",
    ]
      .filter((l) => l !== null)
      .join("\n");
    return { content: [{ type: "text", text }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
