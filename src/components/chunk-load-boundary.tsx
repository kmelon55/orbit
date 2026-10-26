import type { ErrorComponentProps } from "@tanstack/react-router";
import {
	Component,
	type ComponentPropsWithRef,
	type ComponentType,
	lazy,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import { translate } from "#/lib/i18n";
import {
	hasEditedPage,
	isChunkLoadError,
	recoverChunkLoad,
} from "#/lib/orbit/chunk-recovery";

function LoadNotice({
	retry,
	chunk = true,
}: {
	retry: () => void;
	chunk?: boolean;
}) {
	const locale =
		typeof document !== "undefined" && document.documentElement.lang === "en"
			? "en"
			: "ko";
	const t = (message: string) => translate(locale, message);
	useEffect(() => {
		if (chunk) void recoverChunkLoad();
	}, [chunk]);
	return (
		<div
			aria-live="polite"
			className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center"
		>
			<p className="text-sm font-medium">{t("화면을 다시 불러와야 해요.")}</p>
			<p className="text-sm text-muted-foreground">
				{t("입력 중인 내용이 있다면 먼저 저장해 주세요.")}
			</p>
			<div className="flex gap-3">
				<button
					type="button"
					className="rounded-md border px-3 py-2 text-sm"
					onClick={retry}
				>
					{t("다시 시도")}
				</button>
				<button
					type="button"
					className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
					onClick={() => {
						if (
							hasEditedPage() &&
							!window.confirm(
								t("저장하지 않은 내용은 사라질 수 있어요. 새로고침할까요?"),
							)
						)
							return;
						location.reload();
					}}
				>
					{t("새로고침")}
				</button>
			</div>
		</div>
	);
}

class ChunkBoundary extends Component<
	{ children: ReactNode; retry: () => void },
	{ error: unknown }
> {
	state: { error: unknown } = { error: null };
	static getDerivedStateFromError(error: unknown) {
		return { error };
	}
	render() {
		if (!this.state.error) return this.props.children;
		if (!isChunkLoadError(this.state.error)) throw this.state.error;
		return <LoadNotice retry={this.props.retry} />;
	}
}

// Keep the surrounding form mounted when a lazy editor or panel cannot load.
// Retrying creates a fresh React.lazy instead of reusing its rejected promise.
// Match React.lazy's component constraint so memo/forwardRef props are inferred.
// biome-ignore lint/suspicious/noExplicitAny: the concrete component's props are preserved below
export function lazyWithRecovery<T extends ComponentType<any>>(
	load: () => Promise<{ default: T }>,
) {
	const Initial = lazy(load);
	return function RecoverableComponent(props: ComponentPropsWithRef<T>) {
		const [{ View, attempt }, setView] = useState({
			View: Initial,
			attempt: 0,
		});
		return (
			<ChunkBoundary
				key={attempt}
				retry={() =>
					setView((current) => ({
						View: lazy(load),
						attempt: current.attempt + 1,
					}))
				}
			>
				<View {...props} />
			</ChunkBoundary>
		);
	};
}

export function RouteLoadError({ error, reset }: ErrorComponentProps) {
	return <LoadNotice retry={reset} chunk={isChunkLoadError(error)} />;
}
