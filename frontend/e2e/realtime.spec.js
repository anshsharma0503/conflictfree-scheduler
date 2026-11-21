import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./e2eEnv.js";

// Phase L: two real users in two isolated browser contexts (separate cookie
// jars). Every assertion on the "other" user's page happens WITHOUT a reload,
// so it can only pass if the update arrived over Socket.io.

const DASHBOARD_URL = `${E2E_BASE_URL}/dashboard`;

async function register(page, name, email) {
  await page.goto("/register");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(DASHBOARD_URL);
}

async function expectLive(page) {
  await expect(page.locator(".live-indicator")).toHaveText("Live", { timeout: 15000 });
}

test("invitations, RSVPs, cancellations and resource changes reach the other user live", async ({
  browser,
}) => {
  const stamp = Date.now();
  const organizerEmail = `rt-org-${stamp}@example.com`;
  const inviteeEmail = `rt-inv-${stamp}@example.com`;
  const meetingTitle = `Live Sync ${stamp}`;
  const roomName = `Live Room ${stamp}`;

  const organizerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const organizer = await organizerContext.newPage();
  const invitee = await inviteeContext.newPage();

  try {
    await register(invitee, "Live Invitee", inviteeEmail);
    await expectLive(invitee);
    await register(organizer, "Live Organizer", organizerEmail);
    await expectLive(organizer);

    // Organizer confirms a shared meeting with the invitee.
    await organizer.getByRole("link", { name: "New event", exact: true }).click();
    await organizer.getByLabel("Title").fill(meetingTitle);
    await organizer.getByLabel("Starts").fill("2026-12-08T10:00");
    await organizer.getByLabel("Ends").fill("2026-12-08T11:00");
    const picker = organizer.getByRole("combobox", { name: "Invite registered users" });
    await picker.fill(inviteeEmail);
    await picker.press("Enter");
    await organizer.getByRole("button", { name: "Confirm shared meeting" }).click();
    await expect(organizer).toHaveURL(`${DASHBOARD_URL}/events`);
    const organizerRow = organizer.locator(".event-row", { hasText: meetingTitle });
    await expect(organizerRow.locator(".status-badge", { hasText: "pending" })).toBeVisible();

    // Invitee's Overview (never reloaded) shows the invitation.
    await expect(invitee.getByText(`New invitation: ${meetingTitle}`)).toBeVisible();
    const inviteCard = invitee.locator(".invite-item", { hasText: meetingTitle });
    await expect(inviteCard).toBeVisible();
    await expect(invitee.locator(".count-badge")).toContainText("1");

    // Invitee accepts; the organizer's Events page updates live.
    await inviteCard.getByRole("button", { name: "Accept" }).click();
    await expect(invitee.getByText("Invitation accepted successfully")).toBeVisible();
    await expect(organizerRow.locator(".status-badge", { hasText: "accepted" })).toBeVisible();

    // Organizer cancels; the invitee's Events page updates live.
    await invitee.getByRole("link", { name: "Events", exact: true }).click();
    const inviteeRow = invitee.locator(".event-row", { hasText: meetingTitle });
    await expect(inviteeRow.locator(".status-badge", { hasText: "accepted" })).toBeVisible();

    await organizerRow.getByRole("button", { name: "Cancel meeting" }).click();
    await expect(organizer.getByText("Meeting cancelled successfully")).toBeVisible();
    await expect(inviteeRow.locator(".status-badge", { hasText: "Cancelled" })).toBeVisible();

    // A new shared room created by the organizer appears on the invitee's
    // Rooms & equipment page live.
    await invitee.getByRole("link", { name: "Rooms & equipment", exact: true }).click();
    await expect(invitee.getByText(roomName)).toHaveCount(0);

    await organizer.getByRole("link", { name: "Rooms & equipment", exact: true }).click();
    await organizer.getByLabel("Resource name").fill(roomName);
    await organizer.getByLabel("Capacity").fill("6");
    await organizer.getByRole("button", { name: "Create resource" }).click();
    await expect(organizer.getByText(roomName)).toBeVisible();

    await expect(invitee.getByText(roomName)).toBeVisible();

    // Logging out closes the socket; the other user is unaffected.
    await invitee.getByRole("button", { name: "Log out" }).click();
    await expectLive(organizer);
  } finally {
    await organizerContext.close();
    await inviteeContext.close();
  }
});
