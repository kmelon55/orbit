import {
	ArrowDown,
	Bell,
	CornerUpLeft,
	Flag,
	LoaderCircle,
	MessageCircle,
	Minus,
	Newspaper,
	ReceiptText,
	Tag,
	UserRound,
} from "lucide-react";
import { useI18n } from "#/components/locale-provider";
import {
	MAIL_CATEGORIES,
	MAIL_IMPORTANCE,
	type MailClassificationState,
} from "#/lib/orbit/classification";
import { cn } from "#/lib/utils";

const categoryIcons = {
	inquiry: MessageCircle,
	billing: ReceiptText,
	notification: Bell,
	newsletter: Newspaper,
	personal: UserRound,
	other: Tag,
};

export function MailClassificationBadges({
	state,
}: {
	state?: MailClassificationState;
}) {
	const { t, errorText } = useI18n();
	const result = state?.result;
	if (!result)
		return (
			<span
				className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
				title={state?.error ? errorText(state.error) : undefined}
			>
				{(!state || state.status === "pending") && (
					<LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
				)}
				{t(
					state?.status === "unconfigured"
						? "AI 설정 필요"
						: state?.status === "error"
							? "분류 대기"
							: "분류 중…",
				)}
			</span>
		);
	const CategoryIcon = result.category ? categoryIcons[result.category] : Tag;
	const ImportanceIcon =
		result.importance === "high"
			? Flag
			: result.importance === "low"
				? ArrowDown
				: Minus;
	return (
		<span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] leading-4">
			{result.category && (
				<span className="inline-flex items-center gap-1.5 text-foreground/65">
					<CategoryIcon
						className="size-3.5 shrink-0 text-muted-foreground"
						strokeWidth={1.6}
					/>
					{t(MAIL_CATEGORIES[result.category])}
				</span>
			)}
			<span
				className={cn(
					"inline-flex items-center gap-1",
					result.importance === "high"
						? "rounded-md bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-800 ring-1 ring-inset ring-amber-500/15 dark:bg-amber-400/12 dark:text-amber-300"
						: "text-muted-foreground",
				)}
			>
				<ImportanceIcon
					className={cn(
						"size-3 shrink-0",
						result.importance === "high" && "fill-amber-500/20",
					)}
					strokeWidth={1.7}
				/>
				{t(
					result.importance
						? MAIL_IMPORTANCE[result.importance]
						: "중요도 확인",
				)}
			</span>
			{result.needsReply && (
				<span className="inline-flex items-center gap-1 rounded-md bg-sky-500/8 px-1.5 py-0.5 font-medium text-sky-800 ring-1 ring-inset ring-sky-500/12 dark:bg-sky-400/10 dark:text-sky-300">
					<CornerUpLeft className="size-3 shrink-0" />
					{t("답장 요청")}
				</span>
			)}
		</span>
	);
}
