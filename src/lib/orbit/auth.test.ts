import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
	createOrbitSessionToken,
	getOrbitAuthConfig,
	orbitCredentialsMatch,
	updateOrbitAccountForSession,
	updateOrbitCredentials,
	verifyOrbitSessionToken,
} from "./auth.server";

let directory: string;
let environment: Record<string, string | undefined>;
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), "orbit-auth-"));
	environment = {
		NODE_ENV: "production",
		ORBIT_VAULT_DIR: directory,
		ORBIT_AUTH_USERNAME: "orbit",
		ORBIT_AUTH_PASSWORD: "correct horse battery staple",
	};
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

const config = {
	enabled: true as const,
	password: "correct horse battery staple",
	sessionDays: 180,
	username: "orbit",
};

test("auth is optional outside production when no credentials are configured", () => {
	assert.deepEqual(
		getOrbitAuthConfig({ NODE_ENV: "development", ORBIT_VAULT_DIR: directory }),
		{
			enabled: false,
		},
	);
});

test("production fails closed when credentials are missing or incomplete", () => {
	assert.throws(
		() =>
			getOrbitAuthConfig({
				NODE_ENV: "production",
				ORBIT_VAULT_DIR: directory,
			}),
		/ORBIT_AUTH_USERNAME/,
	);
	assert.throws(
		() =>
			getOrbitAuthConfig({
				NODE_ENV: "production",
				ORBIT_VAULT_DIR: directory,
				ORBIT_AUTH_USERNAME: "orbit",
			}),
		/ORBIT_AUTH_PASSWORD/,
	);
});

test("credentials must match both configured values", async () => {
	assert.equal(
		await orbitCredentialsMatch(
			"orbit",
			"correct horse battery staple",
			config,
		),
		true,
	);
	assert.equal(
		await orbitCredentialsMatch(
			"someone",
			"correct horse battery staple",
			config,
		),
		false,
	);
	assert.equal(await orbitCredentialsMatch("orbit", "wrong", config), false);
});

test("session tokens survive reloads but reject expiry and credential changes", () => {
	const now = Date.UTC(2026, 7, 30);
	const token = createOrbitSessionToken(config, now);
	assert.equal(verifyOrbitSessionToken(token, config, now + 1_000), true);
	assert.equal(
		verifyOrbitSessionToken(
			token,
			config,
			now + config.sessionDays * 24 * 60 * 60 * 1_000,
		),
		false,
	);
	assert.equal(
		verifyOrbitSessionToken(
			token,
			{ ...config, password: "a new password" },
			now + 1_000,
		),
		false,
	);
});

test("password change persists a hash, rejects bootstrap credentials and invalidates all old sessions", async () => {
	const old = getOrbitAuthConfig(environment);
	assert.ok(old.enabled);
	const oldToken = createOrbitSessionToken(old);
	await updateOrbitCredentials(
		"orbit",
		config.password,
		"a much newer password",
		environment,
	);
	const stored = readFileSync(path.join(directory, ".orbit/auth.json"), "utf8");
	assert.ok(!stored.includes("a much newer password"));
	assert.ok(!stored.includes(config.password));
	assert.equal(
		statSync(path.join(directory, ".orbit/auth.json")).mode & 0o777,
		0o600,
	);
	// Fresh config loads simulate restart/redeployment, even with the old env value.
	const current = getOrbitAuthConfig({ ...environment });
	assert.ok(current.enabled);
	assert.equal(
		await orbitCredentialsMatch("orbit", "a much newer password", current),
		true,
	);
	assert.equal(
		await orbitCredentialsMatch("orbit", config.password, current),
		false,
	);
	assert.equal(
		await orbitCredentialsMatch("someone", "a much newer password", current),
		false,
	);
	assert.equal(verifyOrbitSessionToken(oldToken, current), false);
	assert.equal(
		verifyOrbitSessionToken(createOrbitSessionToken(current), current),
		true,
	);
	const withoutBootstrap = getOrbitAuthConfig({
		...environment,
		ORBIT_AUTH_PASSWORD: undefined,
	});
	assert.ok(withoutBootstrap.enabled);
	assert.equal(
		await orbitCredentialsMatch(
			"orbit",
			"a much newer password",
			withoutBootstrap,
		),
		true,
	);
	const currentToken = createOrbitSessionToken(current);
	await updateOrbitCredentials(
		"orbit",
		"a much newer password",
		"yet another new password",
		environment,
	);
	const rotated = getOrbitAuthConfig(environment);
	assert.ok(rotated.enabled);
	assert.equal(verifyOrbitSessionToken(currentToken, rotated), false);
	assert.equal(
		await orbitCredentialsMatch("orbit", "a much newer password", rotated),
		false,
	);
});

