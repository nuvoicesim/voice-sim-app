import { Box } from "@mantine/core";
import { marked } from "marked";
import { highlightExtension } from "./markedHighlight";

marked.use(highlightExtension);

export function MarkdownView({ markdown }: { markdown: string }) {
  const html = (() => {
    try {
      return marked.parse(markdown || "", { async: false, breaks: true, gfm: true }) as string;
    } catch {
      return markdown || "";
    }
  })();
  return <Box dangerouslySetInnerHTML={{ __html: html }} />;
}
