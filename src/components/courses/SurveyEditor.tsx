import {
  Box,
  Button,
  Card,
  Group,
  Stack,
  Text,
  TextInput,
  Textarea,
  ActionIcon,
  Select,
  NumberInput,
  Menu,
} from "@mantine/core";
import {
  IconTrash,
  IconPlus,
  IconChartBar,
  IconCircleCheck,
  IconChecklist,
  IconAlphabetLatin,
} from "@tabler/icons-react";
import { SortableList } from "./SortableList";
import type { SurveyQuestion } from "../../slices/surveyTemplateSlice";

interface SurveyEditorProps {
  title: string;
  description: string;
  questions: SurveyQuestion[];
  onChange: (next: { title: string; description: string; questions: SurveyQuestion[] }) => void;
}

function genId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultQuestion(type: SurveyQuestion["type"]): SurveyQuestion {
  const id = genId();
  if (type === "likert") {
    return {
      id,
      type: "likert",
      prompt: "",
      required: true,
      config: { scale: 7, leftAnchor: "Strongly disagree", rightAnchor: "Strongly agree" },
    };
  }
  if (type === "choice_single" || type === "choice_multi") {
    return {
      id,
      type,
      prompt: "",
      required: true,
      config: {
        options: [
          { value: "opt1", label: "Option 1" },
          { value: "opt2", label: "Option 2" },
        ],
      },
    };
  }
  return {
    id,
    type: "free_text",
    prompt: "",
    required: false,
    config: { minWords: 0, maxWords: undefined },
  };
}

