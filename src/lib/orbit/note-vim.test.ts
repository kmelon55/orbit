import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
	createNoteVimController,
	type NoteVimMode,
	shouldAllowNoteVimDocumentChange,
} from "@/lib/orbit/note-vim";

const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: { content: "inline*", group: "block" },
		text: { group: "inline" },
	},
});

function editor(...paragraphs: string[]) {
	const doc = schema.node(
		"doc",
		null,
		paragraphs.map((text) =>
			schema.node("paragraph", null, text ? schema.text(text) : undefined),
		),
	);
	let state = EditorState.create({
		schema,
		doc,
		selection: TextSelection.create(doc, 1),
	});
	let composing = false;
	const view = {
		get state() {
			return state;
		},
		get composing() {
			return composing;
		},
		dispatch(transaction: Transaction) {
			state = state.apply(transaction);
		},
		focus() {},
		dom: {
			blur() {},
		},
		coordsAtPos() {
			return { left: 0, right: 0, top: 0, bottom: 20 };
		},
		posAtCoords() {
			return null;
		},
	} as unknown as EditorView;
	return {
		view,
		setComposing(next: boolean) {
			composing = next;
		},
	};
}

function keyboard(
	code: string,
	key = "Process",
	extra: Partial<KeyboardEvent> = {},
) {
	return {
		code,
		key,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		isComposing: false,
		...extra,
	} as KeyboardEvent;
}

test("normal commands only use English key values", () => {
	const { view } = editor("한글 입력");
	let mode: NoteVimMode = "normal";
	const vim = createNoteVimController({
		getMode: () => mode,
		getExitSequence: () => "jk",
		setMode: (next) => {
			mode = next;
		},
	});

	assert.equal(
		vim.handleKeyDown(view, keyboard("KeyL", "Process", { isComposing: true })),
		true,
	);
	assert.equal(view.state.selection.from, 1);
	assert.equal(mode, "normal");
	assert.equal(vim.handleKeyDown(view, keyboard("KeyL", "l")), true);
	assert.equal(view.state.selection.from, 2);
	assert.equal(vim.handleKeyDown(view, keyboard("KeyI", "i")), true);
	assert.equal(mode, "insert");
});

test("Escape waits for an active Korean composition before leaving insert mode", () => {
	const { view, setComposing } = editor("한글");
	let mode: NoteVimMode = "insert";
	const vim = createNoteVimController({
		getMode: () => mode,
		getExitSequence: () => "jk",
		setMode: (next) => {
			mode = next;
		},
	});

	setComposing(true);
	assert.equal(vim.handleKeyDown(view, keyboard("Escape", "Escape")), false);
	assert.equal(mode, "insert");
	setComposing(false);
	assert.equal(vim.handleKeyDown(view, keyboard("Escape", "Escape")), true);
	assert.equal(mode, "normal");
});

test("Korean text participates in word motions and block deletion", () => {
	const { view } = editor("한글 abc", "둘째 문단");
	let mode: NoteVimMode = "normal";
	const vim = createNoteVimController({
		getMode: () => mode,
		getExitSequence: () => "jk",
		setMode: (next) => {
			mode = next;
		},
	});

	assert.equal(vim.handleKeyDown(view, keyboard("KeyW", "w")), true);
	assert.equal(view.state.selection.from, 4);
	vim.handleKeyDown(view, keyboard("KeyD", "d"));
	vim.handleKeyDown(view, keyboard("KeyD", "d"));
	assert.equal(view.state.doc.textContent, "둘째 문단");
});

test("visual mode selects Korean text and arrow keys move without inserting", () => {
	const { view } = editor("한글 선택");
	let mode: NoteVimMode = "normal";
	const vim = createNoteVimController({
		getMode: () => mode,
		getExitSequence: () => "jk",
		setMode: (next) => {
			mode = next;
		},
	});

	assert.equal(vim.handleKeyDown(view, keyboard("KeyV", "v")), true);
	assert.equal(mode, "visual");
	assert.equal(
		view.state.doc.textBetween(
			view.state.selection.from,
			view.state.selection.to,
		),
		"한",
	);
	vim.handleKeyDown(view, keyboard("KeyL", "l"));
	assert.equal(
		view.state.doc.textBetween(
			view.state.selection.from,
			view.state.selection.to,
		),
		"한글",
	);

	vim.handleKeyDown(view, keyboard("Escape", "Escape"));
	const position = view.state.selection.from;
	const content = view.state.doc.textContent;
	assert.equal(mode, "normal");
	assert.equal(
		vim.handleKeyDown(view, keyboard("ArrowRight", "ArrowRight")),
		true,
	);
	assert.ok(view.state.selection.from > position);
	assert.equal(view.state.doc.textContent, content);
});

