import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getOrbitAuthConfig, verifyOrbitSessionToken } from "./auth.server";
import { MAX_NOTE_VIDEO_BYTES } from "./note-media";
import {
	getNoteMedia,
	NoteMediaError,
	saveNoteMedia,
} from "./note-media.server";

const headers = {
	"Cache-Control": "no-store",
	Vary: "Cookie",
	"X-Content-Type-Options": "nosniff",
	"Cross-Origin-Resource-Policy": "same-origin",
};
function error(status: number, extra: Record<string, string> = {}) {
	return Response.json(
		{ error: "Media request failed" },
		{ status, headers: { ...headers, ...extra } },
	);
}

export function mediaByteRange(value: string, size: number) {
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2])) return null;
	const start = match[1]
		? Number(match[1])
		: Math.max(0, size - Number(match[2]));
	const end =
		match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		start > end ||
		start >= size
	)
		return null;
	return { start, end };
}

export async function handleNoteMediaRequest(request: Request) {
	const url = new URL(request.url);
	const config = getOrbitAuthConfig();
	const token = request.headers
		.get("cookie")
		?.split(";")
		.map((value) => value.trim())
		.find((value) => value.startsWith("orbit_session="))
		?.slice("orbit_session=".length);
	if (
		config.enabled
			? !verifyOrbitSessionToken(token, config)
			: !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
	)
		return error(401);
	if (request.headers.get("sec-fetch-site") === "cross-site") return error(403);
	if (request.method === "POST") {
		const origin = request.headers.get("origin");
		if (!origin || ![url.origin, process.env.ORBIT_PUBLIC_URL].includes(origin))
			return error(403);
	}
	try {
		if (request.method === "GET" || request.method === "HEAD") {
			const media = await getNoteMedia(url.searchParams.get("path") ?? "");
			if (!media) return error(404);
			const rangeHeader =
				request.method === "GET" ? request.headers.get("range") : null;
			const range = rangeHeader
				? mediaByteRange(rangeHeader, media.size)
				: undefined;
			if (range === null)
				return error(416, { "Content-Range": `bytes */${media.size}` });
			const contentLength = range ? range.end - range.start + 1 : media.size;
			const body =
				request.method === "HEAD"
					? null
					: (Readable.toWeb(
							createReadStream(media.filename, range),
						) as ReadableStream<Uint8Array>);
			return new Response(body, {
				status: range ? 206 : 200,
				headers: {
					...headers,
					"Content-Type": media.mime,
					"Content-Length": String(contentLength),
					"Accept-Ranges": "bytes",
					...(range
						? {
								"Content-Range": `bytes ${range.start}-${range.end}/${media.size}`,
							}
						: {}),
				},
			});
		}
		if (request.method !== "POST") return error(405);
		if (Number(request.headers.get("content-length")) > MAX_NOTE_VIDEO_BYTES)
			return error(413);
		if (!request.body) return error(400);
		return Response.json(await saveNoteMedia(request.body), {
			status: 201,
			headers,
		});
	} catch (cause) {
		return error(cause instanceof NoteMediaError ? cause.status : 500);
	}
}
