import { FilePenLine, Paperclip, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { mailApi } from "#/lib/mail/client";
import type { DraftSummary } from "#/lib/mail/drafts";
import type { MailAccount } from "#/lib/mail/types";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function MailDrafts({
	drafts,
	accounts,
	loading,
	error,
	api,
	onOpen,
	onChange,
	onRefresh,
}: {
	drafts: DraftSummary[];
	accounts: MailAccount[];
	loading: boolean;
	error: string;
	api: typeof mailApi;
	onOpen: (draft: DraftSummary) => void;
	onChange: (draft: DraftSummary | null, id: string) => void;
	onRefresh: () => Promise<void>;
}) {
	const { t, intlLocale, errorText } = useI18n();
	const [confirm, setConfirm] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState("");
	async function remove(draft: DraftSummary) {
		if (deleting) return;
		if (confirm !== draft.id) {
			setConfirm(draft.id);
			return;
		}
		setDeleting(draft.id);
		setDeleteError("");
		try {
			await api("draft", {
				id: draft.id,
				revision: draft.revision + 1,
				baseRevision: draft.revision,
				value: null,
			});
			onChange(null, draft.id);
			setConfirm(null);
		} catch (e) {
			setDeleteError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
			setConfirm(null);
			void onRefresh();
		} finally {
			setDeleting(null);
		}
	}
	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			{(error || deleteError) && (
				<div
					role="alert"
					className="flex items-center gap-2 border-b p-4 text-sm text-destructive"
				>
					{errorText(error || deleteError)}
					<Button variant="ghost" size="sm" onClick={() => void onRefresh()}>
						{t("다시 시도")}
					</Button>
				</div>
			)}
			{loading && !drafts.length ? (
				<output
					className="block space-y-6 p-5"
					aria-label={t("초안 불러오는 중")}
				>
					{[1, 2, 3].map((i) => (
						<div key={i} className="space-y-2">
							<Skeleton className="h-4 w-40" />
							<Skeleton className="h-3 w-2/3" />
						</div>
					))}
				</output>
			) : !drafts.length && !error ? (
				<div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 text-muted-foreground">
					<FilePenLine className="size-7" />
					<p className="text-sm">{t("저장된 초안이 없습니다.")}</p>
				</div>
			) : null}
			{drafts.map((draft) => (
				<div
					key={draft.id}
					className="group flex items-center border-b hover:bg-muted/40"
				>
					<button
						type="button"
						disabled={deleting === draft.id}
						onClick={() => onOpen(draft)}
						className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-4 text-left outline-none focus-visible:bg-accent sm:px-6"
					>
						<div className="flex w-full items-center gap-3">
							<span className="min-w-0 flex-1 truncate text-sm font-medium">
								{draft.to.join(", ") || t("받는 사람 없음")}
							</span>
							<time
								className="shrink-0 text-xs text-muted-foreground"
								dateTime={
									draft.updatedAt
										? new Date(draft.updatedAt).toISOString()
										: undefined
								}
							>
								{draft.updatedAt
									? new Date(draft.updatedAt).toLocaleString(intlLocale, {
											month: "numeric",
											day: "numeric",
											hour: "2-digit",
											minute: "2-digit",
										})
									: ""}
							</time>
						</div>
						<div className="flex w-full items-center gap-2">
							<span className="shrink-0 text-xs text-primary">
								{t(draft.forwardId ? "전달" : draft.replyId ? "답장" : "초안")}
							</span>
							<span className="truncate text-sm">
								{draft.subject || t("제목 없음")}
							</span>
						</div>
						{draft.snippet && (
							<p className="w-full truncate text-xs text-muted-foreground">
								{draft.snippet}
							</p>
						)}
						<div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
							<span className="truncate">
								{draft.from ||
									accounts.find((a) => a.id === draft.accountId)?.email}
							</span>
							{draft.attachmentCount > 0 && (
								<span className="flex items-center gap-1">
									<Paperclip className="size-3" />
									{draft.attachmentCount}
								</span>
							)}
						</div>
					</button>
					<div className="flex shrink-0 items-center pr-3">
						<Button
							variant="ghost"
							size={confirm === draft.id ? "sm" : "icon"}
							disabled={Boolean(deleting)}
							aria-label={t(confirm === draft.id ? "삭제 확인" : "초안 삭제")}
							onClick={() => void remove(draft)}
						>
							{confirm === draft.id ? (
								t("삭제 확인")
							) : (
								<Trash2 className="size-4 text-muted-foreground" />
							)}
						</Button>
						{confirm === draft.id && (
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("취소")}
								onClick={() => setConfirm(null)}
							>
								<X className="size-4" />
							</Button>
						)}
					</div>
				</div>
			))}
		</div>
	);
}
