import { useEffect } from "react";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export function ServiceWorkerRegister() {
	usePwaInstall();
	useEffect(() => {
		if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
		void navigator.serviceWorker.register("/sw.js", { scope: "/" });
	}, []);
	return null;
}
