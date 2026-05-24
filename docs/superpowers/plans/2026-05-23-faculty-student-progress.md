# Faculty Student Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the Faculty `Students` tab to `Student Progress`, add consent + group columns, and provide a dedicated `/faculty/courses/:courseId/students/:studentUserId` detail page with module/item hierarchy and type-specific drilldowns.

**Architecture:** Two new faculty-only backend reads (`/courses/{courseId}/group-assignments` and a `studentUserId` query branch on the existing survey-instance GET), course-scoped caches in `consentSlice` + `groupAssignmentSlice`, a list-view redesign in `CourseEditorPage`, and a new `StudentCourseDetailPage` whose per-item drilldowns each fetch their own data lazily.

**Tech Stack:** React 18 + Mantine v8 + Redux Toolkit + react-router v7 + Vitest + AWS Amplify (REST API → Lambda → DynamoDB).

**Spec:** [docs/superpowers/specs/2026-05-23-faculty-student-progress-design.md](../specs/2026-05-23-faculty-student-progress-design.md)

---

## Conventions used in this plan

- Test runner: `npx vitest run <test-file>` (the repo `test` script also works).
- Backend handler tests run under the same Vitest config (see `vitest.config.ts` include globs).
- Each task is one logical change with one commit. Commit messages are provided.
- Backend changes (`amplify/**`) are not deployed by the implementing agent — the user runs the sandbox/deploy. The implementing agent stops at "code compiles, unit tests pass."

---

## File Structure

**Created:**
- `src/portals/faculty/courses/StudentCourseDetailPage.tsx` — top-level page component.
- `src/portals/faculty/courses/components/StudentSummaryCard.tsx` — summary header.
- `src/portals/faculty/courses/components/StudentModuleItemRow.tsx` — expandable item row with state badge.
- `src/portals/faculty/courses/components/itemDetails/AssignmentItemDetail.tsx`
- `src/portals/faculty/courses/components/itemDetails/SurveyItemDetail.tsx`
- `src/portals/faculty/courses/components/itemDetails/AIDetectionItemDetail.tsx`
- `src/portals/faculty/courses/components/itemDetails/ConsentItemDetail.tsx`
- `src/portals/faculty/courses/components/itemDetails/GenericItemDetail.tsx`
- `src/portals/faculty/courses/studentProgressDisplay.ts` — pure helpers for badge props.
- `src/portals/faculty/courses/studentProgressDisplay.test.ts` — unit tests for the helpers.
- `src/slices/consentSlice.test.ts` — selector tests for the new course-scope cache.
- `src/slices/groupAssignmentSlice.test.ts` — selector tests for the new course-scope cache.
- `src/portals/faculty/courses/components/StudentSummaryCard.test.tsx`
- `src/portals/faculty/courses/components/itemDetails/AssignmentItemDetail.test.tsx`
- `src/portals/faculty/courses/components/itemDetails/SurveyItemDetail.test.tsx`
- `src/portals/faculty/courses/components/itemDetails/AIDetectionItemDetail.test.tsx`
- `src/portals/faculty/courses/components/itemDetails/ConsentItemDetail.test.tsx`
- `src/portals/faculty/courses/components/itemDetails/GenericItemDetail.test.tsx`

**Modified:**
- `src/api/groupAssignmentApi.ts` — add `listForCourse`.
- `src/api/surveyInstanceApi.ts` — add `getForStudent`.
- `src/slices/consentSlice.ts` — add course-scope cache, thunk, selector.
- `src/slices/groupAssignmentSlice.ts` — add course-scope cache, thunk, selector.
- `src/portals/faculty/courses/CourseEditorPage.tsx` — tab rename, list redesign, `?tab=` URL persistence.
- `src/App.tsx` — register the new route.
- `amplify/functions/course-function/handler.ts` — add `handleListGroupAssignments`.
- `amplify/functions/survey-instance-function/handler.ts` — add `handleGetForStudent` branch.
- `amplify/backend.ts` — add `/courses/{courseId}/group-assignments` route.

---

# Phase 1 — Backend additions

## Task 1: Survey-instance `getForStudent` handler branch

**Files:**
- Modify: `amplify/functions/survey-instance-function/handler.ts`

**Goal:** Add a faculty-only `?studentUserId=...` branch to the existing GET. No new route. Caller must be an instructor on the course owning the survey item.

- [ ] **Step 1: Read the existing handler dispatch** to find the right insertion point (around `if (method === "GET") return await handleGet(caller!, pathParams.itemId);` near the top of the `handler` function).

- [ ] **Step 2: Edit the GET branch and add `handleGetForStudent`**

In `amplify/functions/survey-instance-function/handler.ts`, replace:

```typescript
    if (resource.endsWith("/submit") && method === "POST") {
      return await handleSubmit(caller!, pathParams.itemId);
    }
    if (method === "GET") return await handleGet(caller!, pathParams.itemId);
    if (method === "PUT") return await handleSaveAnswers(caller!, pathParams.itemId, event.body);
```

with:

```typescript
    if (resource.endsWith("/submit") && method === "POST") {
      return await handleSubmit(caller!, pathParams.itemId);
    }
    if (method === "GET") {
      const qs = event.queryStringParameters || {};
      if (qs.studentUserId) {
        return await handleGetForStudent(
          caller!,
          pathParams.itemId,
          qs.studentUserId
        );
      }
      return await handleGet(caller!, pathParams.itemId);
    }
    if (method === "PUT") return await handleSaveAnswers(caller!, pathParams.itemId, event.body);
```

Then add the new function at the bottom of the file (above the final `export` if present, otherwise at end):

```typescript
async function handleGetForStudent(
  caller: any,
  itemId: string,
  studentUserId: string
) {
  const item = await getItem(
    MODULE_ITEM_TABLE,
    { moduleItemId: itemId },
    dynamo
  );
  if (!item) return notFoundResponse("ModuleItem not found");
  if (item.itemType !== "survey" && item.itemType !== "debrief") {
    return badRequestResponse("ModuleItem is not a survey or debrief");
  }
  const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
  if (authError) return authError;

  const instance = await getItem(
    SURVEY_INSTANCE_TABLE,
    { moduleItemId: itemId, studentUserId },
    dynamo
  );
  return createResponse(HTTP_STATUS.OK, { instance: instance || null });
}
```

- [ ] **Step 3: TypeScript-check the file**

Run: `npx tsc --noEmit -p . 2>&1 | findstr "survey-instance-function" ; echo done`
Expected: no errors mentioning `survey-instance-function/handler.ts`. (If your shell is bash, use `grep` instead of `findstr`.)

- [ ] **Step 4: Commit**

```bash
git add amplify/functions/survey-instance-function/handler.ts
git commit -m "feat(survey-instance): faculty getForStudent via ?studentUserId"
```

---

## Task 2: Group-assignment `listForCourse` handler + CDK route

**Files:**
- Modify: `amplify/functions/course-function/handler.ts`
- Modify: `amplify/backend.ts`

**Goal:** New endpoint `GET /courses/{courseId}/group-assignments` returning all `StudentGroupAssignment` rows for the course. Faculty-only.

- [ ] **Step 1: Add dispatch + handler in `course-function/handler.ts`**

Find the existing `handleListMyGroups` dispatch (the block matching `/courses/{courseId}/my-groups`). Immediately after that block, insert:

```typescript
    // ── Faculty view: all group assignments for the course ──
    if (
      method === "GET" &&
      pathParams.courseId &&
      resource.endsWith("/courses/{courseId}/group-assignments")
    ) {
      return await handleListGroupAssignments(caller!, pathParams.courseId);
    }
```

At the bottom of the file (next to `handleListMyGroups`), add:

```typescript
async function handleListGroupAssignments(caller: any, courseId: string) {
  if (!STUDENT_GROUP_ASSIGNMENT_TABLE) {
    return createResponse(HTTP_STATUS.OK, { assignments: [] });
  }
  const authError = await requireCourseInstructor(caller, courseId, dynamo);
  if (authError) return authError;

  const result = await dynamo.send(
    new ScanCommand({
      TableName: STUDENT_GROUP_ASSIGNMENT_TABLE,
      FilterExpression: "courseId = :c",
      ExpressionAttributeValues: { ":c": courseId },
    })
  );
  const assignments = (result.Items || []).map((row) => ({
    courseId: row.courseId,
    studentUserId: row.studentUserId,
    scopeKey: row.scopeKey,
    groupKey: row.groupKey,
    assignedByItemId: row.assignedByItemId,
    assignedAt: row.assignedAt,
  }));
  return createResponse(HTTP_STATUS.OK, { assignments });
}
```

If `ScanCommand` is not already imported at the top of the file, add it to the `@aws-sdk/lib-dynamodb` import line.

