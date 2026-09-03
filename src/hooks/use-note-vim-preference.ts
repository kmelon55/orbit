import { useCallback, useEffect, useState } from "react";

export type NoteVimExitSequence = "jk" | "none";

const ENABLED_KEY = "orbit-note-vim-enabled";
const EXIT_SEQUENCE_KEY = "orbit-note-vim-exit-sequence";
const CHANGE_EVENT = "orbit-note-vim-preference-change";

function readEnabled() {
	return window.localStorage.getItem(ENABLED_KEY) === "true";
}

function readExitSequence(): NoteVimExitSequence {
	const stored = window.localStorage.getItem(EXIT_SEQUENCE_KEY);
	return stored === "none" ? stored : "jk";
}

function notifyChange() {
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useNoteVimPreference() {
	const [vimEnabled, setVimEnabledState] = useState(false);
	const [exitSequence, setExitSequenceState] =
		useState<NoteVimExitSequence>("jk");

	useEffect(() => {
		const sync = () => {
			setVimEnabledState(readEnabled());
			setExitSequenceState(readExitSequence());
		};
		sync();
		window.addEventListener("storage", sync);
		window.addEventListener(CHANGE_EVENT, sync);
		return () => {
			window.removeEventListener("storage", sync);
			window.removeEventListener(CHANGE_EVENT, sync);
		};
	}, []);

	const setVimEnabled = useCallback((next: boolean) => {
		window.localStorage.setItem(ENABLED_KEY, next ? "true" : "false");
		setVimEnabledState(next);
		notifyChange();
	}, []);

	const setExitSequence = useCallback((next: NoteVimExitSequence) => {
		window.localStorage.setItem(EXIT_SEQUENCE_KEY, next);
		setExitSequenceState(next);
		notifyChange();
	}, []);

	return {
		vimEnabled,
		setVimEnabled,
		exitSequence,
		setExitSequence,
	};
}
