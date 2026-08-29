import { Crepe } from "@milkdown/crepe";
import { memo, useEffect, useRef } from "react";
import "@milkdown/crepe/theme/common/style.css";

export const NoteEditor = memo(
	function NoteEditor({
		noteId,
		markdown,
		placeholder = "글을 입력하거나 / 를 누르세요",
		onChange,
	}: {
		noteId: string;
		markdown: string;
		placeholder?: string;
		onChange: (markdown: string) => void;
	}) {
		const rootRef = useRef<HTMLDivElement>(null);
		const onChangeRef = useRef(onChange);
		const bootMarkdownRef = useRef(markdown);
		const noteIdRef = useRef(noteId);
		onChangeRef.current = onChange;
		if (noteIdRef.current !== noteId) {
			noteIdRef.current = noteId;
			bootMarkdownRef.current = markdown;
		}

		useEffect(() => {
			const root = rootRef.current;
			if (!root) return;
			const openedNoteId = noteId;
			root.replaceChildren();
			const initial = bootMarkdownRef.current;
			void openedNoteId;
			let userInteracted = false;
			const markUserInteraction = () => {
				userInteracted = true;
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

			const crepe = new Crepe({
				root,
				defaultValue: initial,
				features: {
					[Crepe.Feature.Latex]: false,
					[Crepe.Feature.AI]: false,
				},
				featureConfigs: {
					[Crepe.Feature.Placeholder]: {
						text: placeholder,
						mode: "doc",
					},
				},
			});

			crepe.on((listener) => {
				listener.markdownUpdated((_ctx, next) => {
					if (!userInteracted) return;
					onChangeRef.current(next);
				});
			});

			let disposed = false;
			void crepe.create().then(() => {
				if (disposed) void crepe.destroy();
			});

			return () => {
				disposed = true;
				for (const eventName of interactionEvents) {
					root.removeEventListener(eventName, markUserInteraction, true);
				}
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
	(prev, next) => prev.noteId === next.noteId,
);
