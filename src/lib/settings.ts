import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

/**
 * Jarvis settings, stored server-side in data/settings.json (gitignored: MCP tokens live here).
 * The browser only ever sees publicSettings(), with secrets masked.
 */

export const VOICES = ["marin", "quartz", "ripple", "vesper", "willow", "stone", "gleam", "meridian", "bossa", "tempo", "beacon", "delta", "cinder"] as const;

/** OpenAI-hosted connectors (Responses API `connector_id`), authorized with an OAuth access token. */
export const CONNECTORS = {
  connector_googlecalendar: "Google Kalendář",
  connector_gmail: "Gmail",
  connector_googledrive: "Google Disk",
  connector_outlookcalendar: "Outlook kalendář",
  connector_outlookemail: "Outlook e-mail",
  connector_microsoftteams: "Microsoft Teams",
  connector_sharepoint: "SharePoint",
  connector_dropbox: "Dropbox",
} as const;
export type ConnectorId = keyof typeof CONNECTORS;

export const mcpServerSchema = z.object({
  id: z.string().min(1).max(64),
  /** Shown in the UI and used as the Responses `server_label` (slugified). */
  label: z.string().min(1).max(64),
  description: z.string().max(500).default(""),
  kind: z.enum(["url", "connector"]),
  /** kind "url": the remote MCP server (streamable HTTP / SSE). */
  url: z.string().url().optional(),
  /** kind "connector": an OpenAI connector id. */
  connectorId: z.enum(Object.keys(CONNECTORS) as [ConnectorId, ...ConnectorId[]]).optional(),
  /** Bearer / OAuth access token. Secret. */
  authorization: z.string().max(4000).optional(),
  /** Extra HTTP headers for kind "url". Values are secret. */
  headers: z.record(z.string(), z.string().max(4000)).default({}),
  /** Restrict to these tool names; empty = all. */
  allowedTools: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});
export type McpServer = z.infer<typeof mcpServerSchema>;

/** Where saved cards are also written in Google (see lib/google/sync.ts). */
export const googleSyncSchema = z.object({
  event: z.boolean().default(true),
  reminder: z.boolean().default(true),
  todo: z.enum(["tasks", "keep", "off"]).default("tasks"),
  note: z.enum(["keep", "off"]).default("keep"),
});
export type GoogleSync = z.infer<typeof googleSyncSchema>;

export const settingsSchema = z.object({
  voice: z.enum(VOICES).default("marin"),
  /** Model for questions and MCP work (anything Jev can't do with a card). */
  agentModel: z.string().min(1).default("gpt-5.6-luna"),
  mcp: z.array(mcpServerSchema).default([]),
  google: googleSyncSchema.default(googleSyncSchema.parse({})),
});
export type Settings = z.infer<typeof settingsSchema>;

const FILE = join(process.cwd(), "data", "settings.json");

export async function readSettings(): Promise<Settings> {
  try {
    return settingsSchema.parse(JSON.parse(await readFile(FILE, "utf8")));
  } catch {
    return settingsSchema.parse({});
  }
}

export async function writeSettings(next: Settings): Promise<void> {
  const valid = settingsSchema.parse(next);
  await mkdir(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(valid, null, 2), { mode: 0o600 });
  await rename(tmp, FILE);
}

const mask = (s?: string) => (s ? `••••${s.slice(-4)}` : "");

/** Settings safe to send to the browser: secrets replaced by "••••last4". */
export function publicSettings(s: Settings) {
  return {
    ...s,
    mcp: s.mcp.map((m) => ({
      ...m,
      authorization: mask(m.authorization),
      headers: Object.fromEntries(Object.entries(m.headers).map(([k, v]) => [k, mask(v)])),
    })),
  };
}
export type PublicSettings = ReturnType<typeof publicSettings>;

/** A value from the browser that is still masked means "keep the stored secret". */
export const isMasked = (v?: string) => !!v && v.startsWith("••••");

const label = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "") || "mcp";

/** Enabled MCP servers as Responses API tools. */
export function mcpTools(s: Settings) {
  return s.mcp
    .filter((m) => m.enabled)
    .map((m) => ({
      type: "mcp" as const,
      server_label: label(m.label),
      ...(m.description ? { server_description: m.description } : {}),
      ...(m.kind === "connector" ? { connector_id: m.connectorId } : { server_url: m.url }),
      ...(m.authorization ? { authorization: m.authorization } : {}),
      ...(m.kind === "url" && Object.keys(m.headers).length ? { headers: m.headers } : {}),
      ...(m.allowedTools.length ? { allowed_tools: m.allowedTools } : {}),
      require_approval: "never" as const,
    }));
}
