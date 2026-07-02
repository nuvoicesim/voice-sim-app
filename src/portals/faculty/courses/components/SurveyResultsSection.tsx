import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Group,
  Loader,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconClipboardList,
  IconDownload,
} from "@tabler/icons-react";
import {
  surveyInstanceApi,
  type SurveyInstanceRow,
} from "../../../../api/surveyInstanceApi";
import type { ModuleItem } from "../../../../slices/moduleItemSlice";
import {
  formatAnswer,
  type SurveyQuestionDef,
} from "../../../../utils/surveyAnswerFormat";
import {
  aggregateSurvey,
  type QuestionStats,
  type SurveyAggregation,
} from "../../../../utils/surveyStats";

/**
 * Faculty-only Survey Results section for the course Analysis dashboard.
 *
 * ADDITIVE + READ-ONLY BY DESIGN (the VOICE user study is live):
 *   - Renders collapsed by default and fetches NOTHING until a faculty user
 *     expands it, so the Analysis page initial load is unchanged.
 *   - Data access is exclusively surveyInstanceApi.getForStudent — a
 *     faculty-gated GET verified to perform no writes (it never creates an
 *     instance). No student-facing code paths are imported or touched.
 *   - Statistics cover CONSENTED students only (research-usable data); the
 *     All / per-group filter supports order-effect checks across the
 *     counter-balanced Group A / Group B branches.
 *   - Aggregation itself is a pure function (src/utils/surveyStats.ts) over
 *     each instance's frozen schemaSnapshot, so option labels reflect what
 *     students actually saw.
 */

// Gentler than the dashboard's PROGRESS_CONCURRENCY (12): this fan-out is
// user-triggered while the study is live, so keep the burst small.
const SURVEY_FETCH_CONCURRENCY = 8;

const ALL_GROUPS = "__all__";

/** Roster row passed down from the Analysis dashboard's student matrix. */
export interface SurveyStatsStudent {
  studentUserId: string;
  studentEmail: string | null;
  consented: boolean;
  groupKey: string | null;
}

interface SurveyModuleRef {
  moduleId: string;
  title: string;
  position: number;
}

interface SurveyItemRef {
  item: ModuleItem;
  moduleTitle: string;
  moduleIndex: number;
}

interface SurveyResultsSectionProps {
  courseId: string;
  students: SurveyStatsStudent[];
  sortedModules: SurveyModuleRef[];
  itemsByModule: Record<string, ModuleItem[]>;
}

