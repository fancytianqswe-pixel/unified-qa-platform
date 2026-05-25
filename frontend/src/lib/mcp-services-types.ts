export const MCP_TRANSPORTS = ["stdio", "sse", "streamable_http", "json"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export type McpServicePublic = {
  id: string;
  name: string;
  transport: McpTransport;
  definition: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type McpServiceCreateBody = {
  name: string;
  transport: McpTransport;
  definition: Record<string, unknown>;
};
