import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { Toaster, toast } from "sonner";
import { undoOrbit } from "#/lib/orbit/functions";
import type { MutationReceipt } from "#/lib/orbit/undo-events";
import { UndoHistory } from "#/lib/orbit/undo-history";
import { useTheme } from "./theme-provider";

type ActionEntry = MutationReceipt & { undo: () => Promise<void> };

export function ActionUndoProvider({ children }: { children: ReactNode }) {
	const router = useRouter();
	const { resolvedTheme } = useTheme();
	const history = useRef(new UndoHistory<ActionEntry>());
	const undo = useCallback(
		async (id?: string): Promise<void> => {
			const entry = id ? history.current.get(id) : history.current.latest;
			if (!entry || history.current.busy) return;
			try {
				const restored = await history.current.undo(entry.id);
				if (!restored) return;
				toast.dismiss(entry.id);
				toast.success("되돌렸습니다.", {
					description: entry.title,
					duration: 3000,
				});
				await router.invalidate().catch(() => {
					toast.error("되돌렸지만 화면을 갱신하지 못했습니다.");
				});
			} catch {
				toast.error("되돌리지 못했습니다.", {
					id: entry.id,
					description: "이후 변경된 내용이 있거나 저장에 실패했습니다.",
					duration: 10000,
					action: {
						label: "다시 시도",
						onClick: (event) => {
							event.preventDefault();
							void undo(entry.id);
						},
					},
				});
			}
		},
		[router],
	);
	useEffect(() => {
		function record(event: Event) {
			const receipt = (event as CustomEvent<MutationReceipt>).detail;
			history.current.push({
				...receipt,
				undo: async () => {
					const pending: Promise<unknown>[] = [];
					window.dispatchEvent(
						new CustomEvent("orbit:before-undo", {
							detail: { itemId: receipt.itemId, pending },
						}),
					);
					await Promise.all(pending);
					const result = await undoOrbit({ data: { id: receipt.id } });
					window.dispatchEvent(
						new CustomEvent("orbit:item-undone", { detail: result }),
					);
				},
			});
			toast.success(receipt.message, {
				id: receipt.id,
				description: receipt.title,
				duration: 10000,
				action: {
					label: "되돌리기",
					onClick: (event) => {
						event.preventDefault();
						void undo(receipt.id);
					},
				},
			});
		}
		window.addEventListener("orbit:mutation", record);
		const failed = () => toast.error("작업을 완료하지 못했습니다.");
		window.addEventListener("orbit:mutation-failed", failed);
		return () => {
			window.removeEventListener("orbit:mutation", record);
			window.removeEventListener("orbit:mutation-failed", failed);
		};
	}, [undo]);
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (
				event.defaultPrevented ||
				event.isComposing ||
				event.repeat ||
				!(event.metaKey || event.ctrlKey) ||
				event.shiftKey ||
				event.altKey ||
				event.code !== "KeyZ"
			)
				return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable ||
					target.closest(
						"input, textarea, [contenteditable='true'], [role='textbox']",
					))
			)
				return;
			if (!history.current.latest) return;
			event.preventDefault();
			void undo();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [undo]);
	return (
		<>
			{children}
			<Toaster
				theme={resolvedTheme}
				position="bottom-right"
				closeButton
				visibleToasts={3}
				toastOptions={{
					style: {
						background: "var(--popover)",
						color: "var(--popover-foreground)",
						borderColor: "var(--border)",
					},
				}}
			/>
		</>
	);
}
