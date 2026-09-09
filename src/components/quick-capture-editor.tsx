import { baseKeymap, splitBlock } from "@milkdown/kit/prose/commands";
import { history, redo, undo } from "@milkdown/kit/prose/history";
import { keymap } from "@milkdown/kit/prose/keymap";
import { Schema, Slice } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { useEffect, useRef } from "react";

// Paragraphs stay plain text. Only their position determines title/body styling.
const schema = new Schema({
	nodes: {
		doc: { content: "paragraph+" },
		paragraph: {
			content: "text*",
			parseDOM: [{ tag: "p" }, { tag: "div" }],
			toDOM: () => ["p", 0],
		},
		text: {},
	},
});

function documentFromText(text: string) {
	return schema.node(
		"doc",
		null,
		text
			.split(/\r\n?|\n/)
			.map((line) =>
				schema.node("paragraph", null, line ? schema.text(line) : undefined),
			),
	);
}

function createState(text: string) {
	const doc = documentFromText(text);
	return EditorState.create({
		doc,
		selection: TextSelection.atEnd(doc),
		plugins: [
			history(),
			keymap({
				"Mod-z": undo,
				"Mod-Shift-z": redo,
				"Mod-y": redo,
				"Shift-Enter": splitBlock,
			}),
			keymap(baseKeymap),
		],
	});
}

export function QuickCaptureEditor({
	value,
	onChange,
	placeholder,
	autoFocus = false,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	autoFocus?: boolean;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);
	const initialValueRef = useRef(value);
	onChangeRef.current = onChange;

	useEffect(() => {
		if (!hostRef.current) return;
		const view = new EditorView(hostRef.current, {
			state: createState(initialValueRef.current),
			attributes: {
				role: "textbox",
				"aria-label": "빠른 기록",
				"aria-multiline": "true",
				class:
					"min-h-28 max-h-64 overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-2 text-base leading-7 outline-none [&>p]:m-0 [&>p:first-child]:text-lg [&>p:first-child]:font-semibold",
			},
			clipboardTextParser: (text) =>
				Slice.maxOpen(documentFromText(text).content),
			dispatchTransaction(transaction) {
				view.updateState(view.state.apply(transaction));
				if (transaction.docChanged) {
					onChangeRef.current(
						view.state.doc.textBetween(0, view.state.doc.content.size, "\n"),
					);
				}
			},
		});
		viewRef.current = view;
		return () => {
			viewRef.current = null;
			view.destroy();
		};
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const current = view.state.doc.textBetween(
			0,
			view.state.doc.content.size,
			"\n",
		);
		// Keep native selection, composition and undo history for typing updates.
		// External replacements (voice input or saving) start a fresh document.
		if (current !== value) view.updateState(createState(value));
	}, [value]);

	useEffect(() => {
		if (autoFocus) viewRef.current?.focus();
	}, [autoFocus]);

	return (
		<div className="relative">
			<div ref={hostRef} />
			{!value && (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 top-0 px-2.5 py-2 text-lg leading-7 font-semibold text-muted-foreground"
				>
					{placeholder}
				</div>
			)}
		</div>
	);
}
