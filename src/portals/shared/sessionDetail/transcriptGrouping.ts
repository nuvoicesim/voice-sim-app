import type { SessionTurn } from '../../../slices/sessionSlice';

export const LEGACY_TRANSCRIPT_GROUP_KEY = 'legacy';
export const LEGACY_TRANSCRIPT_GROUP_LABEL = 'Legacy / Ungrouped Conversation';

// Known progressKey → human-readable label map. Keys must be lowercased to
// match the output of normalizeIdentifier so that backend-supplied values
// with any casing variation still hit the lookup. The titleFromIdentifier
// fallback handles any future progressKey added before this map updates.
export const TRANSCRIPT_LABELS: Record<string, string> = {
  'phase1#phase1-section-a': 'Phase 1 Section A: Object Naming',
  'phase1#phase1-section-b': 'Phase 1 Section B: Word Fluency',
  'phase1#phase1-section-c': 'Phase 1 Section C: Sentence Completion',
  'phase1#phase1-section-d': 'Phase 1 Section D: Responsive Speech',
  'phase2#phase2-ben-object-naming': 'Phase 2 Ben: Object Naming with Cueing Practice',
  'phase2#phase2-ben-sentence-completion': 'Phase 2 Ben: Sentence Completion Practice',
  'phase2#phase2-maria-object-naming': 'Phase 2 Maria: Object Naming with Cueing Practice',
  'phase2#phase2-maria-sentence-completion': 'Phase 2 Maria: Sentence Completion Practice',
};

export interface TranscriptGroup {
  key: string;
  label: string;
  turns: SessionTurn[];
}

export function normalizeIdentifier(value?: string | null): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Converts kebab-case / snake_case / hash-separated identifiers into readable
// title text. Leading phase<digit> token gets a space so it reads "Phase 1" /
// "Phase 2" rather than the unbroken "Phase1".
export function titleFromIdentifier(value: string): string {
  return value
    .replace(/^phase(\d+)/, 'phase $1')
    .split(/[-_#\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveKnownTranscriptLabel(turn: SessionTurn): string | null {
  const candidates: string[] = [];
  const progressKey = normalizeIdentifier(turn.progressKey);
  if (progressKey) candidates.push(progressKey);

  const phaseId = normalizeIdentifier(turn.phaseId);
  const taskId = normalizeIdentifier(turn.taskId);
  if (phaseId && taskId) candidates.push(`${phaseId}#${taskId}`);

  const sectionId = normalizeIdentifier(turn.sectionId);
  if (phaseId && sectionId) candidates.push(`${phaseId}#${sectionId}`);

  for (const candidate of candidates) {
    if (TRANSCRIPT_LABELS[candidate]) return TRANSCRIPT_LABELS[candidate];
  }
  return null;
}

export function buildTranscriptGroupKey(turn: SessionTurn): string {
  const progressKey = normalizeIdentifier(turn.progressKey);
  if (progressKey) return `progress:${progressKey}`;

  const phaseId = normalizeIdentifier(turn.phaseId);
  const taskId = normalizeIdentifier(turn.taskId);
  if (phaseId && taskId) return `task:${phaseId}#${taskId}`;

  const sectionId = normalizeIdentifier(turn.sectionId);
  if (phaseId && sectionId) return `section:${phaseId}#${sectionId}`;

  return LEGACY_TRANSCRIPT_GROUP_KEY;
}

export function buildTranscriptGroupLabel(turn: SessionTurn): string {
  const knownLabel = resolveKnownTranscriptLabel(turn);
  if (knownLabel) return knownLabel;

  const phaseId = normalizeIdentifier(turn.phaseId);
  const taskId = normalizeIdentifier(turn.taskId);
  const sectionId = normalizeIdentifier(turn.sectionId);
  const taskType = normalizeIdentifier(turn.taskType);
  const patientPersonaId = normalizeIdentifier(turn.patientPersonaId);

  if (!phaseId && !taskId && !sectionId) {
    return LEGACY_TRANSCRIPT_GROUP_LABEL;
  }

  const phaseLabel = phaseId ? titleFromIdentifier(phaseId) : 'Session';
  let taskLabel = 'Conversation';
  if (taskId || sectionId) {
    taskLabel = titleFromIdentifier(taskId || sectionId);
  } else if (taskType) {
    taskLabel = titleFromIdentifier(taskType);
  }

  const personaLabel = patientPersonaId ? `${titleFromIdentifier(patientPersonaId)}: ` : '';
  return `${phaseLabel} ${personaLabel}${taskLabel}`;
}

// Single-pass grouping using Map insertion order so groups appear in the
// order their first turn was recorded. Turns within a group remain in their
// input order (backend returns them chronologically).
export function groupTranscriptTurns(turns: SessionTurn[]): TranscriptGroup[] {
  const groups = new Map<string, TranscriptGroup>();
  for (const turn of turns) {
    const key = buildTranscriptGroupKey(turn);
    const existing = groups.get(key);
    if (existing) {
      existing.turns.push(turn);
      continue;
    }
    groups.set(key, {
      key,
      label: buildTranscriptGroupLabel(turn),
      turns: [turn],
    });
  }
  return Array.from(groups.values());
}
