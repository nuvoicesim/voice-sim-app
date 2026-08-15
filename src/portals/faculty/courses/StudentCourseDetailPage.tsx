import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Box,
  Title,
  Anchor,
  Button,
  Group,
  Text,
  Accordion,
  Loader,
  Stack,
} from "@mantine/core";
import { IconArrowLeft, IconDownload, IconFileSpreadsheet } from "@tabler/icons-react";
import { reviewPackageApi } from "../../../api/reviewPackageApi";
import { notify } from "../../../utils/notify";
import type { AppDispatch } from "../../../store";
import {
  fetchCourse,
  selectCurrentCourse,
  fetchEnrollments,
  selectCurrentEnrollments,
} from "../../../slices/courseSlice";
import {
  fetchModules,
  selectModulesByCourse,
} from "../../../slices/moduleSlice";
import {
  fetchItems,
  selectAllItemsByModuleId,
  type ModuleItem,
} from "../../../slices/moduleItemSlice";
import { consentApi, type ConsentDecisionRow } from "../../../api/consentApi";
import {
  groupAssignmentApi,
  type CourseGroupAssignmentRow,
} from "../../../api/groupAssignmentApi";
import { moduleItemApi } from "../../../api/moduleItemApi";
import { cognitoUserApi } from "../../../api/cognitoUserApi";
import type { StudentItemProgress } from "../../../slices/studentProgressSlice";
import { StudentSummaryCard } from "./components/StudentSummaryCard";
import { StudentModuleItemRow } from "./components/StudentModuleItemRow";