// Local copy of the dashboard's throttled runner (kept private there); the
// planned shared-util consolidation is deferred while the study is live.
async function runThrottled<T>(
  jobs: Array<() => Promise<T>>,
  concurrency: number,
  onSettled: (value: T) => void,
  isCancelled: () => boolean
): Promise<void> {
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (!isCancelled()) {
      const myIndex = nextIndex++;
      if (myIndex >= jobs.length) return;
      const value = await jobs[myIndex]();
      if (!isCancelled()) onSettled(value);
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, jobs.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export function SurveyResultsSection({
  courseId,
  students,
  sortedModules,
  itemsByModule,
}: SurveyResultsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>(ALL_GROUPS);
  // instancesByItem[moduleItemId][studentUserId] = instance | null (none/failed)
  const [instancesByItem, setInstancesByItem] = useState<
    Record<string, Record<string, SurveyInstanceRow | null>>
  >({});
  const [settledCount, setSettledCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const settledPairsRef = useRef<Set<string>>(new Set());
  const inFlightPairsRef = useRef<Set<string>>(new Set());

  // Full per-course reset: the dashboard stays mounted across course-to-course
  // navigation, so stale instances must never leak into another course's view.
  useEffect(() => {
    setExpanded(false);
    setGroupFilter(ALL_GROUPS);
    setInstancesByItem({});
    setSettledCount(0);
    setFailedCount(0);
    settledPairsRef.current = new Set();
    inFlightPairsRef.current = new Set();
  }, [courseId]);

  const consentedStudents = useMemo(
    () => students.filter((s) => s.consented),
    [students]
  );
  const excludedCount = students.length - consentedStudents.length;

  const surveyItems = useMemo<SurveyItemRef[]>(() => {
    const out: SurveyItemRef[] = [];
    sortedModules.forEach((m, moduleIndex) => {
      const items = (itemsByModule[m.moduleId] || [])
        // Only items backed by a survey template can have SurveyInstance
        // responses (mirrors the backend precondition — an instance is only
        // ever created from payload.surveyTemplateId). Markdown-only debrief
        // items carry no template, so including them would just fire
        // guaranteed-empty GETs and render empty cards.
        .filter(
          (it) =>
            (it.itemType === "survey" || it.itemType === "debrief") &&
            Boolean(it.payload?.surveyTemplateId)
        )
        .sort((a, b) => a.position - b.position);
      for (const item of items) {
        out.push({ item, moduleTitle: m.title, moduleIndex });
      }
    });
    return out;
  }, [sortedModules, itemsByModule]);

  const groupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const s of consentedStudents) {
      if (s.groupKey) keys.add(s.groupKey);
    }
    return [...keys].sort();
  }, [consentedStudents]);

  // Keep the filter valid if group data changes underneath it.
  useEffect(() => {
    if (groupFilter !== ALL_GROUPS && !groupKeys.includes(groupFilter)) {
      setGroupFilter(ALL_GROUPS);
    }
  }, [groupFilter, groupKeys]);

  const totalPairs = surveyItems.length * consentedStudents.length;

  // ── Lazy fetch: only after the section is expanded ──
  // Pair-level dedup mirrors the dashboard's progress fan-out so items that
  // load incrementally (or a collapse/re-expand) never refetch settled pairs.
  useEffect(() => {
    if (!expanded) return;
    type Pair = { itemId: string; studentId: string; key: string };
    const pending: Pair[] = [];
    for (const { item } of surveyItems) {
      for (const s of consentedStudents) {
        const key = `${item.moduleItemId}|${s.studentUserId}`;
        if (settledPairsRef.current.has(key)) continue;
        if (inFlightPairsRef.current.has(key)) continue;
        inFlightPairsRef.current.add(key);
        pending.push({
          itemId: item.moduleItemId,
          studentId: s.studentUserId,
          key,
        });
      }
    }
    if (pending.length === 0) return;

    let cancelled = false;
    type PairResult = Pair & {
      instance: SurveyInstanceRow | null;
      failed: boolean;
    };
    const jobs = pending.map((p) => async (): Promise<PairResult> => {
      try {
        const res = await surveyInstanceApi.getForStudent(
          p.itemId,
          p.studentId
        );
        return { ...p, instance: res?.instance ?? null, failed: false };
      } catch {
        // Best-effort: a failed read renders as "no data", never blocks.
        return { ...p, instance: null, failed: true };
      }
    });

    runThrottled(
      jobs,
      SURVEY_FETCH_CONCURRENCY,
      ({ itemId, studentId, key, instance, failed }) => {
        settledPairsRef.current.add(key);
        inFlightPairsRef.current.delete(key);
        setSettledCount((n) => n + 1);
        if (failed) setFailedCount((n) => n + 1);
        setInstancesByItem((prev) => ({
          ...prev,
          [itemId]: { ...(prev[itemId] || {}), [studentId]: instance },
        }));
      },
      () => cancelled
    );

    return () => {
      cancelled = true;
      for (const p of pending) {
        if (!settledPairsRef.current.has(p.key)) {
          inFlightPairsRef.current.delete(p.key);
        }
      }
    };
  }, [expanded, surveyItems, consentedStudents]);

  const loading = expanded && settledCount < totalPairs;

  const filteredStudents = useMemo(
    () =>
      groupFilter === ALL_GROUPS
        ? consentedStudents
        : consentedStudents.filter((s) => s.groupKey === groupFilter),
    [consentedStudents, groupFilter]
  );
  const unassignedCount = consentedStudents.filter((s) => !s.groupKey).length;

  const segments = [
    { label: `All groups (${consentedStudents.length})`, value: ALL_GROUPS },
    ...groupKeys.map((k) => ({
      label: `${k} (${consentedStudents.filter((s) => s.groupKey === k).length})`,
      value: k,
    })),
  ];

  return (
    <Card
      withBorder
      radius="lg"
      p="lg"
      style={{
        background: "var(--claude-ivory)",
        border: "1px solid var(--claude-border-cream)",
      }}
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        onClick={() => setExpanded((v) => !v)}
        style={{ cursor: "pointer" }}
        aria-expanded={expanded}
      >
        <Group gap="xs">
          <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
            <IconClipboardList size={14} />
          </ThemeIcon>
          <Text fw={500} size="md" c="var(--claude-near-black)">
            Survey Results
          </Text>
          <Badge variant="light" color="parchment" size="sm" radius="xl">
            {surveyItems.length} survey{surveyItems.length !== 1 ? "s" : ""}
          </Badge>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {!expanded && (
            <Text size="xs" c="var(--claude-stone)">
              Click to load response statistics
            </Text>
          )}
          <ThemeIcon size={26} radius="md" variant="light" color="parchment">
            <IconChevronDown
              size={14}
              style={{
                transform: expanded ? "rotate(180deg)" : "none",
                transition: "transform 0.2s",
              }}
            />
          </ThemeIcon>
        </Group>
      </Group>

      {expanded && (
        <Stack gap="md" mt="md">
          <Text size="xs" c="var(--claude-stone)">
            Statistics include consented students only (n ={" "}
            {consentedStudents.length}
            {excludedCount > 0
              ? `; ${excludedCount} declined/pending excluded`
              : ""}
            ). Computed from submitted responses; in-progress responses are
            counted but not aggregated.
          </Text>

          {groupKeys.length > 0 && (
            <Group gap="sm" wrap="wrap">
              <SegmentedControl
                size="xs"
                radius="xl"
                color="terracotta"
                value={groupFilter}
                onChange={setGroupFilter}
                data={segments}
              />
              {groupFilter !== ALL_GROUPS && unassignedCount > 0 && (
                <Text size="xs" c="var(--claude-stone)">
                  {unassignedCount} consented student
                  {unassignedCount !== 1 ? "s" : ""} without a group are only
                  included under “All groups”.
                </Text>
              )}
            </Group>
          )}

          {loading && (
            <Group gap="sm">
              <Loader size="xs" color="terracotta" />
              <Text size="xs" c="var(--claude-stone)">
                Loading survey responses… {settledCount} of {totalPairs}
              </Text>
            </Group>
          )}
          {failedCount > 0 && (
            <Text size="xs" c="terracotta">
              {failedCount} response fetch{failedCount !== 1 ? "es" : ""}{" "}
              failed; affected students are shown as having no data.
            </Text>
          )}

          {surveyItems.length === 0 ? (
            <Text size="sm" c="var(--claude-olive)">
              This course has no survey or debrief items yet.
            </Text>
          ) : consentedStudents.length === 0 ? (
            <Text size="sm" c="var(--claude-olive)">
              No consented students yet — statistics appear once students
              accept the consent form.
            </Text>
          ) : (
            surveyItems.map((ref) => (
              <SurveyItemStats
                key={ref.item.moduleItemId}
                surveyRef={ref}
                instancesByStudent={
                  instancesByItem[ref.item.moduleItemId] || {}
                }
                allConsented={consentedStudents}
                filteredStudents={filteredStudents}
              />
            ))
          )}
        </Stack>
      )}
    </Card>
  );
}

