import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TaskCheck({
	checked,
	animate = false,
	className,
	...props
}: {
	checked: boolean;
	animate?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			type="button"
			aria-pressed={checked}
			data-slot="task-check"
			data-checked={checked ? "true" : "false"}
			data-animate={animate ? "true" : undefined}
			className={cn(
				"orbit-task-check relative grid size-5 shrink-0 place-items-center rounded-full border-2 transition-[background-color,border-color,box-shadow,color] duration-200 ease-[var(--interaction-ease)] after:absolute after:-inset-2 after:content-[''] disabled:opacity-100",
				checked
					? "border-foreground bg-foreground text-background shadow-sm"
					: "border-foreground/45 bg-background text-foreground/0 hover:border-foreground/80 hover:bg-muted hover:text-foreground/35",
				className,
			)}
			{...props}
		>
			<svg
				viewBox="0 0 16 16"
				className="size-3"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M3.4 8.2 6.6 11.3 12.6 4.6"
					className="orbit-task-check-mark"
					stroke="currentColor"
					strokeWidth="2.15"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</button>
	);
}

export function TaskExit({
	active,
	children,
}: {
	active: boolean;
	children: ReactNode;
}) {
	return (
		<div
			data-exiting={active ? "true" : undefined}
			className={cn(
				"grid",
				active
					? "pointer-events-none grid-rows-[0fr] translate-x-2 opacity-0 transition-[grid-template-rows,opacity,transform] duration-300 ease-[var(--interaction-ease)] motion-reduce:transition-none"
					: "grid-rows-[1fr] opacity-100",
			)}
		>
			<div className="min-h-0 overflow-hidden">{children}</div>
		</div>
	);
}

export function TaskEmpty({
	show,
	animate = true,
	children,
}: {
	show: boolean;
	animate?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			aria-hidden={!show}
			className={cn(
				"grid",
				animate &&
					"transition-[grid-template-rows,opacity] duration-300 ease-[var(--interaction-ease)] motion-reduce:transition-none",
				show
					? "grid-rows-[1fr] opacity-100"
					: "pointer-events-none grid-rows-[0fr] opacity-0",
			)}
		>
			<div className="min-h-0 overflow-hidden">{children}</div>
		</div>
	);
}

export function taskTitleClass(checked: boolean, className?: string) {
	return cn(
		"truncate transition-[color,text-decoration-color] duration-300 ease-[var(--interaction-ease)]",
		checked
			? "text-muted-foreground line-through decoration-foreground/35"
			: "decoration-transparent",
		className,
	);
}
