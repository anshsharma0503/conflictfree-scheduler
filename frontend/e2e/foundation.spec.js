import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./e2eEnv.js";

const DASHBOARD_URL = `${E2E_BASE_URL}/dashboard`;

// ---------------------------------------------------------------------------
// Navigation helpers for the split dashboard
// (Overview, Events, New event, Find a time, Rooms & equipment)
// ---------------------------------------------------------------------------

async function goToNewEvent(page) {
  await page.getByRole("link", { name: "New event", exact: true }).click();
  await expect(page).toHaveURL(`${DASHBOARD_URL}/events/new`);
}

async function goToEvents(page) {
  await page.getByRole("link", { name: "Events", exact: true }).click();
  await expect(page).toHaveURL(`${DASHBOARD_URL}/events`);
}

async function goToFindTime(page) {
  await page.getByRole("link", { name: "Find a time", exact: true }).click();
  await expect(page).toHaveURL(`${DASHBOARD_URL}/find-time`);
}

async function goToResources(page) {
  await page.getByRole("link", { name: "Rooms & equipment", exact: true }).click();
  await expect(page).toHaveURL(`${DASHBOARD_URL}/resources`);
}

async function register(page, name, email) {
  await page.goto("/register");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(DASHBOARD_URL);
}

async function logIn(page, email) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(DASHBOARD_URL);
}

async function logOut(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
}

/** Creates an event from the composer and lands on the Events page. */
async function createEvent(page, { title, startsAt, endsAt, description, location, resourceLabel, attendees }) {
  await goToNewEvent(page);
  await page.getByLabel("Title").fill(title);

  if (description) {
    await page.getByLabel("Description").fill(description);
  }

  await page.getByLabel("Starts").fill(startsAt);
  await page.getByLabel("Ends").fill(endsAt);

  if (location) {
    await page.getByLabel("Location").fill(location);
  }

  if (resourceLabel) {
    await page.getByLabel("Book resource").selectOption({ label: resourceLabel });
  }

  if (attendees) {
    await page.getByLabel("Expected attendees").fill(attendees);
  }

  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(`${DASHBOARD_URL}/events`);
  await expect(page.getByText("Event created successfully")).toBeVisible();
}

// ---------------------------------------------------------------------------

test("frontend connects to the backend", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ConflictFree" })).toBeVisible();
  await expect(page.getByText("ConflictFree API is running")).toBeVisible();
});

test("unknown routes show the not found page", async ({ page }) => {
  await page.goto("/missing-page");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  await page.getByRole("link", { name: "Return home" }).click();

  await expect(page).toHaveURL(`${E2E_BASE_URL}/`);
});

