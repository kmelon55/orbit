import { Tags, X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Input } from "@/components/ui/input";

function parseTags(value: string) {
	return Array.from(
		new Set(
			value
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean),
		),
	).slice(0, 30);
}

export function NoteMetadataEditor({
	title,
	tags,
	onTitleChange,
	onTagsChange,
}: {
	title: string;
	tags: string;
	onTitleChange: (value: string) => void;
	onTagsChange: (value: string) => void;
}) {
	const [localTitle, setLocalTitle] = useState(title);
	const [tagItems, setTagItems] = useState(() => parseTags(tags));
	const [tagDraft, setTagDraft] = useState("");

	function updateTitle(value: string) {
		setLocalTitle(value);
		onTitleChange(value);
	}

	function commitTags(next: string[]) {
		const unique = Array.from(
			new Set(next.map((tag) => tag.trim()).filter(Boolean)),
		).slice(0, 30);
		setTagItems(unique);
		onTagsChange(unique.join(", "));
	}

	function addTagDraft() {
		const additions = parseTags(tagDraft);
		if (additions.length > 0) commitTags([...tagItems, ...additions]);
		setTagDraft("");
	}

	function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			addTagDraft();
			return;
		}
		if (event.key === "Backspace" && !tagDraft && tagItems.length > 0) {
			commitTags(tagItems.slice(0, -1));
		}
	}

	return (
		<div className="border-b border-border/55 pb-4">
			<Input
				value={localTitle}
				onChange={(event) => updateTitle(event.target.value)}
				placeholder="제목 없음"
				maxLength={160}
				className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-4xl font-semibold tracking-[-0.035em] text-foreground shadow-none focus-visible:ring-0 md:text-[2.75rem] dark:bg-transparent"
			/>
			<div className="mt-3 flex min-h-8 items-center gap-2">
				<Tags className="size-3.5 shrink-0 text-muted-foreground" />
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
					{tagItems.map((tag) => (
						<span
							key={tag}
							className="group/tag inline-flex h-7 items-center rounded-md bg-muted/70 px-2 text-xs text-foreground/80"
						>
							{tag}
							<button
								type="button"
								onClick={() =>
									commitTags(tagItems.filter((item) => item !== tag))
								}
								aria-label={`${tag} 태그 삭제`}
								className="ml-0 grid h-5 w-0 overflow-hidden place-items-center rounded text-muted-foreground opacity-0 transition-[width,margin,opacity,color,background-color] group-hover/tag:-mr-1 group-hover/tag:ml-1 group-hover/tag:w-5 group-hover/tag:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:-mr-1 focus-visible:ml-1 focus-visible:w-5 focus-visible:opacity-100"
							>
								<X className="size-3" />
							</button>
						</span>
					))}
					<Input
						value={tagDraft}
						onChange={(event) => setTagDraft(event.target.value)}
						onKeyDown={handleTagKeyDown}
						onBlur={addTagDraft}
						placeholder={
							tagItems.length > 0 ? "태그 추가" : "태그 입력 후 Enter"
						}
						aria-label="태그 추가"
						maxLength={40}
						className="h-7 min-w-28 flex-1 rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
					/>
				</div>
			</div>
		</div>
	);
}
