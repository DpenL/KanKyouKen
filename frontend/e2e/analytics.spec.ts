import { test, expect } from "@playwright/test";

const timestamp = Date.now();
const email = `researcher-analytics-${timestamp}@example.com`;
const password = "password123";

test.describe.serial("Analytics dashboard", () => {
  let studyUrl: string;

  test("researcher registers, creates project and study", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Register" }).click();
    await page.waitForURL("/dashboard");

    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name").fill("Analytics Test Project");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await page.getByRole("link", { name: "Analytics Test Project" }).click();
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Analytics Test Study");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await page.getByRole("link", { name: "Analytics Test Study" }).click();
    await page.waitForURL(/\/projects\/.*\/studies\/.*/);
    studyUrl = page.url();
    expect(studyUrl).toMatch(/\/studies\//);
  });

  test("study page shows overview and event breakdown sections", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(studyUrl);
    await expect(page.getByRole("heading", { name: "Overview", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Event breakdown", level: 2 })).toBeVisible();
    await expect(page.getByText("No data collected yet.")).toBeVisible();
  });

  test("analytics section is hidden when no script outputs exist", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(studyUrl);
    // Analytics section only renders when script_outputs exist — check h2 specifically
    await expect(page.getByRole("heading", { name: "Analytics", level: 2 })).not.toBeVisible();
  });

  test("study page shows platform health widget", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(studyUrl);
    await expect(page.getByText("Platform Health")).toBeVisible();
    await expect(page.getByText("Status")).toBeVisible();
  });

  test("pipeline settings shows built-in participant-progress script", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/pipeline`);
    await expect(page.getByRole("heading", { name: "Pipeline Scripts" })).toBeVisible();
    await expect(page.getByText("Built-in", { exact: true })).toBeVisible();
    // participant-progress is registered as a global built-in
    await expect(page.getByText("participant-progress")).toBeVisible();
  });
});
