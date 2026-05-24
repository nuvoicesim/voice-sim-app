import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Anchor,
  Box,
  Tabs,
  Title,
  Group,
  Badge,
  Button,
  Loader,
  Stack,
  TextInput,
  Textarea,
  Card,
  Text,
  ActionIcon,
  Table,
  Menu,
  Switch,
} from "@mantine/core";
import {
  IconBook,
  IconList,
  IconUsers,
  IconUserCog,
  IconClipboardList,
  IconTrash,
  IconPlus,
  IconExternalLink,
  IconSettings,
} from "@tabler/icons-react";
import {
  fetchCourse,
  selectCurrentCourse,
  updateCourse,
  updateCourseStatus,
  fetchInstructors,
  selectCurrentInstructors,
  addInstructor,
  removeInstructor,
  updateInstructorRole,
  fetchEnrollments,
  selectCurrentEnrollments,
  enrollStudents,
  unenrollStudent,
  clearCurrentCourse,
} from "../../../slices/courseSlice";
import {
  fetchModules,
  selectModulesByCourse,
  createModule,
  deleteModule,
  reorderModules,
} from "../../../slices/moduleSlice";
import { selectUserId, selectRole } from "../../../slices/authSlice";
import {
  fetchCourseConsents,
  selectLatestConsentByStudent,
} from "../../../slices/consentSlice";
import {
  fetchCourseGroups,
  selectCourseGroupForStudent,
} from "../../../slices/groupAssignmentSlice";
import {
  consentBadgeProps,
  groupBadgeProps,
} from "./studentProgressDisplay";
import type { AppDispatch } from "../../../store";
import { EmailTypeaheadInput } from "../../../components/courses/EmailTypeaheadInput";
import { SortableList } from "../../../components/courses/SortableList";
import { notify } from "../../../utils/notify";
import { cognitoUserApi } from "../../../api/cognitoUserApi";

