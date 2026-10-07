import { useNavigate } from "@tanstack/react-router";
import {
	CalendarDays,
	FileText,
	Link2,
	ListTodo,
	Mail,
	Search,
	Sparkles,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { folderLabels, folderSchema } from "#/lib/mail/types";
import type { AiSource } from "#/lib/orbit/ai-types";
import { createSearchIndex, searchItems } from "#/lib/orbit/global-search";
import { folderOf, ITEM_TYPE_LABEL, SPACE_LABEL } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot } from "#/lib/orbit/schema";
import { searchCachedMail } from "#/lib/orbit/search-functions";
import { useI18n } from "@/components/locale-provider";
import { PaletteAi } from "@/components/palette-ai";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const icons = {
	note: FileText,
	task: ListTodo,
	event: CalendarDays,
	link: Link2,
};
type MailHit = Awaited<ReturnType<typeof searchCachedMail>>[number];

export function GlobalSearch({ snapshot }: { snapshot: OrbitSnapshot }) {
	const { t } = useI18n();

	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<"search" | "ai">("search");
	const [query, setQuery] = useState("");
	const [directAsk, setDirectAsk] = useState<{
		id: string;
		question: string;
	} | null>(null);
	const [active, setActive] = useState(0);
	const [mail, setMail] = useState<{ query: string; results: MailHit[] }>({
		query: "",
		results: [],
	});
	const [mailLoading, setMailLoading] = useState(false);
	const [mailError, setMailError] = useState(false);
	const [isComposing, setIsComposing] = useState(false);
	const requestVersion = useRef(0);
	const deferredQuery = useDeferredValue(query);
	const inputRef = useRef<HTMLInputElement>(null);
	const aiInputRef = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();
	const index = useMemo(
		() => createSearchIndex(snapshot.items),
		[snapshot.items],
	);
	const results = useMemo(
		() => searchItems(index, deferredQuery, 20),
		[index, deferredQuery],
	);
	const trimmed = query.trim();
	const mailResults = mail.query === trimmed ? mail.results : [];
	const total = results.length + mailResults.length;

	useEffect(() => {
		const shortcut = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setOpen((value) => !value);
			}
		};
		window.addEventListener("keydown", shortcut);
		return () => window.removeEventListener("keydown", shortcut);
	}, []);

	useEffect(() => {
		const version = ++requestVersion.current;
		if (!open || mode !== "search" || !trimmed) {
			setMail({ query: "", results: [] });
			setMailLoading(false);
			setMailError(false);
			return;
		}
		if (isComposing) return;
		setMailLoading(true);
		setMailError(false);
		const timer = window.setTimeout(() => {
			void searchCachedMail({ data: { query: trimmed.slice(0, 200) } })
				.then((next) => {
					if (requestVersion.current === version)
						setMail({ query: trimmed, results: next });
				})
				.catch(() => {
					if (requestVersion.current === version) setMailError(true);
				})
				.finally(() => {
					if (requestVersion.current === version) setMailLoading(false);
				});
		}, 140);
		return () => {
			window.clearTimeout(timer);
			requestVersion.current++;
		};
	}, [open, mode, trimmed, isComposing]);

	useEffect(() => {
		if (open) (mode === "search" ? inputRef : aiInputRef).current?.focus();
	}, [open, mode]);

	function close() {
		flushSync(() => {
			setOpen(false);
			setQuery("");
			setActive(0);
			setMode("search");
		});
	}

	async function openItem(item: OrbitItem) {
		close();
		const folder = folderOf(item);
		if (
			item.space === "project" ||
			item.space === "area" ||
			item.space === "resource"
		) {
			const base = {
				project: "/projects",
				area: "/areas",
				resource: "/resources",
			} as const;
			if (folder) {
				await navigate({
					to: `${base[item.space]}/$folder`,
					params: { folder },
					search: { note: item.id },
				});
				return;
			}
			await navigate({ to: base[item.space], search: { note: item.id } });
			return;
		}
		if (item.space === "archive") {
			await navigate({ to: "/archive", search: { note: item.id } });
			return;
		}
		if (
			item.type === "event" ||
			item.space === "event" ||
			item.type === "task"
		) {
			await navigate({ to: "/search", search: { note: item.id } });
			return;
		}
		await navigate({ to: "/inbox", search: { note: item.id } });
	}

	function openMail(message: MailHit) {
		close();
		void navigate({
			to: "/mail",
			search: { folder: message.folder, message: message.id },
		});
	}

	function searchMoreMail() {
		const q = trimmed;
		close();
		void navigate({ to: "/mail", search: { q } });
	}

	function openSource(source: AiSource) {
		if (source.kind === "item") {
			const item = snapshot.items.find(
				(candidate) => candidate.id === source.id,
			);
			if (item) void openItem(item);
			return;
		}
		const folder = folderSchema.safeParse(source.folder);
		close();
		void navigate({
			to: "/mail",
			search: {
				folder: folder.success ? folder.data : "inbox",
				message: source.id,
			},
		});
	}

	function choose(index: number) {
		if (index < results.length) {
			const hit = results[index];
			if (hit) void openItem(hit.entry.item);
		} else {
			const hit = mailResults[index - results.length];
			if (hit) openMail(hit);
		}
	}

	function startAiConversation() {
		if (trimmed.length < 2) return;
		setDirectAsk({ id: crypto.randomUUID(), question: trimmed });
		setMode("ai");
	}

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label={t("검색과 AI 열기")}
			>
				<Search className="size-4" />
				<span className="hidden sm:inline">{t("검색 · AI")}</span>
				<kbd className="hidden rounded border px-1 text-[10px] md:inline">
					⌘ K
				</kbd>
			</button>
			{open ? (
				<Dialog
					open={open}
					onOpenChange={(value) => {
						setOpen(value);
						if (!value) {
							setQuery("");
							setActive(0);
							setMode("search");
						}
					}}
				>
					<DialogContent
						className="top-4 h-[min(80svh,680px)] max-h-[calc(100svh-2rem)] max-w-2xl -translate-y-0 flex flex-col gap-0 overflow-hidden p-0 sm:top-[10vh]"
						onOpenAutoFocus={(event) => {
							event.preventDefault();
							(mode === "search" ? inputRef : aiInputRef).current?.focus();
						}}
					>
						<DialogTitle className="sr-only">{t("검색과 AI")}</DialogTitle>
						<div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
							<button
								type="button"
								onClick={() => setMode("search")}
								aria-pressed={mode === "search"}
								className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted aria-pressed:bg-muted aria-pressed:text-foreground"
							>
								<Search className="size-3.5" />
								{t("검색")}
							</button>
							<button
								type="button"
								onClick={() => setMode("ai")}
								aria-pressed={mode === "ai"}
								className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted aria-pressed:bg-muted aria-pressed:text-foreground"
							>
								<Sparkles className="size-3.5" />
								AI
							</button>
							<span className="ml-auto text-xs text-muted-foreground">⌘ K</span>
						</div>
						{mode === "search" ? (
							<>
								<div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
									<Search className="size-4 shrink-0 text-muted-foreground" />
									<Input
										ref={inputRef}
										value={query}
										onChange={(event) => {
											setQuery(event.target.value);
											setActive(0);
										}}
										onCompositionStart={() => setIsComposing(true)}
										onCompositionEnd={(event) => {
											setIsComposing(false);
											setQuery(event.currentTarget.value);
										}}
										onKeyDown={(event) => {
											if (event.nativeEvent.isComposing) return;
											if (
												event.key === "Enter" &&
												(event.metaKey || event.ctrlKey)
											) {
												event.preventDefault();
												startAiConversation();
												return;
											}
											if (event.key === "ArrowDown") {
												event.preventDefault();
												setActive((value) =>
													Math.min(value + 1, Math.max(0, total - 1)),
												);
											} else if (event.key === "ArrowUp") {
												event.preventDefault();
												setActive((value) => Math.max(0, value - 1));
											} else if (event.key === "Enter" && total) {
												event.preventDefault();
												choose(Math.min(active, total - 1));
											}
										}}
										placeholder={t("검색하거나 AI에게 바로 질문")}
										className="h-10 border-0 py-0 pr-0 pl-1.5 text-base shadow-none focus-visible:ring-0"
										aria-label={t("검색어")}
									/>
								</div>
								<div
									className="min-h-0 flex-1 overflow-y-auto p-2"
									role="listbox"
									aria-label={t("검색 결과")}
								>
									{query.trim() ? (
										<>
											{trimmed.length >= 2 ? (
												<button
													type="button"
													onClick={startAiConversation}
													className="mb-1 flex w-full items-center gap-3 rounded-lg bg-muted/70 px-3 py-2.5 text-left hover:bg-muted"
												>
													<Sparkles className="size-4 shrink-0" />
													<span className="min-w-0 flex-1 truncate text-sm font-medium">
														{t("AI에게 “")}
														{trimmed}
														{t("” 질문하기")}
													</span>
													<kbd className="shrink-0 text-xs text-muted-foreground">
														⌘ ↵
													</kbd>
												</button>
											) : null}
											{results.length ? (
												<p className="px-3 py-2 text-[11px] font-medium text-muted-foreground">
													{t("노트 · 할 일 · 일정")}
												</p>
											) : null}
											{results.map(({ entry, snippet }, index) => {
												const Icon = icons[entry.item.type];
												return (
													<button
														key={entry.item.id}
														type="button"
														role="option"
														aria-selected={active === index}
														onMouseEnter={() => setActive(index)}
														onClick={() => void openItem(entry.item)}
														className="flex w-full gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted aria-selected:bg-muted"
													>
														<Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
														<span className="min-w-0 flex-1">
															<span className="block truncate text-sm font-medium">
																{entry.item.title}
															</span>
															<span className="block truncate text-xs text-muted-foreground">
																{t(ITEM_TYPE_LABEL[entry.item.type])} ·{" "}
																{t(SPACE_LABEL[entry.item.space])}
																{folderOf(entry.item)
																	? ` / ${folderOf(entry.item)}`
																	: ""}
															</span>
															{snippet ? (
																<span className="mt-1 block truncate text-xs text-muted-foreground">
																	{snippet}
																</span>
															) : null}
														</span>
													</button>
												);
											})}
											<div className="flex items-center justify-between px-3 py-2 text-[11px] font-medium text-muted-foreground">
												<span>{t("메일")}</span>
												{mailLoading ? <span>{t("검색 중…")}</span> : null}
											</div>
											{mailResults.map((message, index) => (
												<button
													key={message.id}
													type="button"
													role="option"
													aria-selected={active === results.length + index}
													onMouseEnter={() => setActive(results.length + index)}
													onClick={() => openMail(message)}
													className="flex w-full gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted aria-selected:bg-muted"
												>
													<Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
													<span className="min-w-0 flex-1">
														<span className="block truncate text-sm font-medium">
															{message.subject || t("(제목 없음)")}
														</span>
														<span className="block truncate text-xs text-muted-foreground">
															{message.from} · {folderLabels[message.folder]}
														</span>
														{message.snippet ? (
															<span className="mt-1 block truncate text-xs text-muted-foreground">
																{message.snippet}
															</span>
														) : null}
													</span>
												</button>
											))}
											{!total && !mailLoading && !mailError ? (
												<p className="px-3 py-6 text-center text-sm text-muted-foreground">
													{t("검색 결과가 없습니다.")}
												</p>
											) : null}
											{mailError ? (
												<p className="px-3 py-2 text-xs text-destructive">
													{t("저장된 메일을 검색하지 못했습니다.")}
												</p>
											) : null}
										</>
									) : null}
								</div>
								{trimmed ? (
									<div className="flex h-10 shrink-0 items-center justify-end border-t px-4 text-xs text-muted-foreground">
										<button
											type="button"
											onClick={searchMoreMail}
											className="ml-auto truncate hover:text-foreground"
										>
											{t("메일함에서 서버 검색 →")}
										</button>
									</div>
								) : null}
							</>
						) : null}
						<PaletteAi
							active={mode === "ai"}
							snapshot={snapshot}
							prefill={query}
							directAsk={directAsk}
							inputRef={aiInputRef}
							onOpenSource={openSource}
						/>
					</DialogContent>
				</Dialog>
			) : null}
		</>
	);
}
