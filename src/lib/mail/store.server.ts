import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	randomUUID,
} from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
	MailAccount,
	MailDetail,
	MailMessage,
	MailSecret,
	SendResult,
} from "./types";

export function mailDirectory() {
	return resolve(
		process.env.ORBIT_MAIL_DIR ||
			join(
				process.env.ORBIT_VAULT_DIR || process.env.ORBIT_DATA_DIR || "./vault",
				".orbit/mail",
			),
	);
}
export class MailStore {
	readonly db: DatabaseSync;
	private key: Buffer;
	constructor(directory: string) {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const keyPath = join(directory, "secret.key");
		const configured = process.env.ORBIT_MAIL_ENCRYPTION_KEY;
		if (configured && !/^[a-f0-9]{64}$/i.test(configured))
			throw new Error("메일 암호화 키는 64자리 hex여야 합니다.");
		if (!configured && !existsSync(keyPath)) {
			// Do not silently replace a lost key for an existing database.
			if (existsSync(join(directory, "mail.sqlite")))
				throw new Error("메일 암호화 키를 복원해 주세요.");
			try {
				writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
			} catch (error) {
				if (!existsSync(keyPath)) throw error;
			}
		}
		this.key = configured
			? Buffer.from(configured, "hex")
			: readFileSync(keyPath);
		if (this.key.length !== 32)
			throw new Error("메일 암호화 키가 올바르지 않습니다.");
		this.db = new DatabaseSync(join(directory, "mail.sqlite"));
		chmodSync(join(directory, "mail.sqlite"), 0o600);
		this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE, data TEXT NOT NULL, secret TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, folder TEXT NOT NULL, date INTEGER NOT NULL, data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS messages_folder ON messages(account_id,folder,date DESC);
   CREATE TABLE IF NOT EXISTS bodies (id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, cached_at INTEGER NOT NULL, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS seen (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, remote_id TEXT NOT NULL, PRIMARY KEY(account_id,remote_id));
   CREATE TABLE IF NOT EXISTS sends (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, hash TEXT NOT NULL, result TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS oauth (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS push_jobs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, data TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, expires INTEGER NOT NULL);
  `);
	}
	seal(value: unknown) {
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.key, iv);
		const bytes = Buffer.concat([
			cipher.update(JSON.stringify(value)),
			cipher.final(),
		]);
		return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
	}
	unseal<T>(value: string): T {
		const bytes = Buffer.from(value, "base64");
		const decipher = createDecipheriv(
			"aes-256-gcm",
			this.key,
			bytes.subarray(0, 12),
		);
		decipher.setAuthTag(bytes.subarray(12, 28));
		return JSON.parse(
			Buffer.concat([
				decipher.update(bytes.subarray(28)),
				decipher.final(),
			]).toString(),
		);
	}
	accounts(): MailAccount[] {
		return (
			this.db.prepare("SELECT data FROM accounts").all() as { data: string }[]
		).map((r) => JSON.parse(r.data));
	}
	account(id: string) {
		const a = this.accounts().find((a) => a.id === id);
		if (!a) throw new Error("메일 계정을 찾을 수 없습니다.");
		return a;
	}
	secret(id: string) {
		const r = this.db
			.prepare("SELECT secret FROM accounts WHERE id=?")
			.get(id) as { secret: string } | undefined;
		if (!r) throw new Error("메일 계정을 찾을 수 없습니다.");
		return this.unseal<MailSecret>(r.secret);
	}
	saveAccount(account: MailAccount, secret?: MailSecret) {
		this.db
			.prepare(
				"INSERT INTO accounts VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,data=excluded.data,secret=excluded.secret",
			)
			.run(
				account.id,
				account.email,
				JSON.stringify(account),
				this.seal(secret || this.secret(account.id)),
			);
	}
	removeAccount(id: string) {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db.prepare("DELETE FROM accounts WHERE id=?").run(id);
			for (const row of this.db.prepare("SELECT id,data FROM drafts").all() as {
				id: string;
				data: string;
			}[]) {
				if (
					this.unseal<{ value: { accountId: string } }>(row.data).value
						.accountId === id
				)
					this.db.prepare("DELETE FROM drafts WHERE id=?").run(row.id);
			}
			this.db.prepare("DELETE FROM settings WHERE key=?").run(`baseline:${id}`);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	messages(accountId?: string, folder = "inbox", query = ""): MailMessage[] {
		const rows = (
			accountId
				? this.db
						.prepare(
							"SELECT data FROM messages WHERE account_id=? AND folder=? ORDER BY date DESC",
						)
						.all(accountId, folder)
				: this.db
						.prepare(
							"SELECT data FROM messages WHERE folder=? ORDER BY date DESC",
						)
						.all(folder)
		) as { data: string }[];
		const search = query.toLowerCase();
		return rows
			.map((r) => this.unseal<MailMessage>(r.data))
			.filter(
				(m) =>
					!search ||
					[
						m.subject,
						m.snippet,
						...[...m.from, ...m.to, ...m.cc].map(
							(a) => `${a.name} ${a.address}`,
						),
					]
						.join(" ")
						.toLowerCase()
						.includes(search),
			);
	}
	message(id: string) {
		const r = this.db.prepare("SELECT data FROM messages WHERE id=?").get(id) as
			| { data: string }
			| undefined;
		if (!r)
			throw new Error("메일을 찾을 수 없습니다. 목록을 새로고침해 주세요.");
		return this.unseal<MailMessage>(r.data);
	}
	saveMessages(messages: MailMessage[]) {
		const stmt = this.db.prepare(
			"INSERT INTO messages VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,data=excluded.data",
		);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			for (const m of messages) {
				const previous = this.db
					.prepare("SELECT data FROM messages WHERE id=?")
					.get(m.id) as { data: string } | undefined;
				const cached = previous
					? this.unseal<MailMessage>(previous.data)
					: undefined;
				stmt.run(
					m.id,
					m.accountId,
					m.folder,
					m.date,
					this.seal({ ...m, snippet: m.snippet || cached?.snippet || "" }),
				);
			}
			this.db.exec("COMMIT");
		} catch (e) {
			this.db.exec("ROLLBACK");
			throw e;
		}
	}
	body(id: string): { hidden: MailDetail; visible: MailDetail } | null {
		const row = this.db
			.prepare("SELECT data FROM bodies WHERE id=? AND cached_at>?")
			.get(id, Date.now() - 7 * 86_400_000) as { data: string } | undefined;
		const body = row
			? this.unseal<{
					version?: number;
					hidden: MailDetail;
					visible: MailDetail;
				}>(row.data)
			: null;
		return body?.version === 2 ? body : null;
	}
	saveBody(id: string, hidden: MailDetail, visible: MailDetail) {
		// Cache sanitized body variants, never raw attachments. Bound both size and retention.
		const data = this.seal({ version: 2, hidden, visible });
		if (data.length > 4 * 1024 * 1024) return;
		this.db
			.prepare("INSERT OR REPLACE INTO bodies VALUES (?,?,?)")
			.run(id, Date.now(), data);
		this.db
			.prepare(
				"DELETE FROM bodies WHERE cached_at<? OR id IN (SELECT id FROM bodies ORDER BY cached_at DESC LIMIT -1 OFFSET 100)",
			)
			.run(Date.now() - 7 * 86_400_000);
	}
	deleteMessage(id: string) {
		this.db.prepare("DELETE FROM messages WHERE id=?").run(id);
	}
	reconcile(
		accountId: string,
		folder: string,
		ids: string[],
		complete: boolean,
		cutoff: number,
	) {
		for (const m of this.messages(accountId, folder))
			if (!ids.includes(m.id) && (complete || m.date >= cutoff))
				this.deleteMessage(m.id);
	}
	markSeen(accountId: string, remoteId: string) {
		return (
			Number(
				this.db
					.prepare("INSERT OR IGNORE INTO seen VALUES (?,?)")
					.run(accountId, remoteId).changes,
			) > 0
		);
	}
	setting<T>(key: string): T | null {
		const r = this.db
			.prepare("SELECT value FROM settings WHERE key=?")
			.get(key) as { value: string } | undefined;
		return r ? this.unseal<T>(r.value) : null;
	}
	setSetting(key: string, value: unknown) {
		this.db
			.prepare("INSERT OR REPLACE INTO settings VALUES (?,?)")
			.run(key, this.seal(value));
	}
	beginSend(id: string, accountId: string, hash: string): SendResult | null {
		const row = this.db
			.prepare("SELECT hash,result FROM sends WHERE id=?")
			.get(id) as { hash: string; result: string } | undefined;
		if (row) {
			if (row.hash !== hash)
				throw new Error("이 발송 요청은 다른 내용으로 이미 사용되었습니다.");
			return JSON.parse(row.result);
		}
		this.db.prepare("INSERT INTO sends VALUES (?,?,?,?)").run(
			id,
			accountId,
			hash,
			JSON.stringify({
				status: "uncertain",
				warning:
					"발송 결과를 확인 중입니다. 보낸 메일함을 확인하고 중복 발송하지 마세요.",
			}),
		);
		return null;
	}
	finishSend(id: string, result: SendResult) {
		this.db
			.prepare("UPDATE sends SET result=? WHERE id=?")
			.run(JSON.stringify(result), id);
	}
	addSubscription(value: unknown, endpoint: string) {
		this.db
			.prepare("INSERT OR REPLACE INTO subscriptions VALUES (?,?)")
			.run(
				createHash("sha256").update(endpoint).digest("hex"),
				this.seal(value),
			);
	}
	removeSubscription(endpoint: string) {
		this.db
			.prepare("DELETE FROM subscriptions WHERE id=?")
			.run(createHash("sha256").update(endpoint).digest("hex"));
	}
	subscriptions<T>(): T[] {
		return (
			this.db.prepare("SELECT data FROM subscriptions").all() as {
				data: string;
			}[]
		).map((r) => this.unseal<T>(r.data));
	}
	oauth<T>(id: string): T | null {
		const r = this.db
			.prepare("DELETE FROM oauth WHERE id=? AND expires>? RETURNING data")
			.get(id, Date.now()) as { data: string } | undefined;
		return r ? this.unseal<T>(r.data) : null;
	}
	createOauth(value: unknown) {
		const id = randomUUID();
		this.db.prepare("DELETE FROM oauth WHERE expires<?").run(Date.now());
		this.db
			.prepare("INSERT INTO oauth VALUES (?,?,?)")
			.run(id, this.seal(value), Date.now() + 600_000);
		return id;
	}
}
const globalStore = globalThis as typeof globalThis & {
	orbitMailStores?: Map<string, MailStore>;
};
globalStore.orbitMailStores ??= new Map();
const stores = globalStore.orbitMailStores;
export function mailStore() {
	const dir = mailDirectory();
	let s = stores.get(dir);
	if (!s) {
		s = new MailStore(dir);
		stores.set(dir, s);
	}
	return s;
}
export function messageKey(
	accountId: string,
	folder: string,
	remoteId: string,
) {
	return createHash("sha256")
		.update(`${accountId}\0${folder}\0${remoteId}`)
		.digest("hex");
}
