export const MAX_NOTE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_NOTE_VIDEO_BYTES = 250 * 1024 * 1024;
export const NOTE_MEDIA_ENDPOINT = "/api/orbit/media";
export type NoteMedia = { url: string; mime: string };

export async function uploadNoteMedia(file: File): Promise<NoteMedia> {
	const video =
		file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name);
	if (
		!file.size ||
		file.size > (video ? MAX_NOTE_VIDEO_BYTES : MAX_NOTE_IMAGE_BYTES)
	)
		throw new Error(
			video
				? "Choose a video smaller than 250 MB."
				: "Choose an image smaller than 20 MB.",
		);
	const response = await fetch(NOTE_MEDIA_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": file.type || "application/octet-stream" },
		body: file,
	});
	if (!response.ok) {
		if (response.status === 413)
			throw new Error(
				video
					? "Choose a video smaller than 250 MB."
					: "Choose an image smaller than 20 MB.",
			);
		if (response.status === 415)
			throw new Error("Use PNG, JPEG, GIF, WebP, AVIF, MP4, MOV, or WebM.");
		throw new Error("Could not save the file. Please try again.");
	}
	return response.json() as Promise<NoteMedia>;
}

export function isNoteMediaFile(file: File) {
	return (
		/^(image|video)\//.test(file.type) ||
		/\.(png|jpe?g|gif|webp|avif|mp4|mov|webm)$/i.test(file.name)
	);
}

export function isNoteVideoUrl(value: string) {
	try {
		const url = new URL(value, "http://orbit.local");
		return (
			value.startsWith(`${NOTE_MEDIA_ENDPOINT}?`) &&
			url.pathname === NOTE_MEDIA_ENDPOINT &&
			/\.(mp4|mov|webm)$/.test(url.searchParams.get("path") ?? "")
		);
	} catch {
		return false;
	}
}
