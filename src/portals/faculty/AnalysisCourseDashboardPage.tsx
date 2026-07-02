import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Accordion,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconChartBar,
  IconUserCheck,
  IconUserExclamation,
  IconUserOff,
  IconUsers,
} from "@tabler/icons-react";
import {
  fetchCourse,
  selectCurrentCourse,
  fetchEnrollments,
  selectCurrentEnrollments,
  type CourseEnrollment,
} from "../../slices/courseSlice";
import {
  fetchModules,
  selectModulesByCourse,
  type CourseModule,
} from "../../slices/moduleSlice";
import {
  fetchItems,
  selectAllItemsByModuleId,
  type ModuleItem,
} from "../../slices/moduleItemSlice";
import { consentApi, type ConsentDecisionRow } from "../../api/consentApi";
import {
  groupAssignmentApi,
  type CourseGroupAssignmentRow,
} from "../../api/groupAssignmentApi";
import { moduleItemApi } from "../../api/moduleItemApi";
import { cognitoUserApi } from "../../api/cognitoUserApi";
import type { StudentItemProgress } from "../../slices/studentProgressSlice";
import type { AppDispatch } from "../../store";
import { PageHeader, SectionCard, StatCard } from "../../components/design";
import { SurveyResultsSection } from "./courses/components/SurveyResultsSection";

/**
 * Faculty Analysis — course-specific dashboard (V1, frontend-only).
 *
 * Route: /faculty/analysis/:courseId
 *
 * Every count, list, and table on this page is scoped to the URL courseId.
 * Reuses existing frontend APIs / Redux slices / design-system components
 * only. No backend, schema, Amplify, or API Gateway change:
 *
 *   - courseSlice.fetchCourse + fetchEnrollments → course + enrollments
 *   - consentApi.listForCourse                   → consent decisions
 *   - groupAssignmentApi.listForCourse           → group assignments
 *   - moduleSlice.fetchModules / moduleItemSlice.fetchItems → modules + items
 *   - moduleItemApi.getProgress(itemId, studentUserId) → per-pair progress
 *   - cognitoUserApi.resolve                     → email fallback
 *
 * Strictly V1 scope: course-level overview + drill-down navigation only.
 * Per-session quantitative metrics, qualitative analysis, and any other
 * non-V1 surfaces are deliberately out of scope for this branch.
 */

const PAGE_NA = "N/A";
// Concurrency cap on the N×M getProgress fan-out. Keeps the dashboard from
// firing hundreds of simultaneous network calls when a course has 30+ active
// students and 8+ items. With CONCURRENCY = 12, a 40-student × 9-item
// dashboard sees at most 12 in-flight calls at a time.
const PROGRESS_CONCURRENCY = 12;

// ───────────── Module classification ─────────────

type ModuleStatus = "not_started" | "in_progress" | "completed";

interface StudentMatrixRow {
  studentUserId: string;
  studentEmail: string | null;
  enrollment: CourseEnrollment;
  consentDecision: ConsentDecisionRow | null;
  groupKey: string | null;
  /** moduleId → ModuleStatus computed from per-item progress. */
  moduleStatuses: Record<string, ModuleStatus>;
  /** Latest known activity timestamp across any item's progress timestamps. */
  lastActivityAt: string | null;
  /** True once every currently-known item for this student has settled. */
  progressLoaded: boolean;
}

function classifyModuleStatus(
  items: ModuleItem[],
  progressByItem: Record<string, StudentItemProgress | null>
): ModuleStatus {
  if (items.length === 0) return "not_started";
  let anyStartedOrCompleted = false;
  let allCompleted = true;
  for (const it of items) {
    const p = progressByItem[it.moduleItemId] ?? null;
    const state = p?.state;
    if (state === "in_progress" || state === "completed") {
      anyStartedOrCompleted = true;
    }
    if (state !== "completed") allCompleted = false;
  }
  if (allCompleted) return "completed";
  if (anyStartedOrCompleted) return "in_progress";
  return "not_started";
}

// ───────────── Relevant-path (assigned-branch) filtering ─────────────
//
// DISPLAY-ONLY. A minimal, self-contained port of the off-branch item-hiding
// rule the student workflow already applies in
// src/portals/student/courses/StudentCoursePage.tsx (NOT imported — that file
// is intentionally left untouched). For counter-balanced / group-specific
// modules (e.g. Group A vs Group B items in Module 2), a student is assigned
// only ONE branch and never sees the other branch's items, so the faculty
// dashboard must classify Started/Completed over each student's RELEVANT items
// rather than every raw item in the module.
//
// This NEVER changes any locked/unlocked/completed state and writes nothing —
// it only decides which items count toward this dashboard's per-module
// classification. It is intentionally a subset of the student gating evaluator
// (group_in + all_of + after_item hidden-propagation only); lock/unlock and
// consent-driven hiding are out of scope for these display counts.

/** Minimal structural shape of an item's `gating` (ModuleItem.gating is `any`).
 *  The codebase uses `kind`; `type` is accepted defensively. */
interface ItemGating {
  kind?: string;
  type?: string;
  groups?: string[];
  clauses?: ItemGating[];
  moduleItemId?: string;
}

