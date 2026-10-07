import { useState } from "react";
import { useI18n } from "./locale-provider";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select";

export function LanguageSelect({
	id = "ui-language",
	compact = false,
}: {
	id?: string;
	compact?: boolean;
}) {
	const { t, locale, setLocale, changingLocale, errorText } = useI18n();
	const [error, setError] = useState("");
	return (
		<div className="grid gap-2">
			<Select
				value={locale}
				disabled={changingLocale}
				onValueChange={(value) => {
					setError("");
					void setLocale(value as "ko" | "en").catch(() =>
						setError("언어를 저장하지 못했습니다."),
					);
				}}
			>
				<SelectTrigger
					id={id}
					aria-label={t("언어")}
					className={compact ? "h-8 w-28 text-xs" : "w-full"}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="ko">한국어</SelectItem>
					<SelectItem value="en">English</SelectItem>
				</SelectContent>
			</Select>
			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{errorText(error)}
				</p>
			) : null}
		</div>
	);
}
