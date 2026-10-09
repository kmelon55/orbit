import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	server: {
		watch: {
			ignored: ["**/data/**", "**/vault/**"],
		},
	},
	plugins: [
		{
			name: "orbit-media-api-dev-routing",
			apply: "serve",
			enforce: "pre",
			configureServer(server) {
				server.middlewares.use((request, _response, next) => {
					// Nitro's dev middleware otherwise treats <img>/<video> API requests
					// as static assets and returns 404 before TanStack's routes run.
					if (/^\/api\/orbit\/(media|images)(?:\?|$)/.test(request.url ?? "")) {
						request.headers["sec-fetch-dest"] = "empty";
					}
					next();
				});
			},
		},
		tanstackStart(),
		nitro({
			plugins: ["./src/server/mail-plugin.ts"],
			// Nitro re-bundles Vite's SSR chunks; splitting them again can create
			// a circular dependency on Rolldown's initialization helpers.
			// Keep only the server bundle together; client route splitting stays on.
			inlineDynamicImports: true,
		}),
		tailwindcss(),
		viteReact(),
	],
});
