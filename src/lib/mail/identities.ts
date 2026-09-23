import { z } from "zod";
import type { MailAccount, MailFolder, MailMessage } from "./types";

export const aliasesSchema = z.array(z.email().max(254)).max(50);
export function mailViews(accounts: MailAccount[]) {
	return accounts.flatMap((account) =>
		account.provider === "icloud" && account.aliases?.length
			? accountAddresses(account).map((address, index) => ({
					...account,
					id: index === 0 ? account.id : `${account.id}/${address}`,
					accountId: account.id,
					email: address,
					address,
				}))
			: [{ ...account, accountId: account.id, address: "" }],
	);
}
export function mailScopes(accounts: MailAccount[], selected: string[] | null) {
	const views = mailViews(accounts);
	return accounts.flatMap((account) => {
		const picked = views.filter(
			(view) => view.accountId === account.id && selected?.includes(view.id),
		);
		if (selected !== null && !picked.length) return [];
		return [
			{
				...account,
				addresses:
					selected === null || picked.some((view) => !view.address)
						? []
						: picked.map((view) => view.address),
			},
		];
	});
}
export function accountAddresses(account: MailAccount): string[] {
	return [
		...new Set(
			[
				account.email,
				...(account.provider === "icloud" ? account.aliases || [] : []),
			].map((value) => value.toLowerCase()),
		),
	];
}

export function senderAddress(
	account: MailAccount,
	requested?: string,
): string {
	const address = (
		requested ||
		account.defaultFrom ||
		account.email
	).toLowerCase();
	if (!accountAddresses(account).includes(address))
		throw new Error(
			"등록된 발신 주소를 선택해 주세요. 메일 설정에서 주소를 확인할 수 있습니다.",
		);
	return address;
}

export function matchingAddresses(message: MailMessage, account: MailAccount) {
	const own = accountAddresses(account);
	const from = message.from.map((a) => a.address.toLowerCase());
	const sent = message.folder === "sent" || from.some((a) => own.includes(a));
	const values = sent
		? from
		: [...message.to, ...message.cc]
				.map((a) => a.address.toLowerCase())
				.concat(message.deliveredTo || []);
	return [
		...new Set(
			values
				.map((address) => address.toLowerCase())
				.filter((address) => own.includes(address)),
		),
	];
}

export function replyAddress(
	account: MailAccount,
	message?: MailMessage,
	preferred?: string,
) {
	const matches = message ? matchingAddresses(message, account) : [];
	return (
		(preferred && matches.includes(preferred) ? preferred : matches[0]) ||
		senderAddress(account, preferred)
	);
}

export function matchesAddress(
	message: MailMessage,
	address: string,
	folder: MailFolder = message.folder,
) {
	const key = address.toLowerCase();
	const received =
		[...message.to, ...message.cc].some(
			(a) => a.address.toLowerCase() === key,
		) || (message.deliveredTo || []).includes(key);
	const sent = message.from.some((a) => a.address.toLowerCase() === key);
	return folder === "sent"
		? sent
		: folder === "inbox"
			? received
			: received || sent;
}

// Delivery headers help distinguish Bcc mail when the provider supplies them.
export function deliveryAddresses(headers: string): string[] {
	return [
		...new Set(
			headers
				.replace(/\r?\n[ \t]+/g, " ")
				.split(/\r?\n/)
				.filter((line) => /^(delivered-to|x-original-to):/i.test(line))
				.flatMap(
					(line) =>
						line
							.slice(line.indexOf(":") + 1)
							.match(
								/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
							) || [],
				)
				.map((value) => value.toLowerCase()),
		),
	];
}
