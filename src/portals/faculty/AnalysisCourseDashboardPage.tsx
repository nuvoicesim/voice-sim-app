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
  IconCircleCheck,
  IconClock,
  IconMessageCircle,
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

/**
 * Faculty Analysis — course-specific dashboard (V1 frontend-only).
 *
 * Route: /faculty/analysis/:courseId
 *
 * Every count, list, and table on this page is scoped to the URL courseId.
 * Reuses existing frontend APIs and slices only:
 *   - courseApi.get + listEnrollments  → enrolled students for this course
 *   - consentApi.listForCourse         → consent decisions for this course
 *   - groupAssignmentApi.listForCourse → group assignments for this course
 *   - moduleApi list + moduleItemApi   → modules and items for this course
 *   - moduleItemApi.getProgress        → per-student per-item progress
 *   - cognitoUserApi.resolve           → email fallback for implicit students
 *
 * No schema change, no Unity/WebGL change. Cue events are now visible
 * per-session via the read-only GET /sessions/{sessionId}/evidence endpoint,
 * surfaced inside the existing student-detail attempt-row transcript view.
 *
 * Metrics still shown N/A at the course dashboard level:
 *   - Average total session time (would require per-student per-assignment
 *     listByAssignment loops; deferred to a later round for performance).
 *   - Transcript availability (requires GET /sessions/{id} per attempt).
 *
 * Course-level cue-event aggregation is also deferred — the per-session
 * cue display lives inside student detail (AssignmentItemDetail).
 */

const PAGE_NA = "N/A";

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
  /** Latest known activity timestamp (max of any progress timestamp). */
  lastActivityAt: string | null;
  /** True once all this student's per-item progress requests have settled. */
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
    if (state === "in_progress" || state === "completed") anyStartedOrCompleted = true;
    if (state !== "completed") allCompleted = false;
  }
  if (allCompleted) return "completed";
  if (anyStartedOrCompleted) return "in_progress";
  return "not_started";
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
    return { label: "Agreed", color: "terracotta", variant: "filled" };
  return { label: "Declined", color: "terracotta", variant: "outline" };
}

// ───────────── Page ─────────────

export default function AnalysisCourseDashboardPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  // currentCourse / currentEnrollments are Redux-global slices shared with
  // /faculty/courses/:courseId. If the user navigates from one course's
  // Analysis dashboard to another, those slices may briefly still carry the
  // previous course's data while fetchCourse / fetchEnrollments are in
  // flight. Gate on courseId match so this page never renders another
  // course's title, students, consent counts, or progress under the URL
  // we're currently on. selectModulesByCourse already filters by courseId
  // so it doesn't need the guard.
  const rawCourse = useSelector(selectCurrentCourse);
  const rawEnrollments = useSelector(selectCurrentEnrollments);
  const modules = useSelector(selectModulesByCourse(courseId || ""));
  const itemsByModule = useSelector(selectAllItemsByModuleId);

  const course = rawCourse && rawCourse.courseId === courseId ? rawCourse : null;
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
  const [progressLoadedStudents, setProgressLoadedStudents] = useState<
    Record<string, boolean>
  >({});

  const [coreLoading, setCoreLoading] = useState(true);
  const [coreError, setCoreError] = useState<string | null>(null);

  // ── Fetch course/enrollments/modules ──
  useEffect(() => {
    if (!courseId) return;
    // Clear per-course local state so a course-to-course navigation can't
    // leak the previous course's consent decisions, group assignments,
    // resolved emails, or per-student progress into this dashboard while
    // the new course's data is in flight.
    setConsentDecisions([]);
    setGroupAssignments([]);
    setResolvedEmails({});
    setProgressByStudent({});
    setProgressLoadedStudents({});
    fetchedPairSet.current = new Set();
    pendingPairCountByStudent.current = new Map();

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

  // ── Per-student per-item progress (N × M) ──
  //
  // Each module's items load via a separate fetchItems call, so allItems grows
  // incrementally as itemsByModule fills in. We must dedupe per
  // (studentUserId, moduleItemId) — not per studentUserId — or the first
  // module-load slice would mark students "fetched" and later modules' items
  // would never get a progress request, permanently breaking the
  // Module 2/Module 3 counts and the Students-by-Module-Progress lists.
  //
  // Approach: track a Set of "studentUserId|moduleItemId" keys. On every
  // (allItems, enrollments) update, enqueue requests for any pair we
  // haven't fetched yet. progressLoadedStudents flips true for a student only
  // after every currently-known item for that student has a settled response,
  // so the table's "…" placeholder and the dashboard-loading hint reflect
  // real coverage rather than first-module coverage.
  const fetchedPairSet = useRef<Set<string>>(new Set());
  const pendingPairCountByStudent = useRef<Map<string, number>>(new Map());
  const allItems = useMemo<ModuleItem[]>(() => {
    const out: ModuleItem[] = [];
    for (const m of modules) {
      const list = itemsByModule[m.moduleId] || [];
      for (const it of list) out.push(it);
    }
    return out;
  }, [modules, itemsByModule]);

  useEffect(() => {
    if (allItems.length === 0) return;
    const activeStudents = enrollments.filter((e) => e.status === "active");
    for (const e of activeStudents) {
      const studentId = e.studentUserId;
      const pendingItems = allItems.filter(
        (it) => !fetchedPairSet.current.has(`${studentId}|${it.moduleItemId}`)
      );
      if (pendingItems.length === 0) continue;

      // Mark as in-flight BEFORE awaiting so concurrent re-runs don't
      // duplicate. Also tentatively unmark "fully loaded" — a new batch
      // means coverage is incomplete again until it settles.
      for (const it of pendingItems) {
        fetchedPairSet.current.add(`${studentId}|${it.moduleItemId}`);
      }
      pendingPairCountByStudent.current.set(
        studentId,
        (pendingPairCountByStudent.current.get(studentId) ?? 0) +
          pendingItems.length
      );
      setProgressLoadedStudents((prev) =>
        prev[studentId] === false ? prev : { ...prev, [studentId]: false }
      );

      Promise.allSettled(
        pendingItems.map((it) =>
          moduleItemApi
            .getProgress(it.moduleItemId, studentId)
            .then((r: unknown) => ({
              itemId: it.moduleItemId,
              progress:
                ((r as { progress?: StudentItemProgress | null })?.progress ??
                  null) as StudentItemProgress | null,
            }))
        )
      ).then((settled) => {
        const next: Record<string, StudentItemProgress | null> = {};
        for (const s of settled) {
          if (s.status === "fulfilled") {
            next[s.value.itemId] = s.value.progress;
          }
          // Rejected entries are silently dropped; the row keeps that item as
          // "no progress row" — same fallback the existing student detail
          // page uses.
        }
        setProgressByStudent((prev) => ({
          ...prev,
          [studentId]: { ...(prev[studentId] || {}), ...next },
        }));
        const remaining =
          (pendingPairCountByStudent.current.get(studentId) ?? 0) -
          pendingItems.length;
        pendingPairCountByStudent.current.set(
          studentId,
          Math.max(0, remaining)
        );
        if (remaining <= 0) {
          setProgressLoadedStudents((prev) => ({
            ...prev,
            [studentId]: true,
          }));
        }
      });
    }
  }, [allItems, enrollments]);

  // ── Build the student matrix used everywhere on the page ──
  const matrix = useMemo<StudentMatrixRow[]>(() => {
    const activeEnrollments = enrollments.filter((e) => e.status === "active");
    const consentByStudent = new Map<string, ConsentDecisionRow>();
    for (const d of consentDecisions) {
      // Keep the most recent decision per student.
      const existing = consentByStudent.get(d.studentUserId);
      if (!existing || existing.updatedAt < d.updatedAt) {
        consentByStudent.set(d.studentUserId, d);
      }
    }
    const groupByStudent = new Map<string, string>();
    for (const g of groupAssignments) {
      // Prefer a course-scoped row when scopeKey matches the courseId.
      if (g.scopeKey === courseId) groupByStudent.set(g.studentUserId, g.groupKey);
      else if (!groupByStudent.has(g.studentUserId))
        groupByStudent.set(g.studentUserId, g.groupKey);
    }

    return activeEnrollments.map<StudentMatrixRow>((e) => {
      const studentEmail =
        e.studentEmail ?? resolvedEmails[e.studentUserId] ?? null;
      const progressMap = progressByStudent[e.studentUserId] || {};
      const moduleStatuses: Record<string, ModuleStatus> = {};
      let lastActivityAt: string | null = null;
      for (const m of modules) {
        const items = itemsByModule[m.moduleId] || [];
        moduleStatuses[m.moduleId] = classifyModuleStatus(items, progressMap);
        for (const it of items) {
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
        progressLoaded: !!progressLoadedStudents[e.studentUserId],
      };
    });
  }, [
    enrollments,
    consentDecisions,
    groupAssignments,
    resolvedEmails,
    progressByStudent,
    progressLoadedStudents,
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
        subtitle={
          <Group gap="xs">
            <Text component="span" c="var(--claude-near-black)" fw={500}>
              {course.title}
            </Text>
            <Badge
              color={course.status === "published" ? "terracotta" : "parchment"}
              variant={course.status === "published" ? "filled" : "light"}
              size="sm"
            >
              {course.status}
            </Badge>
          </Group>
        }
        actions={
          <Button
            variant="light"
            color="terracotta"
            radius="lg"
            onClick={() => navigate(`/faculty/courses/${courseId}`)}
          >
            Open Course
          </Button>
        }
      />

      {/* Progress-loading hint while N×M progress calls are still settling */}
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

      {/* ── Summary Cards ── */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <StatCard
          label="Enrolled Students"
          value={activeCount}
          icon={<IconUsers size={22} />}
          hint={course.title}
        />
        <StatCard
          label="Consent Agreed"
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
          label="No Decision Yet"
          value={pendingCount}
          icon={<IconUserExclamation size={22} />}
          hint="Pending consent"
        />
      </SimpleGrid>

      {/* ── Raw Module Progress (counts per module) ──
          Wording is intentionally "Raw" rather than "Module completion" or
          "Official Module Progress" — this card aggregates per-item
          StudentItemProgress.state across every item in each module, with
          no awareness of randomizer-skipped items, gated branches, group-
          assignment-specific items, or hidden items. For a randomized or
          branch-locked course, a module that the student is not expected
          to visit will still register as "Not started" here. Faculty
          tooltip below makes this explicit. */}
      <SectionCard
        title={
          <Group gap="xs">
            <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
              <IconChartBar size={14} />
            </ThemeIcon>
            <Tooltip
              label="Based on available item progress records. May not reflect hidden, randomized, or group-specific item relevance. Not equivalent to official course-completion logic."
              withinPortal
              multiline
              w={320}
            >
              <Text fw={500} size="md" c="var(--claude-near-black)">
                Raw Module Progress (Item Progress Summary)
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

      {/* ── Future-metric placeholder cards ── */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        <StatCard
          label="Avg Total Session Time"
          value={PAGE_NA}
          icon={<IconClock size={22} />}
          hint="Future Metric (requires per-assignment session aggregation; deferred for V1.1 performance)"
        />
        <StatCard
          label="Transcript Availability"
          value={PAGE_NA}
          icon={<IconMessageCircle size={22} />}
          hint="Future Metric (requires per-session detail load)"
        />
        <StatCard
          label="Cue Events Availability"
          value="In session detail"
          icon={<IconCircleCheck size={22} />}
          hint="Cue Support Access events (system events for cue button clicks) are now visible inside the per-student session transcript. Course-level aggregation is deferred to a later round."
        />
      </SimpleGrid>

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

      <Text size="xs" c="var(--claude-stone)" ta="center" mt="md">
        Consent grouping is for faculty navigation only. All students are
        visible regardless of consent decision; consent affects research-data
        usage only. Cue Support Access (cue button clicks) is now visible
        inside each student's session transcript — open View Detail to see
        per-session cue events. Course-level cue aggregation is not yet
        included in this dashboard.
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
  // Build classification buckets. A student can appear in multiple buckets
  // (e.g., "Module 1 Completed" and "Module 2 Started"). "Not Started" is
  // students with zero in_progress/completed items across all modules.
  const notStarted = matrix.filter((r) =>
    sortedModules.every((m) => r.moduleStatuses[m.moduleId] === "not_started")
  );

  const tabs: Array<{
    key: string;
    label: string;
    students: StudentMatrixRow[];
  }> = [
    { key: "not_started", label: "Not Started", students: notStarted },
  ];
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
            label="Based on available item progress records. May not reflect hidden, randomized, or group-specific item relevance. Not equivalent to official course-completion logic."
            withinPortal
            multiline
            w={320}
          >
            <Text fw={500} size="md" c="var(--claude-near-black)">
              Students by Module Progress (raw item progress)
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
                <Badge
                  size="sm"
                  ml={6}
                  color="parchment"
                  variant="light"
                >
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

// ───────────── Sub-component: Students grouped by Consent Status ─────────────

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
  const agreed = matrix.filter(
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
        defaultValue={["agreed"]}
        variant="separated"
        radius="md"
      >
        <ConsentGroupAccordion
          value="agreed"
          label="Consent Agreed Students"
          students={agreed}
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
            <Table striped highlightOnHover withColumnBorders verticalSpacing="xs">
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
                  <Table.Th>Total session time</Table.Th>
                  <Table.Th>Transcript</Table.Th>
                  <Table.Th>Cue events</Table.Th>
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
                        <Badge color={cb.color} variant={cb.variant} size="sm">
                          {cb.label}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {s.groupKey ? (
                          <Badge color="terracotta" variant="light" size="sm">
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
                        <Tooltip
                          label="Future Metric — per-session aggregation deferred to V1.1"
                          withinPortal
                        >
                          <Text size="xs" c="var(--claude-stone)">
                            {PAGE_NA}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip
                          label="Future Metric — requires per-session detail load"
                          withinPortal
                        >
                          <Text size="xs" c="var(--claude-stone)">
                            {PAGE_NA}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip
                          label="Cue Support Access (cue button clicked or viewed). Open View Detail to see per-session cue events; course-level aggregation is deferred to a later round."
                          withinPortal
                        >
                          <Text size="xs" c="var(--claude-olive)">
                            See detail
                          </Text>
                        </Tooltip>
                      </Table.Td>
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
