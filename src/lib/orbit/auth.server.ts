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
import {
	type AuthEnvironment,
	createSavedCredential,
	readSavedCredential,
	type SavedCredential,
	savedPasswordMatches,
	writeSavedCredential,
} from "./password-store.server";

const SESSION_COOKIE = "orbit_session";
const DEFAULT_SESSION_DAYS = 180;
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

export type OrbitAuthConfig =
	| { enabled: false }
	| {
			enabled: true;
			username: string;
			password: string;
			savedCredential?: SavedCredential;
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
	if (config.savedCredential) {
		return Buffer.from(config.savedCredential.sessionSecret, "hex");
	}
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
	const savedCredential = readSavedCredential(environment);
	if (savedCredential) {
		return {
			enabled: true,
			username: savedCredential.username,
			password: "",
			savedCredential,
			sessionDays: configuredSessionDays(environment.ORBIT_AUTH_SESSION_DAYS),
		};
	}

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

export async function orbitCredentialsMatch(
	username: string,
	password: string,
	config: Extract<OrbitAuthConfig, { enabled: true }>,
) {
	const passwordMatches = config.savedCredential
		? await savedPasswordMatches(password, config.savedCredential)
		: safeEqual(password, config.password);
	return safeEqual(username, config.username) && passwordMatches;
}

export class OrbitAccountChangeError extends Error {}

export async function updateOrbitCredentials(
	username: string,
	currentPassword: string,
	newPassword: string | undefined,
	environment: AuthEnvironment = process.env,
	newUsername = username,
) {
	newUsername = newUsername.trim();
	if (!newUsername || newUsername.length > 128) {
		throw new OrbitAccountChangeError("계정 이름은 1~128자로 입력해 주세요.");
	}
	if (
		newPassword !== undefined &&
		(newPassword.length < 12 || newPassword.length > 1_024)
	) {
		throw new OrbitAccountChangeError(
			"새 비밀번호는 12~1,024자로 입력해 주세요.",
		);
	}
	const config = getOrbitAuthConfig(environment);
	if (
		!config.enabled ||
		!(await orbitCredentialsMatch(username, currentPassword, config))
	) {
		throw new OrbitAccountChangeError(
			"아이디 또는 현재 비밀번호가 올바르지 않습니다.",
		);
	}
	if (newPassword !== undefined && safeEqual(currentPassword, newPassword)) {
		throw new OrbitAccountChangeError(
			"현재 비밀번호와 다른 비밀번호를 입력해 주세요.",
		);
	}
	const unchanged =
		newUsername === config.username && newPassword === undefined;
	const credential = unchanged
		? null
		: newPassword === undefined && config.savedCredential
			? {
					...config.savedCredential,
					username: newUsername,
					sessionSecret: randomBytes(32).toString("hex"),
				}
			: await createSavedCredential(
					newUsername,
					newPassword ?? currentPassword,
				);
	const latest = getOrbitAuthConfig(environment);
	// No async gap between this check and the atomic write: concurrent changes
	// verified against an old password cannot overwrite the first successful change.
	if (
		!latest.enabled ||
		!timingSafeEqual(sessionKey(config), sessionKey(latest))
	) {
		throw new OrbitAccountChangeError(
			"계정 정보가 이미 변경되었습니다. 다시 로그인해 주세요.",
		);
	}
	if (credential) writeSavedCredential(environment, credential);
	return getOrbitAuthConfig(environment);
}

export function isOrbitRequestAuthenticated() {
	const config = getOrbitAuthConfig();
	if (!config.enabled) return true;
	return verifyOrbitSessionToken(getCookie(SESSION_COOKIE), config);
}

export async function updateOrbitAccountForSession(
	token: string | undefined,
	currentPassword: string,
	newPassword: string | undefined,
	environment: AuthEnvironment = process.env,
	newUsername?: string,
) {
	const config = getOrbitAuthConfig(environment);
	if (!config.enabled || !verifyOrbitSessionToken(token, config)) {
		throw new OrbitAccountChangeError("로그인 후 계정 정보를 변경해 주세요.");
	}
	const updated = await updateOrbitCredentials(
		config.username,
		currentPassword,
		newPassword,
		environment,
		newUsername,
	);
	if (!updated.enabled) throw new Error("로그인 설정을 확인해 주세요.");
	return updated;
}

export async function updateOrbitRequestAccount(data: {
	username: string;
	currentPassword: string;
	newPassword?: string;
}) {
	const updated = await updateOrbitAccountForSession(
		getCookie(SESSION_COOKIE),
		data.currentPassword,
		data.newPassword,
		process.env,
		data.username,
	);
	// Keep this device signed in; rotating the key invalidates other sessions.
	issueOrbitSession(updated);
	return { username: updated.username };
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
