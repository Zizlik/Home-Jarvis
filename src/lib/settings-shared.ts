/**
 * Client-safe copy of constants from lib/settings.ts (that module is "server-only").
 * MUST stay in sync with VOICES and CONNECTORS in src/lib/settings.ts.
 */

export const VOICES = ["marin", "quartz", "ripple", "vesper", "willow", "stone", "gleam", "meridian", "bossa", "tempo", "beacon", "delta", "cinder"] as const;

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

export const DEFAULT_AGENT_MODEL = "gpt-5.6-luna";
