# Faculty Student Progress Section

**Date:** 2026-05-23
**Status:** Approved for implementation
**Owner:** yang.fuc@northeastern.edu

## Problem

The Faculty course editor at `/faculty/courses/:courseId` has a `Students` tab that lists enrolled students with only their email and enrolled date (see `StudentsTab` in `src/portals/faculty/courses/CourseEditorPage.tsx`). Faculty cannot see at a glance whether a student has consented, which A/B group the student was assigned to, or what the student has actually done in the course. To make decisions about feedback, regrouping, or follow-up, faculty currently have to open the Review Board (which is assignment-scoped) and click cell-by-cell.

## Goals

1. Replace the `Students` tab with a `Student Progress` tab whose list view immediately surfaces, per student: consent decision and A/B group assignment.
2. From the list, faculty can navigate into a dedicated, deep-linkable detail page for one student covering that student's full record in the course.
3. The detail page renders a hierarchy: student summary → modules → per-item completion state → drill-down into the type-appropriate raw data (best session transcript, survey answers, AI-detection picks, consent decision).
4. The work is read-only — no new editing affordances are introduced. The existing enroll/remove controls stay.

## Non-Goals

- Adding live updates / subscriptions for the new views.
- Exporting or downloading student records.
- Bulk per-row "% complete" columns on the list view (would require an N×M fan-out we do not want for v1).
- Editing or overriding student data (consent decisions, group assignments, scores) from this view.
- Re-running an assignment on behalf of a student from this view.

## Design

### Routing

- Tab label in `CourseEditorPage.tsx` changes from `Students` to `Student Progress`. Icon stays `IconUsers`. Internal tab `value` stays `students` to avoid breaking any deep-links.
- New route at `src/AppRoutes.tsx` (or equivalent router config): `/faculty/courses/:courseId/students/:studentUserId` → renders new page `StudentCourseDetailPage`.
- The route is rendered inside the existing faculty `PortalLayout`.

### List view (Student Progress tab)

Lives in `CourseEditorPage.tsx`. The `StudentsTab` component is renamed to `StudentProgressTab` (export rename only; not a behavior change). Layout:

1. The existing "Enroll by email" card stays at the top, unchanged.
2. The table replaces its current columns with: **Student | Consent | Group | Enrolled | Actions**.
   - **Student**: email (fallback to `studentUserId`). The cell is clickable and navigates to the detail page; cursor is `pointer`.
   - **Consent**: badge derived from `ConsentDecision`.
     - `agreed` → terracotta filled
     - `declined` → terracotta outline
     - no row → parchment `—`
     - If the course has multiple consent items, the list cell shows the decision from the row with the latest `decidedAt`; the detail page shows the breakdown per consent item.
   - **Group**: badge with `groupKey` from `StudentGroupAssignment` for the course-level scope (`scopeKey === courseId`); `—` if unassigned.
   - **Enrolled**: existing `enrolledAt` formatted as `toLocaleDateString()`.
   - **Actions**: existing trash/remove icon plus a new `View detail` link that navigates the same route as clicking the student cell.

Data loading on tab mount: existing `fetchEnrollments` plus two new course-scoped thunks (see Redux below). The badges render `—` while the new thunks are still pending; the table itself does not block on them.

Sorting: by email ascending (default). No filters in v1.

### Detail page (`StudentCourseDetailPage`)

URL: `/faculty/courses/:courseId/students/:studentUserId`

File: `src/portals/faculty/courses/StudentCourseDetailPage.tsx`.

Structure top-to-bottom:

1. **Back link** to `/faculty/courses/:courseId?tab=students` (the tab state on `CourseEditorPage` reads `?tab` from the URL on mount and falls back to `overview` — a small one-line addition to the existing local `useState` initializer).
2. **Title**: `{studentEmail} — {course.title}`.
3. **Summary card** (`StudentSummaryCard` component):
   - Email + `studentUserId`.
   - Enrollment status + `enrolledAt`.
   - For each consent item in the course: decision + `consentVersion` + `decidedAt` (or "no decision").
   - For each `StudentGroupAssignment` row scoped to this course (typically one): `scopeKey`, `groupKey`, `assignedByItemId`, `assignedAt`.
4. **Modules section**: a Mantine `Accordion` (multiple open allowed, all expanded by default). One `Accordion.Item` per module, ordered by `position`.
   - Inside each module: the module's items in `position` order, each rendered by `StudentModuleItemRow`.
5. **Per-item row** (`StudentModuleItemRow`):
   - Collapsed header shows: position badge `#N`, title, itemType badge, and a state badge from `StudentItemProgress.state` (`locked` / `unlocked` / `in_progress` / `completed`, with timestamps `unlockedAt`/`startedAt`/`completedAt` in a tooltip). If no `StudentItemProgress` row exists for this student × item, the state badge reads `not started` (parchment, outline).
   - When expanded, lazily fetches and renders a type-specific child component (see below).

