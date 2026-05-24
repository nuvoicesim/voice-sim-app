import { Group, ActionIcon, Tooltip } from "@mantine/core";
import { IconBold, IconItalic, IconHighlight, IconLink } from "@tabler/icons-react";
import { useCallback } from "react";

interface Props {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (next: string) => void;
}

function wrapSelection(
  value: string,
  ta: HTMLTextAreaElement | null,
  open: string,
  close: string,
  placeholder: string
): string {
  if (!ta) return value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  if (start === end) {
    return (
      value.slice(0, start) + open + placeholder + close + value.slice(end)
    );
  }
  const selected = value.slice(start, end);
  return value.slice(0, start) + open + selected + close + value.slice(end);
}

export function MarkdownToolbar({ textareaRef, value, onChange }: Props) {
  const handleBold = useCallback(() => {
    onChange(wrapSelection(value, textareaRef.current, "**", "**", "bold"));
  }, [value, onChange, textareaRef]);

  const handleItalic = useCallback(() => {
    onChange(wrapSelection(value, textareaRef.current, "*", "*", "italic"));
  }, [value, onChange, textareaRef]);

  const handleHighlight = useCallback(() => {
    onChange(wrapSelection(value, textareaRef.current, "==", "==", "highlight"));
  }, [value, onChange, textareaRef]);

  const handleLink = useCallback(() => {
    const url = window.prompt("URL");
    if (!url) return;
    const ta = textareaRef.current;
    if (!ta) {
      onChange(value + `[link](${url})`);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const label = start === end ? "link" : value.slice(start, end);
    onChange(
      value.slice(0, start) + `[${label}](${url})` + value.slice(end)
    );
  }, [value, onChange, textareaRef]);

  return (
    <Group gap={4} mb={4}>
      <Tooltip label="Bold (Ctrl+B)">
        <ActionIcon variant="subtle" onClick={handleBold} aria-label="Bold">
          <IconBold size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Italic">
        <ActionIcon variant="subtle" onClick={handleItalic} aria-label="Italic">
          <IconItalic size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Highlight">
        <ActionIcon variant="subtle" onClick={handleHighlight} aria-label="Highlight">
          <IconHighlight size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Insert link">
        <ActionIcon variant="subtle" onClick={handleLink} aria-label="Link">
          <IconLink size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
