import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Box,
  Title,
  Card,
  Group,
  Stack,
  Text,
  Badge,
  Loader,
  ThemeIcon,
} from "@mantine/core";
import {
  IconCircleCheck,
  IconCircleDot,
  IconRocket,
  IconClipboardList,
  IconExternalLink,
  IconMessage,
  IconBook,
  IconBrain,
  IconArrowsShuffle,
  IconLock,
  IconFileCertificate,
} from "@tabler/icons-react";
import { fetchCourse, selectCurrentCourse } from "../../../slices/courseSlice";
import { fetchModules, selectModulesByCourse } from "../../../slices/moduleSlice";
import { fetchItems } from "../../../slices/moduleItemSlice";
import { fetchMyProgress } from "../../../slices/studentProgressSlice";
import {
  fetchMyGroups,
  selectMyGroupKeysForCourse,
} from "../../../slices/groupAssignmentSlice";
import { fetchMyConsent } from "../../../slices/consentSlice";
import type { AppDispatch, RootState } from "../../../store";
import { CourseContextProvider } from "../../../hooks/useCourseContext";
import { useEventLog } from "../../../hooks/useEventLog";

const TYPE_ICON: Record<string, any> = {
  assignment: IconRocket,
  survey: IconClipboardList,
  external_link: IconExternalLink,
  debrief: IconMessage,
  instruction: IconBook,
  ai_detection: IconBrain,
  randomizer: IconArrowsShuffle,
  reveal_trigger: IconCircleDot,
  consent: IconFileCertificate,
};

export default function StudentCoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  return (
    <CourseContextProvider value={{ courseId }}>
      <StudentCoursePageInner />
    </CourseContextProvider>
  );
}

