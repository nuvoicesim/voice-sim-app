import { useState } from "react";
import { Textarea, Tabs, Box, Text } from "@mantine/core";
import { marked } from "marked";
import { highlightExtension } from "./markedHighlight";

marked.use(highlightExtension);

interface Props {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  minRows?: number;
  placeholder?: string;
}

export function MarkdownTextarea({ value, onChange, label, minRows = 6, placeholder }: Props) {
  const [tab, setTab] = useState<string>("write");
  const html = (() => {
    try {
      return marked.parse(value || "", { async: false, breaks: true, gfm: true }) as string;
    } catch {
      return value || "";
    }
  })();
  return (
    <Box>
      {label && (
        <Text size="sm" fw={500} mb={4}>
          {label}
        </Text>
      )}
      <Tabs value={tab} onChange={(v) => setTab(v || "write")}>
        <Tabs.List>
          <Tabs.Tab value="write">Write</Tabs.Tab>
          <Tabs.Tab value="preview">Preview</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="write" pt="xs">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
            autosize
            minRows={minRows}
            placeholder={placeholder || "Markdown supported. **bold**, *italic*, [links](url), - lists, # headings."}
          />
        </Tabs.Panel>
        <Tabs.Panel value="preview" pt="xs">
          <Box
            style={{
              padding: "0.75rem 1rem",
              border: "1px solid var(--mantine-color-gray-3)",
              borderRadius: 8,
              minHeight: minRows * 22,
              background: "var(--mantine-color-gray-0)",
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}
