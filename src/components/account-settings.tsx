import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import { changeOrbitLoginPassword } from "#/lib/orbit/auth";
import { Button } from "@/components/ui/button";
import {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function AccountSettings() {
	const changePassword = useServerFn(changeOrbitLoginPassword);
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (submitting) return;
		setError("");
		setNotice("");
		if (newPassword !== confirmPassword) {
			setError("새 비밀번호가 서로 일치하지 않습니다.");
			return;
		}
		setSubmitting(true);
		try {
			const result = await changePassword({
				data: { currentPassword, newPassword },
			});
			if (!result.ok) {
				setError(result.error);
				return;
			}
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
			setNotice("비밀번호를 변경했어요.");
		} catch {
			setError(
				"비밀번호를 변경하지 못했습니다. 로그인 상태를 확인하고 잠시 후 다시 시도해 주세요.",
			);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<>
			<DialogHeader className="pr-10">
				<DialogTitle>계정</DialogTitle>
				<DialogDescription>로그인 비밀번호를 관리합니다.</DialogDescription>
			</DialogHeader>
			<form onSubmit={handleSubmit} className="mt-7 grid gap-4">
				<h2 className="text-sm font-medium">비밀번호 변경</h2>
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
						새 비밀번호
					</label>
					<Input
						id="account-new-password"
						name="newPassword"
						type="password"
						autoComplete="new-password"
						required
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
						12자 이상 입력해 주세요.
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
						required
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
					disabled={submitting}
				>
					{submitting ? "변경 중..." : "비밀번호 변경"}
				</Button>
			</form>
		</>
	);
}
