#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
	captureOrbitItem,
	getOrbitSnapshot,
	listOrbitItems,
} from "../lib/orbit/store";

const server = new McpServer({
	name: "orbit",
	version: "0.1.0",
});

server.registerTool(
	"orbit_capture",
	{
		title: "Capture to Orbit",
		description:
			"Append a note, task, event, or link to the Orbit Inbox as a Markdown file.",
		inputSchema: {
			title: z.string().min(1).max(160),
			body: z.string().max(20_000).default(""),
			type: z.enum(["note", "task", "event", "link"]).default("note"),
			due: z.string().optional(),
		},
	},
	async (input) => {
		const item = await captureOrbitItem(input);
		return {
			content: [
				{
					type: "text",
					text: item
						? `Captured "${item.title}" to ${item.path}`
						: "Captured the item, but could not read it back.",
				},
			],
		};
	},
);

server.registerTool(
	"orbit_today",
	{
		title: "Read Orbit Today",
		description:
			"Read the open tasks due today and today's events from the Orbit vault.",
		inputSchema: {},
	},
	async () => {
		const snapshot = await getOrbitSnapshot();
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(snapshot.today, null, 2),
				},
			],
		};
	},
);

server.registerTool(
	"orbit_search",
	{
		title: "Search Orbit",
		description:
			"Search Orbit titles, Markdown bodies, tags, and project names.",
		inputSchema: {
			query: z.string().min(1).max(200),
			limit: z.number().int().min(1).max(50).default(10),
		},
	},
	async ({ query, limit }) => {
		const needle = query.toLocaleLowerCase();
		const items = (await listOrbitItems())
			.filter((item) =>
				[item.title, item.body, item.project ?? "", item.tags.join(" ")]
					.join("\n")
					.toLocaleLowerCase()
					.includes(needle),
			)
			.slice(0, limit);

		return {
			content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
		};
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
