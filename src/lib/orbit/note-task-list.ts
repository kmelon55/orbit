import { InputRule } from "@milkdown/kit/prose/inputrules";
import { findWrapping } from "@milkdown/kit/prose/transform";

/** Turn a paragraph's checkbox shortcut into a GFM task list on Space. */
export function createNoteTaskListInputRule() {
	return new InputRule(
		/^\[([ xX]?)\] $/,
		(state, match, start, end) => {
			const $start = state.doc.resolve(start);
			if ($start.parent.type.name !== "paragraph") return null;
			const listItem = state.schema.nodes.list_item;
			const bulletList = state.schema.nodes.bullet_list;
			if (!listItem || !bulletList) return null;

			const tr = state.tr;
			const parent = $start.node(-1);
			if (parent.type === listItem) {
				// Only the first paragraph supplies a list item's checkbox marker.
				if ($start.index(-1) !== 0 || parent.attrs.checked != null) return null;
				tr.delete(start, end);
			} else {
				tr.delete(start, end);
				const range = tr.doc.resolve(start).blockRange();
				const wrapping = range && findWrapping(range, bulletList);
				if (!range || !wrapping) return null;
				tr.wrap(range, wrapping);
			}

			const $cursor = tr.selection.$from;
			return tr.setNodeMarkup($cursor.before(-1), undefined, {
				...$cursor.node(-1).attrs,
				checked: match[1].toLowerCase() === "x",
			});
		},
		{ inCodeMark: false },
	);
}
