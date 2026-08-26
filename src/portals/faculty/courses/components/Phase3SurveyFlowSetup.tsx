import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Select,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconClipboardList,
  IconInfoCircle,
} from "@tabler/icons-react";
import { fetchItems, selectItemsByModule } from "../../../../slices/moduleItemSlice";
import type { ModuleItem } from "../../../../slices/moduleItemSlice";
import {
  fetchTemplates,
  selectTemplates,
} from "../../../../slices/surveyTemplateSlice";
import type { SurveyTemplate } from "../../../../slices/surveyTemplateSlice";
import { moduleItemApi } from "../../../../api/moduleItemApi";
import { surveyTemplateApi } from "../../../../api/surveyTemplateApi";
import type { AppDispatch } from "../../../../store";
import { notify } from "../../../../utils/notify";
import {
  PHASE3_PARTS_AC_QUESTION_COUNT,
  PHASE3_PART_D_QUESTION_COUNT,
  findPhase3Flow,
  templateQuestionCount,
  validateExistingFlowTemplates,
  validatePhase3TemplateSelection,
} from "../phase3-survey-flow";
import type { TemplateResolution } from "../phase3-survey-flow";
import { Phase3FeedbackDataImport } from "./Phase3FeedbackDataImport";

/**
 * "Set up Phase 3 Survey Flow" panel for the module editor.
 *
 * All creation/wiring happens in the idempotent server endpoint
 * POST /modules/{moduleId}/phase3-setup, so two tabs, two users, or a lost
 * response can never duplicate items. This panel only shows state, validates
 * templates (including for existing/legacy flows), and triggers the endpoint.
 */