export default function CourseEditorPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const course = useSelector(selectCurrentCourse);
  const instructors = useSelector(selectCurrentInstructors);
  const enrollments = useSelector(selectCurrentEnrollments);
  const modules = useSelector(selectModulesByCourse(courseId || ""));
  const myUserId = useSelector(selectUserId);
  const authRole = useSelector(selectRole);
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<string>(searchParams.get("tab") || "overview");

  useEffect(() => {
    if (courseId) {
      dispatch(fetchCourse(courseId));
      dispatch(fetchModules(courseId));
      dispatch(fetchInstructors(courseId));
      dispatch(fetchEnrollments(courseId));
    }
    return () => {
      dispatch(clearCurrentCourse());
    };
  }, [dispatch, courseId]);

  if (!course) {
    return (
      <Box p="md">
        <Loader />
      </Box>
    );
  }

  // Owner privileges: course owner (a faculty professor) AND coordinator
  // (a simulation_designer who set up the course) can both manage instructors,
  // students, and settings.
  const myRole = instructors.find((i) => i.facultyUserId === myUserId)?.role;
  const isOwner =
    myRole === "owner" ||
    myRole === "coordinator" ||
    course.ownerFacultyId === myUserId;

  return (
    <Box p="md">
      <Group justify="space-between" mb="md" align="flex-start">
        <Box>
          <Group gap={8}>
            <IconBook size={20} />
            <Title order={2}>{course.title}</Title>
            <Badge
              color={course.status === "published" ? "terracotta" : "parchment"}
              variant={course.status === "published" ? "filled" : "light"}
            >
              {course.status}
            </Badge>
            {course.isDefault && (
              <Badge color="parchment" variant="light">
                Default
              </Badge>
            )}
          </Group>
          {course.description && (
            <Text size="sm" c="dimmed" mt={4} maw={720}>
              {course.description}
            </Text>
          )}
        </Box>
        <Group>
          <Menu>
            <Menu.Target>
              <Button variant="light">Status: {course.status}</Button>
            </Menu.Target>
            <Menu.Dropdown>
              {(["draft", "published", "archived"] as const).map((s) => (
                <Menu.Item
                  key={s}
                  onClick={() =>
                    dispatch(updateCourseStatus({ courseId: course.courseId, status: s }))
                  }
                >
                  Set {s}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          <Button
            variant="filled"
            onClick={() => navigate(`/faculty/courses/${course.courseId}/reviews`)}
            leftSection={<IconClipboardList size={16} />}
          >
            Review Board
          </Button>
        </Group>
      </Group>

      <Tabs value={tab} onChange={(v) => setTab(v || "overview")}>
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconBook size={14} />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="modules" leftSection={<IconList size={14} />}>
            Modules ({modules.length})
          </Tabs.Tab>
          <Tabs.Tab value="students" leftSection={<IconUsers size={14} />}>
            Student Progress ({enrollments.filter((e) => e.status === "active").length})
          </Tabs.Tab>
          <Tabs.Tab value="instructors" leftSection={<IconUserCog size={14} />}>
            Instructors ({instructors.length})
          </Tabs.Tab>
          <Tabs.Tab value="settings" leftSection={<IconSettings size={14} />}>
            Settings
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <OverviewTab course={course} />
        </Tabs.Panel>
        <Tabs.Panel value="modules" pt="md">
          <ModulesTab courseId={course.courseId} modules={modules} />
        </Tabs.Panel>
        <Tabs.Panel value="students" pt="md">
          <StudentsTab
            courseId={course.courseId}
            enrollments={enrollments.filter((e) => e.status === "active")}
          />
        </Tabs.Panel>
        <Tabs.Panel value="instructors" pt="md">
          <InstructorsTab
            courseId={course.courseId}
            instructors={instructors}
            isOwner={isOwner}
            myUserId={myUserId || ""}
            authRole={authRole}
          />
        </Tabs.Panel>
        <Tabs.Panel value="settings" pt="md">
          <SettingsTab course={course} />
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}

function OverviewTab({ course }: { course: any }) {
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!course.ownerFacultyId) {
      setOwnerEmail(null);
      return;
    }
    cognitoUserApi
      .resolve([course.ownerFacultyId])
      .then((r: any) => setOwnerEmail(r?.users?.[0]?.email ?? null))
      .catch(() => setOwnerEmail(null));
  }, [course.ownerFacultyId]);

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text>
          <b>Course ID:</b> {course.courseId}
        </Text>
        <Text>
          <b>Owner:</b>{" "}
          {course.ownerFacultyId ? (
            ownerEmail || (
              <Text component="span" c="dimmed" size="sm">
                resolving…
              </Text>
            )
          ) : (
            <Text component="span" c="dimmed" size="sm">
              (no owner assigned yet — add an instructor)
            </Text>
          )}
        </Text>
        <Text>
          <b>Created:</b> {new Date(course.createdAt).toLocaleString()}
        </Text>
        <Text>
          <b>Updated:</b> {new Date(course.updatedAt).toLocaleString()}
        </Text>
      </Stack>
    </Card>
  );
}

