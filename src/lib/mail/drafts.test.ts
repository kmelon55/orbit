import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type DraftValue,
	filterDrafts,
	hasDraftContent,
	summarizeDraft,
} from "./drafts";
import type { MailAccount } from "./types";

const account: MailAccount = {
	id: "account",
	provider: "icloud",
	email: "me@example.com",
	aliases: ["work@example.com"],
	name: "Me",
	notifications: false,
	createdAt: 0,
	lastSync: null,
	error: null,
};
const value: DraftValue = {
	accountId: account.id,
	from: "work@example.com",
	to: [],
	cc: [],
	bcc: [],
	subject: "",
	text: "",
	attachments: [],
};
test("draft filters follow sender identities and search recipients, subject and preview", () => {
	const draft = summarizeDraft({
		id: "draft",
		revision: 1,
		updatedAt: 1,
		value: {
			...value,
			to: ["friend@example.com"],
			subject: "한글 초안",
			text: "작성 중인 내용",
		},
	});
	assert.equal(filterDrafts([draft], [account], null).length, 1);
	assert.equal(
		filterDrafts([draft], [account], ["account/work@example.com"]).length,
		1,
	);
	assert.equal(filterDrafts([draft], [account], ["account"]).length, 0);
	assert.equal(filterDrafts([draft], [account], []).length, 0);
	assert.equal(filterDrafts([draft], [account], null, "한글").length, 1);
	assert.equal(filterDrafts([draft], [account], null, "FRIEND").length, 1);
	assert.equal(filterDrafts([draft], [account], null, "작성 중").length, 1);
	assert.equal(filterDrafts([draft], [account], null, "missing").length, 0);
});
test("an empty editor or sender-only change is not a new draft, but incomplete recipients and attachments are", () => {
	assert.equal(hasDraftContent(value), false);
	assert.equal(
		hasDraftContent({ ...value, subject: "  ", text: "\n", to: [" "] }),
		false,
	);
	assert.equal(hasDraftContent({ ...value, to: ["unfinished"] }), true);
	assert.equal(
		hasDraftContent({
			...value,
			attachments: [{ name: "a", content: "YQ==" }],
		}),
		true,
	);
});
