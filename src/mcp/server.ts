#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scheduleSchema } from "../lib/orbit/assistant-schema";
import { createSearchIndex, searchItems } from "../lib/orbit/global-search";
import { isInboxItem } from "../lib/orbit/para";
import {
	agentScheduleIssue,
	SCHEDULE_INTENT_GUIDANCE,
} from "../lib/orbit/schedule-intent";
import { scheduleCategoryIdSchema } from "../lib/orbit/schema";
import {
	captureOrbitItem,
	createOrbitFolder,
	fileOrbitItem,
	getOrbitItem,
	getOrbitSnapshot,
	listOrbitItems,
} from "../lib/orbit/store";

const server = new McpServer(
	{
		name: "orbit",
		version: "0.2.0",
	},
	{ instructions: SCHEDULE_INTENT_GUIDANCE },
);

server.registerTool(
	"orbit_capture",
	{
		title: "Capture to Orbit Inbox",
		description:
			SCHEDULE_INTENT_GUIDANCE +
			" Capture a Markdown item. Notes and links appear in Inbox; tasks appear in Tasks and events in Calendar. PARA filing is optional.",
		inputSchema: {
			title: z.string().min(1).max(160),
			body: z.string().max(20_000).default(""),
			type: z.enum(["note", "task", "event", "link"]).default("note"),
			category: scheduleCategoryIdSchema.nullable().optional(),
			allDay: z.boolean().optional(),
			due: scheduleSchema.optional(),
			start: scheduleSchema.optional(),
			end: scheduleSchema.optional(),
			url: z.string().url().optional(),
		},
	},
	async (input) => {
		const issue = agentScheduleIssue(input);
		if (issue)
			return { isError: true, content: [{ type: "text", text: issue }] };
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
	"orbit_inbox",
	{
		title: "List Orbit Inbox",
		description:
			"List unprocessed Inbox notes and links. Items confirmed as tasks or events are managed in Tasks or Calendar instead.",
		inputSchema: {},
	},
	async () => {
		const items = (await listOrbitItems()).filter(isInboxItem);
		return {
			content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
		};
	},
);

server.registerTool(
	"orbit_list",
	{
		title: "List Orbit items",
		description:
			"List Orbit notes, tasks, events, and links. Filter by PARA space and optional folder.",
		inputSchema: {
			space: z
				.enum(["inbox", "project", "area", "resource", "event", "archive"])
				.optional(),
			folder: z.string().optional(),
			limit: z.number().int().min(1).max(100).default(30),
		},
	},
	async ({ space, folder, limit }) => {
		const items = (await listOrbitItems())
			.filter((item) => (space ? item.space === space : true))
			.filter((item) => (folder ? item.folder === folder : true))
			.slice(0, limit);
		return {
			content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
		};
	},
);

server.registerTool(
	"orbit_read",
	{
		title: "Read an Orbit item",
		description: "Read one Orbit Markdown item by id.",
		inputSchema: {
			id: z.string().min(1),
		},
	},
	async ({ id }) => {
		const item = await getOrbitItem(id);
		return {
			content: [
				{
					type: "text",
					text: item
						? JSON.stringify(item, null, 2)
						: `Orbit item not found: ${id}`,
				},
			],
		};
	},
);

server.registerTool(
	"orbit_file",
	{
		title: "File an Orbit item into PARA",
		description:
			SCHEDULE_INTENT_GUIDANCE +
			" Move an existing item into Projects, Areas, Resources, Archive, or Calendar. Creates the folder if needed. Convert a mistaken event with type=task and space=inbox (or its existing project), preserving its ID and work period.",
		inputSchema: {
			id: z.string().min(1),
			space: z.enum([
				"inbox",
				"project",
				"area",
				"resource",
				"event",
				"archive",
			]),
			folder: z.string().max(80).optional(),
			type: z.enum(["note", "task", "event", "link"]).optional(),
			category: scheduleCategoryIdSchema.nullable().optional(),
			allDay: z.boolean().optional(),
			title: z.string().max(160).optional(),
			body: z.string().max(100_000).optional(),
			due: scheduleSchema.nullable().optional(),
			start: scheduleSchema.nullable().optional(),
			end: scheduleSchema.nullable().optional(),
		},
	},
	async (input) => {
		const { id, ...rest } = input;
		if (["type", "start", "end", "allDay"].some((key) => key in rest)) {
			const current = await getOrbitItem(id);
			if (!current) throw new Error("Orbit item not found");
			const issue = agentScheduleIssue({
				...current,
				...Object.fromEntries(
					Object.entries(rest).filter(([, value]) => value !== undefined),
				),
				type: rest.type ?? current.type,
				title: rest.title ?? current.title,
			});
			if (issue)
				return { isError: true, content: [{ type: "text", text: issue }] };
		}
		const item = await fileOrbitItem(id, rest);
		return {
			content: [
				{
					type: "text",
					text: item
						? `Filed "${item.title}" to ${item.path}`
						: "Filed the item, but could not read it back.",
				},
			],
		};
	},
);

server.registerTool(
	"orbit_create_folder",
	{
		title: "Create a PARA folder",
		description: "Create a folder under Projects, Areas, or Resources.",
		inputSchema: {
			space: z.enum(["project", "area", "resource"]),
			name: z.string().min(1).max(80),
		},
	},
	async (input) => {
		const folder = await createOrbitFolder(input);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(folder, null, 2),
				},
			],
		};
	},
);

server.registerTool(
	"orbit_calendar",
	{
		title: "Read Orbit calendar",
		description:
			"List events and dated tasks. Optionally filter by YYYY-MM or YYYY-MM-DD.",
		inputSchema: {
			range: z.string().optional(),
		},
	},
	async ({ range }) => {
		const items = (await listOrbitItems()).filter((item) => {
			const key = (item.start ?? item.due)?.slice(0, 10);
			if (!key) return false;
			if (item.type !== "event" && item.type !== "task") return false;
			if (!range) return true;
			return key.startsWith(range);
		});
		return {
			content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
		};
	},
);

server.registerTool(
	"orbit_search",
	{
		title: "Search Orbit",
		description:
			"Search Orbit titles, Markdown bodies, tags, folders, and project names.",
		inputSchema: {
			query: z.string().min(1).max(200),
			limit: z.number().int().min(1).max(50).default(10),
		},
	},
	async ({ query, limit }) => {
		const items = searchItems(
			createSearchIndex(await listOrbitItems()),
			query,
			limit,
		).map(({ entry }) => entry.item);

		return {
			content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
		};
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
