import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
	const { handleMcpRequest } = await import("#/lib/orbit/mcp-http.server");
	return handleMcpRequest(request);
}
export const Route = createFileRoute("/.well-known/$")({
	server: { handlers: { GET: handle, POST: handle, DELETE: handle } },
});