test("jk is ignored during composition and exits in English input", () => {
	const { view } = editor("시작 ");
	let mode: NoteVimMode = "insert";
	const vim = createNoteVimController({
		getMode: () => mode,
		getExitSequence: () => "jk",
		setMode: (next) => {
			mode = next;
		},
	});

	assert.equal(
		vim.handleKeyDown(view, keyboard("KeyJ", "Process", { isComposing: true })),
		false,
	);
	view.dispatch(view.state.tr.insertText("ㅓ"));
	assert.equal(
		vim.handleKeyDown(view, keyboard("KeyK", "Process", { isComposing: true })),
		false,
	);
	assert.equal(mode, "insert");
	assert.equal(view.state.doc.textContent, "ㅓ시작 ");

	assert.equal(vim.handleKeyDown(view, keyboard("KeyJ", "j")), false);
	view.dispatch(view.state.tr.insertText("j"));
	assert.equal(vim.handleKeyDown(view, keyboard("KeyK", "k")), true);
	assert.equal(mode, "normal");
	assert.equal(view.state.doc.textContent, "ㅓ시작 ");
});

test("e crosses whitespace when already at the end of a Korean word", () => {
	const { view } = editor("한글 다음");
	let mode: NoteVimMode = "normal";
	const vim = createNoteVimController({
		getMode: () => mode,
		getExitSequence: () => "jk",
		setMode: (next) => {
			mode = next;
		},
	});

	vim.handleKeyDown(view, keyboard("KeyE", "e"));
	assert.equal(view.state.selection.from, 2);
	vim.handleKeyDown(view, keyboard("KeyE", "e"));
	assert.equal(view.state.selection.from, 5);
});

test("dot repeats character and block deletion", () => {
	const characterEditor = editor("abcd");
	let mode: NoteVimMode = "normal";
	const vim = createNoteVimController({
		getMode: () => mode,
		getExitSequence: () => "jk",
		setMode: (next) => {
			mode = next;
		},
	});

	vim.handleKeyDown(characterEditor.view, keyboard("KeyX", "x"));
	vim.handleKeyDown(characterEditor.view, keyboard("Period", "."));
	assert.equal(characterEditor.view.state.doc.textContent, "cd");

	const blockEditor = editor("첫째", "둘째", "셋째");
	vim.handleKeyDown(blockEditor.view, keyboard("KeyD", "d"));
	vim.handleKeyDown(blockEditor.view, keyboard("KeyD", "d"));
	vim.handleKeyDown(blockEditor.view, keyboard("Period", "."));
	assert.equal(blockEditor.view.state.doc.textContent, "셋째");
});

test("dot repeats the last insert at the current cursor", () => {
	const { view } = editor("one two");
	let mode: NoteVimMode = "normal";
	const vim = createNoteVimController({
		getMode: () => mode,
		getExitSequence: () => "jk",
		setMode: (next) => {
			mode = next;
		},
	});

	vim.handleKeyDown(view, keyboard("KeyI", "i"));
	view.dispatch(view.state.tr.insertText("X"));
	vim.handleKeyDown(view, keyboard("Escape", "Escape"));
	vim.handleKeyDown(view, keyboard("KeyW", "w"));
	vim.handleKeyDown(view, keyboard("Period", "."));
	assert.equal(view.state.doc.textContent, "Xone Xtwo");
	assert.equal(mode, "normal");
});

test("non-command IME document changes are rejected outside insert mode", () => {
	assert.equal(
		shouldAllowNoteVimDocumentChange({
			docChanged: true,
			enabled: true,
			mode: "normal",
			applyingCommand: false,
		}),
		false,
	);
	assert.equal(
		shouldAllowNoteVimDocumentChange({
			docChanged: true,
			enabled: true,
			mode: "visual",
			applyingCommand: false,
		}),
		false,
	);
	assert.equal(
		shouldAllowNoteVimDocumentChange({
			docChanged: true,
			enabled: true,
			mode: "normal",
			applyingCommand: true,
		}),
		true,
	);
	assert.equal(
		shouldAllowNoteVimDocumentChange({
			docChanged: true,
			enabled: true,
			mode: "insert",
			applyingCommand: false,
		}),
		true,
	);
});
