import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
import { changeOrbitLoginPassword, loginOrbit } from "#/lib/orbit/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/login")({
	component: LoginPage,
});

function LoginPage() {
	const login = useServerFn(loginOrbit);
	const changePassword = useServerFn(changeOrbitLoginPassword);
	const [changingPassword, setChangingPassword] = useState(false);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [notice, setNotice] = useState("");
	const [error, setError] = useState("");
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (submitting) return;
		if (changingPassword && newPassword !== confirmPassword) {
			setError("새 비밀번호가 서로 일치하지 않습니다.");
			return;
		}
		setSubmitting(true);
		setError("");
		setNotice("");
		try {
			if (changingPassword) {
				const result = await changePassword({
					data: { username, password, newPassword },
				});
				if (!result.ok) {
					setError(result.error);
					return;
				}
				setChangingPassword(false);
				setPassword("");
				setNewPassword("");
				setConfirmPassword("");
				setNotice("비밀번호를 변경했어요. 새 비밀번호로 로그인해 주세요.");
				return;
			}
			await login({ data: { username, password } });
			window.location.replace("/inbox");
		} catch {
			setError(
				changingPassword
					? "비밀번호를 변경하지 못했습니다. 입력 내용을 확인하고 잠시 후 다시 시도해 주세요."
					: "아이디 또는 비밀번호를 확인해 주세요. 반복해서 시도했다면 잠시 후 다시 시도해 주세요.",
			);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-muted/30 px-5 py-10">
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--background))_0%,transparent_58%)]" />
			<section className="orbit-card relative w-full max-w-sm p-7 shadow-lg shadow-foreground/5 sm:p-8">
				<div className="mb-7 flex items-center gap-3">
					<div className="flex size-11 items-center justify-center overflow-hidden rounded-xl bg-sidebar-primary">
						<img src="/orbit.png" alt="" width={44} height={44} />
					</div>
					<div>
						<h1 className="text-lg font-semibold tracking-tight">Orbit</h1>
						<p className="text-xs text-muted-foreground">Private workspace</p>
					</div>
				</div>

				<div className="mb-6">
					<div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
						<LockKeyhole className="size-4" />
					</div>
					<h2 className="text-xl font-semibold tracking-tight">
						{changingPassword ? "비밀번호 변경" : "다시 오신 것을 환영해요"}
					</h2>
					<p className="mt-1.5 text-sm leading-6 text-muted-foreground">
						{changingPassword
							? "현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다."
							: "내 계정으로 로그인하세요."}
					</p>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-1.5">
						<label htmlFor="username" className="text-sm font-medium">
							아이디
						</label>
						<Input
							id="username"
							name="username"
							required
							maxLength={128}
							autoComplete="username"
							autoCapitalize="none"
							autoFocus
							value={username}
							onChange={(event) => setUsername(event.target.value)}
							disabled={submitting}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="password" className="text-sm font-medium">
							{changingPassword ? "현재 비밀번호" : "비밀번호"}
						</label>
						<Input
							id="password"
							name="password"
							type="password"
							required
							maxLength={1_024}
							autoComplete="current-password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							disabled={submitting}
						/>
					</div>
					{changingPassword ? (
						<>
							<div className="space-y-1.5">
								<label htmlFor="new-password" className="text-sm font-medium">
									새 비밀번호
								</label>
								<Input
									id="new-password"
									name="newPassword"
									type="password"
									autoComplete="new-password"
									required
									minLength={12}
									maxLength={1_024}
									aria-describedby="password-help"
									value={newPassword}
									onChange={(event) => setNewPassword(event.target.value)}
									disabled={submitting}
								/>
								<p id="password-help" className="text-xs text-muted-foreground">
									12자 이상 입력해 주세요.
								</p>
							</div>
							<div className="space-y-1.5">
								<label
									htmlFor="confirm-password"
									className="text-sm font-medium"
								>
									새 비밀번호 확인
								</label>
								<Input
									id="confirm-password"
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
						</>
					) : null}
					{notice ? (
						<output className="block text-sm text-foreground">{notice}</output>
					) : null}
					{error ? (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					) : null}
					<Button type="submit" className="w-full" disabled={submitting}>
						{submitting
							? changingPassword
								? "변경 중..."
								: "여는 중..."
							: changingPassword
								? "비밀번호 변경"
								: "Orbit 열기"}
						{!submitting ? <ArrowRight className="size-4" /> : null}
					</Button>
				</form>
				<Button
					type="button"
					variant="link"
					className="mt-3 w-full text-muted-foreground"
					disabled={submitting}
					onClick={() => {
						setChangingPassword(!changingPassword);
						setPassword("");
						setNewPassword("");
						setConfirmPassword("");
						setError("");
						setNotice("");
					}}
				>
					{changingPassword ? "로그인으로 돌아가기" : "비밀번호 변경"}
				</Button>

				<p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
					{changingPassword
						? "변경하면 모든 기기에서 다시 로그인해야 합니다."
						: "로그인 상태는 이 기기에 안전하게 유지됩니다."}
				</p>
			</section>
		</main>
	);
}
