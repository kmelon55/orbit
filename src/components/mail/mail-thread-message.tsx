import { Forward, RefreshCw, Reply, ReplyAll } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { mailApi } from "#/lib/mail/client";
import type { MailDetail, MailMessage } from "#/lib/mail/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MailMessageContent } from "./mail-message-content";

export function MailThreadMessage({
	message,
	accountEmail,
	api,
	demo,
	cache,
	remoteImages,
	primary,
	primaryDetail,
	primaryError,
	onRetryPrimary,
	onToggleImages,
	onCompose,
	onRead,
}: {
	message: MailMessage;
	accountEmail?: string;
	api: typeof mailApi;
	demo: boolean;
	cache: Map<string, MailDetail>;
	remoteImages: boolean;
	primary: boolean;
	primaryDetail: MailDetail | null;
	primaryError: string;
	onRetryPrimary: () => void;
	onToggleImages: () => void;
	onCompose: (detail: MailDetail, mode: "reply" | "all" | "forward") => void;
	onRead: (id: string) => void;
}) {
	const article = useRef<HTMLElement>(null);
	const [nearby, setNearby] = useState(false);
	const [retry, setRetry] = useState(0);
	const [result, setResult] = useState<{
		key: string;
		detail?: MailDetail;
		error?: string;
	} | null>(null);
	const key = `${message.id}:${remoteImages}`;
	const detail = primary
		? primaryDetail
		: result?.key === key
			? result.detail
			: cache.get(key);
	const error = primary
		? primaryError
		: result?.key === key
			? result.error
			: undefined;
	useEffect(() => {
		// Bodies open automatically as the reader scrolls; long conversations do not flood the provider.
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setNearby(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "600px" },
		);
		if (article.current) observer.observe(article.current);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (primary || !nearby) return;
		if (retry) cache.delete(key);
		const controller = new AbortController();
		setResult({ key, detail: cache.get(key) });
		void (async () => {
			try {
				const loaded =
					cache.get(key) ||
					(await api<MailDetail>(
						`message?id=${encodeURIComponent(message.id)}&images=${remoteImages ? "1" : "0"}`,
						undefined,
						controller.signal,
					));
				if (controller.signal.aborted) return;
				cache.set(key, loaded);
				if (cache.size > 30) cache.delete(cache.keys().next().value as string);
				setResult({ key, detail: loaded });
				if (loaded.unread) {
					try {
						await api(
							"action",
							{ id: loaded.id, action: "read" },
							controller.signal,
						);
						if (!controller.signal.aborted) {
							const read = { ...loaded, unread: false };
							cache.set(key, read);
							setResult({ key, detail: read });
							onRead(loaded.id);
						}
					} catch {
						/* Keep the readable body when marking it read fails. */
					}
				}
			} catch (e) {
				if (!controller.signal.aborted)
					setResult({
						key,
						error:
							e instanceof Error ? e.message : "본문을 불러오지 못했습니다.",
					});
			}
		})();
		return () => controller.abort();
	}, [
		primary,
		nearby,
		key,
		message.id,
		remoteImages,
		api,
		cache,
		retry,
		onRead,
	]);
	const sent =
		message.folder === "sent" ||
		message.from.some(
			(a) => a.address.toLowerCase() === accountEmail?.toLowerCase(),
		);
	const sender = sent
		? "나"
		: message.from.map((a) => a.name || a.address).join(", ");
	const time = new Date(message.date);
	return (
		<article
			ref={article}
			aria-label={`${message.from.map((a) => a.name || a.address).join(", ")}의 메일`}
			className={cn(
				"flex min-w-0 flex-col",
				sent ? "items-end pl-6 sm:pl-16" : "items-start pr-6 sm:pr-16",
			)}
		>
			<div
				className={cn(
					"mb-2 flex max-w-full items-center gap-2 px-1",
					sent && "flex-row-reverse",
				)}
			>
				<span
					aria-hidden="true"
					className={cn(
						"flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
						sent
							? "bg-foreground text-background"
							: "bg-accent text-accent-foreground",
					)}
				>
					{sender.slice(0, 1)}
				</span>
				<span className="truncate text-xs font-medium">{sender}</span>
				<time
					dateTime={time.toISOString()}
					title={time.toLocaleString("ko-KR")}
					className="shrink-0 text-[10px] text-muted-foreground"
				>
					{time.toLocaleString("ko-KR", {
						month: "numeric",
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					})}
				</time>
			</div>
			<div
				className={cn(
					"w-full max-w-2xl overflow-hidden rounded-2xl border shadow-xs",
					sent
						? "rounded-tr-sm border-foreground/10 bg-accent/70"
						: "rounded-tl-sm border-border/70 bg-card",
				)}
			>
				{detail ? (
					<>
						<MailMessageContent
							detail={detail}
							demo={demo}
							remoteImages={remoteImages}
							onToggleImages={onToggleImages}
							showSubject={false}
							conversation
						/>
						<div className="flex flex-wrap gap-1 border-t border-border/40 px-2 py-1.5">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onCompose(detail, "reply")}
							>
								<Reply className="size-3.5" />
								답장
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onCompose(detail, "all")}
							>
								<ReplyAll className="size-3.5" />
								전체 답장
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onCompose(detail, "forward")}
							>
								<Forward className="size-3.5" />
								전달
							</Button>
						</div>
					</>
				) : (
					<div className="space-y-3 p-5">
						{error ? (
							<>
								<p role="alert" className="text-sm text-destructive">
									{error}
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										if (primary) onRetryPrimary();
										else {
											cache.delete(key);
											setRetry((v) => v + 1);
										}
									}}
								>
									본문 다시 불러오기
								</Button>
							</>
						) : (
							<>
								<output className="flex items-center gap-2 text-xs text-muted-foreground">
									<RefreshCw className="size-3 animate-spin" />
									본문을 불러오는 중…
								</output>
								<Skeleton className="h-4 w-4/5" />
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-2/3" />
							</>
						)}
					</div>
				)}
			</div>
		</article>
	);
}