- [ ] **Step 2: Register the route in `amplify/backend.ts`**

Find the line `const courseMyGroupsPath = courseItemPath.addResource("my-groups");` and immediately after `courseMyGroupsPath.addMethod("GET", ...);` add:

```typescript
const courseGroupAssignmentsPath = courseItemPath.addResource("group-assignments");
courseGroupAssignmentsPath.addMethod("GET", courseLambdaIntegration, cognitoMethodOptions);
```

- [ ] **Step 3: TypeScript-check**

Run: `npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add amplify/functions/course-function/handler.ts amplify/backend.ts
git commit -m "feat(course): faculty endpoint to list course group assignments"
```

---

# Phase 2 — API wrappers (frontend)

## Task 3: Extend `surveyInstanceApi` with `getForStudent`

**Files:**
- Modify: `src/api/surveyInstanceApi.ts`

- [ ] **Step 1: Edit `src/api/surveyInstanceApi.ts`** — append a new method to the object:

```typescript
import { apiGet, apiPost, apiPut } from "./apiClient";

export interface SurveyInstanceRow {
  moduleItemId: string;
  studentUserId: string;
  surveyInstanceId: string;
  surveyTemplateId: string;
  courseId: string;
  schemaSnapshot?: any;
  answers?: Record<string, any>;
  status: "in_progress" | "submitted";
  startedAt?: string;
  submittedAt?: string;
  updatedAt?: string;
}

export const surveyInstanceApi = {
  getMine: (itemId: string) => apiGet(`/module-items/${itemId}/survey-instance`),
  getForStudent: (itemId: string, studentUserId: string) =>
    apiGet<{ instance: SurveyInstanceRow | null }>(
      `/module-items/${itemId}/survey-instance`,
      { studentUserId }
    ),
  saveAnswers: (itemId: string, answers: Record<string, any>) =>
    apiPut(`/module-items/${itemId}/survey-instance`, { answers }),
  submit: (itemId: string) =>
    apiPost(`/module-items/${itemId}/survey-instance/submit`, {}),
  listByAssignment: (assignmentId: string) =>
    apiGet(`/assignments/${assignmentId}/survey-instances`),
};
```

- [ ] **Step 2: TypeScript-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/surveyInstanceApi.ts
git commit -m "feat(api): surveyInstanceApi.getForStudent for faculty drilldown"
```

---

## Task 4: Extend `groupAssignmentApi` with `listForCourse`

**Files:**
- Modify: `src/api/groupAssignmentApi.ts`

- [ ] **Step 1: Edit `src/api/groupAssignmentApi.ts`**

Replace the entire file with:

```typescript
import { apiGet } from "./apiClient";

export interface GroupAssignmentRow {
  scopeKey: string;
  groupKey: string;
  assignedByItemId?: string;
  assignedAt?: string;
}

export interface CourseGroupAssignmentRow extends GroupAssignmentRow {
  courseId: string;
  studentUserId: string;
}

export const groupAssignmentApi = {
  getMine: (courseId: string) =>
    apiGet<{ groups: GroupAssignmentRow[] }>(`/courses/${courseId}/my-groups`),
  listForCourse: (courseId: string) =>
    apiGet<{ assignments: CourseGroupAssignmentRow[] }>(
      `/courses/${courseId}/group-assignments`
    ),
};
```

- [ ] **Step 2: TypeScript-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/groupAssignmentApi.ts
git commit -m "feat(api): groupAssignmentApi.listForCourse for faculty view"
```

---

# Phase 3 — Redux slices

## Task 5: Add course-scope cache to `consentSlice`

**Files:**
- Modify: `src/slices/consentSlice.ts`
- Create: `src/slices/consentSlice.test.ts`

- [ ] **Step 1: Write the failing selector test** at `src/slices/consentSlice.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  selectConsentDecisionsByStudent,
  selectLatestConsentByStudent,
} from "./consentSlice";

const state = {
  consent: {
    byItemId: {},
    loading: false,
    courseConsentsByCourse: {
      "course-1": [
        {
          consentItemId: "ci-1",
          studentUserId: "stu-A",
          courseId: "course-1",
          decision: "agreed",
          decidedAt: "2026-01-10T00:00:00Z",
          updatedAt: "2026-01-10T00:00:00Z",
        },
        {
          consentItemId: "ci-2",
          studentUserId: "stu-A",
          courseId: "course-1",
          decision: "declined",
          decidedAt: "2026-02-10T00:00:00Z",
          updatedAt: "2026-02-10T00:00:00Z",
        },
        {
          consentItemId: "ci-1",
          studentUserId: "stu-B",
          courseId: "course-1",
          decision: "agreed",
          decidedAt: "2026-01-11T00:00:00Z",
          updatedAt: "2026-01-11T00:00:00Z",
        },
      ],
    },
  },
};

describe("selectConsentDecisionsByStudent", () => {
  it("returns only decisions for the given student", () => {
    const result = selectConsentDecisionsByStudent("course-1", "stu-A")(state);
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.studentUserId === "stu-A")).toBe(true);
  });

  it("returns empty array when course is not cached", () => {
    expect(selectConsentDecisionsByStudent("course-x", "stu-A")(state)).toEqual([]);
  });
});

describe("selectLatestConsentByStudent", () => {
  it("returns the decision with the latest decidedAt", () => {
    const latest = selectLatestConsentByStudent("course-1", "stu-A")(state);
    expect(latest?.consentItemId).toBe("ci-2");
  });

  it("returns null when student has no decisions", () => {
    expect(selectLatestConsentByStudent("course-1", "stu-X")(state)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/slices/consentSlice.test.ts`
Expected: FAIL — `selectConsentDecisionsByStudent` / `selectLatestConsentByStudent` not exported.

- [ ] **Step 3: Update `src/slices/consentSlice.ts`** to support the course-scope cache. The new full file content (preserving existing exports):

```typescript
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { consentApi, type ConsentDecisionRow } from "../api/consentApi";

interface ConsentState {
  byItemId: Record<string, ConsentDecisionRow | null>;
  courseConsentsByCourse: Record<string, ConsentDecisionRow[]>;
  loading: boolean;
}

const initialState: ConsentState = {
  byItemId: {},
  courseConsentsByCourse: {},
  loading: false,
};

export const fetchMyConsent = createAsyncThunk(
  "consent/fetchMine",
  async (itemId: string) => ({
    itemId,
    ...(await consentApi.getMine(itemId)),
  })
);

export const fetchCourseConsents = createAsyncThunk(
  "consent/fetchCourseConsents",
  async (courseId: string) => ({
    courseId,
    ...(await consentApi.listForCourse(courseId)),
  })
);

const slice = createSlice({
  name: "consent",
  initialState,
  reducers: {},
  extraReducers: (b) =>
    b
      .addCase(fetchMyConsent.fulfilled, (s, a: any) => {
        s.byItemId[a.payload.itemId] = a.payload.decision || null;
      })
      .addCase(fetchCourseConsents.fulfilled, (s, a: any) => {
        s.courseConsentsByCourse[a.payload.courseId] = a.payload.decisions || [];
      }),
});

export const selectMyConsentDecision = (itemId: string) => (s: any) =>
  s.consent.byItemId[itemId] as ConsentDecisionRow | null | undefined;

export const selectConsentDecisionsByStudent =
  (courseId: string, studentUserId: string) =>
  (s: any): ConsentDecisionRow[] => {
    const rows: ConsentDecisionRow[] =
      s.consent.courseConsentsByCourse[courseId] || [];
    return rows.filter((r) => r.studentUserId === studentUserId);
  };

export const selectLatestConsentByStudent =
  (courseId: string, studentUserId: string) =>
  (s: any): ConsentDecisionRow | null => {
    const rows = selectConsentDecisionsByStudent(courseId, studentUserId)(s);
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))[0];
  };

export default slice.reducer;
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/slices/consentSlice.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/slices/consentSlice.ts src/slices/consentSlice.test.ts
git commit -m "feat(consent): course-scoped decisions cache for faculty list view"
```

---

## Task 6: Add course-scope cache to `groupAssignmentSlice`

**Files:**
- Modify: `src/slices/groupAssignmentSlice.ts`
- Create: `src/slices/groupAssignmentSlice.test.ts`

