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

export const getOrbitAccount = createServerFn({ method: "GET" })
	.middleware([orbitAuthMiddleware])
	.handler(async () => {
		const { getOrbitAuthConfig } = await import("./auth.server");
		const config = getOrbitAuthConfig();
		return { username: config.enabled ? config.username : null };
	});

export const updateOrbitAccount = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) =>
		z
			.object({
				username: z.string().trim().min(1).max(128),
				currentPassword: z.string().min(1).max(1_024),
				newPassword: z.string().min(12).max(1_024).optional(),
			})
			.parse(input),
	)
	.handler(async ({ data }) => {
		const {
			assertLoginAllowed,
			assertSameOriginRequest,
			updateOrbitRequestAccount,
			clearLoginFailures,
			markOrbitResponsePrivate,
			recordLoginFailure,
			OrbitAccountChangeError,
		} = await import("./auth.server");
		assertSameOriginRequest();
		markOrbitResponsePrivate();
		assertLoginAllowed();
		recordLoginFailure();
		try {
			const account = await updateOrbitRequestAccount(data);
			clearLoginFailures();
			return { ok: true as const, username: account.username };
		} catch (error) {
			return {
				ok: false as const,
				error:
					error instanceof OrbitAccountChangeError
						? error.message
						: "계정 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			};
		}
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
