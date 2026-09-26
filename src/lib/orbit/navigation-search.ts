import type { MailFolder } from "../mail/types";

function text(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function day(value: unknown) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		return undefined;
	const date = new Date(`${value}T12:00:00Z`);
	return Number.isFinite(date.getTime()) &&
		date.toISOString().slice(0, 10) === value
		? value
		: undefined;
}

export function noteSearch(search: Record<string, unknown>): { note?: string } {
	return { note: text(search.note) };
}

export type CalendarSearch = {
	view?: "day" | "week" | "month";
	date?: string;
	selected?: string;
};
export function calendarSearch(
	search: Record<string, unknown>,
): CalendarSearch {
	return {
		view:
			search.view === "day" || search.view === "week" || search.view === "month"
				? search.view
				: undefined,
		date: day(search.date),
		selected: day(search.selected),
	};
}

export type MailSearch = {
	message?: string;
	connection?: string;
	demo?: boolean;
	folder?: MailFolder;
	accounts?: string[];
	q?: string;
};
export function mailSearch(search: Record<string, unknown>): MailSearch {
	return {
		message: text(search.message),
		connection: text(search.connection),
		demo:
			search.demo === "1" ||
			search.demo === 1 ||
			search.demo === true ||
			undefined,
		folder:
			search.folder === "inbox" ||
			search.folder === "sent" ||
			search.folder === "trash" ||
			search.folder === "spam" ||
			search.folder === "archive"
				? search.folder
				: undefined,
		accounts: Array.isArray(search.accounts)
			? [
					...new Set(
						search.accounts.filter(
							(id): id is string => typeof id === "string" && id.length > 0,
						),
					),
				]
			: undefined,
		q: text(search.q)?.slice(0, 200),
	};
}
