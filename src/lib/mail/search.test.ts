import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MailStore } from "./store.server";
import type { MailAccount, MailMessage } from "./types";

test("cached mail search spans folders, ranks subject matches, and updates after writes", () => {
	const directory = mkdtempSync(join(tmpdir(), "orbit-search-mail-"));
	const store = new MailStore(directory);
	const accountId = randomUUID();
	const account: MailAccount = {
		id: accountId,
		provider: "gmail",
		email: "me@example.com",
		name: "Me",
		notifications: false,
		createdAt: 1,
		lastSync: null,
		error: null,
	};
	store.saveAccount(account, { refreshToken: "test" });
	const message = (
		id: string,
		folder: MailMessage["folder"],
		subject: string,
		snippet: string,
	): MailMessage => ({
		id,
		accountId,
		folder,
		remoteId: id,
		subject,
		from: [{ name: "Kim", address: "sender@example.com" }],
		to: [{ name: "Me", address: "me@example.com" }],
		cc: [],
		date: id === "sent" ? 2 : 1,
		unread: true,
		snippet,
		hasAttachments: false,
	});
	try {
		store.saveMessages([
			message("inbox", "inbox", "계약 검토", "초안"),
			message("sent", "sent", "회신", "계약 검토 부탁드립니다"),
			message("archive", "archive", "다른 내용", "별개"),
		]);
		assert.deepEqual(
			store.searchMessages("계약 검토").map((m) => m.id),
			["inbox", "sent"],
		);
		assert.deepEqual(
			store.searchMessages("sender@example.com").map((m) => m.id),
			["sent", "inbox", "archive"],
		);
		assert.deepEqual(store.searchMessages("본문전용표현"), []);
		const detailed = {
			...message("sent", "sent", "회신", "계약 검토 부탁드립니다"),
			text: "서두에 이어 본문전용표현이 담긴 긴 메일 내용입니다.",
			html: "",
			replyTo: [],
			messageId: "sent@example.com",
			references: [],
			attachments: [],
		};
		store.saveBody("sent", detailed, detailed);
		assert.deepEqual(
			store.searchMessages("본문전용표현").map((m) => m.id),
			["sent"],
		);
		assert.match(
			store.searchMessages("본문전용표현")[0].snippet,
			/본문전용표현/,
		);
		store.saveMessages([message("archive", "archive", "계약 완료", "검토 끝")]);
		assert.deepEqual(
			store.searchMessages("계약 검토").map((m) => m.id),
			["inbox", "archive", "sent"],
		);
		store.deleteMessage("inbox");
		assert.deepEqual(
			store.searchMessages("계약 검토").map((m) => m.id),
			["archive", "sent"],
		);
		store.removeAccount(accountId);
		assert.deepEqual(store.searchMessages("계약"), []);
	} finally {
		store.db.close();
		rmSync(directory, { recursive: true, force: true });
	}
});
