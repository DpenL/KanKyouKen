import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Tests that need a fresh registered user + project before each test
// ---------------------------------------------------------------------------

test.describe("Study management", () => {
  test.beforeEach(async ({ page }) => {
    const email = `test-${Date.now()}@example.com`;
    const password = "password123";

    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Create a project to attach studies to
    await page.goto("/projects");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name").fill("Study test project");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByText("Study test project").click();
    await expect(page.getByRole("heading", { name: "Study test project" })).toBeVisible();
  });

  test("project detail shows empty studies state", async ({ page }) => {
    await expect(page.getByText("No studies yet.")).toBeVisible();
  });

  test("create a study and see it in the list", async ({ page }) => {
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("My first study");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("My first study")).toBeVisible();
  });

  test("clicking a study navigates to its detail page", async ({ page }) => {
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Detail study");
    await page.getByRole("button", { name: "Create" }).click();

    await page.getByText("Detail study").click();
    await expect(page.getByRole("heading", { name: "Detail study" })).toBeVisible();
    await expect(page.getByText("Study test project")).toBeVisible();
  });

  test("study detail page shows overview and empty participants state", async ({ page }) => {
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Overview test study");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByText("Overview test study").click();
    await page.waitForURL(/\/projects\/.*\/studies\/.*/);

    // Overview section header is always present
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();

    // Fresh study has no study_metrics row yet — LiveAnalytics shows empty state
    await expect(page.getByText("No metrics yet")).toBeVisible();

    // Event breakdown section: empty state for a fresh study
    await expect(page.getByRole("heading", { name: "Event breakdown", exact: true })).toBeVisible();
    await expect(page.getByText("No data collected yet.")).toBeVisible();

    // Members section present (content covered by invites.spec.ts)
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  });

  test("study page has Overview and Monitoring tabs", async ({ page }) => {
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Tab test study");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByText("Tab test study").click();
    await page.waitForURL(/\/projects\/.*\/studies\/.*/);

    await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Monitoring" })).toBeVisible();
  });

  test("monitoring tab shows participants heading and events heading", async ({ page }) => {
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Monitor test study");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByText("Monitor test study").click();
    await page.waitForURL(/\/projects\/.*\/studies\/.*/);

    await page.getByRole("link", { name: "Monitoring" }).click();
    await page.waitForURL(/\/monitor$/);

    await expect(page.getByRole("heading", { name: "Data Health", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Participants", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
  });

  test("dashboard study count increments after creating a study", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("study-count")).toHaveText("0");

    await page.goto("/projects");
    await page.getByText("Study test project").click();
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Count study");
    await page.getByRole("button", { name: "Create" }).click();

    // Wait for study to appear in the list before checking dashboard
    await expect(page.getByText("Count study")).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByTestId("study-count")).toHaveText("1");
  });
});

// ---------------------------------------------------------------------------
// Monitoring tab — full workflow with seeded events
// (self-contained: registers its own user once, no beforeEach overhead)
// ---------------------------------------------------------------------------

const monitorTimestamp = Date.now();
const monitorEmail = `monitor-${monitorTimestamp}@example.com`;
const monitorPassword = "password123";
let monitorStudyUrl = "";

