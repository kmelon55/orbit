import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const loginSchema = z.object({
	password: z.string().min(1).max(1_024),
	username: z.string().min(1).max(128),
});

export const orbitAuthMiddleware = createMiddleware({
	type: "function",
}).server(async ({ next }) => {
	const {
		assertSameOriginRequest,
		isOrbitRequestAuthenticated,
		markOrbitResponsePrivate,
	} = await import("./auth.server");
	assertSameOriginRequest();
	if (!isOrbitRequestAuthenticated()) {
		throw new Error("로그인이 필요합니다.");
	}
	markOrbitResponsePrivate();
	return next();
});

export const getOrbitAuthStatus = createServerFn({ method: "GET" }).handler(
	async () => {
		const {
			getOrbitAuthConfig,
			isOrbitRequestAuthenticated,
			markOrbitResponsePrivate,
		} = await import("./auth.server");
		const config = getOrbitAuthConfig();
		markOrbitResponsePrivate();
		return {
			authenticated: isOrbitRequestAuthenticated(),
			enabled: config.enabled,
		};
	},
);

export const loginOrbit = createServerFn({ method: "POST" })
	.validator((input: unknown) => loginSchema.parse(input))
	.handler(async ({ data }) => {
		const {
			assertLoginAllowed,
			assertSameOriginRequest,
			clearLoginFailures,
			getOrbitAuthConfig,
			issueOrbitSession,
			markOrbitResponsePrivate,
			orbitCredentialsMatch,
			recordLoginFailure,
		} = await import("./auth.server");
		assertSameOriginRequest();
		assertLoginAllowed();
		// Reserve the attempt before the asynchronous password hash check.
		recordLoginFailure();
		const config = getOrbitAuthConfig();
		markOrbitResponsePrivate();
		if (
			!config.enabled ||
			!(await orbitCredentialsMatch(data.username, data.password, config))
		) {
			throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
		}
		clearLoginFailures();
		issueOrbitSession(config);
		return { ok: true };
	});

export const changeOrbitLoginPassword = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) =>
		z
			.object({
				currentPassword: z.string().min(1).max(1_024),
				newPassword: z.string().min(12).max(1_024),
			})
			.parse(input),
	)
	.handler(async ({ data }) => {
		const {
			assertLoginAllowed,
			assertSameOriginRequest,
			changeOrbitRequestPassword,
			clearLoginFailures,
			markOrbitResponsePrivate,
			recordLoginFailure,
			OrbitPasswordChangeError,
		} = await import("./auth.server");
		assertSameOriginRequest();
		markOrbitResponsePrivate();
		assertLoginAllowed();
		recordLoginFailure();
		try {
			await changeOrbitRequestPassword(data.currentPassword, data.newPassword);
		} catch (error) {
			return {
				ok: false as const,
				error:
					error instanceof OrbitPasswordChangeError
						? error.message
						: "비밀번호를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			};
		}
		clearLoginFailures();
		return { ok: true as const };
	});

export const logoutOrbit = createServerFn({ method: "POST" }).handler(
	async () => {
		const {
			assertSameOriginRequest,
			clearOrbitSession,
			markOrbitResponsePrivate,
		} = await import("./auth.server");
		assertSameOriginRequest();
		clearOrbitSession();
		markOrbitResponsePrivate();
		return { ok: true };
	},
);
