import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { aiSourceHref, remarkSourceCitations } from "#/lib/orbit/ai-markdown";
import type { AiSource } from "#/lib/orbit/ai-types";

export function AiMessage({
	content,
	sources = [],
	onOpenSource,
	onNavigate,
}: {
	content: string;
	sources?: AiSource[];
	onOpenSource: (source: AiSource) => void;
	onNavigate: () => void;
}) {
	const plugins = useMemo(
		() => [remarkGfm, remarkSourceCitations(sources)],
		[sources],
	);
	return (
		<div className="min-w-0 text-sm leading-6 break-words [overflow-wrap:anywhere] [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_h1]:my-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre_code]:p-0 [&_hr]:my-4">
			<ReactMarkdown
				remarkPlugins={plugins}
				skipHtml
				components={{
					a: ({ href, children }) => {
						if (!href) return <span>{children}</span>;
						const source = sources.find(
							(candidate) => aiSourceHref(candidate) === href,
						);
						const internal = href.startsWith("/") && !href.startsWith("//");
						return (
							<a
								href={href}
								title={source?.title}
								target={internal ? undefined : "_blank"}
								rel={internal ? undefined : "noopener noreferrer"}
								className="text-primary underline underline-offset-2 hover:opacity-80"
								onClick={(event) => {
									if (
										event.metaKey ||
										event.ctrlKey ||
										event.shiftKey ||
										event.altKey ||
										event.button !== 0
									)
										return;
									if (source) {
										event.preventDefault();
										onOpenSource(source);
									} else if (internal) onNavigate();
								}}
							>
								{children}
							</a>
						);
					},
					table: ({ children }) => (
						<div className="my-3 max-w-full overflow-x-auto">
							<table className="w-full border-collapse text-left text-xs [&_th]:border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:px-3 [&_td]:py-2">
								{children}
							</table>
						</div>
					),
					img: ({ alt }) => (
						<span className="text-muted-foreground">{alt}</span>
					),
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