test.describe.serial("Monitoring tab with events", () => {
  test("setup: create study and seed events", async ({ page }) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // Register
    await page.goto("/register");
    await page.getByLabel("Email").fill(monitorEmail);
    await page.getByLabel("Password").fill(monitorPassword);
    await page.getByRole("button", { name: "Register" }).click();
    await page.waitForURL("/dashboard");

    // Create project + study
    await page.goto("/projects");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name").fill("Monitor Project");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByText("Monitor Project").click();
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Monitor Study");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByText("Monitor Study").click();
    await page.waitForURL(/\/projects\/.*\/studies\/.*/);

    monitorStudyUrl = page.url();
    const studyId = monitorStudyUrl.split("/studies/")[1].split("/")[0];

    // Seed: insert participant + events via REST API using service role key
    const headers = {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=representation",
    };

    // Insert a participant
    const participantId = crypto.randomUUID();
    // Use studyId-scoped pseudonym so retries with a new study don't collide
    const pseudonym = `p_monitor_${studyId.slice(0, 8)}`;
    await fetch(`${supabaseUrl}/rest/v1/participants`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: participantId, pseudonym }),
    });

    // Insert events with response_time_ms payloads
    const events = [1200, 1800, 2400].map((rt) => ({
      study_id: studyId,
      participant_id: participantId,
      event_type: "answer_submitted",
      payload: { response_time_ms: rt, correct: true },
    }));
    await fetch(`${supabaseUrl}/rest/v1/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(events),
    });
  });

  test("monitoring tab shows seeded participant in table", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(monitorEmail);
    await page.getByLabel("Password").fill(monitorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(monitorStudyUrl + "/monitor");
    await page.waitForURL(/\/monitor$/);
    await page.waitForLoadState("networkidle");

    // Participant row should be visible (pseudonym or truncated UUID)
    await expect(page.getByText("p_monitor_")).toBeVisible();
  });

  test("clicking participant row filters event browser", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(monitorEmail);
    await page.getByLabel("Password").fill(monitorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(monitorStudyUrl + "/monitor");
    await page.waitForURL(/\/monitor$/);
    await page.waitForLoadState("networkidle");

    // Wait for initial events load before clicking participant
    await expect(page.getByText("answer_submitted").first()).toBeVisible();

    // Click the participant row to filter
    await page.getByText("p_monitor_").click();

    // Participant filter badge should appear in event browser
    await expect(page.getByText(/Participant:/)).toBeVisible();

    // Events table should show the seeded event type (wait for filtered fetch to complete)
    await expect(page.getByText("answer_submitted").first()).toBeVisible({ timeout: 10000 });
  });

  test("event row expands to show payload JSON", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(monitorEmail);
    await page.getByLabel("Password").fill(monitorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(monitorStudyUrl + "/monitor");
    await page.waitForURL(/\/monitor$/);
    await page.waitForLoadState("networkidle");

    // Wait for events to load then click the first event row
    await expect(page.getByText("answer_submitted").first()).toBeVisible();
    await page.getByText("answer_submitted").first().click();

    // Expanded payload should show JSON keys
    await expect(page.getByText(/"response_time_ms"/)).toBeVisible();
  });

  test("event browser updates in real-time when a new event arrives", async ({ page }) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    await page.goto("/login");
    await page.getByLabel("Email").fill(monitorEmail);
    await page.getByLabel("Password").fill(monitorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(monitorStudyUrl + "/monitor");
    await page.waitForURL(/\/monitor$/);
    await page.waitForLoadState("networkidle");

    // Confirm existing events are loaded
    await expect(page.getByText("answer_submitted").first()).toBeVisible();

    // Wait for the Realtime WebSocket subscription to be fully established
    // (networkidle covers the HTTP upgrade but not the Supabase protocol handshake)
    await page.waitForTimeout(2000);

    // Insert a new event with a unique event_type from outside the browser
    const studyId = monitorStudyUrl.split("/studies/")[1].split("/")[0];
    const uniqueEventType = `realtime_test_${Date.now()}`;

    await fetch(`${supabaseUrl}/rest/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify([{
        study_id: studyId,
        event_type: uniqueEventType,
        payload: { source: "e2e_realtime" },
      }]),
    });

    // Event should appear via Realtime WebSocket — no reload needed
    await expect(page.getByText(uniqueEventType)).toBeVisible({ timeout: 8000 });
  });

  test("Realtime does not deliver events from another user's study", async ({ page }) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // Register a second user who does not own monitorStudyUrl
    const otherEmail = `rls-other-${Date.now()}@example.com`;
    await page.goto("/register");
    await page.getByLabel("Email").fill(otherEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Register" }).click();
    await page.waitForURL("/dashboard");

    // Create their own project + study so they have a valid monitor page to sit on
    await page.goto("/projects");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name").fill("RLS Other Project");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByText("RLS Other Project").click();
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("RLS Other Study");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByText("RLS Other Study").click();
    await page.waitForURL(/\/projects\/.*\/studies\/.*/);

    const ownStudyUrl = page.url();
    await page.goto(ownStudyUrl + "/monitor");
    await page.waitForURL(/\/monitor$/);
    await page.waitForLoadState("networkidle");
    // Let the Realtime subscription fully establish
    await page.waitForTimeout(2000);

    // Insert an event into the *first* user's study (monitorStudyUrl) — should not reach this user
    const foreignStudyId = monitorStudyUrl.split("/studies/")[1].split("/")[0];
    const leakType = `rls_leak_${Date.now()}`;
    await fetch(`${supabaseUrl}/rest/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify([{
        study_id: foreignStudyId,
        event_type: leakType,
        payload: { source: "e2e_rls" },
      }]),
    });

    // Allow a generous window for delivery — if RLS is broken the event would appear by now
    await page.waitForTimeout(3000);

    // The event from the foreign study must NOT appear in this user's browser
    await expect(page.getByText(leakType)).not.toBeVisible();
  });
});
