import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Alert,
  Box,
  Title,
  Card,
  Group,
  Button,
  Stack,
  Text,
  TextInput,
  Textarea,
  Loader,
  Anchor,
  Select,
  Switch,
  NumberInput,
  Checkbox,
  ActionIcon,
} from "@mantine/core";
import { IconArrowLeft, IconTrash, IconPlus } from "@tabler/icons-react";
import {
  fetchItem,
  selectCurrentItem,
  updateItem,
  createItem,
  fetchItems,
  selectItemsByModule,
} from "../../../slices/moduleItemSlice";

// Re-export so the unused import doesn't trip TS6133 while WIP "new item"
// creation flow is still being wired up. Safe to remove once createItem is used.
void createItem;
import type { ModuleItemType } from "../../../slices/moduleItemSlice";
import { selectModulesByCourse, fetchModules } from "../../../slices/moduleSlice";
import { fetchAssignments, selectAssignments } from "../../../slices/assignmentSlice";
import { fetchTemplates, selectTemplates } from "../../../slices/surveyTemplateSlice";
import type { AppDispatch } from "../../../store";
import { MarkdownTextarea } from "../../../components/courses/MarkdownTextarea";
import { GatingConfigEditor } from "../../../components/courses/GatingConfigEditor";
import { notify } from "../../../utils/notify";
import {
  VOICE_CONSENT_TEMPLATE_MD,
  DEFAULT_AGREE_LABEL,
  DEFAULT_DECLINE_LABEL,
} from "./consentTemplate";

function defaultPayload(type: ModuleItemType): any {
  switch (type) {
    case "assignment":
      return { assignmentId: "" };
    case "survey":
      return { surveyTemplateId: "", instanceLabel: "" };
    case "external_link":
      return { url: "", instructions: "", requireConfirmation: true, uploadKind: "none" };
    case "debrief":
      return { markdown: "", ratingPrompts: [] };
    case "instruction":
      return { markdown: "" };
    case "randomizer":
      return { groups: [{ key: "GROUP_A" }, { key: "GROUP_B" }], strategy: "uniform", scope: "course" };
    case "reveal_trigger":
      return { targetItemIds: [], action: "unblind_reviewer_feedback" };
    case "ai_detection":
      return {
        includedAssignmentItemIds: [],
        revealCorrectOnSubmit: false,
        scoreScale: 7,
      };
    case "consent":
      return {
        title: "Informed Consent to Participate in a Research Study",
        studyName: "VOICE Virtual Patient Learning Study",
        version: new Date().toISOString().slice(0, 10),
        markdown: VOICE_CONSENT_TEMPLATE_MD,
        agreeLabel: DEFAULT_AGREE_LABEL,
        declineLabel: DEFAULT_DECLINE_LABEL,
        contactInfo: "",
      };
    default:
      return {};
  }
}