export function Phase3SurveyFlowSetup({ moduleId }: { moduleId: string }) {
  const dispatch = useDispatch<AppDispatch>();
  const items = useSelector(selectItemsByModule(moduleId));
  const templates = useSelector(selectTemplates);
  const [acTemplateId, setAcTemplateId] = useState<string | null>(null);
  const [dTemplateId, setDTemplateId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  // Templates referenced by existing items but absent from the (scoped) list,
  // fetched individually: row on success, "unavailable" on any failure.
  const [externalTemplates, setExternalTemplates] = useState<
    Record<string, SurveyTemplate | "unavailable">
  >({});

  useEffect(() => {
    dispatch(fetchTemplates()).finally(() => setTemplatesLoaded(true));
  }, [dispatch]);

  const flow = findPhase3Flow(items);

  const resolveTemplate = (id: string): TemplateResolution => {
    const inList = templates.find((t) => t.surveyTemplateId === id);
    if (inList) return inList;
    if (!templatesLoaded) return "loading";
    const external = externalTemplates[id];
    if (external === undefined) return "loading";
    return external;
  };

  const referencedIds = [flow.partsAC, flow.partD]
    .map((it) => it?.payload?.surveyTemplateId)
    .filter((id): id is string => typeof id === "string" && id !== "");
  const referencedKey = referencedIds.join("|");
  useEffect(() => {
    if (!templatesLoaded) return;
    for (const id of referencedIds) {
      if (templates.some((t) => t.surveyTemplateId === id)) continue;
      if (externalTemplates[id] !== undefined) continue;
      surveyTemplateApi.get(id).then(
        (t: SurveyTemplate) =>
          setExternalTemplates((prev) => ({ ...prev, [id]: t })),
        () =>
          setExternalTemplates((prev) => ({ ...prev, [id]: "unavailable" }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templatesLoaded, referencedKey, templates, externalTemplates]);

  // Template validation for EVERY state (new, resumed, legacy, configured).
  const existingChecks = validateExistingFlowTemplates(flow, resolveTemplate);
  const configured =
    flow.complete && !existingChecks.pending && existingChecks.errors.length === 0;

  const needAC = !flow.partsAC;
  const needD = !flow.partD;
  const partial =
    !flow.conflict && !flow.complete && (flow.partsAC !== null || flow.partD !== null);

  const acTemplate =
    templates.find((t) => t.surveyTemplateId === acTemplateId) || null;
  const dTemplate =
    templates.find((t) => t.surveyTemplateId === dTemplateId) || null;
  const selectionErrors = validatePhase3TemplateSelection({
    acTemplate,
    dTemplate,
    needAC,
    needD,
    existingAcTemplateId:
      typeof flow.partsAC?.payload?.surveyTemplateId === "string"
        ? flow.partsAC.payload.surveyTemplateId
        : null,
    existingDTemplateId:
      typeof flow.partD?.payload?.surveyTemplateId === "string"
        ? flow.partD.payload.surveyTemplateId
        : null,
  });
  const selectionsMade = (!needAC || !!acTemplateId) && (!needD || !!dTemplateId);
  const blocked =
    flow.conflict || existingChecks.pending || existingChecks.errors.length > 0;

  const templateName = (item: ModuleItem | null) => {
    const id = item?.payload?.surveyTemplateId;
    if (!id) return "(no template)";
    const resolved = resolveTemplate(id);
    return typeof resolved === "string" ? id : resolved.name;
  };

  const templateOptions = templates.map((t) => ({
    value: t.surveyTemplateId,
    label: `${t.name} (${templateQuestionCount(t) ?? "?"} questions)`,
  }));

  const handleCreateAndConnect = async () => {
    setRunning(true);
    try {
      const result = await moduleItemApi.phase3Setup(moduleId, {
        ...(acTemplateId ? { partsACTemplateId: acTemplateId } : {}),
        ...(dTemplateId ? { partDTemplateId: dTemplateId } : {}),
      });
      await dispatch(fetchItems(moduleId)).unwrap();
      const createdSomething =
        result?.created?.partsAC === true || result?.created?.partD === true;
      notify.success(
        createdSomething
          ? "Phase 3 survey flow created and connected"
          : "Phase 3 survey flow verified and repaired"
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      notify.error(
        `${message} — setup is idempotent: fix the issue and run it again, nothing gets duplicated.`,
        "Phase 3 setup failed"
      );
    } finally {
      setRunning(false);
    }
  };

  const conflictList = (label: string, candidates: ModuleItem[]) =>
    candidates.length > 1 ? (
      <Text size="sm" key={label}>
        {label}:{" "}
        {candidates.map((c) => `"${c.title}" (${c.moduleItemId})`).join(", ")}
      </Text>
    ) : null;

  return (
    <Card withBorder mb="lg">
      <Group gap="xs" mb="sm">
        <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
          <IconClipboardList size={14} />
        </ThemeIcon>
        <Text fw={500}>Set up Phase 3 Survey Flow</Text>
        {configured && (
          <Badge color="green" variant="light" leftSection={<IconCircleCheck size={12} />}>
            Configured
          </Badge>
        )}
      </Group>

      {flow.conflict ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm" fw={600} mb={4}>
            Multiple Phase 3 candidates found — setup stopped.
          </Text>
          <Stack gap={2}>
            {conflictList("Parts A–C candidates", flow.acCandidates)}
            {conflictList("Part D candidates", flow.dCandidates)}
          </Stack>
          <Text size="sm" mt="xs">
            Remove the duplicate survey items below, then reopen this page.
            Nothing was created or modified.
          </Text>
        </Alert>
      ) : configured ? (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            Both Phase 3 surveys exist, are connected, correctly ordered, and
            their templates verified ({PHASE3_PARTS_AC_QUESTION_COUNT} and{" "}
            {PHASE3_PART_D_QUESTION_COUNT} questions). Students see the blinded
            Parts A–C survey with Feedback Cards A/B/C first; submitting it
            triggers the source reveal, which unlocks Part D.
          </Text>
          <Group gap="xs">
            <IconCircleCheck size={16} color="var(--mantine-color-green-6)" />
            <Text size="sm">
              Parts A–C: <b>{flow.partsAC!.title}</b> — template{" "}
              {templateName(flow.partsAC)}
            </Text>
          </Group>
          <Group gap="xs">
            <IconCircleCheck size={16} color="var(--mantine-color-green-6)" />
            <Text size="sm">
              Part D: <b>{flow.partD!.title}</b> — template{" "}
              {templateName(flow.partD)}, unlocked after Parts A–C + reveal
            </Text>
          </Group>
          {/* Feedback data import is offered ONLY from inside the Configured
              branch, so "the flow is wired" is a structural precondition of the
              panel existing — the server re-derives and re-checks it anyway. */}
          <Phase3FeedbackDataImport moduleId={moduleId} />
          <Alert color="parchment" variant="light" icon={<IconInfoCircle size={16} />}>
            <Text size="sm">
              Command-line fallback: <Code>scripts/seed-phase3.mjs</Code> with{" "}
              <Code>--item-id {flow.partsAC!.moduleItemId}</Code> and{" "}
              <Code>--part-d-item-id {flow.partD!.moduleItemId}</Code>. A CLI
              tester import additionally requires{" "}
              <Code>EVENT_LOG_TABLE_NAME</Code> so it can write the permanent
              tester-history marker.
            </Text>
          </Alert>
        </Stack>
      ) : flow.complete && existingChecks.pending ? (
        <Text size="sm" c="dimmed">
          Phase 3 survey items found — validating their survey templates…
        </Text>
      ) : flow.complete ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm" fw={600} mb={4}>
            Phase 3 flow found, but its templates could not be confirmed —
            setup stopped.
          </Text>
          <Stack gap={2}>
            {existingChecks.errors.map((err) => (
              <Text size="sm" key={err}>
                {err}
              </Text>
            ))}
          </Stack>
          <Text size="sm" mt="xs">
            Fix the survey templates (or rewire the items to valid ones) before
            using this flow with students.
          </Text>
        </Alert>
      ) : (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Pick the two prepared survey templates and click{" "}
            <b>Create and Connect</b>. The server creates the blinded Parts A–C
            survey (Feedback Cards A/B/C, sources hidden until submission
            triggers the reveal) and the Part D survey (same cards, unlocked
            only after Parts A–C is completed and sources are revealed),
            directly after one another — no payload editing or item IDs needed.
          </Text>

          {partial && (
            <Alert color="yellow" variant="light" icon={<IconInfoCircle size={16} />}>
              <Text size="sm">
                A previous setup is incomplete
                {flow.partsAC && !flow.partsACConnected
                  ? " (Parts A–C exists but is not fully connected)"
                  : ""}
                {flow.partsAC && flow.partsACConnected && !flow.partD
                  ? " (Parts A–C is ready; Part D is missing)"
                  : ""}
                {flow.partD && !flow.partDConnected
                  ? " (Part D exists but is not fully connected)"
                  : ""}
                {flow.partsAC &&
                flow.partD &&
                flow.partsACConnected &&
                flow.partDConnected &&
                !flow.orderCorrect
                  ? " (Part D must sit directly after Parts A–C)"
                  : ""}
                . Clicking the button finishes the remaining steps without
                duplicating anything.
              </Text>
            </Alert>
          )}

          {needAC ? (
            <Select
              label={`Parts A–C template (blinded evaluation, ${PHASE3_PARTS_AC_QUESTION_COUNT} questions)`}
              placeholder="Pick the Parts A–C survey template"
              data={templateOptions}
              value={acTemplateId}
              onChange={setAcTemplateId}
              searchable
              clearable
              nothingFoundMessage="Create one in Survey Templates first"
            />
          ) : (
            <Text size="sm">
              Parts A–C: <b>{flow.partsAC!.title}</b> already exists (template{" "}
              {templateName(flow.partsAC)}).
            </Text>
          )}

          {needD ? (
            <Select
              label={`Part D template (post-reveal, ${PHASE3_PART_D_QUESTION_COUNT} questions)`}
              placeholder="Pick the Part D survey template"
              data={templateOptions}
              value={dTemplateId}
              onChange={setDTemplateId}
              searchable
              clearable
              nothingFoundMessage="Create one in Survey Templates first"
            />
          ) : (
            <Text size="sm">
              Part D: <b>{flow.partD!.title}</b> already exists (template{" "}
              {templateName(flow.partD)}).
            </Text>
          )}

          {existingChecks.errors.length > 0 && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
              <Text size="sm" fw={600} mb={4}>
                Existing Phase 3 items reference invalid templates — setup
                stopped.
              </Text>
              <Stack gap={2}>
                {existingChecks.errors.map((err) => (
                  <Text size="sm" key={err}>
                    {err}
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}

          {selectionsMade && selectionErrors.length > 0 && (
            <Alert color="red" variant="light">
              <Stack gap={4}>
                {selectionErrors.map((err) => (
                  <Text size="sm" key={err}>
                    {err}
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}

          <Group justify="flex-end">
            <Button
              color="terracotta"
              onClick={handleCreateAndConnect}
              loading={running}
              disabled={!selectionsMade || selectionErrors.length > 0 || blocked}
            >
              {partial ? "Resume Create and Connect" : "Create and Connect"}
            </Button>
          </Group>
        </Stack>
      )}
    </Card>
  );
}
