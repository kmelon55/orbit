import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
import { loginOrbit } from "#/lib/orbit/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/login")({
	component: LoginPage,
});

function LoginPage() {
	const login = useServerFn(loginOrbit);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (submitting) return;
		setSubmitting(true);
		setError("");
		try {
			await login({ data: { username, password } });
			window.location.replace("/inbox");
		} catch {
			setError("아이디 또는 비밀번호를 확인해 주세요.");
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
						다시 오신 것을 환영해요
					</h2>
					<p className="mt-1.5 text-sm leading-6 text-muted-foreground">
						서버 환경변수에 설정한 계정으로 로그인하세요.
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
							비밀번호
						</label>
						<Input
							id="password"
							name="password"
							type="password"
							autoComplete="current-password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							disabled={submitting}
						/>
					</div>
					{error ? (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					) : null}
					<Button type="submit" className="w-full" disabled={submitting}>
						{submitting ? "여는 중..." : "Orbit 열기"}
						{!submitting ? <ArrowRight className="size-4" /> : null}
					</Button>
				</form>

				<p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
					로그인 상태는 이 기기에 안전하게 유지됩니다.
				</p>
			</section>
		</main>
	);
}
