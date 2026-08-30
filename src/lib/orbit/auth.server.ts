import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import {
	deleteCookie,
	getCookie,
	getRequest,
	getRequestHeader,
	getRequestProtocol,
	setCookie,
	setResponseHeader,
} from "@tanstack/react-start/server";

const SESSION_COOKIE = "orbit_session";
const DEFAULT_SESSION_DAYS = 180;
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

type AuthEnvironment = Record<string, string | undefined>;

export type OrbitAuthConfig =
	| { enabled: false }
	| {
			enabled: true;
			username: string;
			password: string;
			sessionDays: number;
	  };

type SessionPayload = {
	exp: number;
	nonce: string;
	sub: string;
};

type LoginAttempt = {
	count: number;
	resetAt: number;
};

const loginAttempts = new Map<string, LoginAttempt>();

function sessionKey(config: Extract<OrbitAuthConfig, { enabled: true }>) {
	return createHash("sha256")
		.update(`orbit-session\0${config.username}\0${config.password}`)
		.digest();
}

function signatureFor(
	body: string,
	config: Extract<OrbitAuthConfig, { enabled: true }>,
) {
	return createHmac("sha256", sessionKey(config))
		.update(body)
		.digest("base64url");
}

function safeEqual(left: string, right: string) {
	const leftDigest = createHash("sha256").update(left).digest();
	const rightDigest = createHash("sha256").update(right).digest();
	return timingSafeEqual(leftDigest, rightDigest);
}

function configuredSessionDays(value: string | undefined) {
	if (!value) return DEFAULT_SESSION_DAYS;
	const days = Number.parseInt(value, 10);
	if (!Number.isFinite(days) || days < 1 || days > 365) {
		throw new Error("ORBIT_AUTH_SESSION_DAYS는 1~365 사이여야 합니다.");
	}
	return days;
}

export function getOrbitAuthConfig(
	environment: AuthEnvironment = process.env,
): OrbitAuthConfig {
	const username = environment.ORBIT_AUTH_USERNAME?.trim();
	const password = environment.ORBIT_AUTH_PASSWORD;

	if (!username && !password) {
		if (environment.NODE_ENV === "production") {
			throw new Error(
				"ORBIT_AUTH_USERNAME과 ORBIT_AUTH_PASSWORD를 설정해야 합니다.",
			);
		}
		return { enabled: false };
	}

	if (!username || !password) {
		throw new Error(
			"ORBIT_AUTH_USERNAME과 ORBIT_AUTH_PASSWORD를 모두 설정해야 합니다.",
		);
	}

	return {
		enabled: true,
		username,
		password,
		sessionDays: configuredSessionDays(environment.ORBIT_AUTH_SESSION_DAYS),
	};
}

export function createOrbitSessionToken(
	config: Extract<OrbitAuthConfig, { enabled: true }>,
	now = Date.now(),
) {
	const payload: SessionPayload = {
		exp: now + config.sessionDays * 24 * 60 * 60 * 1000,
		nonce: randomBytes(18).toString("base64url"),
		sub: config.username,
	};
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${body}.${signatureFor(body, config)}`;
}

export function verifyOrbitSessionToken(
	token: string | undefined,
	config: Extract<OrbitAuthConfig, { enabled: true }>,
	now = Date.now(),
) {
	if (!token) return false;
	const [body, signature, extra] = token.split(".");
	if (!body || !signature || extra) return false;
	if (!safeEqual(signature, signatureFor(body, config))) return false;

	try {
		const payload = JSON.parse(
			Buffer.from(body, "base64url").toString("utf8"),
		) as Partial<SessionPayload>;
		return (
			payload.sub === config.username &&
			typeof payload.exp === "number" &&
			payload.exp > now &&
			typeof payload.nonce === "string" &&
			payload.nonce.length > 0
		);
	} catch {
		return false;
	}
}

export function orbitCredentialsMatch(
	username: string,
	password: string,
	config: Extract<OrbitAuthConfig, { enabled: true }>,
) {
	return (
		safeEqual(username, config.username) && safeEqual(password, config.password)
	);
}

export function isOrbitRequestAuthenticated() {
	const config = getOrbitAuthConfig();
	if (!config.enabled) return true;
	return verifyOrbitSessionToken(getCookie(SESSION_COOKIE), config);
}

function cookieSecure() {
	return (
		process.env.NODE_ENV === "production" ||
		getRequestProtocol({ xForwardedProto: true }) === "https"
	);
}

export function issueOrbitSession(
	config: Extract<OrbitAuthConfig, { enabled: true }>,
) {
	const maxAge = config.sessionDays * 24 * 60 * 60;
	setCookie(SESSION_COOKIE, createOrbitSessionToken(config), {
		httpOnly: true,
		maxAge,
		path: "/",
		sameSite: "lax",
		secure: cookieSecure(),
	});
}

export function clearOrbitSession() {
	deleteCookie(SESSION_COOKIE, {
		httpOnly: true,
		path: "/",
		sameSite: "lax",
		secure: cookieSecure(),
	});
}

export function markOrbitResponsePrivate() {
	setResponseHeader("cache-control", "no-store");
	setResponseHeader("vary", "Cookie");
}

export function assertSameOriginRequest() {
	const request = getRequest();
	if (request.method === "GET" || request.method === "HEAD") return;

	const origin = request.headers.get("origin");
	if (!origin) return;

	const forwardedHost = request.headers
		.get("x-forwarded-host")
		?.split(",")[0]
		?.trim();
	const host = forwardedHost || request.headers.get("host");
	const fetchSite = request.headers.get("sec-fetch-site");
	if (
		!host ||
		new URL(origin).host !== host ||
		(fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site")
	) {
		throw new Error("허용되지 않은 요청입니다.");
	}
}

function clientAddress() {
	return (
		getRequestHeader("cf-connecting-ip") ??
		getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown"
	);
}

function pruneLoginAttempts(now: number) {
	for (const [key, attempt] of loginAttempts) {
		if (attempt.resetAt <= now) loginAttempts.delete(key);
	}
	if (loginAttempts.size <= 1_000) return;
	for (const key of loginAttempts.keys()) {
		loginAttempts.delete(key);
		if (loginAttempts.size <= 800) break;
	}
}

export function assertLoginAllowed(now = Date.now()) {
	pruneLoginAttempts(now);
	const attempt = loginAttempts.get(clientAddress());
	if (attempt && attempt.resetAt > now && attempt.count >= MAX_LOGIN_ATTEMPTS) {
		throw new Error("잠시 후 다시 시도해 주세요.");
	}
}

export function recordLoginFailure(now = Date.now()) {
	const address = clientAddress();
	const current = loginAttempts.get(address);
	if (!current || current.resetAt <= now) {
		loginAttempts.set(address, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
		return;
	}
	current.count += 1;
}

export function clearLoginFailures() {
	loginAttempts.delete(clientAddress());
}
