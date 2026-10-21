import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiMessage } from "../../components/ai-message";
import { aiSourceHref } from "./ai-markdown";
import type { AiSource } from "./ai-types";

const source: AiSource = {
	kind: "item",
	id: "note / 한글",
	index: 1,
	title: "기획 문서",
	scope: "full",
};
const render = (content: string) =>
	renderToStaticMarkup(
		createElement(AiMessage, {
			content,
			sources: [source],
			onOpenSource() {},
			onNavigate() {},
		}),
	);

test("AI renders GFM, safe links and actionable known citations", () => {
	const html = render(
		"## 결과\n\n**강조** [1] [99]\n\n- 목록\n\n| 항목 | 값 |\n| --- | --- |\n| Draft | 1 |\n\n```ts\nconst source = '[1]';\n```\n\nhttps://example.com",
	);
	assert.match(html, /<h2>결과<\/h2>/);
	assert.match(html, /<strong>강조<\/strong>/);
	assert.match(html, /<table /);
	assert.match(html, /<ul>/);
	assert.ok(html.includes(`href="${aiSourceHref(source)}"`));
	assert.match(html, /\[99\]/);
	assert.match(html, /const source = &#x27;\[1\]&#x27;;/);
	assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});

test("AI does not turn code, unknown citations, HTML or dangerous URLs into actions", () => {
	const html = render(
		"`[1]` [99] [danger](javascript:alert(1))\n\n<script>alert(1)</script>\n\n![tracking](https://example.com/pixel)",
	);
	assert.doesNotMatch(html, /href=|<script|<img|javascript:/);
	assert.match(html, /<code>\[1\]<\/code>/);
});