test("auth callback shows an error when Google login fails", async ({ page }) => {
  await page.goto("/auth/callback?error=access_denied");

  await expect(page.getByRole("heading", { name: "Login failed" })).toBeVisible();
  await expect(page.getByText("access_denied")).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("manual register, event create/delete, logout, and login flow works", async ({
  page,
}) => {
  const uniqueEmail = `e2e-${Date.now()}@example.com`;

  await register(page, "E2E User", uniqueEmail);
  await expect(page.getByRole("heading", { name: "Welcome, E2E User" })).toBeVisible();

  await goToNewEvent(page);
  await page.getByLabel("Title").fill("E2E Planning Meeting");
  await page.getByLabel("Description").fill("Created during e2e test");
  await page.getByLabel("Starts").fill("2026-08-20T10:00");
  await page.getByLabel("Ends").fill("2026-08-20T11:00");
  await page.getByLabel("Location").fill("Room E2E");
  // Personal events cannot carry participants (backend rule since Phase J);
  // inviting people is covered by the shared-meeting test below.
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page).toHaveURL(`${DASHBOARD_URL}/events`);
  await expect(page.getByText("E2E Planning Meeting")).toBeVisible();
  await expect(page.getByText("Created during e2e test")).toBeVisible();
  await expect(page.getByText("Room E2E")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();

  await expect(page.getByRole("heading", { name: "Update calendar event" })).toBeVisible();

  await page.getByLabel("Title").fill("Updated E2E Planning Meeting");
  await page.getByLabel("Location").fill("Updated Room E2E");
  await page.getByRole("button", { name: "Update event" }).click();

  await expect(page).toHaveURL(`${DASHBOARD_URL}/events`);
  await expect(page.getByText("Event updated successfully")).toBeVisible();
  await expect(page.getByText("Updated E2E Planning Meeting")).toBeVisible();
  await expect(page.getByText("Updated Room E2E")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("Event deleted successfully")).toBeVisible();
  await expect(page.getByText("Updated E2E Planning Meeting")).not.toBeVisible();

  await logOut(page);
  await logIn(page, uniqueEmail);
  await expect(page.getByRole("heading", { name: "Welcome, E2E User" })).toBeVisible();
});

test("conflict detection blocks save and shows warning, then allows save after time change", async ({
  page,
}) => {
  const uniqueEmail = `e2e-conflict-${Date.now()}@example.com`;

  await register(page, "Conflict E2E User", uniqueEmail);

  await createEvent(page, {
    title: "E2E Event A",
    description: "First event",
    startsAt: "2026-08-25T10:00",
    endsAt: "2026-08-25T11:00",
    location: "Room A",
  });
  await expect(page.getByText("E2E Event A")).toBeVisible();

  await goToNewEvent(page);
  await page.getByLabel("Title").fill("E2E Event B");
  await page.getByLabel("Description").fill("Overlapping event");
  await page.getByLabel("Starts").fill("2026-08-25T10:30");
  await page.getByLabel("Ends").fill("2026-08-25T11:30");
  await page.getByLabel("Location").fill("Room B");
  await page.getByRole("button", { name: "Create event" }).click();

  const conflictAlert = page.getByRole("alert", { name: "Conflict warning" });
  await expect(conflictAlert).toBeVisible();
  await expect(page.getByText("Scheduling conflict detected")).toBeVisible();
  await expect(conflictAlert.getByText("E2E Event A")).toBeVisible();

  // Save was blocked: still on the composer.
  await expect(page).toHaveURL(`${DASHBOARD_URL}/events/new`);

  await page.getByLabel("Starts").fill("2026-08-25T12:00");
  await page.getByLabel("Ends").fill("2026-08-25T13:00");

  await expect(page.getByRole("alert", { name: "Conflict warning" })).not.toBeVisible();

  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page).toHaveURL(`${DASHBOARD_URL}/events`);
  await expect(page.getByText("E2E Event B")).toBeVisible();
  await expect(page.getByText("Event created successfully")).toBeVisible();
  await expect(page.locator(".event-row")).toHaveCount(2);
});

test("available slot finder searches slots and populates event form on click", async ({
  page,
}) => {
  const uniqueEmail = `e2e-slots-${Date.now()}@example.com`;

  await register(page, "Slot Finder User", uniqueEmail);

  await createEvent(page, {
    title: "Existing Busy Block",
    startsAt: "2026-08-25T10:00",
    endsAt: "2026-08-25T11:00",
  });
  await expect(page.getByText("Existing Busy Block")).toBeVisible();

  await goToFindTime(page);
  await page.getByLabel("Window start").fill("2026-08-25T09:00");
  await page.getByLabel("Window end").fill("2026-08-25T13:00");
  await page.getByLabel("Duration (minutes)").fill("60");

  await page.getByRole("button", { name: "Find available slots" }).click();

  const slotRegion = page.getByRole("region", { name: "Available slots" });
  await expect(slotRegion).toBeVisible();

  const slotButtons = slotRegion.locator(".slot-row");
  await expect(slotButtons).toHaveCount(4);

  const slotTexts = await slotButtons.allInnerTexts();
  expect(slotTexts.some((text) => text.includes("10:00–11:00"))).toBe(false);
  expect(slotTexts.some((text) => text.includes("10:30–11:30"))).toBe(false);

  const slot11 = slotButtons.filter({ hasText: "11:00–12:00" }).first();
  await slot11.click();

  await expect(page).toHaveURL(`${DASHBOARD_URL}/events/new`);
  await expect(page.getByLabel("Starts")).toHaveValue("2026-08-25T11:00");
  await expect(page.getByLabel("Ends")).toHaveValue("2026-08-25T12:00");

  await page.getByLabel("Title").fill("Slot Created Meeting");
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page.getByText("Slot Created Meeting")).toBeVisible();
  await expect(page.getByText("Event created successfully")).toBeVisible();
  await expect(page.locator(".event-row")).toHaveCount(2);
});

