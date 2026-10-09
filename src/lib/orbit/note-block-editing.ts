import { GapCursor } from "@milkdown/kit/prose/gapcursor";
import {
	type Command,
	Selection,
	TextSelection,
} from "@milkdown/kit/prose/state";

const mediaBlocks = new Set(["image-block", "orbitVideo", "orbitCanvas"]);

/** Milkdown's text-only join skips empty paragraphs next to atomic media blocks. */
export const deleteEmptyParagraphAfterMedia: Command = (state, dispatch) => {
	const selection = state.selection;
	if (!(selection instanceof TextSelection) || !selection.empty) return false;
	const { $from } = selection;
	if (
		$from.parent.type.name !== "paragraph" ||
		$from.parent.content.size !== 0 ||
		$from.depth !== 1
	)
		return false;
	const from = $from.before();
	const to = $from.after();
	const previous = state.doc.resolve(from).nodeBefore;
	const next = state.doc.resolve(to).nodeAfter;
	// The final paragraph is the editor's typing area; its trailing plugin recreates it.
	if (!previous || !mediaBlocks.has(previous.type.name) || !next) return false;
	if (dispatch) {
		const tr = state.tr.delete(from, to);
		const boundary = tr.doc.resolve(from);
		tr.setSelection(
			next.isAtom &&
				!next.isTextblock &&
				boundary.parent.contentMatchAt(boundary.index()).defaultType
					?.isTextblock
				? new GapCursor(boundary)
				: Selection.near(boundary, 1),
		);
		dispatch(tr.scrollIntoView());
	}
	return true;
};
