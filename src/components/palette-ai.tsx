import {
	CalendarDays,
	FileText,
	History,
	Link2,
	ListTodo,
	Mail,
	Plus,
	Send,
	Sparkles,
	X,
} from "lucide-react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	askOrbitAi,
	loadAiChat,
	loadAiHistory,
	loadAiModels,
	refreshAiModels,
} from "#/lib/orbit/ai-functions";
import type {
	AiChat,
	AiChatSummary,
	AiReference,
	AiSource,
} from "#/lib/orbit/ai-types";
import { createSearchIndex, searchItems } from "#/lib/orbit/global-search";
import type { OrbitSnapshot } from "#/lib/orbit/schema";
import { searchCachedMail } from "#/lib/orbit/search-functions";
import { AiModelSelector } from "@/components/ai-model-selector";
import { Input } from "@/components/ui/input";

const icons = {
	note: FileText,
	task: ListTodo,
	event: CalendarDays,
	link: Link2,
};
type MailHit = Awaited<ReturnType<typeof searchCachedMail>>[number];
type Suggestion = {
	reference: AiReference;
	title: string;
	detail: string;
	Icon: typeof FileText;
};

export function PaletteAi({
	active,
	snapshot,
	prefill,
	directAsk,
	inputRef,
	onOpenSource,
}: {
	active: boolean;
	snapshot: OrbitSnapshot;
	prefill: string;
	directAsk: { id: string; question: string } | null;
	inputRef: RefObject<HTMLInputElement | null>;
	onOpenSource: (source: AiSource) => void;
}) {
	const [question, setQuestion] = useState("");
	const [caret, setCaret] = useState(0);
	const [mentions, setMentions] = useState<
		{ reference: AiReference; title: string }[]
	>([]);
	const [dismissMention, setDismissMention] = useState(false);
	const [mentionActive, setMentionActive] = useState(0);
	const [mail, setMail] = useState<{ term: string; results: MailHit[] }>({
		term: "",
		results: [],
	});
	const [models, setModels] = useState<string[]>([]);
	const [model, setModel] = useState("");
	const [configured, setConfigured] = useState(true);
	const [loadingModels, setLoadingModels] = useState(false);
	const [refreshingModels, setRefreshingModels] = useState(false);
	const [history, setHistory] = useState<AiChatSummary[]>([]);
	const [showHistory, setShowHistory] = useState(false);
	const [chat, setChat] = useState<AiChat | null>(null);
	const [busy, setBusy] = useState(false);
	const [pendingQuestion, setPendingQuestion] = useState("");
	const [error, setError] = useState("");
	const endRef = useRef<HTMLDivElement>(null);
	const appliedPrefill = useRef("");
	const preparedDirectAsk = useRef("");
	const processedDirectAsk = useRef("");
	const index = useMemo(
		() => createSearchIndex(snapshot.items),
		[snapshot.items],
	);
	const beforeCaret = question.slice(0, caret);
	const mentionMatch =
		active && !dismissMention ? /(?:^|\s)@([^\s@]*)$/.exec(beforeCaret) : null;
	const mentionOpen = Boolean(mentionMatch);
	const mentionTerm = mentionMatch?.[1] ?? "";
	const selectedKey = (reference: AiReference) =>
		`${reference.kind}:${reference.id}`;
	const selected = new Set(
		mentions.map(({ reference }) => selectedKey(reference)),
	);
	const itemSuggestions: Suggestion[] = (
		mentionTerm
			? searchItems(index, mentionTerm, 8).map(({ entry }) => entry.item)
			: [...snapshot.items]
					.sort((a, b) => b.updated.localeCompare(a.updated))
					.slice(0, 6)
	)
		.filter((item) => !selected.has(`item:${item.id}`))
		.slice(0, 6)
		.map((item) => ({
			reference: { kind: "item", id: item.id },
			title: item.title,
			detail:
				item.type === "task"
					? "할 일"
					: item.type === "event"
						? "일정"
						: "노트",
			Icon: icons[item.type],
		}));
	const mailSuggestions: Suggestion[] = (
		mail.term === mentionTerm ? mail.results : []
	)
		.filter((item) => !selected.has(`mail:${item.id}`))
		.slice(0, 5)
		.map((item) => ({
			reference: { kind: "mail", id: item.id },
			title: item.subject || "(제목 없음)",
			detail: `메일 · ${item.from}`,
			Icon: Mail,
		}));
	const suggestions = [...itemSuggestions, ...mailSuggestions].slice(0, 8);

	useEffect(() => {
		if (active && prefill.trim() && appliedPrefill.current !== prefill) {
			appliedPrefill.current = prefill;
			setQuestion(prefill);
			setCaret(prefill.length);
		}
	}, [active, prefill]);

	useEffect(() => {
		if (!active) return;
		let live = true;
		setLoadingModels(true);
		void Promise.all([loadAiModels(), loadAiHistory()])
			.then(([catalog, conversations]) => {
				if (!live) return;
				setConfigured(catalog.configured);
				setModels(catalog.models);
				const savedModel = window.localStorage.getItem("orbit-ai-model") ?? "";
				setModel((current) => {
					if (catalog.models.includes(current)) return current;
					return catalog.models.includes(savedModel) ? savedModel : "";
				});
				setHistory(conversations);
			})
			.catch((cause) => {
				if (live)
					setError(
						cause instanceof Error
							? cause.message
							: "AI 설정을 불러오지 못했습니다.",
					);
			})
			.finally(() => {
				if (live) setLoadingModels(false);
			});
		return () => {
			live = false;
		};
	}, [active]);

	useEffect(() => {
		if (!active || !mentionOpen || !mentionTerm) return;
		let live = true;
		const timer = window.setTimeout(() => {
			void searchCachedMail({ data: { query: mentionTerm.slice(0, 200) } })
				.then((results) => {
					if (live) setMail({ term: mentionTerm, results });
				})
				.catch(() => {
					if (live) setMail({ term: mentionTerm, results: [] });
				});
		}, 140);
		return () => {
			live = false;
			window.clearTimeout(timer);
		};
	}, [active, mentionTerm, mentionOpen]);

	useEffect(() => {
		if (active && chat) endRef.current?.scrollIntoView({ block: "end" });
	}, [active, chat]);

	function addMention(suggestion: Suggestion) {
		if (!mentionMatch || mentions.length >= 8) return;
		const start =
			mentionMatch.index + (mentionMatch[0].startsWith("@") ? 0 : 1);
		const next = `${question.slice(0, start)}${question.slice(caret)}`;
		setQuestion(next);
		setCaret(start);
		setMentions((current) => [
			...current,
			{ reference: suggestion.reference, title: suggestion.title },
		]);
		setDismissMention(true);
		setMentionActive(0);
		inputRef.current?.focus();
	}

	async function openChat(id: string) {
		setError("");
		try {
			const next = await loadAiChat({ data: { id } });
			setChat(next);
			setShowHistory(false);
			setQuestion("");
			setCaret(0);
			setMentions([]);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "대화를 불러오지 못했습니다.",
			);
		}
	}

	async function refreshModels() {
		if (refreshingModels) return;
		setRefreshingModels(true);
		setError("");
		try {
			const catalog = await refreshAiModels();
			setConfigured(catalog.configured);
			setModels(catalog.models);
			setModel((current) => (catalog.models.includes(current) ? current : ""));
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Gateway 모델 목록을 갱신하지 못했습니다.",
			);
		} finally {
			setRefreshingModels(false);
		}
	}

	const send = useCallback(
		async (override?: string, newChat = false) => {
			const text = (override ?? question).trim();
			if (busy || !model || text.length < 2 || mentions.length > 8) return;
			setBusy(true);
			setPendingQuestion(text);
			setError("");
			try {
				const next = await askOrbitAi({
					data: {
						question: text,
						model,
						references: newChat
							? []
							: mentions.map(({ reference }) => reference),
						chatId: newChat ? undefined : chat?.id,
						requestId: crypto.randomUUID(),
					},
				});
				setChat(next);
				setQuestion("");
				setCaret(0);
				setMentions([]);
				const updatedHistory = await loadAiHistory().catch(() => null);
				if (updatedHistory) setHistory(updatedHistory);
				setShowHistory(false);
			} catch (cause) {
				setError(
					cause instanceof Error
						? cause.message
						: "답변을 가져오지 못했습니다. 기록에서 상태를 확인해 주세요.",
				);
				setHistory(await loadAiHistory().catch(() => history));
			} finally {
				setBusy(false);
				setPendingQuestion("");
			}
		},
		[busy, model, question, mentions, chat, history],
	);

	useEffect(() => {
		if (!active || !directAsk || processedDirectAsk.current === directAsk.id)
			return;
		if (preparedDirectAsk.current !== directAsk.id) {
			preparedDirectAsk.current = directAsk.id;
			setQuestion(directAsk.question);
			setCaret(directAsk.question.length);
			setChat(null);
			setMentions([]);
			setShowHistory(false);
		}
		if (!model) return;
		processedDirectAsk.current = directAsk.id;
		void send(directAsk.question, true);
	}, [active, directAsk, model, send]);

	return (
		<section
			className={active ? "flex min-h-0 flex-1 flex-col" : "hidden"}
			aria-label="AI 질문"
		>
			<div className="relative shrink-0 border-b px-4 py-2">
				<div className="flex items-center gap-2">
					<Sparkles className="size-4 shrink-0 text-muted-foreground" />
					<Input
						ref={inputRef}
						value={question}
						maxLength={1000}
						aria-label="AI에게 질문"
						placeholder="내 자료에 질문하세요 · @로 자료 선택"
						className="h-9 min-w-0 flex-1 border-0 py-0 pr-0 pl-1.5 text-sm shadow-none focus-visible:ring-0"
						onChange={(event) => {
							setQuestion(event.target.value);
							setCaret(
								event.target.selectionStart ?? event.target.value.length,
							);
							setDismissMention(false);
							setMentionActive(0);
						}}
						onClick={(event) =>
							setCaret(event.currentTarget.selectionStart ?? question.length)
						}
						onKeyUp={(event) => {
							if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key))
								setCaret(event.currentTarget.selectionStart ?? question.length);
						}}
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing) return;
							if (mentionMatch && suggestions.length) {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									setMentionActive((value) =>
										Math.min(value + 1, suggestions.length - 1),
									);
									return;
								}
								if (event.key === "ArrowUp") {
									event.preventDefault();
									setMentionActive((value) => Math.max(0, value - 1));
									return;
								}
								if (event.key === "Enter") {
									event.preventDefault();
									addMention(suggestions[mentionActive] ?? suggestions[0]);
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									setDismissMention(true);
									return;
								}
							}
							if (event.key === "Enter") {
								event.preventDefault();
								void send();
							}
						}}
					/>
					<button
						type="button"
						onClick={() => void send()}
						disabled={busy || !model || question.trim().length < 2}
						aria-label="AI에게 보내기"
						className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background disabled:opacity-40"
					>
						<Send className="size-4" />
					</button>
				</div>
				{mentions.length ? (
					<div className="flex flex-wrap gap-1.5 pb-1 pt-2">
						{mentions.map(({ reference, title }) => (
							<button
								key={selectedKey(reference)}
								type="button"
								onClick={() =>
									setMentions((current) =>
										current.filter(
											(item) =>
												selectedKey(item.reference) !== selectedKey(reference),
										),
									)
								}
								className="inline-flex max-w-48 items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
								title="언급 제거"
							>
								<span className="truncate">@{title}</span>
								<X className="size-3 shrink-0" />
							</button>
						))}
					</div>
				) : null}
				{mentionMatch ? (
					<div
						className="absolute left-3 right-3 top-full z-20 max-h-64 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
						role="listbox"
						aria-label="언급할 자료"
					>
						{suggestions.length ? (
							suggestions.map((suggestion, index) => (
								<button
									key={selectedKey(suggestion.reference)}
									type="button"
									role="option"
									aria-selected={mentionActive === index}
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => addMention(suggestion)}
									className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted aria-selected:bg-muted"
								>
									<suggestion.Icon className="size-4 shrink-0 text-muted-foreground" />
									<span className="min-w-0 flex-1 truncate">
										{suggestion.title}
									</span>
									<span className="shrink-0 text-xs text-muted-foreground">
										{suggestion.detail}
									</span>
								</button>
							))
						) : (
							<p className="p-3 text-xs text-muted-foreground">
								자료를 찾지 못했습니다.
							</p>
						)}
						{!mentionTerm ? (
							<p className="px-2 pb-2 text-xs text-muted-foreground">
								메일은 @ 뒤에 검색어를 입력하세요.
							</p>
						) : null}
					</div>
				) : null}
			</div>
			<div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
				<AiModelSelector
					models={models}
					value={model}
					onChange={(selected) => {
						setModel(selected);
						window.localStorage.setItem("orbit-ai-model", selected);
					}}
					disabled={busy || loadingModels || !models.length}
					loading={loadingModels || refreshingModels}
					onRefresh={() => void refreshModels()}
				/>
				<button
					type="button"
					onClick={() => {
						setChat(null);
						setQuestion("");
						setMentions([]);
						setShowHistory(false);
						inputRef.current?.focus();
					}}
					className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-muted"
				>
					<Plus className="size-3.5" />새 대화
				</button>
				<button
					type="button"
					onClick={() => setShowHistory((value) => !value)}
					aria-pressed={showHistory}
					className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-muted"
				>
					<History className="size-3.5" />
					기록
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				{!configured ? (
					<p className="rounded-lg bg-muted p-3 text-sm">
						설정 → AI에서 Gateway API 키를 저장해 주세요.
					</p>
				) : null}
				{showHistory ? (
					<div className="grid gap-1">
						<p className="mb-2 text-xs font-medium text-muted-foreground">
							지난 대화
						</p>
						{history.length ? (
							history.map((entry) => (
								<button
									key={entry.id}
									type="button"
									onClick={() => void openChat(entry.id)}
									className="rounded-lg px-3 py-2 text-left hover:bg-muted"
								>
									<span className="block truncate text-sm">{entry.title}</span>
									<span className="text-xs text-muted-foreground">
										{new Date(entry.updatedAt).toLocaleString("ko-KR")}
									</span>
								</button>
							))
						) : (
							<p className="py-6 text-center text-sm text-muted-foreground">
								아직 대화가 없습니다.
							</p>
						)}
					</div>
				) : (
					<div className="grid gap-4">
						{!chat?.messages.length && !busy ? (
							<div className="py-12 text-center text-sm text-muted-foreground">
								<Sparkles className="mx-auto mb-3 size-5" />
								<p>내 자료에 대해 바로 물어보세요.</p>
								<p className="mt-1 text-xs">
									@를 입력하면 노트·할 일·일정·메일을 직접 고를 수 있습니다.
								</p>
							</div>
						) : null}
						{chat?.messages.map((message) => (
							<div
								key={message.id}
								className={
									message.role === "user"
										? "ml-10 rounded-xl bg-muted p-3"
										: "mr-4 rounded-xl border p-3"
								}
							>
								<p className="whitespace-pre-wrap text-sm leading-6">
									{message.content}
								</p>
								{message.status === "pending" ? (
									<p className="mt-2 text-xs text-muted-foreground">
										응답 확인 중 · 기록을 다시 열어 상태를 확인하세요.
									</p>
								) : null}
								{message.status === "failed" ? (
									<p className="mt-2 text-xs text-destructive">
										응답을 완료하지 못했습니다.
									</p>
								) : null}
								{message.sources?.length ? (
									<div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2">
										{message.sources.map((source) => (
											<button
												key={`${source.kind}:${source.id}`}
												type="button"
												onClick={() => onOpenSource(source)}
												className="max-w-full truncate rounded-md bg-muted px-2 py-1 text-xs hover:bg-accent"
												title={
													source.scope === "preview"
														? "메일 미리보기만 참고"
														: source.title
												}
											>
												[{source.index}] {source.title}
												{source.scope === "preview" ? " · 미리보기" : ""}
											</button>
										))}
									</div>
								) : null}
							</div>
						))}
						{busy ? (
							<div className="ml-10 rounded-xl bg-muted p-3 text-sm">
								{pendingQuestion}
								<p className="mt-2 text-xs text-muted-foreground">
									답변을 기다리고 있습니다…
								</p>
							</div>
						) : null}
						<div ref={endRef} />
					</div>
				)}
				{error ? (
					<p role="alert" className="mt-3 text-sm text-destructive">
						{error}
					</p>
				) : null}
			</div>
			<div className="flex h-9 shrink-0 items-center border-t px-4 text-xs text-muted-foreground">
				Enter 질문 · @ 자료 언급 · 기록에서 지난 답변 보기
			</div>
		</section>
	);
}
