import {
	Archive,
	ArrowLeft,
	Download,
	Forward,
	Mail,
	MailOpen,
	Paperclip,
	Pencil,
	RefreshCw,
	Reply,
	ReplyAll,
	Search,
	Settings,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { mailApi } from "#/lib/mail/client";
import {
	canPreview,
	folderLabels,
	type MailDetail,
	type MailFolder,
	type MailMessage,
	type MailStatus,
} from "#/lib/mail/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MailComposer } from "./mail-composer";
import { MailSettings } from "./mail-settings";

type Page = {
	messages: MailMessage[];
	cursor: string | null;
	errors?: { account: string; error: string }[];
};
export function MailWorkspace({ initialMessage }: { initialMessage?: string }) {
	const [status, setStatus] = useState<MailStatus | null>(null);
	const [account, setAccount] = useState("");
	const [folder, setFolder] = useState<MailFolder>("inbox");
	const [messages, setMessages] = useState<MailMessage[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState(initialMessage || "");
	const [detail, setDetail] = useState<MailDetail | null>(null);
	const [settings, setSettings] = useState(false);
	const [compose, setCompose] = useState<
		"new" | "reply" | "all" | "forward" | null
	>(null);
	const [loading, setLoading] = useState(false);
	const [reading, setReading] = useState(false);
	const [mutating, setMutating] = useState(false);
	const [error, setError] = useState("");
	const [detailError, setDetailError] = useState("");
	const [remoteImages, setRemoteImages] = useState(false);
	const generation = useRef(0);
	const detailGeneration = useRef(0);
	const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const listParams = useCallback(
		() => new URLSearchParams({ account, folder, q: search }),
		[account, folder, search],
	);
	const refreshStatus = useCallback(async () => {
		const next = await mailApi<MailStatus>("status");
		setStatus(next);
		setAccount((current) =>
			current && !next.accounts.some((a) => a.id === current) ? "" : current,
		);
		return next;
	}, []);
	const refresh = useCallback(
		async (remote = true, more = false) => {
			const current = ++generation.current;
			setLoading(true);
			setError("");
			try {
				const params = listParams();
				if (remote) params.set("remote", "1");
				if (more && cursor) params.set("cursor", cursor);
				const page = await mailApi<Page>(`messages?${params}`);
				if (current !== generation.current) return;
				setMessages((prev) =>
					more
						? [
								...prev,
								...page.messages.filter(
									(m) => !prev.some((p) => p.id === m.id),
								),
							]
						: page.messages,
				);
				if (remote) setCursor(page.cursor);
				if (page.errors?.length)
					setError(
						page.errors.map((e) => `${e.account}: ${e.error}`).join(" · "),
					);
			} catch (e) {
				if (current === generation.current)
					setError(
						e instanceof Error ? e.message : "메일을 불러오지 못했습니다.",
					);
			} finally {
				if (current === generation.current) setLoading(false);
			}
		},
		[listParams, cursor],
	);
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	useEffect(() => {
		void refreshStatus().catch((e) => setError(e.message));
	}, [refreshStatus]);
	useEffect(() => {
		let active = true;
		generation.current++;
		setCursor(null);
		setMessages([]);
		const params = new URLSearchParams({ account, folder, q: search });
		void mailApi<Page>(`messages?${params}`)
			.then((page) => {
				if (active) {
					setMessages(page.messages);
					void refreshRef.current(true);
				}
			})
			.catch((e) => {
				if (active) setError(e.message);
			});
		return () => {
			active = false;
			generation.current++;
		};
	}, [account, folder, search]);
	useEffect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === "visible") {
				void refreshStatus().catch(() => {});
				if (folder === "inbox" && !search) void refreshRef.current(false);
			}
		}, 15_000);
		const visible = () => {
			if (document.visibilityState === "visible") {
				void refreshStatus().catch(() => {});
				void refreshRef.current(true);
			}
		};
		document.addEventListener("visibilitychange", visible);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", visible);
		};
	}, [folder, search, refreshStatus]);
	useEffect(() => {
		const current = ++detailGeneration.current;
		setDetail(null);
		setDetailError("");
		if (!selected) {
			setReading(false);
			return;
		}
		setReading(true);
		const controller = new AbortController();
		void mailApi<MailDetail>(
			`message?id=${encodeURIComponent(selected)}&images=${remoteImages ? "1" : "0"}`,
			undefined,
			controller.signal,
		)
			.then(async (d) => {
				if (current !== detailGeneration.current) return;
				setDetail(d);
				setReading(false);
				if (d.unread) {
					try {
						await mailApi("action", { id: d.id, action: "read" });
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
	}, [selected, remoteImages]);
	useEffect(
		() => () => {
			if (searchTimer.current) clearTimeout(searchTimer.current);
		},
		[],
	);
	function selectMessage(id: string) {
		setRemoteImages(false);
		setSelected(id);
		const url = new URL(window.location.href);
		url.searchParams.set("message", id);
		window.history.replaceState(null, "", url);
	}
	async function action(kind: "read" | "unread" | "trash" | "archive") {
		if (!detail) return;
		setMutating(true);
		try {
			await mailApi("action", { id: detail.id, action: kind });
			if (kind === "trash" || kind === "archive") {
				setSelected("");
				setMessages((prev) => prev.filter((m) => m.id !== detail.id));
			} else {
				setDetail({ ...detail, unread: kind === "unread" });
				setMessages((prev) =>
					prev.map((m) =>
						m.id === detail.id ? { ...m, unread: kind === "unread" } : m,
					),
				);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "처리하지 못했습니다.");
		} finally {
			setMutating(false);
		}
	}
	function changed() {
		void refreshStatus()
			.then(() => refreshRef.current(true))
			.catch((e) => setError(e.message));
	}
	const noAccounts = status?.accounts.length === 0;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5">
				<select
					aria-label="메일 계정"
					className="h-9 max-w-52 rounded-md border bg-background px-2 text-sm"
					value={account}
					onChange={(e) => {
						setAccount(e.target.value);
						setSelected("");
					}}
				>
					<option value="">모든 계정</option>
					{status?.accounts.map((a) => (
						<option key={a.id} value={a.id}>
							{a.email}
						</option>
					))}
				</select>
				<div className="relative min-w-28 flex-1">
					<Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
					<Input
						aria-label="메일 검색"
						className="pl-8"
						placeholder="메일 검색"
						value={query}
						onChange={(e) => {
							const value = e.target.value;
							setQuery(value);
							if (searchTimer.current) clearTimeout(searchTimer.current);
							searchTimer.current = setTimeout(() => setSearch(value), 500);
						}}
					/>
				</div>
				<Button
					variant="ghost"
					size="icon"
					aria-label="메일 새로고침"
					disabled={loading}
					onClick={() => void refresh()}
				>
					<RefreshCw className={cn("size-4", loading && "animate-spin")} />
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
					disabled={!status?.accounts.length}
					onClick={() => setCompose("new")}
				>
					<Pencil className="size-4" />
					<span className="hidden sm:inline">메일 쓰기</span>
				</Button>
			</div>
			<div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-1.5">
				{(Object.keys(folderLabels) as MailFolder[]).map((f) => (
					<Button
						key={f}
						variant={folder === f ? "secondary" : "ghost"}
						size="sm"
						onClick={() => {
							setFolder(f);
							setSelected("");
						}}
					>
						{folderLabels[f]}
					</Button>
				))}
			</div>
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
					<Button onClick={() => setSettings(true)}>메일 계정 연결</Button>
				</div>
			) : (
				<div className="flex min-h-0 flex-1">
					<div
						className={cn(
							"flex w-full shrink-0 flex-col overflow-y-auto border-r md:w-80 lg:w-96",
							selected && "hidden md:flex",
						)}
					>
						{messages.length === 0 && (
							<p className="p-8 text-center text-sm text-muted-foreground">
								{loading
									? "메일을 불러오는 중…"
									: search
										? "검색 결과가 없습니다."
										: "메일이 없습니다."}
							</p>
						)}
						{messages.map((m) => (
							<button
								key={m.id}
								type="button"
								aria-current={selected === m.id ? "true" : undefined}
								className={cn(
									"w-full border-b px-4 py-3.5 text-left transition-colors hover:bg-muted/50",
									selected === m.id && "bg-accent",
									m.unread && "bg-primary/[0.025]",
								)}
								onClick={() => selectMessage(m.id)}
							>
								<div className="flex items-center gap-2">
									<span
										className={cn(
											"min-w-0 flex-1 truncate text-sm",
											m.unread ? "font-semibold" : "font-medium",
										)}
									>
										{m.from.map((a) => a.name || a.address).join(", ") ||
											"보낸 사람 없음"}
									</span>
									{m.unread && (
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
										m.unread ? "font-medium" : "text-foreground/85",
									)}
								>
									{m.subject}
								</p>
								{m.snippet && (
									<p className="mt-1 truncate text-xs text-muted-foreground">
										{m.snippet}
									</p>
								)}
								<div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
									{!account && (
										<span className="truncate">
											{
												status?.accounts.find((a) => a.id === m.accountId)
													?.email
											}
										</span>
									)}
									{m.hasAttachments && <Paperclip className="size-3" />}
								</div>
							</button>
						))}
						{cursor && account && (
							<Button
								variant="ghost"
								disabled={loading}
								className="m-3"
								onClick={() => void refresh(true, true)}
							>
								이전 메일 더 보기
							</Button>
						)}
						{!account && messages.length > 0 && (
							<p className="p-3 text-center text-xs text-muted-foreground">
								계정별 최근 메일입니다. 이전 메일은 계정을 선택해 확인하세요.
							</p>
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
									onClick={() => setSelected("")}
								>
									<ArrowLeft className="size-4" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={!detail || mutating}
									onClick={() => setCompose("reply")}
								>
									<Reply className="size-4" />
									답장
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={!detail || mutating}
									onClick={() => setCompose("all")}
								>
									<ReplyAll className="size-4" />
									전체 답장
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={!detail || mutating}
									onClick={() => setCompose("forward")}
								>
									<Forward className="size-4" />
									전달
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
						{reading ? (
							<output className="p-8 text-sm text-muted-foreground">
								메일을 여는 중…
							</output>
						) : detailError ? (
							<p role="alert" className="p-8 text-sm text-destructive">
								{detailError}
							</p>
						) : detail ? (
							<div className="min-h-0 flex-1 overflow-y-auto">
								<div className="space-y-3 p-5">
									<h2 className="text-lg font-semibold leading-relaxed">
										{detail.subject}
									</h2>
									<div className="space-y-1 text-xs text-muted-foreground">
										<p className="break-all text-sm text-foreground">
											{detail.from
												.map((a) => `${a.name} <${a.address}>`)
												.join(", ")}
										</p>
										<p className="break-all">
											받는 사람: {detail.to.map((a) => a.address).join(", ")}
										</p>
										{detail.cc.length > 0 && (
											<p className="break-all">
												참조: {detail.cc.map((a) => a.address).join(", ")}
											</p>
										)}
										<p>{new Date(detail.date).toLocaleString("ko-KR")}</p>
									</div>
									{detail.attachments.length > 0 && (
										<div className="flex flex-wrap gap-2">
											{detail.attachments.map((a) => {
												const url = `/api/mail/attachment?message=${detail.id}&part=${a.id}`;
												return (
													<div
														key={a.id}
														className="flex max-w-full items-center gap-2 rounded-lg border p-2 text-xs"
													>
														<Paperclip className="size-3.5 shrink-0" />
														<a
															className="truncate underline-offset-2 hover:underline"
															href={
																canPreview(a.type) ? url : `${url}&download=1`
															}
															target="_blank"
															rel="noreferrer"
														>
															{a.name}
														</a>
														<span className="shrink-0 text-muted-foreground">
															{a.size > 1048576
																? `${(a.size / 1048576).toFixed(1)} MB`
																: `${Math.ceil(a.size / 1024)} KB`}
														</span>
														<a
															href={`${url}&download=1`}
															aria-label={`${a.name} 다운로드`}
														>
															<Download className="size-3.5" />
														</a>
													</div>
												);
											})}
										</div>
									)}
								</div>
								{detail.html ? (
									<>
										<div className="flex items-center justify-between border-y bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
											<span>
												{remoteImages
													? "외부 이미지 표시 중"
													: "외부 이미지 숨김"}
											</span>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setRemoteImages((v) => !v)}
											>
												{remoteImages ? "숨기기" : "이미지 표시"}
											</Button>
										</div>
										<iframe
											title="메일 본문"
											className="min-h-[55vh] w-full border-0 bg-white"
											sandbox="allow-popups allow-popups-to-escape-sandbox"
											referrerPolicy="no-referrer"
											srcDoc={detail.html}
										/>
									</>
								) : (
									<div className="whitespace-pre-wrap break-words px-5 pb-8 text-sm leading-7">
										{detail.text || "본문이 없는 메일입니다."}
									</div>
								)}
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
				open={settings}
				onClose={() => setSettings(false)}
				onChanged={changed}
			/>
			{compose && status?.accounts.length && (
				<MailComposer
					accounts={status.accounts}
					original={compose === "new" ? undefined : detail || undefined}
					mode={compose}
					onClose={() => setCompose(null)}
					onSent={() => {
						setCompose(null);
						void refresh();
					}}
				/>
			)}
		</div>
	);
}
