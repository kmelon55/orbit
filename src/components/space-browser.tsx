import { Link, useRouter } from "@tanstack/react-router";
import { FolderPlus, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import {
	itemsInFolder,
	itemsInSpace,
	PARA_SPACES,
	type ParaSpaceId,
	unfiledInSpace,
} from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot, OrbitSpace } from "#/lib/orbit/schema";
import { FileItemForm } from "@/components/file-item-form";
import {
	ConfirmItemDialog,
	type ItemConfirmAction,
	ItemContextMenu,
} from "@/components/item-context-menu";
import { ItemWorkspace } from "@/components/item-workspace";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

function spaceMeta(space: ParaSpaceId) {
	const meta = PARA_SPACES.find((item) => item.id === space);
	if (!meta) throw new Error(`Unknown PARA space: ${space}`);
	return meta;
}

function ItemRow({
	item,
	onSelect,
	menu,
}: {
	item: OrbitItem;
	onSelect: () => void;
	menu?: Omit<Parameters<typeof ItemContextMenu>[0], "children">;
}) {
	const row = (
		<button
			type="button"
			onClick={onSelect}
			className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50"
		>
			<div className="min-w-0">
				<p className="truncate text-sm font-medium">{item.title}</p>
				<p className="mt-0.5 truncate text-xs text-muted-foreground">
					{item.body || item.path}
				</p>
			</div>
			<span className="shrink-0 text-xs text-muted-foreground">
				{item.type}
			</span>
		</button>
	);
	return menu ? <ItemContextMenu {...menu}>{row}</ItemContextMenu> : row;
}

