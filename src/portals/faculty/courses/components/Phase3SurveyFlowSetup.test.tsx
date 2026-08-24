import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { Phase3SurveyFlowSetup } from "./Phase3SurveyFlowSetup";
import moduleItemReducer, { fetchItems } from "../../../../slices/moduleItemSlice";
import type { ModuleItem } from "../../../../slices/moduleItemSlice";
import surveyTemplateReducer from "../../../../slices/surveyTemplateSlice";
import { moduleItemApi } from "../../../../api/moduleItemApi";

// ── In-memory fake backend ──
// The mock factory is hoisted, so all state lives inside it and is reached
// through the mocked module's own test helpers.
vi.mock("../../../../api/moduleItemApi", () => {
  interface FakeRow {
    moduleItemId: string;
    moduleId: string;
    courseId: string;
    itemType: string;
    title: string;
    position: number;
    gating?: unknown;
    payload: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }
  const items: FakeRow[] = [];

  const findByMarker = (marker: string) =>
    items.find((i) => i.itemType === "survey" && i.payload?.phase3Flow === marker);

  // Deep-copy on read: Redux freezes what enters the store, and the fake
  // endpoint must stay free to mutate its own rows afterwards.
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  return {
    moduleItemApi: {
      list: vi.fn(async (moduleId: string) => ({
        items: clone(items.filter((i) => i.moduleId === moduleId)),
      })),
      // Simplified mirror of the server's idempotent phase3-setup endpoint.
      phase3Setup: vi.fn(
        async (
          moduleId: string,
          body: { partsACTemplateId?: string; partDTemplateId?: string }
        ) => {
          const created = { partsAC: false, partD: false };
          const maxPos = items.reduce(
            (max, i) => Math.max(max, (i.position as number) ?? 0),
            -1
          );
          let ac = findByMarker("parts_ac");
          if (!ac) {
            ac = {
              moduleItemId: `p3ac-${moduleId}`,
              moduleId,
              courseId: "course-1",
              itemType: "survey",
              title: "Phase 3 Survey — Parts A–C",
              position: maxPos + 1,
              gating: { kind: "open" },
              payload: { surveyTemplateId: body.partsACTemplateId },
              createdAt: "2026-08-23T00:00:00Z",
              updatedAt: "2026-08-23T00:00:00Z",
            };
            items.push(ac);
            created.partsAC = true;
          }
          ac.payload = {
            ...ac.payload,
            phase3Flow: "parts_ac",
            feedbackCardsFromItemId: ac.moduleItemId,
            revealOnSubmit: {
              ...((ac.payload.revealOnSubmit ?? {}) as Record<string, unknown>),
              unblindAssignmentItemId: ac.moduleItemId,
            },
            cardSections: [
              { displayKey: "A", firstQuestionNumber: 1 },
              { displayKey: "B", firstQuestionNumber: 7 },
              { displayKey: "C", firstQuestionNumber: 13 },
            ],
            hideQuestionNumbers: true,
          };
          let d = findByMarker("part_d");
          if (!d) {
            d = {
              moduleItemId: `p3d-${moduleId}`,
              moduleId,
              courseId: "course-1",
              itemType: "survey",
              title: "Phase 3 Survey — Part D",
              position: (ac.position as number) + 1,
              gating: { kind: "after_item", moduleItemId: ac.moduleItemId },
              payload: {
                surveyTemplateId: body.partDTemplateId,
                phase3Flow: "part_d",
                feedbackCardsFromItemId: ac.moduleItemId,
                requireFeedbackReveal: true,
                hideQuestionNumbers: true,
              },
              createdAt: "2026-08-23T00:00:00Z",
              updatedAt: "2026-08-23T00:00:00Z",
            };
            items.push(d);
            created.partD = true;
          }
          return { partsAC: ac, partD: d, created };
        }
      ),
      // Test helpers (not part of the real API surface).
      __reset: () => {
        items.length = 0;
      },
      __items: () => items,
      __seed: (item: Record<string, unknown>) => {
        items.push(item as unknown as FakeRow);
      },
    },
  };
});

vi.mock("../../../../api/surveyTemplateApi", () => {
  const template = (id: string, name: string, count: number) => ({
    surveyTemplateId: id,
    name,
    questions: Array.from({ length: count }, (_, i) => ({
      id: `q${i + 1}`,
      type: "likert",
      prompt: `Question ${i + 1}`,
      required: true,
      config: { scale: 7, leftAnchor: "Low", rightAnchor: "High" },
    })),
    isActive: true,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  });
  const known: Record<string, ReturnType<typeof template>> = {
    "tpl-ac": template("tpl-ac", "Phase 3 Parts A-C Instrument", 25),
    "tpl-d": template("tpl-d", "Phase 3 Part D Instrument", 9),
    "tpl-bad": template("tpl-bad", "Some Other Survey", 12),
  };
  return {
    surveyTemplateApi: {
      list: vi.fn(async () => ({ templates: Object.values(known) })),
      get: vi.fn(async (id: string) => {
        if (known[id]) return known[id];
        throw new Error("Survey template not found");
      }),
    },
  };
});