export function SurveyEditor({ title, description, questions, onChange }: SurveyEditorProps) {
  const handleQuestionUpdate = (idx: number, updater: (q: SurveyQuestion) => SurveyQuestion) => {
    const next = questions.map((q, i) => (i === idx ? updater(q) : q));
    onChange({ title, description, questions: next });
  };

  const handleDelete = (idx: number) => {
    onChange({
      title,
      description,
      questions: questions.filter((_, i) => i !== idx),
    });
  };

  const handleAdd = (type: SurveyQuestion["type"]) => {
    onChange({
      title,
      description,
      questions: [...questions, defaultQuestion(type)],
    });
  };

  const handleReorder = (next: SurveyQuestion[]) => {
    onChange({ title, description, questions: next });
  };

  return (
    <Stack gap="md">
      <TextInput
        label="Survey title"
        value={title}
        onChange={(e) => onChange({ title: e.currentTarget.value, description, questions })}
        required
      />
      <Textarea
        label="Description (optional)"
        value={description}
        onChange={(e) => onChange({ title, description: e.currentTarget.value, questions })}
        autosize
        minRows={2}
      />

      <Box>
        <Group justify="space-between" mb="xs">
          <Text fw={600}>Questions ({questions.length})</Text>
          <Menu shadow="md">
            <Menu.Target>
              <Button leftSection={<IconPlus size={14} />} variant="light" size="sm">
                Add question
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconChartBar size={16} />} onClick={() => handleAdd("likert")}>
                Likert (1-7 scale)
              </Menu.Item>
              <Menu.Item
                leftSection={<IconCircleCheck size={16} />}
                onClick={() => handleAdd("choice_single")}
              >
                Multiple choice (single)
              </Menu.Item>
              <Menu.Item
                leftSection={<IconChecklist size={16} />}
                onClick={() => handleAdd("choice_multi")}
              >
                Multiple choice (multi)
              </Menu.Item>
              <Menu.Item
                leftSection={<IconAlphabetLatin size={16} />}
                onClick={() => handleAdd("free_text")}
              >
                Free text
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>

        <SortableList
          items={questions.map((q) => ({ ...q, id: q.id }))}
          onReorder={handleReorder}
          renderItem={(q, handle) => {
            const idx = questions.findIndex((qq) => qq.id === q.id);
            return (
              <Card withBorder mb="xs" key={q.id}>
                <Group align="flex-start" gap="sm">
                  {handle}
                  <Box style={{ flex: 1 }}>
                    <Group gap={6} mb={4}>
                      <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                        {q.type}
                      </Text>
                    </Group>
                    <Textarea
                      value={q.prompt}
                      onChange={(e) =>
                        handleQuestionUpdate(idx, (qq) => ({ ...qq, prompt: e.currentTarget.value }))
                      }
                      placeholder="Question prompt..."
                      autosize
                      minRows={1}
                      mb="xs"
                    />
                    {q.type === "likert" && (
                      <Group grow>
                        <NumberInput
                          label="Scale max"
                          value={q.config.scale}
                          onChange={(v) =>
                            handleQuestionUpdate(idx, (qq) =>
                              qq.type === "likert"
                                ? { ...qq, config: { ...qq.config, scale: Number(v) || 7 } }
                                : qq
                            )
                          }
                          min={2}
                          max={11}
                        />
                        <TextInput
                          label="Left label"
                          value={q.config.leftAnchor}
                          onChange={(e) =>
                            handleQuestionUpdate(idx, (qq) =>
                              qq.type === "likert"
                                ? { ...qq, config: { ...qq.config, leftAnchor: e.currentTarget.value } }
                                : qq
                            )
                          }
                        />
                        <TextInput
                          label="Right label"
                          value={q.config.rightAnchor}
                          onChange={(e) =>
                            handleQuestionUpdate(idx, (qq) =>
                              qq.type === "likert"
                                ? { ...qq, config: { ...qq.config, rightAnchor: e.currentTarget.value } }
                                : qq
                            )
                          }
                        />
                      </Group>
                    )}
                    {(q.type === "choice_single" || q.type === "choice_multi") && (
                      <Stack gap={4}>
                        {q.config.options.map((opt, oi) => (
                          <Group key={oi} gap="xs">
                            <TextInput
                              value={opt.label}
                              onChange={(e) =>
                                handleQuestionUpdate(idx, (qq) => {
                                  if (qq.type !== "choice_single" && qq.type !== "choice_multi") return qq;
                                  const opts = qq.config.options.slice();
                                  opts[oi] = { ...opts[oi], label: e.currentTarget.value };
                                  return { ...qq, config: { ...qq.config, options: opts } };
                                })
                              }
                              style={{ flex: 1 }}
                              placeholder={`Option ${oi + 1}`}
                            />
                            <ActionIcon
                              color="terracotta"
                              variant="subtle"
                              onClick={() =>
                                handleQuestionUpdate(idx, (qq) => {
                                  if (qq.type !== "choice_single" && qq.type !== "choice_multi") return qq;
                                  return {
                                    ...qq,
                                    config: {
                                      ...qq.config,
                                      options: qq.config.options.filter((_, j) => j !== oi),
                                    },
                                  };
                                })
                              }
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>
                        ))}
                        <Button
                          variant="subtle"
                          size="xs"
                          onClick={() =>
                            handleQuestionUpdate(idx, (qq) => {
                              if (qq.type !== "choice_single" && qq.type !== "choice_multi") return qq;
                              const next = [
                                ...qq.config.options,
                                { value: `opt${qq.config.options.length + 1}`, label: "" },
                              ];
                              return { ...qq, config: { ...qq.config, options: next } };
                            })
                          }
                          leftSection={<IconPlus size={12} />}
                        >
                          Add option
                        </Button>
                      </Stack>
                    )}
                    {q.type === "free_text" && (
                      <Group grow>
                        <NumberInput
                          label="Min words (optional)"
                          value={q.config.minWords ?? 0}
                          onChange={(v) =>
                            handleQuestionUpdate(idx, (qq) =>
                              qq.type === "free_text"
                                ? { ...qq, config: { ...qq.config, minWords: Number(v) || 0 } }
                                : qq
                            )
                          }
                          min={0}
                        />
                      </Group>
                    )}
                    <Group mt="xs" justify="space-between">
                      <Select
                        size="xs"
                        data={[
                          { value: "true", label: "Required" },
                          { value: "false", label: "Optional" },
                        ]}
                        value={String(q.required)}
                        onChange={(v) =>
                          handleQuestionUpdate(idx, (qq) => ({ ...qq, required: v === "true" }))
                        }
                      />
                      <ActionIcon color="terracotta" variant="subtle" onClick={() => handleDelete(idx)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Box>
                </Group>
              </Card>
            );
          }}
        />
        {questions.length === 0 && (
          <Card withBorder>
            <Text c="dimmed" size="sm" ta="center">
              No questions yet. Click "Add question" to start.
            </Text>
          </Card>
        )}
      </Box>
    </Stack>
  );
}
