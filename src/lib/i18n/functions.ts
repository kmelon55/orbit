import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LOCALE_COOKIE, resolveLocale } from "./index";

export const getUiLocale = createServerFn({ method: "GET" }).handler(
	async () => {
		const { getCookie, getRequestHeader } = await import(
			"@tanstack/react-start/server"
		);
		return resolveLocale(
			getCookie(LOCALE_COOKIE),
			getRequestHeader("accept-language"),
		);
	},
);
export const saveUiLocale = createServerFn({ method: "POST" })
	.validator((input: unknown) => z.enum(["ko", "en"]).parse(input))
	.handler(async ({ data }) => {
		const { setCookie } = await import("@tanstack/react-start/server");
		setCookie(LOCALE_COOKIE, data, {
			path: "/",
			maxAge: 31_536_000,
			sameSite: "lax",
		});
		return data;
	});
