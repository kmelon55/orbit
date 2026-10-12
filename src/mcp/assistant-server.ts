#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type AssistantScope, createAssistantMcpServer } from "./assistant";

const configured = (process.env.ORBIT_ASSISTANT_SCOPES ?? "read")
	.split(",")
	.map((s) => s.trim());
if (configured.some((s) => s !== "read" && s !== "write"))
	throw new Error("Unknown ORBIT_ASSISTANT_SCOPES (use read or read,write)");
await createAssistantMcpServer(configured as AssistantScope[]).connect(
	new StdioServerTransport(),
);
