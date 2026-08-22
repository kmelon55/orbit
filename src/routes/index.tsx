import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
	Archive,
	ArrowUp,
	BookOpen,
	CalendarDays,
	Check,
	ChevronDown,
	Circle,
	Clock3,
	Command,
	FileText,
	FolderKanban,
	Inbox,
	LayoutGrid,
	Link2,
	Menu,
	MoreHorizontal,
	Plus,
	Search,
	Settings2,
	Sparkles,
	Tag,
	X,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { loadOrbit, mutateOrbit } from "#/lib/orbit/functions";
import type { OrbitItem, OrbitItemType } from "#/lib/orbit/schema";

export const Route = createFileRoute("/")({
	loader: () => loadOrbit(),
	component: Home,
});

const captureKinds: Array<{
	value: OrbitItemType;
	label: string;
	icon: typeof FileText;
}> = [
	{ value: "note", label: "메모", icon: FileText },
	{ value: "task", label: "할 일", icon: Check },
	{ value: "event", label: "일정", icon: CalendarDays },
	{ value: "link", label: "링크", icon: Link2 },
];

function formatTime(value?: string) {
	if (!value) return "시간 미정";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("ko-KR", {
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

function formatDue(value?: string) {
	if (!value) return "오늘 목록";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("ko-KR", {
		month: "short",
		day: "numeric",
	}).format(date);
}

function initials(value: string) {
	return value.trim().slice(0, 1).toUpperCase() || "O";
}

function Home() {
	const snapshot = Route.useLoaderData();
	const router = useRouter();
	const [capture, setCapture] = useState("");
	const [kind, setKind] = useState<OrbitItemType>("note");
	const [isSaving, setIsSaving] = useState(false);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const inboxItems = useMemo(
		() => snapshot.items.filter((item) => item.space === "inbox").slice(0, 4),
		[snapshot.items],
	);
	const upcomingEvents = useMemo(
		() =>
			snapshot.items
				.filter((item) => item.type === "event" && item.start)
				.sort((left, right) =>
					(left.start ?? "").localeCompare(right.start ?? ""),
				)
				.slice(0, 3),
		[snapshot.items],
	);

	async function handleCapture(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const title = capture.trim();
		if (!title || isSaving) return;
		setIsSaving(true);
		setNotice(null);
		try {
			await mutateOrbit({
				data: {
					action: "capture",
					input: { title, type: kind, body: "" },
				},
			});
			setCapture("");
			setNotice("Inbox에 파일로 저장했어요.");
			await router.invalidate();
		} catch {
			setNotice("저장하지 못했어요. 데이터 폴더 권한을 확인해 주세요.");
		} finally {
			setIsSaving(false);
		}
	}

	async function toggleTask(item: OrbitItem) {
		setNotice(null);
		try {
			await mutateOrbit({ data: { action: "toggle-task", id: item.id } });
			await router.invalidate();
		} catch {
			setNotice("작업 상태를 변경하지 못했어요.");
		}
	}

	return (
		<div className="app-frame">
			{sidebarOpen && (
				<button
					className="sidebar-backdrop"
					type="button"
					onClick={() => setSidebarOpen(false)}
					aria-label="사이드바 닫기"
				/>
			)}
			<aside className={`sidebar ${sidebarOpen ? "sidebar--open" : ""}`}>
				<div className="brand-row">
					<div className="brand-mark" aria-hidden="true">
						<span />
					</div>
					<span className="brand-name">Orbit</span>
					<button
						className="mobile-close"
						type="button"
						onClick={() => setSidebarOpen(false)}
						aria-label="사이드바 닫기"
					>
						<X size={18} />
					</button>
				</div>

				<nav className="primary-nav" aria-label="워크스페이스">
					<NavItem icon={LayoutGrid} label="Today" active />
					<NavItem icon={Inbox} label="Inbox" count={snapshot.counts.inbox} />
					<NavItem
						icon={FolderKanban}
						label="Projects"
						count={snapshot.counts.projects}
					/>
					<NavItem icon={Circle} label="Areas" count={snapshot.counts.areas} />
					<NavItem
						icon={BookOpen}
						label="Resources"
						count={snapshot.counts.resources}
					/>
					<NavItem icon={Archive} label="Archive" />
				</nav>

				<div className="sidebar-spacer" />
				<div className="agent-card">
					<div className="agent-card__topline">
						<span className="agent-dot" />
						<span>Agent interface</span>
					</div>
					<strong>MCP ready</strong>
					<p>Hermes와 원하는 에이전트가 같은 파일을 읽습니다.</p>
					<button type="button">
						연결 안내 <ArrowUp size={13} />
					</button>
				</div>
				<button className="workspace-switcher" type="button">
					<span className="avatar">K</span>
					<span>
						<strong>My Orbit</strong>
						<small>Local workspace</small>
					</span>
					<MoreHorizontal size={17} />
				</button>
			</aside>

			<section className="workspace">
				<header className="topbar">
					<button
						className="mobile-menu"
						type="button"
						onClick={() => setSidebarOpen(true)}
						aria-label="메뉴 열기"
					>
						<Menu size={20} />
					</button>
					<div className="breadcrumb">
						<span>My Orbit</span>
						<span>/</span>
						<strong>Today</strong>
					</div>
					<div className="topbar-actions">
						<button className="search-button" type="button">
							<Search size={17} />
							<span>검색</span>
							<kbd>⌘ K</kbd>
						</button>
						<button className="icon-button" type="button" aria-label="설정">
							<Settings2 size={18} />
						</button>
					</div>
				</header>

				<main className="content">
					<section className="hero-section">
						<div>
							<p className="eyebrow">{snapshot.displayDate.longLabel}</p>
							<h1>좋은 아침이에요.</h1>
							<p className="hero-copy">오늘 중요한 것만 궤도에 올려보세요.</p>
						</div>
						<div className="privacy-pill">
							<span />
							<span>Private · File first</span>
						</div>
					</section>

					<section className="capture-card" aria-label="빠른 기록">
						<form onSubmit={handleCapture}>
							<div className="capture-input-row">
								<Plus size={20} />
								<input
									value={capture}
									onChange={(event) => setCapture(event.target.value)}
									placeholder="무엇이든 기록하세요…"
									aria-label="기록할 내용"
								/>
								<button
									className="capture-submit"
									type="submit"
									disabled={!capture.trim() || isSaving}
								>
									{isSaving ? (
										<span className="saving-dot" />
									) : (
										<ArrowUp size={17} />
									)}
								</button>
							</div>
							<div className="capture-toolbar">
								<div className="capture-kinds">
									{captureKinds.map((option) => {
										const Icon = option.icon;
										return (
											<button
												key={option.value}
												className={kind === option.value ? "is-selected" : ""}
												type="button"
												onClick={() => setKind(option.value)}
											>
												<Icon size={14} /> {option.label}
											</button>
										);
									})}
								</div>
								<span className="capture-hint">
									<Command size={13} /> Enter로 저장
								</span>
							</div>
						</form>
						{notice && <output className="notice">{notice}</output>}
					</section>

					<div className="dashboard-grid">
						<section className="main-column">
							<div className="section-heading">
								<div>
									<span className="heading-kicker">FOCUS</span>
									<h2>오늘 할 일</h2>
								</div>
								<span className="item-count">
									{snapshot.today.tasks.length}
								</span>
							</div>
							<div className="task-list">
								{snapshot.today.tasks.length > 0 ? (
									snapshot.today.tasks.map((task) => (
										<article className="task-row" key={task.id}>
											<button
												type="button"
												className="task-check"
												onClick={() => toggleTask(task)}
												aria-label={`${task.title} 완료`}
											>
												<Check size={13} />
											</button>
											<div className="task-copy">
												<h3>{task.title}</h3>
												<div className="task-meta">
													<span>
														<FolderKanban size={13} />{" "}
														{task.project ??
															(task.space === "inbox" ? "Inbox" : "Orbit")}
													</span>
													<span>
														<Clock3 size={13} /> {formatDue(task.due)}
													</span>
												</div>
											</div>
											<button
												className="row-menu"
												type="button"
												aria-label="작업 메뉴"
											>
												<MoreHorizontal size={18} />
											</button>
										</article>
									))
								) : (
									<EmptyState
										title="오늘은 비어 있어요"
										body="Inbox에서 할 일을 만들거나 위에서 바로 기록하세요."
									/>
								)}
							</div>

							<div className="section-heading section-heading--recent">
								<div>
									<span className="heading-kicker">INBOX</span>
									<h2>최근 기록</h2>
								</div>
								<button type="button">
									모두 보기 <ArrowUp size={14} />
								</button>
							</div>
							<div className="recent-grid">
								{inboxItems.length > 0 ? (
									inboxItems.map((item) => (
										<InboxCard key={item.id} item={item} />
									))
								) : (
									<EmptyState
										title="Inbox가 깨끗해요"
										body="생각, 링크, 할 일을 형식 없이 남겨보세요."
										compact
									/>
								)}
							</div>
						</section>

						<aside className="agenda-column">
							<div className="section-heading">
								<div>
									<span className="heading-kicker">SCHEDULE</span>
									<h2>다가오는 일정</h2>
								</div>
								<button
									className="calendar-button"
									type="button"
									aria-label="캘린더 열기"
								>
									<CalendarDays size={16} />
								</button>
							</div>
							<div className="date-card">
								<div className="date-card__day">
									<strong>{snapshot.displayDate.day}</strong>
									<span>{snapshot.displayDate.month}</span>
								</div>
								<div>
									<span>{snapshot.displayDate.weekday}</span>
									<p>{snapshot.today.tasks.length}개의 할 일</p>
								</div>
								<ChevronDown size={16} />
							</div>
							<div className="timeline">
								{upcomingEvents.length > 0 ? (
									upcomingEvents.map((event) => (
										<div className="timeline-event" key={event.id}>
											<div className="timeline-time">
												{formatTime(event.start)}
											</div>
											<div className="timeline-line">
												<span />
											</div>
											<div className="event-card">
												<span className="event-label">
													{event.project ?? "EVENT"}
												</span>
												<h3>{event.title}</h3>
												{event.body && <p>{event.body}</p>}
											</div>
										</div>
									))
								) : (
									<div className="empty-agenda">
										<CalendarDays size={19} />
										<strong>예정된 일정이 없어요</strong>
										<span>일정을 기록하면 여기에 나타납니다.</span>
									</div>
								)}
							</div>
							<div className="orbit-insight">
								<div className="insight-icon">
									<Sparkles size={16} />
								</div>
								<div>
									<span>ORBIT NOTE</span>
									<p>
										자동 분류는 선택 사항입니다. 원본 파일은 언제나 그대로
										남아요.
									</p>
								</div>
							</div>
						</aside>
					</div>
				</main>
				<footer className="statusbar">
					<span>
						<span className="status-dot" /> Files synced locally
					</span>
					<span className="vault-path">{snapshot.vaultPath}</span>
				</footer>
			</section>
		</div>
	);
}

function NavItem({
	icon: Icon,
	label,
	count,
	active = false,
}: {
	icon: typeof Inbox;
	label: string;
	count?: number;
	active?: boolean;
}) {
	return (
		<button
			className={`nav-item ${active ? "nav-item--active" : ""}`}
			type="button"
		>
			<Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
			<span>{label}</span>
			{typeof count === "number" && <small>{count}</small>}
		</button>
	);
}

function InboxCard({ item }: { item: OrbitItem }) {
	const Icon =
		item.type === "link"
			? Link2
			: item.type === "task"
				? Check
				: item.type === "event"
					? CalendarDays
					: FileText;
	return (
		<article className="inbox-card">
			<div className="inbox-card__icon">
				<Icon size={16} />
			</div>
			<div className="inbox-card__copy">
				<h3>{item.title}</h3>
				<p>{item.body || `${item.type} · ${item.path}`}</p>
			</div>
			<div className="inbox-card__footer">
				<span>
					<Tag size={12} /> {item.tags[0] ?? "미분류"}
				</span>
				<span className="mini-avatar">{initials(item.title)}</span>
			</div>
		</article>
	);
}

function EmptyState({
	title,
	body,
	compact = false,
}: {
	title: string;
	body: string;
	compact?: boolean;
}) {
	return (
		<div className={`empty-state ${compact ? "empty-state--compact" : ""}`}>
			<div className="empty-state__icon">
				<Circle size={17} />
			</div>
			<div>
				<strong>{title}</strong>
				<p>{body}</p>
			</div>
		</div>
	);
}
