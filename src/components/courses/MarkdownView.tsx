import { Box } from "@mantine/core";
import { marked } from "marked";

export function MarkdownView({ markdown }: { markdown: string }) {
  const html = (() => {
    try {
      return marked.parse(markdown || "", { async: false }) as string;
    } catch {
      return markdown || "";
    }
  })();
  return <Box dangerouslySetInnerHTML={{ __html: html }} />;
}
