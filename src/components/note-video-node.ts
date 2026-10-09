import { $nodeSchema, $remark, $view } from "@milkdown/kit/utils";
import { isNoteVideoUrl } from "@/lib/orbit/note-media";

export const orbitVideoSchema = $nodeSchema("orbitVideo", () => ({
	group: "block",
	atom: true,
	selectable: true,
	draggable: true,
	attrs: {
		src: { default: "", validate: "string" },
		title: { default: "Video", validate: "string" },
	},
	parseDOM: [
		{
			tag: "figure[data-orbit-video]",
			getAttrs: (dom) => {
				if (
					!(dom instanceof HTMLElement) ||
					!isNoteVideoUrl(dom.dataset.orbitVideo ?? "")
				)
					return false;
				return {
					src: dom.dataset.orbitVideo,
					title: dom.dataset.title ?? "Video",
				};
			},
		},
	],
	toDOM: (node) => [
		"figure",
		{ "data-orbit-video": node.attrs.src, "data-title": node.attrs.title },
		[
			"video",
			{
				src: node.attrs.src,
				controls: "",
				playsinline: "",
				preload: "metadata",
			},
		],
	],
	parseMarkdown: {
		match: (node) => node.type === "orbitVideo",
		runner: (state, node, type) => {
			state.addNode(type, {
				src: String(node.src),
				title: String(node.title ?? "Video"),
			});
		},
	},
	toMarkdown: {
		match: (node) => node.type.name === "orbitVideo",
		runner: (state, node) => {
			state.addNode("paragraph", [
				{
					type: "link",
					url: String(node.attrs.src),
					children: [
						{ type: "text", value: String(node.attrs.title || "Video") },
					],
				},
			]);
		},
	},
}));

function replaceVideoLinks(node: Record<string, unknown>) {
	if (!Array.isArray(node.children)) return;
	node.children = node.children.map((child) => {
		if (!child || typeof child !== "object") return child;
		const item = child as Record<string, unknown>;
		if (
			item.type === "paragraph" &&
			Array.isArray(item.children) &&
			item.children.length === 1
		) {
			const link = item.children[0];
			if (
				link.type === "link" &&
				typeof link.url === "string" &&
				isNoteVideoUrl(link.url)
			) {
				const title = Array.isArray(link.children)
					? link.children
							.map((text: { value?: string }) => text.value ?? "")
							.join("")
					: "Video";
				return { type: "orbitVideo", src: link.url, title };
			}
		}
		replaceVideoLinks(item);
		return item;
	});
}
export const orbitVideoRemark = $remark(
	"orbitVideoRemark",
	() => () => (tree) =>
		replaceVideoLinks(tree as unknown as Record<string, unknown>),
);

export const orbitVideoView = $view(orbitVideoSchema.node, () => (node) => {
	const dom = document.createElement("figure");
	dom.dataset.orbitVideo = String(node.attrs.src);
	dom.dataset.title = String(node.attrs.title);
	dom.contentEditable = "false";
	dom.className = "my-4 overflow-hidden rounded-lg border border-border";
	const video = document.createElement("video");
	video.src = String(node.attrs.src);
	video.controls = true;
	video.playsInline = true;
	video.preload = "metadata";
	video.className = "block max-h-[70vh] w-full bg-black";
	const download = document.createElement("a");
	download.href = String(node.attrs.src);
	download.download = String(node.attrs.title || "video");
	download.textContent = String(node.attrs.title || "Video");
	download.className =
		"block truncate px-3 py-2 text-sm text-muted-foreground underline";
	dom.append(video, download);
	return {
		dom,
		stopEvent: (event) =>
			event.target instanceof Node &&
			(video.contains(event.target) || download.contains(event.target)),
		ignoreMutation: () => true,
		destroy: () => {
			video.pause();
			video.removeAttribute("src");
			video.load();
		},
	};
});
