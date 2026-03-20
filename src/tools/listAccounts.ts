import { z } from "zod";
import { listAccountNames, listAccountTypes, loadConfig } from "../config.js";

export const listAccountsSchema = z.object({});

export async function handleListAccounts() {
  try {
    const names = listAccountNames();
    const types = listAccountTypes();
    const config = loadConfig();
    const lines = names.map((line) => `• ${line}`);

    const typesSummary = types.length > 0
      ? `\nAccount types: ${types.map((t) => `"${t}"`).join(", ")}`
      : "";

    return {
      content: [{
        type: "text",
        text: `Configured accounts (default: "${config.default}"):\n\n${lines.join("\n")}${typesSummary}`,
      }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
