import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/components/locale-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

export function ModeToggle() {
	const { t } = useI18n();

	const { resolvedTheme, setTheme } = useTheme();
	const isDark = resolvedTheme === "dark";
	return (
		<Button
			variant="ghost"
			size="icon"
			type="button"
			onClick={() => setTheme(isDark ? "light" : "dark")}
			aria-label={isDark ? t("라이트 모드로 전환") : t("다크 모드로 전환")}
		>
			{isDark ? <Sun /> : <Moon />}
		</Button>
	);
}
