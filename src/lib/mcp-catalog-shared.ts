/** Shapes returned by GET /api/mcp/catalog (client-safe). */

export type CatalogHeader = { name: string; description: string; isRequired: boolean; isSecret: boolean };

export type CatalogItem = {
  /** Registry name, e.g. "ai.calendarmcp/server". */
  name: string;
  title: string;
  description: string;
  websiteUrl: string | null;
  repositoryUrl: string | null;
  url: string;
  transport: "streamable-http" | "sse";
  /** "token": Bearer token in the Authorization field; "headers": other required headers; "none": nothing declared. */
  auth: "none" | "token" | "headers";
  headers: CatalogHeader[];
  /** The URL contains {placeholders} the user has to fill in. */
  needsUrlEdit: boolean;
  updatedAt: string | null;
};

export type CatalogResponse = { items: CatalogItem[]; nextCursor: string | null };
