import { useEffect } from "react";

export function ServiceWorkerRegister() {
	useEffect(() => {
		if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
		void navigator.serviceWorker.register("/sw.js", { scope: "/" });
	}, []);
	return null;
}
