import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type { Goal } from "#/lib/orbit/assistant-schema";
import { loadGoals, removeGoal, writeGoal } from "#/lib/orbit/goal-functions";
import type { GoalInput } from "#/lib/orbit/goals";
import { useI18n } from "./locale-provider";

type GoalState = {
	goals: Goal[];
	loading: boolean;
	busy: boolean;
	error: string | null;
	reload: () => Promise<void>;
	save: (input: GoalInput) => Promise<Goal[] | null>;
	remove: (goal: Goal) => Promise<boolean>;
};
const Context = createContext<GoalState | null>(null);

export function GoalProvider({ children }: { children: ReactNode }) {
	const { errorText } = useI18n();
	const [goals, setGoals] = useState<Goal[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const version = useRef(0);
	const writing = useRef(false);
	const reload = useCallback(async () => {
		if (writing.current) return;
		const request = ++version.current;
		try {
			const next = await loadGoals();
			if (request !== version.current) return;
			setGoals(next);
			setError(null);
		} catch (error) {
			if (request === version.current)
				setError(error instanceof Error ? error.message : String(error));
		} finally {
			if (request === version.current) setLoading(false);
		}
	}, []);
	useEffect(() => {
		void reload();
		window.addEventListener("focus", reload);
		return () => {
			version.current++;
			window.removeEventListener("focus", reload);
		};
	}, [reload]);

	async function mutate(request: () => Promise<Goal[]>) {
		if (writing.current) return null;
		writing.current = true;
		setBusy(true);
		version.current++;
		try {
			const next = await request();
			setGoals(next);
			setError(null);
			return next;
		} catch (error) {
			toast.error(
				errorText(error instanceof Error ? error.message : String(error)),
			);
			return null;
		} finally {
			writing.current = false;
			setBusy(false);
			setLoading(false);
		}
	}
	return (
		<Context.Provider
			value={{
				goals,
				loading,
				busy,
				error,
				reload,
				save: (input) => mutate(() => writeGoal({ data: input })),
				remove: async (goal) =>
					Boolean(
						await mutate(() =>
							removeGoal({ data: { id: goal.id, revision: goal.revision } }),
						),
					),
			}}
		>
			{children}
		</Context.Provider>
	);
}

export function useGoals() {
	const value = useContext(Context);
	if (!value) throw new Error("Goals are unavailable");
	return value;
}
