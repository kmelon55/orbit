export async function mailApi<T>(
	path: string,
	body?: unknown,
	signal?: AbortSignal,
): Promise<T> {
	const response = await fetch(`/api/mail/${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers:
			body === undefined ? undefined : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal,
	});
	const value = await response.json();
	if (!response.ok) throw new Error(value.error || "메일 요청에 실패했습니다.");
	return value as T;
}

const demoClient: typeof mailApi = (path, body, signal) =>
	mailApi(`demo/${path}`, body, signal);
export function createMailClient(demo = false): typeof mailApi {
	return demo ? demoClient : mailApi;
}
