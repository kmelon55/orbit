import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useEffect, useState } from "react";
import { getOrbitAccount, updateOrbitAccount } from "#/lib/orbit/auth";
import { Button } from "@/components/ui/button";
import {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function AccountSettings() {
	const loadAccount = useServerFn(getOrbitAccount);
	const updateAccount = useServerFn(updateOrbitAccount);
	const [username, setUsername] = useState("");
	const [savedUsername, setSavedUsername] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState("");
	const [loadVersion, setLoadVersion] = useState(0);
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: loadVersion retries a failed request on user action.
	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setLoadError("");
		void loadAccount()
			.then((account) => {
				if (cancelled) return;
				if (!account.username) {
					setLoadError("로그인 계정이 설정되어 있지 않습니다.");
					return;
				}
				setUsername(account.username);
				setSavedUsername(account.username);
			})
			.catch(() => {
				if (!cancelled) setLoadError("계정 정보를 불러오지 못했습니다.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [loadAccount, loadVersion]);

	const changed = username.trim() !== savedUsername || newPassword.length > 0;

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (submitting || loading || !savedUsername || !changed) return;
		setError("");
		setNotice("");
		if (newPassword !== confirmPassword) {
			setError("새 비밀번호가 서로 일치하지 않습니다.");
			return;
		}
		setSubmitting(true);
		try {
			const result = await updateAccount({
				data: {
					username,
					currentPassword,
					newPassword: newPassword || undefined,
				},
			});
			if (!result.ok) {
				setError(result.error);
				return;
			}
			setUsername(result.username);
			setSavedUsername(result.username);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
			setNotice("계정 정보를 변경했어요.");
		} catch {
			setError(
				"계정 정보를 변경하지 못했습니다. 로그인 상태를 확인하고 잠시 후 다시 시도해 주세요.",
			);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<>
			<DialogHeader className="pr-10">
				<DialogTitle>계정</DialogTitle>
				<DialogDescription>
					로그인할 때 사용할 이름과 비밀번호를 관리합니다.
				</DialogDescription>
			</DialogHeader>
			{loading ? (
				<p className="mt-7 text-sm text-muted-foreground">
					계정 정보를 불러오는 중...
				</p>
			) : loadError ? (
				<div className="mt-7 grid gap-3">
					<p role="alert" className="text-sm text-destructive">
						{loadError}
					</p>
					<Button
						variant="outline"
						className="justify-self-start"
						onClick={() => setLoadVersion((value) => value + 1)}
					>
						다시 시도
					</Button>
				</div>
			) : (
				<form onSubmit={handleSubmit} className="mt-7 grid gap-4">
					<div className="space-y-1.5">
						<label htmlFor="account-username" className="text-sm">
							계정 이름
						</label>
						<Input
							id="account-username"
							name="username"
							autoComplete="username"
							autoCapitalize="none"
							required
							maxLength={128}
							value={username}
							onChange={(event) => setUsername(event.target.value)}
							disabled={submitting}
							aria-describedby="account-username-help"
						/>
						<p
							id="account-username-help"
							className="text-xs text-muted-foreground"
						>
							다음 로그인부터 이 이름을 사용합니다.
						</p>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="account-current-password" className="text-sm">
							현재 비밀번호
						</label>
						<Input
							id="account-current-password"
							name="currentPassword"
							type="password"
							autoComplete="current-password"
							required
							maxLength={1_024}
							value={currentPassword}
							onChange={(event) => setCurrentPassword(event.target.value)}
							disabled={submitting}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="account-new-password" className="text-sm">
							새 비밀번호 <span className="text-muted-foreground">(선택)</span>
						</label>
						<Input
							id="account-new-password"
							name="newPassword"
							type="password"
							autoComplete="new-password"
							required={newPassword.length > 0 || confirmPassword.length > 0}
							minLength={12}
							maxLength={1_024}
							aria-describedby="account-password-help"
							value={newPassword}
							onChange={(event) => setNewPassword(event.target.value)}
							disabled={submitting}
						/>
						<p
							id="account-password-help"
							className="text-xs text-muted-foreground"
						>
							변경할 때만 12자 이상 입력해 주세요. 비워두면 현재 비밀번호를
							유지합니다.
						</p>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="account-confirm-password" className="text-sm">
							새 비밀번호 확인
						</label>
						<Input
							id="account-confirm-password"
							name="confirmPassword"
							type="password"
							autoComplete="new-password"
							required={newPassword.length > 0 || confirmPassword.length > 0}
							minLength={12}
							maxLength={1_024}
							value={confirmPassword}
							onChange={(event) => setConfirmPassword(event.target.value)}
							disabled={submitting}
						/>
					</div>
					<p className="text-xs leading-5 text-muted-foreground">
						이 기기의 로그인은 유지되며, 다른 기기에서는 다시 로그인해야 합니다.
					</p>
					{error ? (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					) : null}
					{notice ? <output className="text-sm">{notice}</output> : null}
					<Button
						type="submit"
						className="justify-self-start"
						disabled={submitting || !changed}
					>
						{submitting ? "저장 중..." : "변경사항 저장"}
					</Button>
				</form>
			)}
		</>
	);
}
