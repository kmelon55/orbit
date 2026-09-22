import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";

export type AuthEnvironment = Record<string, string | undefined>;

const credentialSchema = z.object({
	version: z.literal(1),
	username: z.string().min(1).max(128),
	salt: z.string().regex(/^[a-f0-9]{32}$/),
	hash: z.string().regex(/^[a-f0-9]{128}$/),
	sessionSecret: z.string().regex(/^[a-f0-9]{64}$/),
});

export type SavedCredential = z.infer<typeof credentialSchema>;

function credentialPath(environment: AuthEnvironment) {
	return path.resolve(
		environment.ORBIT_VAULT_DIR ?? environment.ORBIT_DATA_DIR ?? "vault",
		".orbit/auth.json",
	);
}

export function readSavedCredential(environment: AuthEnvironment) {
	try {
		return credentialSchema.parse(
			JSON.parse(readFileSync(credentialPath(environment), "utf8")),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		// Never fall back to the initial password when saved credentials are corrupt.
		throw new Error(
			"저장된 로그인 정보를 읽을 수 없습니다. 서버 설정을 확인해 주세요.",
		);
	}
}

function derivePassword(password: string, salt: string) {
	return new Promise<Buffer>((resolve, reject) => {
		// OWASP scrypt recommendation: N=2^15, r=8, p=3 (32 MiB).
		scrypt(
			password,
			Buffer.from(salt, "hex"),
			64,
			{ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
			(error, result) => (error ? reject(error) : resolve(result)),
		);
	});
}

export async function savedPasswordMatches(
	password: string,
	saved: SavedCredential,
) {
	return timingSafeEqual(
		await derivePassword(password, saved.salt),
		Buffer.from(saved.hash, "hex"),
	);
}

export async function createSavedCredential(
	username: string,
	password: string,
): Promise<SavedCredential> {
	const salt = randomBytes(16).toString("hex");
	return {
		version: 1,
		username,
		salt,
		hash: (await derivePassword(password, salt)).toString("hex"),
		sessionSecret: randomBytes(32).toString("hex"),
	};
}

export function writeSavedCredential(
	environment: AuthEnvironment,
	credential: SavedCredential,
) {
	const target = credentialPath(environment);
	const temporary = `${target}.${randomBytes(12).toString("hex")}.tmp`;
	mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
	try {
		writeFileSync(
			temporary,
			`${JSON.stringify(credentialSchema.parse(credential))}\n`,
			{
				mode: 0o600,
				flag: "wx",
				flush: true,
			},
		);
		renameSync(temporary, target);
	} finally {
		rmSync(temporary, { force: true });
	}
}
