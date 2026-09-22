import { Download, Paperclip } from "lucide-react";
import { canPreview, type MailDetail } from "#/lib/mail/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MailHtmlBody } from "./mail-html-body";

export function MailMessageContent({
	detail,
	demo,
	remoteImages,
	onToggleImages,
	showSubject = true,
	conversation = false,
}: {
	detail: MailDetail;
	demo: boolean;
	remoteImages: boolean;
	onToggleImages: () => void;
	showSubject?: boolean;
	conversation?: boolean;
}) {
	return (
		<>
			<div className={cn("space-y-3", conversation ? "px-4 pb-2 pt-3" : "p-5")}>
				{showSubject && (
					<h2 className="text-lg font-semibold leading-relaxed">
						{detail.subject}
					</h2>
				)}
				{conversation ? (
					<details className="text-xs text-muted-foreground">
						<summary className="cursor-pointer truncate">
							받는 사람: {detail.to.map((a) => a.name || a.address).join(", ")}
						</summary>
						<div className="mt-2 space-y-1 break-all">
							<p>보낸 사람: {detail.from.map((a) => a.address).join(", ")}</p>
							<p>받는 사람: {detail.to.map((a) => a.address).join(", ")}</p>
							{detail.cc.length > 0 && (
								<p>참조: {detail.cc.map((a) => a.address).join(", ")}</p>
							)}
							<p>{new Date(detail.date).toLocaleString("ko-KR")}</p>
						</div>
					</details>
				) : (
					<div className="space-y-1 text-xs text-muted-foreground">
						<p className="break-all text-sm text-foreground">
							{detail.from.map((a) => `${a.name} <${a.address}>`).join(", ")}
						</p>
						<p className="break-all">
							받는 사람: {detail.to.map((a) => a.address).join(", ")}
						</p>
						{detail.cc.length > 0 && (
							<p className="break-all">
								참조: {detail.cc.map((a) => a.address).join(", ")}
							</p>
						)}
						<p>{new Date(detail.date).toLocaleString("ko-KR")}</p>
					</div>
				)}

				{detail.attachments.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{detail.attachments.map((a) => {
							const url = `/api/mail/${demo ? "demo/" : ""}attachment?message=${detail.id}&part=${a.id}`;
							return (
								<div
									key={a.id}
									className="flex max-w-full items-center gap-2 rounded-lg border p-2 text-xs"
								>
									<Paperclip className="size-3.5 shrink-0" />
									<a
										className="truncate underline-offset-2 hover:underline"
										href={canPreview(a.type) ? url : `${url}&download=1`}
										target="_blank"
										rel="noreferrer"
									>
										{a.name}
									</a>
									<span className="shrink-0 text-muted-foreground">
										{a.size > 1048576
											? `${(a.size / 1048576).toFixed(1)} MB`
											: `${Math.ceil(a.size / 1024)} KB`}
									</span>
									<a
										href={`${url}&download=1`}
										aria-label={`${a.name} 다운로드`}
									>
										<Download className="size-3.5" />
									</a>
								</div>
							);
						})}
					</div>
				)}
			</div>
			{detail.html ? (
				<>
					{detail.hasRemoteImages && (
						<div className="flex items-center justify-between border-y bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
							<span>
								{remoteImages ? "외부 이미지 표시 중" : "외부 이미지 숨김"}
							</span>
							<Button variant="ghost" size="sm" onClick={onToggleImages}>
								{remoteImages ? "숨기기" : "이미지 표시"}
							</Button>
						</div>
					)}
					<MailHtmlBody
						key={`${detail.id}:${remoteImages}`}
						html={detail.html}
					/>
				</>
			) : (
				<div
					className={cn(
						"whitespace-pre-wrap break-words text-sm",
						conversation ? "px-4 pb-4 leading-6" : "px-5 pb-8 leading-7",
					)}
				>
					{detail.text || "본문이 없는 메일입니다."}
				</div>
			)}
		</>
	);
}
