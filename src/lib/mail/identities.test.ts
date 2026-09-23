import assert from "node:assert/strict";
import { test } from "node:test";
import {
	accountAddresses,
	deliveryAddresses,
	mailScopes,
	mailViews,
	matchesAddress,
	matchingAddresses,
	replyAddress,
	senderAddress,
} from "./identities";
import { type MailAccount, type MailDetail, replyRecipients } from "./types";

const account: MailAccount = {
	id: "icloud",
	provider: "icloud",
	email: "me@icloud.com",
	aliases: ["hello@studio.com", "work@company.com"],
	defaultFrom: "hello@studio.com",
	name: "Me",
	notifications: true,
	createdAt: 0,
	lastSync: null,
	error: null,
};
const message: MailDetail = {
	id: "m",
	accountId: "icloud",
	folder: "inbox",
	remoteId: "1",
	from: [{ name: "Sender", address: "other@example.com" }],
	to: [{ name: "Me", address: "WORK@company.com" }],
	cc: [
		{ name: "Me", address: "hello@studio.com" },
		{ name: "Colleague", address: "team@example.com" },
	],
	date: 0,
	unread: true,
	subject: "Hi",
	snippet: "",
	hasAttachments: false,
	text: "",
	html: "",
	replyTo: [],
	messageId: "m",
	references: [],
	attachments: [],
};

test("address views share one connection and combine chosen addresses without duplicate sync", () => {
	const views = mailViews([account]);
	assert.deepEqual(
		views.map((view) => view.email),
		accountAddresses(account),
	);
	assert.equal(new Set(views.map((view) => view.id)).size, 3);
	assert.deepEqual(
		mailScopes(
			[account],
			views.slice(1).map((view) => view.id),
		).map((scope) => scope.addresses),
		[["hello@studio.com", "work@company.com"]],
	);
	assert.deepEqual(mailScopes([account], null)[0].addresses, []);
	assert.deepEqual(mailScopes([account], []), []);
});

test("sender allowlist preserves legacy accounts and rejects unregistered or removed aliases", () => {
	assert.equal(senderAddress(account), "hello@studio.com");
	assert.equal(senderAddress(account, "WORK@company.com"), "work@company.com");
	assert.throws(
		() => senderAddress(account, "spoof@example.com"),
		/등록된 발신 주소/,
	);
	assert.throws(
		() => senderAddress({ ...account, aliases: [] }, "work@company.com"),
		/등록된 발신 주소/,
	);
	assert.equal(
		senderAddress({ ...account, provider: "gmail", defaultFrom: undefined }),
		"me@icloud.com",
	);
	assert.throws(() =>
		senderAddress({ ...account, provider: "gmail" }, "work@company.com"),
	);
});

test("reply selects matching recipient or selected view; reply-all excludes every own identity", () => {
	assert.equal(
		replyAddress(account, message, "work@company.com"),
		"work@company.com",
	);
	assert.equal(
		replyAddress(account, { ...message, cc: [] }),
		"work@company.com",
	);
	assert.deepEqual(
		replyRecipients(message, account.email, true, accountAddresses(account)),
		{ to: ["other@example.com"], cc: ["team@example.com"] },
	);
	assert.equal(replyAddress(account, undefined), "hello@studio.com");
});

test("inbox, sent and archived mail use exact recipient/sender addresses, not substrings", () => {
	assert.equal(matchesAddress(message, "work@company.com"), true);
	assert.equal(matchesAddress(message, "other@example.com"), false);
	assert.equal(matchesAddress(message, "ork@company.com"), false);
	const sent = {
		...message,
		folder: "sent" as const,
		from: [{ name: "Me", address: "work@company.com" }],
	};
	assert.equal(matchesAddress(sent, "work@company.com"), true);
	assert.deepEqual(matchingAddresses(sent, account), ["work@company.com"]);
	assert.equal(replyAddress(account, sent), "work@company.com");
	assert.equal(
		matchesAddress({ ...sent, folder: "archive" }, "work@company.com"),
		true,
	);
});

test("delivery headers classify Bcc when available; unknown recipients are never guessed", () => {
	const deliveredTo = deliveryAddresses(
		"Delivered-To: <WORK@company.com>\r\nX-Original-To:\r\n hello@studio.com\r\nReferences: <not@recipient.com>",
	);
	assert.deepEqual(deliveredTo, ["work@company.com", "hello@studio.com"]);
	const hidden = { ...message, to: [], cc: [], deliveredTo };
	assert.equal(matchesAddress(hidden, "work@company.com"), true);
	assert.equal(
		replyAddress(account, hidden, "work@company.com"),
		"work@company.com",
	);
	assert.deepEqual(
		matchingAddresses({ ...hidden, deliveredTo: [] }, account),
		[],
	);
});
