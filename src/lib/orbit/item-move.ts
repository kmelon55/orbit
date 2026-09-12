import type { OrbitItem, OrbitSpace } from "./schema";

const SPACE_DIRECTORY: Record<OrbitSpace, string> = {
	inbox: "inbox",
	project: "projects",
	area: "areas",
	resource: "resources",
	event: "events",
	archive: "archive",
};

export function moveItemLocally(
	item: OrbitItem,
	space: OrbitSpace,
	folder?: string,
): OrbitItem {
	const destinationSpace =
		item.type === "event" && space !== "archive" ? "event" : space;
	const destinationFolder =
		destinationSpace === "inbox" || destinationSpace === "event"
			? undefined
			: folder;
	return {
		...item,
		space: destinationSpace,
		folder: destinationFolder,
		// folderOf also reads the path, so a move to the root must update both.
		// The server will supply the final filename if a collision renames it.
		path: [
			SPACE_DIRECTORY[destinationSpace],
			destinationFolder,
			item.path.split("/").at(-1),
		]
			.filter(Boolean)
			.join("/"),
	};
}
