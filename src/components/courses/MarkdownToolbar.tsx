import { Group, ActionIcon, Tooltip, Modal, Stack, Button, NumberInput, Text } from "@mantine/core";
import { IconBold, IconItalic, IconHighlight, IconLink, IconList, IconHeading, IconPhoto } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";
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
  const [pendingInsert, setPendingInsert] = useState<{ publicUrl: string; alt: string } | null>(null);
  const [selectedSize, setSelectedSize] = useState<number | null>(400);

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
    // Reject empty / cancelled, and any scheme that isn't safe to render.
    // Allow http(s), mailto, tel, and relative URLs (starting with / or #).
    if (!url || !/^(?:https?:|mailto:|tel:|[/#])/i.test(url.trim())) return;
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
      const result = await upload(file);
      setSelectedSize(400);
      setPendingInsert(result);
    } catch (err) {
      // Hook already surfaces error state; toolbar stays silent here.
      // eslint-disable-next-line no-console
      console.error("image upload failed", err);
    }
  };

  const confirmInsert = () => {
    if (!pendingInsert) return;
    const { publicUrl, alt } = pendingInsert;
    const suffix = selectedSize ? `|${selectedSize}` : "";
    const insertion = `![${alt}${suffix}](${publicUrl})`;
    const ta = textareaRef.current;
    if (!ta) {
      onChange(value + insertion);
    } else {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      onChange(value.slice(0, start) + insertion + value.slice(end));
    }
    setPendingInsert(null);
  };

  const cancelInsert = () => setPendingInsert(null);

  return (
    <>
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
      </Group>
      <Modal
        opened={!!pendingInsert}
        onClose={cancelInsert}
        title="Insert image"
        size="sm"
        centered
      >
        <Stack gap="xs">
          <Text size="sm">Choose width:</Text>
          <Group gap="xs">
            <Button
              variant={selectedSize === 200 ? "filled" : "light"}
              onClick={() => setSelectedSize(200)}
              size="xs"
            >
              Small
            </Button>
            <Button
              variant={selectedSize === 400 ? "filled" : "light"}
              onClick={() => setSelectedSize(400)}
              size="xs"
            >
              Medium
            </Button>
            <Button
              variant={selectedSize === 600 ? "filled" : "light"}
              onClick={() => setSelectedSize(600)}
              size="xs"
            >
              Large
            </Button>
            <Button
              variant={selectedSize === null ? "filled" : "light"}
              onClick={() => setSelectedSize(null)}
              size="xs"
            >
              Original
            </Button>
          </Group>
          <NumberInput
            label="Custom width (px)"
            placeholder="50-2000"
            value={selectedSize ?? ""}
            onChange={(v) => setSelectedSize(typeof v === "number" ? v : null)}
            min={50}
            max={2000}
            step={50}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" onClick={cancelInsert}>
              Cancel
            </Button>
            <Button onClick={confirmInsert}>Insert</Button>
          </Group>
        </Stack>
      </Modal>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        data-testid="markdown-image-input"
        onChange={handleImageSelected}
      />
    </>
  );
}
