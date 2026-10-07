import assert from "node:assert/strict";
import test from "node:test";
import type { mailApi } from "./client";
import { mailSessionFor } from "./session-cache";
import type { MailDetail } from "./types";

test("reopening Mail reuses bodies and threads while separate mail clients remain isolated", () => {
	const live = (() =>
		Promise.reject(new Error("unexpected request"))) as typeof mailApi;
	const demo = (() =>
		Promise.reject(new Error("unexpected request"))) as typeof mailApi;
	const session = mailSessionFor(live);
	const body = {
		id: "opened-message",
		html: "<p>Already opened</p>",
	} as unknown as MailDetail;
	session.details.set("opened-message:true", body);
	session.threads.set("opened-message", { messages: [], incomplete: false });
	assert.equal(mailSessionFor(live).details.get("opened-message:true"), body);
	assert.equal(
		mailSessionFor(live).threads.get("opened-message")?.incomplete,
		false,
	);
	assert.equal(mailSessionFor(demo).details.size, 0);
	assert.equal(mailSessionFor(demo).threads.size, 0);
	// Mutation invalidation remains visible to the next page instance.
	session.details.delete("opened-message:true");
	session.threads.clear();
	assert.equal(mailSessionFor(live).details.size, 0);
	assert.equal(mailSessionFor(live).threads.size, 0);
});
