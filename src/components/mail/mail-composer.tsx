import { Maximize2, Minimize2, Paperclip, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { mailApi } from "#/lib/mail/client";
import {
	type DraftSummary,
	hasDraftContent,
	type MailDraft,
	summarizeDraft,
} from "#/lib/mail/drafts";
import { accountAddresses, replyAddress } from "#/lib/mail/identities";
import {
	MAX_SEND_BYTES,
	type MailAccount,
	type MailDetail,
	replyRecipients,
	type SendMail,
	type SendResult,
} from "#/lib/mail/types";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Form = {
	accountId: string;
	from?: string;
	to: string;
	cc: string;
	bcc: string;
	subject: string;
	text: string;
	attachments: SendMail["attachments"];
	replyId?: string;
	forwardId?: string;
};
const split = (value: string) =>
	value
		.split(/[,;\n]/)
		.map((s) => s.trim())
		.filter(Boolean);
function payload(form: Form) {
	return {
		...form,
		to: split(form.to),
		cc: split(form.cc),
		bcc: split(form.bcc),
	};
}
export function MailComposer({
	accounts,
	api = mailApi,
	demo = false,
	defaultAccountId,
	defaultFrom,
	original,
	draftId: requestedDraftId,
	onDraftChange,
	mode,
	onClose,
	onSent,
}: {
	accounts: MailAccount[];
	api?: typeof mailApi;
	demo?: boolean;
	defaultAccountId?: string;
	defaultFrom?: string;
	original?: MailDetail;
	draftId?: string;
	onDraftChange: (draft: DraftSummary | null, id: string) => void;
	mode: "new" | "reply" | "all" | "forward";
	onClose: () => void;
	onSent: () => void;
}) {
	const { t, intlLocale, errorText } = useI18n();
	const [resumeId] = useState(requestedDraftId);
	const toInput = useRef<HTMLInputElement>(null);
	const bodyInput = useRef<HTMLTextAreaElement>(null);

	const first =
		accounts.find((a) => a.id === (original?.accountId || defaultAccountId)) ||
		accounts[0];
	const recipients =
		original && mode !== "forward"
			? replyRecipients(
					original,
					first.email,
					mode === "all",
					accounts.flatMap(accountAddresses),
				)
			: { to: [], cc: [] };
	const [form, setForm] = useState<Form>(() => ({
		accountId: first.id,
		from: replyAddress(
			first,
			original,
			first.id === defaultAccountId ? defaultFrom : undefined,
		),
		to: recipients.to.join(", "),
		cc: recipients.cc.join(", "),
		bcc: "",
		subject: original
			? `${mode === "forward" ? "Fwd: " : /^re:/i.test(original.subject) ? "" : "Re: "}${original.subject}`
			: "",
		text: original
			? `\n\n${mode === "forward" ? t("---------- 전달된 메일 ----------") : t("---------- 원본 메일 ----------")}\n${original.from.map((a) => a.address).join(", ")} · ${new Date(original.date).toLocaleString(intlLocale)}\n${original.text}`
			: "",
		attachments: [],
		forwardId: mode === "forward" ? original?.id : undefined,
		replyId: mode === "reply" || mode === "all" ? original?.id : undefined,
	}));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState("");
	const [ready, setReady] = useState(!resumeId);
	const [loadAttempt, setLoadAttempt] = useState(0);
	const [expanded, setExpanded] = useState(false);
	const [uncertain, setUncertain] = useState(false);
	const [showCc, setShowCc] = useState(Boolean(recipients.cc.length));
	useEffect(() => {
		if (!ready) return;
		if (resumeId || mode !== "new") {
			bodyInput.current?.focus();
			bodyInput.current?.setSelectionRange(0, 0);
		} else toInput.current?.focus();
	}, [ready, resumeId, mode]);
	const initialAccounts = useRef(accounts);
	const draftId = useRef(resumeId || crypto.randomUUID());
	const savedForm = useRef(form);
	const persisted = useRef(Boolean(resumeId));
	const operation = useRef(false);
	const changedRef = useRef(onDraftChange);
	changedRef.current = onDraftChange;
	const revision = useRef(0);
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	const dirty = useRef(false);
	const [discard, setDiscard] = useState(false);
	const latest = useRef(form);
	latest.current = form;
	useEffect(() => {
		if (!resumeId) return;
		void loadAttempt; // Explicit retry without remounting the editor.
		let active = true;
		setError("");
		void api<MailDraft | null>(`draft?id=${resumeId}`)
			.then((draft) => {
				if (!active) return;
				if (!draft) throw new Error("초안을 찾을 수 없습니다.");
				revision.current = draft.revision;
				const next: Form = {
					...draft.value,
					from:
						draft.value.from ||
						initialAccounts.current
							.find((a) => a.id === draft.value.accountId)
							?.email.toLowerCase(),
					to: draft.value.to.join(", "),
					cc: draft.value.cc.join(", "),
					bcc: draft.value.bcc.join(", "),
				};
				savedForm.current = next;
				setForm(next);
				setShowCc(Boolean(next.cc || next.bcc));
				setSaved("임시저장됨");
				setReady(true);
			})
			.catch((e) => {
				if (active) setError(e.message);
			});
		return () => {
			active = false;
		};
	}, [resumeId, api, loadAttempt]);
	const save = useCallback(
		(value: Form, force = false) => {
			const next = queue.current
				.catch(() => {})
				.then(async () => {
					if (
						latest.current !== value ||
						(savedForm.current === value && (persisted.current || !force))
					)
						return;
					const data = payload(value);
					if (!persisted.current && !hasDraftContent(data)) {
						savedForm.current = value;
						if (latest.current === value) dirty.current = false;
						return;
					}
					const result = await api<{ revision: number; updatedAt: number }>(
						"draft",
						{
							id: draftId.current,
							baseRevision: revision.current,
							revision: revision.current + 1,
							value: data,
						},
					);
					revision.current = result.revision;
					persisted.current = true;
					savedForm.current = value;
					if (latest.current === value) dirty.current = false;
					changedRef.current(
						summarizeDraft({ id: draftId.current, ...result, value: data }),
						draftId.current,
					);
				});
			queue.current = next;
			return next;
		},
		[api],
	);
	useEffect(() => {
		if (!ready || busy || uncertain || !dirty.current) return;
		const timer = setTimeout(() => {
			if (operation.current) return;
			setSaved("저장 중…");
			void save(form)
				.then(() => {
					if (latest.current === form) {
						setSaved(persisted.current ? "임시저장됨" : "");
						setError("");
					}
				})
				.catch((e) => {
					setSaved("저장 실패");
					setError(e.message);
				});
		}, 600);
		return () => clearTimeout(timer);
	}, [form, ready, busy, uncertain, save]);
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (dirty.current || operation.current) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, []);
	useBlocker({
		enableBeforeUnload: false,
		shouldBlockFn: async () => {
			if (operation.current) return true;
			if (!dirty.current) return false;
			operation.current = true;
			setBusy(true);
			try {
				await save(latest.current);
				return dirty.current;
			} catch (e) {
				setSaved("저장 실패");
				setError(
					e instanceof Error ? e.message : t("임시저장하지 못했습니다."),
				);
				return true;
			} finally {
				operation.current = false;
				setBusy(false);
			}
		},
	});
	async function removeSavedDraft() {
		await queue.current.catch(() => {});
		if (persisted.current) {
			await api("draft", {
				id: draftId.current,
				baseRevision: revision.current,
				revision: revision.current + 1,
				value: null,
			});
		}
		dirty.current = false;
		changedRef.current(null, draftId.current);
	}
	async function discardDraft() {
		if (operation.current || !ready) return;
		if (!discard && (dirty.current || persisted.current)) {
			setDiscard(true);
			return;
		}
		operation.current = true;
		setBusy(true);
		try {
			await removeSavedDraft();
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : t("삭제하지 못했습니다."));
		} finally {
			operation.current = false;
			setBusy(false);
		}
	}
	async function close() {
		if (operation.current) return;
		if (!ready || (!dirty.current && !busy)) {
			onClose();
			return;
		}
		operation.current = true;
		setBusy(true);
		setSaved("저장 중…");
		try {
			await save(latest.current);
			onClose();
		} catch (e) {
			setSaved("저장 실패");
			setError(e instanceof Error ? e.message : t("임시저장하지 못했습니다."));
		} finally {
			operation.current = false;
			setBusy(false);
		}
	}
	function change<K extends keyof Form>(key: K, value: Form[K]) {
		dirty.current = true;
		setDiscard(false);
		setForm((f) => ({ ...f, [key]: value }));
		setSaved("");
	}
	async function attach(files: FileList | null) {
		if (!files || operation.current) return;
		operation.current = true;
		setBusy(true);
		setError("");
		try {
			const existing = form.attachments.reduce(
				(sum, a) => sum + Math.floor((a.content.length * 3) / 4),
				0,
			);
			if (
				existing + Array.from(files).reduce((sum, f) => sum + f.size, 0) >
				MAX_SEND_BYTES
			)
				throw new Error(t("첨부파일 합계는 15MB 이하여야 합니다."));
			if (form.attachments.length + files.length > 15)
				throw new Error(t("최대 15개까지 첨부할 수 있습니다."));
			const added = await Promise.all(
				Array.from(files).map(
					(file) =>
						new Promise<{ name: string; content: string }>(
							(resolve, reject) => {
								const reader = new FileReader();
								reader.onerror = () =>
									reject(new Error(t("파일을 읽지 못했습니다.")));
								reader.onload = () =>
									resolve({
										name: file.name,
										content: String(reader.result).split(",")[1],
									});
								reader.readAsDataURL(file);
							},
						),
				),
			);
			change("attachments", [...form.attachments, ...added]);
		} catch (e) {
			setError(e instanceof Error ? e.message : t("첨부하지 못했습니다."));
		} finally {
			operation.current = false;
			setBusy(false);
		}
	}
	async function send() {
		if (operation.current || !ready || uncertain || !form.to.trim()) return;
		operation.current = true;
		setBusy(true);
		setError("");
		try {
			await save(latest.current, true);
			const result = await api<SendResult>("send", {
				...payload(form),
				requestId: draftId.current,
			});
			if (result.status === "uncertain") {
				setUncertain(true);
				setError(result.warning || t("발송 결과를 확인해 주세요."));
				return;
			}
			if (result.warning) toast.warning(result.warning);
			else toast.success(t("메일을 보냈습니다."));
			// Cleanup failure must never make a successful delivery look like a failed send.
			await removeSavedDraft().catch(() => {
				toast.warning(t("메일은 발송됐지만 초안 정리에 실패했습니다."));
			});
			dirty.current = false;
			onSent();
		} catch (e) {
			setError(e instanceof Error ? e.message : t("발송하지 못했습니다."));
		} finally {
			operation.current = false;
			setBusy(false);
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(v) => {
				if (!v) void close();
			}}
		>
			<DialogContent
				className={cn(
					"flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-3 overflow-hidden rounded-none p-4 duration-100 sm:h-[min(82dvh,850px)] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-3rem)] sm:max-w-4xl sm:rounded-2xl sm:p-5",
					expanded && "sm:h-[calc(100dvh-2rem)] sm:max-w-[calc(100vw-2rem)]",
				)}
				onInteractOutside={(event) => event.preventDefault()}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					if (!ready) return;
					if (resumeId || mode !== "new") bodyInput.current?.focus();
					else toInput.current?.focus();
				}}
			>
				<div className="flex shrink-0 items-center justify-between gap-3">
					<DialogHeader>
						<DialogTitle>
							{mode === "new"
								? t("메일 쓰기")
								: mode === "forward"
									? t("메일 전달")
									: mode === "all"
										? t("전체 답장")
										: t("답장")}
						</DialogTitle>
						<DialogDescription className="sr-only">
							{demo
								? t("데모 보낸 메일함에만 저장되며, 실제로 발송되지 않습니다.")
								: t("받는 사람과 내용을 작성하고 메일을 보내세요.")}
						</DialogDescription>
					</DialogHeader>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="icon"
							className="hidden sm:inline-flex"
							aria-label={t(expanded ? "작성창 축소" : "작성창 확장")}
							title={t(expanded ? "작성창 축소" : "작성창 확장")}
							onClick={() => setExpanded((v) => !v)}
						>
							{expanded ? (
								<Minimize2 className="size-4" />
							) : (
								<Maximize2 className="size-4" />
							)}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							disabled={busy}
							aria-label={t("저장하고 닫기")}
							title={t("저장하고 닫기")}
							onClick={() => void close()}
						>
							<X className="size-4" />
						</Button>
					</div>
				</div>
				{error && (
					<p
						role="alert"
						className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
					>
						{errorText(error)}
						{ready && saved === "저장 실패" && (
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={() => {
									setSaved("저장 중…");
									void save(latest.current)
										.then(() => {
											setSaved("임시저장됨");
											setError("");
										})
										.catch((e) => {
											setSaved("저장 실패");
											setError(e.message);
										});
								}}
							>
								{t("다시 시도")}
							</Button>
						)}
						{!ready && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setLoadAttempt((v) => v + 1)}
							>
								{t("다시 시도")}
							</Button>
						)}
					</p>
				)}
				<fieldset
					disabled={busy || !ready || uncertain}
					className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
				>
					<label
						htmlFor="mail-sender"
						className="flex items-center gap-3 text-sm"
					>
						<span className="w-14 shrink-0 whitespace-nowrap text-xs text-muted-foreground sm:w-20">
							{t("보내는 사람")}
						</span>
						<Select
							value={`${form.accountId}/${form.from || accounts.find((a) => a.id === form.accountId)?.email.toLowerCase()}`}
							onValueChange={(value) => {
								const slash = value.indexOf("/");
								dirty.current = true;
								setSaved("");
								setForm((previous) => ({
									...previous,
									accountId: value.slice(0, slash),
									from: value.slice(slash + 1),
								}));
							}}
						>
							<SelectTrigger
								id="mail-sender"
								aria-label={t("보내는 주소")}
								className="min-w-0 flex-1"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{accounts
									.filter(
										(a) =>
											!form.replyId ||
											a.id === (original?.accountId || form.accountId),
									)
									.flatMap((a) =>
										accountAddresses(a).map((address) => (
											<SelectItem
												key={`${a.id}/${address}`}
												value={`${a.id}/${address}`}
											>
												{address}
											</SelectItem>
										)),
									)}
							</SelectContent>
						</Select>
					</label>
					<label
						htmlFor="mail-mail-composer-1"
						className="flex items-center gap-3 text-sm"
					>
						<span className="w-14 shrink-0 whitespace-nowrap text-xs text-muted-foreground sm:w-20">
							{t("받는 사람")}
						</span>
						<Input
							id="mail-mail-composer-1"
							ref={toInput}
							aria-label={t("받는 사람")}
							value={form.to}
							onChange={(e) => change("to", e.target.value)}
							placeholder={t("메일 주소, 쉼표로 구분")}
						/>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setShowCc((v) => !v)}
						>
							{t("참조")}
						</Button>
					</label>
					{showCc && (
						<>
							<label
								htmlFor="mail-mail-composer-2"
								className="flex items-center gap-3 text-sm"
							>
								<span className="w-14 shrink-0 whitespace-nowrap text-xs text-muted-foreground sm:w-20">
									{t("참조")}
								</span>
								<Input
									id="mail-mail-composer-2"
									value={form.cc}
									onChange={(e) => change("cc", e.target.value)}
								/>
							</label>
							<label
								htmlFor="mail-mail-composer-3"
								className="flex items-center gap-3 text-sm"
							>
								<span className="w-14 shrink-0 whitespace-nowrap text-xs text-muted-foreground sm:w-20">
									{t("숨은 참조")}
								</span>
								<Input
									id="mail-mail-composer-3"
									value={form.bcc}
									onChange={(e) => change("bcc", e.target.value)}
								/>
							</label>
						</>
					)}
					<Input
						aria-label={t("메일 제목")}
						value={form.subject}
						onChange={(e) => change("subject", e.target.value)}
						placeholder={t("제목")}
					/>
					<Textarea
						ref={bodyInput}
						aria-label={t("메일 내용")}
						className="min-h-40 flex-1 resize-none field-sizing-fixed leading-relaxed"
						value={form.text}
						onChange={(e) => change("text", e.target.value)}
						placeholder={t("내용을 입력하세요")}
					/>
					{form.forwardId && (!original || original.attachments.length > 0) && (
						<p className="text-xs text-muted-foreground">
							{t("원본 첨부파일도 함께 전달됩니다.")}
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						{form.attachments.map((a, i) => (
							<span
								key={`${a.name}-${a.content.slice(-32)}`}
								className="flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs"
							>
								<span className="truncate">{a.name}</span>
								<button
									type="button"
									aria-label={t("{0} 첨부 제거", [a.name])}
									onClick={() =>
										change(
											"attachments",
											form.attachments.filter((_, index) => index !== i),
										)
									}
								>
									<X className="size-3" />
								</button>
							</span>
						))}
					</div>
				</fieldset>
				<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-3">
					<label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm">
						<Paperclip className="size-4" />
						<span className="hidden sm:inline">{t("파일 첨부")}</span>
						<input
							className="sr-only"
							aria-label={t("파일 첨부")}
							type="file"
							multiple
							disabled={busy || !ready || uncertain}
							onChange={(e) => {
								void attach(e.target.files);
								e.target.value = "";
							}}
						/>
					</label>
					<Button
						variant="ghost"
						size="sm"
						disabled={busy || !ready}
						onClick={() => void discardDraft()}
						aria-label={t(discard ? "삭제 확인" : "초안 삭제")}
					>
						<Trash2 className="size-4" />
						{discard ? (
							t("삭제 확인")
						) : (
							<span className="hidden sm:inline">{t("초안 삭제")}</span>
						)}
					</Button>
					<span
						className="order-last w-full text-right text-xs text-muted-foreground sm:order-none sm:w-auto"
						aria-live="polite"
					>
						{t(saved)}
					</span>
					<Button
						disabled={busy || !ready || uncertain || !form.to.trim()}
						onClick={() => void send()}
					>
						<Send className="size-4" />
						{busy ? t("처리 중…") : t("보내기")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

import { useBlocker } from "@tanstack/react-router";
