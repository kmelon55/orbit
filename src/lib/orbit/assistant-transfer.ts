import { z } from "zod";
import { assistantRecordSchemas } from "./assistant-schema";
import type { OrbitDatabase } from "./database";

const prefix = "assistant.v1/";
const transferSchema = z
	.object({
		version: z.literal(1),
		records: z
			.array(
				z.object({ key: z.string().max(160), value: z.unknown() }).strict(),
			)
			.max(100000),
	})
	.strict();
function validated(input: unknown) {
	const parsed = transferSchema.parse(input);
	const keys = new Set<string>();
	return parsed.records.map((record) => {
		const match =
			/^assistant\.v1\/(goal|briefing|inbox|recommendation|audit)\/([^/]+)$/.exec(
				record.key,
			);
		if (!match || keys.has(record.key))
			throw new Error("Invalid or duplicate assistant record key");
		keys.add(record.key);
		const value = assistantRecordSchemas[
			match[1] as keyof typeof assistantRecordSchemas
		].parse(record.value);
		if (value.id !== match[2]) throw new Error("Assistant identity mismatch");
		return { key: record.key, value };
	});
}
export function exportAssistantRecords(database: OrbitDatabase) {
	const records = (
		database.sql
			.prepare("SELECT key,value FROM metadata WHERE key GLOB ? ORDER BY key")
			.all(`${prefix}*`) as { key: string; value: string }[]
	).map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
	return { version: 1, records: validated({ version: 1, records }) };
}
export function importAssistantRecords(
	database: OrbitDatabase,
	input: unknown,
) {
	for (const { key, value } of validated(input)) {
		const existing = database.metadata(key);
		if (
			existing &&
			JSON.stringify(
				validated({ version: 1, records: [{ key, value: existing }] })[0].value,
			) !== JSON.stringify(value)
		)
			throw new Error(`Import conflicts with assistant record: ${key}`);
		if (!existing) database.setMetadata(key, value);
	}
}
