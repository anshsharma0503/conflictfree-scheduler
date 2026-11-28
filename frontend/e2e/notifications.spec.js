import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./e2eEnv.js";

// Phase M through the real stack: browser → API → BullMQ (Docker Redis) →
// worker → MongoDB → Socket.io → browser. Pages are never reloaded while
// waiting, so a notification can only appear if the worker delivered it.

const DASHBOARD_URL = `${E2E_BASE_URL}/dashboard`;

async function register(page, name, email) {
  await page.goto("/register");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(DASHBOARD_URL);
  await expect(page.locator(".live-indicator")).toHaveText("Live", { timeout: 15000 });
}

function bell(page) {
  return page.getByRole("button", { name: /^Notifications/ });
}

async function openPanel(page) {
  await bell(page).click();
  return page.getByRole("dialog", { name: "Notifications" });
}

test("invitation, RSVP and cancellation notifications reach the other user live", async ({
  browser,
}) => {
  const stamp = Date.now();
  const organizerEmail = `nt-org-${stamp}@example.com`;
  const inviteeEmail = `nt-inv-${stamp}@example.com`;
  const title = `Notify Sync ${stamp}`;

  const organizerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const organizer = await organizerContext.newPage();
  const invitee = await inviteeContext.newPage();

  try {
    await register(invitee, "Notify Invitee", inviteeEmail);
    await register(organizer, "Notify Organizer", organizerEmail);
    await expect(bell(invitee)).toHaveAccessibleName("Notifications");

    // Organizer confirms a shared meeting through the composer.
    await organizer.getByRole("link", { name: "New event", exact: true }).click();
    await organizer.getByLabel("Title").fill(title);
    await organizer.getByLabel("Starts").fill("2026-12-09T10:00");
    await organizer.getByLabel("Ends").fill("2026-12-09T11:00");
    const picker = organizer.getByRole("combobox", { name: "Invite registered users" });
    await picker.fill(inviteeEmail);
    await picker.press("Enter");
    await organizer.getByRole("button", { name: "Confirm shared meeting" }).click();
    await expect(organizer).toHaveURL(`${DASHBOARD_URL}/events`);

    // Invitee: the bell badge and panel update without a reload.
    await expect(bell(invitee)).toHaveAccessibleName("Notifications, 1 unread", { timeout: 15000 });
    const inviteePanel = await openPanel(invitee);
    await expect(
      inviteePanel.getByRole("button", { name: new RegExp(`Notify Organizer invited you to “${title}”`) }),
    ).toBeVisible();
    await invitee.keyboard.press("Escape");

    // Invitee accepts; the organizer is notified.
    const inviteCard = invitee.locator(".invite-item", { hasText: title });
    await inviteCard.getByRole("button", { name: "Accept" }).click();
    await expect(bell(organizer)).toHaveAccessibleName("Notifications, 1 unread", { timeout: 15000 });
    const organizerPanel = await openPanel(organizer);
    await expect(organizerPanel.getByText(`Notify Invitee accepted “${title}”`)).toBeVisible();
    await organizer.keyboard.press("Escape");

    // Organizer cancels; the invitee is notified.
    const organizerRow = organizer.locator(".event-row", { hasText: title });
    await organizerRow.getByRole("button", { name: "Cancel meeting" }).click();
    await expect(bell(invitee)).toHaveAccessibleName("Notifications, 2 unread", { timeout: 15000 });

    // Mark all as read clears the badge, and stays cleared after a reload.
    const panel = await openPanel(invitee);
    await expect(panel.getByText(`Notify Organizer cancelled “${title}”`)).toBeVisible();
    await panel.getByRole("button", { name: "Mark all as read" }).click();
    await expect(bell(invitee)).toHaveAccessibleName("Notifications");
    await invitee.reload();
    await expect(bell(invitee)).toHaveAccessibleName("Notifications");
  } finally {
    await organizerContext.close();
    await inviteeContext.close();
  }
});

test("a reminder arrives from the background sweep and the lead time is saved", async ({ page }) => {
  const stamp = Date.now();
  const title = `Reminder Check ${stamp}`;

  await register(page, "Reminder User", `nt-rem-${stamp}@example.com`);

  // Create the event with a fetch from inside the page (the browser's own
  // HTTP-only session cookie), so the start time is exact regardless of the
  // machine's timezone.
  const startAt = new Date(Date.now() + 10 * 60_000);
  const status = await page.evaluate(
    async (body) => {
      const response = await fetch("/api/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return response.status;
    },
    {
      title,
      startAt: startAt.toISOString(),
      endAt: new Date(startAt.getTime() + 30 * 60_000).toISOString(),
      timezone: "UTC",
    },
  );
  expect(status).toBe(201);

  // The default 15-minute lead covers an event 10 minutes away; the sweep
  // runs every 2s in E2E.
  await expect(page.getByText(new RegExp(`Reminder: “${title}” starts in (9|10) minutes`))).toBeVisible({
    timeout: 20000,
  });
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");

  // Change the reminder lead time; it persists across a reload.
  const panel = await openPanel(page);
  const select = panel.getByLabel("Event reminders");
  await expect(select).toHaveValue("15");
  await select.selectOption("60");
  await expect(select).toHaveValue("60");

  await page.reload();
  const reloaded = await openPanel(page);
  await expect(reloaded.getByLabel("Event reminders")).toHaveValue("60");
  await expect(reloaded.getByRole("note")).toHaveCount(0);
});
