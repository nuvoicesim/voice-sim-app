import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Box,
  Title,
  Card,
  Group,
  Button,
  Stack,
  Text,
  Badge,
  ActionIcon,
  Menu,
  Loader,
  Anchor,
  Select,
  ThemeIcon,
  TextInput,
  SimpleGrid,
} from "@mantine/core";
import {
  IconPlus,
  IconRocket,
  IconClipboardList,
  IconExternalLink,
  IconMessage,
  IconBook,
  IconArrowsShuffle,
  IconEye,
  IconBrain,
  IconTrash,
  IconArrowLeft,
  IconRefresh,
  IconLock,
  IconFileCertificate,
} from "@tabler/icons-react";
import {
  fetchItems,
  selectItemsByModule,
  deleteItem,
  reorderItems,
} from "../../../slices/moduleItemSlice";
import {
  fetchModules,
  selectModulesByCourse,
  updateModule,
} from "../../../slices/moduleSlice";
import type { AppDispatch } from "../../../store";
import type { ModuleItemType } from "../../../slices/moduleItemSlice";
import { notify } from "../../../utils/notify";
import { SortableList } from "../../../components/courses/SortableList";
import { MarkdownTextarea } from "../../../components/courses/MarkdownTextarea";

const TYPE_ICONS: Record<string, any> = {
  assignment: IconRocket,
  survey: IconClipboardList,
  external_link: IconExternalLink,
  debrief: IconMessage,
  instruction: IconBook,
  randomizer: IconArrowsShuffle,
  reveal_trigger: IconEye,
  ai_detection: IconBrain,
  consent: IconFileCertificate,
};

const TYPE_COLORS: Record<string, string> = {
  assignment: "indigo",
  survey: "teal",
  external_link: "orange",
  debrief: "grape",
  instruction: "gray",
  randomizer: "pink",
  reveal_trigger: "yellow",
  ai_detection: "red",
  consent: "grape",
};