const fakeApi = moduleItemApi as unknown as {
  phase3Setup: ReturnType<typeof vi.fn>;
  __reset: () => void;
  __items: () => ModuleItem[];
  __seed: (item: Record<string, unknown>) => void;
};

function wiredACRow(id: string, templateId: string, position = 0) {
  return {
    moduleItemId: id,
    moduleId: "mod-1",
    courseId: "course-1",
    itemType: "survey",
    title: "Phase 3 Survey — Parts A–C",
    position,
    gating: { kind: "open" },
    payload: {
      surveyTemplateId: templateId,
      phase3Flow: "parts_ac",
      feedbackCardsFromItemId: id,
      revealOnSubmit: { unblindAssignmentItemId: id },
      cardSections: [
        { displayKey: "A", firstQuestionNumber: 1 },
        { displayKey: "B", firstQuestionNumber: 7 },
        { displayKey: "C", firstQuestionNumber: 13 },
      ],
      hideQuestionNumbers: true,
    },
    createdAt: "2026-08-23T00:00:00Z",
    updatedAt: "2026-08-23T00:00:00Z",
  };
}

function wiredDRow(acId: string, id: string, templateId: string, position = 1) {
  return {
    moduleItemId: id,
    moduleId: "mod-1",
    courseId: "course-1",
    itemType: "survey",
    title: "Phase 3 Survey — Part D",
    position,
    gating: { kind: "after_item", moduleItemId: acId },
    payload: {
      surveyTemplateId: templateId,
      phase3Flow: "part_d",
      feedbackCardsFromItemId: acId,
      requireFeedbackReveal: true,
      hideQuestionNumbers: true,
    },
    createdAt: "2026-08-23T00:00:00Z",
    updatedAt: "2026-08-23T00:00:00Z",
  };
}

function makeStore() {
  return configureStore({
    reducer: {
      moduleItems: moduleItemReducer,
      surveyTemplates: surveyTemplateReducer,
    },
  });
}

function renderSetup(store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <MantineProvider>
        <Phase3SurveyFlowSetup moduleId="mod-1" />
      </MantineProvider>
    </Provider>
  );
}

/**
 * Select an option in a Mantine Select. Floating UI's hide middleware marks
 * the open dropdown display:none under jsdom (no real layout), so the option
 * is looked up with hidden:true inside the input's own listbox
 * (aria-controls) and clicked via fireEvent.
 */
async function pickTemplate(
  user: ReturnType<typeof userEvent.setup>,
  selectPlaceholder: RegExp,
  optionName: RegExp
) {
  const input = await screen.findByPlaceholderText(selectPlaceholder);
  await user.click(input);
  const listboxId = input.getAttribute("aria-controls");
  const listbox = listboxId ? document.getElementById(listboxId) : null;
  const scope = listbox ? within(listbox) : screen;
  const option = await scope.findByRole("option", {
    name: optionName,
    hidden: true,
  });
  fireEvent.click(option);
}

/** Open dropdowns only after fetchTemplates has hydrated the store. */
async function awaitTemplatesLoaded(store: ReturnType<typeof makeStore>) {
  await waitFor(() => {
    expect(store.getState().surveyTemplates.templates.length).toBeGreaterThan(0);
  });
}

