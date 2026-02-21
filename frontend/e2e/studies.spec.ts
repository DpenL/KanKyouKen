import { test, expect } from "@playwright/test";

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

  // Overview section: 3 stat cards visible
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByText("Total events")).toBeVisible();
  await expect(page.getByText("Last event")).toBeVisible();

  // Participants section: empty state for a fresh study
  await expect(page.getByRole("heading", { name: "Participants" })).toBeVisible();
  await expect(page.getByText("No data collected yet.")).toBeVisible();

  // Members section present (content covered by invites.spec.ts)
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
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
