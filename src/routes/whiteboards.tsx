import type {
	AppState,
	BinaryFiles,
	ExcalidrawInitialDataState,
	ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import { createFileRoute } from "@tanstack/react-router";
import {
	FilePenLine,
	LoaderCircle,
	PanelLeft,
	Plus,
	Save,
	Shapes,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadOrbitCanvas, mutateOrbit } from "#/lib/orbit/functions";
import { formatDateTime } from "#/lib/orbit/para";
import type { OrbitCanvas } from "#/lib/orbit/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useOrbitSnapshot } from "./__root";
import "@excalidraw/excalidraw/index.css";

export const Route = createFileRoute("/whiteboards")({
	component: WhiteboardsPage,
});

type ExcalidrawComponent = typeof import("@excalidraw/excalidraw").Excalidraw;
type SerializeAsJSON = typeof import("@excalidraw/excalidraw").serializeAsJSON;
type CanvasChange = NonNullable<ExcalidrawProps["onChange"]>;

function WhiteboardsPage() {
	const snapshot = useOrbitSnapshot();
	const [selectedPath, setSelectedPath] = useState<string | null>(
		snapshot.canvases[0]?.path ?? null,
	);
	const [canvasData, setCanvasData] = useState<Awaited<
		ReturnType<typeof loadOrbitCanvas>
	> | null>(null);
	const [Editor, setEditor] = useState<ExcalidrawComponent | null>(null);
	const [serializeAsJSON, setSerializeAsJSON] =
		useState<SerializeAsJSON | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("파일에 자동 저장됩니다");
	const saveTimer = useRef<number | undefined>(undefined);

	useEffect(() => {
		let active = true;
		void import("@excalidraw/excalidraw").then((module) => {
			if (active) {
				setEditor(() => module.Excalidraw);
				setSerializeAsJSON(() => module.serializeAsJSON);
			}
		});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		if (!selectedPath) {
			setCanvasData(null);
			return;
		}
		let active = true;
		setLoading(true);
		void loadOrbitCanvas({ data: { path: selectedPath } })
			.then((data) => {
				if (active) {
					setCanvasData(data);
					setMessage("파일에 자동 저장됩니다");
				}
			})
			.catch(() => {
				if (active) setMessage("화이트보드를 불러오지 못했습니다");
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [selectedPath]);

	useEffect(() => {
		return () => window.clearTimeout(saveTimer.current);
	}, []);

	async function createCanvas() {
		const title = window.prompt("화이트보드 이름", "새 화이트보드")?.trim();
		if (!title) return;
		const result = await mutateOrbit({
			data: { action: "create-canvas", title },
		});
		if (!result || !("canvas" in result)) return;
		setSelectedPath(result.canvas.path);
		window.location.hash = result.canvas.path;
	}

	function scheduleSave(
		canvas: OrbitCanvas,
		elements: Parameters<CanvasChange>[0],
		appState: Parameters<CanvasChange>[1] & AppState,
		files: Parameters<CanvasChange>[2] & BinaryFiles,
	) {
		if (!serializeAsJSON) return;
		setSaving(true);
		setMessage("저장 준비 중…");
		window.clearTimeout(saveTimer.current);
		const document = serializeAsJSON(elements, appState, files, "database");
		saveTimer.current = window.setTimeout(() => {
			void mutateOrbit({
				data: { action: "save-canvas", path: canvas.path, document },
			})
				.then(() => {
					setSaving(false);
					setMessage(
						`저장됨 · ${new Intl.DateTimeFormat("ko-KR", {
							hour: "2-digit",
							minute: "2-digit",
						}).format(new Date())}`,
					);
				})
				.catch(() => {
					setSaving(false);
					setMessage("저장하지 못했습니다");
				});
		}, 700);
	}

	const selected = snapshot.canvases.find(
		(canvas) => canvas.path === selectedPath,
	);

	return (
		<div className="flex h-full min-h-0 flex-col bg-muted/20">
			<header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-background/85 px-5 py-4 backdrop-blur-xl">
				<div>
					<p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
						EXCALIDRAW
					</p>
					<h2 className="mt-1 text-xl font-semibold tracking-tight">
						Whiteboards
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						`.excalidraw` 파일을 그대로 보존하고 Orbit 안에서 편집합니다.
					</p>
				</div>
				<Button onClick={() => void createCanvas()}>
					<Plus /> 새 화이트보드
				</Button>
			</header>

			<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
				<aside className="w-full shrink-0 border-b border-border/60 bg-background/55 lg:w-72 lg:border-r lg:border-b-0">
					<div className="flex items-center justify-between px-4 py-3">
						<div className="flex items-center gap-2 text-sm font-medium">
							<PanelLeft className="size-4 text-muted-foreground" />
							{snapshot.canvases.length}개 보드
						</div>
					</div>
					<ScrollArea className="max-h-52 lg:h-[calc(100vh-11rem)] lg:max-h-none">
						<div className="space-y-1 p-2">
							{snapshot.canvases.map((canvas) => (
								<button
									key={canvas.path}
									type="button"
									onClick={() => setSelectedPath(canvas.path)}
									className={cn(
										"w-full rounded-xl px-3 py-3 text-left transition-colors",
										canvas.path === selectedPath
											? "bg-sidebar-accent text-sidebar-accent-foreground"
											: "hover:bg-muted/70",
									)}
								>
									<div className="flex items-start gap-2">
										<Shapes className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium">
												{canvas.title}
											</span>
											<span className="mt-1 block truncate text-xs text-muted-foreground">
												수정 {formatDateTime(canvas.updated)}
											</span>
										</span>
									</div>
								</button>
							))}
							{snapshot.canvases.length === 0 ? (
								<div className="px-3 py-8 text-sm leading-6 text-muted-foreground">
									아직 화이트보드가 없습니다. 새로 만들거나 Obsidian의
									`.excalidraw` 파일을 가져오면 여기에 나타납니다.
								</div>
							) : null}
						</div>
					</ScrollArea>
				</aside>

				<section className="flex min-h-0 min-w-0 flex-1 flex-col p-3 lg:p-4">
					{selected && canvasData ? (
						<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-white shadow-sm">
							<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5 text-sm">
								<div className="flex min-w-0 items-center gap-2">
									<FilePenLine className="size-4 shrink-0 text-muted-foreground" />
									<span className="truncate font-medium">{selected.title}</span>
									<Badge variant="outline">{selected.format}</Badge>
								</div>
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<span>{message}</span>
									{saving ? (
										<LoaderCircle className="size-3.5 animate-spin" />
									) : (
										<Save className="size-3.5" />
									)}
								</div>
							</div>
							<div className="min-h-0 flex-1">
								{Editor ? (
									<Editor
										initialData={
											JSON.parse(
												canvasData.document,
											) as ExcalidrawInitialDataState
										}
										onChange={(elements, appState, files) =>
											scheduleSave(selected, elements, appState, files)
										}
									/>
								) : (
									<div className="grid h-full place-items-center text-sm text-muted-foreground">
										화이트보드 편집기를 불러오는 중…
									</div>
								)}
							</div>
						</div>
					) : (
						<div className="grid min-h-80 flex-1 place-items-center rounded-2xl border border-dashed border-border bg-background/55 p-8 text-center">
							<div>
								<div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-muted">
									<Shapes className="size-5 text-muted-foreground" />
								</div>
								<h3 className="text-sm font-medium">
									{loading
										? "화이트보드 불러오는 중…"
										: "화이트보드를 선택하세요"}
								</h3>
								<p className="mt-1.5 text-sm text-muted-foreground">
									작성일과 마지막 수정일도 파일 기준으로 함께 표시됩니다.
								</p>
							</div>
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
