import { FileText, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OrbitItem } from "#/lib/orbit/schema";
import type { NoteEditorAnchor } from "@/components/note-editor";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export function NoteLinkPicker({
	items,
	currentId,
	open,
	anchor,
	onOpenChange,
	onSelect,
}: {
	items: OrbitItem[];
	currentId: string;
	open: boolean;
	anchor: NoteEditorAnchor | null;
	onOpenChange: (open: boolean) => void;
	onSelect: (item: OrbitItem) => void;
}) {
	const [query, setQuery] = useState("");
	const panelRef = useRef<HTMLDivElement>(null);
	const notes = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		return items
			.filter((item) => item.id !== currentId)
			.filter((item) =>
				needle
					? `${item.title}\n${item.body}\n${item.tags.join(" ")}`
							.toLocaleLowerCase()
							.includes(needle)
					: true,
			)
			.slice(0, 80);
	}, [currentId, items, query]);

	useEffect(() => {
		if (!open) return;
		const closeOnOutsideClick = (event: PointerEvent) => {
			if (!panelRef.current?.contains(event.target as Node)) {
				setQuery("");
				onOpenChange(false);
			}
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setQuery("");
				onOpenChange(false);
			}
		};
		document.addEventListener("pointerdown", closeOnOutsideClick);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOnOutsideClick);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [onOpenChange, open]);

	if (!open || !anchor || typeof document === "undefined") return null;
	const panelWidth = Math.min(352, window.innerWidth - 24);
	const left = Math.max(
		12,
		Math.min(anchor.left, window.innerWidth - panelWidth - 12),
	);
	const top = Math.max(12, Math.min(anchor.top, window.innerHeight - 356));

	return createPortal(
		<div
			ref={panelRef}
			role="dialog"
			aria-label="노트 연결"
			style={{ left, top, width: panelWidth }}
			className="fixed z-[70] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl"
		>
			<div className="border-b p-2">
				<div className="relative">
					<Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						autoFocus
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search notes · 노트 검색"
						className="h-9 border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0"
					/>
				</div>
			</div>
			<ScrollArea className="h-72">
				<div className="space-y-1 p-2">
					{notes.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => {
								onSelect(item);
								onOpenChange(false);
								setQuery("");
							}}
							className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted"
						>
							<FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<span className="min-w-0">
								<span className="block truncate text-sm font-medium">
									{item.title}
								</span>
								<span className="mt-0.5 block truncate text-xs text-muted-foreground">
									{item.folder ?? item.space}
								</span>
							</span>
						</button>
					))}
					{notes.length === 0 ? (
						<p className="px-3 py-10 text-center text-sm text-muted-foreground">
							연결할 노트를 찾지 못했습니다.
						</p>
					) : null}
				</div>
			</ScrollArea>
		</div>,
		document.body,
	);
}
