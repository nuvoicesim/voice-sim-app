import { Group, ActionIcon, Tooltip } from "@mantine/core";
import { IconBold } from "@tabler/icons-react";
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

  return (
    <Group gap={4} mb={4}>
      <Tooltip label="Bold (Ctrl+B)">
        <ActionIcon variant="subtle" onClick={handleBold} aria-label="Bold">
          <IconBold size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
