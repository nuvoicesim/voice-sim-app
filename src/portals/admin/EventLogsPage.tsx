import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Group,
  Stack,
  Text,
  TextInput,
  Select,
  Button,
  Table,
  Badge,
  Loader,
  Code,
  ActionIcon,
  Collapse,
} from "@mantine/core";
import {
  IconRefresh,
  IconFilter,
  IconChevronDown,
  IconChevronRight,
  IconClipboardCopy,
} from "@tabler/icons-react";
import { eventApi } from "../../api/eventApi";
import { notify } from "../../utils/notify";
import { PageHeader, SectionCard, EmptyState } from "../../components/design";

interface EventRow {
  eventId: string;
  studentUserId: string;
  studentDateKey?: string;
  courseId?: string;
  moduleId?: string;
  moduleItemId?: string;
  eventType: string;
  payload?: Record<string, any>;
  createdAt: string;
}

const KNOWN_EVENT_TYPES = [
  "course_started",
  "module_item_unlocked",
  "module_item_opened",
  "module_item_progress",
  "survey_started",
  "survey_submitted",
  "voice_simulation_launched",
  "voice_simulation_completed",
  "best_attempt_updated",
  "feedback_submitted_by_teacher",
  "feedback_edited_by_teacher",
  "ai_detection_question_unlocked",
  "ai_detection_subquestion_submitted",
  "ai_detection_finalized",
  "group_assigned",
  "simucase_link_opened",
  "simucase_completion_confirmed",
  "green_check_clicked",
  "checkbox_marked",
  "feedback_viewed",
  "debrief_rating_submitted",
];

