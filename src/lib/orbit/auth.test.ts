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
	changeOrbitPassword,
	createOrbitSessionToken,
	getOrbitAuthConfig,
	orbitCredentialsMatch,
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
	await changeOrbitPassword(
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
	await changeOrbitPassword(
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
			changeOrbitPassword(username, current, next, environment),
		);
	}
	assert.throws(() => readFileSync(path.join(directory, ".orbit/auth.json")), {
		code: "ENOENT",
	});
});

test("concurrent password changes cannot both overwrite the same credential", async () => {
	const results = await Promise.allSettled([
		changeOrbitPassword(
			"orbit",
			config.password,
			"first new password",
			environment,
		),
		changeOrbitPassword(
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

test("corrupt saved credentials and username changes fail closed instead of restoring the initial password", async () => {
	await changeOrbitPassword(
		"orbit",
		config.password,
		"a much newer password",
		environment,
	);
	assert.throws(() =>
		getOrbitAuthConfig({ ...environment, ORBIT_AUTH_USERNAME: "another" }),
	);
	for (const value of ["{", "{}", JSON.stringify({ version: 2 })]) {
		writeFileSync(path.join(directory, ".orbit/auth.json"), value);
		assert.throws(() => getOrbitAuthConfig(environment), /저장된 로그인 정보/);
	}
});
