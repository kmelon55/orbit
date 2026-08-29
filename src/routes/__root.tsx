import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { loadOrbit } from "#/lib/orbit/functions";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import appCss from "../styles.css?url";

const themeScript = `(()=>{try{const t=localStorage.getItem("orbit-ui-theme")||"system";const d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch{}})()`;

export const Route = createRootRoute({
	loader: () => loadOrbit(),
	staleTime: Number.POSITIVE_INFINITY,
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{
				name: "description",
				content:
					"A private, file-first second brain for notes, tasks, PARA, and calendar.",
			},
			{ name: "theme-color", content: "#f3f3f7" },
			{ title: "Orbit · File-first workspace" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/orbit.png", type: "image/png" },
			{ rel: "icon", href: "/orbit.svg", type: "image/svg+xml" },
			{ rel: "apple-touch-icon", href: "/orbit.png" },
		],
	}),
	component: RootLayout,
	shellComponent: RootDocument,
});

function RootLayout() {
	const snapshot = Route.useLoaderData();
	return (
		<AppShell snapshot={snapshot}>
			<Outlet />
		</AppShell>
	);
}

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="ko" suppressHydrationWarning>
			<head>
				<script>{themeScript}</script>
				<HeadContent />
			</head>
			<body>
				<ThemeProvider>{children}</ThemeProvider>
				<Scripts />
			</body>
		</html>
	);
}
