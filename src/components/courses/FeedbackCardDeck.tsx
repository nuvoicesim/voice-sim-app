import {
  Accordion,
  Badge,
  Box,
  Card,
  Divider,
  Group,
  Stack,
  Text,
} from "@mantine/core";

/**
 * Phase 3 feedback-card deck.
 *
 * Renders the student's three frozen feedback cards (two faculty, one AI) as
 * Feedback Card A / B / C. The card IS the experimental stimulus, so all three
 * are rendered by ONE code path with identical typography, spacing, score
 * layout, and narrative treatment — any per-card visual difference could act as
 * an unintended source cue (design §6 "Presentation parity").
 *
 * Two deliberate rendering choices follow from that:
 *
 *  - The narrative is plain text with `pre-wrap`, never Markdown. If one source
 *    happened to emit Markdown and another plain prose, Markdown rendering would
 *    make the two visually distinguishable and contaminate RQ3.
 *  - Scores and their meanings come from the shared tables below, so a card can
 *    never format a score differently from its peers.
 *
 * The component receives only the blind-safe projection built server-side
 * (see amplify/functions/survey-instance-function/phase3-cards.ts). It has no
 * access to the true source unless the server has already revealed all three.
 */

export interface FeedbackCardData {
  displayKey: string;
  d1: string;
  d2: string;
  d3: string;
  narrative: string;
  /** null while blind; "AI-generated" | "Faculty-generated" after reveal. */
  sourceType: string | null;
}

/** Dimension definitions, shown once in the shared legend and as card row labels. */
const DIMENSIONS: Array<{
  key: "d1" | "d2" | "d3";
  code: string;
  name: string;
  description: string;
}> = [
  {
    key: "d1",
    code: "D1",
    name: "Target Elicitation & Adaptive Cueing",
    description: "How you elicited targets and adjusted support",
  },
  {
    key: "d2",
    code: "D2",
    name: "Supportive Communication & Responsiveness",
    description: "How you responded to effort or difficulty",
  },
  {
    key: "d3",
    code: "D3",
    name: "Accuracy of Clinical Judgment",
    description:
      "How accurately you recognized and responded to Maria’s productions",
  },
];

/** Score legend. N/A is explicitly not a low score (design §6). */
const SCORE_MEANING: Record<string, string> = {
  "1": "Needs development",
  "2": "Developing / inconsistent",
  "3": "Generally appropriate / reliable",
  "4": "Proficient",
  "N/A": "Cannot be fairly observed",
};

function scoreMeaning(score: string): string {
  return SCORE_MEANING[score] ?? SCORE_MEANING["N/A"];
}

/**
 * Compact shared reference. Shown once above the deck rather than repeated on
 * each card, so the cards stay short enough to sit in a sticky panel.
 */
function DimensionLegend() {
  return (
    <Box>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>
        How to read these cards
      </Text>
      <Stack gap={2}>
        {DIMENSIONS.map((d) => (
          <Text key={d.code} size="xs" c="dimmed">
            <strong>{d.code}</strong> — {d.name} ({d.description.toLowerCase()})
          </Text>
        ))}
      </Stack>
      <Text size="xs" c="dimmed" mt={6}>
        <strong>Scores:</strong> 1 = Needs development · 2 = Developing /
        inconsistent · 3 = Generally appropriate / reliable · 4 = Proficient ·
        N/A = Cannot be fairly observed.
      </Text>
      <Text size="xs" c="dimmed" fs="italic">
        N/A means the behavior could not be fairly observed from the available
        evidence. It does not mean poor performance.
      </Text>
    </Box>
  );
}

/**
 * One card's body. Every card — regardless of true source — is rendered by this
 * single function with the same props shape. Do not branch on source here.
 */
function CardBody({ card }: { card: FeedbackCardData }) {
  return (
    <Stack gap="sm">
      <Stack gap={6}>
        {DIMENSIONS.map((d) => {
          const score = card[d.key];
          return (
            <Group key={d.code} gap="xs" align="baseline" wrap="nowrap">
              <Text size="sm" fw={600} style={{ minWidth: 28 }}>
                {d.code}
              </Text>
              <Box style={{ flex: 1 }}>
                <Text size="sm">{d.name}</Text>
                <Text size="xs" c="dimmed">
                  {d.description}
                </Text>
              </Box>
              <Badge size="sm" variant="light" color="parchment">
                {score}
              </Badge>
              <Text
                size="xs"
                c="dimmed"
                style={{ minWidth: 190, textAlign: "right" }}
              >
                {scoreMeaning(score)}
              </Text>
            </Group>
          );
        })}
      </Stack>

      <Text size="xs" c="dimmed">
        1 = Needs development · 2 = Developing / inconsistent · 3 = Generally
        appropriate / reliable · 4 = Proficient · N/A = Cannot be fairly
        observed (not a low score).
      </Text>

      <Divider />

      <Box>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>
          Integrated Feedback
        </Text>
        {/* Plain text only — see the presentation-parity note at the top. */}
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {card.narrative}
        </Text>
      </Box>
    </Stack>
  );
}

interface FeedbackCardDeckProps {
  cards: FeedbackCardData[];
  /**
   * When true the deck sticks to the top of the scroll container so students
   * can re-open any card while working through Parts A-C without scrolling back.
   */
  sticky?: boolean;
}

export function FeedbackCardDeck({
  cards,
  sticky = true,
}: FeedbackCardDeckProps) {
  if (!cards || cards.length === 0) return null;

  const stickyStyle = sticky
    ? {
        position: "sticky" as const,
        top: 0,
        zIndex: 2,
        // Bounded height keeps three 100-200 word narratives from taking over
        // the viewport while still allowing any card to be reopened in place.
        maxHeight: "55vh",
        overflowY: "auto" as const,
      }
    : {};

  return (
    <Card
      withBorder
      p="sm"
      mb="md"
      style={{ background: "white", ...stickyStyle }}
    >
      <Stack gap="sm">
        <DimensionLegend />
        <Divider />
        <Text size="xs" c="dimmed">
          Select a card to expand it. You can keep more than one open to compare
          them, and you can reopen them at any time while answering.
        </Text>
        {/* defaultValue opens Card A only: the deck starts compact rather than
            three fully-expanded narratives. */}
        <Accordion
          multiple
          defaultValue={[cards[0].displayKey]}
          variant="separated"
        >
          {cards.map((card) => (
            <Accordion.Item key={card.displayKey} value={card.displayKey}>
              <Accordion.Control>
                <Group gap="xs">
                  <Text fw={600}>Feedback Card {card.displayKey}</Text>
                  {/* Present only after the server reveals all three cards.
                      Never "Faculty 1"/"Faculty 2" — the server does not send it. */}
                  {card.sourceType && (
                    <Badge size="sm" variant="light" color="terracotta">
                      {card.sourceType}
                    </Badge>
                  )}
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <CardBody card={card} />
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Stack>
    </Card>
  );
}
