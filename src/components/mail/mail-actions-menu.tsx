import {
	Archive,
	Ban,
	Copy,
	Forward,
	Inbox,
	Mail,
	MailOpen,
	Reply,
	ReplyAll,
	ShieldAlert,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { MailAction, MailMessage } from "#/lib/mail/types";
import { useI18n } from "@/components/locale-provider";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MailActionsMenu({
	message,
	blocked,
	canBlock,
	busy,
	dropdown = false,
	children,
	onOpen,
	onCompose,
	onAction,
	onUnblock,
}: {
	message: MailMessage;
	blocked: boolean;
	canBlock: boolean;
	busy: boolean;
	dropdown?: boolean;
	children: ReactNode;
	onOpen: () => void;
	onCompose: (mode: "reply" | "all" | "forward") => void;
	onAction: (action: MailAction) => void;
	onUnblock: () => void;
}) {
	const { t } = useI18n();

	const Root = dropdown ? DropdownMenu : ContextMenu;
	const Trigger = dropdown ? DropdownMenuTrigger : ContextMenuTrigger;
	const Content = dropdown ? DropdownMenuContent : ContextMenuContent;
	const Item = dropdown ? DropdownMenuItem : ContextMenuItem;
	const Separator = dropdown ? DropdownMenuSeparator : ContextMenuSeparator;
	async function copy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(t("복사했습니다."));
		} catch {
			toast.error(t("복사하지 못했습니다."));
		}
	}
	return (
		<Root>
			<Trigger asChild>{children}</Trigger>
			<Content className="min-w-48">
				<Item onSelect={onOpen}>
					<MailOpen />
					{t("메일 열기")}
				</Item>
				<Item
					disabled={busy}
					onSelect={() => window.setTimeout(() => onCompose("reply"), 0)}
				>
					<Reply />
					{t("답장")}
				</Item>
				<Item
					disabled={busy}
					onSelect={() => window.setTimeout(() => onCompose("all"), 0)}
				>
					<ReplyAll />
					{t("전체 답장")}
				</Item>
				<Item
					disabled={busy}
					onSelect={() => window.setTimeout(() => onCompose("forward"), 0)}
				>
					<Forward />
					{t("전달")}
				</Item>
				<Separator />
				<Item
					disabled={busy}
					onSelect={() => onAction(message.unread ? "read" : "unread")}
				>
					<Mail />
					{message.unread ? t("읽음으로 표시") : t("읽지 않음으로 표시")}
				</Item>
				{message.folder !== "inbox" && (
					<Item disabled={busy} onSelect={() => onAction("inbox")}>
						<Inbox />
						{blocked
							? t("차단 해제 후 받은 메일함으로")
							: message.folder === "spam"
								? t("스팸 해제 · 받은 메일함으로")
								: t("받은 메일함으로 이동")}
					</Item>
				)}
				{message.folder !== "archive" && (
					<Item disabled={busy} onSelect={() => onAction("archive")}>
						<Archive />
						{t("보관")}
					</Item>
				)}
				{message.folder !== "spam" && (
					<Item disabled={busy} onSelect={() => onAction("spam")}>
						<ShieldAlert />
						{t("스팸함으로 이동")}
					</Item>
				)}
				{canBlock && (
					<Item
						disabled={busy}
						onSelect={blocked ? onUnblock : () => onAction("block")}
					>
						<Ban />
						{blocked ? t("발신자 차단 해제") : t("발신자 차단 · 스팸 이동")}
					</Item>
				)}
				{message.folder !== "trash" && (
					<Item
						disabled={busy}
						variant="destructive"
						onSelect={() => onAction("trash")}
					>
						<Trash2 />
						{t("휴지통으로 이동")}
					</Item>
				)}
				<Separator />
				<Item
					disabled={!message.from[0]?.address}
					onSelect={() => void copy(message.from[0]?.address || "")}
				>
					<Copy />
					{t("발신자 주소 복사")}
				</Item>
				<Item onSelect={() => void copy(message.subject)}>
					<Copy />
					{t("제목 복사")}
				</Item>
			</Content>
		</Root>
	);
}
