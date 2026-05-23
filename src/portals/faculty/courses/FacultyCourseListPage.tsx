import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Button, Card, Group, SimpleGrid, Stack, Text, Badge, Loader, ThemeIcon } from "@mantine/core";
import { IconPlus, IconBook } from "@tabler/icons-react";
import {
  fetchCourses,
  selectCourses,
  selectCoursesLoading,
} from "../../../slices/courseSlice";
import type { AppDispatch } from "../../../store";
import { PageHeader, EmptyState } from "../../../components/design";

const STATUS_COLOR: Record<string, string> = {
  published: 'terracotta',
  archived: 'parchment',
  draft: 'parchment',
};

export default function FacultyCourseListPage() {
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
        title="My Courses"
        subtitle="Manage courses you own or co-teach"
        actions={
          <Button
            color="terracotta"
            radius="lg"
            leftSection={<IconPlus size={16} />}
            onClick={() => navigate("/faculty/courses/new")}
          >
            New Course
          </Button>
        }
      />

      {loading && <Loader color="terracotta" />}
      {!loading && courses.length === 0 && (
        <EmptyState
          icon={<IconBook size={28} />}
          title="No courses yet"
          description={`Click "New Course" to create one — or use "Migrate Legacy" in admin to import existing assignments.`}
          ctaLabel="New Course"
          onCta={() => navigate("/faculty/courses/new")}
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
              background: 'var(--claude-ivory)',
              border: '1px solid var(--claude-border-cream)',
              boxShadow: 'var(--claude-shadow-whisper)',
              transition: 'box-shadow 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--claude-terracotta), var(--claude-shadow-whisper)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--claude-shadow-whisper)'; }}
            onClick={() => navigate(`/faculty/courses/${c.courseId}`)}
          >
            <Group gap="sm" mb="xs" wrap="nowrap">
              <ThemeIcon size={28} radius="md" variant="light" color="terracotta">
                <IconBook size={16} />
              </ThemeIcon>
              <Text fw={500} c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif', fontSize: '1.05rem', flex: 1, minWidth: 0 }} lineClamp={1}>
                {c.title}
              </Text>
              <Badge color={STATUS_COLOR[c.status] || 'parchment'} variant={c.status === 'published' ? 'filled' : 'light'} size="sm">
                {c.status}
              </Badge>
            </Group>
            <Text size="sm" c="var(--claude-olive)" lineClamp={2} lh={1.6}>
              {c.description || "No description"}
            </Text>
            <Stack gap={2} mt="md">
              <Text size="xs" c="var(--claude-stone)">
                Created {new Date(c.createdAt).toLocaleDateString()}
              </Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
