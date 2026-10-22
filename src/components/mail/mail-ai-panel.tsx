import {
	AlignLeft,
	ArrowUp,
	Check,
	ListTodo,
	PenLine,
	RefreshCw,
	Sparkles,
	X,
} from "lucide-react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	askMailAi,
	loadAiModels,
	loadMailAiChat,
	refreshAiModels,
} from "#/lib/orbit/ai-functions";
import type { AiChat } from "#/lib/orbit/ai-types";
import { AiModelSelector } from "@/components/ai-model-selector";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const AiMessage = lazy(() =>
	import("../ai-message").then((module) => ({ default: module.AiMessage })),
);

export function MailAiPanel({
	mailId,
	active,
	subject,
	demo,
	onClose,
	onOpenMail,
}: {
	mailId: string;
	active: boolean;
	subject: string;
	demo: boolean;
	onClose: () => void;
	onOpenMail: (id: string) => void;
}) {
	const { t, errorText } = useI18n();
	const [chat, setChat] = useState<AiChat | null>(null);
	const [historyReady, setHistoryReady] = useState(false);
	const [question, setQuestion] = useState("");
	const [models, setModels] = useState<string[]>([]);
	const [model, setModel] = useState("");
	const [configured, setConfigured] = useState(false);
	const [loading, setLoading] = useState(!demo);
	const [busy, setBusy] = useState(false);
	const [pending, setPending] = useState("");
	const [error, setError] = useState("");
	const live = useRef(true);
	const submitting = useRef(false);
	const loadGeneration = useRef(0);
	const endRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const hasPending = chat?.messages.some(
		(message) => message.status === "pending",
	);
	const ready =
		!demo &&
		historyReady &&
		configured &&
		!!model &&
		!loading &&
		!busy &&
		!hasPending;

	const load = useCallback(
		async (refresh = false) => {
			if (demo) return;
			const generation = ++loadGeneration.current;
			const isCurrent = () =>
				live.current && generation === loadGeneration.current;
			setLoading(true);
			setHistoryReady(false);
			setError("");
			try {
				const [catalogResult, historyResult] = await Promise.allSettled([
					refresh ? refreshAiModels() : loadAiModels(),
					loadMailAiChat({ data: { mailId } }).then((history) => {
						if (isCurrent()) {
							setChat(history);
							setHistoryReady(true);
						}
					}),
				]);
				if (!isCurrent()) return;
				if (historyResult.status === "rejected") throw historyResult.reason;
				if (catalogResult.status === "rejected") throw catalogResult.reason;
				const catalog = catalogResult.value;
				setConfigured(catalog.configured);
				setModels(catalog.models);
				let saved = "";
				try {
					saved = window.localStorage.getItem("orbit-ai-model") || "";
				} catch {
					/* optional preference */
				}
				setModel((current) =>
					catalog.models.includes(current)
						? current
						: catalog.models.includes(saved)
							? saved
							: "",
				);
			} catch (cause) {
				if (isCurrent())
					setError(
						cause instanceof Error
							? cause.message
							: "AI 설정을 불러오지 못했습니다.",
					);
			} finally {
				if (isCurrent()) setLoading(false);
			}
		},
		[mailId, demo],
	);

	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
		};
	}, []);

	useEffect(() => {
		if (active && !submitting.current) void load();
	}, [active, load]);

	useEffect(() => {
		if (active && (chat || pending))
			endRef.current?.scrollIntoView({ block: "nearest" });
	}, [active, chat, pending]);

	async function ask() {
		const text = question.trim();
		if (!ready || submitting.current || text.length < 2) return;
		submitting.current = true;
		setBusy(true);
		setPending(text);
		setQuestion("");
		setError("");
		try {
			const next = await askMailAi({
				data: {
					mailId,
					question: text,
					model,
					chatId: chat?.id,
					requestId: crypto.randomUUID(),
				},
			});
			if (!live.current) return;
			setChat(next);
			setQuestion("");
		} catch (cause) {
			if (!live.current) return;
			setQuestion(text);
			setError(
				cause instanceof Error
					? cause.message
					: "답변을 가져오지 못했습니다. 기록에서 상태를 확인해 주세요.",
			);
			const saved = await loadMailAiChat({ data: { mailId } }).catch(
				() => null,
			);
			if (live.current && saved) setChat(saved);
		} finally {
			submitting.current = false;
			if (live.current) {
				setBusy(false);
				setPending("");
			}
		}
	}

	const suggestions = [
		{ label: t("요약"), prompt: t("핵심 내용 요약해 줘"), Icon: AlignLeft },
		{ label: t("할 일"), prompt: t("내가 해야 할 일은 뭐야?"), Icon: ListTodo },
		{ label: t("답장 초안"), prompt: t("답장 초안 써 줘"), Icon: PenLine },
	];

	return (
		<aside
			aria-label={t("메일 AI 질문")}
			className="mail-ai-panel flex h-full min-h-0 min-w-0 flex-col"
		>
			<header className="flex shrink-0 items-center gap-2 px-4 pt-4 pb-2">
				<Sparkles className="size-4 text-foreground/70" />
				<h3 className="flex-1 text-sm font-medium" title={subject}>
					AI
				</h3>
				{(error || hasPending) && (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("대화 새로고침")}
						disabled={demo || loading || busy}
						onClick={() => void load()}
						className="text-muted-foreground"
					>
						<RefreshCw
							className={loading ? "size-3.5 animate-spin" : "size-3.5"}
						/>
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("AI 질문 닫기")}
					onClick={onClose}
					className="text-muted-foreground hover:text-foreground"
				>
					<X className="size-4" />
				</Button>
			</header>
			<div
				className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4"
				aria-busy={busy || loading}
			>
				{chat?.messages.map((message) => (
					<div
						key={message.id}
						className={cn(
							"mail-ai-message",
							message.role === "user"
								? "ml-auto w-fit max-w-[calc(100%-1.5rem)] rounded-2xl rounded-br-md bg-foreground/[0.06] px-3.5 py-2.5"
								: "min-w-0",
						)}
					>
						{message.role === "assistant" ? (
							<Suspense
								fallback={
									<p className="whitespace-pre-wrap text-sm">
										{message.content}
									</p>
								}
							>
								<AiMessage
									content={message.content}
									sources={message.sources}
									onOpenSource={(source) => {
										if (source.kind === "mail") onOpenMail(source.id);
									}}
									onNavigate={onClose}
								/>
							</Suspense>
						) : (
							<p className="whitespace-pre-wrap break-words text-sm leading-6">
								{message.content}
							</p>
						)}
						{message.status === "failed" && (
							<p className="mt-1 text-xs text-destructive">
								{t("답변을 가져오지 못했습니다.")}
							</p>
						)}
					</div>
				))}
				{pending && (
					<p className="mail-ai-message ml-auto w-fit max-w-[calc(100%-1.5rem)] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-foreground/[0.06] px-3.5 py-2.5 text-sm leading-6">
						{pending}
					</p>
				)}
				{(busy || hasPending || loading) && (
					<output
						aria-label={loading ? t("불러오는 중…") : t("답변을 작성하는 중…")}
						className="mail-ai-thinking flex h-8 items-center gap-1.5"
					>
						<span />
						<span />
						<span />
					</output>
				)}
				<div ref={endRef} />
			</div>
			<div className="shrink-0 px-3 pb-3">
				{!chat?.messages.length && !busy && (
					<div className="mail-ai-suggestions mb-3 flex flex-wrap gap-1.5 px-1">
						{suggestions.map(({ label, prompt, Icon }, index) => (
							<button
								key={label}
								type="button"
								disabled={loading}
								aria-pressed={question === prompt}
								style={{ animationDelay: `${index * 45}ms` }}
								className="mail-ai-suggestion inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-3 py-2 text-xs text-muted-foreground hover:border-foreground/20 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-foreground/20 aria-pressed:text-foreground"
								onClick={() => {
									setQuestion(prompt);
									inputRef.current?.focus();
								}}
							>
								{question === prompt ? (
									<Check className="size-3.5" />
								) : (
									<Icon className="size-3.5" />
								)}
								{label}
							</button>
						))}
					</div>
				)}
				{error && (
					<p role="alert" className="mb-3 px-1 text-xs text-destructive">
						{errorText(error)}
					</p>
				)}
				<form
					className="mail-ai-composer rounded-2xl border border-foreground/10 bg-background p-2 shadow-sm"
					onSubmit={(event) => {
						event.preventDefault();
						void ask();
					}}
				>
					<Textarea
						ref={inputRef}
						value={question}
						maxLength={1000}
						disabled={busy || loading || !!hasPending}
						aria-label={t("이 메일에 대해 질문하기")}
						placeholder={t("메일에 대해 물어보세요")}
						className="max-h-40 min-h-20 resize-none rounded-none border-0 bg-transparent px-2 py-2 text-sm leading-6 shadow-none focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent"
						onChange={(event) => setQuestion(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								!event.shiftKey &&
								!event.nativeEvent.isComposing &&
								event.keyCode !== 229
							) {
								event.preventDefault();
								void ask();
							}
						}}
					/>
					<div className="flex min-w-0 items-center justify-between gap-2 pt-1">
						{demo ? (
							<span
								className="px-2 text-[11px] text-muted-foreground/70"
								title={t("AI 질문은 연결한 메일에서 사용할 수 있습니다.")}
							>
								{t("데모")}
							</span>
						) : !configured && !loading && !error ? (
							<span
								className="px-2 text-xs text-muted-foreground"
								title={t("설정 → AI에서 Gateway API 키를 저장해 주세요.")}
							>
								{t("AI 연결 필요")}
							</span>
						) : (
							<AiModelSelector
								compact
								models={models}
								value={model}
								loading={loading}
								disabled={loading || busy || !configured}
								onRefresh={() => void load(true)}
								onChange={(next) => {
									setModel(next);
									try {
										window.localStorage.setItem("orbit-ai-model", next);
									} catch {
										/* optional preference */
									}
								}}
							/>
						)}
						<Button
							type="submit"
							size="icon-sm"
							disabled={!ready || question.trim().length < 2}
							aria-label={t("질문 보내기")}
							className="mail-ai-send rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
						>
							<ArrowUp className="size-4" />
						</Button>
					</div>
				</form>
			</div>
		</aside>
	);
}
