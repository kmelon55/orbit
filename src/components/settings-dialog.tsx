import {
	BadgeCheck,
	Download,
	Keyboard,
	Monitor,
	Moon,
	Palette,
	Settings,
	Share,
	Smartphone,
	SquarePlus,
	Sun,
	X,
} from "lucide-react";
import { Dialog as DialogPrimitive, Switch as SwitchPrimitive } from "radix-ui";
import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	type NoteVimExitSequence,
	useNoteVimPreference,
} from "@/hooks/use-note-vim-preference";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { cn } from "@/lib/utils";

type SettingsSection = "appearance" | "editor" | "install";

const navigation = [
	{ id: "appearance", label: "화면", icon: Palette },
	{ id: "editor", label: "에디터", icon: Keyboard },
	{ id: "install", label: "앱 설치", icon: Smartphone },
] as const;

const exitSequences: Array<{
	value: NoteVimExitSequence;
	label: string;
	description: string;
}> = [
	{ value: "jk", label: "j k", description: "빠르게 jk 입력" },
	{ value: "none", label: "사용 안 함", description: "Esc만 사용" },
];

function InstallSettings() {
	const { ready, installed, platform, canInstall, install } = usePwaInstall();
	const [installing, setInstalling] = useState(false);
	const [message, setMessage] = useState<string>();

	async function requestInstall() {
		if (!canInstall || installing) return;
		setInstalling(true);
		setMessage(undefined);
		try {
			const outcome = await install();
			if (outcome === "dismissed") {
				setMessage("설치를 취소했습니다. 원할 때 다시 시도할 수 있습니다.");
			} else if (outcome === "unavailable") {
				setMessage("브라우저 메뉴에서 앱 설치를 선택해 주세요.");
			}
		} catch {
			setMessage("설치창을 열지 못했습니다. 브라우저 메뉴를 이용해 주세요.");
		} finally {
			setInstalling(false);
		}
	}

	return (
		<>
			<DialogHeader className="pr-10">
				<DialogTitle>앱 설치</DialogTitle>
				<DialogDescription>
					Orbit을 홈 화면에 추가하면 브라우저 주소창 없이 앱처럼 열 수 있습니다.
				</DialogDescription>
			</DialogHeader>

			<div className="mt-7 grid gap-4">
				{installed ? (
					<div className="flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-4">
						<BadgeCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
						<div>
							<h2 className="text-sm font-medium">
								이 기기에 설치되어 있습니다
							</h2>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">
								홈 화면이나 앱 목록에서 Orbit을 바로 열 수 있습니다.
							</p>
						</div>
					</div>
				) : platform === "ios" ? (
					<section className="grid gap-4">
						<div className="flex items-start gap-3 rounded-xl border border-border/70 p-4">
							<Smartphone className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
							<div>
								<h2 className="text-sm font-medium">iPhone 또는 iPad</h2>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									iOS에서는 Safari 메뉴를 이용해 직접 홈 화면에 추가합니다.
								</p>
							</div>
						</div>
						<ol className="grid gap-2 text-sm">
							<li className="flex items-center gap-3 rounded-xl bg-muted/55 p-3">
								<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background shadow-sm">
									<Share className="size-4" />
								</span>
								<span>
									Safari에서 <strong>공유</strong> 버튼을 누릅니다.
								</span>
							</li>
							<li className="flex items-center gap-3 rounded-xl bg-muted/55 p-3">
								<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background shadow-sm">
									<SquarePlus className="size-4" />
								</span>
								<span>
									<strong>홈 화면에 추가</strong>를 선택합니다.
								</span>
							</li>
							<li className="flex items-center gap-3 rounded-xl bg-muted/55 p-3">
								<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-xs font-semibold shadow-sm">
									3
								</span>
								<span>
									<strong>웹 앱으로 열기</strong>를 켠 뒤 추가합니다.
								</span>
							</li>
						</ol>
					</section>
				) : (
					<section className="grid gap-4">
						<div className="flex items-start gap-3 rounded-xl border border-border/70 p-4">
							<Download className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
							<div>
								<h2 className="text-sm font-medium">
									{platform === "android"
										? "Android 앱으로 설치"
										: "이 기기에 설치"}
								</h2>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									설치하면 홈 화면과 앱 목록에서 Orbit을 빠르게 실행할 수
									있습니다.
								</p>
							</div>
						</div>

						{canInstall ? (
							<Button
								className="w-full"
								disabled={installing}
								onClick={() => void requestInstall()}
							>
								<Download /> {installing ? "설치창 여는 중" : "Orbit 설치"}
							</Button>
						) : (
							<div className="rounded-xl bg-muted/55 p-4 text-xs leading-5 text-muted-foreground">
								{ready
									? "브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해 주세요. 설치 조건이 충족되면 이곳에 설치 버튼이 나타납니다."
									: "이 기기의 설치 가능 여부를 확인하고 있습니다."}
							</div>
						)}
					</section>
				)}

				{message ? (
					<output className="block text-xs text-muted-foreground">
						{message}
					</output>
				) : null}
			</div>
		</>
	);
}

