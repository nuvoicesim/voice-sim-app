import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconBook, IconChartBar } from "@tabler/icons-react";
import {
  fetchCourses,
  selectCourses,
  selectCoursesLoading,
} from "../../slices/courseSlice";
import type { AppDispatch } from "../../store";
import { PageHeader, EmptyState } from "../../components/design";

/**
 * Faculty Analysis landing page (V1, frontend-only).
 *
 * Replaces the previous global cohort funnel with a course-card grid that
 * lists only the courses the current faculty user owns or co-teaches. The
 * underlying data source is the same `GET /courses` endpoint the existing
 * /faculty/courses page calls — backend already filters to the caller's
 * CourseInstructor rows for faculty/simulation_designer roles.
 *
 * Clicking a card navigates to the course-specific Analysis dashboard at
 * /faculty/analysis/:courseId.
 *
 * No backend, schema, API, or Amplify change. Uses existing courseSlice
 * actions and existing design-system components only.
 */

const STATUS_COLOR: Record<string, string> = {
  published: "terracotta",
  archived: "parchment",
  draft: "parchment",
};

export default function AnalysisPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const courses = useSelector(selectCourses);
  const loading = useSelector(selectCoursesLoading);

  useEffect(() => {
    dispatch(fetchCourses());
  }, [dispatch]);

  return (
    <Stack gap="xl">
      <PageHeader
        title="Analysis"
        subtitle="Select a course to open a course-specific Analysis dashboard. Only courses available to your account are shown."
      />

      {loading && <Loader color="terracotta" />}

      {!loading && courses.length === 0 && (
        <EmptyState
          icon={<IconChartBar size={28} />}
          title="No courses available for analysis"
          description="Once you own or co-teach a course, it will appear here. Create or join a course from the Courses page."
        />
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {courses.map((c) => (
          <Card
            key={c.courseId}
            radius="lg"
            p="lg"
            style={{
              cursor: "pointer",
              background: "var(--claude-ivory)",
              border: "1px solid var(--claude-border-cream)",
              boxShadow: "var(--claude-shadow-whisper)",
              transition: "box-shadow 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow =
                "0 0 0 1px var(--claude-terracotta), var(--claude-shadow-whisper)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "var(--claude-shadow-whisper)";
            }}
            onClick={() => navigate(`/faculty/analysis/${c.courseId}`)}
          >
            <Group gap="sm" mb="xs" wrap="nowrap">
              <ThemeIcon size={28} radius="md" variant="light" color="terracotta">
                <IconBook size={16} />
              </ThemeIcon>
              <Text
                fw={500}
                c="var(--claude-near-black)"
                style={{
                  fontFamily: "Georgia, serif",
                  fontSize: "1.05rem",
                  flex: 1,
                  minWidth: 0,
                }}
                lineClamp={1}
              >
                {c.title}
              </Text>
              <Badge
                color={STATUS_COLOR[c.status] || "parchment"}
                variant={c.status === "published" ? "filled" : "light"}
                size="sm"
              >
                {c.status}
              </Badge>
            </Group>
            <Text size="sm" c="var(--claude-olive)" lineClamp={2} lh={1.6}>
              {c.description || "No description"}
            </Text>
            <Group justify="space-between" align="center" mt="md">
              <Text size="xs" c="var(--claude-stone)">
                Created {new Date(c.createdAt).toLocaleDateString()}
              </Text>
              <Text size="xs" c="var(--claude-terracotta)" fw={500}>
                Open Analysis →
              </Text>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
