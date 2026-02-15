import { test, expect } from "@playwright/test";

test("unauthenticated user is redirected to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("unauthenticated user cannot access projects", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login/);
});

test("register, login, and reach dashboard", async ({ page }) => {
  const email = `test-${Date.now()}@example.com`;
  const password = "password123";

  // Register
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Register" }).click();

  // Should land on dashboard after registration
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
