import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/orbit/images")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { handleNoteMediaRequest } = await import(
					"#/lib/orbit/note-media-http.server"
				);
				return handleNoteMediaRequest(request);
			},
			POST: async ({ request }) => {
				const { handleNoteMediaRequest } = await import(
					"#/lib/orbit/note-media-http.server"
				);
				return handleNoteMediaRequest(request);
			},
		},
	},
});