### Per-itemType drilldown

Each renderer lives in `src/portals/faculty/courses/components/itemDetails/`. All renderers accept `{ itemId, studentUserId, courseId, item, progress }` and own their own fetch.

| itemType | Component | Drilldown content |
|---|---|---|
| `assignment` | `AssignmentItemDetail.tsx` | Calls `moduleItemApi.getBestSession(itemId, studentUserId)`. Shows: best-session score badge, attemptNo, startedAt/endedAt, evaluation summary (`evaluation.overallExplanation`, rendered via `MarkdownView`), and the conversation history (turns → student/patient transcript lines). Includes a button `Open in Review Board` → navigates to existing reviews route. If no best session exists, shows "No completed attempt yet". |
| `survey` | `SurveyItemDetail.tsx` | Calls new `surveyInstanceApi.getForStudent(itemId, studentUserId)`. Renders submitted status + `submittedAt`. For each question in `schemaSnapshot.questions`, shows the question prompt and the student's answer from `answers` (formatted by question type). If no instance exists yet, shows "Not started". |
| `ai_detection` | `AIDetectionItemDetail.tsx` | Calls `moduleItemApi.getSubQuestions(itemId, studentUserId)`. For each sub-question: linked assignment title, lock state, missing prereqs list, student's pick (from `existingAnswer.pickedDisplayKey`), follow-up text (from `existingAnswer.followUpText`), blinded feedback if present. |
| `consent` | `ConsentItemDetail.tsx` | Recap from `ConsentDecision` already loaded on the page: decision, `consentVersion`, `decidedAt`. If no row, "No decision yet". |
| `external_link` / `debrief` / `instruction` | `GenericItemDetail.tsx` | Shows completion state from `progress` — `Completed at {completedAt}` or `Not completed yet`. No further data to display. |
| `randomizer` / `reveal_trigger` | `GenericItemDetail.tsx` | Same as above, plus a note "Resulting group assignment shown in summary above" for `randomizer`. |

### Backend additions

Three Lambda handler additions (and matching client-side wrappers). Authorization: caller must be an instructor on the target course (matches existing `moduleItemApi.getProgress` authz used by Review Board).

1. **List group assignments for a course**
   - Client: `groupAssignmentApi.listForCourse(courseId)` → `{ assignments: StudentGroupAssignment[] }`.
   - Handler: query `StudentGroupAssignment` table by partition key `courseId`. Restrict to caller-is-instructor on the course.

2. **Get a survey instance for a target student**
   - Client: `surveyInstanceApi.getForStudent(itemId, studentUserId)` → `{ instance: SurveyInstance | null }`.
   - Handler: read `SurveyInstance` by composite key `(moduleItemId, studentUserId)`. Restrict to caller-is-instructor on the course identified by the survey instance's `courseId`.

3. **List consent decisions for a course** — already exists as `consentApi.listForCourse(courseId)`. No backend change. Verify the returned shape includes `studentUserId`, `consentItemId`, `decision`, `consentVersion`, `decidedAt` for each row.

`moduleItemApi.getProgress(itemId, studentUserId)`, `moduleItemApi.getBestSession(itemId, studentUserId)`, and `moduleItemApi.getSubQuestions(itemId, studentUserId)` already support faculty-as-target. No backend change needed for these.

Files affected (estimated):
- `amplify/functions/student-group-assignment-function/handler.ts` — new branch / new function depending on existing layout (verify in implementation step).
- `amplify/functions/survey-instance-function/handler.ts` — new `getForStudent` action.
- `amplify/data/resource.ts` — wire the new actions into the schema if needed.

### Redux state

**List view caches** (course-scoped, useful across tab visits):

- `consentSlice` gains a `courseConsentsByCourse: Record<courseId, ConsentDecisionRow[]>` shard, a thunk `fetchCourseConsents(courseId)` wrapping `consentApi.listForCourse`, and a selector `selectConsentDecisionsByStudent(courseId, studentUserId)`.
- `groupAssignmentSlice` gains a `courseGroupsByCourse: Record<courseId, GroupAssignmentRow[]>` shard, a thunk `fetchCourseGroups(courseId)` wrapping the new `groupAssignmentApi.listForCourse`, and a selector `selectCourseGroupForStudent(courseId, studentUserId)` returning the course-scope assignment row (the one with `scopeKey === courseId`).

**Detail view**: local component state. The detail page calls api wrappers directly and stores results in `useState`. Each per-item drilldown owns its own lazy fetch via `useEffect` when expanded. No new slice fields for one-student-at-a-time data.

