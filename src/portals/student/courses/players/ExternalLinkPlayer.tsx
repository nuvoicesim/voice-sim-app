import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Image,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconCircleCheck,
  IconExternalLink,
  IconPhotoPlus,
  IconTrash,
} from "@tabler/icons-react";
import { markComplete, selectMyProgress } from "../../../../slices/studentProgressSlice";
import type { AppDispatch } from "../../../../store";
import { MarkdownView } from "../../../../components/courses/MarkdownView";
import { useEventLog } from "../../../../hooks/useEventLog";
import { notify } from "../../../../utils/notify";
import { useSubmissionImageUpload } from "../useSubmissionImageUpload";

const MAX_IMAGES = 2;

export function ExternalLinkPlayer({ item }: { item: any }) {
  const dispatch = useDispatch<AppDispatch>();
  const logEvent = useEventLog();
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useSubmissionImageUpload();

  const url = item.payload?.url;
  const requireConfirm = !!item.payload?.requireConfirmation;
  const progress = useSelector(selectMyProgress(item.moduleItemId));
  const completed = progress?.state === "completed";
  const persistedImages = useMemo<string[]>(
    () =>
      Array.isArray(progress?.submissionImageUrls)
        ? (progress!.submissionImageUrls as string[])
        : [],
    [progress]
  );

  // When progress arrives later (or this page revisits), seed local picks.
  useEffect(() => {
    if (!completed && persistedImages.length > 0 && imageUrls.length === 0) {
      setImageUrls(persistedImages);
    }
  }, [completed, persistedImages, imageUrls.length]);

  const handlePickImage = () => fileInputRef.current?.click();

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (imageUrls.length >= MAX_IMAGES) {
      notify.error(`You can upload at most ${MAX_IMAGES} screenshots.`);
      return;
    }
    try {
      const { publicUrl } = await upload(file);
      setImageUrls((prev) => [...prev, publicUrl]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      notify.error(msg);
    }
  };

  const handleRemoveImage = (urlToRemove: string) => {
    setImageUrls((prev) => prev.filter((u) => u !== urlToRemove));
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      logEvent("simucase_completion_confirmed", { url, imageCount: imageUrls.length });
      await dispatch(
        markComplete({
          itemId: item.moduleItemId,
          submissionImageUrls: imageUrls,
        })
      ).unwrap();
      notify.success("Marked as complete");
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Failed to mark complete");
    } finally {
      setSubmitting(false);
    }
  };

  const displayImages = completed ? persistedImages : imageUrls;

  return (
    <Card withBorder>
      <Stack gap="md">
        {item.payload?.instructions && <MarkdownView markdown={item.payload.instructions} />}
        {url && (
          <Group>
            <Button
              component="a"
              href={url}
              target="_blank"
              leftSection={<IconExternalLink size={16} />}
              onClick={() => logEvent("simucase_link_opened", { url })}
            >
              Open external link
            </Button>
            <Text size="xs" c="dimmed">
              <Anchor href={url} target="_blank" rel="noreferrer">
                {url}
              </Anchor>
            </Text>
          </Group>
        )}

        {!completed && (
          <Stack gap="xs">
            <Group gap="xs" align="center">
              <Text size="sm" fw={500}>
                Screenshots (optional, up to {MAX_IMAGES}, max 5 MB each)
              </Text>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPhotoPlus size={14} />}
                onClick={handlePickImage}
                loading={uploading}
                disabled={imageUrls.length >= MAX_IMAGES}
              >
                Add screenshot
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={handleImageSelected}
              />
            </Group>
            {displayImages.length > 0 && (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {displayImages.map((src) => (
                  <Card key={src} withBorder padding="xs">
                    <Stack gap={4}>
                      <Image src={src} alt="screenshot" fit="contain" h={160} />
                      <Group justify="flex-end">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => handleRemoveImage(src)}
                          aria-label="Remove screenshot"
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Group>
                    </Stack>
                  </Card>
                ))}
              </SimpleGrid>
            )}
          </Stack>
        )}

        {requireConfirm && !completed && (
          <Group>
            <Checkbox
              label="I confirm I have completed this activity"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.currentTarget.checked)}
            />
            <Button
              onClick={handleConfirm}
              loading={submitting}
              disabled={!confirmed || uploading}
            >
              Mark complete
            </Button>
          </Group>
        )}
        {completed && persistedImages.length > 0 && (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Submitted screenshots
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              {persistedImages.map((src) => (
                <Card key={src} withBorder padding="xs">
                  <Image src={src} alt="screenshot" fit="contain" h={160} />
                </Card>
              ))}
            </SimpleGrid>
          </Stack>
        )}
        {completed && (
          <Group justify="flex-end">
            <Badge color="terracotta" size="lg" variant="light" leftSection={<IconCircleCheck size={14} />}>
              Completed
            </Badge>
          </Group>
        )}
        {completed && progress?.completedAt && (
          <Text size="xs" c="dimmed" ta="right">
            Completed on {new Date(progress.completedAt).toLocaleString()}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