function StudentCoursePageInner() {
  const { courseId } = useParams<{ courseId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const course = useSelector(selectCurrentCourse);
  const modules = useSelector(selectModulesByCourse(courseId || ""));
  const itemsByModule = useSelector((s: RootState) => (s as any).moduleItems.byModuleId);
  const progressByItem = useSelector((s: RootState) => (s as any).progress.byItemId);
  const myGroupKeys = useSelector(selectMyGroupKeysForCourse(courseId || ""));
  const consentByItemId = useSelector((s: RootState) => (s as any).consent.byItemId);
  const logEvent = useEventLog();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (courseId) {
      Promise.all([
        dispatch(fetchCourse(courseId)),
        dispatch(fetchModules(courseId)),
        dispatch(fetchMyGroups(courseId)),
      ]).then(() => setLoaded(true));
    }
  }, [dispatch, courseId]);

  useEffect(() => {
    for (const m of modules) {
      if (!itemsByModule[m.moduleId]) {
        dispatch(fetchItems(m.moduleId));
      }
    }
  }, [modules, itemsByModule, dispatch]);

  // Fetch progress for every loaded item so the course list can show
  // ✓ completed badges without requiring the student to drill in first.
  // Also fetch consent decisions for every consent-type item so survey
  // gating can resolve immediately on first paint.
  useEffect(() => {
    for (const m of modules) {
      const items = itemsByModule[m.moduleId] || [];
      for (const it of items) {
        if (!progressByItem[it.moduleItemId]) {
          dispatch(fetchMyProgress(it.moduleItemId));
        }
        if (it.itemType === "consent" && consentByItemId[it.moduleItemId] === undefined) {
          dispatch(fetchMyConsent(it.moduleItemId));
        }
      }
    }
  }, [modules, itemsByModule, progressByItem, consentByItemId, dispatch]);

  useEffect(() => {
    if (loaded) logEvent("course_started", {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (!course || !loaded) {
    return (
      <Box p="md">
        <Loader />
      </Box>
    );
  }

  return (
    <Box p="md" maw={900} mx="auto">
      <Title order={2} mb="xs">
        {course.title}
      </Title>
      {course.description && (
        <Text size="sm" c="dimmed" mb="lg">
          {course.description}
        </Text>
      )}

      {(() => {
        // Build flat lookup tables for gating evaluation.
        const itemsById: Record<string, any> = {};
        for (const list of Object.values(itemsByModule)) {
          for (const it of list as any[]) itemsById[it.moduleItemId] = it;
        }
        const moduleTitleById: Record<string, string> = {};
        for (const m of modules) moduleTitleById[m.moduleId] = m.title;
        return (
          <Stack gap="lg">
            {modules.map((m) => {
              const items = itemsByModule[m.moduleId] || [];
              const moduleGating = evaluateModuleGating(
                m,
                moduleTitleById,
                itemsByModule,
                progressByItem,
                myGroupKeys
              );
              return (
                <Box key={m.moduleId}>
                  <Group justify="space-between" align="center" mb="sm">
                    <Title order={4}>{m.title}</Title>
                    {moduleGating.locked && (
                      <Badge
                        color="gray"
                        variant="light"
                        leftSection={<IconLock size={12} />}
                      >
                        Module locked
                      </Badge>
                    )}
                  </Group>
                  {moduleGating.locked ? (
                    <Card
                      withBorder
                      style={{
                        opacity: 0.7,
                        background: "var(--mantine-color-gray-0)",
                      }}
                    >
                      <Group gap="sm">
                        <ThemeIcon variant="light" size="lg" color="gray">
                          <IconLock size={18} />
                        </ThemeIcon>
                        <Box>
                          <Text fw={500}>This module is locked</Text>
                          <Text size="sm" c="dimmed">
                            🔒 {moduleGating.reason}
                          </Text>
                        </Box>
                      </Group>
                    </Card>
                  ) : (
                    <Stack gap="xs">
                      {(items as any[])
                        .map((it: any) => ({
                          it,
                          gating: evaluateGating(
                            it,
                            itemsById,
                            progressByItem,
                            itemsByModule,
                            myGroupKeys,
                            consentByItemId
                          ),
                        }))
                        // Hide items belonging to other branches (counter-balanced
                        // design): this student should never see them.
                        .filter((entry: { it: any; gating: GatingState }) => !entry.gating.hidden)
                        .map((entry: { it: any; gating: GatingState }) => (
                          <ItemRow
                            key={entry.it.moduleItemId}
                            item={entry.it}
                            courseId={courseId!}
                            progress={progressByItem[entry.it.moduleItemId]}
                            gating={entry.gating}
                          />
                        ))}
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Stack>
        );
      })()}
    </Box>
  );
}

interface GatingState {
  locked: boolean;
  reason?: string;
  /** When true, the item belongs to a different counter-balanced branch and
   *  should not be rendered for this student at all. */
  hidden?: boolean;
}

/**
 * An item is "relevant to me" if its group_in gating (if any) admits one of
 * my group keys, or if it has no group_in gating. Items that aren't relevant
 * are treated as transparent for downstream `after_item` / `after_module`
 * evaluation — i.e. they don't block a student in a different counter-balanced
 * branch from progressing.
 *
 * IMPORTANT: transparency only kicks in when the student has a confirmed-different
 * group assignment. If the student has NO group keys yet (hasn't hit the
 * randomizer), the group-locked item is still pending and should continue to
 * block downstream gates — otherwise a downstream "after_item" clause would
 * spuriously unlock before the prerequisite item is actually reachable.
 */
function isItemRelevantToMe(item: any, myGroupKeys: string[]): boolean {
  const g = item?.gating;
  if (!g) return true;
  if (g.kind === "group_in") {
    // Student not yet randomized → item is pending, NOT transparent.
    if (myGroupKeys.length === 0) return true;
    const allowed: string[] = g.groups || [];
    return allowed.some((k) => myGroupKeys.includes(k));
  }
  return true;
}

/**
 * "Effectively done" means: completed by this student OR not relevant to them
 * (group-locked for their counter-balanced peers but not this student → never
 * blocks progress).
 */
function isItemEffectivelyDone(
  item: any,
  progress: any,
  myGroupKeys: string[]
): boolean {
  if (progress?.state === "completed") return true;
  if (!isItemRelevantToMe(item, myGroupKeys)) return true;
  return false;
}

/** Run only the gating clauses (after_item / after_module / group_in / all_of / etc.).
 *  No consent check. Used as the inner step so we can layer consent on top
 *  ONLY when gating has already passed. */
function evaluateGatingOnly(
  item: any,
  itemsById: Record<string, any>,
  progressByItem: Record<string, any>,
  itemsByModuleId: Record<string, any[]>,
  myGroupKeys: string[]
): GatingState {
  const gating = item.gating;
  if (!gating || gating.kind === "open") return { locked: false };

  // Compound: ALL clauses must be unlocked. Hidden propagates if any clause
  // hides the item.
  if (gating.kind === "all_of") {
    const clauses: any[] = gating.clauses || [];
    let hidden = false;
    const reasons: string[] = [];
    for (const clause of clauses) {
      const sub = evaluateGatingOnly(
        { gating: clause },
        itemsById,
        progressByItem,
        itemsByModuleId,
        myGroupKeys
      );
      if (sub.hidden) hidden = true;
      if (sub.locked && sub.reason) reasons.push(sub.reason);
    }
    if (hidden) {
      return { locked: true, hidden: true, reason: "Not part of your assigned branch" };
    }
    if (reasons.length > 0) {
      return { locked: true, reason: reasons.join(" • ") };
    }
    return { locked: false };
  }

  if (gating.kind === "after_item") {
    const prereqId = gating.moduleItemId;
    const prereqItem = itemsById[prereqId];
    const prereqProgress = progressByItem[prereqId];

    // Branch propagation: if the prereq belongs to a counter-balanced branch
    // that this student isn't in (i.e. it would be `hidden` for them), then
    // *this* item is also off-branch and should disappear from the list — not
    // just unlock transparently. Recursively evaluate the prereq's gating to
    // pick this up through arbitrarily long after_item chains.
    if (prereqItem) {
      const prereqGate = evaluateGatingOnly(
        prereqItem,
        itemsById,
        progressByItem,
        itemsByModuleId,
        myGroupKeys
      );
      if (prereqGate.hidden) {
        return {
          locked: true,
          hidden: true,
          reason: "Not part of your assigned branch",
        };
      }
    }

    if (
      prereqItem &&
      isItemEffectivelyDone(prereqItem, prereqProgress, myGroupKeys)
    )
      return { locked: false };
    return {
      locked: true,
      reason: `Complete "${prereqItem?.title || "(previous item)"}" first`,
    };
  }

  if (gating.kind === "after_module") {
    const prereqModuleId = gating.moduleId;
    const itemsInModule = itemsByModuleId[prereqModuleId] || [];
    if (itemsInModule.length === 0) return { locked: false };
    const allDone = itemsInModule.every((i: any) =>
      isItemEffectivelyDone(i, progressByItem[i.moduleItemId], myGroupKeys)
    );
    if (allDone) return { locked: false };
    const remaining = itemsInModule.filter(
      (i: any) =>
        !isItemEffectivelyDone(i, progressByItem[i.moduleItemId], myGroupKeys)
    );
    return {
      locked: true,
      reason: `Complete the previous module first (${remaining.length} item${remaining.length === 1 ? "" : "s"} remaining)`,
    };
  }

  if (gating.kind === "group_in") {
    const groups: string[] = gating.groups || [];
    if (groups.some((g) => myGroupKeys.includes(g))) {
      return { locked: false };
    }
    // If the student has NO group assignments yet (haven't hit the randomizer),
    // surface a helpful hint instead of hiding — they need to know to do the
    // randomizer item first.
    if (myGroupKeys.length === 0) {
      return {
        locked: true,
        reason: `Available after group randomization (assigns one of: ${groups.join(", ")})`,
      };
    }
    // Otherwise the student is in a different branch: hide entirely.
    return {
      locked: true,
      hidden: true,
      reason: `Not part of your assigned branch`,
    };
  }

  if (gating.kind === "all_reviewers_submitted") {
    return {
      locked: true,
      reason: "Awaiting all reviewers' feedback",
    };
  }

  return { locked: false };
}

/**
 * Top-level item gating entrypoint.
 *
 * Priority order for survey items linked to a consent:
 *  1. DECLINED + hideOnDecline → hidden (highest). Once a student opts out of
 *     research, they should never see this survey again, regardless of whether
 *     gating would or wouldn't have unlocked it. Their decision is permanent.
 *  2. Plain gating clauses (after_item / after_module / group_in / all_of) —
 *     if locked, gating message wins (more accurate hint than "consent needed"
 *     for a survey that wasn't even supposed to appear yet).
 *  3. Consent-required (no decision yet) — only surfaces after gating passes
 *     so the student isn't told to "respond to consent" for a survey they
 *     couldn't reach.
 */
function evaluateGating(
  item: any,
  itemsById: Record<string, any>,
  progressByItem: Record<string, any>,
  itemsByModuleId: Record<string, any[]>,
  myGroupKeys: string[],
  consentByItemId: Record<string, any> = {}
): GatingState {
  // 1. Hide-on-decline (highest priority for survey-with-consent).
  if (item.itemType === "survey" && item.payload?.consentModuleItemId) {
    const consentId = item.payload.consentModuleItemId as string;
    const decision = consentByItemId[consentId];
    if (
      decision?.decision === "declined" &&
      item.payload?.hideOnDecline !== false
    ) {
      return {
        locked: true,
        hidden: true,
        reason: "Skipped (you declined research participation)",
      };
    }
  }

  // 2. Gating clauses.
  const gateResult = evaluateGatingOnly(
    item,
    itemsById,
    progressByItem,
    itemsByModuleId,
    myGroupKeys
  );
  if (gateResult.locked) return gateResult;

  // 3. Gating passed and student isn't a declined hide. If they haven't
  //    decided yet on consent, prompt them.
  if (item.itemType === "survey" && item.payload?.consentModuleItemId) {
    const consentId = item.payload.consentModuleItemId as string;
    const consentItem = itemsById[consentId];
    const decision = consentByItemId[consentId];
    if (!decision) {
      return {
        locked: true,
        reason: `You must respond to "${consentItem?.payload?.title || consentItem?.title || "the consent form"}" before this survey is available`,
      };
    }
    // decision === "declined" but hideOnDecline is false → show as locked,
    // not hidden (faculty explicitly opted to keep it visible).
    if (decision.decision === "declined") {
      return {
        locked: true,
        reason: "You declined research participation; this survey is optional and not for research analysis.",
      };
    }
  }

  return { locked: false };
}

/**
 * Module-level gating: a module can declare a prerequisite module that must be
 * fully completed (every item "effectively done") before this module unlocks.
 * Currently supports `{ kind: 'after_module', moduleId }` and `{ kind: 'open' }`.
 */
function evaluateModuleGating(
  module: any,
  moduleTitleById: Record<string, string>,
  itemsByModuleId: Record<string, any[]>,
  progressByItem: Record<string, any>,
  myGroupKeys: string[]
): GatingState {
  const gating = module?.gating;
  if (!gating || gating.kind === "open") return { locked: false };

  if (gating.kind === "after_module") {
    const prereqModuleId = gating.moduleId;
    const itemsInModule = itemsByModuleId[prereqModuleId] || [];
    if (itemsInModule.length === 0) return { locked: false };
    const allDone = itemsInModule.every((i: any) =>
      isItemEffectivelyDone(i, progressByItem[i.moduleItemId], myGroupKeys)
    );
    if (allDone) return { locked: false };
    const remaining = itemsInModule.filter(
      (i: any) =>
        !isItemEffectivelyDone(i, progressByItem[i.moduleItemId], myGroupKeys)
    );
    const prereqTitle = moduleTitleById[prereqModuleId] || "the previous module";
    return {
      locked: true,
      reason: `Complete "${prereqTitle}" first (${remaining.length} item${remaining.length === 1 ? "" : "s"} remaining)`,
    };
  }

  return { locked: false };
}

function ItemRow({
  item,
  courseId,
  progress,
  gating,
}: {
  item: any;
  courseId: string;
  progress: any;
  gating: GatingState;
}) {
  const navigate = useNavigate();
  const Icon = TYPE_ICON[item.itemType] || IconBook;
  const completed = progress?.state === "completed";
  const locked = gating.locked && !completed; // already-completed items shouldn't re-lock

  const handleClick = () => {
    if (locked) return;
    navigate(`/student/courses/${courseId}/items/${item.moduleItemId}`, {
      state: { courseId, moduleId: item.moduleId, moduleItemId: item.moduleItemId },
    });
  };

  return (
    <Card
      withBorder
      onClick={handleClick}
      style={{
        cursor: locked ? "not-allowed" : "pointer",
        opacity: locked ? 0.6 : 1,
        background: locked ? "var(--mantine-color-gray-0)" : undefined,
      }}
    >
      <Group justify="space-between">
        <Group gap="sm">
          <ThemeIcon
            variant="light"
            size="lg"
            color={completed ? "green" : locked ? "gray" : "indigo"}
          >
            {completed ? (
              <IconCircleCheck size={18} />
            ) : locked ? (
              <IconLock size={18} />
            ) : (
              <Icon size={18} />
            )}
          </ThemeIcon>
          <Box>
            <Text fw={500}>{item.title}</Text>
            <Group gap={4}>
              <Badge size="xs" color="gray">
                {item.itemType}
              </Badge>
              {locked && (
                <Badge size="xs" color="gray" leftSection={<IconLock size={10} />}>
                  Locked
                </Badge>
              )}
              {!locked && progress && (
                <Badge size="xs" color={completed ? "green" : "yellow"}>
                  {progress.state}
                </Badge>
              )}
            </Group>
            {locked && gating.reason && (
              <Text size="xs" c="dimmed" mt={4}>
                🔒 {gating.reason}
              </Text>
            )}
          </Box>
        </Group>
        {completed ? (
          <IconCircleCheck size={20} color="var(--claude-terracotta)" />
        ) : locked ? (
          <IconLock size={20} color="var(--claude-stone)" />
        ) : (
          <IconCircleDot size={20} color="var(--claude-stone)" />
        )}
      </Group>
    </Card>
  );
}