test("slot finder scores and ranks slots according to user preferences", async ({
  page,
}) => {
  const uniqueEmail = `e2e-scored-${Date.now()}@example.com`;

  await register(page, "Scoring E2E User", uniqueEmail);
  await goToFindTime(page);

  await page.getByLabel("Window start").fill("2026-08-25T09:00");
  await page.getByLabel("Window end").fill("2026-08-25T17:00");
  await page.getByLabel("Duration (minutes)").fill("60");

  await page.getByLabel("Preferred start hour").fill("10");
  await page.getByLabel("Preferred end hour").fill("12");
  await page.getByLabel("Avoid early morning (< 10:00 AM)").check();
  await page.getByLabel("Avoid late day (> 5:00 PM)").check();
  await page.getByLabel("Earliest slot bonus").check();

  await page.getByRole("button", { name: "Find available slots" }).click();

  const slotRegion = page.getByRole("region", { name: "Available slots" });
  await expect(slotRegion).toBeVisible();

  const scoreLabels = slotRegion.locator(".slot-score-label");
  await expect(scoreLabels.first()).toBeVisible();
  expect(await scoreLabels.first().innerText()).toContain("Score:");

  await expect(slotRegion.getByText("Inside preferred time window").first()).toBeVisible();

  await slotRegion.locator(".slot-row").first().click();

  await expect(page).toHaveURL(`${DASHBOARD_URL}/events/new`);
  expect(await page.getByLabel("Starts").inputValue()).toContain("2026-08-25T");

  await page.getByLabel("Title").fill("Top Ranked Meeting");
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page.getByText("Top Ranked Meeting")).toBeVisible();
  await expect(page.getByText("Event created successfully")).toBeVisible();
});

test("smart suggestions relax constraints when preferred window is blocked and populate event form", async ({
  page,
}) => {
  const uniqueEmail = `e2e-relax-${Date.now()}@example.com`;

  await register(page, "Relaxation E2E User", uniqueEmail);

  await createEvent(page, {
    title: "Afternoon Blocked Busy Period",
    startsAt: "2026-08-25T13:00",
    endsAt: "2026-08-25T17:00",
  });
  await expect(page.getByText("Afternoon Blocked Busy Period")).toBeVisible();

  await goToFindTime(page);
  await page.getByLabel("Window start").fill("2026-08-25T09:00");
  await page.getByLabel("Window end").fill("2026-08-25T17:00");
  await page.getByLabel("Duration (minutes)").fill("60");

  await page.getByLabel("Preferred start hour").fill("13");
  await page.getByLabel("Preferred end hour").fill("17");

  await page.getByLabel("Minimum score").fill("70");
  await page.getByLabel("Max suggestions").fill("3");

  await page.getByRole("button", { name: "Find smart suggestions" }).click();

  const relaxationNotice = page.getByRole("note", { name: "Relaxation notice" });
  await expect(relaxationNotice).toBeVisible();
  await expect(page.getByText("No strict match found. Constraints relaxed:")).toBeVisible();
  await expect(page.getByText("Relaxed preferred time window")).toBeVisible();

  const suggestionRegion = page.getByRole("region", { name: "Smart suggestions" });
  await expect(suggestionRegion).toBeVisible();

  const suggestionCards = suggestionRegion.locator(".slot-row");
  await expect(suggestionCards).toHaveCount(3);

  await expect(suggestionRegion.getByText("preferredTimeWindow").first()).toBeVisible();

  await suggestionCards.first().click();

  await expect(page).toHaveURL(`${DASHBOARD_URL}/events/new`);
  expect(await page.getByLabel("Starts").inputValue()).toContain("2026-08-25T09:00");

  await page.getByLabel("Title").fill("Relaxed Suggestion Event");
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page.getByText("Relaxed Suggestion Event")).toBeVisible();
  await expect(page.getByText("Event created successfully")).toBeVisible();
  await expect(page.locator(".event-row")).toHaveCount(2);
});

