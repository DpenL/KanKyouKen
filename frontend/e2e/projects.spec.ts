import { test, expect } from "@playwright/test";

// Register and log in once for all tests in this file
test.beforeEach(async ({ page }) => {
  const email = `test-${Date.now()}@example.com`;
  const password = "password123";

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("projects page shows empty state for new user", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByText("No projects yet")).toBeVisible();
});

test("create a project and see it in the list", async ({ page }) => {
  await page.goto("/projects");

  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name").fill("My test project");
  await page.getByLabel("Description").fill("Created by Playwright");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("My test project")).toBeVisible();
});

test("dashboard project count increments after creating a project", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("project-count")).toHaveText("0");

  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name").fill("Count test project");
  await page.getByRole("button", { name: "Create" }).click();

  await page.goto("/dashboard");
  await expect(page.getByText("1")).toBeVisible();
});

test("clicking a project navigates to its detail page", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name").fill("Detail nav project");
  await page.getByRole("button", { name: "Create" }).click();

  await page.getByText("Detail nav project").click();
  await expect(page.getByRole("heading", { name: "Detail nav project" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
});
