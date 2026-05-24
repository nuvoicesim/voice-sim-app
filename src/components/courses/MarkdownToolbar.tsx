import { Group, ActionIcon, Tooltip } from "@mantine/core";
import { IconBold, IconItalic, IconHighlight, IconLink, IconList, IconHeading, IconPhoto } from "@tabler/icons-react";
import { useCallback, useRef } from "react";
import { useMarkdownImageUpload } from "./useMarkdownImageUpload";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useMarkdownImageUpload();

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

  const prependCurrentLine = useCallback(
    (prefix: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start === end) {
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        onChange(
          value.slice(0, lineStart) + prefix + value.slice(lineStart)
        );
        return;
      }
      // selection spans some range: split into lines covered by it and
      // prefix each. We work from the line start before `start` to the
      // line end at or after `end`.
      const blockStart = value.lastIndexOf("\n", start - 1) + 1;
      const block = value.slice(blockStart, end);
      const prefixed = block
        .split("\n")
        .map((line) => prefix + line)
        .join("\n");
      onChange(
        value.slice(0, blockStart) + prefixed + value.slice(end)
      );
    },
    [value, onChange, textareaRef]
  );

  const handleList = useCallback(() => prependCurrentLine("- "), [prependCurrentLine]);
  const handleHeading = useCallback(() => prependCurrentLine("# "), [prependCurrentLine]);

  const handleImageButton = () => {
    fileInputRef.current?.click();
  };

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file twice re-fires
    if (!file) return;
    try {
      const { publicUrl, alt } = await upload(file);
      const ta = textareaRef.current;
      const insertion = `![${alt}](${publicUrl})`;
      if (!ta) {
        onChange(value + insertion);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      onChange(value.slice(0, start) + insertion + value.slice(end));
    } catch (err) {
      // Hook already surfaces error state; toolbar stays silent here.
      // eslint-disable-next-line no-console
      console.error("image upload failed", err);
    }
  };

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
      <Tooltip label="List">
        <ActionIcon variant="subtle" onClick={handleList} aria-label="List">
          <IconList size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Heading">
        <ActionIcon variant="subtle" onClick={handleHeading} aria-label="Heading">
          <IconHeading size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={uploading ? "Uploading..." : "Insert image"}>
        <ActionIcon
          variant="subtle"
          onClick={handleImageButton}
          aria-label="Image"
          loading={uploading}
        >
          <IconPhoto size={14} />
        </ActionIcon>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        data-testid="markdown-image-input"
        onChange={handleImageSelected}
      />
    </Group>
  );
}
