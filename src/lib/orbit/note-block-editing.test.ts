import assert from "node:assert/strict";
import { test } from "node:test";
import { GapCursor } from "@milkdown/kit/prose/gapcursor";
import { history, undo } from "@milkdown/kit/prose/history";
import { Schema } from "@milkdown/kit/prose/model";
import {
	EditorState,
	NodeSelection,
	TextSelection,
} from "@milkdown/kit/prose/state";
import { deleteEmptyParagraphAfterMedia } from "./note-block-editing";

const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: { content: "inline*", group: "block" },
		text: { group: "inline" },
		"image-block": {
			group: "block",
			atom: true,
			isolating: true,
			attrs: { src: {} },
		},
		orbitVideo: { group: "block", atom: true },
		orbitCanvas: { group: "block", atom: true },
		hardbreak: { group: "inline", inline: true },
	},
});
const paragraph = (text = "") =>
	schema.node("paragraph", null, text ? schema.text(text) : undefined);
const image = (src: string) => schema.node("image-block", { src });
function fixture(nodes: ReturnType<typeof paragraph>[], pos: number) {
	const doc = schema.node("doc", null, nodes);
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, pos),
		plugins: [history()],
	});
}

test("one Backspace removes only the empty paragraph between images, and undo restores it", () => {
	let state = fixture(
		[image("first.png"), paragraph(), image("second.png")],
		2,
	);
	const original = state.doc.toJSON();
	assert.equal(
		deleteEmptyParagraphAfterMedia(state, (tr) => {
			state = state.apply(tr);
		}),
		true,
	);
	assert.equal(state.doc.childCount, 2);
	assert.deepEqual(
		[state.doc.child(0).attrs.src, state.doc.child(1).attrs.src],
		["first.png", "second.png"],
	);
	assert.ok(state.selection instanceof GapCursor);
	assert.equal(
		undo(state, (tr) => {
			state = state.apply(tr);
		}),
		true,
	);
	assert.deepEqual(state.doc.toJSON(), original);
});

test("handles empty paragraphs after videos and canvases without removing either block", () => {
	for (const kind of ["orbitVideo", "orbitCanvas"]) {
		let state = fixture([schema.node(kind), paragraph(), image("next.png")], 2);
		assert.equal(
			deleteEmptyParagraphAfterMedia(state, (tr) => {
				state = state.apply(tr);
			}),
			true,
		);
		assert.equal(state.doc.childCount, 2);
		assert.equal(state.doc.firstChild?.type.name, kind);
	}
});

test("does not intercept ordinary text, selected images, selected text, or the final typing paragraph", () => {
	const cases = [
		fixture([image("first.png"), paragraph("keep"), image("second.png")], 2),
		fixture([paragraph("first"), paragraph(), image("second.png")], 8),
		fixture([image("first.png"), paragraph()], 2),
		fixture([paragraph(), image("second.png")], 1),
	];
	const selected = fixture(
		[image("first.png"), paragraph("text"), image("second.png")],
		2,
	);
	cases.push(
		selected.apply(
			selected.tr.setSelection(NodeSelection.create(selected.doc, 0)),
		),
	);
	cases.push(
		selected.apply(
			selected.tr.setSelection(TextSelection.create(selected.doc, 2, 4)),
		),
	);
	for (const state of cases)
		assert.equal(deleteEmptyParagraphAfterMedia(state), false);
});

test("multiple empty paragraphs are removed one at a time without skipping their content", () => {
	let state = fixture(
		[image("first.png"), paragraph(), paragraph(), image("second.png")],
		2,
	);
	assert.equal(
		deleteEmptyParagraphAfterMedia(state, (tr) => {
			state = state.apply(tr);
		}),
		true,
	);
	assert.equal(state.doc.childCount, 3);
	assert.equal(state.doc.child(1).type.name, "paragraph");
});