test("multi-participant availability discovery excludes participant busy periods and populates event form", async ({
  page,
}) => {
  const timestamp = Date.now();
  const participantEmail = `e2e-part-${timestamp}@example.com`;
  const organizerEmail = `e2e-org-${timestamp}@example.com`;

  // 1–2. Participant registers and blocks 14:00–16:00
  await register(page, "Participant User", participantEmail);
  await createEvent(page, {
    title: "Participant Private Busy Block",
    startsAt: "2026-08-25T14:00",
    endsAt: "2026-08-25T16:00",
  });
  await expect(page.getByText("Participant Private Busy Block")).toBeVisible();

  // 3–4. Participant logs out, organizer registers
  await logOut(page);
  await register(page, "Organizer User", organizerEmail);

  // 5. Organizer searches available slots including participant
  await goToFindTime(page);
  await page.getByLabel("Window start").fill("2026-08-25T12:00");
  await page.getByLabel("Window end").fill("2026-08-25T18:00");
  await page.getByLabel("Duration (minutes)").fill("60");
  await page.getByLabel("Step (minutes)").fill("60");
  await page.getByLabel("Participant user emails").fill(participantEmail);

  await page.getByRole("button", { name: "Find available slots" }).click();

  // 6. Participant summary
  const participantSummary = page.getByRole("region", { name: "Coordinated participants" });
  await expect(participantSummary).toBeVisible();
  await expect(participantSummary.getByText(participantEmail)).toBeVisible();

  // 7–8. Busy period excluded, surrounding slots present
  const slotRegion = page.getByRole("region", { name: "Available slots" });
  await expect(slotRegion).toBeVisible();

  const slotButtons = slotRegion.locator(".slot-row");
  const joinedSlots = (await slotButtons.allTextContents()).join(" ");

  expect(joinedSlots).toContain("12:00–13:00");
  expect(joinedSlots).toContain("13:00–14:00");
  expect(joinedSlots).toContain("16:00–17:00");
  expect(joinedSlots).toContain("17:00–18:00");
  expect(joinedSlots).not.toContain("14:00–15:00");
  expect(joinedSlots).not.toContain("15:00–16:00");

  // Privacy: participant's private event details are never displayed
  await expect(page.getByText("Participant Private Busy Block")).not.toBeVisible();

  // 9. Choose a slot, which fills the event form
  await slotButtons.first().click();

  await expect(page).toHaveURL(`${DASHBOARD_URL}/events/new`);
  expect(await page.getByLabel("Starts").inputValue()).toContain("2026-08-25T");

  await page.getByLabel("Title").fill("Coordinated Team Sync");
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page.getByText("Coordinated Team Sync")).toBeVisible();
  await expect(page.getByText("Event created successfully")).toBeVisible();
});

test("trie-based participant search and autocomplete coordinates availability and populates event form", async ({
  page,
}) => {
  const timestamp = Date.now();
  const participantName = `Trie Participant ${timestamp}`;
  const participantEmail = `e2e-trie-part-${timestamp}@example.com`;
  const organizerEmail = `e2e-trie-org-${timestamp}@example.com`;

  // 1–2. Participant registers and blocks 14:00–16:00
  await register(page, participantName, participantEmail);
  await createEvent(page, {
    title: "Participant Busy Block",
    startsAt: "2026-08-26T14:00",
    endsAt: "2026-08-26T16:00",
  });
  await expect(page.getByText("Participant Busy Block")).toBeVisible();

  // 3–4. Switch to the organizer
  await logOut(page);
  await register(page, "Trie Organizer", organizerEmail);

  // 5–6. Autocomplete the participant on Find a time
  await goToFindTime(page);
  const combobox = page.getByRole("combobox", { name: /Participant user emails/ });
  await combobox.fill("Trie Part");

  const suggestion = page.getByRole("option", { name: new RegExp(participantName, "i") });
  await expect(suggestion).toBeVisible();
  await suggestion.click();

  // 7. Selected chip
  const chipRegion = page.getByRole("region", { name: "Selected participant chips" });
  await expect(chipRegion).toBeVisible();
  await expect(chipRegion.getByText(new RegExp(participantName, "i"))).toBeVisible();

  // 8. Search
  await page.getByLabel("Window start").fill("2026-08-26T12:00");
  await page.getByLabel("Window end").fill("2026-08-26T18:00");
  await page.getByLabel("Duration (minutes)").fill("60");
  await page.getByLabel("Step (minutes)").fill("60");

  await page.getByRole("button", { name: "Find available slots" }).click();

  // 9. Coordinated participant summary
  const participantSummary = page.getByRole("region", { name: "Coordinated participants" });
  await expect(participantSummary).toBeVisible();
  await expect(participantSummary.getByText(participantEmail)).toBeVisible();

  // 10. Busy period excluded
  const slotRegion = page.getByRole("region", { name: "Available slots" });
  await expect(slotRegion).toBeVisible();

  const slotButtons = slotRegion.locator(".slot-row");
  const joinedSlots = (await slotButtons.allTextContents()).join(" ");

  expect(joinedSlots).toContain("12:00–13:00");
  expect(joinedSlots).toContain("13:00–14:00");
  expect(joinedSlots).toContain("16:00–17:00");
  expect(joinedSlots).toContain("17:00–18:00");
  expect(joinedSlots).not.toContain("14:00–15:00");
  expect(joinedSlots).not.toContain("15:00–16:00");

  // 11. Select a slot. The picked participant carries over to the composer,
  //     so the meeting is confirmed as a shared meeting with them.
  await slotButtons.first().click();
  await expect(page).toHaveURL(`${DASHBOARD_URL}/events/new`);
  await expect(
    page.getByRole("region", { name: "Selected participant chips" }),
  ).toContainText(new RegExp(participantName, "i"));
  await page.getByLabel("Title").fill("Trie Coordinated Sync");
  await page.getByRole("button", { name: "Confirm shared meeting" }).click();

  await expect(page).toHaveURL(`${DASHBOARD_URL}/events`);
  await expect(page.getByText("Shared meeting confirmed successfully!")).toBeVisible();
  const syncRow = page.locator(".event-row", { hasText: "Trie Coordinated Sync" });
  await expect(syncRow).toBeVisible();
  await expect(syncRow).toContainText(participantEmail);
});

