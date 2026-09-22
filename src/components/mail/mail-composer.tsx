import { Paperclip, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { mailApi } from "#/lib/mail/client";
import {
	MAX_SEND_BYTES,
	type MailAccount,
	type MailDetail,
	replyRecipients,
	type SendMail,
	type SendResult,
} from "#/lib/mail/types";
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

type Form = {
	accountId: string;
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
	original,
	mode,
	onClose,
	onSent,
}: {
	accounts: MailAccount[];
	api?: typeof mailApi;
	demo?: boolean;
	defaultAccountId?: string;
	original?: MailDetail;
	mode: "new" | "reply" | "all" | "forward";
	onClose: () => void;
	onSent: () => void;
}) {
	const first =
		accounts.find((a) => a.id === (original?.accountId || defaultAccountId)) ||
		accounts[0];
	const recipients =
		original && mode !== "forward"
			? replyRecipients(original, first.email, mode === "all")
			: { to: [], cc: [] };
	const [form, setForm] = useState<Form>({
		accountId: first.id,
		to: recipients.to.join(", "),
		cc: recipients.cc.join(", "),
		bcc: "",
		subject: original
			? `${mode === "forward" ? "Fwd: " : /^re:/i.test(original.subject) ? "" : "Re: "}${original.subject}`
			: "",
		text: original
			? `\n\n${mode === "forward" ? "---------- 전달된 메일 ----------" : "---------- 원본 메일 ----------"}\n${original.from.map((a) => a.address).join(", ")} · ${new Date(original.date).toLocaleString("ko-KR")}\n${original.text}`
			: "",
		attachments: [],
		forwardId: mode === "forward" ? original?.id : undefined,
		replyId: mode === "reply" || mode === "all" ? original?.id : undefined,
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState("");
	const [ready, setReady] = useState(false);
	const [uncertain, setUncertain] = useState(false);
	const [showCc, setShowCc] = useState(Boolean(recipients.cc.length));
	const draftId = useRef("");
	const revision = useRef(0);
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	const dirty = useRef(false);
	const [discard, setDiscard] = useState(false);
	const latest = useRef(form);
	latest.current = form;
	const draftKey = `orbit-mail-draft:${demo ? "demo:" : ""}${mode}:${original?.id || "new"}`;
	useEffect(() => {
		let active = true;
		draftId.current = localStorage.getItem(draftKey) || crypto.randomUUID();
		localStorage.setItem(draftKey, draftId.current);
		void api<{ revision: number; value: SendMail } | null>(
			`draft?id=${draftId.current}`,
		)
			.then((d) => {
				if (!active) return;
				if (d) {
					revision.current = d.revision;
					setForm({
						...d.value,
						to: d.value.to.join(", "),
						cc: d.value.cc.join(", "),
						bcc: d.value.bcc.join(", "),
					});
				}
				setReady(true);
			})
			.catch((e) => {
				if (active) {
					setError(e.message);
					setReady(true);
				}
			});
		return () => {
			active = false;
		};
	}, [draftKey, api]);
	const save = useCallback(
		(value: Form) => {
			const rev = ++revision.current;
			const id = draftId.current;
			const next = queue.current
				.catch(() => {})
				.then(() => api("draft", { id, revision: rev, value: payload(value) }));
			queue.current = next;
			return next;
		},
		[api],
	);
	useEffect(() => {
		if (!ready || busy || uncertain) return;
		const timer = setTimeout(() => {
			void save(form)
				.then(() => {
					if (latest.current === form) {
						dirty.current = false;
						setSaved("임시저장됨");
					}
				})
				.catch((e) => {
					setSaved("저장 실패");
					setError(e.message);
				});
		}, 800);
		return () => clearTimeout(timer);
	}, [form, ready, busy, uncertain, save]);
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (dirty.current) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, []);
	async function discardDraft() {
		if (!discard) {
			setDiscard(true);
			return;
		}
		setBusy(true);
		try {
			await queue.current.catch(() => {});
			await api("draft", {
				id: draftId.current,
				revision: ++revision.current,
				value: null,
			});
			localStorage.removeItem(draftKey);
			dirty.current = false;
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
		} finally {
			setBusy(false);
		}
	}
	async function close() {
		if (busy) return;
		try {
			await save(latest.current);
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "임시저장하지 못했습니다.");
		}
	}
	function change<K extends keyof Form>(key: K, value: Form[K]) {
		dirty.current = true;
		setForm((f) => ({ ...f, [key]: value }));
		setSaved("");
	}
	async function attach(files: FileList | null) {
		if (!files) return;
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
				throw new Error("첨부파일 합계는 15MB 이하여야 합니다.");
			if (form.attachments.length + files.length > 15)
				throw new Error("최대 15개까지 첨부할 수 있습니다.");
			const added = await Promise.all(
				Array.from(files).map(
					(file) =>
						new Promise<{ name: string; content: string }>(
							(resolve, reject) => {
								const reader = new FileReader();
								reader.onerror = () =>
									reject(new Error("파일을 읽지 못했습니다."));
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
			setError(e instanceof Error ? e.message : "첨부하지 못했습니다.");
		} finally {
			setBusy(false);
		}
	}
	async function send() {
		setBusy(true);
		setError("");
		try {
			await save(latest.current);
			const result = await api<SendResult>("send", {
				...payload(form),
				requestId: draftId.current,
			});
			if (result.status === "uncertain") {
				setUncertain(true);
				setError(result.warning || "발송 결과를 확인해 주세요.");
				return;
			}
			if (result.warning) toast.warning(result.warning);
			else toast.success("메일을 보냈습니다.");
			// Cleanup failure must never make a successful delivery look like a failed send.
			localStorage.removeItem(draftKey);
			await api("draft", {
				id: draftId.current,
				revision: ++revision.current,
				value: null,
			}).catch(() => {});
			onSent();
		} catch (e) {
			setError(e instanceof Error ? e.message : "발송하지 못했습니다.");
		} finally {
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
			<DialogContent className="flex max-h-[92svh] flex-col overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{mode === "new"
							? "메일 쓰기"
							: mode === "forward"
								? "메일 전달"
								: mode === "all"
									? "전체 답장"
									: "답장"}
					</DialogTitle>
					<DialogDescription className="sr-only">
						{demo
							? "데모 보낸 메일함에만 저장되며, 실제로 발송되지 않습니다."
							: "받는 사람과 내용을 작성하고 메일을 보내세요."}
					</DialogDescription>
				</DialogHeader>
				{error && (
					<p
						role="alert"
						className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
					>
						{error}
					</p>
				)}
				<fieldset
					disabled={busy || !ready || uncertain}
					className="min-h-0 space-y-3"
				>
					<label
						htmlFor="mail-sender"
						className="flex items-center gap-3 text-sm"
					>
						<span className="w-20 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
							보내는 사람
						</span>
						<Select
							value={form.accountId}
							disabled={Boolean(form.replyId)}
							onValueChange={(value) => change("accountId", value)}
						>
							<SelectTrigger
								id="mail-sender"
								aria-label="보내는 계정"
								className="min-w-0 flex-1"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{accounts.map((a) => (
									<SelectItem key={a.id} value={a.id}>
										{a.email}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</label>
					<label
						htmlFor="mail-mail-composer-1"
						className="flex items-center gap-3 text-sm"
					>
						<span className="w-20 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
							받는 사람
						</span>
						<Input
							id="mail-mail-composer-1"
							value={form.to}
							onChange={(e) => change("to", e.target.value)}
							placeholder="메일 주소, 쉼표로 구분"
						/>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setShowCc((v) => !v)}
						>
							참조
						</Button>
					</label>
					{showCc && (
						<>
							<label
								htmlFor="mail-mail-composer-2"
								className="flex items-center gap-3 text-sm"
							>
								<span className="w-20 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
									참조
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
								<span className="w-20 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
									숨은 참조
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
						aria-label="메일 제목"
						value={form.subject}
						onChange={(e) => change("subject", e.target.value)}
						placeholder="제목"
					/>
					<Textarea
						aria-label="메일 내용"
						className="min-h-56 resize-y"
						value={form.text}
						onChange={(e) => change("text", e.target.value)}
						placeholder="내용을 입력하세요"
					/>
					{mode === "forward" && original?.attachments.length !== 0 && (
						<p className="text-xs text-muted-foreground">
							원본 첨부파일도 함께 전달됩니다.
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
									aria-label={`${a.name} 첨부 제거`}
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
				<div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
					<label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm">
						<Paperclip className="size-4" />
						파일 첨부
						<input
							className="sr-only"
							aria-label="파일 첨부"
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
					>
						{discard ? "삭제 확인" : "초안 삭제"}
					</Button>
					<span
						className="order-last w-full text-right text-xs text-muted-foreground sm:order-none sm:w-auto"
						aria-live="polite"
					>
						{saved}
					</span>
					<Button
						disabled={busy || !ready || uncertain || !form.to.trim()}
						onClick={() => void send()}
					>
						<Send className="size-4" />
						{busy ? "처리 중…" : "보내기"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
