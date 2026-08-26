import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconDatabaseImport,
  IconInfoCircle,
  IconLock,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { moduleItemApi } from "../../../../api/moduleItemApi";
import { notify } from "../../../../utils/notify";
import {
  advisoryFileError,
  describeServerError,
  formalConfirmPhrase,
  formalLockReason,
  initialImportState,
  matchesConfirmation,
  matchesEmail,
  selectFile,
  testerRevealSummary,
  type Phase3ImportMode,
  type Phase3ImportState,
  type Phase3PreviewBody,
  type Phase3Status,
  type Phase3Tester,
  type PurgePlanEntry,
  type PurgePreviewBody,
  describeExistence,
} from "../phase3-import-client";

/**
 * "Phase 3 Feedback Data Import" — the admin area for an already-Configured
 * Phase 3 flow.
 *
 * Two deliberately separate workflows: Tester Import (repeatable, purgeable,
 * unlimited in number) and Formal Student Import (one atomic 51-row cohort,
 * no resume). Everything shown here comes from the server; the browser holds no
 * AWS credentials and decides nothing:
 *
 *  - the Parts A–C / Part D binding is discovered server-side,
 *  - the frozen provenance is a server constant, shown read-only,
 *  - the tester list and the formal lock are recomputed server-side and
 *    re-checked on commit, so a stale panel cannot let anything through.
 *
 * Status is loaded on mount, after each mutation and on the manual Refresh
 * button. There is deliberately NO polling: ReviewerFeedback has no index for
 * this query and a timer would scan it forever.
 */
export function Phase3FeedbackDataImport({ moduleId }: { moduleId: string }) {
  const [status, setStatus] = useState<Phase3Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = (await moduleItemApi.phase3Status(moduleId)) as Phase3Status;
      setStatus(result);
      setStatusError(null);
    } catch (e) {
      setStatus(null);
      setStatusError(describeServerError(e).message);
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  return (
    <Card withBorder mt="md">
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
            <IconDatabaseImport size={14} />
          </ThemeIcon>
          <Text fw={500}>Phase 3 Feedback Data Import</Text>
          {status?.formal.complete && (
            <Badge color="green" variant="light" leftSection={<IconCircleCheck size={12} />}>
              Formal cohort imported
            </Badge>
          )}
          {status?.formal.inconsistent && (
            <Badge color="red" variant="light" leftSection={<IconAlertTriangle size={12} />}>
              Flow state inconsistent
            </Badge>
          )}
        </Group>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          onClick={refreshStatus}
          loading={loading}
        >
          Refresh
        </Button>
      </Group>

      {statusError && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm">{statusError}</Text>
        </Alert>
      )}

      {!status && !statusError && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            Loading the current import state…
          </Text>
        </Group>
      )}

      {status && (
        <Stack gap="md">
          <Box>
            <Text size="sm" c="dimmed">
              Bound automatically to this module's Phase 3 flow (resolved on the
              server, never sent by this page):
            </Text>
            <Text size="sm">
              Parts A–C <Code>{status.partsACItemId}</Code> · Part D{" "}
              <Code>{status.partDItemId}</Code>
            </Text>
            <Text size="sm" mt={4}>
              Formal cohort: <b>{status.formal.studentCount}</b> /{" "}
              {status.expected.studentCount} students,{" "}
              <b>{status.formal.rowCount}</b> / {status.expected.rowCount} rows ·
              Flow marker:{" "}
              <b>{status.formal.importedAt ?? "not set"}</b> · Testers:{" "}
              <b>{status.testers.length}</b> · Unclassifiable rows:{" "}
              <b>{status.unknownRows.length}</b>
            </Text>
          </Box>

          {status.formal.inconsistent && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
              <Text size="sm" fw={600} mb={4}>
                Stored rows and the flow marker disagree.
              </Text>
              <Text size="sm">{status.formal.inconsistencyReason}</Text>
            </Alert>
          )}

          {status.unknownRows.length > 0 && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
              <Text size="sm" fw={600} mb={4}>
                {status.unknownRows.length} Phase 3 row(s) cannot be classified.
              </Text>
              <Text size="sm">
                Rows written before this panel existed carry no import type. Both
                importing and purging are blocked until they are resolved off the
                website (for example with <Code>scripts/seed-phase3.mjs</Code>).
              </Text>
            </Alert>
          )}

          <TesterSection
            moduleId={moduleId}
            status={status}
            onChanged={refreshStatus}
          />
          <Divider />
          <FormalSection
            moduleId={moduleId}
            status={status}
            onChanged={refreshStatus}
          />
        </Stack>
      )}
    </Card>
  );
}

