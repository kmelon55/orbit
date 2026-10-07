import { useRouterState } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";

const calendarCells = Array.from({ length: 35 }, (_, position) => ({
	id: `day-${position}`,
	event: position % 3 === 0,
}));
const listRows = Array.from({ length: 7 }, (_, position) => ({
	id: `row-${position}`,
	short: position % 2 === 1,
}));

export function CanvasSkeleton() {
	return (
		<div
			aria-busy="true"
			className="relative h-full min-h-80 w-full overflow-hidden bg-muted/20 p-4"
		>
			<div className="mx-auto flex w-fit gap-2 rounded-xl border bg-background p-2">
				{listRows.map((tool) => (
					<Skeleton key={tool.id} className="size-7" />
				))}
			</div>
			<Skeleton className="absolute top-1/3 left-1/4 h-24 w-1/3 rounded-xl" />
			<Skeleton className="absolute top-2/3 left-1/2 h-16 w-1/4 rounded-xl" />
		</div>
	);
}

export function EditorSkeleton({ compact = false }: { compact?: boolean }) {
	return (
		<div
			aria-busy="true"
			className={compact ? "grid min-h-24 gap-3 p-3" : "grid gap-4 py-4"}
		>
			<Skeleton className="h-4 w-4/5" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="h-4 w-2/3" />
		</div>
	);
}

export function WorkspaceSkeleton() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const calendar = pathname === "/calendar";
	const notes = /^\/(inbox|mail|projects|areas|resources|archive)/.test(
		pathname,
	);
	return (
		<div
			aria-busy="true"
			className="flex h-full min-h-0 w-full flex-1 flex-col gap-5 overflow-hidden p-4 sm:p-6"
		>
			<div className="flex items-center justify-between gap-4">
				<Skeleton className="h-7 w-36" />
				<Skeleton className="h-8 w-24" />
			</div>
			{calendar ? (
				<div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-5 gap-px overflow-hidden rounded-xl border bg-border">
					{calendarCells.map((cell) => (
						<div key={cell.id} className="space-y-4 bg-background p-3">
							<Skeleton className="h-4 w-5" />
							{cell.event ? <Skeleton className="h-5 w-full" /> : null}
						</div>
					))}
				</div>
			) : pathname === "/whiteboards" ? (
				<CanvasSkeleton />
			) : (
				<div className="flex min-h-0 flex-1 gap-6">
					<div
						className={notes ? "w-full space-y-3 md:w-1/3" : "w-full space-y-3"}
					>
						{listRows.map((row) => (
							<div
								key={row.id}
								className="flex items-center gap-3 rounded-lg border p-4"
							>
								<Skeleton className="size-5 shrink-0" />
								<Skeleton className={row.short ? "h-4 w-1/2" : "h-4 w-2/3"} />
							</div>
						))}
					</div>
					{notes ? (
						<div className="hidden flex-1 md:block">
							<EditorSkeleton />
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}
