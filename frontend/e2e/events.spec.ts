import { test, expect } from "@playwright/test";

// --- Auth redirect (no data needed) ---

test("unauthenticated user is redirected to login from /events", async ({ page }) => {
  await page.goto("/events");
  await expect(page).toHaveURL(/\/login/);
});

// --- Schema management tests ---

const timestamp = Date.now();
const adminEmail = `events-schema-${timestamp}@example.com`;
const password = "password123";

let studyId = "";

test.describe.serial("Event Schema Management", () => {
  test("setup: register and create study", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Register" }).click();
    await page.waitForURL("/dashboard");

    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name").fill("Schema Test Project");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("link", { name: "Schema Test Project" }).click();

    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Schema Test Study");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("link", { name: "Schema Test Study" }).click();
    // Wait for the study detail page to load before reading the URL,
    // otherwise page.url() may still reflect the project page (race with client-side navigation)
    await page.waitForURL(/\/projects\/.*\/studies\/.*/);

    studyId = new URL(page.url()).pathname.split("/").pop()!;
    expect(studyId).toBeTruthy();
  });

  test("shows empty state and write controls for owner", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`/events?study_id=${studyId}`);

    await expect(page.getByRole("heading", { name: "Event Types" })).toBeVisible();
    await expect(page.getByText("0 event types defined")).toBeVisible();
    await expect(page.getByText("No event types defined yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add row" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import CSV" })).toBeVisible();
  });

  test("adds event type via inline row", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`/events?study_id=${studyId}`);
    await expect(page.getByText("No event types defined yet.")).toBeVisible();

    await page.getByRole("button", { name: "Add row" }).click();

    const nameInput = page.getByPlaceholder("event_type_name");
    await expect(nameInput).toBeFocused();
    await nameInput.fill("button_clicked");
    // Description… may also appear in the header row description column for new row
    await page.getByPlaceholder("Description…").last().fill("User clicked a button");

    await page.getByTitle("Save").click();

    // Wait for the new row to be removed (confirms server action succeeded)
    await expect(nameInput).not.toBeVisible();

    // Reload to confirm persistence via fresh useEffect fetch
    await page.goto(`/events?study_id=${studyId}`);
    await expect(page.getByText("button_clicked")).toBeVisible();
    await expect(page.getByText("User clicked a button")).toBeVisible();
    await expect(page.getByText("1 event type defined")).toBeVisible();
  });

  test("adds event type with payload fields", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`/events?study_id=${studyId}`);
    await expect(page.getByText("button_clicked")).toBeVisible();

    await page.getByRole("button", { name: "Add row" }).click();
    await page.getByPlaceholder("event_type_name").fill("answer_submitted");

    // Expand inline field editor
    await page.getByRole("button", { name: "Add fields" }).click();

    // Add one field
    await page.getByRole("button", { name: "Add field" }).click();
    await page.getByPlaceholder("field_name").fill("correct");

    // Save
    await page.getByTitle("Save").click();
    await expect(page.getByPlaceholder("event_type_name")).not.toBeVisible();

    // Reload to confirm field badge appears
    await page.goto(`/events?study_id=${studyId}`);
    await expect(page.getByText("answer_submitted")).toBeVisible();
    await expect(page.getByText("correct")).toBeVisible();
  });

  test("imports event types from CSV", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`/events?study_id=${studyId}`);
    await expect(page.getByText("button_clicked")).toBeVisible();

    const csvContent = [
      "event_type,description,field_name,field_type,required",
      "session_started,Session began,,,",
      "hint_requested,Hint shown,hint_type,string,true",
    ].join("\n");

    // Upload CSV directly to the hidden file input
    await page
      .locator('input[type="file"][accept=".csv,text/csv"]')
      .setInputFiles({
        name: "events.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvContent),
      });

    // Status message confirms import
    await expect(page.getByText(/Imported 2 event types/)).toBeVisible();

    // Reload to confirm persistence
    await page.goto(`/events?study_id=${studyId}`);
    await expect(page.getByText("session_started")).toBeVisible();
    await expect(page.getByText("hint_requested")).toBeVisible();
  });

  test("deletes event type", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`/events?study_id=${studyId}`);
    await expect(page.getByText("session_started")).toBeVisible();

    // Accept the confirm() dialog
    page.on("dialog", (dialog) => dialog.accept());

    // Find session_started row and click its delete button (last button in the row)
    const sessionRow = page
      .getByRole("row")
      .filter({ hasText: "session_started" })
      .first();
    await sessionRow.locator("button").last().click();

    // Reload to confirm deletion
    await page.goto(`/events?study_id=${studyId}`);
    await expect(page.getByText("session_started")).not.toBeVisible();
    // Other event types should remain
    await expect(page.getByText("hint_requested")).toBeVisible();
  });
});