// ───────────── Per-survey statistics card ─────────────

interface SurveyItemStatsProps {
  surveyRef: SurveyItemRef;
  instancesByStudent: Record<string, SurveyInstanceRow | null>;
  /** Every consented student — used for the CSV export regardless of filter. */
  allConsented: SurveyStatsStudent[];
  /** Students in the currently selected group filter. */
  filteredStudents: SurveyStatsStudent[];
}

function SurveyItemStats({
  surveyRef,
  instancesByStudent,
  allConsented,
  filteredStudents,
}: SurveyItemStatsProps) {
  const { item, moduleTitle, moduleIndex } = surveyRef;

  // Canonical question definitions for display: the newest snapshot among
  // consented students' instances. Answers from students whose snapshot
  // differs (template edited mid-course) still surface — unmatched values
  // are flagged as orphans by the aggregator rather than dropped.
  const questions = useMemo<SurveyQuestionDef[]>(() => {
    let newest: SurveyInstanceRow | null = null;
    for (const s of allConsented) {
      const inst = instancesByStudent[s.studentUserId];
      if (!inst?.schemaSnapshot?.questions) continue;
      if (!newest || (inst.updatedAt ?? "") > (newest.updatedAt ?? "")) {
        newest = inst;
      }
    }
    return (newest?.schemaSnapshot?.questions ?? []) as SurveyQuestionDef[];
  }, [allConsented, instancesByStudent]);

  const agg = useMemo<SurveyAggregation>(() => {
    const instances = filteredStudents
      .map((s) => instancesByStudent[s.studentUserId])
      .filter((i): i is SurveyInstanceRow => i != null);
    return aggregateSurvey(questions, instances);
  }, [questions, filteredStudents, instancesByStudent]);

  const notStarted = filteredStudents.length - agg.submitted - agg.inProgress;
  // Every consented student's fetch has settled once they all have an entry
  // (instance or null) — distinguishes "still loading" from "nobody started".
  const fullySettled = allConsented.every(
    (s) => s.studentUserId in instancesByStudent
  );

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{ background: "var(--claude-parchment)" }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs">
            <Badge color="parchment" variant="light" size="sm">
              Module {moduleIndex + 1}
            </Badge>
            <Text size="sm" fw={500} c="var(--claude-near-black)" lineClamp={1}>
              {item.title}
            </Text>
            <Badge size="xs" variant="light" color="parchment" radius="xl">
              {item.itemType}
            </Badge>
          </Group>
          <Group gap="lg" mt={4}>
            <Text size="xs" c="var(--claude-olive)">
              {moduleTitle}
            </Text>
            <Text size="xs" c="var(--claude-olive)">
              {agg.submitted} submitted · {agg.inProgress} in progress ·{" "}
              {Math.max(0, notStarted)} not started
            </Text>
          </Group>
        </Box>
        <Tooltip
          label="Download CSV (all consented students, with group column)"
          withArrow
        >
          <ActionIcon
            variant="subtle"
            color="terracotta"
            size="md"
            radius="md"
            onClick={() =>
              downloadSurveyStatsCsv(
                item.title,
                questions,
                allConsented,
                instancesByStudent
              )
            }
            disabled={questions.length === 0}
            aria-label="Download CSV"
          >
            <IconDownload size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {questions.length === 0 ? (
        <Text size="sm" c="var(--claude-stone)" mt="sm">
          {fullySettled
            ? "No students have started this survey yet."
            : "Loading responses…"}
        </Text>
      ) : (
        <Stack gap="sm" mt="sm">
          {agg.questions.map((qs, idx) => (
            <QuestionStatsCard key={qs.question.id} stats={qs} index={idx} />
          ))}
        </Stack>
      )}
    </Card>
  );
}