export default function EventLogsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [studentUserId, setStudentUserId] = useState("");
  const [eventType, setEventType] = useState<string | null>(null);
  const [since, setSince] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hasQueried, setHasQueried] = useState(false);

  const handleQuery = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (courseId.trim()) params.courseId = courseId.trim();
      if (studentUserId.trim()) params.studentUserId = studentUserId.trim();
      if (eventType) params.eventType = eventType;
      if (since.trim()) params.since = since.trim();
      const res: any = await eventApi.query(params);
      setEvents((res.events || []) as EventRow[]);
      setHasQueried(true);
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Query failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(
    () =>
      [...events].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      ),
    [events]
  );

  const handleClearFilters = () => {
    setCourseId("");
    setStudentUserId("");
    setEventType(null);
    setSince("");
  };

  const handleCopy = (txt: string) => {
    navigator.clipboard.writeText(txt).then(
      () => notify.success("Copied to clipboard"),
      () => notify.error("Failed to copy")
    );
  };

  return (
    <Stack gap="xl">
      <PageHeader
        title="Event Logs"
        subtitle="Filter and inspect event records produced by the platform"
        actions={
          <Button
            variant="light"
            color="terracotta"
            radius="lg"
            leftSection={<IconRefresh size={14} />}
            onClick={handleQuery}
            loading={loading}
          >
            Refresh
          </Button>
        }
      />

      <SectionCard
        title={
          <Group gap="xs">
            <IconFilter size={16} color="var(--claude-terracotta)" />
            <Text fw={500} c="var(--claude-near-black)">Filters</Text>
          </Group>
        }
      >
        <Group grow mb="xs">
          <TextInput
            label="Course ID"
            placeholder="course-uuid"
            value={courseId}
            onChange={(e) => setCourseId(e.currentTarget.value)}
          />
          <TextInput
            label="Student User ID"
            placeholder="cognito sub uuid"
            value={studentUserId}
            onChange={(e) => setStudentUserId(e.currentTarget.value)}
          />
          <Select
            label="Event Type"
            placeholder="any"
            data={KNOWN_EVENT_TYPES}
            value={eventType}
            onChange={setEventType}
            clearable
            searchable
          />
          <TextInput
            label="Since (ISO)"
            placeholder="2026-05-01T00:00:00Z"
            value={since}
            onChange={(e) => setSince(e.currentTarget.value)}
          />
        </Group>
        <Group justify="flex-end">
          <Button variant="subtle" color="parchment" onClick={handleClearFilters}>
            Clear
          </Button>
          <Button color="terracotta" onClick={handleQuery} loading={loading}>
            Apply
          </Button>
        </Group>
      </SectionCard>

      {loading ? (
        <Loader color="terracotta" />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<IconFilter size={28} />}
          title={hasQueried ? "No events match your filters" : "Loading..."}
        />
      ) : (
        <SectionCard p="0" flat>
          <Box style={{ overflowX: "auto" }}>
            <Table withTableBorder striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 30 }}></Table.Th>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>Event Type</Table.Th>
                  <Table.Th>Student</Table.Th>
                  <Table.Th>Course</Table.Th>
                  <Table.Th>Module Item</Table.Th>
                  <Table.Th>Payload</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sorted.map((ev) => {
                  const expanded = expandedId === ev.eventId;
                  const payloadStr = ev.payload ? JSON.stringify(ev.payload) : "";
                  return (
                    <>
                      <Table.Tr key={ev.eventId}>
                        <Table.Td>
                          <ActionIcon
                            variant="subtle"
                            color="terracotta"
                            onClick={() =>
                              setExpandedId(expanded ? null : ev.eventId)
                            }
                          >
                            {expanded ? (
                              <IconChevronDown size={14} />
                            ) : (
                              <IconChevronRight size={14} />
                            )}
                          </ActionIcon>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="var(--claude-olive)">
                            {new Date(ev.createdAt).toLocaleString()}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="sm" color={colorForEventType(ev.eventType)} variant="light">
                            {ev.eventType}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Code style={{ fontSize: 11 }}>
                            {short(ev.studentUserId)}
                          </Code>
                        </Table.Td>
                        <Table.Td>
                          {ev.courseId ? (
                            <Code style={{ fontSize: 11 }}>{short(ev.courseId)}</Code>
                          ) : (
                            <Text size="xs" c="var(--claude-stone)">—</Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          {ev.moduleItemId ? (
                            <Code style={{ fontSize: 11 }}>{short(ev.moduleItemId)}</Code>
                          ) : (
                            <Text size="xs" c="var(--claude-stone)">—</Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          {payloadStr ? (
                            <Text size="xs" lineClamp={1} maw={300} c="var(--claude-olive)">
                              {payloadStr}
                            </Text>
                          ) : (
                            <Text size="xs" c="var(--claude-stone)">—</Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                      {expanded && (
                        <Table.Tr key={ev.eventId + "-detail"}>
                          <Table.Td colSpan={7} style={{ background: "var(--claude-parchment)" }}>
                            <Collapse in={expanded}>
                              <Stack gap={4} p="sm">
                                <DetailRow
                                  label="Event ID"
                                  value={ev.eventId}
                                  onCopy={() => handleCopy(ev.eventId)}
                                />
                                <DetailRow
                                  label="Student User ID"
                                  value={ev.studentUserId}
                                  onCopy={() => handleCopy(ev.studentUserId)}
                                />
                                {ev.courseId && (
                                  <DetailRow
                                    label="Course ID"
                                    value={ev.courseId}
                                    onCopy={() => handleCopy(ev.courseId!)}
                                  />
                                )}
                                {ev.moduleId && (
                                  <DetailRow
                                    label="Module ID"
                                    value={ev.moduleId}
                                    onCopy={() => handleCopy(ev.moduleId!)}
                                  />
                                )}
                                {ev.moduleItemId && (
                                  <DetailRow
                                    label="ModuleItem ID"
                                    value={ev.moduleItemId}
                                    onCopy={() => handleCopy(ev.moduleItemId!)}
                                  />
                                )}
                                <Text size="sm" fw={500} mt="xs" c="var(--claude-near-black)">
                                  Payload
                                </Text>
                                <Code block style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                                  {ev.payload
                                    ? JSON.stringify(ev.payload, null, 2)
                                    : "(empty)"}
                                </Code>
                              </Stack>
                            </Collapse>
                          </Table.Td>
                        </Table.Tr>
                      )}
                    </>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Box>
          <Box p="xs" style={{ borderTop: "1px solid var(--claude-border-cream)" }}>
            <Text size="xs" c="var(--claude-stone)">
              {sorted.length} event{sorted.length === 1 ? "" : "s"}
            </Text>
          </Box>
        </SectionCard>
      )}
    </Stack>
  );
}

function DetailRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <Group gap="xs">
      <Text size="sm" fw={500} c="var(--claude-near-black)" style={{ minWidth: 130 }}>
        {label}:
      </Text>
      <Code style={{ flex: 1, fontSize: 12 }}>{value}</Code>
      <ActionIcon variant="subtle" color="terracotta" size="sm" onClick={onCopy} title="Copy">
        <IconClipboardCopy size={14} />
      </ActionIcon>
    </Group>
  );
}

function short(id: string | undefined): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

// All event types collapse to terracotta (active/important) or parchment (neutral)
function colorForEventType(type: string): string {
  if (
    type.startsWith("voice_simulation") ||
    type.startsWith("ai_detection") ||
    type.startsWith("feedback_") ||
    type === "course_started"
  ) {
    return "terracotta";
  }
  return "parchment";
}
