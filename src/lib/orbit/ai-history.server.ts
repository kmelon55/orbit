import { mailStore } from "../mail/store.server";
import type { AiChat, AiChatSummary } from "./ai-types";

function store() {
	const current = mailStore();
	current.db.exec(`CREATE TABLE IF NOT EXISTS ai_chats (
    id TEXT PRIMARY KEY,
    updated_at INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ai_chats_updated ON ai_chats(updated_at DESC);`);
	return current;
}

export function aiChat(id: string): AiChat | null {
	const current = store();
	const row = current.db
		.prepare("SELECT data FROM ai_chats WHERE id=?")
		.get(id) as { data: string } | undefined;
	return row ? current.unseal<AiChat>(row.data) : null;
}

export function aiChats(limit = 50): AiChatSummary[] {
	const current = store();
	const rows = current.db
		.prepare("SELECT data FROM ai_chats ORDER BY updated_at DESC LIMIT ?")
		.all(limit) as { data: string }[];
	return rows.map(({ data }) => {
		const { id, title, createdAt, updatedAt } = current.unseal<AiChat>(data);
		return { id, title, createdAt, updatedAt };
	});
}

export function saveAiChat(chat: AiChat) {
	const current = store();
	current.db
		.prepare(
			"INSERT INTO ai_chats VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,data=excluded.data",
		)
		.run(chat.id, chat.updatedAt, current.seal(chat));
}

export function deleteAiChat(id: string) {
	store().db.prepare("DELETE FROM ai_chats WHERE id=?").run(id);
}
