import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
	Archive,
	Columns2,
	FileText,
	Plus,
	Save,
	Search,
	Tags,
	TextCursorInput,
	View,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { loadOrbit, mutateOrbit } from "#/lib/orbit/functions";
import type { OrbitItem } from "#/lib/orbit/schema";
import { AppShell } from "@/components/app-shell";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/notes")({
	loader: () => loadOrbit(),
	component: NotesPage,
});

type EditorMode = "write" | "split" | "preview";

function formatUpdated(value: string) {
	const normalized = value.replace("T", " ").slice(0, 16);
	return normalized.replaceAll("-", ".");
}

function noteDraft(note?: OrbitItem) {
	return {
		title: note?.title ?? "",
		body: note?.body ?? "",
		tags: note?.tags.join(", ") ?? "",
	};
}

function NotesPage() {
	const snapshot = Route.useLoaderData();
	const router = useRouter();
	const notes = useMemo(
		() =>
			snapshot.items.filter(
				(item) => item.type === "note" && item.space !== "archive",
			),
		[snapshot.items],
	);
	const [selectedId, setSelectedId] = useState<string | null>(
		notes[0]?.id ?? null,
	);
	const selected = notes.find((note) => note.id === selectedId) ?? notes[0];
	const [draft, setDraft] = useState(() => noteDraft(selected));
	const [query, setQuery] = useState("");
	const [mode, setMode] = useState<EditorMode>("split");
	const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
		"idle",
	);

	useEffect(() => {
		setDraft(noteDraft(selected));
		setStatus("idle");
	}, [selected]);

	const filteredNotes = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		if (!needle) return notes;
		return notes.filter((note) =>
			[note.title, note.body, note.tags.join(" ")]
				.join("\n")
				.toLocaleLowerCase()
				.includes(needle),
		);
	}, [notes, query]);

	const dirty = Boolean(
		selected &&
			(draft.title !== selected.title ||
				draft.body !== selected.body ||
				draft.tags !== selected.tags.join(", ")),
	);

	const handleSave = useCallback(async () => {
		if (!selected || !draft.title.trim() || status === "saving") return;
		setStatus("saving");
		try {
			const tags = Array.from(
				new Set(
					draft.tags
						.split(",")
						.map((tag) => tag.trim())
						.filter(Boolean),
				),
			);
			await mutateOrbit({
				data: {
					action: "update-note",
					id: selected.id,
					input: { title: draft.title, body: draft.body, tags },
				},
			});
			await router.invalidate();
			setStatus("saved");
		} catch {
			setStatus("error");
		}
	}, [draft, router, selected, status]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLocaleLowerCase() === "s"
			) {
				event.preventDefault();
				void handleSave();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleSave]);

	function chooseNote(id: string) {
		if (id === selected?.id) return;
		if (
			dirty &&
			!window.confirm("저장하지 않은 변경을 버리고 다른 노트를 열까요?")
		) {
			return;
		}
		setSelectedId(id);
	}

	async function createNote() {
		if (
			dirty &&
			!window.confirm("저장하지 않은 변경을 버리고 새 노트를 만들까요?")
		) {
			return;
		}
		const created = await mutateOrbit({
			data: {
				action: "capture",
				input: { title: "새 노트", type: "note", body: "" },
			},
		});
		await router.invalidate();
		if (created) setSelectedId(created.id);
	}

	async function archiveNote() {
		if (!selected) return;
		await mutateOrbit({ data: { action: "archive-item", id: selected.id } });
		setSelectedId(null);
		await router.invalidate();
	}

	return (
		<AppShell>
			<main className="grid min-h-[calc(100svh-3.5rem)] grid-rows-[auto_minmax(0,1fr)] md:min-h-svh lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1">
				<aside className="flex min-h-0 flex-col border-b bg-sidebar/40 lg:border-r lg:border-b-0">
					<div className="flex h-14 items-center justify-between px-4">
						<div>
							<h1 className="text-sm font-semibold">Notes</h1>
							<p className="text-[11px] text-muted-foreground">
								{notes.length}개 파일
							</p>
						</div>
						<Button size="icon-sm" onClick={createNote} aria-label="새 노트">
							<Plus />
						</Button>
					</div>
					<div className="px-3 pb-3">
						<div className="relative">
							<Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="노트 검색"
								className="h-8 pl-8 text-xs"
							/>
						</div>
					</div>
					<Separator />
					<ScrollArea className="max-h-56 flex-1 lg:max-h-none">
						<div className="space-y-1 p-2">
							{filteredNotes.map((note) => (
								<button
									key={note.id}
									type="button"
									onClick={() => chooseNote(note.id)}
									className={`w-full rounded-md px-3 py-2.5 text-left transition-colors ${
										note.id === selected?.id
											? "bg-accent text-accent-foreground"
											: "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
									}`}
								>
									<p className="truncate text-xs font-medium">{note.title}</p>
									<p className="mt-1 truncate text-[10px] opacity-70">
										{note.body || "내용 없음"}
									</p>
									<p className="mt-2 text-[9px] opacity-60">
										{formatUpdated(note.updated)}
									</p>
								</button>
							))}
							{filteredNotes.length === 0 && (
								<div className="px-3 py-10 text-center text-xs text-muted-foreground">
									검색 결과가 없습니다.
								</div>
							)}
						</div>
					</ScrollArea>
				</aside>

				{selected ? (
					<section className="flex min-h-0 flex-col bg-background">
						<header className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-5">
							<div className="min-w-0 flex-1">
								<Input
									value={draft.title}
									onChange={(event) => {
										setDraft((current) => ({
											...current,
											title: event.target.value,
										}));
										setStatus("idle");
									}}
									placeholder="제목 없음"
									className="h-8 border-0 px-0 text-sm font-semibold shadow-none focus-visible:ring-0"
								/>
								<p className="truncate text-[10px] text-muted-foreground">
									{selected.path}
								</p>
							</div>
							<Tabs
								value={mode}
								onValueChange={(value) => setMode(value as EditorMode)}
							>
								<TabsList>
									<TabsTrigger value="write" aria-label="편집">
										<TextCursorInput />
									</TabsTrigger>
									<TabsTrigger
										value="split"
										aria-label="분할 보기"
										className="hidden sm:inline-flex"
									>
										<Columns2 />
									</TabsTrigger>
									<TabsTrigger value="preview" aria-label="미리보기">
										<View />
									</TabsTrigger>
								</TabsList>
							</Tabs>
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="ghost" size="icon" aria-label="노트 보관">
										<Archive />
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>이 노트를 보관할까요?</AlertDialogTitle>
										<AlertDialogDescription>
											파일은 삭제되지 않고 archive 폴더로 이동합니다.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>취소</AlertDialogCancel>
										<AlertDialogAction onClick={archiveNote}>
											보관
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
							<Button
								onClick={handleSave}
								disabled={!dirty || !draft.title.trim() || status === "saving"}
							>
								<Save /> {status === "saving" ? "저장 중" : "저장"}
							</Button>
						</header>

						<div className="flex items-center gap-2 border-b px-5 py-2">
							<Tags className="size-3.5 text-muted-foreground" />
							<Input
								value={draft.tags}
								onChange={(event) => {
									setDraft((current) => ({
										...current,
										tags: event.target.value,
									}));
									setStatus("idle");
								}}
								placeholder="태그를 쉼표로 구분"
								className="h-7 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
							/>
							<span className="shrink-0 text-[10px] text-muted-foreground">
								{status === "error"
									? "저장 실패"
									: dirty
										? "저장 안 됨"
										: status === "saved"
											? "저장됨"
											: formatUpdated(selected.updated)}
							</span>
						</div>

						<div
							className={`grid min-h-0 flex-1 ${mode === "split" ? "lg:grid-cols-2" : "grid-cols-1"}`}
						>
							{mode !== "preview" && (
								<div
									className={`min-h-0 ${mode === "split" ? "border-r" : ""}`}
								>
									<Textarea
										value={draft.body}
										onChange={(event) => {
											setDraft((current) => ({
												...current,
												body: event.target.value,
											}));
											setStatus("idle");
										}}
										placeholder="Markdown으로 내용을 작성하세요…"
										className="h-full min-h-[55svh] resize-none rounded-none border-0 bg-transparent p-6 font-mono text-[13px] leading-6 shadow-none focus-visible:ring-0 lg:min-h-0"
									/>
								</div>
							)}
							{mode !== "write" && (
								<ScrollArea className="min-h-[55svh] lg:min-h-0">
									<article className="markdown-body mx-auto max-w-3xl p-6 lg:p-8">
										{draft.body ? (
											<Markdown remarkPlugins={[remarkGfm]}>
												{draft.body}
											</Markdown>
										) : (
											<p className="text-sm text-muted-foreground">
												미리 볼 내용이 없습니다.
											</p>
										)}
									</article>
								</ScrollArea>
							)}
						</div>
					</section>
				) : (
					<section className="grid min-h-96 place-items-center p-8 text-center">
						<div>
							<div className="mx-auto mb-4 grid size-10 place-items-center rounded-lg bg-muted">
								<FileText className="size-4 text-muted-foreground" />
							</div>
							<h2 className="text-sm font-medium">노트가 없습니다</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								새 노트를 만들어 Markdown으로 작성해 보세요.
							</p>
							<Button className="mt-4" onClick={createNote}>
								<Plus /> 새 노트
							</Button>
						</div>
					</section>
				)}
			</main>
		</AppShell>
	);
}
