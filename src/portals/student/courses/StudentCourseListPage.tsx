import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Badge, Card, Group, SimpleGrid, Stack, Text, Loader, ThemeIcon } from "@mantine/core";
import { IconBook } from "@tabler/icons-react";
import { fetchCourses, selectCourses, selectCoursesLoading } from "../../../slices/courseSlice";
import type { AppDispatch } from "../../../store";
import { PageHeader, EmptyState } from "../../../components/design";

export default function StudentCourseListPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const courses = useSelector(selectCourses);
  const loading = useSelector(selectCoursesLoading);

  useEffect(() => {
    dispatch(fetchCourses());
  }, [dispatch]);

  return (
    <Stack gap="xl">
      <PageHeader title="My Courses" subtitle="Browse the courses you're enrolled in" />

      {loading ? (
        <Loader color="terracotta" />
      ) : courses.length === 0 ? (
        <EmptyState
          icon={<IconBook size={28} />}
          title="No courses yet"
          description="You haven't been enrolled in any courses yet."
        />
      ) : (
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
              onClick={() => navigate(`/student/courses/${c.courseId}`)}
            >
              <Group gap="sm" mb="xs">
                <ThemeIcon size={28} radius="md" variant="light" color="terracotta">
                  <IconBook size={16} />
                </ThemeIcon>
                <Text fw={500} c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif', fontSize: '1.05rem' }}>
                  {c.title}
                </Text>
                {c.isDefault && (
                  <Badge size="xs" color="parchment" variant="light">
                    Default
                  </Badge>
                )}
              </Group>
              <Text size="sm" c="var(--claude-olive)" lineClamp={2} lh={1.6}>
                {c.description || ""}
              </Text>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
