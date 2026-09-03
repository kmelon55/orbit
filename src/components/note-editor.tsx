import { Crepe } from "@milkdown/crepe";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import { clearTextInCurrentBlockCommand } from "@milkdown/kit/preset/commonmark";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
	forwardRef,
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import "@milkdown/crepe/theme/common/style.css";
import {
	orbitCanvasRemark,
	orbitCanvasSchema,
	orbitCanvasView,
} from "@/components/note-canvas-node";
import { useNoteVimPreference } from "@/hooks/use-note-vim-preference";
import {
	createNoteVimController,
	createNoteVimCursorPlugin,
	type NoteVimMode,
} from "@/lib/orbit/note-vim";

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
		const { vimEnabled, exitSequence } = useNoteVimPreference();
		const [vimMode, setVimMode] = useState<NoteVimMode>("insert");
		const vimEnabledRef = useRef(vimEnabled);
		const vimModeRef = useRef<NoteVimMode>("insert");
		const vimExitSequenceRef = useRef(exitSequence);
		const vimCommandRef = useRef(false);
		const previousVimEnabledRef = useRef(false);
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
		const changeVimMode = useCallback((mode: NoteVimMode) => {
			vimModeRef.current = mode;
			setVimMode(mode);
		}, []);
		vimEnabledRef.current = vimEnabled;
		vimExitSequenceRef.current = exitSequence;
		if (noteIdRef.current !== noteId) {
			noteIdRef.current = noteId;
			bootMarkdownRef.current = markdown;
		}

		useEffect(() => {
			if (vimEnabled && !previousVimEnabledRef.current) {
				changeVimMode("normal");
			} else if (!vimEnabled) {
				changeVimMode("insert");
			}
			previousVimEnabledRef.current = vimEnabled;
		}, [vimEnabled, changeVimMode]);

		useEffect(() => {
			const root = rootRef.current;
			if (root) {
				root.dataset.vimMode = vimEnabled ? vimMode : "off";
			}
			const crepe = crepeRef.current;
			if (!crepe) return;
			crepe.editor.action((ctx) => {
				const view = ctx.get(editorViewCtx);
				view.dispatch(view.state.tr);
			});
		}, [vimEnabled, vimMode]);

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
			if (vimEnabledRef.current) changeVimMode("normal");
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
				createNoteVimCursorPlugin({
					getEnabled: () => vimEnabledRef.current,
					getMode: () => vimModeRef.current,
					isApplyingCommand: () => vimCommandRef.current,
				}),
			]);
			const vimController = createNoteVimController({
				getMode: () => vimModeRef.current,
				getExitSequence: () => vimExitSequenceRef.current,
				setMode: changeVimMode,
			});
			const handleVimKeyDown = (event: KeyboardEvent) => {
				if (!vimEnabledRef.current) return;
				const modeBeforeCommand = vimModeRef.current;
				const commandMode = modeBeforeCommand !== "insert";
				if (commandMode && !event.metaKey && !event.altKey) {
					event.preventDefault();
					event.stopImmediatePropagation();
				}
				let handled = false;
				vimCommandRef.current = true;
				try {
					crepe.editor.action((ctx) => {
						handled = vimController.handleKeyDown(
							ctx.get(editorViewCtx),
							event,
						);
					});
				} finally {
					vimCommandRef.current = false;
				}
				if (!handled || commandMode) return;
				event.preventDefault();
				event.stopImmediatePropagation();
			};
			const blockCommandModeInput = (event: Event) => {
				if (!vimEnabledRef.current || vimModeRef.current === "insert") return;
				event.preventDefault();
				event.stopImmediatePropagation();
			};
			root.addEventListener("keydown", handleVimKeyDown, true);
			root.addEventListener("beforeinput", blockCommandModeInput, true);
			root.addEventListener("compositionstart", blockCommandModeInput, true);

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
				root.removeEventListener("keydown", handleVimKeyDown, true);
				root.removeEventListener("beforeinput", blockCommandModeInput, true);
				root.removeEventListener(
					"compositionstart",
					blockCommandModeInput,
					true,
				);
				void crepe.destroy();
				root.replaceChildren();
			};
		}, [noteId, placeholder, changeVimMode]);

		return (
			<div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col">
				<div
					ref={rootRef}
					data-vim-mode={vimEnabled ? vimMode : "off"}
					className="orbit-note-editor min-h-0 w-full min-w-0 flex-1"
				/>
				{vimEnabled ? (
					<output
						className="orbit-vim-status sticky right-3 bottom-3 z-20 ml-auto"
						aria-live="polite"
					>
						<span>VIM</span>
						<span aria-hidden="true">·</span>
						<span>
							{vimMode === "normal"
								? "일반"
								: vimMode === "visual"
									? "비주얼"
									: "입력"}
						</span>
					</output>
				) : null}
			</div>
		);
	},
);

export const NoteEditor = memo(NoteEditorInner);