export default function ModuleEditorPage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const items = useSelector(selectItemsByModule(moduleId || ""));
  const modules = useSelector(selectModulesByCourse(courseId || ""));
  const currentModule = modules.find((m) => m.moduleId === moduleId);
  const [refreshing, setRefreshing] = useState(false);

  // ── Module title / description state ──
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const detailsDirty =
    !!currentModule &&
    (titleDraft !== (currentModule.title || "") ||
      descriptionDraft !== (currentModule.description || ""));

  useEffect(() => {
    if (currentModule) {
      setTitleDraft(currentModule.title || "");
      setDescriptionDraft(currentModule.description || "");
    }
  }, [currentModule]);

  // ── Module-level prerequisite state ──
  const [prereqModuleId, setPrereqModuleId] = useState<string | null>(null);
  const [savingGating, setSavingGating] = useState(false);
  const currentPrereqId =
    currentModule?.gating?.kind === "after_module"
      ? (currentModule.gating.moduleId as string)
      : null;
  const gatingDirty = prereqModuleId !== currentPrereqId;

  useEffect(() => {
    setPrereqModuleId(currentPrereqId);
  }, [currentPrereqId]);

  useEffect(() => {
    if (moduleId) dispatch(fetchItems(moduleId));
    if (courseId) dispatch(fetchModules(courseId));
  }, [dispatch, moduleId, courseId]);

  const handleSaveDetails = async () => {
    if (!moduleId) return;
    const trimmedTitle = titleDraft.trim();
    if (!trimmedTitle) {
      notify.warn("Module title cannot be empty");
      return;
    }
    setSavingDetails(true);
    try {
      await dispatch(
        updateModule({
          moduleId,
          data: { title: trimmedTitle, description: descriptionDraft },
        })
      ).unwrap();
      notify.success("Module details saved");
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Failed to save details");
    } finally {
      setSavingDetails(false);
    }
  };

  const handleSaveGating = async () => {
    if (!moduleId) return;
    setSavingGating(true);
    try {
      await dispatch(
        updateModule({
          moduleId,
          data: {
            gating: prereqModuleId
              ? { kind: "after_module", moduleId: prereqModuleId }
              : { kind: "open" },
          },
        })
      ).unwrap();
      notify.success("Module prerequisite saved");
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Failed to save prerequisite");
    } finally {
      setSavingGating(false);
    }
  };

  const handleRefresh = async () => {
    if (!moduleId) return;
    setRefreshing(true);
    try {
      await dispatch(fetchItems(moduleId)).unwrap();
    } finally {
      setRefreshing(false);
    }
  };

  const handleAdd = (type: ModuleItemType) => {
    if (!moduleId) return;
    navigate(
      `/faculty/courses/${courseId}/modules/${moduleId}/items/new?type=${type}`
    );
  };

  if (!currentModule) {
    return (
      <Box p="md">
        <Loader />
      </Box>
    );
  }

  return (
    <Box p="md">
      <Anchor onClick={() => navigate(`/faculty/courses/${courseId}`)} mb="xs">
        <Group gap={4}>
          <IconArrowLeft size={14} />
          <Text size="sm">Back to course</Text>
        </Group>
      </Anchor>

      <Group justify="space-between" mb="lg">
        <Title order={2}>{currentModule.title}</Title>
        <Group gap="xs">
          <Button
            variant="light"
            leftSection={<IconRefresh size={14} />}
            onClick={handleRefresh}
            loading={refreshing}
          >
            Refresh
          </Button>
        <Menu shadow="md">
          <Menu.Target>
            <Button leftSection={<IconPlus size={14} />}>Add Item</Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Content</Menu.Label>
            <Menu.Item leftSection={<IconBook size={16} />} onClick={() => handleAdd("instruction")}>
              Instruction (Markdown)
            </Menu.Item>
            <Menu.Item leftSection={<IconRocket size={16} />} onClick={() => handleAdd("assignment")}>
              Assignment (Voice Sim)
            </Menu.Item>
            <Menu.Item
              leftSection={<IconExternalLink size={16} />}
              onClick={() => handleAdd("external_link")}
            >
              External Link (e.g. SimuCase)
            </Menu.Item>
            <Menu.Item
              leftSection={<IconFileCertificate size={16} />}
              onClick={() => handleAdd("consent")}
            >
              Informed Consent
            </Menu.Item>
            <Menu.Label>Survey & Feedback</Menu.Label>
            <Menu.Item
              leftSection={<IconClipboardList size={16} />}
              onClick={() => handleAdd("survey")}
            >
              Survey
            </Menu.Item>
            <Menu.Item leftSection={<IconMessage size={16} />} onClick={() => handleAdd("debrief")}>
              Debrief
            </Menu.Item>
            <Menu.Item leftSection={<IconBrain size={16} />} onClick={() => handleAdd("ai_detection")}>
              AI Detection Survey
            </Menu.Item>
            <Menu.Label>Special</Menu.Label>
            <Menu.Item leftSection={<IconArrowsShuffle size={16} />} onClick={() => handleAdd("randomizer")}>
              Randomizer (group assignment)
            </Menu.Item>
            <Menu.Item leftSection={<IconEye size={16} />} onClick={() => handleAdd("reveal_trigger")}>
              Reveal Trigger
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        </Group>
      </Group>

      {/* ── Module details + prerequisite (side-by-side) ── */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mb="lg">
        {/* ── Module details (title + description) ── */}
        <Card withBorder h="100%">
          <Group gap="xs" mb="sm">
            <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
              <IconBook size={14} />
            </ThemeIcon>
            <Text fw={500}>Module Details</Text>
          </Group>
          <Stack gap="sm">
            <TextInput
              label="Title"
              placeholder="e.g. Module 1 — Aphasia Basics"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.currentTarget.value)}
              required
            />
            <MarkdownTextarea
              label="Description (optional)"
              value={descriptionDraft}
              onChange={(v) => setDescriptionDraft(v)}
              minRows={3}
              placeholder="Short summary shown to students at the top of this module. Markdown supported."
            />
            <Group justify="flex-end">
              <Button
                variant="subtle"
                color="parchment"
                disabled={!detailsDirty || savingDetails}
                onClick={() => {
                  if (currentModule) {
                    setTitleDraft(currentModule.title || "");
                    setDescriptionDraft(currentModule.description || "");
                  }
                }}
              >
                Reset
              </Button>
              <Button
                color="terracotta"
                onClick={handleSaveDetails}
                loading={savingDetails}
                disabled={!detailsDirty || !titleDraft.trim()}
              >
                Save details
              </Button>
            </Group>
          </Stack>
        </Card>

        {/* ── Module prerequisite ── */}
        <Card withBorder h="100%">
          <Group gap="xs" mb="sm">
            <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
              <IconLock size={14} />
            </ThemeIcon>
            <Text fw={500}>Module Prerequisite</Text>
          </Group>
          <Text size="sm" c="dimmed" mb="md">
            Optionally require a previous module to be fully completed before this
            module unlocks for students. Select <b>None</b> to make it always available.
          </Text>
          <Group align="flex-end" gap="sm">
            <Select
              label="Prerequisite module"
              placeholder="None — always available"
              data={modules
                .filter((m) => m.moduleId !== moduleId)
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                .map((m) => ({ value: m.moduleId, label: m.title }))}
              value={prereqModuleId}
              onChange={setPrereqModuleId}
              clearable
              searchable
              style={{ flex: 1 }}
            />
            <Button
              color="terracotta"
              onClick={handleSaveGating}
              loading={savingGating}
              disabled={!gatingDirty}
            >
              {prereqModuleId ? "Save" : currentPrereqId ? "Clear prerequisite" : "Save"}
            </Button>
          </Group>
          {currentPrereqId && (
            <Text size="xs" c="dimmed" mt="xs">
              Currently locked behind:{" "}
              <b>
                {modules.find((m) => m.moduleId === currentPrereqId)?.title ??
                  "(missing module)"}
              </b>
            </Text>
          )}
        </Card>
      </SimpleGrid>

      <Stack gap="sm">
        {items.length === 0 ? (
          <Card withBorder p="xl" ta="center">
            <Text c="dimmed">No items yet. Click "Add Item" to start.</Text>
          </Card>
        ) : (
          <>
            <Text size="xs" c="dimmed">
              Drag the handle on the left of each row to reorder.
            </Text>
            <SortableList
              items={items.map((it) => ({ ...it, id: it.moduleItemId }))}
              onReorder={async (next) => {
                if (!moduleId) return;
                try {
                  await dispatch(
                    reorderItems({
                      moduleId,
                      orderedIds: next.map((n) => n.moduleItemId),
                    })
                  ).unwrap();
                } catch (e: any) {
                  notify.error(e?.message || "unknown error", "Reorder failed");
                  // Re-fetch on failure to restore canonical order from server.
                  dispatch(fetchItems(moduleId));
                }
              }}
              renderItem={(it, dragHandle) => {
                const idx = items.findIndex((x) => x.moduleItemId === it.moduleItemId);
                const Icon = TYPE_ICONS[it.itemType] || IconBook;
                return (
                  <Card withBorder mb="xs">
                    <Group justify="space-between">
                      <Group gap="sm">
                        {dragHandle}
                        <Badge size="sm" color="gray">
                          #{idx + 1}
                        </Badge>
                        <Badge size="sm" color={TYPE_COLORS[it.itemType] || "gray"}>
                          <Group gap={4}>
                            <Icon size={12} />
                            {it.itemType}
                          </Group>
                        </Badge>
                        <Text fw={500}>{it.title}</Text>
                      </Group>
                      <Group>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() =>
                            navigate(
                              `/faculty/courses/${courseId}/modules/${moduleId}/items/${it.moduleItemId}`
                            )
                          }
                        >
                          Edit
                        </Button>
                        <ActionIcon
                          color="terracotta"
                          variant="subtle"
                          onClick={async () => {
                            if (!window.confirm("Delete this item?")) return;
                            try {
                              await dispatch(deleteItem(it.moduleItemId)).unwrap();
                              notify.success("Item deleted");
                            } catch (err: any) {
                              notify.error(err?.message || "unknown error", "Failed to delete item");
                            }
                          }}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Group>
                    </Group>
                  </Card>
                );
              }}
            />
          </>
        )}
      </Stack>
    </Box>
  );
}
