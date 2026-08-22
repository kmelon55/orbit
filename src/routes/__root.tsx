import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import appCss from "../styles.css?url";

const themeScript = `(()=>{try{const t=localStorage.getItem("orbit-ui-theme")||"system";const d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch{}})()`;

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{
				name: "description",
				content: "A private, file-first workspace for your ideas and actions.",
			},
			{ name: "theme-color", content: "#f3f0e9" },
			{ title: "Orbit · File-first workspace" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/orbit.svg", type: "image/svg+xml" },
		],
	}),
	shellComponent: RootDocument,
});

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