export default function StudentCourseDetailPage() {
  const { courseId, studentUserId } = useParams<{
    courseId: string;
    studentUserId: string;
  }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const course = useSelector(selectCurrentCourse);
  const enrollments = useSelector(selectCurrentEnrollments);
  const modules = useSelector(selectModulesByCourse(courseId || ""));
  const itemsByModule = useSelector(selectAllItemsByModuleId);

  const [consentDecisions, setConsentDecisions] = useState<ConsentDecisionRow[]>([]);
  const [groupAssignments, setGroupAssignments] = useState<CourseGroupAssignmentRow[]>([]);
  const [progressByItem, setProgressByItem] = useState<Record<string, StudentItemProgress | null>>({});
  const fetchedItemIdsRef = useRef<Set<string>>(new Set());
  const [resolvedEmail, setResolvedEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingCueCsv, setExportingCueCsv] = useState(false);
  const [cueCsvError, setCueCsvError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    dispatch(fetchCourse(courseId));
    dispatch(fetchEnrollments(courseId));
    dispatch(fetchModules(courseId));
  }, [dispatch, courseId]);

  useEffect(() => {
    for (const m of modules) {
      if (!itemsByModule[m.moduleId]) {
        dispatch(fetchItems(m.moduleId));
      }
    }
  }, [modules, itemsByModule, dispatch]);

  useEffect(() => {
    if (!courseId || !studentUserId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [consentRes, groupRes] = await Promise.all([
          consentApi.listForCourse(courseId),
          groupAssignmentApi.listForCourse(courseId),
        ]);
        if (cancelled) return;
        setConsentDecisions(
          (consentRes.decisions || []).filter(
            (d: ConsentDecisionRow) => d.studentUserId === studentUserId
          )
        );
        setGroupAssignments(
          (groupRes.assignments || []).filter(
            (g: CourseGroupAssignmentRow) =>
              g.studentUserId === studentUserId
          )
        );
        setLoading(false);
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load student data";
          setError(msg);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, studentUserId]);

  useEffect(() => {
    if (!studentUserId) return;
    const missing: string[] = [];
    for (const m of modules) {
      for (const it of itemsByModule[m.moduleId] || []) {
        if (!fetchedItemIdsRef.current.has(it.moduleItemId)) {
          missing.push(it.moduleItemId);
          fetchedItemIdsRef.current.add(it.moduleItemId);
        }
      }
    }
    if (missing.length === 0) return;

    // Fire each fetch independently so a re-run of this effect (triggered
    // when itemsByModule grows as modules' items load incrementally) doesn't
    // cancel in-flight fetches from a previous run. A previous design used a
    // single Promise.all gated by an effect-scoped `cancelled` flag, which
    // dropped progress for every module that loaded before the last one.
    for (const id of missing) {
      moduleItemApi
        .getProgress(id, studentUserId)
        .then((r: unknown) => {
          const progress =
            (r as { progress?: StudentItemProgress | null })?.progress || null;
          setProgressByItem((prev) => ({ ...prev, [id]: progress }));
        })
        .catch(() => {
          setProgressByItem((prev) => ({ ...prev, [id]: null }));
        });
    }
  }, [studentUserId, modules, itemsByModule]);

  const enrollment = enrollments.find(
    (e) => e.studentUserId === studentUserId
  );

  // Best-effort email resolution when the enrollment row carries no email
  // (implicit students on default courses).
  useEffect(() => {
    if (!studentUserId) return;
    if (enrollment?.studentEmail) return;
    if (resolvedEmail) return;
    let cancelled = false;
    cognitoUserApi
      .resolve([studentUserId])
      .then((res) => {
        if (cancelled) return;
        const email = res.users?.[0]?.email ?? null;
        if (email) setResolvedEmail(email);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [studentUserId, enrollment?.studentEmail, resolvedEmail]);

  // Export the current student's grading-oriented Review Package as an HTML
  // file. Required behavior: download the .html; also opens a preview tab.
  const handleExportReviewPackage = async () => {
    if (!courseId || !studentUserId) return;
    setExporting(true);
    setExportError(null);
    try {
      const { filename, html } = await reviewPackageApi.getForStudent(
        courseId,
        studentUserId
      );
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "VOICE-Review-Package.html";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Optional preview tab; revoke after a delay so both the download and the
      // preview can read the blob URL.
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: unknown) {
      setExportError(
        e instanceof Error ? e.message : "Failed to export review package"
      );
    } finally {
      setExporting(false);
    }
  };

  // Internal research export: raw cue-click events for THIS student as a CSV
  // download. Independent of the Review Package export's state.
  const handleExportCueEventsCsv = async () => {
    if (!courseId || !studentUserId) return;
    setExportingCueCsv(true);
    setCueCsvError(null);
    try {
      const { filename, csv } = await reviewPackageApi.getCueEventsCsvForStudent(
        courseId,
        studentUserId
      );
      // UTF-8 BOM so Excel opens the file correctly (same as the survey CSV).
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "VOICE-Cue-Events.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify.success("Cue events CSV downloaded");
    } catch (e: unknown) {
      setCueCsvError(
        e instanceof Error ? e.message : "Failed to export cue events CSV"
      );
    } finally {
      setExportingCueCsv(false);
    }
  };

  if (!courseId || !studentUserId) {
    return <Navigate to="/faculty/courses" replace />;
  }

  if (!course || !enrollment) {
    return (
      <Box p="md">
        <Loader />
      </Box>
    );
  }
  if (error) {
    return (
      <Box p="md">
        <Text c="terracotta">{error}</Text>
      </Box>
    );
  }

  return (
    <Box p="md">
      <Anchor
        onClick={() => navigate(`/faculty/courses/${courseId}?tab=students`)}
        mb="xs"
      >
        <Group gap={4}>
          <IconArrowLeft size={14} />
          <Text size="sm">Back to course</Text>
        </Group>
      </Anchor>
      <Group justify="space-between" align="flex-start" mb="md" wrap="nowrap">
        <Title order={2}>
          {enrollment.studentEmail || resolvedEmail || studentUserId} — {course.title}
        </Title>
        <Stack gap={4} align="flex-end">
          <Button
            leftSection={<IconDownload size={16} />}
            variant="light"
            color="terracotta"
            radius="md"
            onClick={handleExportReviewPackage}
            loading={exporting}
          >
            Export Review Package
          </Button>
          {exportError && (
            <Text size="xs" c="red" ta="right" maw={280}>
              {exportError}
            </Text>
          )}
          <Button
            leftSection={<IconFileSpreadsheet size={16} />}
            variant="light"
            color="terracotta"
            radius="md"
            onClick={handleExportCueEventsCsv}
            loading={exportingCueCsv}
          >
            Export Cue Events CSV
          </Button>
          {cueCsvError && (
            <Text size="xs" c="red" ta="right" maw={280}>
              {cueCsvError}
            </Text>
          )}
        </Stack>
      </Group>

      <Stack gap="md">
        {loading ? (
          <Loader size="sm" />
        ) : (
          <StudentSummaryCard
            enrollment={enrollment}
            consentDecisions={consentDecisions}
            groupAssignments={groupAssignments}
          />
        )}

        {modules.length === 0 ? (
          <Text c="dimmed">This course has no modules yet.</Text>
        ) : (
          <Accordion
            multiple
            defaultValue={modules.map((m) => m.moduleId)}
            variant="separated"
          >
            {modules.map((m) => {
              const items = itemsByModule[m.moduleId] || [];
              return (
                <Accordion.Item key={m.moduleId} value={m.moduleId}>
                  <Accordion.Control>
                    <Group gap="xs">
                      <Text fw={600}>{m.title}</Text>
                      <Text size="sm" c="dimmed">
                        {items.length} item{items.length === 1 ? "" : "s"}
                      </Text>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    {items.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        No items in this module.
                      </Text>
                    ) : (
                      [...(items as ModuleItem[])]
                        .sort((a, b) => a.position - b.position)
                        .map((it) => (
                          <StudentModuleItemRow
                            key={it.moduleItemId}
                            item={it}
                            studentUserId={studentUserId}
                            courseId={courseId}
                            progress={progressByItem[it.moduleItemId]}
                            consentDecisions={consentDecisions}
                          />
                        ))
                    )}
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        )}
      </Stack>
    </Box>
  );
}
