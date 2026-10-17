import assert from "node:assert/strict";
import { test } from "node:test";
import { inputRules, undoInputRule } from "@milkdown/kit/prose/inputrules";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createNoteTaskListInputRule } from "./note-task-list";

const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: { content: "inline*", group: "block" },
		text: { group: "inline" },
		bullet_list: { content: "list_item+", group: "block" },
		ordered_list: { content: "list_item+", group: "block" },
		list_item: {
			content: "paragraph block*",
			attrs: { checked: { default: null }, label: { default: "•" } },
		},
		code_block: { content: "text*", group: "block", code: true },
		heading: { content: "inline*", group: "block" },
	},
	marks: { code: { code: true } },
});
const paragraph = (text: string) =>
	schema.node("paragraph", null, text ? schema.text(text) : undefined);

function fixture(doc: ReturnType<typeof paragraph>, position: number) {
	const plugin = inputRules({ rules: [createNoteTaskListInputRule()] });
	let state = EditorState.create({
		doc,
		selection: TextSelection.create(doc, position),
		plugins: [plugin],
	});
	const view = {
		get state() {
			return state;
		},
		composing: false,
		dispatch(tr) {
			state = state.apply(tr);
		},
	} as EditorView;
	return {
		get state() {
			return state;
		},
		space() {
			const { from, to } = state.selection;
			return plugin.props.handleTextInput?.call(
				plugin,
				view,
				from,
				to,
				" ",
				() => state.tr.insertText(" "),
			);
		},
		undo() {
			return undoInputRule(state, (tr) => view.dispatch(tr));
		},
	};
}

test("checkbox shortcuts create unchecked and checked task lists in plain paragraphs", () => {
	for (const [marker, checked] of [
		["[]", false],
		["[ ]", false],
		["[x]", true],
		["[X]", true],
	] as const) {
		const editor = fixture(
			schema.node("doc", null, paragraph(marker)),
			marker.length + 1,
		);
		assert.equal(editor.space(), true);
		const list = editor.state.doc.firstChild;
		assert.equal(list?.type.name, "bullet_list");
		assert.equal(list?.firstChild?.attrs.checked, checked);
		assert.equal(list?.textContent, "");
		assert.equal(editor.state.selection.$from.parent.type.name, "paragraph");
		assert.equal(editor.undo(), true);
		assert.equal(editor.state.doc.firstChild?.type.name, "paragraph");
		assert.equal(editor.state.doc.textContent, `${marker} `);
	}
});

test("existing bullet and numbered items convert without nesting or losing following text", () => {
	for (const kind of ["bullet_list", "ordered_list"]) {
		const item = schema.node("list_item", { label: "3." }, paragraph("[]keep"));
		const doc = schema.node("doc", null, schema.node(kind, null, item));
		const editor = fixture(doc, 5);
		assert.equal(editor.space(), true);
		assert.equal(editor.state.doc.firstChild?.type.name, kind);
		assert.equal(editor.state.doc.firstChild?.firstChild?.attrs.checked, false);
		assert.equal(editor.state.doc.firstChild?.firstChild?.attrs.label, "3.");
		assert.equal(editor.state.doc.textContent, "keep");
	}
});

test("ordinary text, links, code, headings and existing checkboxes are preserved", () => {
	const cases = [
		{ node: paragraph("text []"), pos: 8 },
		{ node: paragraph("[label]"), pos: 8 },
		{ node: schema.node("code_block", null, schema.text("[]")), pos: 3 },
		{ node: schema.node("heading", null, schema.text("[]")), pos: 3 },
		{
			node: schema.node(
				"paragraph",
				null,
				schema.text("[]", [schema.mark("code")]),
			),
			pos: 3,
		},
		{
			node: schema.node(
				"bullet_list",
				null,
				schema.node("list_item", { checked: true }, paragraph("[]")),
			),
			pos: 5,
		},
		{
			node: schema.node(
				"bullet_list",
				null,
				schema.node("list_item", null, [paragraph("first"), paragraph("[]")]),
			),
			pos: 12,
		},
	];
	for (const { node, pos } of cases) {
		const doc = schema.node("doc", null, node);
		const editor = fixture(doc, pos);
		assert.equal(editor.space(), false);
		assert.deepEqual(editor.state.doc.toJSON(), doc.toJSON());
	}
});
