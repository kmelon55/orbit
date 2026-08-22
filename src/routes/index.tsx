import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
	ArrowUp,
	CalendarDays,
	Check,
	Circle,
	FileText,
	Inbox,
	ListTodo,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { loadOrbit, mutateOrbit } from "#/lib/orbit/functions";
import type { OrbitItem, OrbitItemType } from "#/lib/orbit/schema";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/")({
	loader: () => loadOrbit(),
	component: TodayPage,
});

function formatTime(value?: string) {
	if (!value) return "시간 미정";
	const time = value.match(/T(\d{2}:\d{2})/)?.[1];
	return time ?? value;
}

function TodayPage() {
	const snapshot = Route.useLoaderData();
	const router = useRouter();
	const [capture, setCapture] = useState("");
	const [kind, setKind] =
		useState<Extract<OrbitItemType, "note" | "task">>("note");
	const [isSaving, setIsSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const recentNotes = useMemo(
		() =>
			snapshot.items
				.filter((item) => item.type === "note" && item.space !== "archive")
				.slice(0, 4),
		[snapshot.items],
	);

	async function handleCapture(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const title = capture.trim();
		if (!title || isSaving) return;
		setIsSaving(true);
		setMessage(null);
		try {
			await mutateOrbit({
				data: {
					action: "capture",
					input: { title, type: kind, body: "" },
				},
			});
			setCapture("");
			setMessage(
				kind === "task" ? "할 일을 추가했습니다." : "노트를 만들었습니다.",
			);
			await router.invalidate();
		} catch {
			setMessage("저장하지 못했습니다. 데이터 폴더 권한을 확인해 주세요.");
		} finally {
			setIsSaving(false);
		}
	}

	async function completeTask(item: OrbitItem) {
		await mutateOrbit({ data: { action: "toggle-task", id: item.id } });
		await router.invalidate();
	}

	return (
		<AppShell>
			<main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
				<header className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="mb-2 text-xs font-medium text-muted-foreground">
							{snapshot.displayDate.longLabel}
						</p>
						<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
							Today
						</h1>
						<p className="mt-1.5 text-sm text-muted-foreground">
							오늘 처리할 일과 기록을 한곳에서 봅니다.
						</p>
					</div>
					<Badge variant="outline" className="w-fit font-normal">
						<span className="mr-1 size-1.5 rounded-full bg-emerald-500" />
						파일에 직접 저장
					</Badge>
				</header>

				<form
					onSubmit={handleCapture}
					className="mb-10 rounded-lg border bg-card p-3 shadow-xs"
				>
					<div className="flex items-center gap-2">
						<Input
							value={capture}
							onChange={(event) => setCapture(event.target.value)}
							placeholder={
								kind === "task"
									? "해야 할 일을 입력하세요"
									: "새 노트의 제목을 입력하세요"
							}
							aria-label="빠른 기록"
							className="h-10 border-0 bg-transparent shadow-none focus-visible:ring-0"
						/>
						<Button
							type="submit"
							size="icon"
							disabled={!capture.trim() || isSaving}
						>
							<ArrowUp />
							<span className="sr-only">저장</span>
						</Button>
					</div>
					<Separator className="my-2" />
					<div className="flex items-center justify-between px-1">
						<div className="flex gap-1">
							<Button
								type="button"
								size="sm"
								variant={kind === "note" ? "secondary" : "ghost"}
								onClick={() => setKind("note")}
							>
								<FileText /> 노트
							</Button>
							<Button
								type="button"
								size="sm"
								variant={kind === "task" ? "secondary" : "ghost"}
								onClick={() => setKind("task")}
							>
								<ListTodo /> 할 일
							</Button>
						</div>
						{message && (
							<output className="text-xs text-muted-foreground">
								{message}
							</output>
						)}
					</div>
				</form>

				<div className="grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
					<section>
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-sm font-medium">오늘 할 일</h2>
							<span className="text-xs tabular-nums text-muted-foreground">
								{snapshot.today.tasks.length}
							</span>
						</div>
						<div className="overflow-hidden rounded-lg border bg-card">
							{snapshot.today.tasks.length > 0 ? (
								snapshot.today.tasks.map((task, index) => (
									<div key={task.id}>
										{index > 0 && <Separator />}
										<div className="flex min-h-16 items-center gap-3 px-4 py-3">
											<Button
												variant="outline"
												size="icon-sm"
												onClick={() => completeTask(task)}
												aria-label={`${task.title} 완료`}
												className="rounded-full text-transparent hover:text-foreground"
											>
												<Check />
											</Button>
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm font-medium">
													{task.title}
												</p>
												<p className="mt-1 text-xs text-muted-foreground">
													{task.project ??
														(task.space === "inbox" ? "Inbox" : task.space)}
												</p>
											</div>
										</div>
									</div>
								))
							) : (
								<EmptyState icon={Circle} title="오늘 할 일이 없습니다" />
							)}
						</div>

						<div className="mb-3 mt-10 flex items-center justify-between">
							<h2 className="text-sm font-medium">최근 노트</h2>
							<Link
								to="/notes"
								className="text-xs text-muted-foreground hover:text-foreground"
							>
								모두 보기
							</Link>
						</div>
						<div className="grid gap-3 sm:grid-cols-2">
							{recentNotes.length > 0 ? (
								recentNotes.map((note) => (
									<Link
										key={note.id}
										to="/notes"
										className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
									>
										<FileText className="mb-5 size-4 text-muted-foreground" />
										<h3 className="truncate text-sm font-medium">
											{note.title}
										</h3>
										<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
											{note.body || "내용이 없는 노트"}
										</p>
									</Link>
								))
							) : (
								<div className="sm:col-span-2">
									<EmptyState icon={FileText} title="아직 노트가 없습니다" />
								</div>
							)}
						</div>
					</section>

					<section>
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-sm font-medium">오늘 일정</h2>
							<span className="text-xs tabular-nums text-muted-foreground">
								{snapshot.today.events.length}
							</span>
						</div>
						<div className="overflow-hidden rounded-lg border bg-card">
							{snapshot.today.events.length > 0 ? (
								snapshot.today.events.map((event, index) => (
									<div key={event.id}>
										{index > 0 && <Separator />}
										<div className="flex gap-3 px-4 py-4">
											<div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted">
												<CalendarDays className="size-4" />
											</div>
											<div>
												<p className="text-sm font-medium">{event.title}</p>
												<p className="mt-1 text-xs text-muted-foreground">
													{formatTime(event.start)}
												</p>
											</div>
										</div>
									</div>
								))
							) : (
								<EmptyState icon={CalendarDays} title="오늘 일정이 없습니다" />
							)}
						</div>

						<div className="mt-6 rounded-lg border border-dashed p-4">
							<div className="flex items-start gap-3">
								<Inbox className="mt-0.5 size-4 text-muted-foreground" />
								<div>
									<p className="text-sm font-medium">
										Inbox {snapshot.counts.inbox}
									</p>
									<p className="mt-1 text-xs leading-5 text-muted-foreground">
										분류되지 않은 파일입니다. 자동 정리는 아직 적용하지
										않습니다.
									</p>
								</div>
							</div>
						</div>
					</section>
				</div>
			</main>
		</AppShell>
	);
}

function EmptyState({
	icon: Icon,
	title,
}: {
	icon: typeof Circle;
	title: string;
}) {
	return (
		<div className="flex min-h-28 flex-col items-center justify-center px-4 text-center">
			<Icon className="mb-2 size-4 text-muted-foreground" />
			<p className="text-xs text-muted-foreground">{title}</p>
		</div>
	);
}