test("password changes require the correct current credential and a different long password", async () => {
	for (const [username, current, next] of [
		["orbit", "incorrect current", "a much newer password"],
		["someone", config.password, "a much newer password"],
		["orbit", config.password, "too short"],
		["orbit", config.password, "x".repeat(1025)],
		["orbit", config.password, config.password],
	]) {
		await assert.rejects(
			updateOrbitCredentials(username, current, next, environment),
		);
	}
	assert.throws(() => readFileSync(path.join(directory, ".orbit/auth.json")), {
		code: "ENOENT",
	});
});

test("concurrent password changes cannot both overwrite the same credential", async () => {
	const results = await Promise.allSettled([
		updateOrbitCredentials(
			"orbit",
			config.password,
			"first new password",
			environment,
		),
		updateOrbitCredentials(
			"orbit",
			config.password,
			"second new password",
			environment,
		),
	]);
	assert.equal(
		results.filter((result) => result.status === "fulfilled").length,
		1,
	);
	assert.equal(
		results.filter((result) => result.status === "rejected").length,
		1,
	);
	const current = getOrbitAuthConfig(environment);
	assert.ok(current.enabled);
	const winner =
		results[0].status === "fulfilled"
			? "first new password"
			: "second new password";
	assert.equal(await orbitCredentialsMatch("orbit", winner, current), true);
});

test("saved credentials take precedence over bootstrap variables and corruption fails closed", async () => {
	await updateOrbitCredentials(
		"orbit",
		config.password,
		"a much newer password",
		environment,
	);
	const persisted = getOrbitAuthConfig({
		...environment,
		ORBIT_AUTH_USERNAME: "another",
	});
	assert.ok(persisted.enabled);
	assert.equal(persisted.username, "orbit");
	for (const value of ["{", "{}", JSON.stringify({ version: 2 })]) {
		writeFileSync(path.join(directory, ".orbit/auth.json"), value);
		assert.throws(() => getOrbitAuthConfig(environment), /저장된 로그인 정보/);
	}
});

test("password settings reject missing, invalid, and expired sessions even with correct credentials", async () => {
	const current = getOrbitAuthConfig(environment);
	assert.ok(current.enabled);
	const expired = createOrbitSessionToken(
		current,
		Date.now() - 366 * 24 * 60 * 60 * 1000,
	);
	for (const token of [undefined, "invalid-session", expired]) {
		await assert.rejects(
			updateOrbitAccountForSession(
				token,
				config.password,
				"new settings password",
				environment,
			),
			/로그인 후/,
		);
	}
	assert.throws(() => readFileSync(path.join(directory, ".orbit/auth.json")), {
		code: "ENOENT",
	});
});

test("authenticated settings require the current password and return a config for renewing this session", async () => {
	const current = getOrbitAuthConfig(environment);
	assert.ok(current.enabled);
	const thisSession = createOrbitSessionToken(current);
	const otherSession = createOrbitSessionToken(current);
	await assert.rejects(
		updateOrbitAccountForSession(
			thisSession,
			"wrong current password",
			"new settings password",
			environment,
		),
		/현재 비밀번호/,
	);
	const updated = await updateOrbitAccountForSession(
		thisSession,
		config.password,
		"new settings password",
		environment,
	);
	const renewedSession = createOrbitSessionToken(updated);
	assert.equal(verifyOrbitSessionToken(renewedSession, updated), true);
	assert.equal(verifyOrbitSessionToken(thisSession, updated), false);
	assert.equal(verifyOrbitSessionToken(otherSession, updated), false);
	assert.equal(
		await orbitCredentialsMatch(
			config.username,
			"new settings password",
			updated,
		),
		true,
	);
	await assert.rejects(
		updateOrbitAccountForSession(
			thisSession,
			"new settings password",
			"another settings password",
			environment,
		),
		/로그인 후/,
	);
});