describe("Phase3SurveyFlowSetup", () => {
  beforeEach(() => {
    fakeApi.__reset();
    fakeApi.phase3Setup.mockClear();
  });

  it("calls the server setup endpoint and flips to Configured", async () => {
    const user = userEvent.setup();
    const store = makeStore();
    renderSetup(store);
    await awaitTemplatesLoaded(store);

    await pickTemplate(user, /Pick the Parts A–C survey template/, /Parts A-C Instrument \(25 questions\)/);
    await pickTemplate(user, /Pick the Part D survey template/, /Part D Instrument \(9 questions\)/);

    await user.click(screen.getByRole("button", { name: /Create and Connect/ }));

    await waitFor(() => {
      expect(fakeApi.phase3Setup).toHaveBeenCalledWith("mod-1", {
        partsACTemplateId: "tpl-ac",
        partDTemplateId: "tpl-d",
      });
    });
    // The panel refetches items and shows the validated Configured state.
    expect(await screen.findByText("Configured")).toBeInTheDocument();
    expect(screen.getByText(/--item-id p3ac-mod-1/)).toBeInTheDocument();
    expect(screen.getByText(/--part-d-item-id p3d-mod-1/)).toBeInTheDocument();
    expect(fakeApi.__items()).toHaveLength(2);
  });

  it("resumes a partial run: only asks for the Part D template", async () => {
    fakeApi.__seed({
      moduleItemId: "item-1",
      moduleId: "mod-1",
      courseId: "course-1",
      itemType: "survey",
      title: "Phase 3 Survey — Parts A–C",
      position: 0,
      gating: { kind: "open" },
      payload: {
        surveyTemplateId: "tpl-ac",
        instanceLabel: "Phase 3 Parts A–C",
        phase3Flow: "parts_ac",
      },
      createdAt: "2026-08-23T00:00:00Z",
      updatedAt: "2026-08-23T00:00:00Z",
    });

    const user = userEvent.setup();
    const store = makeStore();
    await store.dispatch(fetchItems("mod-1"));
    renderSetup(store);

    expect(
      await screen.findByText(/previous setup is incomplete/)
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Pick the Parts A–C survey template/)).toBeNull();

    await awaitTemplatesLoaded(store);
    await pickTemplate(user, /Pick the Part D survey template/, /Part D Instrument \(9 questions\)/);
    await user.click(
      screen.getByRole("button", { name: /Resume Create and Connect/ })
    );

    await waitFor(() => {
      expect(fakeApi.phase3Setup).toHaveBeenCalledWith("mod-1", {
        partDTemplateId: "tpl-d",
      });
    });
    expect(await screen.findByText("Configured")).toBeInTheDocument();
    expect(fakeApi.__items()).toHaveLength(2);
  });

  it("blocks templates with the wrong question counts without calling the server", async () => {
    const user = userEvent.setup();
    const store = makeStore();
    renderSetup(store);
    await awaitTemplatesLoaded(store);

    await pickTemplate(user, /Pick the Parts A–C survey template/, /Some Other Survey \(12 questions\)/);
    await pickTemplate(user, /Pick the Part D survey template/, /Part D Instrument \(9 questions\)/);

    expect(
      await screen.findByText(/must have exactly 25 questions/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create and Connect/ })
    ).toBeDisabled();
    expect(fakeApi.phase3Setup).not.toHaveBeenCalled();
  });

  it("shows Configured only after validating templates of an existing flow", async () => {
    fakeApi.__seed(wiredACRow("ac-1", "tpl-ac", 0));
    fakeApi.__seed(wiredDRow("ac-1", "d-1", "tpl-d", 1));

    const store = makeStore();
    await store.dispatch(fetchItems("mod-1"));
    renderSetup(store);

    expect(await screen.findByText("Configured")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create and Connect/ })).toBeNull();
    expect(screen.getByText(/--item-id ac-1/)).toBeInTheDocument();
    expect(screen.getByText(/--part-d-item-id d-1/)).toBeInTheDocument();
  });

  it("refuses Configured when a wired flow references an unreadable template", async () => {
    fakeApi.__seed(wiredACRow("ac-1", "tpl-missing", 0));
    fakeApi.__seed(wiredDRow("ac-1", "d-1", "tpl-d", 1));

    const store = makeStore();
    await store.dispatch(fetchItems("mod-1"));
    renderSetup(store);

    expect(
      await screen.findByText(/could not be confirmed/)
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot be read/)).toBeInTheDocument();
    expect(screen.queryByText("Configured")).toBeNull();
    expect(screen.queryByRole("button", { name: /Create and Connect/ })).toBeNull();
  });

  it("refuses Configured when a wired flow's template has the wrong question count", async () => {
    fakeApi.__seed(wiredACRow("ac-1", "tpl-bad", 0)); // 12 questions
    fakeApi.__seed(wiredDRow("ac-1", "d-1", "tpl-d", 1));

    const store = makeStore();
    await store.dispatch(fetchItems("mod-1"));
    renderSetup(store);

    expect(
      await screen.findByText(/could not be confirmed/)
    ).toBeInTheDocument();
    expect(screen.getByText(/exactly 25 questions/)).toBeInTheDocument();
    expect(screen.queryByText("Configured")).toBeNull();
  });

  it("treats non-adjacent items as incomplete and offers to resume", async () => {
    fakeApi.__seed(wiredACRow("ac-1", "tpl-ac", 0));
    fakeApi.__seed({
      moduleItemId: "instr-1",
      moduleId: "mod-1",
      courseId: "course-1",
      itemType: "instruction",
      title: "In between",
      position: 1,
      payload: {},
      createdAt: "2026-08-23T00:00:00Z",
      updatedAt: "2026-08-23T00:00:00Z",
    });
    fakeApi.__seed(wiredDRow("ac-1", "d-1", "tpl-d", 2));

    const store = makeStore();
    await store.dispatch(fetchItems("mod-1"));
    renderSetup(store);

    expect(
      await screen.findByText(/Part D must sit directly after Parts A–C/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Configured")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Resume Create and Connect/ })
    ).toBeInTheDocument();
  });

  it("stops with a conflict message when multiple candidates exist", async () => {
    fakeApi.__seed(wiredACRow("ac-1", "tpl-ac", 0));
    fakeApi.__seed(wiredACRow("ac-2", "tpl-ac", 1));

    const store = makeStore();
    await store.dispatch(fetchItems("mod-1"));
    renderSetup(store);

    expect(
      await screen.findByText(/Multiple Phase 3 candidates found/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Parts A–C candidates/)).toBeInTheDocument();
    expect(screen.queryByText("Configured")).toBeNull();
    expect(screen.queryByRole("button", { name: /Create and Connect/ })).toBeNull();
  });
});
