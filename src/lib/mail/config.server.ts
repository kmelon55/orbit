import { mailStore } from "./store.server";
export type MailConfig = {
	publicUrl: string;
	gmailClientId: string;
	gmailClientSecret: string;
};
export function mailConfig(): MailConfig {
	const saved = mailStore().setting<MailConfig>("config");
	return {
		publicUrl: (process.env.ORBIT_PUBLIC_URL || saved?.publicUrl || "").replace(
			/\/$/,
			"",
		),
		gmailClientId:
			process.env.ORBIT_GMAIL_CLIENT_ID || saved?.gmailClientId || "",
		gmailClientSecret:
			process.env.ORBIT_GMAIL_CLIENT_SECRET || saved?.gmailClientSecret || "",
	};
}
