# Discovery Picker And Term Toggle Design

## Summary

Refine the `Domain & Subdomain Discovery` search controls so they feel closer to standard shadcn UI patterns while preserving the current lookup behavior and query model.

This change has two parts:

1. Replace the current `Added since` control with the exact shadcn-style single-date picker interaction already implied by the existing `Popover + Calendar` structure.
2. Replace the compact `IN / EX` term toggle with a segmented `Include / Exclude` control where both labels stay visible at all times.

## Goals

- Match the shadcn date-picker interaction and visual structure shown in the provided screenshot.
- Keep the `Added since` filter as a single-date filter instead of changing it to a date range.
- Improve clarity of the term inclusion toggle by always showing `Include` and `Exclude`.
- Preserve current search semantics and backend compatibility.
- Add regression coverage for the discovery toolbar and term row interactions.

## Non-Goals

- No backend changes to `/api/subdomains`.
- No change to the meaning of `Added since`; it remains a lower-bound date filter.
- No new reusable design system abstraction unless needed to keep the code clean.
- No changes to tabs outside `Domain & Subdomain Discovery`.

## Current State

The discovery tab in [components/dashboard-shell.tsx](C:/Users/saymy/Automote%20projects/tech-stack-dashboard/components/dashboard-shell.tsx) already uses:

- `Popover`
- `PopoverTrigger`
- `PopoverContent`
- `Calendar`

It also tracks a single `subdomainAddedSince` value and uses a boolean `include` field on each search term row.

The current issues are:

- The date-picker trigger and calendar wrapper do not yet match the familiar shadcn date-picker presentation from the screenshot.
- The term-mode control uses a compact moving pill with `IN / EX`, which makes the filter state less explicit than desired.

## Chosen Approach

Use a lightweight shadcn alignment pass:

- Keep the existing single-date data model and current toolbar placement.
- Restyle and slightly restructure the trigger and popover to match the standard shadcn picker pattern more closely.
- Update the local `Calendar` wrapper if needed so the calendar surface and navigation better match the expected shadcn look.
- Replace the include/exclude pill with a segmented two-option control.

This approach gives the requested UX without increasing risk by altering query semantics or creating unnecessary new abstractions.

## UX Design

### Added Since Date Picker

The `Added since` filter remains a single-date picker.

Behavior:

- When no date is selected, the trigger shows `Pick a date` in muted styling.
- When a date is selected, the trigger shows the formatted date.
- Clicking the trigger opens a dark calendar popover aligned to the trigger.
- Selecting a date updates `subdomainAddedSince` immediately.
- Reopening the picker shows the selected date highlighted.
- The picker continues to act as a lower-bound filter for discovery results.

Visual requirements:

- Use the shadcn-style trigger pattern rather than a custom bare button treatment.
- Match the screenshot's dense dark calendar surface and clear selected-day highlight as closely as the existing design system allows.
- Keep the control visually consistent with the rest of the discovery toolbar.

### Include / Exclude Segmented Control

Each term row gets a two-option segmented control:

- `Include`
- `Exclude`

Behavior:

- Only one option is active at a time.
- Both labels remain visible at all times.
- Clicking either option updates the existing boolean `include` field.
- The selected side uses stronger contrast or accent styling.
- The inactive side stays readable, not hidden behind a moving thumb.

This is a pure UX refinement over the current boolean toggle.

## Implementation Plan

### 1. Refine the calendar wrapper

Update [components/ui/calendar.tsx](C:/Users/saymy/Automote%20projects/tech-stack-dashboard/components/ui/calendar.tsx) so it more closely reflects shadcn's standard `Calendar` styling and navigation behavior.

Expected changes:

- Add richer class names for month layout, caption, nav buttons, weekdays, days, selected day, outside days, and disabled states.
- Keep the API compatible with the current `Calendar` usage in `DashboardShell`.
- Avoid changing the selection mode; it remains `single`.

### 2. Update the discovery date-picker trigger

In [components/dashboard-shell.tsx](C:/Users/saymy/Automote%20projects/tech-stack-dashboard/components/dashboard-shell.tsx):

- Replace the current custom trigger button styling with a shadcn-style trigger built from the existing button and tailwind patterns.
- Keep the `Popover` structure.
- Ensure the formatted date text and placeholder state match the intended UI.
- Preserve existing `subdomainAddedSince` state updates and request construction.

### 3. Replace the term include/exclude toggle

In the discovery term-row markup inside `DashboardShell`:

- Remove the `IN / EX` slider-style pill.
- Replace it with a segmented two-button control.
- Bind the segmented control directly to `filter.include`.
- Keep the current add/remove/filter row behavior unchanged.

### 4. Add focused tests

Update [app-shell.test.tsx](C:/Users/saymy/Automote%20projects/tech-stack-dashboard/app-shell.test.tsx) with focused coverage for:

- The date-picker trigger placeholder and selected-date rendering.
- The include/exclude segmented control labels being visible.
- Term mode switching from include to exclude and back.

Because this test file already contains some stale assertions unrelated to this feature, verification should prefer focused name-based runs for the new or updated cases unless the unrelated failures are fixed in the same pass.

## Data And Query Impact

No backend contract changes are required.

The frontend continues sending:

- `addedSince` from the selected single date
- term modifier values
- boolean include/exclude intent

The request shape and query semantics remain unchanged.

## Risks

### Calendar Styling Drift

The local `Calendar` wrapper is currently minimal. Bringing it closer to shadcn may affect any other screen that uses the same wrapper.

Mitigation:

- Keep the wrapper API stable.
- Limit changes to visual classes and navigation affordances.
- Verify any existing calendar usage in the repo after the update.

### Test Mismatch With Older Discovery Assertions

`app-shell.test.tsx` contains expectations from an older discovery implementation.

Mitigation:

- Update only the assertions directly touched by this work.
- Use focused test execution to verify the new behavior cleanly.

## Acceptance Criteria

- The discovery tab shows a shadcn-style single-date picker trigger for `Added since`.
- Opening the picker shows a dark shadcn-style calendar consistent with the provided screenshot.
- Selecting a date updates the trigger label and preserves the existing single-date filter behavior.
- Each discovery term row shows visible `Include` and `Exclude` labels at all times.
- Switching the segmented control changes the underlying include/exclude state without changing any other row behavior.
- Focused regression tests pass for the updated discovery controls.
- The app builds successfully after the change.
