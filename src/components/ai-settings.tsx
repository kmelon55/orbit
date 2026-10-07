import { CheckCircle2, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import {
	loadAiSettings,
	removeAiKey,
	saveAiKey,
} from "#/lib/orbit/ai-functions";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Status = Awaited<ReturnType<typeof loadAiSettings>>;

export function AiSettings() {
	const { t, errorText } = useI18n();

	const [status, setStatus] = useState<Status>();
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	useEffect(() => {
		let live = true;
		void loadAiSettings()
			.then((result) => {
				if (live) setStatus(result);
			})
			.catch(() => {
				if (live) setError("AI 설정을 불러오지 못했습니다.");
			});
		return () => {
			live = false;
		};
	}, []);

	async function save() {
		if (key.trim().length < 10 || busy) return;
		setBusy(true);
		setError("");
		setMessage("");
		try {
			setStatus(await saveAiKey({ data: { key: key.trim() } }));
			setKey("");
			setMessage(t("연결을 확인하고 키를 저장했습니다."));
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : t("키를 저장하지 못했습니다."),
			);
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		if (busy) return;
		setBusy(true);
		setError("");
		setMessage("");
		try {
			setStatus(await removeAiKey());
			setMessage(t("저장된 키를 삭제했습니다."));
		} catch {
			setError(t("키를 삭제하지 못했습니다."));
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<DialogHeader className="pr-10">
				<DialogTitle>AI</DialogTitle>
				<DialogDescription>
					{t(
						"Vercel AI Gateway 키를 연결하면 Orbit 자료에 질문할 수 있습니다.",
					)}
				</DialogDescription>
			</DialogHeader>
			<div className="mt-7 grid gap-5">
				<div className="flex items-center gap-2 rounded-xl border border-border/70 p-4 text-sm">
					{status?.configured ? (
						<CheckCircle2 className="size-4 text-emerald-600" />
					) : (
						<KeyRound className="size-4 text-muted-foreground" />
					)}
					<span>
						{!status
							? t("설정 확인 중…")
							: status.saved
								? t("Gateway 키가 저장되어 있습니다")
								: status.configured
									? t("환경 변수로 연결되어 있습니다")
									: t("Gateway 키가 없습니다")}
					</span>
				</div>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
					className="grid gap-2"
				>
					<label htmlFor="orbit-ai-key" className="text-sm font-medium">
						{t("Gateway API 키")}
					</label>
					<Input
						id="orbit-ai-key"
						type="password"
						autoComplete="off"
						value={key}
						onChange={(event) => setKey(event.target.value)}
						placeholder={status?.saved ? t("새 키로 교체") : t("API 키 입력")}
						className="h-10"
					/>
					<p className="text-xs leading-5 text-muted-foreground">
						{t(
							"저장할 때 모델 목록으로 키를 확인합니다. 키는 서버의 암호화된 저장소에 보관하고 다시 표시하지 않습니다.",
						)}
					</p>
					<div className="flex gap-2">
						<Button type="submit" disabled={busy || key.trim().length < 10}>
							{busy
								? t("확인 중…")
								: status?.saved
									? t("키 교체")
									: t("키 저장")}
						</Button>
						{status?.saved ? (
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={() => void remove()}
							>
								{t("키 삭제")}
							</Button>
						) : null}
					</div>
				</form>
				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{errorText(error)}
					</p>
				) : null}
				{message ? (
					<output className="text-sm text-muted-foreground">
						{t(message)}
					</output>
				) : null}
			</div>
		</>
	);
}
