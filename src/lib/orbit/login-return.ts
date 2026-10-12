// Only the OAuth consent endpoint is accepted. Never accept an arbitrary redirect.
export function orbitLoginReturn(value: unknown) {
	if (
		typeof value !== "string" ||
		value.length > 4096 ||
		!value.startsWith("/oauth/authorize?")
	)
		return "/";
	const url = new URL(value, "https://orbit.invalid");
	return url.origin === "https://orbit.invalid" &&
		url.pathname === "/oauth/authorize"
		? url.pathname + url.search
		: "/";
}
