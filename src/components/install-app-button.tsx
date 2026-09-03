import { Download, Share, SquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

type InstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		("standalone" in navigator &&
			(navigator as Navigator & { standalone?: boolean }).standalone === true)
	);
}

export function InstallAppButton() {
	const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
	const [ios, setIos] = useState(false);
	const [installed, setInstalled] = useState(true);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		setInstalled(isStandalone());
		setIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
		const onPrompt = (event: Event) => {
			event.preventDefault();
			setPrompt(event as InstallPromptEvent);
		};
		const onInstalled = () => {
			setInstalled(true);
			setPrompt(null);
		};
		window.addEventListener("beforeinstallprompt", onPrompt);
		window.addEventListener("appinstalled", onInstalled);
		return () => {
			window.removeEventListener("beforeinstallprompt", onPrompt);
			window.removeEventListener("appinstalled", onInstalled);
		};
	}, []);

	if (installed || (!ios && !prompt)) return null;

	async function install() {
		if (!prompt) {
			setOpen(true);
			return;
		}
		await prompt.prompt();
		const choice = await prompt.userChoice;
		if (choice.outcome === "accepted") setPrompt(null);
	}

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				className="ml-auto h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs md:hidden"
				onClick={() => void install()}
			>
				<Download className="size-3.5" /> 설치
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-sm rounded-2xl">
					<DialogHeader>
						<DialogTitle>Orbit을 홈 화면에 설치</DialogTitle>
						<DialogDescription>
							브라우저에서 아래 두 단계만 진행하면 주소창 없이 앱처럼 열립니다.
						</DialogDescription>
					</DialogHeader>
					<ol className="space-y-3 text-sm">
						<li className="flex items-center gap-3 rounded-xl bg-muted/70 p-3">
							<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background shadow-sm">
								<Share className="size-4" />
							</span>
							<span>
								화면 아래의 <strong>공유</strong> 버튼을 누릅니다.
							</span>
						</li>
						<li className="flex items-center gap-3 rounded-xl bg-muted/70 p-3">
							<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background shadow-sm">
								<SquarePlus className="size-4" />
							</span>
							<span>
								<strong>홈 화면에 추가</strong>를 선택합니다.
							</span>
						</li>
					</ol>
					<Button onClick={() => setOpen(false)}>확인</Button>
				</DialogContent>
			</Dialog>
		</>
	);
}
