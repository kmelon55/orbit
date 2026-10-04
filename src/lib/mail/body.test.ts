import assert from "node:assert/strict";
import { test } from "node:test";
import { type BodyPart, readBody } from "./body.server";

test("selective MIME reading keeps alternatives, charset, inline images and file metadata without loading files", async () => {
	const root: BodyPart = {
		id: "root",
		type: "multipart/mixed",
		size: 0,
		children: [
			{
				id: "related",
				type: "multipart/related",
				size: 0,
				children: [
					{
						id: "alternative",
						type: "multipart/alternative",
						size: 0,
						children: [
							{
								id: "plain",
								type: "text/plain",
								charset: "iso-8859-1",
								size: 4,
							},
							{ id: "html", type: "text/html", size: 50 },
						],
					},
					{
						id: "image",
						type: "image/png",
						contentId: "<logo>",
						disposition: "inline",
						filename: "logo.png",
						size: 3,
					},
				],
			},
			{
				id: "file",
				type: "text/html",
				filename: "첨부.html",
				disposition: "attachment",
				size: 200_000_000,
			},
			{
				id: "eml",
				type: "message/rfc822",
				filename: "forwarded.eml",
				size: 200_000_000,
			},
		],
	};
	const requested: string[] = [];
	const body = await readBody(
		"From: Sender <sender@example.com>\r\nTo: me@example.com\r\nSubject: Test\r\nContent-Type: multipart/mixed;\r\n boundary=old\r\n",
		root,
		async (part) => {
			requested.push(part.id);
			if (part.id === "plain") return Buffer.from([0x63, 0x61, 0x66, 0xe9]);
			if (part.id === "html")
				return Buffer.from('<p>본문</p><img src="cid:logo">');
			if (part.id === "image") return Buffer.from([1, 2, 3]);
			throw new Error("File contents must remain at the provider");
		},
	);
	assert.deepEqual(requested, ["plain", "html", "image"]);
	assert.equal(body.parsed.text, "café");
	assert.match(String(body.parsed.html), /data:image\/png;base64,AQID/);
	assert.equal(body.parsed.subject, "Test");
	assert.deepEqual(
		body.attachments.map((a) => a.id),
		["file", "eml"],
	);
	assert.equal(body.attachments[0].size, 200_000_000);
});

test("body limits apply to downloaded body bytes while attachment-only mail remains readable", async () => {
	let loads = 0;
	const body = await readBody(
		"Subject: File only\r\n",
		{
			id: "file",
			type: "application/pdf",
			filename: "large.pdf",
			size: 200_000_000,
		},
		async () => {
			loads++;
			return Buffer.alloc(0);
		},
	);
	assert.equal(loads, 0);
	assert.equal(body.attachments[0].name, "large.pdf");
	await assert.rejects(
		() =>
			readBody(
				"",
				{ id: "body", type: "text/plain", size: 200_000_000 },
				async () => Buffer.alloc(0),
			),
		/본문이 너무 큽니다/,
	);
});
