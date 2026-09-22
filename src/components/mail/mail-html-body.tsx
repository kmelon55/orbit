import { useEffect, useRef, useState } from "react";

export function MailHtmlBody({ html }: { html: string }) {
	const frame = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(420);
	useEffect(() => {
		setHeight(420);
		const resize = (event: MessageEvent) => {
			if (
				event.source !== frame.current?.contentWindow ||
				event.data?.type !== "orbit-mail-height"
			)
				return;
			const next = event.data.height;
			if (typeof next === "number" && Number.isFinite(next))
				setHeight(Math.min(100_000, Math.max(100, next)));
		};
		window.addEventListener("message", resize);
		return () => window.removeEventListener("message", resize);
	}, []);
	return (
		<iframe
			ref={frame}
			title="메일 본문"
			className="block w-full shrink-0 border-0 bg-white"
			style={{ height }}
			sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
			referrerPolicy="no-referrer"
			srcDoc={html}
		/>
	);
}
