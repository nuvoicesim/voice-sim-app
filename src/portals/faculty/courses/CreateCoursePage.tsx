import { useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Group,
  Switch,
  TextInput,
  Textarea,
  Text,
  Box,
} from "@mantine/core";
import { createCourse } from "../../../slices/courseSlice";
import type { AppDispatch } from "../../../store";
import { PageHeader, SectionCard } from "../../../components/design";

export default function CreateCoursePage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const result: any = await dispatch(
        createCourse({ title: title.trim(), description, isDefault })
      ).unwrap();
      navigate(`/faculty/courses/${result.courseId}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box maw={720} mx="auto">
      <PageHeader title="Create New Course" subtitle="Set up a new course to host modules and assignments" />
      <SectionCard>
        <TextInput
          label="Course title"
          placeholder="e.g., SLP 501 — Aphasia Assessment"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          required
        />
        <Textarea
          label="Description (optional)"
          placeholder="What is this course about?"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          autosize
          minRows={3}
        />
        <Box>
          <Switch
            color="terracotta"
            label="Default course"
            description="When the course is published, every student will automatically see and access it without explicit enrollment."
            checked={isDefault}
            onChange={(e) => setIsDefault(e.currentTarget.checked)}
          />
          {isDefault && (
            <Text size="xs" c="var(--claude-stone)" mt={4}>
              Reminder: students still won't see the course until you set its status
              to "published" from the course editor.
            </Text>
          )}
        </Box>
        <Group justify="flex-end">
          <Button variant="subtle" color="parchment" onClick={() => navigate("/faculty/courses")}>
            Cancel
          </Button>
          <Button color="terracotta" onClick={handleSubmit} loading={submitting} disabled={!title.trim()}>
            Create Course
          </Button>
        </Group>
      </SectionCard>
    </Box>
  );
}