export function SpaceIndexPage({
	snapshot,
	space,
}: {
	snapshot: OrbitSnapshot;
	space: ParaSpaceId;
}) {
	const meta = spaceMeta(space);
	const router = useRouter();
	const folders = snapshot.folders[space];
	const unfiled = unfiledInSpace(snapshot.items, space);
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);
	const [filing, setFiling] = useState<OrbitItem | null>(null);
	const [confirm, setConfirm] = useState<ItemConfirmAction | null>(null);

	async function createFolder(event: FormEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed || saving) return;
		setSaving(true);
		try {
			const created = await mutateOrbit({
				data: { action: "create-folder", input: { space, name: trimmed } },
			});
			setName("");
			await router.invalidate();
			if (created && "slug" in created && meta.folderHref) {
				await router.navigate({
					to: meta.folderHref,
					params: { folder: created.slug },
				});
			}
		} finally {
			setSaving(false);
		}
	}

	async function createNote(folder?: string) {
		const created = await mutateOrbit({
			data: {
				action: "create-item",
				input: { title: "새 노트", type: "note", body: "", space, folder },
			},
		});
		await router.invalidate();
		if (folder && created && "id" in created && meta.folderHref) {
			await router.navigate({
				to: meta.folderHref,
				params: { folder },
			});
		}
	}

	async function archiveItem(item: OrbitItem) {
		await mutateOrbit({ data: { action: "archive-item", id: item.id } });
		await router.invalidate();
	}

	async function deleteItem(item: OrbitItem) {
		await mutateOrbit({ data: { action: "delete-item", id: item.id } });
		await router.invalidate();
	}

	async function moveItem(
		item: OrbitItem,
		nextSpace: OrbitSpace,
		folder?: string,
	) {
		await mutateOrbit({
			data: {
				action: "file-item",
				id: item.id,
				input: { space: nextSpace, folder },
			},
		});
		await router.invalidate();
	}

	return (
		<>
			<ItemContextMenu onCreate={() => void createNote()}>
				<div className="h-full overflow-auto px-6 py-6 lg:px-8">
					<header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
								PARA · {meta.korean}
							</p>
							<p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
								{meta.hint}
							</p>
						</div>
						<Button variant="outline" onClick={() => void createNote()}>
							<Plus /> 루트에 노트
						</Button>
					</header>

					<form
						onSubmit={createFolder}
						className="orbit-card mb-8 flex flex-col gap-2 p-3 sm:flex-row sm:items-center"
					>
						<div className="grid size-11 place-items-center rounded-xl bg-muted">
							<FolderPlus className="size-5" />
						</div>
						<Input
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder={`${meta.korean} 폴더 이름`}
							className="h-10 border-0 bg-transparent shadow-none focus-visible:ring-0"
						/>
						<Button type="submit" disabled={!name.trim() || saving}>
							폴더 만들기
						</Button>
					</form>

					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{folders.map((folder) => (
							<ItemContextMenu
								key={folder.slug}
								createLabel="노트 추가"
								onCreate={() => void createNote(folder.slug)}
								onOpen={() => {
									if (!meta.folderHref) return;
									void router.navigate({
										to: meta.folderHref,
										params: { folder: folder.slug },
									});
								}}
							>
								<Link
									to={meta.folderHref ?? meta.href}
									params={{ folder: folder.slug }}
									className="orbit-card orbit-card-hover p-4"
								>
									<p className="text-sm font-semibold">{folder.slug}</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{folder.count}개 항목
									</p>
								</Link>
							</ItemContextMenu>
						))}
						{folders.length === 0 && (
							<div className="rounded-2xl border border-dashed p-6 text-sm leading-6 text-muted-foreground sm:col-span-2">
								아직 폴더가 없습니다. Inbox에서 분류하거나 위에서 폴더를
								만드세요.
							</div>
						)}
					</div>

					{unfiled.length > 0 && (
						<section className="mt-10">
							<h2 className="mb-3 text-sm font-semibold">폴더 없는 항목</h2>
							<div className="orbit-card overflow-hidden">
								{unfiled.map((item, index) => (
									<div key={item.id}>
										{index > 0 && <div className="h-px bg-border" />}
										<ItemRow
											item={item}
											onSelect={() => setFiling(item)}
											menu={{
												item,
												snapshot,
												onCreate: () => void createNote(),
												onOpen: () => setFiling(item),
												onFile: () => setFiling(item),
												onArchive: () => setConfirm({ kind: "archive", item }),
												onDelete: () => setConfirm({ kind: "delete", item }),
												onMove: (nextSpace, folder) =>
													void moveItem(item, nextSpace, folder),
											}}
										/>
									</div>
								))}
							</div>
						</section>
					)}
				</div>
			</ItemContextMenu>
			<Dialog
				open={filing !== null}
				onOpenChange={(open) => {
					if (!open) setFiling(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>폴더로 옮기기</DialogTitle>
						<DialogDescription>
							이 공간의 폴더를 고르거나 새로 만들 수 있습니다.
						</DialogDescription>
					</DialogHeader>
					{filing && (
						<FileItemForm
							item={filing}
							snapshot={snapshot}
							onDone={async () => {
								setFiling(null);
								await router.invalidate();
							}}
						/>
					)}
				</DialogContent>
			</Dialog>
			<ConfirmItemDialog
				action={confirm}
				onOpenChange={(open) => {
					if (!open) setConfirm(null);
				}}
				onConfirm={() => {
					if (!confirm) return;
					const next = confirm;
					setConfirm(null);
					void (next.kind === "delete"
						? deleteItem(next.item)
						: archiveItem(next.item));
				}}
			/>
		</>
	);
}

export function SpaceFolderPage({
	snapshot,
	space,
	folder,
}: {
	snapshot: OrbitSnapshot;
	space: ParaSpaceId;
	folder: string;
}) {
	const meta = spaceMeta(space);
	const items = itemsInFolder(snapshot.items, space, folder);
	return (
		<ItemWorkspace
			snapshot={snapshot}
			items={items}
			heading={folder}
			description={`${meta.label} · ${items.length}개`}
			create={{ space, folder }}
		/>
	);
}

export function ArchivePage({ snapshot }: { snapshot: OrbitSnapshot }) {
	return (
		<ItemWorkspace
			snapshot={snapshot}
			items={itemsInSpace(snapshot.items, "archive")}
			heading="Archive"
			description="지금은 쓰지 않는 항목"
			create={{ space: "archive" }}
		/>
	);
}
