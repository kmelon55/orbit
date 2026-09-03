import { Download, Share, SquarePlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export function InstallAppButton() {
	const [open, setOpen] = useState(false);
	const { ready, installed, platform, canInstall, install } = usePwaInstall();

	if (!ready || installed || (platform !== "ios" && !canInstall)) return null;

	async function requestInstall() {
		if (!canInstall) {
			setOpen(true);
			return;
		}
		await install();
	}

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				className="ml-auto h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs md:hidden"
				onClick={() => void requestInstall()}
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
						<li className="flex items-center gap-3 rounded-xl bg-muted/70 p-3">
							<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-xs font-semibold shadow-sm">
								3
							</span>
							<span>
								<strong>웹 앱으로 열기</strong>를 켜고 추가합니다.
							</span>
						</li>
					</ol>
					<Button onClick={() => setOpen(false)}>확인</Button>
				</DialogContent>
			</Dialog>
		</>
	);
}
