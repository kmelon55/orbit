import {
	createRootRoute,
	HeadContent,
	Outlet,
	redirect,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { getOrbitAuthStatus } from "#/lib/orbit/auth";
import { loadOrbit } from "#/lib/orbit/functions";
import { AppShell } from "@/components/app-shell";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ThemeProvider } from "@/components/theme-provider";
import appCss from "../styles.css?url";

const themeScript = `(()=>{try{const t=localStorage.getItem("orbit-ui-theme")||"system";const d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch{}})()`;

export const Route = createRootRoute({
	loader: async ({ location }) => {
		const auth = await getOrbitAuthStatus();
		if (location.pathname === "/login") {
			if (auth.authenticated) throw redirect({ to: "/inbox" });
			return null;
		}
		if (!auth.authenticated) throw redirect({ to: "/login" });
		return loadOrbit();
	},
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
			{ name: "mobile-web-app-capable", content: "yes" },
			{ name: "apple-mobile-web-app-capable", content: "yes" },
			{
				name: "apple-mobile-web-app-status-bar-style",
				content: "default",
			},
			{ name: "apple-mobile-web-app-title", content: "Orbit" },
			{ name: "format-detection", content: "telephone=no" },
			{ title: "Orbit · File-first workspace" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "manifest", href: "/manifest.webmanifest" },
			{ rel: "icon", href: "/orbit.png", type: "image/png" },
			{ rel: "icon", href: "/orbit.svg", type: "image/svg+xml" },
			{ rel: "apple-touch-icon", href: "/icons/orbit-apple-touch.png" },
		],
	}),
	component: RootLayout,
	shellComponent: RootDocument,
});

function RootLayout() {
	const snapshot = Route.useLoaderData();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	if (pathname === "/login") return <Outlet />;
	if (!snapshot) return null;
	return (
		<AppShell snapshot={snapshot}>
			<Outlet />
		</AppShell>
	);
}

export function useOrbitSnapshot() {
	const snapshot = Route.useLoaderData();
	if (!snapshot) throw new Error("Orbit workspace is unavailable.");
	return snapshot;
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
				<ServiceWorkerRegister />
				<Scripts />
			</body>
		</html>
	);
}