### Components

New files:

- `src/portals/faculty/courses/StudentCourseDetailPage.tsx`
- `src/portals/faculty/courses/components/StudentSummaryCard.tsx`
- `src/portals/faculty/courses/components/StudentModuleItemRow.tsx`
- `src/portals/faculty/courses/components/itemDetails/AssignmentItemDetail.tsx`
- `src/portals/faculty/courses/components/itemDetails/SurveyItemDetail.tsx`
- `src/portals/faculty/courses/components/itemDetails/AIDetectionItemDetail.tsx`
- `src/portals/faculty/courses/components/itemDetails/ConsentItemDetail.tsx`
- `src/portals/faculty/courses/components/itemDetails/GenericItemDetail.tsx`

Edits to existing files:

- `src/portals/faculty/courses/CourseEditorPage.tsx` — tab label rename, table redesign, rename `StudentsTab` → `StudentProgressTab`.
- `src/slices/consentSlice.ts` — add course-scope cache + thunk + selector.
- `src/slices/groupAssignmentSlice.ts` — add course-scope cache + thunk + selector.
- `src/api/groupAssignmentApi.ts` — add `listForCourse`.
- `src/api/surveyInstanceApi.ts` — add `getForStudent`.
- Router config — register the new route inside the faculty portal layout.
- `amplify/functions/...` — add the two new backend actions per "Backend additions" above.

### Error & loading states

- **List view**: existing loader + empty state for enrollments. Consent/Group cells show `—` (with a faint loading shimmer) until their thunks resolve. Thunk errors surface via `notify.error` and the cells stay `—`; we do not block the table.
- **Detail page**: top-level `Loader` while the initial summary fetch resolves. Per-item expand uses a small `Skeleton` while its drilldown loads. On fetch failure the drilldown body shows an inline `Alert` with a `Retry` button that re-issues the fetch.
- **Permissions**: if the backend returns 403, the detail page shows a friendly "You are not an instructor on this course" message instead of an error toast.

### Testing strategy

For the TDD step, each of the following gets a failing test written before implementation:

- **Selectors** (Vitest):
  - `selectConsentDecisionsByStudent` returns the right rows, including the empty-case.
  - `selectCourseGroupForStudent` returns only the course-scope row.
- **API wrappers** (Vitest, with the existing http mock pattern):
  - `groupAssignmentApi.listForCourse` issues the expected request and shape-checks the response.
  - `surveyInstanceApi.getForStudent` likewise.
- **Component tests** (React Testing Library):
  - `StudentSummaryCard` renders consent / group rows from fixture data.
  - Each `*ItemDetail` renderer renders the right fields for fixture data and the right empty-state copy when the underlying fetch returns `null`.
  - `StudentProgressTab` renders consent + group badges driven by the slice fixtures.
- **Integration test**:
  - `StudentCourseDetailPage` renders end-to-end with msw (or the repo's equivalent) mocking all endpoints, exercising at least one item of each type.

The repo's existing test runner (Vitest vs Jest) will be confirmed as the first action of the implementation step before writing any test file.

### Permissions / authorization

Both new backend endpoints require the caller to be an instructor on the target course. The check uses the same `CourseInstructor` lookup the existing `moduleItemApi.getProgress` faculty branch uses. Reviewers / co-teachers / coordinators all qualify (consistent with Review Board behavior).

### Performance considerations

- List view: one extra request per course (`fetchCourseConsents`) plus one (`fetchCourseGroups`). Both are flat queries on a single course partition; no fan-out.
- Detail page initial load: course + modules + items (already cached at the editor level), enrollment row, consent + group reads, plus M parallel `getProgress` calls where M = number of items in the course. M is bounded by course size (typically <30) and these are existing endpoints; acceptable for v1.
- Detail page expand: each expand triggers exactly one fetch and caches the result for the lifetime of the page. No prefetch.

## Open Questions Resolved Inline

- *Should the list view show a progress %?* No, deferred. Avoids N×M fan-out. Detail page covers the per-item story.
- *Drawer vs route?* Route. Hierarchical content is page-shaped; deep-linking is valuable.
- *Where does the lazy fetch live?* In each `*ItemDetail` component, not the page, so a closed module does not cost any requests.
- *What if a course has multiple consent items?* List view shows the most recent decision; detail page summary shows all of them.
- *What if there is no course-scope group assignment?* List view shows `—`; detail page summary card says "No group assignment yet".

## Out of Scope (Future)

- A faculty-side bulk export of student records.
- Live-updating progress via subscriptions.
- An "all students × all items" matrix view (the Review Board already covers the assignment slice; a generalized matrix may follow later).
- Editing student data (consent overrides, manual group reassignment, score overrides) from this surface.
