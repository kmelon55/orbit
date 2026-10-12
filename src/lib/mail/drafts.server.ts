import {
	type DraftSummary,
	draftWriteSchema,
	type MailDraft,
	summarizeDraft,
} from "./drafts";
import { mailStore } from "./store.server";

export function readDraft(id: string): MailDraft | null {
	const s = mailStore();
	const row = s.db.prepare("SELECT data FROM drafts WHERE id=?").get(id) as
		| { data: string }
		| undefined;
	return row
		? {
				updatedAt: 0,
				...s.unseal<Omit<MailDraft, "updatedAt"> & { updatedAt?: number }>(
					row.data,
				),
				id,
			}
		: null;
}
export function listDrafts(): DraftSummary[] {
	const s = mailStore();
	// Backfill legacy drafts once; subsequent lists never decrypt attachment payloads.
	const legacy = s.db
		.prepare(
			"SELECT d.id,d.data FROM drafts d LEFT JOIN draft_index i ON i.id=d.id WHERE i.id IS NULL",
		)
		.all() as { id: string; data: string }[];
	for (const row of legacy) {
		const draft = {
			updatedAt: 0,
			...s.unseal<Omit<MailDraft, "updatedAt"> & { updatedAt?: number }>(
				row.data,
			),
			id: row.id,
		};
		s.db
			.prepare("INSERT OR IGNORE INTO draft_index VALUES (?,?,?)")
			.run(row.id, draft.revision, s.seal(summarizeDraft(draft)));
	}
	return (
		s.db
			.prepare("SELECT data FROM draft_index WHERE data IS NOT NULL")
			.all() as { data: string }[]
	)
		.map((row) => s.unseal<DraftSummary>(row.data))
		.filter(
			(d) =>
				d.subject.trim() ||
				d.snippet ||
				d.attachmentCount ||
				[...d.to, ...d.cc, ...d.bcc].some((v) => v.trim()),
		)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}
export function writeDraft(input: unknown) {
	const v = draftWriteSchema.parse(input);
	const s = mailStore();
	s.db.exec("BEGIN IMMEDIATE");
	try {
		const index = s.db
			.prepare("SELECT revision,data FROM draft_index WHERE id=?")
			.get(v.id) as { revision: number; data: string | null } | undefined;
		const previous = index ? null : readDraft(v.id);
		const revision = index?.revision ?? previous?.revision ?? 0;
		if (
			(index && index.data === null && v.value !== null) ||
			v.revision <= revision ||
			(v.baseRevision !== undefined && v.baseRevision !== revision)
		) {
			s.db.exec("ROLLBACK");
			return null;
		}
		const updatedAt = Date.now();
		const draft: MailDraft | null = v.value
			? { id: v.id, revision: v.revision, updatedAt, value: v.value }
			: null;
		if (draft) {
			s.db
				.prepare("INSERT OR REPLACE INTO drafts VALUES (?,?)")
				.run(v.id, s.seal(draft));
		} else s.db.prepare("DELETE FROM drafts WHERE id=?").run(v.id);
		s.db
			.prepare("INSERT OR REPLACE INTO draft_index VALUES (?,?,?)")
			.run(v.id, v.revision, draft ? s.seal(summarizeDraft(draft)) : null);
		s.db.exec("COMMIT");
		return { ok: true, revision: v.revision, updatedAt };
	} catch (error) {
		s.db.exec("ROLLBACK");
		throw error;
	}
}
