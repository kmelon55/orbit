import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { MailAccount } from "#/lib/mail/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function MailAccountFilter({
	accounts,
	selected,
	onChange,
	syncing,
	errors,
	updated,
}: {
	accounts: MailAccount[];
	selected: string[] | null;
	onChange: (ids: string[] | null) => void;
	syncing: string[];
	errors: Record<string, string>;
	updated: Record<string, number>;
}) {
	const id = useId();
	const checked = accounts.filter(
		(a) => selected === null || selected.includes(a.id),
	);
	const all = checked.length === accounts.length && accounts.length > 0;
	const label =
		all || selected === null
			? "모든 계정"
			: checked.length === 1
				? checked[0].email
				: checked.length
					? `${checked.length}개 계정 선택`
					: "계정 선택";
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					className="w-44 max-w-full justify-between font-normal sm:w-52"
					aria-label={`메일 계정: ${label}`}
				>
					<span className="truncate">{label}</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				aria-label="표시할 메일 계정"
				className="w-80 max-w-[calc(100vw-2rem)] p-1"
			>
				<label
					htmlFor={`${id}-all`}
					className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
				>
					<Checkbox
						id={`${id}-all`}
						disabled={!accounts.length}
						checked={all ? true : checked.length ? "indeterminate" : false}
						onCheckedChange={() => onChange(all ? [] : null)}
					/>
					모든 계정{" "}
					<span className="ml-auto text-xs text-muted-foreground">
						{accounts.length}
					</span>
				</label>
				<div className="my-1 border-t" />
				<div className="max-h-64 overflow-y-auto">
					{accounts.map((a) => (
						<label
							key={a.id}
							htmlFor={`${id}-${a.id}`}
							className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
						>
							<Checkbox
								id={`${id}-${a.id}`}
								checked={selected === null || selected.includes(a.id)}
								onCheckedChange={(value) => {
									const next =
										value === true
											? [...checked.map((entry) => entry.id), a.id]
											: checked
													.filter((entry) => entry.id !== a.id)
													.map((entry) => entry.id);
									onChange(next.length === accounts.length ? null : next);
								}}
							/>
							<span className="min-w-0 flex-1">
								<span className="block truncate">{a.email}</span>
								<span className="text-xs text-muted-foreground">
									{a.provider === "icloud"
										? "iCloud"
										: a.provider === "gmail"
											? "Gmail"
											: "네이버"}
								</span>
							</span>
							<span
								aria-hidden="true"
								className={cn(
									"size-1.5 shrink-0 rounded-full",
									syncing.includes(a.id)
										? "animate-pulse bg-amber-500"
										: errors[a.id] || (!updated[a.id] && a.error)
											? "bg-destructive"
											: "bg-emerald-500",
								)}
							/>
						</label>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