test("password settings cannot bootstrap an account when authentication is disabled", async () => {
	await assert.rejects(
		updateOrbitAccountForSession(
			undefined,
			"anything",
			"new settings password",
			{
				NODE_ENV: "development",
				ORBIT_VAULT_DIR: directory,
			},
		),
		/로그인 후/,
	);
});

test("renaming the initial account persists the current password and overrides bootstrap variables", async () => {
	const initial = getOrbitAuthConfig(environment);
	assert.ok(initial.enabled);
	const token = createOrbitSessionToken(initial);
	const renamed = await updateOrbitAccountForSession(
		token,
		config.password,
		undefined,
		environment,
		"  새로운 이름  ",
	);
	assert.equal(renamed.username, "새로운 이름");
	assert.equal(
		await orbitCredentialsMatch("새로운 이름", config.password, renamed),
		true,
	);
	assert.equal(
		await orbitCredentialsMatch("orbit", config.password, renamed),
		false,
	);
	assert.equal(verifyOrbitSessionToken(token, renamed), false);
	assert.equal(
		verifyOrbitSessionToken(createOrbitSessionToken(renamed), renamed),
		true,
	);
	const reloaded = getOrbitAuthConfig({
		NODE_ENV: "production",
		ORBIT_VAULT_DIR: directory,
	});
	assert.ok(reloaded.enabled);
	assert.equal(reloaded.username, "새로운 이름");
	assert.equal(
		await orbitCredentialsMatch("새로운 이름", config.password, reloaded),
		true,
	);
});

test("renaming a saved account preserves the hash; name and password can also change atomically", async () => {
	await updateOrbitCredentials(
		"orbit",
		config.password,
		"first saved password",
		environment,
	);
	const current = getOrbitAuthConfig(environment);
	assert.ok(current.enabled);
	const renamed = await updateOrbitAccountForSession(
		createOrbitSessionToken(current),
		"first saved password",
		undefined,
		environment,
		"renamed",
	);
	assert.equal(renamed.savedCredential?.hash, current.savedCredential?.hash);
	assert.notEqual(
		renamed.savedCredential?.sessionSecret,
		current.savedCredential?.sessionSecret,
	);
	const updated = await updateOrbitAccountForSession(
		createOrbitSessionToken(renamed),
		"first saved password",
		"second saved password",
		environment,
		"final-name",
	);
	assert.equal(
		await orbitCredentialsMatch("final-name", "second saved password", updated),
		true,
	);
	assert.equal(
		await orbitCredentialsMatch("renamed", "second saved password", updated),
		false,
	);
	assert.equal(
		await orbitCredentialsMatch("final-name", "first saved password", updated),
		false,
	);
});

test("account renaming requires a session, current password, and a nonempty bounded name", async () => {
	const current = getOrbitAuthConfig(environment);
	assert.ok(current.enabled);
	const token = createOrbitSessionToken(current);
	await assert.rejects(
		updateOrbitAccountForSession(
			undefined,
			config.password,
			undefined,
			environment,
			"renamed",
		),
		/로그인 후/,
	);
	await assert.rejects(
		updateOrbitAccountForSession(
			token,
			"wrong password",
			undefined,
			environment,
			"renamed",
		),
		/현재 비밀번호/,
	);
	for (const name of ["", "   ", "x".repeat(129)]) {
		await assert.rejects(
			updateOrbitAccountForSession(
				token,
				config.password,
				undefined,
				environment,
				name,
			),
			/계정 이름/,
		);
	}
	const unchanged = await updateOrbitAccountForSession(
		token,
		config.password,
		undefined,
		environment,
		"orbit",
	);
	assert.equal(verifyOrbitSessionToken(token, unchanged), true);
	assert.throws(() => readFileSync(path.join(directory, ".orbit/auth.json")), {
		code: "ENOENT",
	});
});

test("concurrent account rename and password changes cannot overwrite one another", async () => {
	const current = getOrbitAuthConfig(environment);
	assert.ok(current.enabled);
	const token = createOrbitSessionToken(current);
	const results = await Promise.allSettled([
		updateOrbitAccountForSession(
			token,
			config.password,
			undefined,
			environment,
			"renamed",
		),
		updateOrbitAccountForSession(
			token,
			config.password,
			"updated password",
			environment,
			"orbit",
		),
	]);
	assert.equal(
		results.filter((result) => result.status === "fulfilled").length,
		1,
	);
	assert.equal(
		results.filter((result) => result.status === "rejected").length,
		1,
	);
});
