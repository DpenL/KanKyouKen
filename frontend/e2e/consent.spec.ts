import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const timestamp = Date.now();
const researcherEmail = `researcher-consent-${timestamp}@example.com`;
const participantEmail = `participant-consent-${timestamp}@example.com`;
const password = "password123";

// Service client for direct DB setup (bypasses RLS)
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

test.describe.serial("Consent flow", () => {
  let studyId: string;
  let studyUrl: string;

  test("researcher registers and creates a study", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(researcherEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Register" }).click();
    await page.waitForURL("/dashboard");

    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name").fill("Consent Test Project");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await page.getByRole("link", { name: "Consent Test Project" }).click();
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Consent Test Study");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await page.getByRole("link", { name: "Consent Test Study" }).click();
    await page.waitForURL(/\/projects\/.*\/studies\/.*/);
    studyUrl = page.url();
    studyId = studyUrl.match(/studies\/([^/]+)/)?.[1] ?? "";
    expect(studyId).toBeTruthy();
  });

  test("consent settings page is reachable", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(researcherEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/consent`);
    await expect(page.getByRole("heading", { name: "Consent Form" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  });

  test("researcher can save consent config with custom text", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(researcherEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/consent`);
    await page.getByLabel(/Additional consent text/).fill("This study collects kanji response times.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  });

  test("participant consent page loads with custom text", async ({ page }) => {
    // Seed the participant auth user directly — no UI registration needed
    const supabase = serviceClient();
    const { error: authError } = await supabase.auth.admin.createUser({
      email: participantEmail,
      password,
      email_confirm: true,
    });
    expect(authError).toBeNull();

    const { data: participant, error: insertError } = await supabase
      .from("participants")
      .insert({ pseudonym: `e2e-participant-${timestamp}` })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    expect(participant).toBeTruthy();

    await page.goto("/login");
    await page.getByLabel("Email").fill(participantEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    try {
      await page.goto(
        `/study/${studyId}/consent?participant_id=${participant!.id}`,
        { waitUntil: "networkidle" },
      );

      await expect(page.getByText("Consent Test Study")).toBeVisible();
      await expect(page.getByText("kanji response times")).toBeVisible();
    } finally {
      await supabase.from("participants").delete().eq("id", participant!.id);
    }
  });

  test("participant must scroll before checkbox is enabled", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(participantEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    const supabase = serviceClient();
    const { data: participant, error: insertError } = await supabase
      .from("participants")
      .insert({ pseudonym: `e2e-scroll-${timestamp}` })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    expect(participant).toBeTruthy();

    try {
      await page.goto(`/study/${studyId}/consent?participant_id=${participant!.id}`, { waitUntil: "networkidle" });

      // Checkbox should be disabled until scrolled
      const checkbox = page.getByRole("checkbox", { name: /I have read/ });
      await expect(checkbox).toBeDisabled();

      // Scroll the consent content area to the bottom and fire the scroll event.
      // Dispatch is needed because when content is short (no overflow) the browser
      // clamps scrollTop to 0 and never emits a scroll event natively.
      await page.evaluate(() => {
        const el = document.querySelector("[data-testid=consent-scroll]") ??
          document.querySelector(".overflow-y-auto");
        if (el) {
          el.scrollTop = el.scrollHeight;
          el.dispatchEvent(new Event("scroll"));
        }
      });

      await expect(checkbox).toBeEnabled({ timeout: 5000 });
    } finally {
      await supabase.from("participants").delete().eq("id", participant!.id);
    }
  });

  test("participant can submit consent", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(participantEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    const supabase = serviceClient();
    const { data: participant, error: insertError } = await supabase
      .from("participants")
      .insert({ pseudonym: `e2e-submit-${timestamp}` })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    expect(participant).toBeTruthy();

    try {
      await page.goto(`/study/${studyId}/consent?participant_id=${participant!.id}`, { waitUntil: "networkidle" });

      // Scroll to bottom to enable checkbox
      await page.evaluate(() => {
        const el = document.querySelector(".overflow-y-auto");
        if (el) {
          el.scrollTop = el.scrollHeight;
          el.dispatchEvent(new Event("scroll"));
        }
      });

      await page.getByRole("checkbox", { name: /I have read/ }).check();
      await page.getByRole("button", { name: "Submit consent" }).click();

      await expect(page.getByText("Consent recorded")).toBeVisible({ timeout: 10000 });

      // Verify in DB
      const { data: record } = await supabase
        .from("consent_records")
        .select("consent_status")
        .eq("participant_id", participant!.id)
        .eq("study_id", studyId)
        .single();
      expect(record?.consent_status).toBe("granted");
    } finally {
      await supabase.from("consent_records").delete().eq("participant_id", participant!.id);
      await supabase.from("participants").delete().eq("id", participant!.id);
    }
  });

  test("duplicate consent submission shows conflict message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(participantEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    const supabase = serviceClient();
    const { data: participant, error: insertError } = await supabase
      .from("participants")
      .insert({ pseudonym: `e2e-dup-${timestamp}` })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    expect(participant).toBeTruthy();

    try {
      // Pre-insert a granted consent
      await supabase.from("consent_records").insert({
        participant_id: participant!.id,
        study_id: studyId,
        consent_version: "1.0",
        consent_status: "granted",
        granted_at: new Date().toISOString(),
      });

      await page.goto(`/study/${studyId}/consent?participant_id=${participant!.id}`, { waitUntil: "networkidle" });

      await page.evaluate(() => {
        const el = document.querySelector(".overflow-y-auto");
        if (el) {
          el.scrollTop = el.scrollHeight;
          el.dispatchEvent(new Event("scroll"));
        }
      });

      await page.getByRole("checkbox", { name: /I have read/ }).check();
      await page.getByRole("button", { name: "Submit consent" }).click();

      await expect(page.getByText(/already/i)).toBeVisible({ timeout: 5000 });
    } finally {
      await supabase.from("consent_records").delete().eq("participant_id", participant!.id);
      await supabase.from("participants").delete().eq("id", participant!.id);
    }
  });

  test("invalid study ID shows not found message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(participantEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(
      "/study/00000000-0000-0000-0000-000000000000/consent?participant_id=00000000-0000-0000-0000-000000000001",
      { waitUntil: "networkidle" },
    );
    await expect(page.getByText(/not found/i)).toBeVisible();
  });

  test("missing participant_id shows error message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(participantEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`/study/${studyId}/consent`, { waitUntil: "networkidle" });
    await expect(page.getByText(/missing participant/i)).toBeVisible();
  });
});

const pipelineEmail = `researcher-pipeline-${timestamp}@example.com`;

test.describe.serial("Pipeline settings", () => {
  let studyUrl: string;

  test("researcher registers and creates a study for pipeline tests", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(pipelineEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Register" }).click();
    await page.waitForURL("/dashboard");

    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name").fill("Pipeline Test Project");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await page.getByRole("link", { name: "Pipeline Test Project" }).click();
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Pipeline Test Study");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await page.getByRole("link", { name: "Pipeline Test Study" }).click();
    await page.waitForURL(/\/projects\/.*\/studies\/.*/);
    studyUrl = page.url();
  });

  test("pipeline settings page is reachable", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(pipelineEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/pipeline`);
    await expect(page.getByRole("heading", { name: "Pipeline Scripts" })).toBeVisible();
  });

  test("shows empty state when no scripts are registered", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(pipelineEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/pipeline`);
    const hasScripts = await page.getByRole("switch").count() > 0;
    if (!hasScripts) {
      await expect(page.getByText(/No pipeline scripts/i)).toBeVisible();
    }
  });
});
