import {
  Box,
  Stack,
  Text,
  Card,
  Group,
  Textarea,
  TextInput,
  Radio,
  Checkbox,
  Button,
  Badge,
} from "@mantine/core";
import type { SurveyQuestion } from "../../slices/surveyTemplateSlice";

export const OTHER_VALUE = "__other__";
export const otherTextKey = (qId: string) => `${qId}__other_text`;

interface SurveyRunnerProps {
  questions: SurveyQuestion[];
  answers: Record<string, any>;
  onChange: (id: string, value: any) => void;
  disabled?: boolean;
  onSubmit?: () => void;
}

function wordCount(text: string): number {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

export function SurveyRunner({ questions, answers, onChange, disabled, onSubmit }: SurveyRunnerProps) {
  const allAnswered = questions.every((q) => {
    if (!q.required) return true;
    const ans = answers[q.id];
    if (q.type === "likert") return typeof ans === "number" && ans >= 1;
    if (q.type === "choice_single") {
      if (typeof ans !== "string" || ans.length === 0) return false;
      if (ans === OTHER_VALUE) {
        const txt = answers[otherTextKey(q.id)];
        return typeof txt === "string" && txt.trim().length > 0;
      }
      return true;
    }
    if (q.type === "choice_multi") {
      if (!Array.isArray(ans) || ans.length === 0) return false;
      if (ans.includes(OTHER_VALUE)) {
        const txt = answers[otherTextKey(q.id)];
        return typeof txt === "string" && txt.trim().length > 0;
      }
      return true;
    }
    if (q.type === "free_text") {
      const min = q.config.minWords ?? 0;
      return typeof ans === "string" && wordCount(ans) >= min && ans.trim().length > 0;
    }
    return true;
  });

  return (
    <Stack gap="md">
      {questions.map((q, idx) => {
        const allowOther =
          (q.type === "choice_single" || q.type === "choice_multi") && !!q.config.allowOther;
        const otherLabel =
          (q.type === "choice_single" || q.type === "choice_multi") &&
          q.config.otherLabel
            ? q.config.otherLabel
            : "Other (specify)";
        return (
        <Card key={q.id} withBorder>
          <Group gap={8} mb="xs">
            <Badge size="sm" color="gray">
              Q{idx + 1}
            </Badge>
            {q.required && (
              <Badge size="sm" color="terracotta" variant="light">
                Required
              </Badge>
            )}
          </Group>
          <Text fw={500} mb="sm" style={{ whiteSpace: "pre-wrap" }}>
            {q.prompt || "(no prompt)"}
          </Text>

          {q.type === "likert" && (
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text size="xs" c="dimmed" style={{ minWidth: 90 }}>
                {q.config.leftAnchor}
              </Text>
              <Group gap={4} wrap="nowrap">
                {Array.from({ length: q.config.scale }, (_, i) => i + 1).map((n) => (
                  <Button
                    key={n}
                    variant={answers[q.id] === n ? "filled" : "outline"}
                    radius="xl"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onChange(q.id, n)}
                    style={{ minWidth: 36 }}
                  >
                    {n}
                  </Button>
                ))}
              </Group>
              <Text size="xs" c="dimmed" style={{ minWidth: 90, textAlign: "right" }}>
                {q.config.rightAnchor}
              </Text>
            </Group>
          )}

          {q.type === "choice_single" && (
            <Stack gap="xs">
              <Radio.Group
                value={answers[q.id] || ""}
                onChange={(v) => onChange(q.id, v)}
              >
                <Stack gap="xs">
                  {q.config.options.map((opt) => (
                    <Radio key={opt.value} value={opt.value} label={opt.label} disabled={disabled} />
                  ))}
                  {allowOther && (
                    <Radio value={OTHER_VALUE} label={otherLabel} disabled={disabled} />
                  )}
                </Stack>
              </Radio.Group>
              {allowOther && answers[q.id] === OTHER_VALUE && (
                <TextInput
                  value={answers[otherTextKey(q.id)] || ""}
                  onChange={(e) => onChange(otherTextKey(q.id), e.currentTarget.value)}
                  placeholder="Please specify..."
                  disabled={disabled}
                  ml={28}
                />
              )}
            </Stack>
          )}

          {q.type === "choice_multi" && (
            <Stack gap="xs">
              <Checkbox.Group
                value={answers[q.id] || []}
                onChange={(v) => onChange(q.id, v)}
              >
                <Stack gap="xs">
                  {q.config.options.map((opt) => (
                    <Checkbox key={opt.value} value={opt.value} label={opt.label} disabled={disabled} />
                  ))}
                  {allowOther && (
                    <Checkbox value={OTHER_VALUE} label={otherLabel} disabled={disabled} />
                  )}
                </Stack>
              </Checkbox.Group>
              {allowOther &&
                Array.isArray(answers[q.id]) &&
                answers[q.id].includes(OTHER_VALUE) && (
                  <TextInput
                    value={answers[otherTextKey(q.id)] || ""}
                    onChange={(e) => onChange(otherTextKey(q.id), e.currentTarget.value)}
                    placeholder="Please specify..."
                    disabled={disabled}
                    ml={28}
                  />
                )}
            </Stack>
          )}

          {q.type === "free_text" && (
            <Box>
              <Textarea
                value={answers[q.id] || ""}
                onChange={(e) => onChange(q.id, e.currentTarget.value)}
                autosize
                minRows={3}
                disabled={disabled}
                placeholder={q.config.placeholder || "Your answer..."}
              />
              {q.config.minWords ? (
                <Text size="xs" c="dimmed" mt={4}>
                  {wordCount(answers[q.id] || "")} / min {q.config.minWords} words
                </Text>
              ) : null}
            </Box>
          )}
        </Card>
        );
      })}

      {onSubmit && (
        <Group justify="flex-end">
          <Button onClick={onSubmit} disabled={disabled || !allAnswered}>
            Submit Survey
          </Button>
        </Group>
      )}
    </Stack>
  );
}
