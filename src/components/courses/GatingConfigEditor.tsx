import {
  ActionIcon,
  Box,
  Button,
  Card,
  Group,
  MultiSelect,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";

/**
 * Gating clauses that can stand alone or be combined under an `all_of` parent.
 * Backwards compatible with single-kind values from the old editor.
 */
export type GatingClause =
  | { kind: "open" }
  | { kind: "after_item"; moduleItemId?: string }
  | { kind: "after_module"; moduleId?: string }
  | { kind: "group_in"; groups?: string[] }
  | { kind: "all_reviewers_submitted" };

export type GatingConfig =
  | GatingClause
  | { kind: "all_of"; clauses: GatingClause[] };

interface GatingConfigEditorProps {
  value: GatingConfig | null | undefined;
  onChange: (next: GatingConfig) => void;
  /** Items in the same module that come earlier (eligible after_item targets). */
  candidateItems?: { id: string; label: string }[];
  /** Earlier modules in the same course. */
  candidateModules?: { id: string; label: string }[];
  /** Group keys discovered from existing randomizer items in this course. */
  candidateGroups?: string[];
  hideAfterModule?: boolean;
}

/** Normalize any incoming GatingConfig into an array of clauses for the editor. */
function toClauses(value: GatingConfig | null | undefined): GatingClause[] {
  if (!value || (value as any).kind === "open") return [];
  if ((value as any).kind === "all_of") {
    const list = (value as any).clauses;
    return Array.isArray(list) ? list : [];
  }
  return [value as GatingClause];
}

/** Convert clauses array back to GatingConfig (collapses 0/1 cases). */
function fromClauses(clauses: GatingClause[]): GatingConfig {
  if (clauses.length === 0) return { kind: "open" };
  if (clauses.length === 1) return clauses[0];
  return { kind: "all_of", clauses };
}

export function GatingConfigEditor({
  value,
  onChange,
  candidateItems = [],
  candidateModules = [],
  candidateGroups = [],
  hideAfterModule = false,
}: GatingConfigEditorProps) {
  const clauses = toClauses(value);

  const updateClause = (idx: number, next: GatingClause) => {
    const copy = clauses.slice();
    copy[idx] = next;
    onChange(fromClauses(copy));
  };

  const removeClause = (idx: number) => {
    const copy = clauses.filter((_, i) => i !== idx);
    onChange(fromClauses(copy));
  };

  const addClause = () => {
    // Default new clause to a sensible first option.
    const firstAvailableKind: GatingClause["kind"] =
      candidateItems.length > 0
        ? "after_item"
        : candidateModules.length > 0 && !hideAfterModule
          ? "after_module"
          : candidateGroups.length > 0
            ? "group_in"
            : "all_reviewers_submitted";
    const next = clauses.slice();
    next.push(defaultForKind(firstAvailableKind, candidateItems, candidateModules));
    onChange(fromClauses(next));
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text size="sm" fw={500}>
          Gating conditions{clauses.length > 1 ? " (ALL must be met)" : ""}
        </Text>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={12} />}
          onClick={addClause}
        >
          Add condition
        </Button>
      </Group>

      {clauses.length === 0 ? (
        <Card withBorder p="sm">
          <Text size="sm" c="dimmed">
            Open — no prerequisite. Click "Add condition" to require something first.
          </Text>
        </Card>
      ) : (
        clauses.map((c, idx) => (
          <Card key={idx} withBorder p="xs">
            <Group align="flex-start" gap="xs">
              <Box style={{ flex: 1 }}>
                <ClauseEditor
                  clause={c}
                  onChange={(next) => updateClause(idx, next)}
                  candidateItems={candidateItems}
                  candidateModules={candidateModules}
                  candidateGroups={candidateGroups}
                  hideAfterModule={hideAfterModule}
                />
              </Box>
              <ActionIcon
                color="red"
                variant="subtle"
                onClick={() => removeClause(idx)}
                title="Remove this condition"
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          </Card>
        ))
      )}
    </Stack>
  );
}

function defaultForKind(
  kind: GatingClause["kind"],
  candidateItems: { id: string }[],
  candidateModules: { id: string }[]
): GatingClause {
  switch (kind) {
    case "after_item":
      return { kind: "after_item", moduleItemId: candidateItems[0]?.id };
    case "after_module":
      return { kind: "after_module", moduleId: candidateModules[0]?.id };
    case "group_in":
      return { kind: "group_in", groups: [] };
    case "all_reviewers_submitted":
      return { kind: "all_reviewers_submitted" };
    case "open":
    default:
      return { kind: "open" };
  }
}

function ClauseEditor({
  clause,
  onChange,
  candidateItems,
  candidateModules,
  candidateGroups,
  hideAfterModule,
}: {
  clause: GatingClause;
  onChange: (next: GatingClause) => void;
  candidateItems: { id: string; label: string }[];
  candidateModules: { id: string; label: string }[];
  candidateGroups: string[];
  hideAfterModule: boolean;
}) {
  const kindOptions = [
    ...(candidateItems.length > 0
      ? [{ value: "after_item", label: "After previous item completed" }]
      : []),
    ...(!hideAfterModule && candidateModules.length > 0
      ? [{ value: "after_module", label: "After previous module completed" }]
      : []),
    {
      value: "group_in",
      label: "Visible only to specific group(s) (counter-balanced)",
    },
    {
      value: "all_reviewers_submitted",
      label: "After all reviewers have submitted feedback",
    },
  ];

  const groupOptions =
    candidateGroups.length > 0 ? candidateGroups : ["VOICE_FIRST", "SIMCASE_FIRST"];

  return (
    <Stack gap={6}>
      <Select
        size="xs"
        data={kindOptions}
        value={clause.kind === "open" ? null : clause.kind}
        onChange={(k) => {
          if (!k) return;
          onChange(defaultForKind(k as GatingClause["kind"], candidateItems, candidateModules));
        }}
        placeholder="Pick a condition"
      />
      {clause.kind === "after_item" && (
        <Select
          size="xs"
          data={candidateItems.map((c) => ({ value: c.id, label: c.label }))}
          value={clause.moduleItemId || ""}
          onChange={(id) => id && onChange({ kind: "after_item", moduleItemId: id })}
          placeholder="Pick prereq item"
        />
      )}
      {clause.kind === "after_module" && (
        <Select
          size="xs"
          data={candidateModules.map((c) => ({ value: c.id, label: c.label }))}
          value={clause.moduleId || ""}
          onChange={(id) => id && onChange({ kind: "after_module", moduleId: id })}
          placeholder="Pick prereq module"
        />
      )}
      {clause.kind === "group_in" && (
        <MultiSelect
          size="xs"
          data={groupOptions}
          value={clause.groups || []}
          onChange={(groups) => onChange({ kind: "group_in", groups })}
          searchable
          placeholder="Pick group keys (e.g. VOICE_FIRST)"
        />
      )}
      {clause.kind === "all_reviewers_submitted" && (
        <Text size="xs" c="dimmed">
          Unlocks once both course instructors have submitted reviewer feedback for
          the relevant assignment.
        </Text>
      )}
    </Stack>
  );
}