- [ ] **Step 1: Write the failing selector test** at `src/slices/groupAssignmentSlice.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { selectCourseGroupForStudent } from "./groupAssignmentSlice";

const state = {
  groupAssignment: {
    byCourseId: {},
    courseGroupsByCourse: {
      "course-1": [
        {
          courseId: "course-1",
          studentUserId: "stu-A",
          scopeKey: "course-1",
          groupKey: "A",
          assignedAt: "2026-01-10T00:00:00Z",
        },
        {
          courseId: "course-1",
          studentUserId: "stu-A",
          scopeKey: "module-7",
          groupKey: "X",
          assignedAt: "2026-01-12T00:00:00Z",
        },
        {
          courseId: "course-1",
          studentUserId: "stu-B",
          scopeKey: "course-1",
          groupKey: "B",
          assignedAt: "2026-01-11T00:00:00Z",
        },
      ],
    },
    loading: false,
  },
};

describe("selectCourseGroupForStudent", () => {
  it("returns the course-scope assignment for the student", () => {
    const r = selectCourseGroupForStudent("course-1", "stu-A")(state);
    expect(r?.groupKey).toBe("A");
    expect(r?.scopeKey).toBe("course-1");
  });

  it("ignores non-course-scope assignments", () => {
    const r = selectCourseGroupForStudent("course-1", "stu-A")(state);
    expect(r?.scopeKey).not.toBe("module-7");
  });

  it("returns null when student has no course-scope row", () => {
    expect(selectCourseGroupForStudent("course-1", "stu-X")(state)).toBeNull();
  });

  it("returns null when course is not cached", () => {
    expect(selectCourseGroupForStudent("course-x", "stu-A")(state)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/slices/groupAssignmentSlice.test.ts`
Expected: FAIL — `selectCourseGroupForStudent` not exported.

- [ ] **Step 3: Update `src/slices/groupAssignmentSlice.ts`** to the new full content:

```typescript
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import {
  groupAssignmentApi,
  type GroupAssignmentRow,
  type CourseGroupAssignmentRow,
} from "../api/groupAssignmentApi";

interface GroupAssignmentState {
  byCourseId: Record<string, GroupAssignmentRow[]>;
  courseGroupsByCourse: Record<string, CourseGroupAssignmentRow[]>;
  loading: boolean;
}

const initialState: GroupAssignmentState = {
  byCourseId: {},
  courseGroupsByCourse: {},
  loading: false,
};

export const fetchMyGroups = createAsyncThunk(
  "groupAssignment/fetchMy",
  async (courseId: string) => ({
    courseId,
    ...(await groupAssignmentApi.getMine(courseId)),
  })
);

export const fetchCourseGroups = createAsyncThunk(
  "groupAssignment/fetchCourse",
  async (courseId: string) => ({
    courseId,
    ...(await groupAssignmentApi.listForCourse(courseId)),
  })
);

const slice = createSlice({
  name: "groupAssignment",
  initialState,
  reducers: {},
  extraReducers: (b) =>
    b
      .addCase(fetchMyGroups.pending, (s) => {
        s.loading = true;
      })
      .addCase(fetchMyGroups.fulfilled, (s, a: any) => {
        s.loading = false;
        s.byCourseId[a.payload.courseId] = a.payload.groups || [];
      })
      .addCase(fetchMyGroups.rejected, (s) => {
        s.loading = false;
      })
      .addCase(fetchCourseGroups.fulfilled, (s, a: any) => {
        s.courseGroupsByCourse[a.payload.courseId] = a.payload.assignments || [];
      }),
});

export const selectMyGroupsForCourse = (courseId: string) => (s: any) =>
  (s.groupAssignment.byCourseId[courseId] as GroupAssignmentRow[]) || [];

export const selectCourseGroupForStudent =
  (courseId: string, studentUserId: string) =>
  (s: any): CourseGroupAssignmentRow | null => {
    const rows: CourseGroupAssignmentRow[] =
      s.groupAssignment.courseGroupsByCourse[courseId] || [];
    return (
      rows.find(
        (r) => r.studentUserId === studentUserId && r.scopeKey === courseId
      ) || null
    );
  };

export default slice.reducer;
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/slices/groupAssignmentSlice.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/slices/groupAssignmentSlice.ts src/slices/groupAssignmentSlice.test.ts
git commit -m "feat(groupAssignment): course-scoped cache + selector for faculty list view"
```

---

# Phase 4 — Display helpers

## Task 7: Pure helpers for badge props

**Files:**
- Create: `src/portals/faculty/courses/studentProgressDisplay.ts`
- Create: `src/portals/faculty/courses/studentProgressDisplay.test.ts`

**Goal:** Pure functions converting consent / group / progress data into display props. Keeps tests free of React/Mantine.

- [ ] **Step 1: Write the failing tests** at `src/portals/faculty/courses/studentProgressDisplay.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  consentBadgeProps,
  groupBadgeProps,
  progressStateBadgeProps,
} from "./studentProgressDisplay";

describe("consentBadgeProps", () => {
  it("renders 'agreed' as filled terracotta", () => {
    const p = consentBadgeProps({ decision: "agreed" } as any);
    expect(p).toEqual({ label: "agreed", color: "terracotta", variant: "filled" });
  });

  it("renders 'declined' as outline terracotta", () => {
    const p = consentBadgeProps({ decision: "declined" } as any);
    expect(p).toEqual({ label: "declined", color: "terracotta", variant: "outline" });
  });

  it("renders dash when null", () => {
    expect(consentBadgeProps(null)).toEqual({
      label: "—",
      color: "parchment",
      variant: "light",
    });
  });
});

describe("groupBadgeProps", () => {
  it("renders groupKey when present", () => {
    expect(groupBadgeProps({ groupKey: "A" } as any)).toEqual({
      label: "A",
      color: "terracotta",
      variant: "light",
    });
  });

  it("renders dash when null", () => {
    expect(groupBadgeProps(null)).toEqual({
      label: "—",
      color: "parchment",
      variant: "light",
    });
  });
});

describe("progressStateBadgeProps", () => {
  it("renders 'completed' as filled terracotta", () => {
    expect(progressStateBadgeProps({ state: "completed" } as any)).toMatchObject({
      label: "completed",
      color: "terracotta",
      variant: "filled",
    });
  });

  it("renders 'in_progress' as light terracotta", () => {
    expect(progressStateBadgeProps({ state: "in_progress" } as any)).toMatchObject({
      label: "in progress",
    });
  });

  it("renders 'locked' as outline parchment", () => {
    expect(progressStateBadgeProps({ state: "locked" } as any)).toMatchObject({
      label: "locked",
      color: "parchment",
    });
  });

  it("renders 'not started' for null progress", () => {
    expect(progressStateBadgeProps(null)).toMatchObject({
      label: "not started",
      color: "parchment",
      variant: "outline",
    });
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/portals/faculty/courses/studentProgressDisplay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/portals/faculty/courses/studentProgressDisplay.ts`**:

```typescript
import type { ConsentDecisionRow } from "../../../api/consentApi";
import type { CourseGroupAssignmentRow } from "../../../api/groupAssignmentApi";
import type { StudentItemProgress } from "../../../slices/studentProgressSlice";

export interface BadgeDisplay {
  label: string;
  color: string;
  variant: "filled" | "light" | "outline";
}

export function consentBadgeProps(
  decision: ConsentDecisionRow | null
): BadgeDisplay {
  if (!decision)
    return { label: "—", color: "parchment", variant: "light" };
  if (decision.decision === "agreed")
    return { label: "agreed", color: "terracotta", variant: "filled" };
  return { label: "declined", color: "terracotta", variant: "outline" };
}

export function groupBadgeProps(
  assignment: CourseGroupAssignmentRow | null
): BadgeDisplay {
  if (!assignment)
    return { label: "—", color: "parchment", variant: "light" };
  return { label: assignment.groupKey, color: "terracotta", variant: "light" };
}

export function progressStateBadgeProps(
  progress: StudentItemProgress | null | undefined
): BadgeDisplay {
  if (!progress)
    return { label: "not started", color: "parchment", variant: "outline" };
  switch (progress.state) {
    case "completed":
      return { label: "completed", color: "terracotta", variant: "filled" };
    case "in_progress":
      return { label: "in progress", color: "terracotta", variant: "light" };
    case "unlocked":
      return { label: "unlocked", color: "parchment", variant: "light" };
    case "locked":
    default:
      return { label: "locked", color: "parchment", variant: "outline" };
  }
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/portals/faculty/courses/studentProgressDisplay.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/portals/faculty/courses/studentProgressDisplay.ts src/portals/faculty/courses/studentProgressDisplay.test.ts
git commit -m "feat(faculty): pure helpers for consent/group/progress badges"
```

---

# Phase 5 — List view: Student Progress tab

## Task 8: Rename the tab and rework the table

**Files:**
- Modify: `src/portals/faculty/courses/CourseEditorPage.tsx`

**Goal:** Tab label `Students` → `Student Progress`. Table columns become `Student | Consent | Group | Enrolled | Actions`. New thunks dispatched on tab mount. Student row navigates to detail page.

