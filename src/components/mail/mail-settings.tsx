import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createMailClient } from "#/lib/mail/client";
import {
	assertPushSupport,
	pushRegistration,
	savePushSubscription,
	waitForPushTest,
} from "#/lib/mail/push-browser";
import type { MailStatus } from "#/lib/mail/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { MailIdentitiesSettings } from "./mail-identities-settings";

type Status = MailStatus & { publicUrl: string; gmailClientId: string };
export function MailSettings({
	open,
	onClose,
	onChanged,
	demo = false,
}: {
	open: boolean;
	onClose: () => void;
	onChanged: () => void;
	demo?: boolean;
}) {
	const mailApi = useMemo(() => createMailClient(demo), [demo]);
	const [status, setStatus] = useState<Status | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [provider, setProvider] = useState<"icloud" | "naver">("icloud");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [publicUrl, setPublicUrl] = useState("");
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");
	const [preview, setPreview] = useState(true);
	const [advanced, setAdvanced] = useState(false);
	const [subscribed, setSubscribed] = useState(false);
	const [notificationResult, setNotificationResult] = useState("");
	const [remove, setRemove] = useState<string | null>(null);
	const refresh = useCallback(async () => {
		const next = await mailApi<Status>("status");
		setStatus(next);
		setPublicUrl(
			next.publicUrl ||
				(!window.location.hostname.includes("localhost")
					? window.location.origin
					: ""),
		);
		setClientId(next.gmailClientId);
		setPreview(next.notificationPreview);
	}, [mailApi]);
	useEffect(() => {
		if (!open) return;
		void refresh().catch((e) => setError(e.message));
		setNotificationResult("");
		setError("");
		setSubscribed(false);
		if (
			!demo &&
			"serviceWorker" in navigator &&
			"PushManager" in window &&
			"Notification" in window
		)
			void navigator.serviceWorker
				.getRegistration("/")
				.then((r) => r?.pushManager.getSubscription())
				.then((s) =>
					setSubscribed(Boolean(s) && Notification.permission === "granted"),
				)
				.catch(() => {});
	}, [open, refresh, demo]);
	async function run(fn: () => Promise<void>) {
		setBusy(true);
		setError("");
		try {
			await fn();
			onChanged();
		} catch (e) {
			setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
		} finally {
			setBusy(false);
		}
	}
	async function connect() {
		await run(async () => {
			await mailApi("connect", { provider, email, password });
			setPassword("");
			setEmail("");
			await refresh();
			toast.success("메일 계정을 연결했습니다.");
			void mailApi("sync", {})
				.then(onChanged)
				.catch(() => {});
		});
	}
	async function notifications() {
		await run(async () => {
			assertPushSupport();
			setNotificationResult("");
			if (subscribed) {
				const registration = await navigator.serviceWorker.getRegistration("/");
				const sub = await registration?.pushManager.getSubscription();
				if (sub) {
					await mailApi("push/unsubscribe", { endpoint: sub.endpoint });
					await sub.unsubscribe();
				}
				setSubscribed(false);
				return;
			}
			if (!status?.publicKey)
				throw new Error(
					"아래 서버 연결 설정에서 HTTPS Orbit 주소를 먼저 저장해 주세요.",
				);
			const permission = await Notification.requestPermission();
			if (permission !== "granted")
				throw new Error(
					"브라우저 또는 기기 설정에서 Orbit 알림을 허용해 주세요.",
				);
			const registration = await pushRegistration();
			await savePushSubscription(registration, status.publicKey);
			setSubscribed(true);
			toast.success("이 기기의 메일 알림을 켰습니다.");
		});
	}
	async function testNotification(local = false) {
		await run(async () => {
			setNotificationResult("");
			assertPushSupport();
			if (Notification.permission !== "granted") {
				setSubscribed(false);
				throw new Error(
					"브라우저 설정에서 Orbit 알림을 허용한 뒤 이 기기 알림을 켜 주세요.",
				);
			}
			const registration = await pushRegistration();
			const testId = crypto.randomUUID();
			if (local) {
				await registration.showNotification("Orbit 알림 표시 확인", {
					body: "이 알림이 보이면 브라우저와 기기의 알림 표시가 동작합니다.",
					icon: "/icons/orbit-192.png",
					tag: `orbit-display-test-${testId}`,
					data: { url: "/mail" },
				});
				setNotificationResult(
					"브라우저에 표시를 요청했습니다. 알림이 보이지 않으면 Zen/Firefox의 사이트 알림 권한, 시스템 알림 설정과 집중 모드를 확인해 주세요.",
				);
				return;
			}
			if (!status?.publicKey)
				throw new Error(
					"서버 연결 설정에서 HTTPS Orbit 주소를 먼저 저장해 주세요.",
				);
			const sub = await savePushSubscription(registration, status.publicKey);
			const receipt = waitForPushTest(navigator.serviceWorker, testId);
			try {
				setNotificationResult(
					"테스트 알림을 보내고 이 브라우저의 수신을 확인하고 있습니다…",
				);
				await mailApi("push/test", { endpoint: sub.endpoint, testId });
				const result = await receipt.result;
				if (!result) {
					setNotificationResult(
						"푸시 서버에 전송했지만 이 브라우저의 수신은 아직 확인되지 않았습니다. ‘알림 표시 확인’으로 표시 설정을 확인하거나, 이 기기 알림을 껐다가 다시 켜 주세요.",
					);
				} else if (!result.displayed) {
					throw new Error(
						"테스트 알림은 수신했지만 브라우저가 표시하지 못했습니다. 사이트 알림 권한과 시스템 알림 설정을 확인해 주세요.",
					);
				} else {
					setNotificationResult(
						"이 브라우저가 테스트 알림을 수신하고 표시 요청을 완료했습니다. 배너가 보이지 않으면 시스템 알림 설정과 집중 모드를 확인해 주세요.",
					);
				}
			} catch (error) {
				setNotificationResult("");
				throw error;
			} finally {
				receipt.cancel();
			}
		});
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v && !busy) {
					setPassword("");
					setClientSecret("");
					onClose();
				}
			}}
		>
			<DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<div className="flex items-center justify-between">
						<DialogTitle>메일 설정</DialogTitle>
						<Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
							닫기
						</Button>
					</div>
					<DialogDescription>
						{demo
							? "데모 계정의 도메인·발신 주소를 관리하세요."
							: "계정을 연결하고 이 기기의 알림을 관리하세요."}
					</DialogDescription>
				</DialogHeader>
				{error && (
					<p
						role="alert"
						className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
					>
						{error}
					</p>
				)}
				<div className="space-y-3">
					{status?.accounts.map((a) => (
						<div key={a.id} className="rounded-lg border p-3 text-sm">
							<div className="flex items-center justify-between gap-2">
								<div className="min-w-0">
									<p className="truncate font-medium">{a.email}</p>
									<p className="text-xs text-muted-foreground">
										{a.provider} ·{" "}
										{a.error ||
											(a.lastSync
												? `최근 동기화 ${new Date(a.lastSync).toLocaleTimeString("ko-KR")}`
												: "첫 동기화 대기")}
									</p>
								</div>
								<Button
									size="sm"
									variant="ghost"
									disabled={busy || demo}
									onClick={() => setRemove(a.id)}
								>
									연결 해제
								</Button>
							</div>
							{remove === a.id && (
								<div className="mt-2 space-y-2">
									<p>
										Orbit의 연결과 캐시를 제거합니다. 원본 메일은 유지됩니다.
									</p>
									<Button
										size="sm"
										variant="destructive"
										disabled={busy}
										onClick={() =>
											void run(async () => {
												await mailApi("account", { id: a.id, remove: true });
												setRemove(null);
												await refresh();
											})
										}
									>
										연결 해제 확인
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setRemove(null)}
									>
										취소
									</Button>
								</div>
							)}
							<label
								htmlFor={`mail-notifications-${a.id}`}
								className="mt-2 flex items-center gap-2"
							>
								<Checkbox
									id={`mail-notifications-${a.id}`}
									checked={a.notifications}
									disabled={busy || demo}
									onCheckedChange={(checked) =>
										void run(async () => {
											await mailApi("account", {
												id: a.id,
												notifications: checked === true,
											});
											await refresh();
										})
									}
								/>
								이 계정의 새 메일 알림
							</label>
							{(status.blockedSenders || []).some(
								(rule) => rule.accountId === a.id,
							) && (
								<div className="mt-3 space-y-1 border-t pt-3">
									<p className="text-xs text-muted-foreground">
										차단한 발신자 · Orbit 동기화 시 스팸함으로 이동
									</p>
									{(status.blockedSenders || [])
										.filter((rule) => rule.accountId === a.id)
										.map((rule) => (
											<div
												key={rule.address}
												className="flex items-center gap-2"
											>
												<span
													className="min-w-0 flex-1 truncate"
													title={rule.address}
												>
													{rule.address}
												</span>
												<Button
													size="sm"
													variant="ghost"
													disabled={busy}
													onClick={() =>
														void run(async () => {
															await mailApi("unblock", rule);
															await refresh();
														})
													}
												>
													차단 해제
												</Button>
											</div>
										))}
								</div>
							)}
							{a.provider === "icloud" && (
								<MailIdentitiesSettings
									key={`${a.id}:${JSON.stringify(a.aliases)}:${a.defaultFrom}`}
									account={a}
									busy={busy}
									onSave={(aliases, defaultFrom) =>
										run(async () => {
											await mailApi("account", {
												id: a.id,
												aliases,
												defaultFrom,
											});
											await refresh();
											toast.success("메일 주소를 저장했습니다.");
										})
									}
								/>
							)}
						</div>
					))}
				</div>
				<section hidden={demo} className="space-y-3 border-t pt-4">
					<h3 className="text-sm font-medium">계정 추가</h3>
					<Button
						variant="outline"
						className="w-full"
						disabled={busy || !status?.gmailConfigured}
						onClick={() =>
							void run(async () => {
								const r = await mailApi<{ url: string }>("oauth/start", {});
								window.location.assign(r.url);
							})
						}
					>
						Google로 Gmail 연결
					</Button>
					{!status?.gmailConfigured && (
						<p className="text-xs text-muted-foreground">
							먼저 아래 서버 연결 설정에서 Google OAuth 앱을 등록해 주세요.
						</p>
					)}
					<form
						className="space-y-3"
						onSubmit={(e) => {
							e.preventDefault();
							void connect();
						}}
					>
						<label htmlFor="mail-provider" className="block space-y-1 text-sm">
							<span>메일 서비스</span>
							<Select
								value={provider}
								onValueChange={(value) => setProvider(value as typeof provider)}
							>
								<SelectTrigger
									id="mail-provider"
									aria-label="메일 서비스"
									className="w-full"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="icloud">iCloud</SelectItem>
									<SelectItem value="naver">네이버</SelectItem>
								</SelectContent>
							</Select>
						</label>
						<label
							htmlFor="mail-mail-settings-1"
							className="block space-y-1 text-sm"
						>
							<span>메일 주소</span>
							<Input
								id="mail-mail-settings-1"
								type="email"
								required
								autoComplete="username"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder={
									provider === "icloud" ? "name@icloud.com" : "name@naver.com"
								}
							/>
						</label>
						<label
							htmlFor="mail-mail-settings-2"
							className="block space-y-1 text-sm"
						>
							<span>앱 비밀번호</span>
							<Input
								id="mail-mail-settings-2"
								type="password"
								required
								autoComplete="new-password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
						</label>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{provider === "icloud" ? (
								<>
									Apple 계정에서 발급한 앱 전용 비밀번호를 입력하세요.{" "}
									<a
										className="underline"
										href="https://support.apple.com/102654"
										target="_blank"
										rel="noreferrer"
									>
										발급 방법
									</a>
								</>
							) : (
								<>
									네이버에서 2단계 인증과 IMAP 사용을 켜고 애플리케이션
									비밀번호를 발급하세요.{" "}
									<a
										className="underline"
										href="https://help.naver.com/service/30029/contents/21344?osType=COMMONOS"
										target="_blank"
										rel="noreferrer"
									>
										설정 방법
									</a>
								</>
							)}
						</p>
						<Button
							type="submit"
							disabled={busy || !email || !password}
							className="w-full"
						>
							{busy ? "연결 중…" : "계정 연결"}
						</Button>
					</form>
				</section>
				<section hidden={demo} className="space-y-3 border-t pt-4">
					<h3 className="text-sm font-medium">이 기기의 알림</h3>
					<p className="text-xs text-muted-foreground">
						아이폰은 홈 화면에 Orbit을 추가한 뒤 알림을 켜세요. 기기별로 한 번씩
						설정합니다.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => void notifications()}
						>
							{subscribed ? "이 기기 알림 끄기" : "이 기기 알림 켜기"}
						</Button>
						{subscribed && (
							<>
								<Button
									variant="ghost"
									disabled={busy}
									onClick={() => void testNotification()}
								>
									테스트 알림
								</Button>
								<Button
									variant="ghost"
									disabled={busy}
									onClick={() => void testNotification(true)}
								>
									알림 표시 확인
								</Button>
							</>
						)}
					</div>
					{notificationResult && (
						<output className="block text-xs leading-relaxed text-muted-foreground">
							{notificationResult}
						</output>
					)}
					<label
						htmlFor="mail-notification-preview"
						className="flex items-center gap-2 text-sm"
					>
						<Checkbox
							id="mail-notification-preview"
							checked={preview}
							disabled={busy}
							onCheckedChange={(checked) => setPreview(checked === true)}
						/>
						보낸 사람과 제목 표시
					</label>
				</section>
				<section hidden={demo} className="space-y-3 border-t pt-4">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setAdvanced((v) => !v)}
						aria-expanded={advanced}
					>
						서버 연결 설정 {advanced ? "접기" : "열기"}
					</Button>
					{advanced && (
						<div className="space-y-3">
							<label
								htmlFor="mail-mail-settings-3"
								className="block space-y-1 text-sm"
							>
								<span>Orbit HTTPS 주소</span>
								<Input
									id="mail-mail-settings-3"
									type="url"
									value={publicUrl}
									onChange={(e) => setPublicUrl(e.target.value)}
									placeholder="https://orbit.example.com"
								/>
							</label>
							<p className="text-xs text-muted-foreground">
								Google Cloud에서 Gmail API를 켜고 웹 애플리케이션 OAuth
								클라이언트를 만드세요. 개인용 테스트 앱이면 본인 Gmail을 테스트
								사용자에 추가하세요. 테스트 상태에서는 7일 후 재연결이 필요할 수
								있습니다.
							</p>
							<label
								htmlFor="mail-mail-settings-4"
								className="block space-y-1 text-sm"
							>
								<span>승인된 리디렉션 URI</span>
								<Input
									id="mail-mail-settings-4"
									readOnly
									value={`${publicUrl.replace(/\/$/, "")}/api/mail/oauth/callback`}
								/>
							</label>
							<label
								htmlFor="mail-mail-settings-5"
								className="block space-y-1 text-sm"
							>
								<span>Google 클라이언트 ID</span>
								<Input
									id="mail-mail-settings-5"
									value={clientId}
									onChange={(e) => setClientId(e.target.value)}
									autoComplete="off"
								/>
							</label>
							<label
								htmlFor="mail-mail-settings-6"
								className="block space-y-1 text-sm"
							>
								<span>Google 클라이언트 보안 비밀번호</span>
								<Input
									id="mail-mail-settings-6"
									type="password"
									value={clientSecret}
									onChange={(e) => setClientSecret(e.target.value)}
									placeholder={
										status?.gmailConfigured
											? "설정됨 · 변경할 때만 입력"
											: "클라이언트 보안 비밀번호"
									}
									autoComplete="new-password"
								/>
							</label>
						</div>
					)}
					<Button
						disabled={busy || !publicUrl}
						variant="outline"
						onClick={() =>
							void run(async () => {
								await mailApi("settings", {
									publicUrl,
									gmailClientId: clientId,
									gmailClientSecret: clientSecret,
									notificationPreview: preview,
								});
								setClientSecret("");
								await refresh();
								toast.success("메일 설정을 저장했습니다.");
							})
						}
					>
						설정 저장
					</Button>
				</section>
			</DialogContent>
		</Dialog>
	);
}
