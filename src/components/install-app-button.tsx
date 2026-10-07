import { Download, Share, SquarePlus } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/components/locale-provider";
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
	const { t } = useI18n();

	const [open, setOpen] = useState(false);
	const { ready, installed, platform, canInstall, install, confirmInstalled } =
		usePwaInstall();

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
				<Download className="size-3.5" /> {t("설치")}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-sm rounded-2xl">
					<DialogHeader>
						<DialogTitle>{t("Orbit을 홈 화면에 설치")}</DialogTitle>
						<DialogDescription>
							{t(
								"브라우저에서 아래 두 단계만 진행하면 주소창 없이 앱처럼 열립니다.",
							)}
						</DialogDescription>
					</DialogHeader>
					<ol className="space-y-3 text-sm">
						<li className="flex items-center gap-3 rounded-xl bg-muted/70 p-3">
							<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background shadow-sm">
								<Share className="size-4" />
							</span>
							<span>
								{t("화면 아래의")}
								<strong>{t("공유")}</strong> {t("버튼을 누릅니다.")}
							</span>
						</li>
						<li className="flex items-center gap-3 rounded-xl bg-muted/70 p-3">
							<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background shadow-sm">
								<SquarePlus className="size-4" />
							</span>
							<span>
								<strong>{t("홈 화면에 추가")}</strong>
								{t("를 선택합니다.")}
							</span>
						</li>
						<li className="flex items-center gap-3 rounded-xl bg-muted/70 p-3">
							<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-xs font-semibold shadow-sm">
								3
							</span>
							<span>
								<strong>{t("웹 앱으로 열기")}</strong>
								{t("를 켜고 추가합니다.")}
							</span>
						</li>
					</ol>
					<Button
						onClick={() => {
							confirmInstalled();
							setOpen(false);
						}}
					>
						{t("설치했어요")}
					</Button>
				</DialogContent>
			</Dialog>
		</>
	);
}
