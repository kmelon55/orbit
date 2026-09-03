import { splitBlock } from "@milkdown/kit/prose/commands";
import { redo, undo } from "@milkdown/kit/prose/history";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, Selection, TextSelection } from "@milkdown/kit/prose/state";
import {
	Decoration,
	DecorationSet,
	type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

export type NoteVimMode = "normal" | "insert" | "visual";

export function shouldAllowNoteVimDocumentChange(options: {
	docChanged: boolean;
	enabled: boolean;
	mode: NoteVimMode;
	applyingCommand: boolean;
}) {
	return (
		!options.docChanged ||
		!options.enabled ||
		options.mode === "insert" ||
		options.applyingCommand
	);
}

type NoteVimControllerOptions = {
	getMode: () => NoteVimMode;
	getExitSequence: () => "jk" | "none";
	setMode: (mode: NoteVimMode) => void;
};

type TextUnit = {
	from: number;
	to: number;
	text: string;
	word: boolean;
};

const isWordCharacter = (text: string) => /[\p{L}\p{N}_]/u.test(text);

function textUnits(doc: ProseNode) {
	const units: TextUnit[] = [];
	doc.descendants((node, position) => {
		if (!node.isText || !node.text) return;
		let offset = 0;
		for (const text of Array.from(node.text)) {
			units.push({
				from: position + offset,
				to: position + offset + text.length,
				text,
				word: isWordCharacter(text),
			});
			offset += text.length;
		}
	});
	return units;
}

function setCursor(
	view: EditorView,
	position: number,
	bias = 1,
	anchor?: number,
) {
	const bounded = Math.max(0, Math.min(position, view.state.doc.content.size));
	const head = TextSelection.near(view.state.doc.resolve(bounded), bias).head;
	const selection =
		anchor === undefined
			? TextSelection.create(view.state.doc, head)
			: TextSelection.create(view.state.doc, anchor, head);
	view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
}

function textblockBounds(view: EditorView) {
	const { $head } = view.state.selection;
	if (!$head.parent.isTextblock) return null;
	return {
		start: $head.start(),
		end: $head.end(),
		text: $head.parent.textContent,
		position: $head.pos,
	};
}

function moveHorizontal(view: EditorView, direction: -1 | 1, anchor?: number) {
	const bounds = textblockBounds(view);
	if (!bounds) return;
	const units = textUnits(view.state.doc).filter(
		(unit) => unit.from >= bounds.start && unit.to <= bounds.end,
	);
	const position = bounds.position;
	if (direction > 0) {
		const next = units.find((unit) => unit.from >= position);
		if (next) setCursor(view, next.to, 1, anchor);
		return;
	}
	let previous: TextUnit | undefined;
	for (let index = units.length - 1; index >= 0; index -= 1) {
		if ((units[index]?.to ?? Number.POSITIVE_INFINITY) <= position) {
			previous = units[index];
			break;
		}
	}
	if (previous) setCursor(view, previous.from, -1, anchor);
}

function moveVertical(view: EditorView, direction: -1 | 1, anchor?: number) {
	const position = view.state.selection.head;
	const coordinates = view.coordsAtPos(position);
	const lineHeight = Math.max(coordinates.bottom - coordinates.top, 18);
	const target = view.posAtCoords({
		left: coordinates.left + 1,
		top:
			direction > 0
				? coordinates.bottom + lineHeight * 0.7
				: coordinates.top - lineHeight * 0.7,
	});
	if (target && target.pos !== position) {
		setCursor(view, target.pos, direction, anchor);
		return;
	}
	const selection = Selection.findFrom(
		view.state.doc.resolve(position),
		direction,
		true,
	);
	if (selection) setCursor(view, selection.head, direction, anchor);
}

function moveWord(
	view: EditorView,
	direction: "forward" | "backward" | "end",
	anchor?: number,
) {
	const units = textUnits(view.state.doc);
	const position = view.state.selection.head;
	if (units.length === 0) return;

	if (direction === "forward") {
		let index = units.findIndex((unit) => unit.to > position);
		if (index < 0) return;
		if (
			(units[index]?.from ?? position + 1) <= position &&
			units[index]?.word
		) {
			while (index < units.length && units[index]?.word) index += 1;
		}
		while (index < units.length && !units[index]?.word) index += 1;
		const unit = units[index];
		if (unit) setCursor(view, unit.from, 1, anchor);
		return;
	}

	if (direction === "backward") {
		let index = units.length - 1;
		while (index >= 0 && (units[index]?.from ?? 0) >= position) index -= 1;
		while (index >= 0 && !units[index]?.word) index -= 1;
		while (index > 0 && units[index - 1]?.word) index -= 1;
		const unit = units[index];
		if (unit) setCursor(view, unit.from, -1, anchor);
		return;
	}

	let index = units.findIndex((unit) => unit.from >= position);
	if (index < 0) return;
	while (index < units.length && !units[index]?.word) index += 1;
	if (index >= units.length) return;
	let end = index;
	while (
		end + 1 < units.length &&
		units[end + 1]?.word &&
		units[end]?.to === units[end + 1]?.from
	) {
		end += 1;
	}
	if (units[end]?.from === position) {
		index = end + 1;
		while (index < units.length && !units[index]?.word) index += 1;
		if (index >= units.length) return;
		end = index;
		while (
			end + 1 < units.length &&
			units[end + 1]?.word &&
			units[end]?.to === units[end + 1]?.from
		) {
			end += 1;
		}
	}
	const unit = units[end];
	if (unit) setCursor(view, unit.from, 1, anchor);
}

function enterInsertMode(
	view: EditorView,
	setMode: (mode: NoteVimMode) => void,
	position: "cursor" | "after" | "start" | "first" | "end",
) {
	const bounds = textblockBounds(view);
	if (bounds) {
		let next = bounds.position;
		if (position === "after") {
			const unit = textUnits(view.state.doc).find(
				(item) => item.from >= bounds.position,
			);
			next = unit ? unit.to : bounds.end;
		} else if (position === "start") next = bounds.start;
		else if (position === "first") {
			const whitespace = bounds.text.match(/^\s*/u)?.[0].length ?? 0;
			next = bounds.start + whitespace;
		} else if (position === "end") next = bounds.end;
		setCursor(view, next);
	}
	setMode("insert");
	view.focus();
}

function openLine(
	view: EditorView,
	setMode: (mode: NoteVimMode) => void,
	direction: "above" | "below",
) {
	const bounds = textblockBounds(view);
	if (!bounds) return;
	setCursor(view, direction === "above" ? bounds.start : bounds.end);
	if (!splitBlock(view.state, view.dispatch)) return;
	if (direction === "above") {
		const previous = Selection.findFrom(view.state.selection.$from, -1, true);
		if (previous) view.dispatch(view.state.tr.setSelection(previous));
	}
	setMode("insert");
	view.focus();
}

function deleteCharacter(view: EditorView) {
	const bounds = textblockBounds(view);
	if (!bounds || bounds.position >= bounds.end) return false;
	const unit = textUnits(view.state.doc).find(
		(item) => item.from >= bounds.position,
	);
	if (!unit || unit.from >= bounds.end) return false;
	view.dispatch(view.state.tr.delete(unit.from, unit.to).scrollIntoView());
	return true;
}

function deleteBlock(view: EditorView) {
	const { $from } = view.state.selection;
	if (!$from.parent.isTextblock || $from.depth < 1) return false;
	const from = $from.before($from.depth);
	const to = $from.after($from.depth);
	const transaction = view.state.tr.deleteRange(from, to);
	const selection = TextSelection.near(
		transaction.doc.resolve(Math.min(from, transaction.doc.content.size)),
		-1,
	);
	view.dispatch(transaction.setSelection(selection).scrollIntoView());
	return true;
}

function exitInsertMode(
	view: EditorView,
	setMode: (mode: NoteVimMode) => void,
) {
	const bounds = textblockBounds(view);
	if (bounds && bounds.position > bounds.start) moveHorizontal(view, -1);
	setMode("normal");
	view.focus();
}

export function createNoteVimCursorPlugin(options: {
	getEnabled: () => boolean;
	getMode: () => NoteVimMode;
	isApplyingCommand: () => boolean;
}) {
	return $prose(
		() =>
			new Plugin({
				filterTransaction(transaction) {
					return shouldAllowNoteVimDocumentChange({
						docChanged: transaction.docChanged,
						enabled: options.getEnabled(),
						mode: options.getMode(),
						applyingCommand: options.isApplyingCommand(),
					});
				},
				props: {
					decorations(state) {
						if (!options.getEnabled() || options.getMode() !== "normal") {
							return null;
						}
						const { $head } = state.selection;
						if (!$head.parent.isTextblock) return null;
						const position = state.selection.head;
						const start = $head.start();
						const end = $head.end();
						const units = textUnits(state.doc).filter(
							(unit) => unit.from >= start && unit.to <= end,
						);
						const unit =
							units.find((item) => item.from >= position) ?? units.at(-1);
						if (unit) {
							return DecorationSet.create(state.doc, [
								Decoration.inline(unit.from, unit.to, {
									class: "orbit-vim-cursor",
								}),
							]);
						}
						return DecorationSet.create(state.doc, [
							Decoration.widget(position, () => {
								const cursor = document.createElement("span");
								cursor.className = "orbit-vim-cursor-widget";
								return cursor;
							}),
						]);
					},
				},
			}),
	);
}

type InsertCommand =
	| "cursor"
	| "after"
	| "first"
	| "end"
	| "open-above"
	| "open-below";

type RepeatableChange =
	| { kind: "delete-character" }
	| { kind: "delete-block" }
	| { kind: "delete-range"; size: number }
	| {
			kind: "insert";
			command: InsertCommand;
			fromOffset: number;
			deletedSize: number;
			inserted: ReturnType<ProseNode["slice"]>;
	  };

export function createNoteVimController(options: NoteVimControllerOptions) {
	let pendingKey: "d" | "g" | null = null;
	let pendingAt = 0;
	let visualAnchor: number | null = null;
	let lastChange: RepeatableChange | null = null;
	let activeInsertChange: {
		command: InsertCommand;
		doc: ProseNode;
		position: number;
	} | null = null;
	let insertSequenceStartedAt = 0;
	let insertSequenceSnapshot: {
		doc: ProseNode;
		anchor: number;
		head: number;
	} | null = null;

	const rememberInsertSequenceStart = (view: EditorView) => {
		insertSequenceStartedAt = Date.now();
		insertSequenceSnapshot = {
			doc: view.state.doc,
			anchor: view.state.selection.anchor,
			head: view.state.selection.head,
		};
	};

	const restoreInsertSequenceStart = (view: EditorView) => {
		const snapshot = insertSequenceSnapshot;
		if (!snapshot) return;
		const start = snapshot.doc.content.findDiffStart(view.state.doc.content);
		const end = snapshot.doc.content.findDiffEnd(view.state.doc.content);
		let transaction = view.state.tr;
		if (start !== null && end) {
			transaction = transaction.replace(
				start,
				end.b,
				snapshot.doc.slice(start, end.a),
			);
		}
		const anchor = Math.min(snapshot.anchor, transaction.doc.content.size);
		const head = Math.min(snapshot.head, transaction.doc.content.size);
		transaction = transaction.setSelection(
			TextSelection.create(transaction.doc, anchor, head),
		);
		view.dispatch(transaction.scrollIntoView());
		insertSequenceStartedAt = 0;
		insertSequenceSnapshot = null;
	};

	const beginInsertChange = (view: EditorView, command: InsertCommand) => {
		activeInsertChange = {
			command,
			doc: view.state.doc,
			position: view.state.selection.head,
		};
	};

	const finishInsertChange = (view: EditorView) => {
		const active = activeInsertChange;
		activeInsertChange = null;
		if (!active) return;
		const start = active.doc.content.findDiffStart(view.state.doc.content);
		if (start === null) return;
		const end = active.doc.content.findDiffEnd(view.state.doc.content);
		if (!end) return;
		lastChange = {
			kind: "insert",
			command: active.command,
			fromOffset: start - active.position,
			deletedSize: Math.max(0, end.a - start),
			inserted: view.state.doc.slice(start, end.b),
		};
	};

	const prepareInsertPosition = (view: EditorView, command: InsertCommand) => {
		if (command === "open-above") {
			openLine(view, () => {}, "above");
			return;
		}
		if (command === "open-below") {
			openLine(view, () => {}, "below");
			return;
		}
		enterInsertMode(view, () => {}, command);
	};

	const repeatLastChange = (view: EditorView) => {
		const change = lastChange;
		if (!change) return;
		if (change.kind === "delete-character") {
			deleteCharacter(view);
			return;
		}
		if (change.kind === "delete-block") {
			deleteBlock(view);
			return;
		}
		if (change.kind === "delete-range") {
			const from = view.state.selection.head;
			const to = Math.min(from + change.size, view.state.doc.content.size);
			if (to > from) {
				view.dispatch(view.state.tr.delete(from, to).scrollIntoView());
			}
			return;
		}

		prepareInsertPosition(view, change.command);
		const insertionPoint = view.state.selection.head;
		const from = Math.max(
			0,
			Math.min(insertionPoint + change.fromOffset, view.state.doc.content.size),
		);
		const to = Math.min(from + change.deletedSize, view.state.doc.content.size);
		let transaction = view.state.tr.replace(from, to, change.inserted);
		const cursor = Math.min(
			from + change.inserted.size,
			transaction.doc.content.size,
		);
		transaction = transaction.setSelection(
			TextSelection.near(transaction.doc.resolve(cursor), -1),
		);
		view.dispatch(transaction.scrollIntoView());
		if (change.inserted.size > 0) moveHorizontal(view, -1);
	};

	return {
		handleKeyDown(view: EditorView, event: KeyboardEvent) {
			const mode = options.getMode();
			if (mode === "insert") {
				const exitSequence = options.getExitSequence();
				const withoutModifiers =
					!event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
				const englishKey =
					!event.isComposing && !view.composing ? event.key : "";
				if (exitSequence !== "none" && withoutModifiers && englishKey) {
					if (
						englishKey === "k" &&
						Date.now() - insertSequenceStartedAt <= 500 &&
						insertSequenceSnapshot
					) {
						restoreInsertSequenceStart(view);
						finishInsertChange(view);
						exitInsertMode(view, options.setMode);
						return true;
					}
					if (englishKey === "j") rememberInsertSequenceStart(view);
					else {
						insertSequenceStartedAt = 0;
						insertSequenceSnapshot = null;
					}
				} else {
					insertSequenceStartedAt = 0;
					insertSequenceSnapshot = null;
				}
				const shouldExitInsert =
					event.key === "Escape" ||
					(event.ctrlKey && event.code === "BracketLeft");
				if (!shouldExitInsert || event.isComposing || view.composing)
					return false;
				finishInsertChange(view);
				exitInsertMode(view, options.setMode);
				return true;
			}

			if (event.metaKey || event.altKey) return false;
			const key = event.key;
			const motionAnchor = mode === "visual" ? visualAnchor : undefined;
			if (event.ctrlKey) {
				if (event.code === "KeyR") {
					redo(view.state, view.dispatch);
					return true;
				}
				if (event.code === "BracketLeft") {
					options.setMode("normal");
					return true;
				}
				return false;
			}

			if (Date.now() - pendingAt > 1_000) pendingKey = null;
			if (pendingKey === "g") {
				pendingKey = null;
				if (key === "g") {
					setCursor(
						view,
						Selection.atStart(view.state.doc).head,
						1,
						motionAnchor ?? undefined,
					);
				}
				return true;
			}
			if (pendingKey === "d") {
				pendingKey = null;
				if (key === "d" && deleteBlock(view)) {
					lastChange = { kind: "delete-block" };
				}
				return true;
			}

			switch (key) {
				case "Escape": {
					if (mode === "visual") {
						setCursor(view, view.state.selection.head);
						visualAnchor = null;
						options.setMode("normal");
					}
					return true;
				}
				case "v": {
					if (mode === "visual") {
						setCursor(view, view.state.selection.head);
						visualAnchor = null;
						options.setMode("normal");
						return true;
					}
					visualAnchor = view.state.selection.head;
					const unit = textUnits(view.state.doc).find(
						(item) => item.from >= (visualAnchor ?? 0),
					);
					setCursor(view, unit?.to ?? visualAnchor, 1, visualAnchor);
					options.setMode("visual");
					return true;
				}
				case "i":
					insertSequenceSnapshot = null;
					visualAnchor = null;
					enterInsertMode(view, options.setMode, "cursor");
					beginInsertChange(view, "cursor");
					return true;
				case "a":
					visualAnchor = null;
					enterInsertMode(view, options.setMode, "after");
					beginInsertChange(view, "after");
					return true;
				case "I":
					visualAnchor = null;
					enterInsertMode(view, options.setMode, "first");
					beginInsertChange(view, "first");
					return true;
				case "A":
					visualAnchor = null;
					enterInsertMode(view, options.setMode, "end");
					beginInsertChange(view, "end");
					return true;
				case "o":
					openLine(view, options.setMode, "below");
					beginInsertChange(view, "open-below");
					return true;
				case "O":
					openLine(view, options.setMode, "above");
					beginInsertChange(view, "open-above");
					return true;
				case "h":
				case "ArrowLeft":
					moveHorizontal(view, -1, motionAnchor ?? undefined);
					return true;
				case "j":
				case "ArrowDown":
					moveVertical(view, 1, motionAnchor ?? undefined);
					return true;
				case "k":
				case "ArrowUp":
					moveVertical(view, -1, motionAnchor ?? undefined);
					return true;
				case "l":
				case "ArrowRight":
					moveHorizontal(view, 1, motionAnchor ?? undefined);
					return true;
				case "w":
					moveWord(view, "forward", motionAnchor ?? undefined);
					return true;
				case "b":
					moveWord(view, "backward", motionAnchor ?? undefined);
					return true;
				case "e":
					moveWord(view, "end", motionAnchor ?? undefined);
					return true;
				case "0": {
					const bounds = textblockBounds(view);
					if (bounds)
						setCursor(view, bounds.start, -1, motionAnchor ?? undefined);
					return true;
				}
				case "^": {
					const bounds = textblockBounds(view);
					if (bounds) {
						const whitespace = bounds.text.match(/^\s*/u)?.[0].length ?? 0;
						setCursor(
							view,
							bounds.start + whitespace,
							-1,
							motionAnchor ?? undefined,
						);
					}
					return true;
				}
				case "$": {
					const bounds = textblockBounds(view);
					if (bounds) setCursor(view, bounds.end, 1, motionAnchor ?? undefined);
					return true;
				}
				case "x":
					if (mode === "visual" && !view.state.selection.empty) {
						const size = view.state.selection.to - view.state.selection.from;
						view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
						lastChange = { kind: "delete-range", size };
						visualAnchor = null;
						options.setMode("normal");
					} else if (deleteCharacter(view)) {
						lastChange = { kind: "delete-character" };
					}
					return true;
				case "d":
					if (mode === "visual" && !view.state.selection.empty) {
						const size = view.state.selection.to - view.state.selection.from;
						view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
						lastChange = { kind: "delete-range", size };
						visualAnchor = null;
						options.setMode("normal");
						return true;
					}
					pendingKey = "d";
					pendingAt = Date.now();
					return true;
				case "g":
					pendingKey = "g";
					pendingAt = Date.now();
					return true;
				case "G":
					setCursor(
						view,
						Selection.atEnd(view.state.doc).head,
						-1,
						motionAnchor ?? undefined,
					);
					return true;
				case "u":
					undo(view.state, view.dispatch);
					return true;
				case ".":
					if (mode === "normal") repeatLastChange(view);
					return true;
				default:
					return true;
			}
		},
	};
}
