import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type {
	EditorView,
	NodeView,
	NodeViewConstructor,
} from "@milkdown/kit/prose/view";
import { $nodeSchema, $remark, $view } from "@milkdown/kit/utils";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NoteCanvasPanel } from "@/components/note-canvas-panel";
import { ThemeProvider } from "@/components/theme-provider";

const CANVAS_PREFIX = "#/canvas/";

function decodeCanvasPath(url: string) {
	const encoded = url.slice(CANVAS_PREFIX.length);
	try {
		return decodeURIComponent(encoded);
	} catch {
		return encoded;
	}
}

function canvasLink(node: Record<string, unknown>) {
	if (node.type !== "paragraph" || !Array.isArray(node.children)) return null;
	if (node.children.length !== 1) return null;
	const link = node.children[0];
	if (!link || typeof link !== "object") return null;
	const value = link as Record<string, unknown>;
	if (value.type !== "link" || typeof value.url !== "string") return null;
	if (!value.url.startsWith(CANVAS_PREFIX)) return null;
	const children = Array.isArray(value.children) ? value.children : [];
	const label = children
		.map((child) =>
			child && typeof child === "object" && "value" in child
				? String(child.value ?? "")
				: "",
		)
		.join("");
	return {
		path: decodeCanvasPath(value.url),
		title: label.replace(/^(?:Whiteboard|화이트보드)\s*·\s*/i, "").trim(),
	};
}

export const orbitCanvasSchema = $nodeSchema("orbitCanvas", () => ({
	priority: 200,
	group: "block",
	atom: true,
	selectable: true,
	draggable: true,
	attrs: {
		path: { default: "", validate: "string" },
		title: { default: "Whiteboard", validate: "string" },
	},
	parseDOM: [
		{
			tag: "div[data-orbit-canvas]",
			getAttrs: (dom) =>
				dom instanceof HTMLElement
					? {
							path: dom.dataset.orbitCanvas ?? "",
							title: dom.dataset.orbitCanvasTitle ?? "Whiteboard",
						}
					: false,
		},
	],
	toDOM: (node) => [
		"div",
		{
			"data-orbit-canvas": node.attrs.path,
			"data-orbit-canvas-title": node.attrs.title,
		},
	],
	parseMarkdown: {
		match: (node) => node.type === "orbitCanvas",
		runner: (state, node, type) => {
			state.addNode(type, {
				path: String(node.path ?? ""),
				title: String(node.title ?? "Whiteboard"),
			});
		},
	},
	toMarkdown: {
		match: (node) => node.type.name === "orbitCanvas",
		runner: (state, node) => {
			const path = String(node.attrs.path);
			const title = String(node.attrs.title || "Whiteboard");
			state.addNode("paragraph", [
				{
					type: "link",
					url: `${CANVAS_PREFIX}${encodeURIComponent(path)}`,
					children: [{ type: "text", value: `Whiteboard · ${title}` }],
				},
			]);
		},
	},
}));

function replaceCanvasParagraphs(node: Record<string, unknown>) {
	if (!Array.isArray(node.children)) return;
	node.children = node.children.map((child) => {
		if (!child || typeof child !== "object") return child;
		const value = child as Record<string, unknown>;
		const canvas = canvasLink(value);
		if (canvas) return { type: "orbitCanvas", ...canvas };
		replaceCanvasParagraphs(value);
		return value;
	});
}

export const orbitCanvasRemark = $remark(
	"orbitCanvasRemark",
	() => () => (tree) =>
		replaceCanvasParagraphs(tree as unknown as Record<string, unknown>),
);

function CanvasNodeContent({
	path,
	title,
	onRename,
	onTitleChange,
}: {
	path: string;
	title: string;
	onRename: (canvas: { path: string; title: string }) => void;
	onTitleChange: (title: string) => void;
}) {
	const [expanded, setExpanded] = useState(true);
	if (!expanded) {
		return (
			<button
				type="button"
				className="my-1 flex w-full items-center rounded-lg border border-border bg-muted/60 px-3 py-2 text-left text-sm font-medium hover:bg-muted"
				onClick={() => setExpanded(true)}
			>
				Whiteboard · {title}
			</button>
		);
	}
	return (
		<NoteCanvasPanel
			canvas={{ path, title }}
			onClose={() => setExpanded(false)}
			onRename={onRename}
			onTitleChange={onTitleChange}
		/>
	);
}

class OrbitCanvasView implements NodeView {
	dom: HTMLDivElement;
	#node: ProseNode;
	#root: Root;
	#view: EditorView;
	#getPos: () => number | undefined;

	constructor(
		node: ProseNode,
		view: EditorView,
		getPos: () => number | undefined,
	) {
		this.#node = node;
		this.#view = view;
		this.#getPos = getPos;
		this.dom = document.createElement("div");
		this.dom.className = "orbit-canvas-node";
		this.dom.dataset.orbitCanvas = String(node.attrs.path);
		this.dom.contentEditable = "false";
		this.#root = createRoot(this.dom);
		this.render();
	}

	render() {
		this.#root.render(
			<ThemeProvider>
				<CanvasNodeContent
					path={String(this.#node.attrs.path)}
					title={String(this.#node.attrs.title || "Whiteboard")}
					onRename={(canvas) => this.rename(canvas)}
					onTitleChange={(title) => this.updateTitle(title)}
				/>
			</ThemeProvider>,
		);
	}

	rename(canvas: { path: string; title: string }) {
		this.updateMatchingCanvases(canvas);
		window.dispatchEvent(new Event("orbit:canvas-renamed"));
	}

	updateTitle(title: string) {
		this.updateMatchingCanvases({
			path: String(this.#node.attrs.path),
			title,
		});
	}

	updateMatchingCanvases(canvas: { path: string; title: string }) {
		const position = this.#getPos();
		if (position === undefined) return;
		const previousPath = String(this.#node.attrs.path);
		let transaction = this.#view.state.tr;
		this.#view.state.doc.descendants((node, nodePosition) => {
			if (
				node.type !== this.#node.type ||
				String(node.attrs.path) !== previousPath
			)
				return;
			transaction = transaction.setNodeMarkup(nodePosition, undefined, {
				...node.attrs,
				path: canvas.path,
				title: canvas.title,
			});
		});
		this.#view.dispatch(transaction);
	}

	update(node: ProseNode) {
		if (node.type !== this.#node.type) return false;
		this.#node = node;
		this.dom.dataset.orbitCanvas = String(node.attrs.path);
		this.render();
		return true;
	}

	stopEvent() {
		return true;
	}

	ignoreMutation() {
		return true;
	}

	destroy() {
		this.#root.unmount();
	}
}

export const orbitCanvasView = $view(
	orbitCanvasSchema.node,
	(): NodeViewConstructor =>
		(node: ProseNode, view: EditorView, getPos: () => number | undefined) =>
			new OrbitCanvasView(node, view, getPos),
);