/**
 * True when `gating` places the item on a counter-balanced branch the student
 * is NOT in (so it is excluded from that student's relevant path). Mirrors the
 * student page's `hidden` rule:
 *   - no gating / open / after_module / unknown → not off-branch (keep)
 *   - group_in → off-branch only when the student HAS group keys and none match
 *     (a not-yet-randomized student keeps the item pending, never hidden)
 *   - all_of   → off-branch if ANY child clause hides it
 *   - after_item → inherits the prerequisite item's off-branch status
 * `gatingById` maps moduleItemId → that item's gating, for after_item chains.
 */
function isGatingOffBranch(
  gating: ItemGating | null | undefined,
  myGroupKeys: string[],
  gatingById: Record<string, ItemGating | null | undefined>,
  depth = 0
): boolean {
  if (!gating || depth > 20) return false;
  const kind = gating.kind ?? gating.type;

  if (kind === "group_in") {
    // Not yet randomized → item is pending for this student, NOT off-branch.
    if (myGroupKeys.length === 0) return false;
    const allowed = gating.groups ?? [];
    return !allowed.some((k) => myGroupKeys.includes(k));
  }

  if (kind === "all_of") {
    return (gating.clauses ?? []).some((clause) =>
      isGatingOffBranch(clause, myGroupKeys, gatingById, depth + 1)
    );
  }

  if (kind === "after_item") {
    const prereqGating = gating.moduleItemId
      ? gatingById[gating.moduleItemId]
      : undefined;
    return isGatingOffBranch(prereqGating, myGroupKeys, gatingById, depth + 1);
  }

  return false;
}

/**
 * A student's relevant assigned-path items = all module items minus those that
 * are off-branch for the student's group keys. Faculty display classification
 * only — never affects real progress/lock state.
 */
function relevantItemsForStudent(
  items: ModuleItem[],
  myGroupKeys: string[],
  gatingById: Record<string, ItemGating | null | undefined>
): ModuleItem[] {
  return items.filter(
    (it) => !isGatingOffBranch(it.gating, myGroupKeys, gatingById)
  );
}

function moduleStatusBadge(status: ModuleStatus): {
  label: string;
  color: string;
  variant: "filled" | "light" | "outline";
} {
  switch (status) {
    case "completed":
      return { label: "Completed", color: "terracotta", variant: "filled" };
    case "in_progress":
      return { label: "Started", color: "terracotta", variant: "light" };
    default:
      return { label: "Not started", color: "parchment", variant: "light" };
  }
}

function consentBadge(d: ConsentDecisionRow | null): {
  label: string;
  color: string;
  variant: "filled" | "light" | "outline";
} {
  if (!d) return { label: "Pending", color: "parchment", variant: "light" };
  if (d.decision === "agreed")
    return { label: "Accepted", color: "terracotta", variant: "filled" };
  return { label: "Declined", color: "terracotta", variant: "outline" };
}

/**
 * Throttled-concurrency runner that streams results as they settle.
 * Each completed (or rejected) job is reported via the per-job callbacks
 * `onFulfilled` / `onRejected` immediately, rather than waiting for the
 * whole batch. This means callers can commit per-pair progress to React
 * state as it arrives, so a re-run of the parent effect cannot drop
 * intermediate results from an earlier run that hadn't fully settled.
 *
 * The `isCancelled` callback lets the caller gate further work cheaply
 * (e.g. if the courseId changed). Workers exit between jobs when
 * cancellation is requested; already-in-flight jobs run to completion
 * but their per-job callbacks no-op (the caller is expected to early-
 * return on cancellation inside the callback). Never throws.
 */
