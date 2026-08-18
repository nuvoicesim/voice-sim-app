interface Phase3CardSection {
  displayKey?: unknown;
  firstQuestionNumber?: unknown;
}

/** Convert one-based study question numbers into SurveyRunner's zero-based headings. */
export function buildPhase3SectionHeaders(item: {
  payload?: { cardSections?: unknown };
}): Record<number, string> | undefined {
  const sections = item?.payload?.cardSections as
    | Phase3CardSection[]
    | undefined;
  if (!Array.isArray(sections) || sections.length === 0) return undefined;

  const headers: Record<number, string> = {};
  for (const section of sections) {
    const questionNumber = Number(section?.firstQuestionNumber);
    const displayKey = section?.displayKey;
    if (
      !Number.isInteger(questionNumber) ||
      questionNumber < 1 ||
      typeof displayKey !== "string" ||
      !["A", "B", "C"].includes(displayKey)
    ) {
      continue;
    }
    headers[
      questionNumber - 1
    ] = `The following questions are about Feedback Card ${displayKey}`;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}