function ModulesTab({
  courseId,
  modules,
}: {
  courseId: string;
  modules: any[];
}) {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newModuleTitle.trim()) {
      notify.warn("Type a module title first", "Title required");
      return;
    }
    setCreating(true);
    try {
      await dispatch(
        createModule({ courseId, data: { title: newModuleTitle.trim() } })
      ).unwrap();
      setNewModuleTitle("");
      notify.success("Module created");
    } catch (e: any) {
      console.error("Create module failed", e);
      notify.error(e?.message || "unknown error", "Failed to create module");
    } finally {
      setCreating(false);
    }
  };

  const handleReorder = async (next: any[]) => {
    try {
      await dispatch(
        reorderModules({
          courseId,
          orderedIds: next.map((n) => n.moduleId),
        })
      ).unwrap();
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Reorder failed");
      dispatch(fetchModules(courseId));
    }
  };

  return (
    <Stack gap="md">
      <Card withBorder>
        <Group>
          <TextInput
            placeholder="New module title..."
            value={newModuleTitle}
            onChange={(e) => setNewModuleTitle(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button onClick={handleCreate} loading={creating}>
            <IconPlus size={14} /> Add Module
          </Button>
        </Group>
      </Card>

      {modules.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">No modules yet. Add your first module above.</Text>
        </Card>
      ) : (
        <>
          <Text size="xs" c="dimmed">
            Drag the handle on the left of each row to reorder modules.
          </Text>
          <SortableList
            items={modules.map((m) => ({ ...m, id: m.moduleId }))}
            onReorder={handleReorder}
            renderItem={(m, dragHandle) => {
              const idx = modules.findIndex((x) => x.moduleId === m.moduleId);
              return (
                <Card withBorder mb="xs">
                  <Group justify="space-between">
                    <Group gap="sm" align="flex-start" style={{ flex: 1 }}>
                      {dragHandle}
                      <Box style={{ flex: 1 }}>
                        <Group gap={6}>
                          <Badge size="sm" color="parchment" variant="light">
                            #{idx + 1}
                          </Badge>
                          <Text fw={600}>{m.title}</Text>
                        </Group>
                        {m.description && (
                          <Text size="sm" c="dimmed" mt={4}>
                            {m.description}
                          </Text>
                        )}
                      </Box>
                    </Group>
                    <Group gap={4}>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() =>
                          navigate(`/faculty/courses/${courseId}/modules/${m.moduleId}`)
                        }
                        leftSection={<IconExternalLink size={12} />}
                      >
                        Open
                      </Button>
                      <ActionIcon
                        color="terracotta"
                        variant="subtle"
                        onClick={async () => {
                          if (!window.confirm("Delete this module and all its items?")) return;
                          try {
                            await dispatch(deleteModule(m.moduleId)).unwrap();
                            notify.success("Module deleted");
                          } catch (err: any) {
                            notify.error(err?.message || "unknown error", "Failed to delete module");
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
  );
}

function StudentsTab({ courseId, enrollments }: { courseId: string; enrollments: any[] }) {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    dispatch(fetchCourseConsents(courseId));
    dispatch(fetchCourseGroups(courseId));
  }, [dispatch, courseId]);

  const handleAdd = async () => {
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      const res: any = await dispatch(
        enrollStudents({ courseId, emails: [newEmail.trim()] })
      ).unwrap();
      const results: Array<{ email: string; status: string; reason?: string }> =
        res?.results || [];
      const enrolled = results.filter((r) => r.status === "enrolled");
      const notFound = results.filter((r) => r.status === "not_found");
      if (enrolled.length > 0) {
        notify.success(
          `Enrolled: ${enrolled.map((r) => r.email).join(", ")}`,
          "Student added"
        );
        setNewEmail("");
        dispatch(fetchEnrollments(courseId));
      } else if (notFound.length > 0) {
        notify.error(
          notFound
            .map((r) => `${r.email}: ${r.reason || "not found"}`)
            .join(" | "),
          "Enrollment failed"
        );
      } else {
        notify.warn(
          `Server responded but no student was enrolled. Raw: ${JSON.stringify(results)}`,
          "Enrollment unclear"
        );
      }
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Enrollment failed");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Stack gap="md">
      <Card withBorder>
        <Group>
          <Box style={{ flex: 1 }}>
            <EmailTypeaheadInput
              roleFilter="student"
              placeholder="student@example.com"
              value={newEmail}
              onChange={setNewEmail}
            />
          </Box>
          <Button onClick={handleAdd} loading={adding} disabled={!newEmail.trim()}>
            <IconPlus size={14} /> Enroll
          </Button>
        </Group>
      </Card>

      {enrollments.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">No students enrolled yet.</Text>
        </Card>
      ) : (
        <Table withTableBorder highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Student</Table.Th>
              <Table.Th>Consent</Table.Th>
              <Table.Th>Group</Table.Th>
              <Table.Th>Enrolled</Table.Th>
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {enrollments.map((e) => (
              <StudentProgressRow
                key={e.studentUserId}
                courseId={courseId}
                enrollment={e}
                onView={(sid) =>
                  navigate(`/faculty/courses/${courseId}/students/${sid}`)
                }
              />
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

interface EnrollmentRow {
  studentUserId: string;
  studentEmail?: string;
  enrolledAt: string;
  status: string;
}

function StudentProgressRow({
  courseId,
  enrollment,
  onView,
}: {
  courseId: string;
  enrollment: EnrollmentRow;
  onView: (studentUserId: string) => void;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const consent = useSelector(
    selectLatestConsentByStudent(courseId, enrollment.studentUserId)
  );
  const group = useSelector(
    selectCourseGroupForStudent(courseId, enrollment.studentUserId)
  );
  const cb = consentBadgeProps(consent);
  const gb = groupBadgeProps(group);
  const label = enrollment.studentEmail || enrollment.studentUserId;

  return (
    <Table.Tr>
      <Table.Td
        style={{ cursor: "pointer" }}
        onClick={() => onView(enrollment.studentUserId)}
      >
        <Anchor component="span">{label}</Anchor>
      </Table.Td>
      <Table.Td>
        <Badge color={cb.color} variant={cb.variant}>
          {cb.label}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Badge color={gb.color} variant={gb.variant}>
          {gb.label}
        </Badge>
      </Table.Td>
      <Table.Td>{new Date(enrollment.enrolledAt).toLocaleDateString()}</Table.Td>
      <Table.Td>
        <Group gap={4} justify="flex-end">
          <Button
            size="xs"
            variant="light"
            onClick={() => onView(enrollment.studentUserId)}
          >
            View detail
          </Button>
          <ActionIcon
            color="terracotta"
            variant="subtle"
            onClick={async () => {
              try {
                await dispatch(
                  unenrollStudent({
                    courseId,
                    studentUserId: enrollment.studentUserId,
                  })
                ).unwrap();
                notify.success("Student removed");
              } catch (err: any) {
                notify.error(
                  err?.message || "unknown error",
                  "Failed to remove student"
                );
              }
            }}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

function InstructorsTab({
  courseId,
  instructors,
  isOwner,
  myUserId,
  authRole,
}: {
  courseId: string;
  instructors: any[];
  isOwner: boolean;
  myUserId: string;
  authRole: string;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState(false);

  const myRow = instructors.find((i) => i.facultyUserId === myUserId);
  // Legacy fix-up: a simulation_designer who created a course before the
  // coordinator concept existed is now stuck with role=owner. Offer them a
  // one-click button to migrate to coordinator.
  const canSelfDemoteToCoordinator =
    authRole === "simulation_designer" && myRow?.role === "owner";

  const handleConvertSelf = async () => {
    if (!myUserId) return;
    if (
      !window.confirm(
        "Convert your role from owner to coordinator? You will no longer be a course professor — you must add a faculty member as the new owner before students can be served."
      )
    ) {
      return;
    }
    setConverting(true);
    try {
      await dispatch(
        updateInstructorRole({
          courseId,
          facultyUserId: myUserId,
          role: "coordinator",
        })
      ).unwrap();
      notify.success("You are now the course coordinator", "Role updated");
    } catch (e: any) {
      notify.error(e.message || "unknown error", "Conversion failed");
    } finally {
      setConverting(false);
    }
  };

  // Split rows: professors (owner + co_teacher) vs coordinator (simulation_designer).
  const professors = instructors.filter(
    (i) => i.role === "owner" || i.role === "co_teacher"
  );
  const coordinators = instructors.filter((i) => i.role === "coordinator");
  const ownerCount = instructors.filter((i) => i.role === "owner").length;
  const coTeacherCount = instructors.filter((i) => i.role === "co_teacher").length;
  const professorSlotsFilled = ownerCount + coTeacherCount;

  const nextRoleLabel =
    ownerCount === 0 ? "Course Owner" : "Co-Teacher";
  const remainingSlots = 2 - professorSlotsFilled;

  const handleAdd = async () => {
    if (!email.trim()) return;
    setAdding(true);
    try {
      const res: any = await dispatch(
        addInstructor({ courseId, email: email.trim() })
      ).unwrap();
      setEmail("");
      notify.success(`Added as ${res?.role || "instructor"}`, "Instructor added");
    } catch (e: any) {
      notify.error(e.message || "unknown error", "Failed to add instructor");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Stack gap="md">
      {/* Legacy fix: SD currently sitting as owner can convert themselves */}
      {canSelfDemoteToCoordinator && (
        <Card withBorder style={{ borderColor: "var(--claude-terracotta)" }}>
          <Text size="sm" fw={500} mb={4}>
            You are currently listed as the course owner
          </Text>
          <Text size="xs" c="dimmed" mb="sm">
            This course was created before the simulation_designer "coordinator" role
            existed. Click below to convert yourself to coordinator. Then you can add
            two faculty members as the actual professors.
          </Text>
          <Group justify="flex-end">
            <Button
              color="terracotta"
              variant="light"
              loading={converting}
              onClick={handleConvertSelf}
            >
              Convert me to Coordinator
            </Button>
          </Group>
        </Card>
      )}

      {/* Coordinator(s) — Simulation Designers managing the course */}
      {coordinators.length > 0 && (
        <Card withBorder>
          <Text size="sm" fw={600} mb="xs">
            Course Coordinator(s)
          </Text>
          <Text size="xs" c="dimmed" mb="sm">
            Coordinators (Simulation Designers) set up and manage the course but are not professors.
          </Text>
          <Stack gap="xs">
            {coordinators.map((i) => (
              <Group key={i.facultyUserId}>
                <Badge color="parchment" variant="light">coordinator</Badge>
                <Text>
                  {i.facultyUserId === myUserId ? `${i.facultyUserId} (you)` : i.facultyUserId}
                </Text>
              </Group>
            ))}
          </Stack>
        </Card>
      )}

      {/* Add-instructor form (owner-or-coordinator only) */}
      {isOwner && professorSlotsFilled < 2 && (
        <Card withBorder>
          <Text size="sm" mb={4} fw={500}>
            Add {nextRoleLabel}
          </Text>
          <Text size="xs" c="dimmed" mb="sm">
            {remainingSlots} of 2 professor slot{remainingSlots === 1 ? "" : "s"} remaining. Only
            faculty/admin accounts can be added as professors.
          </Text>
          <Group>
            <Box style={{ flex: 1 }}>
              <EmailTypeaheadInput
                roleFilter="faculty"
                placeholder="faculty@example.com"
                value={email}
                onChange={setEmail}
              />
            </Box>
            <Button onClick={handleAdd} loading={adding} disabled={!email.trim()}>
              Add {nextRoleLabel}
            </Button>
          </Group>
        </Card>
      )}

      {/* Professor list */}
      <Card withBorder>
        <Text size="sm" fw={600} mb="xs">
          Course Instructors ({professorSlotsFilled} / 2)
        </Text>
        {professors.length === 0 ? (
          <Text size="sm" c="dimmed">
            No professors assigned yet. {isOwner ? "Add the first one above." : ""}
          </Text>
        ) : (
          <Stack gap="xs">
            {professors.map((i) => (
              <Group key={i.facultyUserId} justify="space-between">
                <Group>
                  <Badge color={i.role === "owner" ? "terracotta" : "parchment"} variant={i.role === "owner" ? "filled" : "light"}>{i.role}</Badge>
                  <Text>
                    {i.facultyUserId === myUserId ? `${i.facultyUserId} (you)` : i.facultyUserId}
                  </Text>
                </Group>
                {isOwner && (
                  <ActionIcon
                    color="terracotta"
                    variant="subtle"
                    onClick={async () => {
                      try {
                        await dispatch(
                          removeInstructor({ courseId, facultyUserId: i.facultyUserId })
                        ).unwrap();
                        notify.success("Instructor removed");
                      } catch (e: any) {
                        notify.error(e?.message || "unknown error", "Failed to remove instructor");
                      }
                    }}
                    title={
                      i.role === "owner"
                        ? "Removing the owner promotes the co-teacher (if any)"
                        : "Remove co-teacher"
                    }
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                )}
              </Group>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

function SettingsTab({ course }: { course: any }) {
  const dispatch = useDispatch<AppDispatch>();
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description || "");
  const [isDefault, setIsDefault] = useState(!!course.isDefault);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await dispatch(
        updateCourse({
          courseId: course.courseId,
          data: { title, description, isDefault },
        })
      ).unwrap();
      notify.success("Settings saved");
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder>
      <Stack gap="md">
        <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          autosize
          minRows={3}
        />
        <Switch
          label="Default course"
          description="When the course is published, every student sees and accesses it automatically without explicit enrollment."
          checked={isDefault}
          onChange={(e) => setIsDefault(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button onClick={handleSave} loading={saving}>
            Save
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
