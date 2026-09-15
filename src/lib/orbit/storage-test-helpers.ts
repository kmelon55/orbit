// Raw document fixtures for product tests. Real disk migration has its own suite.
import { databaseFor, withDatabase } from "./database";
export function readFile(file: string, _encoding?: string) {
	return withDatabase(() => databaseFor().read(file).raw);
}
export function writeFile(file: string, raw: string, _options?: unknown) {
	return withDatabase(() => databaseFor().write(file, raw), true);
}
export function mkdir(directory: string, _options?: unknown) {
	return withDatabase(() => databaseFor().mkdir(directory), true);
}
export function rename(from: string, to: string) {
	return withDatabase(() => databaseFor().move(from, to), true);
}
export function unlink(file: string) {
	return withDatabase(() => databaseFor().remove(file), true);
}
