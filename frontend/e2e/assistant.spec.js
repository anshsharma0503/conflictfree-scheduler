import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./e2eEnv.js";

// Phase N through the real stack, including the real Gemini API (the E2E
// backend reads GEMINI_API_KEY from backend/.env). One model call per run.
// Assertions only check what the server guarantees after validation, not
// the model's exact wording.

const DASHBOARD_URL = `${E2E_BASE_URL}/dashboard`;

async function register(page, name, email) {
  await page.goto("/register");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(DASHBOARD_URL);
}

test("a sentence becomes a filled search, ranked times and a prefilled meeting", async ({ browser }) => {
  // A real model call (with a possible fallback) can take far longer than
  // Playwright's default 30s test budget.
  test.setTimeout(120_000);
  const stamp = Date.now();
  const inviteeContext = await browser.newContext();
  const organizerContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();
  const page = await organizerContext.newPage();

  try {
    await register(invitee, "Orla Fenwick", `as-orla-${stamp}@example.com`);
    await register(page, "Assistant Organizer", `as-org-${stamp}@example.com`);

    await page.getByRole("link", { name: "Find a time", exact: true }).click();
    const box = page.getByLabel("Describe the meeting");
    await expect(box).toBeVisible({ timeout: 15000 });

    await box.fill("45 minute design review with Orla Fenwick tomorrow afternoon");

    // Gemini can be briefly over capacity even after the server's own
    // retries; then the UI says "busy" and a user would simply try again.
    const result = page.locator(".assistant-result");
    const busy = page.getByRole("alert").filter({ hasText: /busy right now/ });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await page.getByRole("button", { name: "Understand" }).click();
      await expect(result.or(busy)).toBeVisible({ timeout: 45000 });
      if (await result.isVisible()) break;
      await page.waitForTimeout(3000);
    }

    // Server-side guarantees: the person is resolved to the real account,
    // and the length comes back validated.
    await expect(result.locator(".tag-free", { hasText: "Orla Fenwick" })).toBeVisible();
    await expect(result.getByText("45 min")).toBeVisible();

    await page.getByRole("button", { name: "Search these times" }).click();
    await expect(page.getByLabel("Duration (minutes)")).toHaveValue("45");
    const firstSlot = page.locator(".slot-row").first();
    await expect(firstSlot).toBeVisible({ timeout: 30000 });

    // Picking a suggestion opens the composer with the parsed title and the
    // invitee, ready to confirm as a shared meeting.
    await firstSlot.click();
    await expect(page).toHaveURL(`${DASHBOARD_URL}/events/new`);
    await expect(page.getByLabel("Title")).toHaveValue(/design review/i);
    await expect(page.getByRole("button", { name: "Confirm shared meeting" })).toBeVisible();
  } finally {
    await inviteeContext.close();
    await organizerContext.close();
  }
});