test("shared resource creation, booking, conflict detection, and slot availability exclusion flow works", async ({
  page,
}) => {
  const timestamp = Date.now();
  const userEmail = `e2e-resource-${timestamp}@example.com`;
  const resourceName = `Executive Boardroom ${timestamp}`;
  const resourceLabel = `${resourceName} (room, cap: 10)`;

  // 1. Register user
  await register(page, "Resource Organizer", userEmail);

  // 2. Create the resource on Rooms & equipment
  await goToResources(page);
  await page.getByLabel("Resource name").fill(resourceName);
  await page.getByLabel("Capacity").fill("10");
  await page.getByLabel("Resource venue").fill("Floor 4, Suite 400");
  await page.getByLabel("Resource details").fill("High-end video conference setup");
  await page.getByRole("button", { name: "Create resource" }).click();

  const resourceRow = page.locator(".resource-row", { hasText: resourceName });
  await expect(resourceRow).toBeVisible();
  await expect(resourceRow.getByText("Capacity: 10")).toBeVisible();

  // 3. Book the resource 14:00–16:00
  await createEvent(page, {
    title: `Board Meeting ${timestamp}`,
    startsAt: "2026-09-10T14:00",
    endsAt: "2026-09-10T16:00",
    resourceLabel,
    attendees: "6",
  });
  await expect(page.locator(".event-row h3", { hasText: `Board Meeting ${timestamp}` })).toBeVisible();

  // 4. Second user with no personal conflicts
  await logOut(page);
  const secondUserEmail = `e2e-resource-user2-${timestamp}@example.com`;
  await register(page, "Second Team Member", secondUserEmail);

  // 5. Overlapping booking (15:00–16:30) of the same resource is rejected
  await goToNewEvent(page);
  await page.getByLabel("Title").fill("Conflicting Workshop");
  await page.getByLabel("Starts").fill("2026-09-10T15:00");
  await page.getByLabel("Ends").fill("2026-09-10T16:30");
  await page.getByLabel("Book resource").selectOption({ label: resourceLabel });
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(
    page.getByText("Resource is already booked for the requested time"),
  ).toBeVisible();

  // 6. Back-to-back booking (16:00–17:00) succeeds, still on the composer
  await page.getByLabel("Title").fill("Back-to-back Review");
  await page.getByLabel("Starts").fill("2026-09-10T16:00");
  await page.getByLabel("Ends").fill("2026-09-10T17:00");
  await page.getByLabel("Book resource").selectOption({ label: resourceLabel });
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page).toHaveURL(`${DASHBOARD_URL}/events`);
  await expect(page.locator(".event-row h3", { hasText: "Back-to-back Review" })).toBeVisible();
  await expect(page.getByText("Event created successfully")).toBeVisible();

  // 7. Find a time with the required resource
  await goToFindTime(page);
  await page.getByLabel("Window start").fill("2026-09-10T12:00");
  await page.getByLabel("Window end").fill("2026-09-10T18:00");
  await page.getByLabel("Duration (minutes)").fill("60");
  await page.getByLabel("Step (minutes)").fill("60");
  await page.getByLabel("Required resource (Optional)").selectOption({ label: resourceLabel });

  await page.getByRole("button", { name: "Find available slots" }).click();

  const resourceSummary = page.getByRole("region", { name: "Selected slot resource" });
  await expect(resourceSummary).toBeVisible();
  await expect(resourceSummary).toContainText(resourceName);

  // Slots exclude the booked periods (14:00–16:00 and 16:00–17:00)
  const slotRegion = page.getByRole("region", { name: "Available slots" });
  await expect(slotRegion).toBeVisible();

  const joinedSlots = (await slotRegion.locator(".slot-row").allTextContents()).join(" ");

  expect(joinedSlots).toContain("12:00–13:00");
  expect(joinedSlots).toContain("13:00–14:00");
  expect(joinedSlots).toContain("17:00–18:00");
  expect(joinedSlots).not.toContain("14:00–15:00");
  expect(joinedSlots).not.toContain("15:00–16:00");
  expect(joinedSlots).not.toContain("16:00–17:00");
});

