import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import {
	Archive,
	ArrowLeft,
	Forward,
	Mail,
	MailOpen,
	MessagesSquare,
	Paperclip,
	Pencil,
	RefreshCw,
	Reply,
	ReplyAll,
	Search,
	Settings,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createMailClient } from "#/lib/mail/client";
import { conversations } from "#/lib/mail/conversations";
import {
	accountAddresses,
	mailScopes,
	mailViews,
	matchingAddresses,
} from "#/lib/mail/identities";
import {
	folderLabels,
	type MailDetail,
	type MailFolder,
	type MailMessage,
} from "#/lib/mail/types";
import type { MailSearch } from "#/lib/orbit/navigation-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MailAccountFilter } from "./mail-account-filter";
import { MailComposer } from "./mail-composer";
import { MailMessageContent } from "./mail-message-content";
import { MailSettings } from "./mail-settings";
import { MailThreadMessage } from "./mail-thread-message";
import { useMailList } from "./use-mail-list";

export function MailWorkspace({ demo = false }: { demo?: boolean }) {
	const location = useSearch({ from: "/mail" });
	const navigate = useNavigate({ from: "/mail" });
	const router = useRouter();
	const api = useMemo(() => createMailClient(demo), [demo]);
	const accountIds = location.accounts ?? null;
	const folder = location.folder ?? "inbox";
	const search = location.q ?? "";
	const selected = location.message ?? "";
	const [query, setQuery] = useState(search);
	const [detail, setDetail] = useState<MailDetail | null>(null);
	const [settings, setSettings] = useState(false);
	const [compose, setCompose] = useState<
		"new" | "reply" | "all" | "forward" | null
	>(null);
	const [composeOriginal, setComposeOriginal] = useState<MailDetail | null>(
		null,
	);
	const [reading, setReading] = useState(false);
	const [mutatingIds, setMutatingIds] = useState<Set<string>>(new Set());
	const pendingActions = useRef(new Set<string>());
	const selectedRef = useRef(selected);
	selectedRef.current = selected;
	const mailScope = JSON.stringify([accountIds, folder, search]);
	const mailScopeRef = useRef(mailScope);
	mailScopeRef.current = mailScope;
	const mutating = mutatingIds.has(selected);
	const [detailError, setDetailError] = useState("");
	const [remoteImages, setRemoteImages] = useState(true);
	const detailGeneration = useRef(0);
	const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const composing = useRef(false);
	const updateLocation = useCallback(
		(patch: Partial<MailSearch>, replace = false) => {
			if (searchTimer.current) clearTimeout(searchTimer.current);
			void navigate({
				search: (previous) => ({ ...previous, ...patch }),
				state: { orbitDetailBack: undefined },
				replace,
				resetScroll: false,
			});
		},
		[navigate],
	);
	useEffect(() => {
		setQuery(location.q ?? "");
		if (searchTimer.current) clearTimeout(searchTimer.current);
	}, [location]);
	const {
		status,
		messages,
		setMessages,
		loading,
		syncing,
		errors,
		error,
		setError,
		cursors,
		updated,
		refresh,
		refreshStatus,
		beginMutation,
		refreshRef,
	} = useMailList(accountIds, folder, search, api);
	const markThreadRead = useCallback(
		(id: string) => {
			setMessages((previous) =>
				previous.map((m) => (m.id === id ? { ...m, unread: false } : m)),
			);
		},
		[setMessages],
	);
	const [thread, setThread] = useState<MailMessage[]>([]);
	const [threadLoading, setThreadLoading] = useState(false);
	const [threadError, setThreadError] = useState("");
	const [threadIncomplete, setThreadIncomplete] = useState(false);
	const [detailRetry, setDetailRetry] = useState(0);
	const detailCache = useRef(new Map<string, MailDetail>());
	const threadCache = useRef(
		new Map<
			string,
			{ messages: MailMessage[]; incomplete: boolean; error?: string }
		>(),
	);
	const rows = useMemo(() => conversations(messages), [messages]);
	const views = useMemo(
		() => mailViews(status?.accounts || []),
		[status?.accounts],
	);
	const selectedView =
		accountIds?.length === 1
			? views.find((view) => view.id === accountIds[0])
			: undefined;
	useEffect(() => {
		if (!status || accountIds === null) return;
		const remaining = accountIds.filter((id) => views.some((a) => a.id === id));
		if (remaining.length !== accountIds.length)
			updateLocation({ accounts: remaining }, true);
	}, [accountIds, status, views, updateLocation]);
	useEffect(() => {
		if (!selected) {
			setThread([]);
			return;
		}
		const controller = new AbortController();
		setThreadLoading(true);
		setThreadError("");
		const cachedThread = detailRetry
			? undefined
			: threadCache.current.get(selected);
		setThreadIncomplete(cachedThread?.incomplete ?? false);
		setThread(
			(previous) =>
				cachedThread?.messages ??
				(previous.some((m) => m.id === selected) ? previous : []),
		);
		const path = `conversation?id=${encodeURIComponent(selected)}&revision=${detailRetry}`;
		type Conversation = {
			messages: MailMessage[];
			incomplete: boolean;
			error?: string;
		};
		void (
			cachedThread
				? Promise.resolve(cachedThread)
				: api<Conversation>(path, undefined, controller.signal)
		)
			.then(async (cached) => {
				if (controller.signal.aborted) return;
				setThread(cached.messages);
				const next = await api<Conversation>(
					`${path}&remote=1`,
					undefined,
					controller.signal,
				);
				if (controller.signal.aborted) return;
				threadCache.current.set(selected, next);
				if (threadCache.current.size > 30)
					threadCache.current.delete(
						threadCache.current.keys().next().value as string,
					);
				setThread(next.messages);
				setThreadIncomplete(next.incomplete);
				setThreadError(next.error || "");
			})
			.catch((e) => {
				if (!controller.signal.aborted) setThreadError(e.message);
			})
			.finally(() => {
				if (!controller.signal.aborted) setThreadLoading(false);
			});
		return () => controller.abort();
	}, [selected, detailRetry, api]);
	useEffect(() => {
		const current = ++detailGeneration.current;
		const cacheKey = `${selected}:${remoteImages}`;
		const cached = detailRetry ? undefined : detailCache.current.get(cacheKey);
		setDetail(cached || null);
		setDetailError("");
		if (!selected) {
			setReading(false);
			return;
		}
		setReading(!cached);
		const controller = new AbortController();
		void api<MailDetail>(
			`message?id=${encodeURIComponent(selected)}&images=${remoteImages ? "1" : "0"}`,
			undefined,
			controller.signal,
		)
			.then(async (d) => {
				if (current !== detailGeneration.current) return;
				detailCache.current.set(cacheKey, d);
				if (detailCache.current.size > 30)
					detailCache.current.delete(
						detailCache.current.keys().next().value as string,
					);
				setDetail(d);
				setReading(false);
				if (d.unread) {
					try {
						await api("action", { id: d.id, action: "read" });
						if (current === detailGeneration.current) {
							setDetail((prev) => (prev ? { ...prev, unread: false } : prev));
							setMessages((prev) =>
								prev.map((m) => (m.id === d.id ? { ...m, unread: false } : m)),
							);
						}
					} catch (e) {
						toast.error(
							e instanceof Error ? e.message : "읽음 처리에 실패했습니다.",
						);
					}
				}
			})
			.catch((e) => {
				if (
					current === detailGeneration.current &&
					!controller.signal.aborted
				) {
					setDetailError(e.message);
					setReading(false);
				}
			});
		return () => controller.abort();
	}, [selected, remoteImages, detailRetry, setMessages, api]);
	useEffect(
		() => () => {
			if (searchTimer.current) clearTimeout(searchTimer.current);
		},
		[],
	);
	function selectMessage(id: string) {
		setRemoteImages(true);
		setDetail(detailCache.current.get(`${id}:true`) || null);
		setReading(Boolean(id) && !detailCache.current.has(`${id}:true`));
		setDetailError("");
		if (!id) {
			updateLocation({ message: undefined }, true);
			return;
		}
		if (searchTimer.current) clearTimeout(searchTimer.current);
		void navigate({
			search: (previous) => ({ ...previous, message: id }),
			state: { orbitDetailBack: !selected ? "mail" : undefined },
			resetScroll: false,
		});
	}
	function closeMessage() {
		if (router.state.location.state.orbitDetailBack === "mail")
			router.history.back();
		else selectMessage("");
	}
	async function action(
		kind: "read" | "unread" | "trash" | "archive",
		target: MailMessage | null = detail,
	) {
		if (!target || pendingActions.current.has(target.id)) return;
		const originalDetail = detail?.id === target.id ? detail : null;
		threadCache.current.clear();
		const summary = messages.find((message) => message.id === target.id);
		const scope = mailScope;
		const removing = kind === "trash" || kind === "archive";
		const unread = kind === "unread";
		pendingActions.current.add(target.id);
		setMutatingIds(new Set(pendingActions.current));
		const finish = beginMutation();
		if (selected === target.id) detailGeneration.current++;
		for (const images of [false, true])
			detailCache.current.delete(`${target.id}:${images}`);
		if (removing) {
			if (selected === target.id) selectMessage("");
			setMessages((previous) =>
				previous.filter((message) => message.id !== target.id),
			);
		} else if (kind === "read" || kind === "unread") {
			if (originalDetail) setDetail({ ...originalDetail, unread });
			setMessages((previous) =>
				previous.map((message) =>
					message.id === target.id ? { ...message, unread } : message,
				),
			);
		}
		try {
			await api("action", { id: target.id, action: kind });
		} catch (error) {
			if (mailScopeRef.current === scope) {
				setMessages((previous) =>
					removing && summary
						? [
								...previous.filter((message) => message.id !== target.id),
								summary,
							].sort((a, b) => b.date - a.date)
						: previous.map((message) =>
								message.id === target.id
									? { ...message, unread: target.unread }
									: message,
							),
				);
			}
			if (selectedRef.current === target.id && originalDetail)
				setDetail(originalDetail);
			toast.error(
				error instanceof Error ? error.message : "처리하지 못했습니다.",
			);
		} finally {
			finish();
			pendingActions.current.delete(target.id);
			setMutatingIds(new Set(pendingActions.current));
		}
	}
	function changed() {
		void refreshStatus()
			.then(() => refreshRef.current(true))
			.catch((e) => setError(e.message));
	}
	const noAccounts = status?.accounts.length === 0;
	const busy = loading || syncing.length > 0;
	const selectedSummary =
		messages.find((m) => m.id === selected) ||
		thread.find((m) => m.id === selected);
	const activeThread = thread.some((m) => m.id === selected) ? thread : [];
	const activeAccounts = mailScopes(status?.accounts || [], accountIds);
	const syncFailed = Object.keys(errors).length > 0;
	const lastUpdated = activeAccounts.length
		? Math.min(...activeAccounts.map((a) => updated[a.id] || a.lastSync || 0))
		: 0;
	const syncLabel = busy
		? search
			? "검색 중…"
			: "최신화 중…"
		: syncFailed
			? "연결 확인"
			: "";
	const syncDescription = busy
		? `${syncLabel}${syncing.length ? ` ${syncing.length}개 계정` : ""}`
		: syncFailed
			? "일부 계정을 최신화하지 못했습니다"
			: lastUpdated
				? `${new Date(lastUpdated).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 최신화 · 새로고침`
				: "메일 새로고침";

	return (
		<div className="flex h-full min-h-0 flex-col">
			{demo && (
				<div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
					<span className="font-medium text-foreground">데모 메일함</span>
					<span className="flex-1">실제로 발송되지 않습니다</span>
					<Button
						size="sm"
						variant="ghost"
						onClick={async () => {
							await api("reset", {});
							window.location.href = "/mail?demo=1";
						}}
					>
						초기화
					</Button>
					<a className="underline underline-offset-4" href="/mail">
						데모 닫기
					</a>
				</div>
			)}
			<div
				className={cn(
					"flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5",
					selected && "hidden md:flex",
				)}
			>
				<MailAccountFilter
					accounts={views}
					selected={accountIds}
					onChange={(ids) => {
						updateLocation({ accounts: ids ?? undefined, message: undefined });
					}}
					syncing={views
						.filter((view) => syncing.includes(view.accountId))
						.map((view) => view.id)}
					errors={Object.fromEntries(
						views.map((view) => [view.id, errors[view.accountId]]),
					)}
					updated={Object.fromEntries(
						views.map((view) => [view.id, updated[view.accountId]]),
					)}
				/>
				<div className="relative order-last w-full min-w-0 flex-[1_0_100%] sm:order-none sm:w-auto sm:flex-1">
					<Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
					<Input
						aria-label="메일 검색"
						className="pl-8 pr-9"
						placeholder="이 메일함에서 검색"
						maxLength={200}
						onCompositionStart={() => {
							composing.current = true;
							if (searchTimer.current) clearTimeout(searchTimer.current);
						}}
						onCompositionEnd={(e) => {
							composing.current = false;
							const value = e.currentTarget.value;
							searchTimer.current = setTimeout(() => {
								updateLocation(
									{ q: value.trim() || undefined, message: undefined },
									true,
								);
							}, 350);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.nativeEvent.isComposing) {
								if (searchTimer.current) clearTimeout(searchTimer.current);
								updateLocation(
									{ q: query.trim() || undefined, message: undefined },
									true,
								);
							}
						}}
						value={query}
						onChange={(e) => {
							const value = e.target.value;
							setQuery(value);
							if (searchTimer.current) clearTimeout(searchTimer.current);
							if (!composing.current)
								searchTimer.current = setTimeout(() => {
									updateLocation(
										{ q: value.trim() || undefined, message: undefined },
										true,
									);
								}, 350);
						}}
					/>
					{query && (
						<Button
							variant="ghost"
							size="icon"
							aria-label="검색 지우기"
							className="absolute right-0 top-0 size-9"
							onClick={() => {
								if (searchTimer.current) clearTimeout(searchTimer.current);
								setQuery("");
								updateLocation({ q: undefined, message: undefined });
							}}
						>
							<X className="size-3.5" />
						</Button>
					)}
				</div>
				<output
					aria-live="polite"
					className={cn(
						"text-xs text-muted-foreground",
						!syncLabel && "sr-only",
						syncFailed && "text-destructive",
					)}
				>
					<span className="hidden lg:inline">
						{syncLabel || syncDescription}
					</span>
					<span className="sr-only lg:hidden">
						{syncLabel || syncDescription}
					</span>
				</output>
				<Button
					variant="ghost"
					size="icon"
					aria-label={syncDescription}
					title={syncDescription}
					disabled={busy}
					onClick={() => void refresh()}
				>
					<RefreshCw className={cn("size-4", busy && "animate-spin")} />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					aria-label="메일 설정"
					onClick={() => setSettings(true)}
				>
					<Settings className="size-4" />
				</Button>
				<Button
					size="sm"
					aria-label="메일 쓰기"
					disabled={!status?.accounts.length}
					onClick={() => {
						setComposeOriginal(null);
						setCompose("new");
					}}
				>
					<Pencil className="size-4" />
					<span className="hidden sm:inline">메일 쓰기</span>
				</Button>
			</div>
			<div
				className={cn(
					"flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-1.5",
					selected && "hidden md:flex",
				)}
			>
				{(Object.keys(folderLabels) as MailFolder[]).map((f) => (
					<Button
						key={f}
						variant={folder === f ? "secondary" : "ghost"}
						size="sm"
						onClick={() => {
							updateLocation({ folder: f, message: undefined });
						}}
					>
						{folderLabels[f]}
					</Button>
				))}
			</div>
			{Object.entries(errors).map(([id, message]) => (
				<div
					key={id}
					role="alert"
					className="border-b bg-destructive/5 px-4 py-2 text-xs text-destructive"
				>
					{status?.accounts.find((a) => a.id === id)?.email}: {message}{" "}
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => void refresh()}
					>
						다시 시도
					</Button>
				</div>
			))}
			{error && (
				<div
					role="alert"
					className="border-b bg-destructive/5 px-4 py-2 text-sm text-destructive"
				>
					{error}
				</div>
			)}
			{noAccounts ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
					<div className="rounded-2xl bg-muted p-4">
						<Mail className="size-8 text-muted-foreground" />
					</div>
					<div>
						<h2 className="font-semibold">메일도 Orbit에서</h2>
						<p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
							Gmail, iCloud, 네이버 메일을 한곳에서 읽고 답장하세요.
						</p>
					</div>
					<div className="flex items-center gap-3">
						<Button onClick={() => setSettings(true)}>메일 계정 연결</Button>
						<a
							href="/mail?demo=1"
							className="text-sm text-muted-foreground underline underline-offset-4"
						>
							데모 둘러보기
						</a>
					</div>
				</div>
			) : (
				<div className="flex min-h-0 flex-1">
					<div
						className={cn(
							"flex w-full shrink-0 flex-col overflow-y-auto border-r md:w-80 lg:w-96",
							selected && "hidden md:flex",
						)}
					>
						{messages.length === 0 && busy ? (
							<output
								className="block space-y-5 p-4"
								aria-label="메일 목록 불러오는 중"
							>
								{[1, 2, 3, 4, 5].map((i) => (
									<div key={i} className="space-y-2">
										<Skeleton className="h-4 w-2/3" />
										<Skeleton className="h-3 w-full" />
										<Skeleton className="h-3 w-1/2" />
									</div>
								))}
							</output>
						) : (
							messages.length === 0 && (
								<p className="p-8 text-center text-sm text-muted-foreground">
									{busy
										? "메일을 불러오는 중…"
										: activeAccounts.length === 0
											? "표시할 메일 계정을 선택해 주세요."
											: search
												? "검색 결과가 없습니다."
												: "메일이 없습니다."}
								</p>
							)
						)}
						{rows.map((group) => {
							const m = group[0];
							const isSelected = group.some((entry) => entry.id === selected);
							const unread = group.some((entry) => entry.unread);
							return (
								<button
									key={m.id}
									type="button"
									aria-current={isSelected ? "true" : undefined}
									className={cn(
										"w-full border-b px-4 py-3.5 text-left transition-colors hover:bg-muted/50",
										isSelected && "bg-accent",
										unread && "bg-primary/[0.025]",
									)}
									onClick={() => selectMessage(m.id)}
								>
									<div className="flex items-center gap-2">
										<span
											className={cn(
												"min-w-0 flex-1 truncate text-sm",
												unread ? "font-semibold" : "font-medium",
											)}
										>
											{m.from.map((a) => a.name || a.address).join(", ") ||
												"보낸 사람 없음"}
										</span>
										{unread && (
											<span
												className="size-1.5 shrink-0 rounded-full bg-primary"
												title="읽지 않음"
											/>
										)}
										<span className="shrink-0 text-[11px] text-muted-foreground">
											{new Date(m.date).toLocaleDateString("ko-KR", {
												month: "numeric",
												day: "numeric",
											})}
										</span>
									</div>
									<p
										className={cn(
											"mt-1 truncate text-sm",
											unread ? "font-medium" : "text-foreground/85",
										)}
									>
										{m.subject}
										{group.length > 1 && (
											<span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
												{group.length}
											</span>
										)}
									</p>
									{m.snippet && (
										<p className="mt-1 truncate text-xs text-muted-foreground">
											{m.snippet}
										</p>
									)}
									<div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
										<span className="truncate">
											{(() => {
												const a = status?.accounts.find(
													(entry) => entry.id === m.accountId,
												);
												return a
													? matchingAddresses(m, a).join(", ") ||
															`${a.email} · 수신 주소 미확인`
													: "";
											})()}
										</span>
										{m.hasAttachments && <Paperclip className="size-3" />}
									</div>
								</button>
							);
						})}
						{Object.values(cursors).some(Boolean) && (
							<Button
								variant="ghost"
								disabled={busy}
								className="m-3"
								onClick={() => void refresh(true, true)}
							>
								이전 메일 더 보기
							</Button>
						)}
					</div>
					<div
						className={cn(
							"flex min-w-0 flex-1 flex-col",
							!selected && "hidden md:flex",
						)}
					>
						{selected && (
							<div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2">
								<Button
									variant="ghost"
									size="icon"
									aria-label="메일 목록으로"
									className="md:hidden"
									onClick={closeMessage}
								>
									<ArrowLeft className="size-4" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={!detail || mutating}
									onClick={() => {
										setComposeOriginal(null);
										setCompose("reply");
									}}
								>
									<Reply className="size-4" />
									답장
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={!detail || mutating}
									aria-label="전체 답장"
									onClick={() => {
										setComposeOriginal(null);
										setCompose("all");
									}}
								>
									<ReplyAll className="size-4" />
									<span className="hidden sm:inline">전체 답장</span>
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={!detail || mutating}
									aria-label="전달"
									onClick={() => {
										setComposeOriginal(null);
										setCompose("forward");
									}}
								>
									<Forward className="size-4" />
									<span className="hidden sm:inline">전달</span>
								</Button>
								<div className="flex-1" />
								<Button
									variant="ghost"
									size="icon"
									aria-label={
										detail?.unread ? "읽음으로 표시" : "읽지 않음으로 표시"
									}
									disabled={!detail || mutating}
									onClick={() =>
										void action(detail?.unread ? "read" : "unread")
									}
								>
									<MailOpen className="size-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									aria-label="메일 보관"
									disabled={!detail || mutating || detail.folder === "archive"}
									onClick={() => void action("archive")}
								>
									<Archive className="size-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									aria-label="휴지통으로 이동"
									disabled={!detail || mutating || detail.folder === "trash"}
									onClick={() => void action("trash")}
								>
									<Trash2 className="size-4" />
								</Button>
							</div>
						)}
						{selected && (threadLoading || threadError || threadIncomplete) && (
							<div className="shrink-0 border-b bg-muted/15 p-3">
								<div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
									<MessagesSquare className="size-3.5" />
									대화 {thread.length > 1 ? `· ${thread.length}개 메일` : ""}
									{threadLoading && (
										<span className="flex items-center gap-1">
											<RefreshCw className="size-3 animate-spin" />
											이전 대화 확인 중…
										</span>
									)}
								</div>

								{threadError ? (
									<p className="text-xs text-destructive">
										이전 대화를 모두 확인하지 못했습니다. {threadError}
									</p>
								) : threadIncomplete ? (
									<p className="text-xs text-muted-foreground">
										불러온 메일 범위의 대화입니다. 이전 메일이 더 있을 수
										있습니다.
									</p>
								) : null}
							</div>
						)}
						{activeThread.length > 1 ? (
							<section
								key={selected}
								className="min-h-0 flex-1 overflow-y-auto bg-muted/25"
								aria-label="대화 전체"
							>
								<div className="border-b bg-background px-5 py-4">
									<h2 className="text-lg font-semibold">
										{activeThread[0].subject.replace(
											/^(?:(?:re|fw|fwd):\s*)+/i,
											"",
										)}
									</h2>
									<p className="mt-1 text-xs text-muted-foreground">
										오래된 메일부터 · {activeThread.length}개 메일
									</p>
								</div>
								<div className="mx-auto max-w-5xl space-y-6 px-3 py-5 sm:px-6 sm:py-6">
									{activeThread.map((m) => (
										<MailThreadMessage
											onRead={markThreadRead}
											key={m.id}
											message={m}
											accountEmails={
												status?.accounts
													.filter((a) => a.id === m.accountId)
													.flatMap(accountAddresses) || []
											}
											api={api}
											demo={demo}
											cache={detailCache.current}
											remoteImages={remoteImages}
											primary={m.id === selected}
											primaryDetail={m.id === selected ? detail : null}
											primaryError={m.id === selected ? detailError : ""}
											onRetryPrimary={() => setDetailRetry((v) => v + 1)}
											onToggleImages={() => setRemoteImages((v) => !v)}
											onCompose={(original, mode) => {
												setComposeOriginal(original);
												setCompose(mode);
											}}
										/>
									))}
								</div>
							</section>
						) : reading ? (
							<div className="space-y-5 p-5">
								<h2 className="text-lg font-semibold">
									{selectedSummary?.subject}
								</h2>
								<p className="text-sm text-muted-foreground">
									{selectedSummary?.from
										.map((a) => a.name || a.address)
										.join(", ")}
								</p>
								<output className="flex items-center gap-2 text-xs text-muted-foreground">
									<RefreshCw className="size-3 animate-spin" />
									본문을 불러오는 중…
								</output>
								<Skeleton className="h-4 w-4/5" />
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-2/3" />
							</div>
						) : detailError ? (
							<div className="p-8">
								<p role="alert" className="text-sm text-destructive">
									{detailError}
								</p>
								<Button
									variant="outline"
									className="mt-3"
									onClick={() => setDetailRetry((v) => v + 1)}
								>
									다시 열기
								</Button>
							</div>
						) : detail ? (
							<div className="min-h-0 flex-1 overflow-y-auto">
								<MailMessageContent
									detail={detail}
									demo={demo}
									remoteImages={remoteImages}
									onToggleImages={() => setRemoteImages((v) => !v)}
								/>
							</div>
						) : (
							<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
								메일을 선택하세요.
							</div>
						)}
					</div>
				</div>
			)}
			<MailSettings
				demo={demo}
				open={settings}
				onClose={() => setSettings(false)}
				onChanged={changed}
			/>
			{compose && status?.accounts.length && (
				<MailComposer
					accounts={status.accounts}
					api={api}
					demo={demo}
					defaultAccountId={
						selectedView?.accountId || activeAccounts[0]?.id || ""
					}
					defaultFrom={selectedView?.address || undefined}
					original={
						compose === "new"
							? undefined
							: composeOriginal || detail || undefined
					}
					mode={compose}
					onClose={() => setCompose(null)}
					onSent={() => {
						setCompose(null);
						setDetailRetry((v) => v + 1);
						void refresh();
					}}
				/>
			)}
		</div>
	);
}
