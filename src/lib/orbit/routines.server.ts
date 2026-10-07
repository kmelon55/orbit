import { databaseFor, withDatabase } from "./database";
import {
	applyRoutineMutation,
	emptyRoutineData,
	type RoutineMutation,
	routineDataSchema,
	routineMutationSchema,
} from "./routines";

export function readRoutineData() {
	return routineDataSchema.parse(
		databaseFor().metadata("routines") ?? emptyRoutineData(),
	);
}

export function mutateRoutine(input: RoutineMutation) {
	return withDatabase(() => {
		const mutation = routineMutationSchema.parse(input);
		const data = routineDataSchema.parse(
			applyRoutineMutation(readRoutineData(), mutation),
		);
		databaseFor().setMetadata("routines", data);
		return data;
	}, true);
}
