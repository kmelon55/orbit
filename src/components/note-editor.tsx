import { Crepe } from "@milkdown/crepe";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import { clearTextInCurrentBlockCommand } from "@milkdown/kit/preset/commonmark";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
	forwardRef,
	memo,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";
import "@milkdown/crepe/theme/common/style.css";
import {
	orbitCanvasRemark,
	orbitCanvasSchema,
	orbitCanvasView,
} from "@/components/note-canvas-node";

export type NoteEditorHandle = {
	insertLink: (label: string, href: string) => string | null;
	insertCanvas: (title: string, path: string) => string | null;
	openInsertMenu: () => boolean;
};

export type NoteEditorAnchor = {
	left: number;
	top: number;
};

type NoteEditorProps = {
	noteId: string;
	markdown: string;
	placeholder?: string;
	onChange: (markdown: string) => void;
	onOpenNote?: (id: string) => void;
	onOpenCanvas?: (path: string) => void;
	onRequestNoteLink?: (anchor: NoteEditorAnchor) => void;
	onRequestCanvas?: () => void;
	onReadyChange?: (ready: boolean) => void;
};

const noteLinkIcon =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></svg>';
const canvasIcon =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="m8 16 3-4 2 2 3-5"/></svg>';

const NoteEditorInner = forwardRef<NoteEditorHandle, NoteEditorProps>(
	function NoteEditor(
		{
			noteId,
			markdown,
			placeholder = "글을 입력하거나 / 를 누르세요",
			onChange,
			onOpenNote,
			onOpenCanvas,
			onRequestNoteLink,
			onRequestCanvas,
			onReadyChange,
		},
		ref,
	) {
		const rootRef = useRef<HTMLDivElement>(null);
		const crepeRef = useRef<Crepe | null>(null);
		const userInteractedRef = useRef(false);
		const onChangeRef = useRef(onChange);
		const onOpenNoteRef = useRef(onOpenNote);
		const onOpenCanvasRef = useRef(onOpenCanvas);
		const onRequestNoteLinkRef = useRef(onRequestNoteLink);
		const onRequestCanvasRef = useRef(onRequestCanvas);
		const onReadyChangeRef = useRef(onReadyChange);
		const bootMarkdownRef = useRef(markdown);
		const noteIdRef = useRef(noteId);
		onChangeRef.current = onChange;
		onOpenNoteRef.current = onOpenNote;
		onOpenCanvasRef.current = onOpenCanvas;
		onRequestNoteLinkRef.current = onRequestNoteLink;
		onRequestCanvasRef.current = onRequestCanvas;
		onReadyChangeRef.current = onReadyChange;
		if (noteIdRef.current !== noteId) {
			noteIdRef.current = noteId;
			bootMarkdownRef.current = markdown;
		}

		useImperativeHandle(ref, () => ({
			insertLink(label, href) {
				const crepe = crepeRef.current;
				if (!crepe || !label.trim()) return null;
				let nextMarkdown: string | null = null;
				userInteractedRef.current = true;
				crepe.editor.action((ctx) => {
					const view = ctx.get(editorViewCtx);
					const link = view.state.schema.marks.link;
					if (!link) return;
					const linkedText = view.state.schema.text(label, [
						link.create({ href, title: null }),
					]);
					view.dispatch(
						view.state.tr
							.replaceSelectionWith(linkedText, false)
							.scrollIntoView(),
					);
					nextMarkdown = crepe.getMarkdown();
					onChangeRef.current(nextMarkdown);
					view.focus();
				});
				return nextMarkdown;
			},
			insertCanvas(title, path) {
				const crepe = crepeRef.current;
				if (!crepe || !path) return null;
				let nextMarkdown: string | null = null;
				userInteractedRef.current = true;
				crepe.editor.action((ctx) => {
					const view = ctx.get(editorViewCtx);
					const canvasType = view.state.schema.nodes.orbitCanvas;
					if (!canvasType) return;
					const canvasNode = canvasType.create({ path, title });
					const { $from } = view.state.selection;
					const parent = $from.parent;
					let transaction = view.state.tr;
					let position: number;
					if (parent.type.name === "paragraph" && parent.content.size === 0) {
						position = $from.before($from.depth);
						transaction = transaction.replaceWith(
							position,
							position + parent.nodeSize,
							canvasNode,
						);
					} else {
						position = $from.after(1);
						transaction = transaction.insert(position, canvasNode);
					}
					view.dispatch(transaction.scrollIntoView());
					nextMarkdown = crepe.getMarkdown();
					onChangeRef.current(nextMarkdown);
					view.focus();
				});
				return nextMarkdown;
			},
			openInsertMenu() {
				const crepe = crepeRef.current;
				if (!crepe) return false;
				userInteractedRef.current = true;
				crepe.editor.action((ctx) => {
					const view = ctx.get(editorViewCtx);
					const paragraph = view.state.schema.nodes.paragraph;
					if (!paragraph) return;
					let transaction = view.state.tr.insert(
						view.state.doc.content.size,
						paragraph.create(),
					);
					const position = transaction.doc.content.size - 1;
					transaction = transaction
						.setSelection(TextSelection.near(transaction.doc.resolve(position)))
						.insertText("/")
						.scrollIntoView();
					view.dispatch(transaction);
					view.focus();
				});
				return true;
			},
		}));

		useEffect(() => {
			const root = rootRef.current;
			if (!root) return;
			const openedNoteId = noteId;
			void openedNoteId;
			root.replaceChildren();
			userInteractedRef.current = false;
			onReadyChangeRef.current?.(false);
			const initial = bootMarkdownRef.current;
			const markUserInteraction = () => {
				userInteractedRef.current = true;
			};
			const interactionEvents = [
				"beforeinput",
				"compositionstart",
				"cut",
				"drop",
				"keydown",
				"paste",
				"pointerdown",
			] as const;
			for (const eventName of interactionEvents) {
				root.addEventListener(eventName, markUserInteraction, true);
			}
			const openInternalLink = (event: MouseEvent) => {
				const target = event.target;
				if (!(target instanceof Element)) return;
				const anchor = target.closest<HTMLAnchorElement>("a[href]");
				const href = anchor?.getAttribute("href");
				if (!href) return;
				if (href.startsWith("#/note/")) {
					event.preventDefault();
					onOpenNoteRef.current?.(decodeURIComponent(href.slice(7)));
				} else if (href.startsWith("#/canvas/")) {
					event.preventDefault();
					onOpenCanvasRef.current?.(decodeURIComponent(href.slice(9)));
				}
			};
			root.addEventListener("click", openInternalLink);

			const crepe = new Crepe({
				root,
				defaultValue: initial,
				features: {
					[Crepe.Feature.Latex]: false,
					[Crepe.Feature.AI]: false,
				},
				featureConfigs: {
					[Crepe.Feature.BlockEdit]: {
						blockHandle: {
							getOffset: () => 8,
						},
						buildMenu: (builder) => {
							const orbit = builder.addGroup("orbit", "Orbit");
							orbit.addItem("note-link", {
								label: "Note link · notelink · 노트 링크 · 노트링크",
								icon: noteLinkIcon,
								onRun: (ctx) => {
									userInteractedRef.current = true;
									const view = ctx.get(editorViewCtx);
									const position = view.coordsAtPos(view.state.selection.from);
									ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
									onRequestNoteLinkRef.current?.({
										left: position.left,
										top: position.bottom + 8,
									});
								},
							});
							orbit.addItem("whiteboard", {
								label: "Whiteboard · 화이트보드",
								icon: canvasIcon,
								onRun: (ctx) => {
									userInteractedRef.current = true;
									ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
									onRequestCanvasRef.current?.();
								},
							});
						},
					},
					[Crepe.Feature.Placeholder]: {
						text: placeholder,
						mode: "doc",
					},
				},
			});
			crepe.editor.use([
				...orbitCanvasRemark,
				...orbitCanvasSchema,
				orbitCanvasView,
			]);

			crepe.on((listener) => {
				listener.markdownUpdated((_ctx, next) => {
					if (!userInteractedRef.current) return;
					onChangeRef.current(next);
				});
			});

			let disposed = false;
			void crepe.create().then(() => {
				if (disposed) {
					void crepe.destroy();
					return;
				}
				crepeRef.current = crepe;
				onReadyChangeRef.current?.(true);
			});

			return () => {
				disposed = true;
				crepeRef.current = null;
				onReadyChangeRef.current?.(false);
				for (const eventName of interactionEvents) {
					root.removeEventListener(eventName, markUserInteraction, true);
				}
				root.removeEventListener("click", openInternalLink);
				void crepe.destroy();
				root.replaceChildren();
			};
		}, [noteId, placeholder]);

		return (
			<div
				ref={rootRef}
				className="orbit-note-editor min-h-0 w-full min-w-0 flex-1"
			/>
		);
	},
);

export const NoteEditor = memo(NoteEditorInner);
