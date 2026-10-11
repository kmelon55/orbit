import { useId, useState } from "react";
import type { DeleteFolderInput, OrbitFolder } from "#/lib/orbit/schema";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function FolderDeleteDialog({
	folder,
	itemCount,
	folderCount,
	onDelete,
	onClose,
}: {
	folder: OrbitFolder;
	itemCount: number;
	folderCount: number;
	onDelete: (input: DeleteFolderInput) => Promise<void>;
	onClose: () => void;
}) {
	const { t, errorText } = useI18n();
	const contentsId = useId();
	const nameId = useId();
	const [deleteContents, setDeleteContents] = useState(false);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const hasContents = itemCount > 0 || folderCount > 0;
	const confirmed = deleteContents
		? name.normalize("NFC") === folder.name.normalize("NFC")
		: !hasContents;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{t("폴더를 삭제할까요?")}</DialogTitle>
					<DialogDescription>
						{t("“{0}” · 항목 {1}개, 하위 폴더 {2}개", [
							folder.name,
							itemCount,
							folderCount,
						])}
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={async (event) => {
						event.preventDefault();
						if (!confirmed || busy) return;
						setBusy(true);
						setError(undefined);
						try {
							await onDelete({
								space: folder.space,
								path: folder.slug,
								deleteContents,
								confirmationName: deleteContents ? name : undefined,
							});
							onClose();
						} catch (error) {
							setError(
								error instanceof Error
									? error.message
									: t("폴더를 삭제하지 못했습니다."),
							);
							setBusy(false);
						}
					}}
				>
					<label
						htmlFor={contentsId}
						className="flex items-center gap-2 text-sm"
					>
						<Checkbox
							id={contentsId}
							checked={deleteContents}
							disabled={busy}
							onCheckedChange={(checked) => {
								setDeleteContents(checked === true);
								setName("");
								setError(undefined);
							}}
						/>
						{t("내용까지 함께 삭제")}
					</label>
					{deleteContents ? (
						<div className="space-y-2">
							<p className="text-sm text-destructive">
								{t(
									"안의 모든 항목과 하위 폴더가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.",
								)}
							</p>
							<label htmlFor={nameId} className="block space-y-2 text-sm">
								<span>
									{t("확인을 위해 “{0}”을 입력하세요.", [folder.name])}
								</span>
								<Input
									id={nameId}
									value={name}
									disabled={busy}
									onChange={(event) => setName(event.target.value)}
									autoComplete="off"
									spellCheck={false}
									aria-label={t("삭제할 폴더 이름")}
								/>
							</label>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							{t("내용까지 함께 삭제를 선택하지 않으면 빈 폴더만 삭제됩니다.")}
						</p>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{errorText(error)}
						</p>
					)}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={onClose}
						>
							{t("취소")}
						</Button>
						<Button
							type="submit"
							variant="destructive"
							disabled={!confirmed || busy}
						>
							{busy ? t("삭제 중…") : t("삭제")}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