export function SettingsDialog() {
	const [section, setSection] = useState<SettingsSection>("editor");
	const { theme, setTheme } = useTheme();
	const { vimEnabled, setVimEnabled, exitSequence, setExitSequence } =
		useNoteVimPreference();

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-8 text-muted-foreground"
					title="설정"
				>
					<Settings className="size-4" />
					<span className="sr-only">설정</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="min-h-[34rem] overflow-hidden p-0 sm:max-w-3xl">
				<div className="grid min-h-[34rem] sm:grid-cols-[12rem_1fr]">
					<aside className="border-b border-border/70 bg-muted/35 p-3 sm:border-r sm:border-b-0">
						<div className="flex h-11 items-center px-2 text-sm font-semibold">
							설정
						</div>
						<nav aria-label="설정 메뉴" className="flex gap-1 sm:grid">
							{navigation.map((item) => {
								const Icon = item.icon;
								return (
									<button
										type="button"
										key={item.id}
										onClick={() => setSection(item.id)}
										className={cn(
											"flex h-9 flex-1 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors sm:flex-none",
											section === item.id
												? "bg-background text-foreground shadow-sm ring-1 ring-foreground/5"
												: "hover:bg-background/60 hover:text-foreground",
										)}
									>
										<Icon className="size-4" />
										{item.label}
									</button>
								);
							})}
						</nav>
					</aside>

					<div className="relative min-w-0 p-5 sm:p-7">
						<DialogPrimitive.Close asChild>
							<Button
								variant="ghost"
								size="icon"
								className="absolute top-4 right-4 size-8 text-muted-foreground"
								aria-label="설정 닫기"
							>
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>

						{section === "appearance" ? (
							<>
								<DialogHeader className="pr-10">
									<DialogTitle>화면</DialogTitle>
									<DialogDescription>
										Orbit의 화면 테마를 선택합니다.
									</DialogDescription>
								</DialogHeader>
								<section className="mt-7 grid gap-3">
									<h2 className="text-xs font-semibold text-muted-foreground">
										테마
									</h2>
									<div className="grid grid-cols-3 gap-2">
										{[
											{ value: "light", label: "라이트", icon: Sun },
											{ value: "dark", label: "다크", icon: Moon },
											{ value: "system", label: "시스템", icon: Monitor },
										].map((option) => {
											const Icon = option.icon;
											return (
												<button
													type="button"
													key={option.value}
													onClick={() => setTheme(option.value as typeof theme)}
													className={cn(
														"grid justify-items-center gap-2 rounded-xl border p-4 text-xs transition-colors",
														theme === option.value
															? "border-foreground/25 bg-muted text-foreground"
															: "border-border/70 text-muted-foreground hover:bg-muted/60",
													)}
												>
													<Icon className="size-5" />
													{option.label}
												</button>
											);
										})}
									</div>
								</section>
							</>
						) : section === "editor" ? (
							<>
								<DialogHeader className="pr-10">
									<DialogTitle>에디터</DialogTitle>
									<DialogDescription>
										노트를 작성할 때 사용할 편집 방식을 설정합니다.
									</DialogDescription>
								</DialogHeader>
								<div className="mt-7 grid gap-6">
									<section className="grid gap-3">
										<h2 className="text-xs font-semibold text-muted-foreground">
											모달 편집
										</h2>
										<div className="flex items-start justify-between gap-5 rounded-xl border border-border/70 p-4">
											<div className="grid gap-1">
												<label
													htmlFor="note-vim-mode"
													className="text-sm font-medium"
												>
													Vim 모드
												</label>
												<p className="text-xs leading-5 text-muted-foreground">
													일반·입력·비주얼 모드와 Vim 이동 키를 사용합니다.
												</p>
											</div>
											<SwitchPrimitive.Root
												id="note-vim-mode"
												checked={vimEnabled}
												onCheckedChange={setVimEnabled}
												className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full bg-input shadow-inner outline-none transition-colors data-[state=checked]:bg-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
											>
												<SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-[1.125rem]" />
											</SwitchPrimitive.Root>
										</div>
									</section>

									<section className="grid gap-3">
										<div>
											<h2 className="text-sm font-medium">입력 모드 종료</h2>
											<p className="mt-1 text-xs leading-5 text-muted-foreground">
												영문 입력 상태에서 jk를 빠르게 입력하면 일반 모드로
												전환합니다. 한글 입력 중에는 Vim 명령을 해석하지
												않습니다.
											</p>
										</div>
										<div className="grid grid-cols-2 gap-2">
											{exitSequences.map((option) => (
												<button
													type="button"
													key={option.value}
													disabled={!vimEnabled}
													onClick={() => setExitSequence(option.value)}
													className={cn(
														"grid gap-1 rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-45",
														exitSequence === option.value
															? "border-foreground/25 bg-muted"
															: "border-border/70 hover:bg-muted/60",
													)}
												>
													<kbd className="font-mono text-sm font-semibold">
														{option.label}
													</kbd>
													<span className="text-[0.68rem] text-muted-foreground">
														{option.description}
													</span>
												</button>
											))}
										</div>
									</section>
								</div>
							</>
						) : (
							<InstallSettings />
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
