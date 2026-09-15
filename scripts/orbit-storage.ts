import { closeOrbitDatabases } from "../src/lib/orbit/database";
import {
	backupOrbitDirectory,
	exportOrbitDirectory,
	importOrbitDirectory,
	storageStatus,
} from "../src/lib/orbit/storage-transfer";
async function main() {
	const [command, directory] = process.argv
		.slice(2)
		.filter((arg) => arg !== "--");
	try {
		let result: unknown;
		if (command === "status" || command === "migrate")
			result = await storageStatus();
		else if (command === "export" && directory)
			result = await exportOrbitDirectory(directory);
		else if (command === "import" && directory)
			result = await importOrbitDirectory(directory);
		else if (command === "backup" && directory)
			result = await backupOrbitDirectory(directory);
		else
			throw new Error(
				"Usage: pnpm storage <migrate|status|export|import|backup> [directory]. Set ORBIT_VAULT_DIR first. Export/backup requires a new directory outside the active vault.",
			);
		console.log(JSON.stringify(result, null, 2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	} finally {
		closeOrbitDatabases();
	}
}
void main();
