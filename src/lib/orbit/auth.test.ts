import assert from "node:assert/strict";
import test from "node:test";
import {
	createOrbitSessionToken,
	getOrbitAuthConfig,
	orbitCredentialsMatch,
	verifyOrbitSessionToken,
} from "./auth.server";

const config = {
	enabled: true as const,
	password: "correct horse battery staple",
	sessionDays: 180,
	username: "orbit",
};

test("auth is optional outside production when no credentials are configured", () => {
	assert.deepEqual(getOrbitAuthConfig({ NODE_ENV: "development" }), {
		enabled: false,
	});
});

test("production fails closed when credentials are missing or incomplete", () => {
	assert.throws(
		() => getOrbitAuthConfig({ NODE_ENV: "production" }),
		/ORBIT_AUTH_USERNAME/,
	);
	assert.throws(
		() =>
			getOrbitAuthConfig({
				NODE_ENV: "production",
				ORBIT_AUTH_USERNAME: "orbit",
			}),
		/ORBIT_AUTH_PASSWORD/,
	);
});

test("credentials must match both configured values", () => {
	assert.equal(
		orbitCredentialsMatch("orbit", "correct horse battery staple", config),
		true,
	);
	assert.equal(
		orbitCredentialsMatch("someone", "correct horse battery staple", config),
		false,
	);
	assert.equal(orbitCredentialsMatch("orbit", "wrong", config), false);
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
