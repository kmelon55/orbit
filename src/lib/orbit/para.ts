import type { OrbitItem, OrbitItemType, OrbitSpace } from "./schema";

export type ParaSpaceId = "project" | "area" | "resource";
export type FolderSpaceId = ParaSpaceId | "archive";

export type NavSpace = {
	id: "inbox" | "project" | "area" | "resource" | "archive" | "event";
	href:
		| "/"
		| "/inbox"
		| "/projects"
		| "/areas"
		| "/resources"
		| "/archive"
		| "/calendar";
	folderHref?: "/projects/$folder" | "/areas/$folder" | "/resources/$folder";
	label: string;
	korean: string;
	description: string;
	hint: string;
	vault: "inbox" | "projects" | "areas" | "resources" | "archive" | "events";
	space: OrbitSpace;
};

export const PARA_SPACES: Array<
	NavSpace & {
		id: ParaSpaceId;
		folderHref: "/projects/$folder" | "/areas/$folder" | "/resources/$folder";
	}
> = [
	{
		id: "project",
		href: "/projects",
		folderHref: "/projects/$folder",
		label: "Projects",
		korean: "프로젝트",
		description: "기한과 완료 조건이 있는 일",
		hint: "끝이 보이는 목표만 넣습니다. 끝나면 Archive로 옮깁니다.",
		vault: "projects",
		space: "project",
	},
	{
		id: "area",
		href: "/areas",
		folderHref: "/areas/$folder",
		label: "Areas",
		korean: "영역",
		description: "계속 관리하는 책임 영역",
		hint: "건강, 재정, 팀처럼 끝나지 않는 기준을 둡니다.",
		vault: "areas",
		space: "area",
	},
	{
		id: "resource",
		href: "/resources",
		folderHref: "/resources/$folder",
		label: "Resources",
		korean: "자료",
		description: "나중에 꺼내 볼 참고 자료",
		hint: "관심 주제와 레퍼런스를 주제별 폴더에 모아 둡니다.",
		vault: "resources",
		space: "resource",
	},
];

export const ARCHIVE_SPACE: NavSpace = {
	id: "archive",
	href: "/archive",
	label: "Archive",
	korean: "보관",
	description: "지금은 쓰지 않는 항목",
	hint: "끝난 프로젝트와 더 이상 쓰지 않는 자료를 넣습니다.",
	vault: "archive",
	space: "archive",
};

export const INBOX_SPACE: NavSpace = {
	id: "inbox",
	href: "/inbox",
	label: "Inbox",
	korean: "인박스",
	description: "일단 넣고, 나중에 나눕니다",
	hint: "생각날 때 분류하지 마세요. 모아 두고 한 번에 Projects · Areas · Resources · Archive로 옮깁니다.",
	vault: "inbox",
	space: "inbox",
};

export const ITEM_TYPE_LABEL: Record<OrbitItemType, string> = {
	note: "노트",
	task: "할 일",
	event: "일정",
	link: "링크",
};

export const SPACE_LABEL: Record<OrbitSpace, string> = {
	inbox: "Inbox",
	project: "Projects",
	area: "Areas",
	resource: "Resources",
	event: "Calendar",
	archive: "Archive",
};

export function spaceConfig(space: OrbitSpace): NavSpace | undefined {
	if (space === "inbox") return INBOX_SPACE;
	if (space === "archive") return ARCHIVE_SPACE;
	return PARA_SPACES.find((item) => item.space === space);
}

export function folderOf(item: OrbitItem) {
	if (item.folder) return item.folder;
	const parts = item.path.split("/");
	if (
		(parts[0] === "projects" ||
			parts[0] === "areas" ||
			parts[0] === "resources" ||
			parts[0] === "archive") &&
		parts.length >= 3
	) {
		return parts.slice(1, -1).join("/");
	}
	return undefined;
}

export function itemsInSpace(items: OrbitItem[], space: OrbitSpace) {
	return items.filter((item) => item.space === space);
}

export function itemsInFolder(
	items: OrbitItem[],
	space: FolderSpaceId,
	folder: string,
) {
	return items.filter(
		(item) => item.space === space && folderOf(item) === folder,
	);
}

export function unfiledInSpace(items: OrbitItem[], space: FolderSpaceId) {
	return items.filter((item) => item.space === space && !folderOf(item));
}

export function formatUpdated(value: string) {
	return value.replace("T", " ").slice(0, 16).replaceAll("-", ".");
}

export function formatDateTime(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return formatUpdated(value);
	return new Intl.DateTimeFormat("ko-KR", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

export function formatDayKey(date = new Date()) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function itemDayKey(item: OrbitItem) {
	return (item.start ?? item.due)?.slice(0, 10);
}
