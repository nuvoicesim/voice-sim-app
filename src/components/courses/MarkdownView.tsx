import { Box } from "@mantine/core";
import { marked } from "marked";
import { sanitizeMarkdownHtml } from "./sanitizeMarkdownHtml";

export function MarkdownView({ markdown }: { markdown: string }) {
  const html = (() => {
    try {
      const parsed = marked.parse(markdown || "", { async: false }) as string;
      return sanitizeMarkdownHtml(parsed);
    } catch {
      return sanitizeMarkdownHtml(markdown || "");
    }
  })();
  return <Box dangerouslySetInnerHTML={{ __html: html }} />;
}
