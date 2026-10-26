// Shared by the web/API write path and both MCP servers. These are fallbacks;
// an explicit category (including null for deliberate review) always wins.
export const SCHEDULE_INTENT_GUIDANCE =
	"Classify tasks and events before saving: development, API/MCP, marketing, sales and business operations use business; household, health, exercise and private appointments use personal. Use existing custom category IDs when appropriate. Leave category null only when genuinely unclear or mixed and needing user review; omission uses conservative inference. Use task for work with a completion outcome, including development, testing, writing, marketing preparation and self-review, even when time-blocked. Use event for actual appointments, meetings, performances, travel or operating periods. Search existing tasks before scheduling work; update the same task instead of creating a duplicate event. A date-only task deadline belongs in due, with no start/end. Only set start/end to an actual requested work period; never invent times. Date-only events require allDay=true and a genuinely all-day event, not merely an unknown time. Preserve existing dates, completion and custom categories when editing.";

type ClassificationInput = {
	type: string;
	title: string;
	body?: string;
	folder?: string;
	projectFolder?: string;
	category?: string | null;
};

const business =
	/개발|마케팅|광고|매출|순이익|손익|정산|사업|사무실|고객|유료|판매|펀딩|와디즈|리워드|배포|버그|데이터베이스|플레이북|랜딩|\b(?:draft|algorixm|nexit|payple|creem|wadiz|api|mcp|development|deploy|debug|marketing|sales|revenue|business|client|customer|invoice|payroll|landing\s?page)\b|trigger\.dev/i;
const personal =
	/세탁|빨래|집안|청소|로봇청소기|운동|헬스|병원|치과|진료|건강검진|염색|미용실|가족|생일|친구|개인\s*(?:약속|용무|생활)|\b(?:personal|laundry|vacuum|work\s?out|gym|dentist|doctor|haircut|dyeing hair|family|birthday)\b/i;

function classify(text: string) {
	const work = business.test(text);
	const privateLife = personal.test(text);
	return work === privateLife ? undefined : work ? "business" : "personal";
}

export function inferScheduleCategory(input: ClassificationInput) {
	if (input.category !== undefined) return input.category ?? undefined;
	if (input.type !== "task" && input.type !== "event") return undefined;
	const context = [input.title, input.folder, input.projectFolder]
		.filter(Boolean)
		.join(" ");
	// Conflicting signals stay unclassified; a long pasted body cannot override
	// a clear title/project or resolve a mixed context by accident.
	if (business.test(context) || personal.test(context))
		return classify(context);
	return classify(input.body ?? "");
}

export function looksLikeTask(title: string) {
	// A work topic does not turn a real meeting into a task. Preparation for
	// that meeting is different; only use an explicit preparation suffix here.
	if (
		/(?:준비|자료 작성|안건 작성)(?:하기)?$|\b(?:preparation|prep)$/i.test(
			title,
		)
	)
		return true;
	if (
		/회의|미팅|면담|예약|공연|휴가|여행|\b(?:meeting|appointment|conference|concert|vacation|trip)\b/i.test(
			title,
		)
	)
		return false;
	return /개발|구현|수정|검수|검증|테스트|점검|준비|작성|제작|분석|정리|확정|신청|온보딩|안정화|배포|\b(?:implement|develop|fix|debug|test|prepare|write|build|review|deploy)\b/i.test(
		title,
	);
}

export function agentScheduleIssue(input: {
	type: string;
	title: string;
	start?: string | null;
	end?: string | null;
	allDay?: boolean;
}) {
	if (input.end && (!input.start || input.end < input.start))
		return "종료일은 시작일 이후여야 합니다.";
	if (
		input.start &&
		input.end &&
		input.start.includes("T") !== input.end.includes("T")
	)
		return "시작과 종료의 시간 형식을 맞춰 주세요.";
	if (input.type === "task" && input.start && !input.start.includes("T"))
		return "날짜만 정한 할 일은 start/end 대신 due에 마감일을 넣어 주세요. 작업 시간이 정해졌을 때만 start/end를 사용하세요.";
	if (input.type === "task" && input.allDay)
		return "할 일은 종일 일정으로 만들지 마세요. 마감 날짜는 due에 넣어 주세요.";
	if (input.type !== "event") return;
	if (!input.start) return "일정 시작일이 필요합니다.";
	if (looksLikeTask(input.title))
		return "완료를 확인하는 작업은 type=task로 만들어 주세요. 작업 시간이 있으면 같은 할 일에 start/end를 지정하세요.";
	if (input.start && !input.start.includes("T") && input.allDay !== true)
		return "실제 종일 일정만 allDay=true로 지정하세요. 시간이 미정인 작업은 task와 due를 사용하세요.";
	if (input.start?.includes("T") && input.allDay)
		return "allDay=true인 일정의 start/end에는 날짜만 넣어 주세요.";
}
