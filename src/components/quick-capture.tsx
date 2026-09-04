import {
	ArrowUp,
	CalendarDays,
	FileText,
	ListTodo,
	Mic,
	MicOff,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import { formatDayKey, ITEM_TYPE_LABEL } from "#/lib/orbit/para";
import type { OrbitItemType } from "#/lib/orbit/schema";
import { DatePicker, TimePicker } from "@/components/schedule-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const KINDS: { type: OrbitItemType; icon: typeof FileText }[] = [
	{ type: "note", icon: FileText },
	{ type: "task", icon: ListTodo },
	{ type: "event", icon: CalendarDays },
];

function addHour(value: string) {
	const [hour, minute] = value.split(":").map(Number);
	const next = (hour * 60 + minute + 60) % (24 * 60);
	return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

function nextDay(value: string) {
	const [year, month, day] = value.split("-").map(Number);
	return formatDayKey(new Date(year, month - 1, day + 1));
}

type SpeechResultEvent = {
	results: ArrayLike<{
		0: { transcript: string };
	}>;
};

type SpeechRecognitionLike = {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	start: () => void;
	abort: () => void;
	onresult: ((event: SpeechResultEvent) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition() {
	if (typeof window === "undefined") return undefined;
	const speechWindow = window as typeof window & {
		SpeechRecognition?: SpeechRecognitionConstructor;
		webkitSpeechRecognition?: SpeechRecognitionConstructor;
	};
	return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

export function QuickCapture({
	onSaved,
	placeholder = "생각나는 것을 일단 적어두세요",
	initialKind = "note",
	autoFocus = false,
	className,
}: {
	onSaved?: () => void;
	placeholder?: string;
	initialKind?: Extract<OrbitItemType, "note" | "task" | "event">;
	autoFocus?: boolean;
	className?: string;
}) {
	const [capture, setCapture] = useState("");
	const [kind, setKind] = useState<OrbitItemType>(initialKind);
	const [date, setDate] = useState(() => formatDayKey());
	const [endDate, setEndDate] = useState(() => formatDayKey());
	const [startTime, setStartTime] = useState("09:00");
	const [endTime, setEndTime] = useState("10:00");
	const [message, setMessage] = useState<string | null>(null);
	const [listening, setListening] = useState(false);
	const [voiceSupported, setVoiceSupported] = useState(false);
	const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
	const speechBaseRef = useRef("");

	useEffect(() => {
		setKind(initialKind);
	}, [initialKind]);

	useEffect(() => {
		setVoiceSupported(Boolean(getSpeechRecognition()));
		return () => recognitionRef.current?.abort();
	}, []);

	function toggleVoice() {
		if (listening) {
			recognitionRef.current?.abort();
			setListening(false);
			return;
		}
		const Recognition = getSpeechRecognition();
		if (!Recognition) {
			setMessage("이 브라우저에서는 음성 입력을 지원하지 않습니다.");
			return;
		}
		const recognition = new Recognition();
		recognition.lang = "ko-KR";
		recognition.continuous = false;
		recognition.interimResults = true;
		speechBaseRef.current = capture.trim();
		recognition.onresult = (event) => {
			const transcript = Array.from(event.results)
				.map((result) => result[0]?.transcript ?? "")
				.join("")
				.trim();
			setCapture([speechBaseRef.current, transcript].filter(Boolean).join(" "));
		};
		recognition.onerror = (event) => {
			setListening(false);
			setMessage(
				event.error === "not-allowed"
					? "음성 입력을 사용하려면 마이크 권한을 허용해 주세요."
					: "음성을 인식하지 못했습니다. 다시 눌러 주세요.",
			);
		};
		recognition.onend = () => setListening(false);
		recognitionRef.current = recognition;
		setMessage(null);
		setListening(true);
		try {
			recognition.start();
		} catch {
			setListening(false);
			setMessage("음성 입력을 시작하지 못했습니다. 다시 눌러 주세요.");
		}
	}

	async function handleCapture(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const title = capture.trim();
		if (!title) return;
		if (
			kind === "event" &&
			(endDate < date || (endDate === date && endTime <= startTime))
		) {
			setMessage("종료는 시작보다 뒤여야 합니다.");
			return;
		}
		const successMessage =
			kind === "event" ? "캘린더에 추가했습니다." : "Inbox에 넣었습니다.";
		setCapture("");
		setMessage(successMessage);
		try {
			const schedule =
				kind === "task"
					? date
						? { due: date }
						: {}
					: kind === "event"
						? {
								start: `${date}T${startTime}:00`,
								end: `${endDate}T${endTime}:00`,
							}
						: {};
			await mutateOrbit({
				data:
					kind === "event"
						? {
								action: "create-item",
								input: {
									title,
									type: kind,
									body: "",
									space: "event",
									...schedule,
								},
							}
						: {
								action: "capture",
								input: { title, type: kind, body: "", ...schedule },
							},
			});
			onSaved?.();
		} catch {
			setMessage(
				`“${title}”을 저장하지 못했습니다. 데이터 폴더 권한을 확인해 주세요.`,
			);
		}
	}

	return (
		<form onSubmit={handleCapture} className={cn("orbit-card p-3", className)}>
			<div className="flex items-center gap-2">
				<Input
					autoFocus={autoFocus}
					value={capture}
					onChange={(event) => setCapture(event.target.value)}
					placeholder={placeholder}
					aria-label="빠른 기록"
					className="h-11 border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
				/>
				{voiceSupported ? (
					<Button
						type="button"
						size="icon"
						variant={listening ? "secondary" : "ghost"}
						onClick={toggleVoice}
						aria-pressed={listening}
						aria-label={listening ? "음성 입력 중지" : "음성으로 입력"}
						className={cn(
							"shrink-0",
							listening && "text-red-600 dark:text-red-400",
						)}
					>
						{listening ? <MicOff /> : <Mic />}
					</Button>
				) : null}
				<Button type="submit" size="icon" disabled={!capture.trim()}>
					<ArrowUp />
					<span className="sr-only">
						{kind === "event" ? "캘린더에 추가" : "Inbox에 넣기"}
					</span>
				</Button>
			</div>
			<Separator className="my-2" />
			{kind === "task" || kind === "event" ? (
				<div className="grid gap-2 px-1 pb-2">
					{kind === "event" ? (
						<>
							<div className="grid items-center gap-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,0.8fr)]">
								<span className="text-xs font-medium text-muted-foreground">
									시작
								</span>
								<DatePicker
									value={date}
									onChange={(value) => {
										setDate(value);
										if (endDate < value) setEndDate(value);
									}}
									label="시작 날짜"
									className="h-8 w-full px-2.5 text-xs"
								/>
								<TimePicker
									value={startTime}
									onChange={(value) => {
										setStartTime(value);
										if (endDate === date && endTime <= value) {
											const nextEndTime = addHour(value);
											setEndTime(nextEndTime);
											if (nextEndTime <= value) setEndDate(nextDay(date));
										}
									}}
									label="시작 시간"
									className="h-8 w-full px-2.5 text-xs"
								/>
							</div>
							<div className="grid items-center gap-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,0.8fr)]">
								<span className="text-xs font-medium text-muted-foreground">
									종료
								</span>
								<DatePicker
									value={endDate}
									min={date}
									onChange={setEndDate}
									label="종료 날짜"
									className="h-8 w-full px-2.5 text-xs"
								/>
								<TimePicker
									value={endTime}
									onChange={setEndTime}
									label="종료 시간"
									className="h-8 w-full px-2.5 text-xs"
								/>
							</div>
						</>
					) : (
						<div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/50 p-1">
							{[
								{ label: "오늘", value: formatDayKey() },
								{ label: "내일", value: nextDay(formatDayKey()) },
								{ label: "미정", value: "" },
							].map((option) => (
								<button
									key={option.label}
									type="button"
									onClick={() => setDate(option.value)}
									aria-pressed={date === option.value}
									className={cn(
										"min-h-10 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors",
										date === option.value &&
											"bg-background text-foreground shadow-sm",
									)}
								>
									{option.label}
								</button>
							))}
						</div>
					)}
				</div>
			) : null}
			<div className="flex flex-wrap items-center justify-between gap-2 px-1">
				<div className="flex flex-wrap gap-1">
					{KINDS.map(({ type, icon: Icon }) => (
						<Button
							key={type}
							type="button"
							size="sm"
							variant={kind === type ? "secondary" : "ghost"}
							onClick={() => {
								setKind(type);
								if (type === "event" && !date) setDate(formatDayKey());
								if (type === "task" && kind !== "task") setDate(formatDayKey());
								setMessage(null);
							}}
						>
							<Icon /> {ITEM_TYPE_LABEL[type]}
						</Button>
					))}
				</div>
				{message && (
					<output className="text-xs text-muted-foreground">{message}</output>
				)}
			</div>
		</form>
	);
}