// ───────────── Per-question rendering ─────────────

const QUESTION_TYPE_LABEL: Record<string, string> = {
  likert: "Likert",
  choice_single: "Single choice",
  choice_multi: "Multiple choice",
  free_text: "Free text",
};

function QuestionStatsCard({
  stats,
  index,
}: {
  stats: QuestionStats;
  index: number;
}) {
  const { question, respondents, skipped } = stats;
  const typeLabel = QUESTION_TYPE_LABEL[question.type ?? ""] ?? "Answers";

  return (
    <Card
      withBorder
      radius="sm"
      p="sm"
      style={{ background: "var(--claude-ivory)" }}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text size="sm" fw={500} c="var(--claude-near-black)">
          Q{index + 1}. {question.prompt}
        </Text>
        <Badge size="xs" variant="light" color="parchment" radius="xl">
          {typeLabel}
        </Badge>
      </Group>
      <Text size="xs" c="var(--claude-stone)" mt={2}>
        n = {respondents}
        {skipped > 0 ? ` · ${skipped} skipped` : ""}
      </Text>

      {stats.options && (
        <Stack gap={6} mt="xs">
          {stats.options.map((opt) => (
            <DistributionRow
              key={opt.value}
              label={
                opt.isOrphan ? `${opt.label} (removed option)` : opt.label
              }
              count={opt.count}
              pct={opt.pct}
              dim={opt.count === 0}
            />
          ))}
          {stats.otherTexts && stats.otherTexts.length > 0 && (
            <Box mt={4}>
              <Text size="xs" c="var(--claude-olive)" fw={500}>
                “Other” responses:
              </Text>
              {stats.otherTexts.map((t, i) => (
                <Text key={i} size="xs" c="var(--claude-stone)">
                  — {t}
                </Text>
              ))}
            </Box>
          )}
        </Stack>
      )}

      {stats.likert && <LikertStatsRows likert={stats.likert} />}

      {stats.texts && (
        <ScrollArea.Autosize mah={220} mt="xs">
          <Stack gap={6}>
            {stats.texts.length === 0 ? (
              <Text size="xs" c="var(--claude-stone)">
                No responses.
              </Text>
            ) : (
              stats.texts.map((t, i) => (
                <Text key={i} size="sm" c="var(--claude-near-black)">
                  “{t.text}”
                </Text>
              ))
            )}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Card>
  );
}

function LikertStatsRows({
  likert,
}: {
  likert: NonNullable<QuestionStats["likert"]>;
}) {
  const total = likert.counts.reduce((s, n) => s + n, 0);
  const anchors = [
    likert.leftAnchor ? `1 = ${likert.leftAnchor}` : null,
    likert.rightAnchor ? `${likert.scale} = ${likert.rightAnchor}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Stack gap={6} mt="xs">
      {anchors && (
        <Text size="xs" c="var(--claude-olive)">
          {anchors}
        </Text>
      )}
      {Array.from({ length: likert.scale }, (_, i) => i + 1).map((point) => {
        const count = likert.counts[point] ?? 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <DistributionRow
            key={point}
            label={String(point)}
            count={count}
            pct={pct}
            dim={count === 0}
          />
        );
      })}
      <Text size="xs" c="var(--claude-stone)">
        mean {likert.mean === null ? "—" : likert.mean.toFixed(1)} · median{" "}
        {likert.median === null ? "—" : String(likert.median)}
      </Text>
    </Stack>
  );
}

function DistributionRow({
  label,
  count,
  pct,
  dim,
}: {
  label: string;
  count: number;
  pct: number;
  dim?: boolean;
}) {
  return (
    <Group gap="sm" wrap="nowrap">
      <Text
        size="sm"
        c={dim ? "var(--claude-stone)" : "var(--claude-near-black)"}
        style={{ width: 200, flexShrink: 0 }}
        lineClamp={2}
      >
        {label}
      </Text>
      <Progress
        value={pct}
        color="terracotta"
        size="md"
        radius="xl"
        style={{ flex: 1 }}
      />
      <Text
        size="sm"
        c={dim ? "var(--claude-stone)" : "var(--claude-near-black)"}
        style={{ width: 84, textAlign: "right", flexShrink: 0 }}
      >
        {count} ({Math.round(pct)}%)
      </Text>
    </Group>
  );
}

// ───────────── CSV export (research / CHI preparation) ─────────────

function csvEscape(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * One row per consented student who started the survey, with a Group column
 * so order-effect analysis can split A/B offline. Answers are exported as
 * human-readable labels via the shared formatter.
 */
function downloadSurveyStatsCsv(
  surveyTitle: string,
  questions: SurveyQuestionDef[],
  students: SurveyStatsStudent[],
  instancesByStudent: Record<string, SurveyInstanceRow | null>
) {
  const header = [
    "Student",
    "Group",
    "Status",
    "Started At",
    "Submitted At",
    ...questions.map((q, i) => `Q${i + 1}: ${q.prompt}`),
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const s of students) {
    const inst = instancesByStudent[s.studentUserId];
    if (!inst) continue;
    const answers = inst.answers || {};
    const row = [
      s.studentEmail || s.studentUserId,
      s.groupKey || "",
      inst.status,
      inst.startedAt || "",
      inst.submittedAt || "",
      ...questions.map((q) => formatAnswer(q, answers[q.id], answers, "")),
    ];
    lines.push(row.map(csvEscape).join(","));
  }
  const csv = lines.join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${surveyTitle.replace(/[^a-z0-9-_]+/gi, "_") || "survey"}_statistics.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