// ───────────────────────── shared file picker ─────────────────────────

function FilePicker({
  label,
  onPick,
  disabled,
}: {
  label: string;
  onPick: (fileName: string, text: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <Group gap="sm">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        aria-label={label}
        disabled={disabled}
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          if (!file) return;
          const text = await file.text();
          const advisory = advisoryFileError(file.name, text.length);
          if (advisory) {
            notify.warn(advisory, "Check the file");
            return;
          }
          onPick(file.name, text);
        }}
      />
    </Group>
  );
}

function ErrorAlert({
  title,
  message,
  details,
}: {
  title: string;
  message: string;
  details: string[];
}) {
  return (
    <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
      <Text size="sm" fw={600} mb={4}>
        {title}
      </Text>
      <Text size="sm">{message}</Text>
      {details.length > 0 && (
        <Stack gap={2} mt="xs">
          {details.slice(0, 50).map((d) => (
            <Text size="xs" key={d} ff="monospace">
              {d}
            </Text>
          ))}
          {details.length > 50 && (
            <Text size="xs" c="dimmed">
              …and {details.length - 50} more.
            </Text>
          )}
        </Stack>
      )}
    </Alert>
  );
}

function PlanTable({ preview }: { preview: Phase3PreviewBody }) {
  return (
    <Box style={{ overflowX: "auto" }}>
      <Table striped withTableBorder fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Review</Table.Th>
            <Table.Th>Student</Table.Th>
            <Table.Th>Account</Table.Th>
            <Table.Th>Order</Table.Th>
            <Table.Th>A / B / C</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {preview.plan.map((s) => (
            <Table.Tr key={s.studentUserId}>
              <Table.Td>{s.reviewId}</Table.Td>
              <Table.Td>{s.studentEmail}</Table.Td>
              <Table.Td>
                <Code>{s.studentUserId.slice(0, 12)}</Code>
              </Table.Td>
              <Table.Td>{s.sourceOrder}</Table.Td>
              <Table.Td>
                {s.cards
                  .map(
                    (c) =>
                      `${c.displayKey}=${c.sourceLabel} (${c.d1}/${c.d2}/${c.d3})`
                  )
                  .join("  ")}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  );
}

function DistributionTable({ preview }: { preview: Phase3PreviewBody }) {
  return (
    <Table withTableBorder fz="xs" w="auto">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Source order</Table.Th>
          <Table.Th>In this file</Table.Th>
          <Table.Th>Frozen allocation</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {preview.orderDistribution.map((row) => {
          const mismatch = row.expected !== null && row.actual !== row.expected;
          return (
            <Table.Tr key={row.order}>
              <Table.Td>{row.order}</Table.Td>
              <Table.Td c={mismatch ? "red" : undefined} fw={mismatch ? 700 : 400}>
                {row.actual}
              </Table.Td>
              <Table.Td>{row.expected ?? "—"}</Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

// ───────────────────────── tester ─────────────────────────

function TesterSection({
  moduleId,
  status,
  onChanged,
}: {
  moduleId: string;
  status: Phase3Status;
  onChanged: () => Promise<void>;
}) {
  const [state, setState] = useState<Phase3ImportState>(initialImportState);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // Two-phase purge. `purgePreview` is the SERVER's plan; it is never
  // synthesised locally, and the confirm inputs stay disabled until it arrives.
  const [purgeScope, setPurgeScope] = useState<"one" | "all" | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<Phase3Tester | null>(null);
  const [purgePreview, setPurgePreview] = useState<PurgePreviewBody | null>(null);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState("");

  const runPreview = async (csvText: string) => {
    setState((s) => ({ ...s, phase: "previewing", error: null, errorDetails: [] }));
    try {
      const preview = (await moduleItemApi.phase3ImportPreview(moduleId, {
        mode: "tester" as Phase3ImportMode,
        csv: csvText,
      })) as Phase3PreviewBody;
      setState((s) => ({ ...s, phase: "previewOk", preview }));
    } catch (e) {
      const { message, details } = describeServerError(e);
      setState((s) => ({
        ...s,
        phase: "previewFailed",
        preview: null,
        error: message,
        errorDetails: details,
      }));
    }
  };

  const runCommit = async () => {
    if (!state.csvText || !state.preview) return;
    setBusy(true);
    try {
      const result = (await moduleItemApi.phase3ImportCommit(moduleId, {
        mode: "tester",
        csv: state.csvText,
        expectedPlanHash: state.preview.planHash,
        confirmTesterEmail: confirmEmail.trim(),
      })) as Phase3PreviewBody;
      notify.success(
        result.written
          ? `Imported ${result.written} tester card(s).`
          : "Tester data verified; nothing needed writing."
      );
      setState(initialImportState);
      setConfirmEmail("");
      await onChanged();
    } catch (e) {
      const { message, details } = describeServerError(e);
      setState((s) => ({ ...s, phase: "commitFailed", error: message, errorDetails: details }));
      notify.error(message, "Tester import failed");
    } finally {
      setBusy(false);
    }
  };

  const previewEmail = state.preview?.plan[0]?.studentEmail ?? null;
  const canCommit =
    state.phase === "previewOk" && matchesEmail(confirmEmail, previewEmail);

  const closePurge = () => {
    setPurgeScope(null);
    setPurgeTarget(null);
    setPurgePreview(null);
    setPurgeError(null);
    setPurgeConfirm("");
  };

  /**
   * Step 1 of 2 — ask the server for the plan (`commit: false`). The server
   * re-discovers the flow and re-scans the tester's rows; the UI shows only what
   * comes back, so nothing is confirmed against a stale local snapshot.
   */
  const openPurgePreview = async (
    scope: "one" | "all",
    tester: Phase3Tester | null
  ) => {
    setPurgeScope(scope);
    setPurgeTarget(tester);
    setPurgePreview(null);
    setPurgeError(null);
    setPurgeConfirm("");
    setPurgeLoading(true);
    try {
      const preview = (await moduleItemApi.phase3PurgeTester(moduleId, {
        scope,
        ...(tester ? { studentUserId: tester.studentUserId } : {}),
        commit: false,
      })) as PurgePreviewBody;
      setPurgePreview(preview);
    } catch (e) {
      setPurgeError(describeServerError(e).message);
    } finally {
      setPurgeLoading(false);
    }
  };

  /** Step 2 of 2 — the server recomputes the plan and the confirmation again. */
  const commitPurge = async () => {
    if (!purgeScope || !purgePreview) return;
    setBusy(true);
    try {
      const result = (await moduleItemApi.phase3PurgeTester(moduleId, {
        scope: purgeScope,
        ...(purgeTarget ? { studentUserId: purgeTarget.studentUserId } : {}),
        commit: true,
        confirmText: purgeConfirm.trim(),
      })) as PurgePreviewBody;
      notify.success(
        purgeScope === "all"
          ? `Purged ${result.purged ?? 0} tester(s)` +
              (result.failed?.length ? `; ${result.failed.length} failed.` : ".")
          : "Phase 3 research data cleared. Behaviour and audit events are retained."
      );
      closePurge();
      await onChanged();
    } catch (e) {
      const message = describeServerError(e).message;
      setPurgeError(message);
      notify.error(message, "Purge failed");
    } finally {
      setBusy(false);
    }
  };

  // For a single purge the server echoes the tester's email as the phrase; for
  // purge-all it returns "PURGE ALL <n> TESTERS" built from ITS OWN count.
  const purgeExpected =
    purgeScope === "all"
      ? purgePreview?.confirmPhrase ?? null
      : purgePreview?.plans?.[0]?.studentEmail ?? null;
  const purgeConfirmed =
    purgeScope === "all"
      ? matchesConfirmation(purgeConfirm, purgeExpected ?? "\u0000")
      : matchesEmail(purgeConfirm, purgeExpected);

  return (
    <Card withBorder bg="var(--mantine-color-yellow-light)">
      <Title order={5} mb={4}>
        Tester Import
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        Import one tester at a time — one account, three rows (A/B/C). There is
        no limit on how many testers you may add; import as many as you need and
        purge them before the formal cohort.
      </Text>

      <Text size="sm" fw={600} mb={4}>
        Current testers ({status.testers.length})
      </Text>
      {status.testers.length === 0 ? (
        <Text size="sm" c="dimmed" mb="sm">
          No tester data in this flow.
        </Text>
      ) : (
        <Stack gap={4} mb="sm">
          {status.testers.map((t) => (
            <Group key={t.studentUserId} justify="space-between" wrap="nowrap">
              <Text size="sm">
                {t.studentEmail ?? <Code>{t.studentUserId}</Code>} ·{" "}
                {t.displayKeys.join("/")} · {testerRevealSummary(t)}
                {t.importedAt ? ` · ${t.importedAt.slice(0, 16).replace("T", " ")}` : ""}
              </Text>
              <Button
                size="compact-xs"
                color="red"
                variant="light"
                leftSection={<IconTrash size={12} />}
                disabled={busy || purgeLoading}
                onClick={() => openPurgePreview("one", t)}
              >
                Purge
              </Button>
            </Group>
          ))}
        </Stack>
      )}

      <Group mb="sm">
        <Button
          size="xs"
          color="red"
          variant="outline"
          disabled={status.testers.length === 0 || busy || purgeLoading}
          onClick={() => openPurgePreview("all", null)}
        >
          Purge All Tester Data
        </Button>
      </Group>

      {purgeScope && (
        <Alert color="red" variant="light" mb="sm" icon={<IconAlertTriangle size={16} />}>
          {purgeLoading && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm">Asking the server what would be deleted…</Text>
            </Group>
          )}

          {purgeError && (
            <Text size="sm" c="red">
              {purgeError}
            </Text>
          )}

          {purgePreview && (
            <>
              <Text size="sm" fw={600} mb={4}>
                {purgeScope === "all"
                  ? `Purge all ${purgePreview.testerCount} tester(s)?`
                  : `Purge ${purgePreview.plans[0]?.studentEmail ?? purgePreview.plans[0]?.studentUserId}?`}
              </Text>

              {purgePreview.plans.length === 0 ? (
                <Text size="sm">
                  The server found no tester data to delete. Refresh the panel.
                </Text>
              ) : (
                <Stack gap="xs" mb="xs">
                  {purgePreview.plans.map((plan: PurgePlanEntry) => (
                    <Box key={plan.studentUserId}>
                      <Text size="sm" fw={500}>
                        {plan.studentEmail ?? plan.studentUserId}
                      </Text>
                      <Text size="xs" ff="monospace">
                        {plan.feedbackIds.join(", ")}
                      </Text>
                      {[
                        ...plan.surveyInstances.map((r) => ["SurveyInstance", r] as const),
                        ...plan.itemProgress.map((r) => ["StudentItemProgress", r] as const),
                      ].map(([label, ref]) => (
                        <Text
                          size="xs"
                          key={`${label}-${ref.moduleItemId}`}
                          c={ref.existence === "unknown" ? "orange" : undefined}
                        >
                          {label} ({ref.moduleItemId}) — {describeExistence(ref)}
                        </Text>
                      ))}
                    </Box>
                  ))}
                </Stack>
              )}

              <Text size="sm" mt={4}>
                <b>Retained:</b> the account&apos;s behaviour EventLog (no answer
                content), this action&apos;s admin audit record, and a permanent
                tester marker that keeps the account out of the formal cohort.
                These events are excluded during analysis — this is not a deletion
                of every trace.
                <br />
                <b>Unchanged:</b> the account&apos;s course enrollment. Remove it
                separately from the course Enrollments page if that is intended.
              </Text>

              {purgePreview.plans.length > 0 && (
                <Group mt="sm" align="flex-end">
                  <TextInput
                    size="xs"
                    label={
                      purgeScope === "all"
                        ? `Type "${purgePreview.confirmPhrase}" to confirm`
                        : "Type the tester's email to confirm"
                    }
                    value={purgeConfirm}
                    onChange={(e) => setPurgeConfirm(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    size="xs"
                    color="red"
                    loading={busy}
                    disabled={!purgeConfirmed}
                    onClick={commitPurge}
                  >
                    {purgeScope === "all" ? "Purge all" : "Purge tester data"}
                  </Button>
                </Group>
              )}
            </>
          )}

          <Group mt="xs">
            <Button size="xs" variant="subtle" onClick={closePurge}>
              Cancel
            </Button>
          </Group>
        </Alert>
      )}

      <Divider my="sm" />

      <Stack gap="sm">
        <FilePicker
          label="Tester CSV (1 tester, 3 rows)"
          disabled={busy}
          onPick={(fileName, text) => {
            setState(selectFile(fileName, text));
            setConfirmEmail("");
          }}
        />
        {state.fileName && (
          <Text size="xs" c="dimmed">
            Selected: {state.fileName}
          </Text>
        )}
        <Group>
          <Button
            size="xs"
            disabled={!state.csvText || busy}
            loading={state.phase === "previewing"}
            onClick={() => state.csvText && runPreview(state.csvText)}
          >
            Preview
          </Button>
        </Group>

        {(state.phase === "previewFailed" || state.phase === "commitFailed") &&
          state.error && (
            <ErrorAlert
              title="Nothing was written."
              message={state.error}
              details={state.errorDetails}
            />
          )}

        {state.phase === "previewOk" && state.preview && (
          <Stack gap="xs">
            <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
              <Text size="sm">
                {state.preview.alreadyImported
                  ? "This tester is already imported and every card matches; confirming will re-verify and write nothing."
                  : `Ready to import ${state.preview.rowCount} card(s) for ${state.preview.plan[0]?.studentEmail}.`}
              </Text>
            </Alert>
            <PlanTable preview={state.preview} />
            <Group align="flex-end">
              <TextInput
                size="xs"
                label="Type the tester's email to confirm"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Button size="xs" loading={busy} disabled={!canCommit} onClick={runCommit}>
                Import tester
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

// ───────────────────────── formal ─────────────────────────

function FormalSection({
  moduleId,
  status,
  onChanged,
}: {
  moduleId: string;
  status: Phase3Status;
  onChanged: () => Promise<void>;
}) {
  const [state, setState] = useState<Phase3ImportState>(initialImportState);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [provenanceAck, setProvenanceAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const lockReason = formalLockReason(status);
  const expectedPhrase = formalConfirmPhrase(status.expected);

  const runPreview = async (csvText: string) => {
    setState((s) => ({ ...s, phase: "previewing", error: null, errorDetails: [] }));
    try {
      const preview = (await moduleItemApi.phase3ImportPreview(moduleId, {
        mode: "formal" as Phase3ImportMode,
        csv: csvText,
      })) as Phase3PreviewBody;
      setState((s) => ({ ...s, phase: "previewOk", preview }));
    } catch (e) {
      const { message, details } = describeServerError(e);
      setState((s) => ({
        ...s,
        phase: "previewFailed",
        preview: null,
        error: message,
        errorDetails: details,
      }));
    }
  };

  const runCommit = async () => {
    if (!state.csvText || !state.preview) return;
    setBusy(true);
    try {
      const result = (await moduleItemApi.phase3ImportCommit(moduleId, {
        mode: "formal",
        csv: state.csvText,
        expectedPlanHash: state.preview.planHash,
        confirmProvenance: status.provenance,
        // Sent so the SERVER can compare it against a phrase it rebuilds from
        // its own cohort constants. Typing it here is not what authorizes the
        // import; passing that check on the server is.
        confirmFormalPhrase: confirmPhrase.trim(),
      })) as Phase3PreviewBody;
      notify.success(
        result.written
          ? `Imported the formal cohort: ${result.written} rows.`
          : "Formal cohort verified; nothing needed writing."
      );
      setState(initialImportState);
      setConfirmPhrase("");
      setProvenanceAck(false);
      await onChanged();
    } catch (e) {
      const { message, details } = describeServerError(e);
      setState((s) => ({ ...s, phase: "commitFailed", error: message, errorDetails: details }));
      notify.error(message, "Formal import failed");
    } finally {
      setBusy(false);
    }
  };

  const canCommit =
    state.phase === "previewOk" &&
    provenanceAck &&
    matchesConfirmation(confirmPhrase, expectedPhrase);

  return (
    <Card withBorder bg="var(--mantine-color-red-light)">
      <Title order={5} mb={4}>
        Formal Student Import
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        One upload containing the whole cohort: {status.expected.studentCount}{" "}
        students, {status.expected.rowCount} rows. Written as a single
        all-or-nothing transaction — there is no partial import and no resume.
        Each student's A/B/C assignment comes only from this file.
      </Text>

      <Text size="sm" mb="sm">
        Frozen provenance (server constant, not editable, not read from the file
        name): assignment version <Code>{status.provenance.assignmentVersion}</Code>,
        random seed <Code>{status.provenance.randomSeed}</Code>.
      </Text>

      {lockReason ? (
        <Alert color="orange" variant="light" icon={<IconLock size={16} />}>
          <Text size="sm" fw={600} mb={4}>
            Formal import is locked.
          </Text>
          <Text size="sm">{lockReason}</Text>
        </Alert>
      ) : (
        <Stack gap="sm">
          <FilePicker
            label={`Formal cohort CSV (${status.expected.studentCount} students, ${status.expected.rowCount} rows)`}
            disabled={busy}
            onPick={(fileName, text) => {
              setState(selectFile(fileName, text));
              setConfirmPhrase("");
              setProvenanceAck(false);
            }}
          />
          {state.fileName && (
            <Text size="xs" c="dimmed">
              Selected: {state.fileName}
            </Text>
          )}
          <Group>
            <Button
              size="xs"
              disabled={!state.csvText || busy}
              loading={state.phase === "previewing"}
              onClick={() => state.csvText && runPreview(state.csvText)}
            >
              Preview
            </Button>
          </Group>

          {(state.phase === "previewFailed" || state.phase === "commitFailed") &&
            state.error && (
              <ErrorAlert
                title="Nothing was written."
                message={state.error}
                details={state.errorDetails}
              />
            )}

          {state.phase === "previewOk" && state.preview && (
            <Stack gap="xs">
              <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
                <Text size="sm">
                  {state.preview.alreadyImported
                    ? "Every row is already imported and matches; confirming will re-verify and write nothing."
                    : `Ready to import ${state.preview.studentCount} students / ${state.preview.rowCount} rows in one transaction.`}
                </Text>
              </Alert>
              <DistributionTable preview={state.preview} />
              <PlanTable preview={state.preview} />
              <label>
                <Group gap="xs">
                  <input
                    type="checkbox"
                    checked={provenanceAck}
                    onChange={(e) => setProvenanceAck(e.currentTarget.checked)}
                  />
                  <Text size="sm">
                    I confirm this cohort is recorded as assignment version{" "}
                    <Code>{status.provenance.assignmentVersion}</Code>, random seed{" "}
                    <Code>{status.provenance.randomSeed}</Code>.
                  </Text>
                </Group>
              </label>
              <Group align="flex-end">
                <TextInput
                  size="xs"
                  label={`Type "${expectedPhrase}" to confirm`}
                  value={confirmPhrase}
                  onChange={(e) => setConfirmPhrase(e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  size="xs"
                  color="red"
                  loading={busy}
                  disabled={!canCommit}
                  onClick={runCommit}
                >
                  Import formal cohort
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>
      )}
    </Card>
  );
}
