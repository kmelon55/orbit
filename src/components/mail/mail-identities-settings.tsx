import { useState } from "react";
import { aliasesSchema } from "#/lib/mail/identities";
import type { MailAccount } from "#/lib/mail/types";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function MailIdentitiesSettings({
	account,
	busy,
	onSave,
}: {
	account: MailAccount;
	busy: boolean;
	onSave: (aliases: string[], defaultFrom: string) => Promise<void>;
}) {
	const [text, setText] = useState((account.aliases || []).join("\n"));
	const [preferred, setPreferred] = useState(
		account.defaultFrom || account.email.toLowerCase(),
	);
	const parsed = aliasesSchema.safeParse(text.split(/[\s,;]+/).filter(Boolean));
	const aliases = parsed.success
		? [...new Set(parsed.data.map((address) => address.toLowerCase()))].filter(
				(address) => address !== account.email.toLowerCase(),
			)
		: [];
	const choices = [account.email.toLowerCase(), ...aliases];
	const defaultFrom = choices.includes(preferred) ? preferred : choices[0];
	return (
		<details className="mt-3 border-t pt-3">
			<summary className="cursor-pointer text-sm font-medium">
				도메인·발신 주소
				{account.aliases?.length ? ` · ${account.aliases.length}개` : " 추가"}
			</summary>
			<div className="mt-3 space-y-3">
				<p className="text-xs leading-relaxed text-muted-foreground">
					이 Apple 계정에서 사용 중인 전체 메일 주소를 한 줄에 하나씩
					입력하세요. 주소별로 메일함을 선택하고 해당 주소로 발송할 수 있습니다.
				</p>
				<label className="block space-y-1" htmlFor={`aliases-${account.id}`}>
					<span>추가 메일 주소</span>
					<Textarea
						id={`aliases-${account.id}`}
						value={text}
						onChange={(event) => setText(event.target.value)}
						placeholder={"hello@my-domain.com\nwork@another-domain.com"}
						rows={3}
						disabled={busy}
						spellCheck={false}
					/>
				</label>
				{!parsed.success && (
					<p role="alert" className="text-xs text-destructive">
						올바른 메일 주소를 입력해 주세요. 최대 50개까지 등록할 수 있습니다.
					</p>
				)}
				<label
					className="block space-y-1"
					htmlFor={`default-from-${account.id}`}
				>
					<span>기본 발신 주소</span>
					<Select
						value={defaultFrom}
						onValueChange={setPreferred}
						disabled={busy || !parsed.success}
					>
						<SelectTrigger id={`default-from-${account.id}`} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{choices.map((address) => (
								<SelectItem key={address} value={address}>
									{address}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</label>
				<p className="text-xs leading-relaxed text-muted-foreground">
					Apple에서 이미 설정한 주소만 등록하세요. Orbit에 입력하는 것만으로 새
					주소가 만들어지지는 않습니다. 답장은 메일을 받은 주소를 우선
					사용합니다.
				</p>
				<Button
					size="sm"
					disabled={busy || !parsed.success}
					onClick={() => void onSave(aliases, defaultFrom)}
				>
					주소 저장
				</Button>
			</div>
		</details>
	);
}
