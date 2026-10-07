import { Check, ChevronsUpDown, RotateCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

export function AiModelSelector({
	models,
	value,
	onChange,
	disabled,
	loading,
	onRefresh,
}: {
	models: string[];
	value: string;
	onChange: (model: string) => void;
	disabled: boolean;
	loading: boolean;
	onRefresh: () => void;
}) {
	const { t } = useI18n();

	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState("");
	const filtered = useMemo(() => {
		const term = filter.trim().toLocaleLowerCase();
		return term
			? models.filter((model) => model.toLocaleLowerCase().includes(term))
			: models;
	}, [filter, models]);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setFilter("");
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled}
					aria-label={t("AI 모델 선택")}
					aria-expanded={open}
					className="h-7 max-w-64 min-w-0 justify-between gap-2 px-2 text-xs font-normal"
				>
					<span className="truncate">
						{value || (loading ? t("모델 불러오는 중…") : t("모델 선택"))}
					</span>
					<ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-72 max-w-[calc(100vw-2rem)] p-1"
				aria-label={t("AI 모델 목록")}
			>
				<div className="flex items-center gap-2 border-b px-2 pb-1">
					<Search className="size-3.5 shrink-0 text-muted-foreground" />
					<Input
						autoFocus
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						placeholder={t("Gateway 모델 검색")}
						aria-label={t("AI 모델 검색")}
						className="h-8 min-w-0 flex-1 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
					/>
					<button
						type="button"
						onClick={onRefresh}
						disabled={loading}
						aria-label={t("Gateway 모델 목록 새로고침")}
						title={t("Gateway 모델 목록 새로고침")}
						className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50"
					>
						<RotateCw
							className={loading ? "size-3.5 animate-spin" : "size-3.5"}
						/>
					</button>
				</div>
				<div
					className="max-h-64 overflow-y-auto py-1"
					role="listbox"
					aria-label={t("AI 모델")}
				>
					{filtered.length ? (
						filtered.map((model) => (
							<button
								key={model}
								type="button"
								role="option"
								aria-selected={model === value}
								onClick={() => {
									onChange(model);
									setOpen(false);
									setFilter("");
								}}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none"
							>
								<span className="min-w-0 flex-1 truncate">{model}</span>
								{model === value ? (
									<Check className="size-3.5 shrink-0" />
								) : null}
							</button>
						))
					) : (
						<p className="px-2 py-4 text-center text-xs text-muted-foreground">
							{t("일치하는 모델이 없습니다.")}
						</p>
					)}
				</div>
				<div className="border-t px-2 py-1.5 text-[11px] text-muted-foreground">
					Vercel AI Gateway · {filtered.length}
					{t("개 모델")}
				</div>
			</PopoverContent>
		</Popover>
	);
}