async function runWithConcurrency<T>(
  jobs: Array<() => Promise<T>>,
  concurrency: number,
  onFulfilled: (value: T) => void,
  onRejected: (reason: unknown) => void,
  isCancelled: () => boolean = () => false
): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (!isCancelled()) {
      const myIndex = nextIndex++;
      if (myIndex >= jobs.length) return;
      try {
        const value = await jobs[myIndex]();
        if (!isCancelled()) onFulfilled(value);
      } catch (reason) {
        if (!isCancelled()) onRejected(reason);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, jobs.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

// ───────────── Page ─────────────

export default function AnalysisCourseDashboardPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  // currentCourse / currentEnrollments are Redux-global slices shared with
  // /faculty/courses/:courseId. On course-to-course navigation those slices
  // may still carry the previous course's data briefly while the new
  // course's fetchCourse / fetchEnrollments are in flight. We gate the
  // displayed course on a courseId match and filter enrollments by
  // courseId so the dashboard never renders another course's data under
  // this URL. selectModulesByCourse already filters by courseId.
  const rawCourse = useSelector(selectCurrentCourse);
  const rawEnrollments = useSelector(selectCurrentEnrollments);
  const modules = useSelector(selectModulesByCourse(courseId || ""));
  const itemsByModule = useSelector(selectAllItemsByModuleId);

  const course =
    rawCourse && rawCourse.courseId === courseId ? rawCourse : null;
  const enrollments = useMemo(
    () => rawEnrollments.filter((e) => e.courseId === courseId),
    [rawEnrollments, courseId]
  );

  const [consentDecisions, setConsentDecisions] = useState<ConsentDecisionRow[]>(
    []
  );
  const [groupAssignments, setGroupAssignments] = useState<
    CourseGroupAssignmentRow[]
  >([]);
  const [resolvedEmails, setResolvedEmails] = useState<Record<string, string | null>>(
    {}
  );
  // progressByStudent[studentUserId][moduleItemId] = StudentItemProgress | null
  const [progressByStudent, setProgressByStudent] = useState<
    Record<string, Record<string, StudentItemProgress | null>>
  >({});

  const [coreLoading, setCoreLoading] = useState(true);
  const [coreError, setCoreError] = useState<string | null>(null);

  // Per (studentUserId, moduleItemId) fetch tracking, keyed at the pair
  // level — NOT per studentUserId — so later-loaded module items (when
  // itemsByModule fills in module-by-module) are not silently skipped.
  //
  //  - settledPairsRef: pairs whose getProgress call has actually resolved
  //    OR rejected (a rejection settles with a null progress row). Only a
  //    settled pair is treated as "done". Per-student loaded state is
  //    DERIVED from this set vs. the required pairs (see matrix) — there is
  //    no manual pending counter that could drift out of sync on cleanup.
  //  - inFlightPairsRef: pairs with a request currently outstanding, used
  //    only to avoid issuing a duplicate request while one is in flight. On
  //    effect cleanup, any still-unsettled in-flight pair this run started
  //    is removed so the NEXT effect run can retry it. This is what keeps a
  //    batch cancelled mid-flight (normal during incremental item loading)
  //    from permanently stranding pairs or students.
  const settledPairsRef = useRef<Set<string>>(new Set());
  const inFlightPairsRef = useRef<Set<string>>(new Set());

  // ── Fetch course / enrollments / modules + reset per-course state ──
  useEffect(() => {
    if (!courseId) return;
    // Clear all per-course local state on courseId change so a
    // course-to-course navigation can't leak stale data while the new
    // course's fetches are in flight.
    setConsentDecisions([]);
    setGroupAssignments([]);
    setResolvedEmails({});
    setProgressByStudent({});
    settledPairsRef.current = new Set();
    inFlightPairsRef.current = new Set();

    dispatch(fetchCourse(courseId));
    dispatch(fetchEnrollments(courseId));
    dispatch(fetchModules(courseId));
  }, [dispatch, courseId]);

  // ── Fetch items per module once each module is known ──
  useEffect(() => {
    for (const m of modules) {
      if (!itemsByModule[m.moduleId]) {
        dispatch(fetchItems(m.moduleId));
      }
    }
  }, [modules, itemsByModule, dispatch]);

  // ── Fetch consent + group assignments scoped to this course ──
  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    setCoreLoading(true);
    setCoreError(null);
    (async () => {
      try {
        const [consentRes, groupRes] = await Promise.all([
          consentApi.listForCourse(courseId),
          groupAssignmentApi.listForCourse(courseId),
        ]);
        if (cancelled) return;
        setConsentDecisions(consentRes.decisions || []);
        setGroupAssignments(groupRes.assignments || []);
      } catch (e: unknown) {
        if (cancelled) return;
        setCoreError(
          e instanceof Error ? e.message : "Failed to load course analysis data"
        );
      } finally {
        if (!cancelled) setCoreLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // ── Resolve missing emails (implicit students of default courses) ──
  const enrollmentsMissingEmail = useMemo(
    () => enrollments.filter((e) => e.status === "active" && !e.studentEmail),
    [enrollments]
  );
  useEffect(() => {
    if (enrollmentsMissingEmail.length === 0) return;
    const toResolve = enrollmentsMissingEmail
      .map((e) => e.studentUserId)
      .filter((id) => !(id in resolvedEmails));
    if (toResolve.length === 0) return;
    let cancelled = false;
    cognitoUserApi
      .resolve(toResolve)
      .then((res) => {
        if (cancelled) return;
        const patch: Record<string, string | null> = {};
        for (const u of res.users || []) patch[u.userId] = u.email ?? null;
        setResolvedEmails((prev) => ({ ...prev, ...patch }));
      })
      .catch(() => {
        // Best-effort. Rows without resolved email fall back to userId.
      });
    return () => {
      cancelled = true;
    };
  }, [enrollmentsMissingEmail, resolvedEmails]);

  // ── Per-student per-item progress (N × M, throttled) ──
  //
  // Each module's items load via separate fetchItems calls, so allItems
  // grows incrementally. Dedup is keyed on (studentUserId, moduleItemId)
  // pairs — never per-studentUserId — so later-loaded module items don't
  // get silently skipped. Concurrency is capped via settleWithConcurrency
  // to avoid pummeling the API on large classes. Per-student
  // progressLoaded flips true only once every currently-known item for
  // that student has settled.
  const allItems = useMemo<ModuleItem[]>(() => {
    const out: ModuleItem[] = [];
    for (const m of modules) {
      const list = itemsByModule[m.moduleId] || [];
      for (const it of list) out.push(it);
    }
    return out;
  }, [modules, itemsByModule]);

  useEffect(() => {
    const activeStudents = enrollments.filter((e) => e.status === "active");
    // Nothing to fetch when there are no active students or no items yet.
    // A zero-item course is NOT an error state: per-student loaded state is
    // derived from required-vs-settled pairs in `matrix`, so with zero
    // required pairs every student is vacuously "loaded" and no progress
    // banner is shown. (See matrix + matrixFullyLoaded.)
    if (activeStudents.length === 0 || allItems.length === 0) return;

    // Gather every (studentUserId, moduleItemId) pair that is neither
    // already settled nor currently in flight. A pair is claimed as
    // in-flight ONLY here, and is marked settled ONLY when its request
    // actually resolves/rejects — never up front — so a cancelled batch
    // cannot leave a pair flagged "done" without a result.
    type PendingPair = { studentId: string; item: ModuleItem; key: string };
    const pending: PendingPair[] = [];
    for (const e of activeStudents) {
      for (const it of allItems) {
        const key = `${e.studentUserId}|${it.moduleItemId}`;
        if (settledPairsRef.current.has(key)) continue;
        if (inFlightPairsRef.current.has(key)) continue;
        inFlightPairsRef.current.add(key);
        pending.push({ studentId: e.studentUserId, item: it, key });
      }
    }
    if (pending.length === 0) return;

    let cancelled = false;

    // Each job carries its (studentId, itemId, key) identity through both
    // the fulfilled and the rejected path. A rejected getProgress call is
    // treated as "settled with no progress row" — the same fallback the
    // existing student-detail page uses — so one failed call never blocks
    // the dashboard and the pair is not retried forever.
    type PairResult = {
      studentId: string;
      itemId: string;
      key: string;
      progress: StudentItemProgress | null;
    };
    const jobs: Array<() => Promise<PairResult>> = pending.map((p) => {
      return async (): Promise<PairResult> => {
        try {
          const r = (await moduleItemApi.getProgress(
            p.item.moduleItemId,
            p.studentId
          )) as { progress?: StudentItemProgress | null } | null;
          return {
            studentId: p.studentId,
            itemId: p.item.moduleItemId,
            key: p.key,
            progress: (r?.progress ?? null) as StudentItemProgress | null,
          };
        } catch {
          return {
            studentId: p.studentId,
            itemId: p.item.moduleItemId,
            key: p.key,
            progress: null,
          };
        }
      };
    });

    // Stream each settled pair into state as it lands. Committing per-pair
    // means a re-run of this effect (triggered when itemsByModule grows as
    // modules' items load incrementally) does not drop progress for pairs
    // whose requests had already returned. The settle callback only fires
    // when the batch is NOT cancelled (runWithConcurrency gates it), which
    // prevents a stale previous-course batch from polluting state after a
    // course-to-course navigation reset the refs.
    runWithConcurrency(
      jobs,
      PROGRESS_CONCURRENCY,
      ({ studentId, itemId, key, progress }) => {
        settledPairsRef.current.add(key);
        inFlightPairsRef.current.delete(key);
        setProgressByStudent((prev) => ({
          ...prev,
          [studentId]: {
            ...(prev[studentId] || {}),
            [itemId]: progress,
          },
        }));
      },
      () => {
        // jobs[] never reject (we catch above); nothing to do here.
      },
      () => cancelled
    );

    return () => {
      cancelled = true;
      // Release any pair this run claimed but that has not settled yet so
      // the next effect run can retry it. Settled pairs are protected by
      // settledPairsRef and were already removed from the in-flight set.
      for (const p of pending) {
        if (!settledPairsRef.current.has(p.key)) {
          inFlightPairsRef.current.delete(p.key);
        }
      }
    };
  }, [allItems, enrollments]);

  // ── Build the student matrix used everywhere on the page ──
  //
  // Consent decision per student: most recent (by updatedAt) wins.
  // Group key per student: prefer the row whose scopeKey matches this
  // courseId; fall back to any earlier-seen row for the same student.
  const matrix = useMemo<StudentMatrixRow[]>(() => {
    const activeEnrollments = enrollments.filter((e) => e.status === "active");
    const consentByStudent = new Map<string, ConsentDecisionRow>();
    for (const d of consentDecisions) {
      const existing = consentByStudent.get(d.studentUserId);
      if (!existing || existing.updatedAt < d.updatedAt) {
        consentByStudent.set(d.studentUserId, d);
      }
    }
    const groupByStudent = new Map<string, string>();
    for (const g of groupAssignments) {
      if (g.scopeKey === courseId) {
        groupByStudent.set(g.studentUserId, g.groupKey);
      } else if (!groupByStudent.has(g.studentUserId)) {
        groupByStudent.set(g.studentUserId, g.groupKey);
      }
    }

    // For RELEVANT-PATH classification we need ALL of a student's group keys,
    // not the single display key above. A student may hold several group
    // assignments (e.g. course-scoped + module-scoped randomizers), and the
    // student workflow's relevance check (selectMyGroupKeysForCourse) is
    // scopeKey-agnostic — it considers every group key. Mirror that here.
    const groupKeysByStudent = new Map<string, string[]>();
    for (const g of groupAssignments) {
      const keys = groupKeysByStudent.get(g.studentUserId) ?? [];
      if (!keys.includes(g.groupKey)) keys.push(g.groupKey);
      groupKeysByStudent.set(g.studentUserId, keys);
    }

    // moduleItemId → that item's gating, so the relevance filter can resolve
    // after_item branch-propagation. Derived from currently-loaded items;
    // incremental item loading simply means a later memo pass sees more.
    const gatingById: Record<string, ItemGating | null | undefined> = {};
    for (const m of modules) {
      for (const it of itemsByModule[m.moduleId] || []) {
        gatingById[it.moduleItemId] = it.gating;
      }
    }

    // A student's progress is "loaded" only once every currently-known item
    // for the course has a settled pair for that student. We additionally
    // require that each module's items have actually finished loading
    // (itemsByModule entry present) so a student isn't briefly reported as
    // loaded during the incremental item fetch. When the course has no
    // modules / no items, itemsFullyLoaded is true and the per-student pair
    // check is vacuously satisfied — so a zero-item course is treated as
    // fully loaded with an empty progress set (no infinite banner).
    const itemsFullyLoaded = modules.every(
      (m) => itemsByModule[m.moduleId] !== undefined
    );

    return activeEnrollments.map<StudentMatrixRow>((e) => {
      const studentEmail =
        e.studentEmail ?? resolvedEmails[e.studentUserId] ?? null;
      const progressMap = progressByStudent[e.studentUserId] || {};
      const myGroupKeys = groupKeysByStudent.get(e.studentUserId) ?? [];
      const moduleStatuses: Record<string, ModuleStatus> = {};
      let lastActivityAt: string | null = null;
      let allPairsSettled = true;
      for (const m of modules) {
        const items = itemsByModule[m.moduleId] || [];
        // Classify over the student's RELEVANT (assigned-branch) items only, so
        // off-branch group-specific items the student is never assigned cannot
        // make a counter-balanced module permanently "incomplete". With no
        // group keys yet, nothing is off-branch → identical to the raw set.
        // If every item is off-branch, relevantItems is empty and
        // classifyModuleStatus returns "not_started" (never inflated).
        const relevantItems = relevantItemsForStudent(
          items,
          myGroupKeys,
          gatingById
        );
        moduleStatuses[m.moduleId] = classifyModuleStatus(
          relevantItems,
          progressMap
        );
        // Progress-loading tracking (P1/P2) still iterates ALL items: the N×M
        // effect fetches every pair, so "loaded" must wait for every pair
        // (off-branch pairs settle as null) — preserved unchanged below.
        for (const it of items) {
          if (
            !settledPairsRef.current.has(
              `${e.studentUserId}|${it.moduleItemId}`
            )
          ) {
            allPairsSettled = false;
          }
          const p = progressMap[it.moduleItemId] ?? null;
          if (!p) continue;
          for (const ts of [p.completedAt, p.startedAt, p.unlockedAt]) {
            if (ts && (!lastActivityAt || ts > lastActivityAt)) {
              lastActivityAt = ts;
            }
          }
        }
      }
      return {
        studentUserId: e.studentUserId,
        studentEmail,
        enrollment: e,
        consentDecision: consentByStudent.get(e.studentUserId) ?? null,
        groupKey: groupByStudent.get(e.studentUserId) ?? null,
        moduleStatuses,
        lastActivityAt,
        progressLoaded: itemsFullyLoaded && allPairsSettled,
      };
    });
  }, [
    enrollments,
    consentDecisions,
    groupAssignments,
    resolvedEmails,
    progressByStudent,
    modules,
    itemsByModule,
    courseId,
  ]);

  if (!courseId) return <Navigate to="/faculty/analysis" replace />;

  if (coreError) {
    return (
      <Box p="md">
        <Anchor onClick={() => navigate("/faculty/analysis")} mb="xs">
          <Group gap={4}>
            <IconArrowLeft size={14} />
            <Text size="sm">Back to Analysis</Text>
          </Group>
        </Anchor>
        <Text c="terracotta">{coreError}</Text>
      </Box>
    );
  }

  if (!course || coreLoading) {
    return (
      <Box p="md">
        <Loader color="terracotta" />
      </Box>
    );
  }

  // Latest-per-student consent (computed from matrix so it always reflects
  // the actual roster — Codex review feedback: don't use just the
  // backend-supplied decision-row counts, which can count multiple
  // decisions per student or count decisions for non-enrolled students).
  const activeCount = matrix.length;
  const agreedCount = matrix.filter(
    (r) => r.consentDecision?.decision === "agreed"
  ).length;
  const declinedCount = matrix.filter(
    (r) => r.consentDecision?.decision === "declined"
  ).length;
  const pendingCount = activeCount - agreedCount - declinedCount;

  const sortedModules = [...modules].sort((a, b) => a.position - b.position);
  const matrixFullyLoaded =
    activeCount > 0 && matrix.every((r) => r.progressLoaded);
  const progressLoadedCount = matrix.filter((r) => r.progressLoaded).length;

  return (
    <Stack gap="xl">
      <Box>
        <Anchor onClick={() => navigate("/faculty/analysis")}>
          <Group gap={4}>
            <IconArrowLeft size={14} />
            <Text size="sm">Back to Analysis</Text>
          </Group>
        </Anchor>
      </Box>

      <PageHeader
        title="Course Analysis"
        subtitle={course.title}
        actions={
          <Group gap="sm" wrap="nowrap">
            <Badge
              color={course.status === "published" ? "terracotta" : "parchment"}
              variant={course.status === "published" ? "filled" : "light"}
              size="sm"
            >
              {course.status}
            </Badge>
            <Button
              variant="light"
              color="terracotta"
              radius="lg"
              onClick={() => navigate(`/faculty/courses/${courseId}`)}
            >
              Open Course
            </Button>
          </Group>
        }
      />

      {/* Progress-loading indicator while N×M progress calls are settling */}
      {activeCount > 0 && !matrixFullyLoaded && (
        <Card withBorder radius="lg" p="md">
          <Group gap="md" align="center">
            <Loader size="xs" color="terracotta" />
            <Box style={{ flex: 1 }}>
              <Text size="sm" fw={500} c="var(--claude-near-black)">
                Loading per-student module progress…
              </Text>
              <Text size="xs" c="var(--claude-stone)">
                {progressLoadedCount} of {activeCount} students loaded. Tables
                below update progressively.
              </Text>
              <Progress
                size="xs"
                radius="xl"
                mt={6}
                value={(progressLoadedCount / Math.max(1, activeCount)) * 100}
                color="terracotta"
              />
            </Box>
          </Group>
        </Card>
      )}

      {/* ── Course Summary StatCards ── */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <StatCard
          label="Enrolled Students"
          value={activeCount}
          icon={<IconUsers size={22} />}
          hint={course.title}
        />
        <StatCard
          label="Consent Accepted"
          value={agreedCount}
          icon={<IconUserCheck size={22} />}
          hint={`of ${activeCount} active`}
        />
        <StatCard
          label="Consent Declined"
          value={declinedCount}
          icon={<IconUserOff size={22} />}
          hint={`of ${activeCount} active`}
        />
        <StatCard
          label="Pending Decision"
          value={pendingCount}
          icon={<IconUserExclamation size={22} />}
          hint="No accept/decline on file"
        />
      </SimpleGrid>

      {/* ── Module Progress (counts per module) ──
          Started/Completed are computed over each student's RELEVANT assigned
          path: off-branch group-specific items (counter-balanced Group A / B
          items the student is never assigned) are excluded via the relevant-
          path filter, so a branched module is not permanently "Not started" /
          "incomplete" for every student. When a student has no group-assignment
          data yet (e.g. not yet randomized), the full raw item set is used.
          This is a display-only classification, not the official
          course-completion logic. The tooltip below says so. */}
      <SectionCard
        title={
          <Group gap="xs">
            <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
              <IconChartBar size={14} />
            </ThemeIcon>
            <Tooltip
              label="Module progress is calculated using each student's relevant assigned path when group-assignment data is available. Raw item progress may differ for randomized or group-specific modules. Not equivalent to official course-completion logic."
              withinPortal
              multiline
              w={320}
            >
              <Text fw={500} size="md" c="var(--claude-near-black)">
                Module Progress (Relevant Assigned Path)
              </Text>
            </Tooltip>
          </Group>
        }
      >
        {sortedModules.length === 0 ? (
          <Text size="sm" c="var(--claude-olive)">
            This course has no modules yet.
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {sortedModules.map((m, idx) => {
              const startedCount = matrix.filter(
                (r) =>
                  r.moduleStatuses[m.moduleId] === "in_progress" ||
                  r.moduleStatuses[m.moduleId] === "completed"
              ).length;
              const completedCount = matrix.filter(
                (r) => r.moduleStatuses[m.moduleId] === "completed"
              ).length;
              return (
                <Card
                  key={m.moduleId}
                  withBorder
                  radius="lg"
                  p="md"
                  style={{ background: "var(--claude-ivory)" }}
                >
                  <Stack gap={6}>
                    <Group gap="xs">
                      <Badge color="parchment" variant="light" size="sm">
                        Module {idx + 1}
                      </Badge>
                      <Text
                        size="sm"
                        fw={500}
                        c="var(--claude-near-black)"
                        lineClamp={1}
                      >
                        {m.title}
                      </Text>
                    </Group>
                    <Group justify="space-between" mt={6}>
                      <Group gap={4}>
                        <Text size="xs" c="var(--claude-olive)">
                          Started:
                        </Text>
                        <Text
                          size="md"
                          fw={500}
                          c="var(--claude-near-black)"
                          style={{ fontFamily: "Georgia, serif" }}
                        >
                          {startedCount}
                        </Text>
                      </Group>
                      <Group gap={4}>
                        <Text size="xs" c="var(--claude-olive)">
                          Completed:
                        </Text>
                        <Text
                          size="md"
                          fw={500}
                          c="var(--claude-terracotta)"
                          style={{ fontFamily: "Georgia, serif" }}
                        >
                          {completedCount}
                        </Text>
                      </Group>
                    </Group>
                    <Progress
                      size="sm"
                      radius="xl"
                      value={(completedCount / Math.max(1, activeCount)) * 100}
                      color="terracotta"
                      mt={6}
                    />
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        )}
      </SectionCard>

      {/* ── Students by Module Progress ── */}
      <StudentsByModuleProgress
        sortedModules={sortedModules}
        matrix={matrix}
        onOpenStudent={(uid) =>
          navigate(`/faculty/courses/${courseId}/students/${uid}`)
        }
      />

      {/* ── Students grouped by Consent Status ── */}
      <ConsentGroupedStudents
        courseId={courseId}
        matrix={matrix}
        sortedModules={sortedModules}
        onOpenStudent={(uid) =>
          navigate(`/faculty/courses/${courseId}/students/${uid}`)
        }
      />

      {/* ── Survey Results (additive; collapsed by default, fetches only
          when a faculty user expands it — initial page load unchanged) ── */}
      <SurveyResultsSection
        courseId={courseId}
        students={matrix.map((r) => ({
          studentUserId: r.studentUserId,
          studentEmail: r.studentEmail,
          consented: r.consentDecision?.decision === "agreed",
          groupKey: r.groupKey,
        }))}
        sortedModules={sortedModules}
        itemsByModule={itemsByModule}
      />

      <Text size="xs" c="var(--claude-stone)" ta="center" mt="md">
        Consent grouping is for faculty navigation only. All students are
        visible regardless of consent decision; consent affects research-data
        usage only.
      </Text>
    </Stack>
  );
}

// ───────────── Sub-component: Students by Module Progress ─────────────

interface ModuleProgressSubProps {
  sortedModules: CourseModule[];
  matrix: StudentMatrixRow[];
  onOpenStudent: (studentUserId: string) => void;
}

function StudentsByModuleProgress({
  sortedModules,
  matrix,
  onOpenStudent,
}: ModuleProgressSubProps) {
  // A student can appear in multiple categories (e.g., "Module 1 Completed"
  // and "Module 2 Started"). These are filter views, not mutually exclusive
  // buckets. "Not Started" = no in_progress/completed items across all
  // modules of this course.
  const notStarted = matrix.filter((r) =>
    sortedModules.every((m) => r.moduleStatuses[m.moduleId] === "not_started")
  );

  const tabs: Array<{
    key: string;
    label: string;
    students: StudentMatrixRow[];
  }> = [{ key: "not_started", label: "Not Started", students: notStarted }];
  sortedModules.forEach((m, idx) => {
    const started = matrix.filter(
      (r) =>
        r.moduleStatuses[m.moduleId] === "in_progress" ||
        r.moduleStatuses[m.moduleId] === "completed"
    );
    const completed = matrix.filter(
      (r) => r.moduleStatuses[m.moduleId] === "completed"
    );
    tabs.push({
      key: `m${idx + 1}_started`,
      label: `Module ${idx + 1} Started`,
      students: started,
    });
    tabs.push({
      key: `m${idx + 1}_completed`,
      label: `Module ${idx + 1} Completed`,
      students: completed,
    });
  });

  return (
    <SectionCard
      title={
        <Group gap="xs">
          <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
            <IconUsers size={14} />
          </ThemeIcon>
          <Tooltip
            label="Module progress is calculated using each student's relevant assigned path when group-assignment data is available. Raw item progress may differ for randomized or group-specific modules. Not equivalent to official course-completion logic."
            withinPortal
            multiline
            w={320}
          >
            <Text fw={500} size="md" c="var(--claude-near-black)">
              Students by Module Progress (relevant assigned path)
            </Text>
          </Tooltip>
        </Group>
      }
    >
      {sortedModules.length === 0 ? (
        <Text size="sm" c="var(--claude-olive)">
          This course has no modules yet.
        </Text>
      ) : matrix.length === 0 ? (
        <Text size="sm" c="var(--claude-olive)">
          No active students enrolled.
        </Text>
      ) : (
        <Tabs defaultValue={tabs[0]?.key} color="terracotta">
          <Tabs.List>
            {tabs.map((t) => (
              <Tabs.Tab key={t.key} value={t.key}>
                {t.label}{" "}
                <Badge size="sm" ml={6} color="parchment" variant="light">
                  {t.students.length}
                </Badge>
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {tabs.map((t) => (
            <Tabs.Panel key={t.key} value={t.key} pt="md">
              {t.students.length === 0 ? (
                <Text size="sm" c="var(--claude-olive)">
                  No students in this category yet.
                </Text>
              ) : (
                <Stack gap={4}>
                  {t.students.map((s) => (
                    <Group key={s.studentUserId} justify="space-between">
                      <Text size="sm" c="var(--claude-near-black)">
                        {s.studentEmail || s.studentUserId}
                      </Text>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="terracotta"
                        onClick={() => onOpenStudent(s.studentUserId)}
                      >
                        View Detail
                      </Button>
                    </Group>
                  ))}
                </Stack>
              )}
            </Tabs.Panel>
          ))}
        </Tabs>
      )}
    </SectionCard>
  );
}

// ───────────── Sub-component: Students grouped by Consent Status ─────────

interface ConsentGroupsProps {
  courseId: string;
  matrix: StudentMatrixRow[];
  sortedModules: CourseModule[];
  onOpenStudent: (studentUserId: string) => void;
}

function ConsentGroupedStudents({
  matrix,
  sortedModules,
  onOpenStudent,
}: ConsentGroupsProps) {
  const accepted = matrix.filter(
    (r) => r.consentDecision?.decision === "agreed"
  );
  const declined = matrix.filter(
    (r) => r.consentDecision?.decision === "declined"
  );
  const pending = matrix.filter((r) => !r.consentDecision);

  return (
    <SectionCard
      title={
        <Group gap="xs">
          <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
            <IconUserCheck size={14} />
          </ThemeIcon>
          <Text fw={500} size="md" c="var(--claude-near-black)">
            Students Grouped by Consent
          </Text>
        </Group>
      }
    >
      <Accordion
        multiple
        defaultValue={["accepted"]}
        variant="separated"
        radius="md"
      >
        <ConsentGroupAccordion
          value="accepted"
          label="Consent Accepted Students"
          students={accepted}
          sortedModules={sortedModules}
          onOpenStudent={onOpenStudent}
          tone="filled"
        />
        <ConsentGroupAccordion
          value="declined"
          label="Consent Declined Students"
          students={declined}
          sortedModules={sortedModules}
          onOpenStudent={onOpenStudent}
          tone="outline"
        />
        <ConsentGroupAccordion
          value="pending"
          label="No Consent Decision / Pending Students"
          students={pending}
          sortedModules={sortedModules}
          onOpenStudent={onOpenStudent}
          tone="light"
        />
      </Accordion>
    </SectionCard>
  );
}

interface ConsentGroupAccordionProps {
  value: string;
  label: string;
  students: StudentMatrixRow[];
  sortedModules: CourseModule[];
  onOpenStudent: (studentUserId: string) => void;
  tone: "filled" | "outline" | "light";
}

function ConsentGroupAccordion({
  value,
  label,
  students,
  sortedModules,
  onOpenStudent,
  tone,
}: ConsentGroupAccordionProps) {
  return (
    <Accordion.Item value={value}>
      <Accordion.Control>
        <Group gap="xs">
          <Text fw={500} c="var(--claude-near-black)">
            {label}
          </Text>
          <Badge color="terracotta" variant={tone} size="sm">
            {students.length}
          </Badge>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        {students.length === 0 ? (
          <Text size="sm" c="var(--claude-olive)" mt="xs">
            No students in this group.
          </Text>
        ) : (
          <ScrollArea offsetScrollbars>
            <Table
              striped
              highlightOnHover
              withColumnBorders
              verticalSpacing="xs"
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Student email</Table.Th>
                  <Table.Th>Consent</Table.Th>
                  <Table.Th>Group</Table.Th>
                  {sortedModules.map((m, idx) => (
                    <Table.Th key={m.moduleId}>
                      <Tooltip label={m.title} withinPortal>
                        <Text size="xs" fw={600}>
                          Module {idx + 1}
                        </Text>
                      </Tooltip>
                    </Table.Th>
                  ))}
                  <Table.Th>Last activity</Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {students.map((s) => {
                  const cb = consentBadge(s.consentDecision);
                  return (
                    <Table.Tr key={s.studentUserId}>
                      <Table.Td>
                        <Text size="sm">
                          {s.studentEmail || s.studentUserId}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          color={cb.color}
                          variant={cb.variant}
                          size="sm"
                        >
                          {cb.label}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {s.groupKey ? (
                          <Badge
                            color="terracotta"
                            variant="light"
                            size="sm"
                          >
                            {s.groupKey}
                          </Badge>
                        ) : (
                          <Text size="xs" c="var(--claude-stone)">
                            {PAGE_NA}
                          </Text>
                        )}
                      </Table.Td>
                      {sortedModules.map((m) => {
                        const status = s.moduleStatuses[m.moduleId];
                        const b = moduleStatusBadge(status);
                        return (
                          <Table.Td key={m.moduleId}>
                            {!s.progressLoaded ? (
                              <Text size="xs" c="var(--claude-stone)">
                                …
                              </Text>
                            ) : (
                              <Badge
                                color={b.color}
                                variant={b.variant}
                                size="sm"
                              >
                                {b.label}
                              </Badge>
                            )}
                          </Table.Td>
                        );
                      })}
                      <Table.Td>
                        {s.lastActivityAt ? (
                          <Text size="xs" c="var(--claude-near-black)">
                            {new Date(s.lastActivityAt).toLocaleString()}
                          </Text>
                        ) : (
                          <Text size="xs" c="var(--claude-stone)">
                            {PAGE_NA}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="terracotta"
                          onClick={() => onOpenStudent(s.studentUserId)}
                        >
                          View Detail
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  );
}
