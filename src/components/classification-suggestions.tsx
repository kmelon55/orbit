import { Link } from "@tanstack/react-router";
import { ArrowRight, Folder, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
	Classification,
	ClassificationSource,
	FolderCandidate,
	MailClassificationState,
} from "#/lib/orbit/classification";
import { classifyOrbitSource } from "#/lib/orbit/classification-functions";
import { cn } from "#/lib/utils";
import { useI18n } from "./locale-provider";
import { MailClassificationBadges } from "./mail/mail-classification-badges";
import { Button } from "./ui/button";

const spaces = { project: "프로젝트", area: "영역", resource: "자료" } as const;
const routes = {
	project: "/projects/$folder",
	area: "/areas/$folder",
	resource: "/resources/$folder",
} as const;

const requests = new Map<string, Promise<Classification>>();

export function ClassificationSuggestions({
	source,
	revision,
	beforeClassify,
	onMove,
	disabled = false,
	mailState,
	showFolders = true,
	placement = "inline",
}: {
	source: ClassificationSource;
	revision: string;
	beforeClassify?: () => Promise<void>;
	onMove?: (
		folder: FolderCandidate["folder"],
		space: FolderCandidate["space"],
	) => Promise<void>;
	disabled?: boolean;
	mailState?: MailClassificationState;
	showFolders?: boolean;
	placement?: "inline" | "panel";
}) {
	const { t, errorText } = useI18n();
	const panel = placement === "panel";
	const [noteResult, setResult] = useState<Classification | null>(null);
	const [noteBusy, setBusy] = useState(true);
	const [moving, setMoving] = useState<string>();
	const [noteError, setError] = useState("");
	const generation = useRef(0);
	const callbacks = useRef({ beforeClassify });
	callbacks.current = { beforeClassify };
	const { kind, id } = source;
	const [retry, setRetry] = useState(0);
	const result = kind === "mail" ? mailState?.result : noteResult;
	const busy =
		kind === "mail" ? !mailState || mailState.status === "pending" : noteBusy;
	const error = kind === "mail" ? mailState?.error : noteError;
	useEffect(() => {
		const current = ++generation.current;
		setResult(null);
		setError("");
		setBusy(!disabled);
		if (disabled || kind === "mail") return;
		// Wait for typing to settle, then save before classifying. The editor and
		// organize panel share one request for the same draft revision.
		const timer = setTimeout(() => {
			const key = JSON.stringify([kind, id, revision, retry]);
			let request = requests.get(key);
			if (!request) {
				request = (async () => {
					await callbacks.current.beforeClassify?.();
					return classifyOrbitSource({ data: { kind, id } });
				})();
				requests.set(key, request);
				const clear = () => {
					if (requests.get(key) === request) requests.delete(key);
				};
				void request.then(clear, clear);
			}
			void request
				.then((next) => {
					if (
						generation.current === current &&
						next.sourceRevision === revision
					)
						setResult(next);
				})
				.catch((reason: unknown) => {
					if (generation.current === current)
						setError(
							reason instanceof Error
								? reason.message
								: "분류하지 못했어요. 잠시 후 다시 시도해 주세요.",
						);
				})
				.finally(() => {
					if (generation.current === current) setBusy(false);
				});
		}, 900);
		return () => {
			clearTimeout(timer);
			generation.current++;
		};
	}, [kind, id, revision, disabled, retry]);

	async function move(folder: Classification["folders"][number]) {
		if (!onMove || moving) return;
		const current = generation.current;
		setMoving(folder.key);
		try {
			await onMove(folder.folder, folder.space);
		} catch (reason) {
			if (generation.current === current)
				setError(
					reason instanceof Error ? reason.message : "폴더로 옮기지 못했어요.",
				);
		} finally {
			setMoving(undefined);
		}
	}

	return (
		<section
			className={cn(
				"shrink-0",
				panel ? "px-3 pt-4 pb-1" : "border-b border-border/40 px-4 py-2.5",
			)}
			aria-label={t(kind === "mail" ? "메일 분류" : "폴더 추천")}
		>
			<div
				className={cn(
					panel ? "space-y-2.5" : "flex flex-wrap items-center gap-x-3 gap-y-2",
				)}
			>
				{kind === "mail" ? (
					<MailClassificationBadges state={mailState} />
				) : (
					<span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
						{busy ? (
							<LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
						) : (
							<Sparkles className="size-3.5" />
						)}
						{t(busy ? "추천 위치 찾는 중…" : "추천 위치")}
					</span>
				)}
				{kind === "item" && error && (
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs"
						onClick={() => setRetry((value) => value + 1)}
					>
						{t("다시 시도")}
					</Button>
				)}
				{mailState?.status === "unconfigured" && (
					<span className="text-xs text-muted-foreground">
						{t("설정 → AI에서 Gateway API 키를 저장해 주세요.")}
					</span>
				)}
				{showFolders && result?.folderStatus === "uncertain" && (
					<span className="text-xs text-muted-foreground">
						{t("후보를 확인해 주세요")}
					</span>
				)}
				{showFolders &&
					result?.folders.map((folder, index) => {
						const label = `${t(spaces[folder.space])} / ${folder.label}`;
						const parts = folder.label.split(" / ");
						const name = parts.at(-1) ?? folder.label;
						const parent = [
							t(spaces[folder.space]),
							...parts.slice(0, -1),
						].join(" / ");
						const className = cn(
							"group/destination flex max-w-full min-w-0 items-center text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
							panel
								? "w-full gap-3 rounded-xl border p-3"
								: "gap-2 rounded-lg px-2 py-1 text-xs hover:bg-muted/60",
							panel &&
								(index === 0
									? "border-lime-600/30 bg-lime-500/5 hover:border-lime-600/45 hover:bg-lime-500/10 dark:border-lime-400/25 dark:bg-lime-400/5 dark:hover:border-lime-400/40 dark:hover:bg-lime-400/10"
									: "border-transparent hover:bg-muted/45"),
						);
						const content = (
							<>
								<span
									className={cn(
										"grid shrink-0 place-items-center",
										panel
											? "size-9 rounded-lg bg-lime-500/12 text-lime-800 ring-1 ring-inset ring-lime-600/15 dark:bg-lime-400/12 dark:text-lime-300 dark:ring-lime-400/15"
											: "text-muted-foreground",
									)}
								>
									<Folder
										className={panel ? "size-4" : "size-3.5"}
										strokeWidth={1.6}
									/>
								</span>
								<span
									className={cn(
										"min-w-0 flex-1",
										panel
											? "flex flex-col gap-1"
											: "flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5",
									)}
								>
									{panel ? (
										<>
											<span className="break-words text-sm font-medium leading-5">
												{name}
											</span>
											<span className="break-words text-[11px] leading-4 text-muted-foreground">
												{parent}
											</span>
										</>
									) : (
										<>
											<span className="break-words text-muted-foreground">
												{parent} /
											</span>
											<span className="break-words font-medium text-foreground">
												{name}
											</span>
										</>
									)}
								</span>
								{moving === folder.key ? (
									<LoaderCircle className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
								) : (
									<ArrowRight className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover/destination:translate-x-0.5 motion-reduce:transform-none" />
								)}
							</>
						);
						return onMove ? (
							<button
								key={folder.key}
								type="button"
								className={className}
								disabled={Boolean(moving) || busy}
								onClick={() => void move(folder)}
								aria-label={t("{0}로 이동", [label])}
							>
								{content}
							</button>
						) : (
							<Link
								key={folder.key}
								to={routes[folder.space]}
								params={{ folder: folder.folder }}
								search={{ note: undefined }}
								className={className}
							>
								{content}
							</Link>
						);
					})}
				{showFolders && result && !result.folders.length && (
					<span className="text-xs text-muted-foreground">
						{t(
							result.folderStatus === "no-folders"
								? "추천할 폴더가 아직 없어요"
								: result.folderStatus === "none"
									? "적합한 폴더를 찾지 못했어요"
									: "분류하기에는 내용이 부족해요",
						)}
					</span>
				)}
			</div>
			<div aria-live="polite">
				{result?.previewOnly && (
					<p className="mt-1 text-xs text-muted-foreground">
						{t("본문을 불러오지 못해 미리보기로 분류했어요.")}
					</p>
				)}
				{result?.truncated && (
					<p className="mt-1 text-xs text-muted-foreground">
						{t("내용이 길어 앞부분을 기준으로 분류했어요.")}
					</p>
				)}
				{result?.candidatesLimited && (
					<p className="mt-1 text-xs text-muted-foreground">
						{t("관련성이 높은 폴더부터 비교했어요.")}
					</p>
				)}
				{error && (
					<p role="alert" className="mt-1 text-xs text-destructive">
						{errorText(error)}
					</p>
				)}
			</div>
		</section>
	);
}