- [ ] **Step 1: Update imports** at the top of `src/portals/faculty/courses/CourseEditorPage.tsx`.

a) Add `Anchor` to the existing `@mantine/core` import line (currently `Box, Tabs, Title, Group, Badge, Button, Loader, Stack, TextInput, Textarea, Card, Text, ActionIcon, Table, Menu, Switch`).

b) Add three new import lines below the existing slice/util imports:

```typescript
import { fetchCourseConsents, selectLatestConsentByStudent } from "../../../slices/consentSlice";
import { fetchCourseGroups, selectCourseGroupForStudent } from "../../../slices/groupAssignmentSlice";
import {
  consentBadgeProps,
  groupBadgeProps,
} from "./studentProgressDisplay";
```

- [ ] **Step 2: Rename the tab label** (around line 165-167):

Replace:

```tsx
          <Tabs.Tab value="students" leftSection={<IconUsers size={14} />}>
            Students ({enrollments.filter((e) => e.status === "active").length})
          </Tabs.Tab>
```

with:

```tsx
          <Tabs.Tab value="students" leftSection={<IconUsers size={14} />}>
            Student Progress ({enrollments.filter((e) => e.status === "active").length})
          </Tabs.Tab>
```

- [ ] **Step 3: Replace the `StudentsTab` component** (function `StudentsTab` near line 383) with the new implementation. Find the existing `function StudentsTab(...)` and replace its entire body with:

```tsx
function StudentsTab({ courseId, enrollments }: { courseId: string; enrollments: any[] }) {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    dispatch(fetchCourseConsents(courseId));
    dispatch(fetchCourseGroups(courseId));
  }, [dispatch, courseId]);

  const handleAdd = async () => {
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      const res: any = await dispatch(
        enrollStudents({ courseId, emails: [newEmail.trim()] })
      ).unwrap();
      const results: Array<{ email: string; status: string; reason?: string }> =
        res?.results || [];
      const enrolled = results.filter((r) => r.status === "enrolled");
      const notFound = results.filter((r) => r.status === "not_found");
      if (enrolled.length > 0) {
        notify.success(
          `Enrolled: ${enrolled.map((r) => r.email).join(", ")}`,
          "Student added"
        );
        setNewEmail("");
        dispatch(fetchEnrollments(courseId));
      } else if (notFound.length > 0) {
        notify.error(
          notFound
            .map((r) => `${r.email}: ${r.reason || "not found"}`)
            .join(" | "),
          "Enrollment failed"
        );
      } else {
        notify.warn(
          `Server responded but no student was enrolled. Raw: ${JSON.stringify(results)}`,
          "Enrollment unclear"
        );
      }
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Enrollment failed");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Stack gap="md">
      <Card withBorder>
        <Group>
          <Box style={{ flex: 1 }}>
            <EmailTypeaheadInput
              roleFilter="student"
              placeholder="student@example.com"
              value={newEmail}
              onChange={setNewEmail}
            />
          </Box>
          <Button onClick={handleAdd} loading={adding} disabled={!newEmail.trim()}>
            <IconPlus size={14} /> Enroll
          </Button>
        </Group>
      </Card>

      {enrollments.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">No students enrolled yet.</Text>
        </Card>
      ) : (
        <Table withTableBorder highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Student</Table.Th>
              <Table.Th>Consent</Table.Th>
              <Table.Th>Group</Table.Th>
              <Table.Th>Enrolled</Table.Th>
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {enrollments.map((e) => (
              <StudentProgressRow
                key={e.studentUserId}
                courseId={courseId}
                enrollment={e}
                onView={(sid) =>
                  navigate(`/faculty/courses/${courseId}/students/${sid}`)
                }
              />
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function StudentProgressRow({
  courseId,
  enrollment,
  onView,
}: {
  courseId: string;
  enrollment: any;
  onView: (studentUserId: string) => void;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const consent = useSelector(
    selectLatestConsentByStudent(courseId, enrollment.studentUserId)
  );
  const group = useSelector(
    selectCourseGroupForStudent(courseId, enrollment.studentUserId)
  );
  const cb = consentBadgeProps(consent);
  const gb = groupBadgeProps(group);
  const label = enrollment.studentEmail || enrollment.studentUserId;

  return (
    <Table.Tr>
      <Table.Td
        style={{ cursor: "pointer" }}
        onClick={() => onView(enrollment.studentUserId)}
      >
        <Anchor component="span">{label}</Anchor>
      </Table.Td>
      <Table.Td>
        <Badge color={cb.color} variant={cb.variant}>
          {cb.label}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Badge color={gb.color} variant={gb.variant}>
          {gb.label}
        </Badge>
      </Table.Td>
      <Table.Td>{new Date(enrollment.enrolledAt).toLocaleDateString()}</Table.Td>
      <Table.Td>
        <Group gap={4} justify="flex-end">
          <Button
            size="xs"
            variant="light"
            onClick={() => onView(enrollment.studentUserId)}
          >
            View detail
          </Button>
          <ActionIcon
            color="terracotta"
            variant="subtle"
            onClick={async () => {
              try {
                await dispatch(
                  unenrollStudent({
                    courseId,
                    studentUserId: enrollment.studentUserId,
                  })
                ).unwrap();
                notify.success("Student removed");
              } catch (err: any) {
                notify.error(
                  err?.message || "unknown error",
                  "Failed to remove student"
                );
              }
            }}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}
```

- [ ] **Step 4: TypeScript-check + lint**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

Run: `npx eslint src/portals/faculty/courses/CourseEditorPage.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/portals/faculty/courses/CourseEditorPage.tsx
git commit -m "feat(faculty): Student Progress tab with consent/group columns + detail nav"
```

---

# Phase 6 — Detail page scaffolding

## Task 9: Register the route

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Find the existing faculty routes block** (search for `path="courses/:courseId/reviews"`).

- [ ] **Step 2: Insert the new route** immediately after the courseId route. Add:

```tsx
        <Route
          path="courses/:courseId/students/:studentUserId"
          element={<StudentCourseDetailPage />}
        />
```

Then add the import at the top of `src/App.tsx` alongside other faculty page imports:

```tsx
import StudentCourseDetailPage from "./portals/faculty/courses/StudentCourseDetailPage";
```

- [ ] **Step 3: Create a placeholder page** at `src/portals/faculty/courses/StudentCourseDetailPage.tsx` so the import resolves:

```tsx
import { Box, Title } from "@mantine/core";

export default function StudentCourseDetailPage() {
  return (
    <Box p="md">
      <Title order={2}>Student Detail (scaffolding)</Title>
    </Box>
  );
}
```

- [ ] **Step 4: TypeScript-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/portals/faculty/courses/StudentCourseDetailPage.tsx
git commit -m "feat(faculty): register student-detail route + placeholder page"
```

---

## Task 10: StudentSummaryCard component + tests

**Files:**
- Create: `src/portals/faculty/courses/components/StudentSummaryCard.tsx`
- Create: `src/portals/faculty/courses/components/StudentSummaryCard.test.tsx`

- [ ] **Step 1: Write the failing test** at `src/portals/faculty/courses/components/StudentSummaryCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudentSummaryCard } from "./StudentSummaryCard";
import { MantineTestWrapper } from "../../../../test-utils/renderWithMantine";

const consent = {
  consentItemId: "ci-1",
  studentUserId: "stu-A",
  courseId: "c-1",
  decision: "agreed" as const,
  consentVersion: "v1",
  decidedAt: "2026-01-10T00:00:00Z",
  updatedAt: "2026-01-10T00:00:00Z",
};
const group = {
  courseId: "c-1",
  studentUserId: "stu-A",
  scopeKey: "c-1",
  groupKey: "A",
  assignedAt: "2026-01-10T00:00:00Z",
};
const enrollment = {
  studentUserId: "stu-A",
  studentEmail: "alice@example.com",
  enrolledAt: "2026-01-09T00:00:00Z",
  status: "active",
};

function Harness(props: any) {
  return (
    <MantineTestWrapper>
      <StudentSummaryCard {...props} />
    </MantineTestWrapper>
  );
}

