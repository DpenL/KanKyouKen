import { test, expect } from "@playwright/test";

const timestamp = Date.now();
const email = `researcher-pipeline-${timestamp}@example.com`;
const password = "password123";

test.describe.serial("Pipeline script management", () => {
  let studyUrl: string;

  test("researcher registers, creates project and study", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
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
    expect(studyUrl).toMatch(/\/studies\//);
  });

  test("pipeline settings page shows built-in and custom sections", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/pipeline`);
    await expect(page.getByRole("heading", { name: "Pipeline Scripts" })).toBeVisible();
    await expect(page.getByText("Built-in", { exact: true })).toBeVisible();
    await expect(page.getByText("Custom (this study)", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add script" })).toBeVisible();
  });

  test("researcher can add a custom script", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/pipeline`);
    await page.getByRole("button", { name: "+ Add script" }).click();

    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByLabel("Name").fill("my-analytics-script");
    await page.getByLabel("Endpoint URL").fill("/functions/v1/my-analytics-script");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    await expect(page.getByText("my-analytics-script")).toBeVisible();
  });

  test("researcher can edit a custom script", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/pipeline`);

    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const nameInput = page.getByLabel("Name");
    await nameInput.clear();
    await nameInput.fill("my-analytics-script-v2");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    await expect(page.getByText("my-analytics-script-v2")).toBeVisible();
  });

  test("researcher can delete a custom script", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/pipeline`);
    await expect(page.getByText("my-analytics-script-v2")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).first().click();

    await expect(page.getByText("my-analytics-script-v2")).not.toBeVisible();
    await expect(
      page.getByText("No custom scripts yet.", { exact: false }),
    ).toBeVisible();
  });

  test("add script dialog validates required fields", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/pipeline`);
    await page.getByRole("button", { name: "+ Add script" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Try saving without filling required fields
    await page.getByRole("button", { name: "Save" }).click();

    // Dialog should remain open (validation error)
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByText("Name and Endpoint URL are required.", { exact: false }),
    ).toBeVisible();
  });

  test("add script dialog rejects invalid config JSON", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    await page.goto(`${studyUrl}/settings/pipeline`);
    await page.getByRole("button", { name: "+ Add script" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByLabel("Name").fill("test-script");
    await page.getByLabel("Endpoint URL").fill("/functions/v1/test");
    await page.getByLabel("Config JSON (optional)").fill("{ not valid json");

    await expect(page.getByText("Invalid JSON")).toBeVisible();
    // Save button should be disabled
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