export default function ModuleItemEditorPage() {
  const { courseId, moduleId, itemId } = useParams<{
    courseId: string;
    moduleId: string;
    itemId: string;
  }>();
  const [searchParams] = useSearchParams();
  const isNew = itemId === "new";
  const newType = (isNew ? searchParams.get("type") : null) as ModuleItemType | null;
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const item = useSelector(selectCurrentItem);
  const siblingItems = useSelector(selectItemsByModule(moduleId || ""));
  const modules = useSelector(selectModulesByCourse(courseId || ""));
  const allItemsByModule = useSelector((s: any) => s.moduleItems.byModuleId);

  const [draft, setDraft] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  // Reset draft whenever the route's itemId changes so the editor doesn't
  // carry over state from a previously-edited item.
  useEffect(() => {
    setDraft(null);
  }, [itemId]);

  useEffect(() => {
    if (!isNew && itemId) dispatch(fetchItem(itemId));
    if (moduleId) dispatch(fetchItems(moduleId));
    if (courseId) dispatch(fetchModules(courseId));
  }, [dispatch, isNew, itemId, moduleId, courseId]);

  // Make sure items in EVERY module of the course are loaded so the
  // group_in dropdown can discover all randomizer-defined groups.
  useEffect(() => {
    for (const m of modules) {
      if (!allItemsByModule[m.moduleId]) {
        dispatch(fetchItems(m.moduleId));
      }
    }
  }, [modules, allItemsByModule, dispatch]);

  useEffect(() => {
    if (isNew) return;
    if (item && item.moduleItemId === itemId) setDraft(item);
  }, [isNew, item, itemId]);

  // In "new" mode, build an in-memory draft so nothing is written to the
  // database until the user explicitly clicks Save.
  useEffect(() => {
    if (!isNew || draft || !moduleId || !courseId || !newType) return;
    setDraft({
      moduleItemId: "new",
      moduleId,
      courseId,
      itemType: newType,
      title: `New ${newType.replace("_", " ")}`,
      payload: defaultPayload(newType),
      gating: { kind: "open" },
      // Sentinel: behave as if appended to the end so prereq dropdowns include
      // all existing siblings.
      position: Number.MAX_SAFE_INTEGER,
    });
  }, [isNew, draft, moduleId, courseId, newType]);

  if (!draft) {
    return (
      <Box p="md">
        <Loader />
      </Box>
    );
  }

  const candidateItems = siblingItems
    .filter((s) => s.moduleItemId !== itemId && (s.position ?? 0) < (draft.position ?? 0))
    .map((s) => ({ id: s.moduleItemId, label: s.title }));

  const candidateModules = modules
    .filter((m) => (m.position ?? 0) < (modules.find((mm) => mm.moduleId === moduleId)?.position ?? 0))
    .map((m) => ({ id: m.moduleId, label: m.title }));

  // Pull all distinct group keys from any randomizer items already present in
  // this course (any module). Used by the gating editor's group_in dropdown.
  const candidateGroups = (() => {
    const set = new Set<string>();
    for (const list of Object.values(allItemsByModule || {})) {
      for (const it of (list as any[]) || []) {
        if (it.itemType === "randomizer") {
          const groups = (it.payload as any)?.groups || [];
          for (const g of groups) if (g?.key) set.add(g.key);
        }
      }
    }
    return Array.from(set);
  })();

  const consentItems = (() => {
    const items: Array<{ value: string; label: string }> = [];
    for (const list of Object.values(allItemsByModule || {})) {
      for (const it of (list as any[]) || []) {
        if (it.itemType === "consent") {
          items.push({
            value: it.moduleItemId,
            label: it.title || it.moduleItemId,
          });
        }
      }
    }
    return items;
  })();

  const handleSave = async () => {
    if (!draft?.title?.trim()) {
      notify.warn("Item title cannot be empty");
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        if (!moduleId) return;
        await dispatch(
          createItem({
            moduleId,
            data: {
              itemType: draft.itemType,
              title: draft.title,
              payload: draft.payload,
              gating: draft.gating,
              completionRule: draft.completionRule,
            },
          })
        ).unwrap();
        notify.success("Item created");
      } else {
        await dispatch(
          updateItem({
            itemId: itemId!,
            data: {
              title: draft.title,
              payload: draft.payload,
              gating: draft.gating,
              completionRule: draft.completionRule,
            },
          })
        ).unwrap();
        notify.success("Item saved");
      }
      navigate(`/faculty/courses/${courseId}/modules/${moduleId}`);
    } catch (e: any) {
      console.error("Failed to save module item", e);
      notify.error(e?.message || "unknown error", isNew ? "Create failed" : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box p="md" maw={900} mx="auto">
      <Anchor
        onClick={() => navigate(`/faculty/courses/${courseId}/modules/${moduleId}`)}
        mb="xs"
      >
        <Group gap={4}>
          <IconArrowLeft size={14} />
          <Text size="sm">Back to module</Text>
        </Group>
      </Anchor>

      <Title order={2} mb="md">
        {isNew ? "New" : "Edit"} {draft.itemType}
      </Title>

      <Stack gap="md">
        <Card withBorder>
          <TextInput
            label="Item title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
            required
          />
        </Card>

        <Card withBorder>
          <Text fw={600} mb="xs">
            Type-specific Configuration
          </Text>
          <PayloadEditor draft={draft} setDraft={setDraft} consentItems={consentItems} />
        </Card>

        <Card withBorder>
          <GatingConfigEditor
            value={draft.gating}
            onChange={(gating) => setDraft({ ...draft, gating })}
            candidateItems={candidateItems}
            candidateModules={candidateModules}
            candidateGroups={candidateGroups}
          />
        </Card>

        <Group justify="flex-end">
          <Button variant="subtle" onClick={() => navigate(`/faculty/courses/${courseId}/modules/${moduleId}`)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {isNew ? "Create" : "Save"}
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}

function PayloadEditor({
  draft,
  setDraft,
  consentItems,
}: {
  draft: any;
  setDraft: (d: any) => void;
  consentItems: Array<{ value: string; label: string }>;
}) {
  const setPayload = (next: any) => setDraft({ ...draft, payload: { ...draft.payload, ...next } });

  switch (draft.itemType) {
    case "assignment":
      return <AssignmentPayloadEditor payload={draft.payload} onChange={setPayload} />;
    case "survey":
      return <SurveyPayloadEditor payload={draft.payload} onChange={setPayload} />;
    case "external_link":
      return <ExternalLinkPayloadEditor payload={draft.payload} onChange={setPayload} />;
    case "instruction":
    case "debrief":
      return <MarkdownPayloadEditor payload={draft.payload} onChange={setPayload} type={draft.itemType} />;
    case "randomizer":
      return (
        <RandomizerPayloadEditor
          payload={draft.payload}
          onChange={setPayload}
          consentItems={consentItems}
        />
      );
    case "ai_detection":
      return (
        <AIDetectionPayloadEditor
          courseId={draft.courseId}
          payload={draft.payload}
          onChange={setPayload}
        />
      );
    case "reveal_trigger":
      return <RevealTriggerPayloadEditor payload={draft.payload} onChange={setPayload} />;
    case "consent":
      return <ConsentItemEditor payload={draft.payload} onChange={setPayload} />;
    default:
      return <Text size="sm" c="dimmed">No editor for type {draft.itemType}.</Text>;
  }
}

function AssignmentPayloadEditor({ payload, onChange }: { payload: any; onChange: (v: any) => void }) {
  const dispatch = useDispatch<AppDispatch>();
  const assignments = useSelector(selectAssignments);
  useEffect(() => {
    dispatch(fetchAssignments());
  }, [dispatch]);
  return (
    <Stack gap="xs">
      <Select
        label="Assignment"
        data={assignments.map((a) => ({ value: a.assignmentId, label: a.title }))}
        value={payload.assignmentId || ""}
        onChange={(v) => onChange({ assignmentId: v })}
        searchable
        clearable
      />
      <Switch
        label="Require blinded reviewer feedback (used by AI detection survey)"
        checked={!!payload.requireFeedbackBlinded}
        onChange={(e) => onChange({ requireFeedbackBlinded: e.currentTarget.checked })}
      />
    </Stack>
  );
}

function SurveyPayloadEditor({ payload, onChange }: { payload: any; onChange: (v: any) => void }) {
  const dispatch = useDispatch<AppDispatch>();
  const templates = useSelector(selectTemplates);
  // For the Consent picker we scan every loaded module's items for itemType=consent.
  const allItemsByModule = useSelector((s: any) => s.moduleItems.byModuleId);
  useEffect(() => {
    dispatch(fetchTemplates());
  }, [dispatch]);

  const consentOptions: { value: string; label: string }[] = (() => {
    const out: { value: string; label: string }[] = [];
    for (const list of Object.values(allItemsByModule || {})) {
      for (const it of (list as any[]) || []) {
        if (it.itemType === "consent") {
          out.push({
            value: it.moduleItemId,
            label: `${it.title}${it.payload?.version ? ` (v${it.payload.version})` : ""}`,
          });
        }
      }
    }
    return out;
  })();

  return (
    <Stack gap="xs">
      <Select
        label="Survey Template"
        data={templates.map((t) => ({ value: t.surveyTemplateId, label: t.name }))}
        value={payload.surveyTemplateId || ""}
        onChange={(v) => onChange({ surveyTemplateId: v })}
        searchable
        clearable
        nothingFoundMessage="Create one in Survey Templates first"
      />
      <TextInput
        label="Instance label (helps distinguish e.g. Phase 1A vs 1B with same template)"
        value={payload.instanceLabel || ""}
        onChange={(e) => onChange({ instanceLabel: e.currentTarget.value })}
      />
      <Select
        label="Required Consent (high-priority gating)"
        description="If set, this survey only appears to students who have AGREED to the chosen consent. Declined students see nothing here. Overrides all other gating."
        data={consentOptions}
        value={payload.consentModuleItemId || ""}
        onChange={(v) =>
          onChange({ consentModuleItemId: v || null })
        }
        searchable
        clearable
        nothingFoundMessage="Add a Consent item somewhere in this course first"
      />
      {payload.consentModuleItemId && (
        <Switch
          label="Hide this survey from students who decline consent"
          description="When ON (default), declined students don't see the survey at all. Turn OFF if some students should still see it as optional."
          checked={payload.hideOnDecline !== false}
          onChange={(e) =>
            onChange({ hideOnDecline: e.currentTarget.checked })
          }
        />
      )}
    </Stack>
  );
}

function ExternalLinkPayloadEditor({ payload, onChange }: { payload: any; onChange: (v: any) => void }) {
  return (
    <Stack gap="xs">
      <TextInput
        label="URL"
        value={payload.url || ""}
        onChange={(e) => onChange({ url: e.currentTarget.value })}
        placeholder="https://simucase.example.com/case/123"
      />
      <MarkdownTextarea
        label="Instructions (Markdown)"
        value={payload.instructions || ""}
        onChange={(v) => onChange({ instructions: v })}
        minRows={4}
      />
      <Switch
        label="Require student to confirm completion (green check)"
        checked={!!payload.requireConfirmation}
        onChange={(e) => onChange({ requireConfirmation: e.currentTarget.checked })}
      />
      <Select
        label="Upload requirement"
        data={[
          { value: "none", label: "None" },
          { value: "audio", label: "Audio recording" },
        ]}
        value={payload.uploadKind || "none"}
        onChange={(v) => onChange({ uploadKind: v })}
      />
    </Stack>
  );
}

function MarkdownPayloadEditor({
  payload,
  onChange,
  type,
}: {
  payload: any;
  onChange: (v: any) => void;
  type: string;
}) {
  return (
    <Stack gap="xs">
      <MarkdownTextarea
        label={`${type === "debrief" ? "Debrief" : "Instruction"} content (Markdown)`}
        value={payload.markdown || ""}
        onChange={(v) => onChange({ markdown: v })}
        minRows={8}
      />
    </Stack>
  );
}

function RandomizerPayloadEditor({
  payload,
  onChange,
  consentItems,
}: {
  payload: any;
  onChange: (v: any) => void;
  consentItems: Array<{ value: string; label: string }>;
}) {
  const groups: Array<{ key: string; label?: string; weight?: number }> = payload.groups || [];
  const strategy = payload.strategy || "uniform";
  const isBalanced = strategy === "balanced";
  return (
    <Stack gap="xs">
      <Select
        label="Strategy"
        data={[
          { value: "uniform", label: "Uniform random" },
          { value: "weighted", label: "Weighted" },
          { value: "balanced", label: "Balanced (1:1 for consented students)" },
        ]}
        value={strategy}
        onChange={(v) => onChange({ strategy: v })}
      />
      {isBalanced && (
        <Select
          label="Bind consent item"
          placeholder="(none — treat all students as non-consented)"
          clearable
          data={consentItems}
          value={payload.consentItemId || null}
          onChange={(v) => onChange({ consentItemId: v || undefined })}
        />
      )}
      <Select
        label="Scope"
        data={[
          { value: "course", label: "Course-wide (one assignment per student per course)" },
          { value: "module", label: "Module-scoped" },
        ]}
        value={payload.scope || "course"}
        onChange={(v) => onChange({ scope: v })}
      />
      <Text size="sm" fw={500} mt="xs">
        Groups
      </Text>
      {groups.map((g, i) => (
        <Group key={i} align="end">
          <TextInput
            label={`Key ${i + 1}`}
            value={g.key}
            onChange={(e) => {
              const next = [...groups];
              next[i] = { ...next[i], key: e.currentTarget.value };
              onChange({ groups: next });
            }}
            style={{ flex: 1 }}
          />
          <TextInput
            label="Label"
            value={g.label || ""}
            onChange={(e) => {
              const next = [...groups];
              next[i] = { ...next[i], label: e.currentTarget.value };
              onChange({ groups: next });
            }}
            style={{ flex: 1 }}
          />
          {!isBalanced && (
            <NumberInput
              label="Weight"
              value={g.weight ?? 1}
              onChange={(v) => {
                const next = [...groups];
                next[i] = { ...next[i], weight: Number(v) || 1 };
                onChange({ groups: next });
              }}
              min={0.1}
              step={0.1}
              style={{ width: 100 }}
            />
          )}
          <ActionIcon
            color="terracotta"
            variant="subtle"
            onClick={() => onChange({ groups: groups.filter((_, j) => j !== i) })}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Button
        variant="subtle"
        size="sm"
        leftSection={<IconPlus size={12} />}
        onClick={() => onChange({ groups: [...groups, { key: `GROUP_${groups.length + 1}` }] })}
      >
        Add group
      </Button>
    </Stack>
  );
}

function AIDetectionPayloadEditor({
  courseId,
  payload,
  onChange,
}: {
  courseId: string;
  payload: any;
  onChange: (v: any) => void;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const modules = useSelector(selectModulesByCourse(courseId));
  // Cross-module item gathering: scan moduleItems by each module loaded so far.
  const allItemsByModule = useSelector((s: any) => s.moduleItems.byModuleId);

  useEffect(() => {
    if (modules.length === 0) dispatch(fetchModules(courseId));
  }, [dispatch, courseId, modules.length]);

  useEffect(() => {
    for (const m of modules) {
      if (!allItemsByModule[m.moduleId]) {
        dispatch(fetchItems(m.moduleId));
      }
    }
  }, [modules, allItemsByModule, dispatch]);

  const allAssignmentItems: Array<{ id: string; title: string; moduleTitle: string }> = [];
  for (const m of modules) {
    const items = allItemsByModule[m.moduleId] || [];
    for (const it of items) {
      if (it.itemType === "assignment") {
        allAssignmentItems.push({ id: it.moduleItemId, title: it.title, moduleTitle: m.title });
      }
    }
  }

  const included: string[] = payload.includedAssignmentItemIds || [];

  return (
    <Stack gap="xs">
      <Text size="sm">Pick which assignment items the student must identify AI feedback for:</Text>
      <Card withBorder p="xs">
        {allAssignmentItems.length === 0 ? (
          <Text size="sm" c="dimmed">
            No assignment items in this course yet.
          </Text>
        ) : (
          <Stack gap={4}>
            {allAssignmentItems.map((a) => (
              <Checkbox
                key={a.id}
                checked={included.includes(a.id)}
                onChange={(e) => {
                  if (e.currentTarget.checked) {
                    onChange({ includedAssignmentItemIds: [...included, a.id] });
                  } else {
                    onChange({
                      includedAssignmentItemIds: included.filter((i) => i !== a.id),
                    });
                  }
                }}
                label={`${a.moduleTitle} → ${a.title}`}
              />
            ))}
          </Stack>
        )}
      </Card>
      <Switch
        label="Reveal correctness to student on submission (off by default for research integrity)"
        checked={!!payload.revealCorrectOnSubmit}
        onChange={(e) => onChange({ revealCorrectOnSubmit: e.currentTarget.checked })}
      />
    </Stack>
  );
}

function RevealTriggerPayloadEditor({ payload, onChange }: { payload: any; onChange: (v: any) => void }) {
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        Reveal trigger: when this item is reached, all ReviewerFeedback rows on the listed target items
        flip from blinded to revealed. Configure via JSON for now.
      </Text>
      <TextInput
        label="Action"
        value={payload.action || "unblind_reviewer_feedback"}
        onChange={(e) => onChange({ action: e.currentTarget.value })}
      />
      <TextInput
        label="Target item IDs (comma-separated)"
        value={(payload.targetItemIds || []).join(",")}
        onChange={(e) =>
          onChange({
            targetItemIds: e.currentTarget.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
      />
    </Stack>
  );
}

function ConsentItemEditor({
  payload,
  onChange,
}: {
  payload: any;
  onChange: (v: any) => void;
}) {
  return (
    <Stack gap="md">
      <Alert color="yellow" variant="light">
        Editing existing consent text does NOT invalidate students who have already
        decided. For IRB-clean re-consent, create a NEW consent item and rewire
        surveys to point at it instead of editing this one in place.
      </Alert>
      <TextInput
        label="Title"
        placeholder="Informed Consent to Participate in a Research Study"
        value={payload.title || ""}
        onChange={(e) => onChange({ title: e.currentTarget.value })}
      />
      <Group grow>
        <TextInput
          label="Study name"
          placeholder="VOICE Virtual Patient Learning Study"
          value={payload.studyName || ""}
          onChange={(e) => onChange({ studyName: e.currentTarget.value })}
        />
        <TextInput
          label="Version date"
          placeholder="May 17, 2026"
          description="Snapshotted on each student's decision row"
          value={payload.version || ""}
          onChange={(e) => onChange({ version: e.currentTarget.value })}
        />
      </Group>
      <MarkdownTextarea
        label="Consent body (Markdown)"
        value={payload.markdown || ""}
        onChange={(v) => onChange({ markdown: v })}
        minRows={20}
      />
      <Textarea
        label="Agree option label (shown as the first radio)"
        value={payload.agreeLabel || ""}
        onChange={(e) => onChange({ agreeLabel: e.currentTarget.value })}
        autosize
        minRows={1}
      />
      <Textarea
        label="Decline option label (shown as the second radio)"
        value={payload.declineLabel || ""}
        onChange={(e) => onChange({ declineLabel: e.currentTarget.value })}
        autosize
        minRows={2}
      />
      <TextInput
        label="Contact info (footer)"
        placeholder="Prof. Ilmi Yoon — i.yoon@northeastern.edu"
        value={payload.contactInfo || ""}
        onChange={(e) => onChange({ contactInfo: e.currentTarget.value })}
      />
    </Stack>
  );
}