describe("StudentSummaryCard", () => {
  it("shows email, consent, and group info", () => {
    render(
      <Harness
        enrollment={enrollment}
        consentDecisions={[consent]}
        groupAssignments={[group]}
      />
    );
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("agreed")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("shows fallback copy when no consent rows", () => {
    render(
      <Harness
        enrollment={enrollment}
        consentDecisions={[]}
        groupAssignments={[]}
      />
    );
    expect(screen.getByText(/no consent decisions/i)).toBeInTheDocument();
    expect(screen.getByText(/no group assignment/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/portals/faculty/courses/components/StudentSummaryCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/portals/faculty/courses/components/StudentSummaryCard.tsx`**:

```tsx
import { Card, Stack, Text, Group, Badge } from "@mantine/core";
import type { ConsentDecisionRow } from "../../../../api/consentApi";
import type { CourseGroupAssignmentRow } from "../../../../api/groupAssignmentApi";

interface Props {
  enrollment: {
    studentUserId: string;
    studentEmail?: string;
    enrolledAt: string;
    status: string;
  };
  consentDecisions: ConsentDecisionRow[];
  groupAssignments: CourseGroupAssignmentRow[];
}

export function StudentSummaryCard({
  enrollment,
  consentDecisions,
  groupAssignments,
}: Props) {
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text>
          <b>Email:</b> {enrollment.studentEmail || "(unknown)"}
        </Text>
        <Text size="sm" c="dimmed">
          <b>User ID:</b> {enrollment.studentUserId}
        </Text>
        <Text>
          <b>Enrolled:</b>{" "}
          {new Date(enrollment.enrolledAt).toLocaleDateString()} ({enrollment.status})
        </Text>

        <Text mt="xs" fw={600}>
          Consent
        </Text>
        {consentDecisions.length === 0 ? (
          <Text size="sm" c="dimmed">
            No consent decisions on file.
          </Text>
        ) : (
          consentDecisions.map((d) => (
            <Group key={d.consentItemId} gap="xs">
              <Badge
                color="terracotta"
                variant={d.decision === "agreed" ? "filled" : "outline"}
              >
                {d.decision}
              </Badge>
              {d.consentVersion && (
                <Text size="sm">{d.consentVersion}</Text>
              )}
              <Text size="sm" c="dimmed">
                {new Date(d.decidedAt).toLocaleString()}
              </Text>
            </Group>
          ))
        )}

        <Text mt="xs" fw={600}>
          Group assignment
        </Text>
        {groupAssignments.length === 0 ? (
          <Text size="sm" c="dimmed">
            No group assignment yet.
          </Text>
        ) : (
          groupAssignments.map((g) => (
            <Group key={`${g.scopeKey}-${g.studentUserId}`} gap="xs">
              <Badge color="terracotta" variant="light">
                {g.groupKey}
              </Badge>
              <Text size="sm" c="dimmed">
                scope: {g.scopeKey}
                {g.assignedAt
                  ? ` • ${new Date(g.assignedAt).toLocaleString()}`
                  : ""}
              </Text>
            </Group>
          ))
        )}
      </Stack>
    </Card>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/portals/faculty/courses/components/StudentSummaryCard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/portals/faculty/courses/components/StudentSummaryCard.tsx src/portals/faculty/courses/components/StudentSummaryCard.test.tsx
git commit -m "feat(faculty): StudentSummaryCard with consent + group breakdown"
```

---

# Phase 7 — Per-itemType drilldowns

## Task 11: GenericItemDetail

**Files:**
- Create: `src/portals/faculty/courses/components/itemDetails/GenericItemDetail.tsx`
- Create: `src/portals/faculty/courses/components/itemDetails/GenericItemDetail.test.tsx`

- [ ] **Step 1: Write the failing test**:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GenericItemDetail } from "./GenericItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

function Harness(props: any) {
  return (
    <MantineTestWrapper>
      <GenericItemDetail {...props} />
    </MantineTestWrapper>
  );
}

describe("GenericItemDetail", () => {
  it("shows completed timestamp when progress.completedAt set", () => {
    render(
      <Harness
        progress={{
          state: "completed",
          completedAt: "2026-03-01T12:00:00Z",
        }}
      />
    );
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("shows 'not completed' when no progress", () => {
    render(<Harness progress={null} />);
    expect(screen.getByText(/not completed/i)).toBeInTheDocument();
  });

  it("renders extra note when provided", () => {
    render(<Harness progress={null} note="Group shown in summary above" />);
    expect(screen.getByText(/Group shown in summary/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/portals/faculty/courses/components/itemDetails/GenericItemDetail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**:

```tsx
import { Stack, Text } from "@mantine/core";
import type { StudentItemProgress } from "../../../../../slices/studentProgressSlice";

interface Props {
  progress: StudentItemProgress | null | undefined;
  note?: string;
}

export function GenericItemDetail({ progress, note }: Props) {
  return (
    <Stack gap={4}>
      {progress?.completedAt ? (
        <Text size="sm">
          Completed at {new Date(progress.completedAt).toLocaleString()}.
        </Text>
      ) : (
        <Text size="sm" c="dimmed">
          Not completed yet.
        </Text>
      )}
      {note && (
        <Text size="sm" c="dimmed" fs="italic">
          {note}
        </Text>
      )}
    </Stack>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/portals/faculty/courses/components/itemDetails/GenericItemDetail.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/portals/faculty/courses/components/itemDetails/GenericItemDetail.tsx src/portals/faculty/courses/components/itemDetails/GenericItemDetail.test.tsx
git commit -m "feat(faculty): GenericItemDetail for completion-only item types"
```

---

## Task 12: ConsentItemDetail

**Files:**
- Create: `src/portals/faculty/courses/components/itemDetails/ConsentItemDetail.tsx`
- Create: `src/portals/faculty/courses/components/itemDetails/ConsentItemDetail.test.tsx`

- [ ] **Step 1: Write the failing test**:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConsentItemDetail } from "./ConsentItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

function Harness(props: any) {
  return (
    <MantineTestWrapper>
      <ConsentItemDetail {...props} />
    </MantineTestWrapper>
  );
}

const decision = {
  consentItemId: "ci-1",
  studentUserId: "stu-A",
  courseId: "c-1",
  decision: "agreed" as const,
  consentVersion: "v2",
  decidedAt: "2026-01-10T00:00:00Z",
  updatedAt: "2026-01-10T00:00:00Z",
};

describe("ConsentItemDetail", () => {
  it("renders decision, version, and date", () => {
    render(<Harness itemId="ci-1" decisions={[decision]} />);
    expect(screen.getByText("agreed")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("renders 'no decision yet' when missing", () => {
    render(<Harness itemId="ci-99" decisions={[]} />);
    expect(screen.getByText(/no decision yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/portals/faculty/courses/components/itemDetails/ConsentItemDetail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Create the component**:

```tsx
import { Group, Badge, Text, Stack } from "@mantine/core";
import type { ConsentDecisionRow } from "../../../../../api/consentApi";

interface Props {
  itemId: string;
  decisions: ConsentDecisionRow[];
}

export function ConsentItemDetail({ itemId, decisions }: Props) {
  const row = decisions.find((d) => d.consentItemId === itemId) || null;
  if (!row) {
    return (
      <Text size="sm" c="dimmed">
        No decision yet.
      </Text>
    );
  }
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Badge
          color="terracotta"
          variant={row.decision === "agreed" ? "filled" : "outline"}
        >
          {row.decision}
        </Badge>
        {row.consentVersion && <Text size="sm">{row.consentVersion}</Text>}
      </Group>
      <Text size="sm" c="dimmed">
        Decided at {new Date(row.decidedAt).toLocaleString()}
      </Text>
    </Stack>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/portals/faculty/courses/components/itemDetails/ConsentItemDetail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/portals/faculty/courses/components/itemDetails/ConsentItemDetail.tsx src/portals/faculty/courses/components/itemDetails/ConsentItemDetail.test.tsx
git commit -m "feat(faculty): ConsentItemDetail drilldown"
```

---

## Task 13: SurveyItemDetail

**Files:**
- Create: `src/portals/faculty/courses/components/itemDetails/SurveyItemDetail.tsx`
- Create: `src/portals/faculty/courses/components/itemDetails/SurveyItemDetail.test.tsx`

- [ ] **Step 1: Write the failing test**:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SurveyItemDetail } from "./SurveyItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

vi.mock("../../../../../api/surveyInstanceApi", () => ({
  surveyInstanceApi: {
    getForStudent: vi.fn(),
  },
}));

import { surveyInstanceApi } from "../../../../../api/surveyInstanceApi";

function Harness(props: any) {
  return (
    <MantineTestWrapper>
      <SurveyItemDetail {...props} />
    </MantineTestWrapper>
  );
}

beforeEach(() => {
  vi.mocked(surveyInstanceApi.getForStudent).mockReset();
});

describe("SurveyItemDetail", () => {
  it("renders submitted answers against schema snapshot", async () => {
    vi.mocked(surveyInstanceApi.getForStudent).mockResolvedValue({
      instance: {
        moduleItemId: "it-1",
        studentUserId: "stu-A",
        surveyInstanceId: "sv-1",
        surveyTemplateId: "tpl-1",
        courseId: "c-1",
        status: "submitted",
        submittedAt: "2026-02-01T00:00:00Z",
        schemaSnapshot: {
          questions: [{ id: "q1", prompt: "How do you feel?" }],
        },
        answers: { q1: "Great" },
      },
    } as any);

    render(<Harness itemId="it-1" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText(/How do you feel/)).toBeInTheDocument()
    );
    expect(screen.getByText("Great")).toBeInTheDocument();
    expect(screen.getByText(/submitted/i)).toBeInTheDocument();
  });

  it("renders 'Not started' when instance is null", async () => {
    vi.mocked(surveyInstanceApi.getForStudent).mockResolvedValue({
      instance: null,
    } as any);
    render(<Harness itemId="it-2" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText(/Not started/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/portals/faculty/courses/components/itemDetails/SurveyItemDetail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Create the component**:

```tsx
import { useEffect, useState } from "react";
import { Stack, Text, Loader, Card, Group, Badge } from "@mantine/core";
import {
  surveyInstanceApi,
  type SurveyInstanceRow,
} from "../../../../../api/surveyInstanceApi";

interface Props {
  itemId: string;
  studentUserId: string;
}

export function SurveyItemDetail({ itemId, studentUserId }: Props) {
  const [loading, setLoading] = useState(true);
  const [instance, setInstance] = useState<SurveyInstanceRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    surveyInstanceApi
      .getForStudent(itemId, studentUserId)
      .then((res: any) => {
        if (!cancelled) setInstance(res?.instance ?? null);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Failed to load survey");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, studentUserId]);

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="terracotta">{error}</Text>;
  if (!instance)
    return (
      <Text size="sm" c="dimmed">
        Not started.
      </Text>
    );

  const questions: Array<{ id: string; prompt: string }> =
    instance.schemaSnapshot?.questions || [];
  const answers = instance.answers || {};

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Badge
          color="terracotta"
          variant={instance.status === "submitted" ? "filled" : "light"}
        >
          {instance.status}
        </Badge>
        {instance.submittedAt && (
          <Text size="xs" c="dimmed">
            submitted {new Date(instance.submittedAt).toLocaleString()}
          </Text>
        )}
      </Group>

      {questions.length === 0 ? (
        <Text size="sm" c="dimmed">
          No questions in snapshot.
        </Text>
      ) : (
        questions.map((q) => (
          <Card key={q.id} withBorder p="xs">
            <Text size="sm" fw={500}>
              {q.prompt}
            </Text>
            <Text size="sm" mt={2}>
              {formatAnswer(answers[q.id])}
            </Text>
          </Card>
        ))
      )}
    </Stack>
  );
}

function formatAnswer(value: unknown): string {
  if (value == null || value === "") return "(no answer)";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/portals/faculty/courses/components/itemDetails/SurveyItemDetail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/portals/faculty/courses/components/itemDetails/SurveyItemDetail.tsx src/portals/faculty/courses/components/itemDetails/SurveyItemDetail.test.tsx
git commit -m "feat(faculty): SurveyItemDetail with lazy fetch of instance"
```

---

## Task 14: AssignmentItemDetail

**Files:**
- Create: `src/portals/faculty/courses/components/itemDetails/AssignmentItemDetail.tsx`
- Create: `src/portals/faculty/courses/components/itemDetails/AssignmentItemDetail.test.tsx`

- [ ] **Step 1: Write the failing test**:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AssignmentItemDetail } from "./AssignmentItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

vi.mock("../../../../../api/moduleItemApi", () => ({
  moduleItemApi: {
    getBestSession: vi.fn(),
  },
}));
import { moduleItemApi } from "../../../../../api/moduleItemApi";

function Harness(props: any) {
  return (
    <MantineTestWrapper>
      <AssignmentItemDetail {...props} />
    </MantineTestWrapper>
  );
}

beforeEach(() => {
  vi.mocked(moduleItemApi.getBestSession).mockReset();
});

describe("AssignmentItemDetail", () => {
  it("renders score, evaluation, and transcript", async () => {
    vi.mocked(moduleItemApi.getBestSession).mockResolvedValue({
      session: {
        sessionId: "s-1",
        attemptNo: 2,
        startedAt: "2026-02-01T10:00:00Z",
        endedAt: "2026-02-01T10:10:00Z",
        status: "completed",
      },
      turns: [
        { turnIndex: 0, userText: "Hi", modelText: "Hello" },
        { turnIndex: 1, userText: "How are you", modelText: "Fine" },
      ],
      evaluation: { totalScore: 18, overallExplanation: "Solid attempt" },
    } as any);

    render(
      <Harness itemId="it-1" studentUserId="stu-A" courseId="c-1" />
    );
    await waitFor(() =>
      expect(screen.getByText(/Solid attempt/)).toBeInTheDocument()
    );
    expect(screen.getByText(/18\/24/)).toBeInTheDocument();
    expect(screen.getByText("Hi")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders 'No completed attempt yet' when session null", async () => {
    vi.mocked(moduleItemApi.getBestSession).mockResolvedValue({
      session: null,
    } as any);
    render(
      <Harness itemId="it-2" studentUserId="stu-A" courseId="c-1" />
    );
    await waitFor(() =>
      expect(screen.getByText(/No completed attempt yet/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/portals/faculty/courses/components/itemDetails/AssignmentItemDetail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Create the component**:

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Stack,
  Text,
  Loader,
  Badge,
  Group,
  Card,
  Button,
  Box,
} from "@mantine/core";
import { moduleItemApi } from "../../../../../api/moduleItemApi";

interface Props {
  itemId: string;
  studentUserId: string;
  courseId: string;
}

export function AssignmentItemDetail({
  itemId,
  studentUserId,
  courseId,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    moduleItemApi
      .getBestSession(itemId, studentUserId)
      .then((res: any) => {
        if (!cancelled) setData(res);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Failed to load session");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, studentUserId]);

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="terracotta">{error}</Text>;
  if (!data?.session)
    return (
      <Text size="sm" c="dimmed">
        No completed attempt yet.
      </Text>
    );

  const { session, turns = [], evaluation } = data;
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="xs">
          <Badge color="terracotta" variant="light">
            attempt #{session.attemptNo}
          </Badge>
          {evaluation?.totalScore != null && (
            <Badge color="terracotta" variant="filled">
              {evaluation.totalScore}/24
            </Badge>
          )}
        </Group>
        <Button
          size="xs"
          variant="light"
          onClick={() => navigate(`/faculty/courses/${courseId}/reviews`)}
        >
          Open in Review Board
        </Button>
      </Group>

      {evaluation?.overallExplanation && (
        <Card withBorder p="xs">
          <Text size="sm">{evaluation.overallExplanation}</Text>
        </Card>
      )}

      <Card withBorder p="xs">
        <Text size="sm" fw={500} mb={4}>
          Conversation ({turns.length} turns)
        </Text>
        <Stack gap={4} style={{ maxHeight: 280, overflowY: "auto" }}>
          {turns.map((t: any) => (
            <Box key={t.turnIndex}>
              <Text size="xs" c="dimmed">
                Turn {t.turnIndex}
              </Text>
              <Text size="sm">
                <b>Student:</b> {t.userText || "(silence)"}
              </Text>
              <Text size="sm">
                <b>Patient:</b> {t.modelText || "(silence)"}
              </Text>
            </Box>
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/portals/faculty/courses/components/itemDetails/AssignmentItemDetail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/portals/faculty/courses/components/itemDetails/AssignmentItemDetail.tsx src/portals/faculty/courses/components/itemDetails/AssignmentItemDetail.test.tsx
git commit -m "feat(faculty): AssignmentItemDetail with best-session transcript view"
```

---

## Task 15: AIDetectionItemDetail

**Files:**
- Create: `src/portals/faculty/courses/components/itemDetails/AIDetectionItemDetail.tsx`
- Create: `src/portals/faculty/courses/components/itemDetails/AIDetectionItemDetail.test.tsx`

- [ ] **Step 1: Write the failing test**:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AIDetectionItemDetail } from "./AIDetectionItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

vi.mock("../../../../../api/moduleItemApi", () => ({
  moduleItemApi: {
    getSubQuestions: vi.fn(),
  },
}));
import { moduleItemApi } from "../../../../../api/moduleItemApi";

function Harness(props: any) {
  return (
    <MantineTestWrapper>
      <AIDetectionItemDetail {...props} />
    </MantineTestWrapper>
  );
}

beforeEach(() => {
  vi.mocked(moduleItemApi.getSubQuestions).mockReset();
});

describe("AIDetectionItemDetail", () => {
  it("renders sub-questions with pick and follow-up", async () => {
    vi.mocked(moduleItemApi.getSubQuestions).mockResolvedValue({
      subQuestions: [
        {
          assignmentItemId: "ai-1",
          assignmentTitle: "Patient X",
          locked: false,
          missing: [],
          existingAnswer: {
            pickedDisplayKey: "B",
            followUpText: "Spoke too fast",
          },
        },
      ],
    } as any);

    render(<Harness itemId="it-1" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText("Patient X")).toBeInTheDocument()
    );
    expect(screen.getByText(/B/)).toBeInTheDocument();
    expect(screen.getByText(/Spoke too fast/)).toBeInTheDocument();
  });

  it("renders 'No sub-questions' on empty list", async () => {
    vi.mocked(moduleItemApi.getSubQuestions).mockResolvedValue({
      subQuestions: [],
    } as any);
    render(<Harness itemId="it-2" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText(/no sub-questions/i)).toBeInTheDocument()
    );
  });

  it("shows 'locked' badge when sub-question is locked", async () => {
    vi.mocked(moduleItemApi.getSubQuestions).mockResolvedValue({
      subQuestions: [
        {
          assignmentItemId: "ai-2",
          assignmentTitle: "Patient Y",
          locked: true,
          missing: ["assignment-z"],
          existingAnswer: null,
        },
      ],
    } as any);
    render(<Harness itemId="it-3" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText(/locked/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/portals/faculty/courses/components/itemDetails/AIDetectionItemDetail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Create the component**:

```tsx
import { useEffect, useState } from "react";
import {
  Stack,
  Text,
  Loader,
  Card,
  Group,
  Badge,
} from "@mantine/core";
import { moduleItemApi } from "../../../../../api/moduleItemApi";

interface SubQuestion {
  assignmentItemId: string;
  assignmentTitle: string;
  locked: boolean;
  missing?: string[];
  bestSessionId?: string;
  blindedFeedback?: any[];
  existingAnswer?: {
    pickedDisplayKey?: string;
    followUpText?: string;
  } | null;
}

interface Props {
  itemId: string;
  studentUserId: string;
}

export function AIDetectionItemDetail({ itemId, studentUserId }: Props) {
  const [loading, setLoading] = useState(true);
  const [subQuestions, setSubQuestions] = useState<SubQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    moduleItemApi
      .getSubQuestions(itemId, studentUserId)
      .then((res: any) => {
        if (!cancelled) setSubQuestions(res?.subQuestions || []);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, studentUserId]);

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="terracotta">{error}</Text>;
  if (subQuestions.length === 0)
    return (
      <Text size="sm" c="dimmed">
        No sub-questions yet.
      </Text>
    );

  return (
    <Stack gap="xs">
      {subQuestions.map((sq) => (
        <Card key={sq.assignmentItemId} withBorder p="xs">
          <Group gap="xs" mb={4}>
            <Text fw={500}>{sq.assignmentTitle}</Text>
            {sq.locked ? (
              <Badge color="parchment" variant="outline">
                locked
              </Badge>
            ) : (
              <Badge color="terracotta" variant="light">
                unlocked
              </Badge>
            )}
          </Group>
          {sq.locked && sq.missing && sq.missing.length > 0 && (
            <Text size="xs" c="dimmed">
              Missing: {sq.missing.join(", ")}
            </Text>
          )}
          {sq.existingAnswer ? (
            <>
              <Text size="sm">
                <b>Pick:</b> {sq.existingAnswer.pickedDisplayKey || "(none)"}
              </Text>
              {sq.existingAnswer.followUpText && (
                <Text size="sm">
                  <b>Follow-up:</b> {sq.existingAnswer.followUpText}
                </Text>
              )}
            </>
          ) : (
            <Text size="sm" c="dimmed">
              No answer recorded.
            </Text>
          )}
        </Card>
      ))}
    </Stack>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/portals/faculty/courses/components/itemDetails/AIDetectionItemDetail.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/portals/faculty/courses/components/itemDetails/AIDetectionItemDetail.tsx src/portals/faculty/courses/components/itemDetails/AIDetectionItemDetail.test.tsx
git commit -m "feat(faculty): AIDetectionItemDetail with sub-question drilldown"
```

---

# Phase 8 — Wiring the detail page

## Task 16: StudentModuleItemRow (expandable item card)

**Files:**
- Create: `src/portals/faculty/courses/components/StudentModuleItemRow.tsx`

This component does not get its own dedicated test file — it is exercised by the detail page integration test in Task 17. (Trade-off: keeps test surface small; the row is a thin compositional wrapper.)

- [ ] **Step 1: Create the component**:

```tsx
import { useState } from "react";
import {
  Card,
  Group,
  Badge,
  Text,
  Box,
  Collapse,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { StudentItemProgress } from "../../../../slices/studentProgressSlice";
import type { ConsentDecisionRow } from "../../../../api/consentApi";
import { progressStateBadgeProps } from "../studentProgressDisplay";
import { GenericItemDetail } from "./itemDetails/GenericItemDetail";
import { ConsentItemDetail } from "./itemDetails/ConsentItemDetail";
import { SurveyItemDetail } from "./itemDetails/SurveyItemDetail";
import { AssignmentItemDetail } from "./itemDetails/AssignmentItemDetail";
import { AIDetectionItemDetail } from "./itemDetails/AIDetectionItemDetail";

interface Props {
  item: {
    moduleItemId: string;
    itemType: string;
    title: string;
    position: number;
  };
  studentUserId: string;
  courseId: string;
  progress: StudentItemProgress | null | undefined;
  consentDecisions: ConsentDecisionRow[];
}

export function StudentModuleItemRow({
  item,
  studentUserId,
  courseId,
  progress,
  consentDecisions,
}: Props) {
  const [open, setOpen] = useState(false);
  const sb = progressStateBadgeProps(progress);
  const tooltipText = progress
    ? [
        progress.unlockedAt && `unlocked ${progress.unlockedAt}`,
        progress.startedAt && `started ${progress.startedAt}`,
        progress.completedAt && `completed ${progress.completedAt}`,
      ]
        .filter(Boolean)
        .join(" • ") || "(no timestamps)"
    : "no progress row";

  return (
    <Card withBorder mb={6}>
      <UnstyledButton
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%" }}
      >
        <Group justify="space-between">
          <Group gap="xs">
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            <Badge size="sm" color="parchment" variant="light">
              #{item.position + 1}
            </Badge>
            <Text fw={500}>{item.title}</Text>
            <Badge size="sm" color="parchment" variant="outline">
              {item.itemType}
            </Badge>
          </Group>
          <Tooltip label={tooltipText} withinPortal>
            <Badge color={sb.color} variant={sb.variant}>
              {sb.label}
            </Badge>
          </Tooltip>
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <Box mt="xs">{open && renderBody(item, studentUserId, courseId, progress, consentDecisions)}</Box>
      </Collapse>
    </Card>
  );
}

function renderBody(
  item: Props["item"],
  studentUserId: string,
  courseId: string,
  progress: StudentItemProgress | null | undefined,
  consentDecisions: ConsentDecisionRow[]
) {
  switch (item.itemType) {
    case "assignment":
      return (
        <AssignmentItemDetail
          itemId={item.moduleItemId}
          studentUserId={studentUserId}
          courseId={courseId}
        />
      );
    case "survey":
    case "debrief":
      return (
        <SurveyItemDetail
          itemId={item.moduleItemId}
          studentUserId={studentUserId}
        />
      );
    case "ai_detection":
      return (
        <AIDetectionItemDetail
          itemId={item.moduleItemId}
          studentUserId={studentUserId}
        />
      );
    case "consent":
      return (
        <ConsentItemDetail
          itemId={item.moduleItemId}
          decisions={consentDecisions}
        />
      );
    case "randomizer":
      return (
        <GenericItemDetail
          progress={progress}
          note="Resulting group assignment shown in summary above."
        />
      );
    default:
      return <GenericItemDetail progress={progress} />;
  }
}
```

- [ ] **Step 2: TypeScript-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/portals/faculty/courses/components/StudentModuleItemRow.tsx
git commit -m "feat(faculty): StudentModuleItemRow with lazy itemType-specific drilldown"
```

---

## Task 17: StudentCourseDetailPage — full implementation

**Files:**
- Modify: `src/portals/faculty/courses/StudentCourseDetailPage.tsx`

**Goal:** Replace the scaffolding with the full page (header, summary, modules accordion, item rows). Page-level data is fetched directly via API (not slice).

- [ ] **Step 1: Replace the file contents**:

```tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Box,
  Title,
  Anchor,
  Group,
  Text,
  Accordion,
  Loader,
  Stack,
} from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import type { AppDispatch } from "../../../store";
import {
  fetchCourse,
  selectCurrentCourse,
  fetchEnrollments,
  selectCurrentEnrollments,
} from "../../../slices/courseSlice";
import {
  fetchModules,
  selectModulesByCourse,
} from "../../../slices/moduleSlice";
import { fetchItems } from "../../../slices/moduleItemSlice";
import { consentApi, type ConsentDecisionRow } from "../../../api/consentApi";
import {
  groupAssignmentApi,
  type CourseGroupAssignmentRow,
} from "../../../api/groupAssignmentApi";
import { moduleItemApi } from "../../../api/moduleItemApi";
import type { StudentItemProgress } from "../../../slices/studentProgressSlice";
import { StudentSummaryCard } from "./components/StudentSummaryCard";
import { StudentModuleItemRow } from "./components/StudentModuleItemRow";

export default function StudentCourseDetailPage() {
  const { courseId, studentUserId } = useParams<{
    courseId: string;
    studentUserId: string;
  }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const course = useSelector(selectCurrentCourse);
  const enrollments = useSelector(selectCurrentEnrollments);
  const modules = useSelector(selectModulesByCourse(courseId || ""));
  const itemsByModule = useSelector((s: any) => s.moduleItems.byModuleId);

  const [consentDecisions, setConsentDecisions] = useState<ConsentDecisionRow[]>([]);
  const [groupAssignments, setGroupAssignments] = useState<CourseGroupAssignmentRow[]>([]);
  const [progressByItem, setProgressByItem] = useState<Record<string, StudentItemProgress | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bootstrap: course / modules / items.
  useEffect(() => {
    if (!courseId) return;
    dispatch(fetchCourse(courseId));
    dispatch(fetchEnrollments(courseId));
    dispatch(fetchModules(courseId));
  }, [dispatch, courseId]);

  useEffect(() => {
    for (const m of modules) {
      if (!itemsByModule[m.moduleId]) {
        dispatch(fetchItems(m.moduleId));
      }
    }
  }, [modules, itemsByModule, dispatch]);

  // Per-student bundle: consent + groups + per-item progress.
  useEffect(() => {
    if (!courseId || !studentUserId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [consentRes, groupRes] = await Promise.all([
          consentApi.listForCourse(courseId),
          groupAssignmentApi.listForCourse(courseId),
        ]);
        if (cancelled) return;
        setConsentDecisions(
          (consentRes.decisions || []).filter(
            (d: ConsentDecisionRow) => d.studentUserId === studentUserId
          )
        );
        setGroupAssignments(
          (groupRes.assignments || []).filter(
            (g: CourseGroupAssignmentRow) =>
              g.studentUserId === studentUserId
          )
        );
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to load student data");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, studentUserId]);

  // Fan-out: getProgress per item. Triggered once items load.
  useEffect(() => {
    if (!studentUserId) return;
    const allItemIds: string[] = [];
    for (const m of modules) {
      for (const it of itemsByModule[m.moduleId] || []) {
        allItemIds.push(it.moduleItemId);
      }
    }
    const missing = allItemIds.filter((id) => !(id in progressByItem));
    if (missing.length === 0) return;

    let cancelled = false;
    Promise.all(
      missing.map((id) =>
        moduleItemApi
          .getProgress(id, studentUserId)
          .then((r: any) => [id, r?.progress || null] as const)
          .catch(() => [id, null] as const)
      )
    ).then((entries) => {
      if (cancelled) return;
      setProgressByItem((prev) => {
        const next = { ...prev };
        for (const [id, val] of entries) next[id] = val;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [studentUserId, modules, itemsByModule, progressByItem]);

  const enrollment = enrollments.find(
    (e) => e.studentUserId === studentUserId
  );

  if (!course || !enrollment) {
    return (
      <Box p="md">
        <Loader />
      </Box>
    );
  }
  if (error) {
    return (
      <Box p="md">
        <Text c="terracotta">{error}</Text>
      </Box>
    );
  }

  return (
    <Box p="md">
      <Anchor
        onClick={() => navigate(`/faculty/courses/${courseId}?tab=students`)}
        mb="xs"
      >
        <Group gap={4}>
          <IconArrowLeft size={14} />
          <Text size="sm">Back to course</Text>
        </Group>
      </Anchor>
      <Title order={2} mb="md">
        {enrollment.studentEmail || studentUserId} — {course.title}
      </Title>

      <Stack gap="md">
        {loading ? (
          <Loader size="sm" />
        ) : (
          <StudentSummaryCard
            enrollment={enrollment}
            consentDecisions={consentDecisions}
            groupAssignments={groupAssignments}
          />
        )}

        {modules.length === 0 ? (
          <Text c="dimmed">This course has no modules yet.</Text>
        ) : (
          <Accordion
            multiple
            defaultValue={modules.map((m) => m.moduleId)}
            variant="separated"
          >
            {modules.map((m) => {
              const items = itemsByModule[m.moduleId] || [];
              return (
                <Accordion.Item key={m.moduleId} value={m.moduleId}>
                  <Accordion.Control>
                    <Group gap="xs">
                      <Text fw={600}>{m.title}</Text>
                      <Text size="sm" c="dimmed">
                        {items.length} item{items.length === 1 ? "" : "s"}
                      </Text>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    {items.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        No items in this module.
                      </Text>
                    ) : (
                      [...items]
                        .sort((a: any, b: any) => a.position - b.position)
                        .map((it: any) => (
                          <StudentModuleItemRow
                            key={it.moduleItemId}
                            item={it}
                            studentUserId={studentUserId!}
                            courseId={courseId!}
                            progress={progressByItem[it.moduleItemId]}
                            consentDecisions={consentDecisions}
                          />
                        ))
                    )}
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        )}
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 2: TypeScript-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint src/portals/faculty/courses/StudentCourseDetailPage.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/portals/faculty/courses/StudentCourseDetailPage.tsx
git commit -m "feat(faculty): full StudentCourseDetailPage with modules + item drilldowns"
```

---

# Phase 9 — Polish

## Task 18: Back-link tab persistence on CourseEditorPage

**Files:**
- Modify: `src/portals/faculty/courses/CourseEditorPage.tsx`

**Goal:** When `?tab=students` is in the URL, default the tab to `students` instead of `overview`. This makes the back-link from the detail page return the user to the Student Progress tab.

- [ ] **Step 1: Edit the `useState` initializer** for `tab`. Find:

```tsx
  const [tab, setTab] = useState<string>("overview");
```

Replace with:

```tsx
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<string>(searchParams.get("tab") || "overview");
```

And add `useSearchParams` to the existing react-router-dom import line at the top:

```tsx
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
```

- [ ] **Step 2: TypeScript-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/portals/faculty/courses/CourseEditorPage.tsx
git commit -m "feat(faculty): respect ?tab= URL param on CourseEditorPage mount"
```

---

## Task 19: Full test sweep + lint

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass. If any new test failures exist that the implementing agent did not write, stop and investigate before proceeding.

- [ ] **Step 2: Run the lint check**

Run: `npm run lint`
Expected: no errors. Fix any warnings introduced by this work.

- [ ] **Step 3: Run the typecheck via the build (no output)**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: No commit** — this task is a verification gate, not a code change.

---

# Intentional deviations from the spec

- The spec routes `debrief` to `GenericItemDetail`. The plan routes it to `SurveyItemDetail` because the backend already treats `debrief` as a survey-shaped record (the existing `survey-instance-function/handler.ts` accepts both `survey` and `debrief` itemTypes). This gives faculty the actual answers instead of just a completion timestamp.
- The spec calls for an inline retry button on drilldown fetch failures. The plan uses a simpler inline error message. Retry can be added later if it proves necessary in practice.
- The spec includes a full `StudentCourseDetailPage` integration test with mocked endpoints. The plan defers this in favor of per-component tests + a manual smoke check. Reason: the repo does not currently have an msw or equivalent integration-test pattern, and bootstrapping one is a separate scope.

# Notes for the implementing agent

- **Backend changes are not deployed by you.** The user runs `npx ampx sandbox` themselves; do not invoke it. The plan is finished when the code compiles, tests pass, and lint passes locally.
- **Mantine color tokens** in this project: `terracotta`, `parchment`. Use these strings (no theme variable lookup needed).
- **`notify` helper** lives at `src/utils/notify.ts` and is already imported in `CourseEditorPage.tsx`.
- **Manual sanity check**: after Task 17, point the implementing agent to verify the dev server boots without compile errors. They should NOT navigate to the new page in a browser (the backend endpoints aren't deployed yet); only confirm `npm run dev` does not crash on the new route registration.
