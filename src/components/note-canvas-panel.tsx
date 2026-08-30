import type {
	AppState,
	BinaryFiles,
	ExcalidrawInitialDataState,
	ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import {
	FilePenLine,
	LoaderCircle,
	Maximize2,
	Minimize2,
	PencilLine,
	Save,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadOrbitCanvas, mutateOrbit } from "#/lib/orbit/functions";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import "@excalidraw/excalidraw/index.css";

type ExcalidrawComponent = typeof import("@excalidraw/excalidraw").Excalidraw;
type SerializeAsJSON = typeof import("@excalidraw/excalidraw").serializeAsJSON;
type CanvasChange = NonNullable<ExcalidrawProps["onChange"]>;

export function NoteCanvasPanel({
	canvas,
	onClose,
	onRename,
	onTitleChange,
}: {
	canvas: { path: string; title: string };
	onClose: () => void;
	onRename: (canvas: { path: string; title: string }) => void;
	onTitleChange: (title: string) => void;
}) {
	const { resolvedTheme } = useTheme();
	const [canvasData, setCanvasData] = useState<Awaited<
		ReturnType<typeof loadOrbitCanvas>
	> | null>(null);
	const [Editor, setEditor] = useState<ExcalidrawComponent | null>(null);
	const [serializeAsJSON, setSerializeAsJSON] =
		useState<SerializeAsJSON | null>(null);
	const [saving, setSaving] = useState(false);
	const [fullscreen, setFullscreen] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState(canvas.title);
	const [message, setMessage] = useState("파일에 자동 저장됩니다");
	const saveTimer = useRef<number | undefined>(undefined);
	const titleSaveTimer = useRef<number | undefined>(undefined);
	const lastDocumentRef = useRef<string | null>(null);
	const pendingDocumentRef = useRef<string | null>(null);
	const activeCanvasSaveRef = useRef<Promise<unknown> | null>(null);
	const titleDraftRef = useRef(canvas.title);
	const lastPersistedTitleRef = useRef(canvas.title);
	const pendingTitleSaveRef = useRef<string | null>(null);
	const titleSaveRunningRef = useRef(false);

	useEffect(() => {
		if (import.meta.env.SSR) return;
		let active = true;
		void import("@excalidraw/excalidraw").then((module) => {
			if (!active) return;
			setEditor(() => module.Excalidraw);
			setSerializeAsJSON(() => module.serializeAsJSON);
		});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		let active = true;
		setCanvasData(null);
		setMessage("화이트보드를 불러오는 중…");
		void loadOrbitCanvas({ data: { path: canvas.path } })
			.then((data) => {
				if (!active) return;
				setCanvasData(data);
				lastDocumentRef.current = JSON.stringify(JSON.parse(data.document));
				setMessage("파일에 자동 저장됩니다");
			})
			.catch(() => {
				if (active) setMessage("화이트보드를 불러오지 못했습니다");
			});
		return () => {
			active = false;
		};
	}, [canvas.path]);

	useEffect(() => {
		return () => {
			window.clearTimeout(saveTimer.current);
			window.clearTimeout(titleSaveTimer.current);
			const pending = pendingDocumentRef.current;
			if (!pending) return;
			pendingDocumentRef.current = null;
			void mutateOrbit({
				data: { action: "save-canvas", path: canvas.path, document: pending },
			});
		};
	}, [canvas.path]);

	function scheduleSave(
		elements: Parameters<CanvasChange>[0],
		appState: Parameters<CanvasChange>[1] & AppState,
		files: Parameters<CanvasChange>[2] & BinaryFiles,
	) {
		if (!serializeAsJSON) return;
		const document = serializeAsJSON(elements, appState, files, "database");
		const comparable = JSON.stringify(JSON.parse(document));
		if (lastDocumentRef.current === comparable) return;
		lastDocumentRef.current = comparable;
		pendingDocumentRef.current = document;
		setMessage("변경됨");
		window.clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(() => {
			if (pendingDocumentRef.current !== document) return;
			pendingDocumentRef.current = null;
			setSaving(true);
			setMessage("저장 중…");
			const request = mutateOrbit({
				data: { action: "save-canvas", path: canvas.path, document },
			});
			activeCanvasSaveRef.current = request;
			void request
				.then(() => {
					setSaving(false);
					setMessage("저장됨");
				})
				.catch(() => {
					setSaving(false);
					setMessage("저장하지 못했습니다");
				})
				.finally(() => {
					if (activeCanvasSaveRef.current === request)
						activeCanvasSaveRef.current = null;
				});
		}, 700);
	}

	async function flushTitleSave() {
		if (titleSaveRunningRef.current) return;
		titleSaveRunningRef.current = true;
		try {
			while (pendingTitleSaveRef.current) {
				const title = pendingTitleSaveRef.current;
				pendingTitleSaveRef.current = null;
				if (title === lastPersistedTitleRef.current) continue;
				await activeCanvasSaveRef.current?.catch(() => {});
				window.clearTimeout(saveTimer.current);
				const pendingDocument = pendingDocumentRef.current;
				if (pendingDocument) {
					pendingDocumentRef.current = null;
					await mutateOrbit({
						data: {
							action: "save-canvas",
							path: canvas.path,
							document: pendingDocument,
						},
					});
				}
				setSaving(true);
				setMessage("저장 중…");
				const result = await mutateOrbit({
					data: { action: "rename-canvas", path: canvas.path, title },
				});
				if (!result || !("canvas" in result))
					throw new Error("Canvas rename failed");
				lastPersistedTitleRef.current = title;
				if (
					titleDraftRef.current.trim() === title &&
					pendingTitleSaveRef.current === null
				)
					onRename(result.canvas);
				setMessage("저장됨");
			}
		} catch {
			setMessage("이름을 바꾸지 못했습니다");
		} finally {
			setSaving(false);
			titleSaveRunningRef.current = false;
			if (pendingTitleSaveRef.current) void flushTitleSave();
		}
	}

	function scheduleTitleSave(value: string) {
		setTitleDraft(value);
		titleDraftRef.current = value;
		window.clearTimeout(titleSaveTimer.current);
		const title = value.trim();
		if (!title) return;
		onTitleChange(title);
		setMessage("변경됨");
		titleSaveTimer.current = window.setTimeout(() => {
			pendingTitleSaveRef.current = title;
			void flushTitleSave();
		}, 700);
	}

	function finishTitleEditing() {
		window.clearTimeout(titleSaveTimer.current);
		const title = titleDraftRef.current.trim();
		if (!title) {
			const persisted = lastPersistedTitleRef.current;
			setTitleDraft(persisted);
			titleDraftRef.current = persisted;
			onTitleChange(persisted);
		} else if (title !== lastPersistedTitleRef.current) {
			pendingTitleSaveRef.current = title;
			void flushTitleSave();
		}
		setEditingTitle(false);
	}

	return (
		<div className="mb-6 min-w-0 max-w-full">
			<section
				className={cn(
					"min-w-0 max-w-full overflow-hidden rounded-2xl border border-border/80 bg-background shadow-sm",
					fullscreen &&
						"fixed inset-2 z-[80] flex flex-col rounded-xl shadow-2xl md:inset-4",
				)}
			>
				<header className="flex min-h-11 items-center justify-between gap-3 border-b border-border bg-muted px-3 py-1.5 text-foreground">
					<div className="flex min-w-0 items-center gap-2">
						<FilePenLine className="size-4 shrink-0 text-muted-foreground" />
						{editingTitle ? (
							<Input
								autoFocus
								className="h-7 w-52 max-w-[42vw] cursor-text bg-background px-2 text-sm font-semibold caret-foreground"
								value={titleDraft}
								onChange={(event) => scheduleTitleSave(event.target.value)}
								onBlur={finishTitleEditing}
								onKeyDown={(event) => {
									if (event.key === "Enter") event.currentTarget.blur();
								}}
								aria-label="화이트보드 이름"
							/>
						) : (
							<button
								type="button"
								className="group/title flex min-w-0 cursor-text items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-foreground/5"
								onClick={() => {
									setTitleDraft(canvas.title);
									titleDraftRef.current = canvas.title;
									lastPersistedTitleRef.current = canvas.title;
									setEditingTitle(true);
								}}
								aria-label={`${canvas.title} 이름 수정`}
							>
								<span className="truncate text-sm font-semibold">
									{canvas.title}
								</span>
								<PencilLine className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
							</button>
						)}
					</div>
					<div className="flex min-w-0 shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:gap-2">
						<span className="hidden sm:inline">{message}</span>
						{saving ? (
							<LoaderCircle className="size-3.5 animate-spin" />
						) : (
							<Save className="size-3.5" />
						)}
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setFullscreen((value) => !value)}
							aria-label={fullscreen ? "원래 크기로" : "전체 화면"}
						>
							{fullscreen ? <Minimize2 /> : <Maximize2 />}
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onClose}
							aria-label="화이트보드 접기"
						>
							<X />
						</Button>
					</div>
				</header>
				<div
					className={cn(
						"h-[min(62svh,680px)] min-h-[440px]",
						fullscreen && "min-h-0 flex-1",
					)}
				>
					{Editor && canvasData ? (
						<Editor
							key={canvas.path}
							initialData={
								JSON.parse(canvasData.document) as ExcalidrawInitialDataState
							}
							theme={resolvedTheme}
							onChange={scheduleSave}
						/>
					) : (
						<div className="grid h-full place-items-center text-sm text-muted-foreground">
							{message}
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