test("automatic resource allocation with Graph Coloring assigns a free room and populates the event form", async ({
  page,
}) => {
  const timestamp = Date.now();
  const roomAlpha = `Alpha Kit ${timestamp}`;
  const roomBeta = `Beta Kit ${timestamp}`;

  // 1. Register User 1
  const user1Email = `e2e-color-user1-${timestamp}@example.com`;
  await register(page, "Resource Owner", user1Email);

  // 2. Create two equipment resources: Alpha Kit (cap 5) and Beta Kit (cap 15)
  await goToResources(page);
  await page.getByLabel("Resource name").fill(roomAlpha);
  await page.getByLabel("Type").selectOption("equipment");
  await page.getByLabel("Capacity").fill("5");
  await page.getByLabel("Resource venue").fill("Storage 1");
  await page.getByRole("button", { name: "Create resource" }).click();
  await expect(page.locator(".resource-row", { hasText: roomAlpha })).toBeVisible();

  await page.getByLabel("Resource name").fill(roomBeta);
  await page.getByLabel("Type").selectOption("equipment");
  await page.getByLabel("Capacity").fill("15");
  await page.getByLabel("Resource venue").fill("Storage 2");
  await page.getByRole("button", { name: "Create resource" }).click();
  await expect(page.locator(".resource-row", { hasText: roomBeta })).toBeVisible();

  // 3. User 1 books Alpha Kit 10:00–11:00
  await createEvent(page, {
    title: `Busy Slot Meeting ${timestamp}`,
    startsAt: "2026-09-15T10:00",
    endsAt: "2026-09-15T11:00",
    resourceLabel: `${roomAlpha} (equipment, cap: 5)`,
  });

  // 4. User 2 is free 10:00–12:00
  await logOut(page);
  const user2Email = `e2e-color-user2-${timestamp}@example.com`;
  await register(page, "Coloring Tester", user2Email);

  // 5. Find a time with automatic allocation
  await goToFindTime(page);
  await page.getByLabel("Window start").fill("2026-09-15T10:00");
  await page.getByLabel("Window end").fill("2026-09-15T12:00");
  await page.getByLabel("Duration (minutes)").fill("60");
  await page.getByLabel("Step (minutes)").fill("60");
  await page.getByLabel("Required attendees").fill("4");

  const autoCheckbox = page.getByLabel("Automatically allocate a resource");
  await autoCheckbox.check();
  await expect(autoCheckbox).toBeChecked();

  await expect(page.getByLabel("Required resource (Optional)")).toBeDisabled();

  await page.getByLabel("Resource type preference").selectOption("equipment");

  await page.getByRole("button", { name: "Find available slots" }).click();

  const slotRegion = page.getByRole("region", { name: "Available slots" });
  await expect(slotRegion).toBeVisible();

  // 6. Resources are shared across users, so kits from earlier runs may also
  //    exist. Every run books its Alpha Kit at 10:00, so:
  //    10:00–11:00: every Alpha Kit is busy, so a Beta Kit is allocated.
  //    11:00–12:00: Alpha Kits are free and sort first, so an Alpha Kit is allocated.
  const tenOClock = slotRegion.locator(".slot-row", { hasText: "10:00–11:00" });
  const elevenOClock = slotRegion.locator(".slot-row", { hasText: "11:00–12:00" });
  await expect(tenOClock).toContainText("Allocated: Beta Kit");
  await expect(elevenOClock).toContainText("Allocated: Alpha Kit");

  // 7. Pick the 10:00 slot (Beta Kit allocated)
  await tenOClock.click();

  // 8. The composer is filled in
  await expect(page).toHaveURL(`${DASHBOARD_URL}/events/new`);
  await expect(page.getByLabel("Starts")).toHaveValue("2026-09-15T10:00");
  await expect(page.getByLabel("Ends")).toHaveValue("2026-09-15T11:00");
  await expect(page.getByLabel("Expected attendees")).toHaveValue("4");

  // 9. Save
  await page.getByLabel("Title").fill(`Allocated Meeting ${timestamp}`);
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByText("Event created successfully")).toBeVisible();
  await expect(
    page.locator(".event-row h3", { hasText: `Allocated Meeting ${timestamp}` }),
  ).toBeVisible();
});

test("Phase J: shared meeting confirmation, invitation inbox RSVP, and organizer cancellation flow", async ({
  page,
}) => {
  const timestamp = Date.now();
  const organizerEmail = `e2e-organizer-${timestamp}@example.com`;
  const inviteeEmail = `e2e-invitee-${timestamp}@example.com`;

  // 1. Register invitee, then organizer
  await register(page, "Invitee User", inviteeEmail);
  await logOut(page);
  await register(page, "Organizer User", organizerEmail);

  // 3. Confirm a shared meeting with the invitee
  const meetingTitle = `Shared Sync ${timestamp}`;
  await goToNewEvent(page);
  await page.getByLabel("Title").fill(meetingTitle);
  await page.getByLabel("Description").fill("Quarterly alignment");
  await page.getByLabel("Starts").fill("2026-11-20T10:00");
  await page.getByLabel("Ends").fill("2026-11-20T11:00");
  const invitePicker = page.getByRole("combobox", { name: "Invite registered users" });
  await invitePicker.fill(inviteeEmail);
  await invitePicker.press("Enter");
  await expect(
    page.getByRole("region", { name: "Selected participant chips" }),
  ).toContainText(inviteeEmail);

  // With someone invited, "Create event" is replaced by "Confirm shared meeting".
  await expect(page.getByRole("button", { name: "Create event" })).toHaveCount(0);
  const confirmBtn = page.getByRole("button", { name: "Confirm shared meeting" });
  await expect(confirmBtn).toBeVisible();
  await confirmBtn.click();

  await expect(page).toHaveURL(`${DASHBOARD_URL}/events`);
  await expect(page.getByText("Shared meeting confirmed successfully!")).toBeVisible();
  const organizerRow = page.locator(".event-row", { hasText: meetingTitle });
  await expect(organizerRow).toBeVisible();
  await expect(organizerRow).toContainText(inviteeEmail);
  await expect(organizerRow.locator(".status-badge", { hasText: "pending" })).toBeVisible();

  // 4. Invitee signs in
  await logOut(page);
  await logIn(page, inviteeEmail);

  // 5. Invitation is in the Overview inbox
  const invCard = page.locator(".invite-item", { hasText: meetingTitle });
  await expect(invCard).toBeVisible();
  await expect(invCard.getByText(organizerEmail)).toBeVisible();

  await invCard.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Invitation accepted successfully")).toBeVisible();

  // The meeting is on the invitee's Events list as accepted
  await goToEvents(page);
  const attendeeRow = page.locator(".event-row", { hasText: meetingTitle });
  await expect(attendeeRow).toBeVisible();
  await expect(attendeeRow.locator(".status-badge", { hasText: "accepted" })).toBeVisible();

  // 6. Organizer signs back in
  await logOut(page);
  await logIn(page, organizerEmail);

  // 7. Organizer sees the acceptance and cancels the meeting
  await goToEvents(page);
  const organizerEventRow = page.locator(".event-row", { hasText: meetingTitle });
  await expect(organizerEventRow).toBeVisible();
  await expect(organizerEventRow.locator(".status-badge", { hasText: "accepted" })).toBeVisible();

  const cancelBtn = organizerEventRow.getByRole("button", { name: "Cancel meeting" });
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();

  await expect(page.getByText("Meeting cancelled successfully")).toBeVisible();
  await expect(organizerEventRow.locator(".status-badge", { hasText: "Cancelled" })).toBeVisible();
});
