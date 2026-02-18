import { test, expect } from "@playwright/test";

// Generate unique emails per test run to avoid test pollution in CI
const timestamp = Date.now();
const adminEmail = `admin-invites-${timestamp}@example.com`;
const researcherEmail = `researcher-${timestamp}@example.com`;
const supervisorEmail = `supervisor-${timestamp}@example.com`;
const teacherEmail = `teacher-${timestamp}@example.com`;
const duplicateEmail = `duplicate-${timestamp}@example.com`;

// Tests must run sequentially - they share the same admin user/project/study
test.describe.serial("Study Invites", () => {
  test("shows empty members list on new study", async ({ page }) => {
    // Register new admin user
    await page.goto("/register");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Register" }).click();

    await page.waitForURL("/dashboard");
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name").fill("Invite Test Project");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await page.getByRole("link", { name: "Invite Test Project" }).click();
    await page.getByRole("button", { name: "New study" }).click();
    await page.getByLabel("Name").fill("Invite Test Study");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await page.getByRole("link", { name: "Invite Test Study" }).click();
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByText("No members yet")).toBeVisible();
  });

  test("generates invite link for researcher role", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("/dashboard");
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("link", { name: "Invite Test Project" }).first().click();
    await page.getByRole("link", { name: "Invite Test Study" }).first().click();

    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByRole("combobox", { name: "Role" }).selectOption("researcher");
    await page.getByRole("button", { name: "Generate link" }).click();

    // Should show the invite link
    const linkInput = page.getByLabel("Invite link");
    await expect(linkInput).toBeVisible();
    const link = await linkInput.inputValue();
    expect(link).toContain("/invite/");
    expect(link).toMatch(/\/invite\/[a-f0-9]{64}$/);

    // Should show expiration notice
    await expect(page.getByText(/expires in 7 days/i)).toBeVisible();
  });

  test("shows invite page for unauthenticated user", async ({ page }) => {
    // First create an invite as admin
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("/dashboard");
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("link", { name: "Invite Test Project" }).first().click();
    await page.getByRole("link", { name: "Invite Test Study" }).first().click();

    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByRole("combobox", { name: "Role" }).selectOption("teacher");
    await page.getByRole("button", { name: "Generate link" }).click();

    const linkInput = page.getByLabel("Invite link");
    const link = await linkInput.inputValue();
    const token = link.split("/invite/")[1];

    // Sign out
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign out" }).click();

    // Visit invite page as unauthenticated user
    await page.goto(`/invite/${token}`, { waitUntil: "networkidle" });

    // Wait for the main content to be present
    await expect(page.getByText("You've been invited")).toBeVisible();
    await expect(page.getByText(/Invite Test Study/)).toBeVisible();
    await expect(page.getByText(/Teacher/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Create account/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Sign in/i })).toBeVisible();
  });

  test("accepts invite when logged in", async ({ page }) => {
    // Create a second user first
    await page.goto("/register");
    await page.getByLabel("Email").fill(researcherEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Register" }).click();
    await page.waitForURL("/dashboard");
    await page.getByRole("button", { name: "Sign out" }).click();

    // Log in as admin and create invite
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("/dashboard");
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("link", { name: "Invite Test Project" }).first().click();
    await page.getByRole("link", { name: "Invite Test Study" }).first().click();

    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByRole("combobox", { name: "Role" }).selectOption("researcher");
    await page.getByRole("button", { name: "Generate link" }).click();

    const linkInput = page.getByLabel("Invite link");
    const link = await linkInput.inputValue();
    const token = link.split("/invite/")[1];

    // Sign out and log in as researcher
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.goto("/login");
    await page.getByLabel("Email").fill(researcherEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Visit invite page
    await page.goto(`/invite/${token}`, { waitUntil: "networkidle" });
    await expect(page.getByText("You've been invited")).toBeVisible();
    await page.getByRole("button", { name: "Accept & join" }).click();

    // Should redirect to study page
    await expect(page).toHaveURL(/\/projects\/.*\/studies\/.*/);
    await expect(page.getByRole("heading", { name: "Invite Test Study" })).toBeVisible();
  });

  test("registers via invite link", async ({ page }) => {
    // Log in as admin and create invite
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("/dashboard");
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("link", { name: "Invite Test Project" }).first().click();
    await page.getByRole("link", { name: "Invite Test Study" }).first().click();

    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByRole("combobox", { name: "Role" }).selectOption("supervisor");
    await page.getByRole("button", { name: "Generate link" }).click();

    const linkInput = page.getByLabel("Invite link");
    const link = await linkInput.inputValue();
    const token = link.split("/invite/")[1];

    // Sign out
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign out" }).click();

    // Visit invite page and click create account
    await page.goto(`/invite/${token}`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Create account/i }).click();

    // Should be on register page with invite token
    await expect(page).toHaveURL(`/register?invite=${token}`);
    await page.getByLabel("Email").fill(supervisorEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Register" }).click();

    // Should redirect to study page after accepting invite
    await expect(page).toHaveURL(/\/projects\/.*\/studies\/.*/);
    await expect(page.getByRole("heading", { name: "Invite Test Study" })).toBeVisible();
  });

  test("logs in via invite link", async ({ page }) => {
    // Create a third user
    await page.goto("/register");
    await page.getByLabel("Email").fill(teacherEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Register" }).click();
    await page.waitForURL("/dashboard");
    await page.getByRole("button", { name: "Sign out" }).click();

    // Log in as admin and create invite
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("/dashboard");
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("link", { name: "Invite Test Project" }).first().click();
    await page.getByRole("link", { name: "Invite Test Study" }).first().click();

    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByRole("combobox", { name: "Role" }).selectOption("teacher");
    await page.getByRole("button", { name: "Generate link" }).click();

    const linkInput = page.getByLabel("Invite link");
    const link = await linkInput.inputValue();
    const token = link.split("/invite/")[1];

    // Sign out
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign out" }).click();

    // Visit invite page and click sign in
    await page.goto(`/invite/${token}`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Sign in/i }).click();

    // Should be on login page with invite token
    await expect(page).toHaveURL(`/login?invite=${token}`);
    await page.getByLabel("Email").fill(teacherEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Should redirect to study page after accepting invite
    await expect(page).toHaveURL(/\/projects\/.*\/studies\/.*/);
    await expect(page.getByRole("heading", { name: "Invite Test Study" })).toBeVisible();
  });

  test("shows error for invalid invite", async ({ page }) => {
    // Visit with a fake token
    await page.goto("/invite/0000000000000000000000000000000000000000000000000000000000000000", { waitUntil: "networkidle" });
    await expect(page.getByText("Invalid link")).toBeVisible();
    await expect(page.getByText(/doesn't exist or has been removed/i)).toBeVisible();
  });

  test("shows error for already used invite", async ({ page }) => {
    // Create user
    await page.goto("/register");
    await page.getByLabel("Email").fill(duplicateEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Register" }).click();
    await page.waitForURL("/dashboard");
    await page.getByRole("button", { name: "Sign out" }).click();

    // Log in as admin and create invite
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("/dashboard");
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("link", { name: "Invite Test Project" }).first().click();
    await page.getByRole("link", { name: "Invite Test Study" }).first().click();

    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByRole("combobox", { name: "Role" }).selectOption("researcher");
    await page.getByRole("button", { name: "Generate link" }).click();

    const linkInput = page.getByLabel("Invite link");
    const link = await linkInput.inputValue();
    const token = link.split("/invite/")[1];

    // Sign out and log in as duplicate user
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.goto("/login");
    await page.getByLabel("Email").fill(duplicateEmail);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Accept invite first time
    await page.goto(`/invite/${token}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Accept & join" }).click();
    await expect(page).toHaveURL(/\/projects\/.*\/studies\/.*/);

    // Try to accept same invite again
    await page.goto(`/invite/${token}`, { waitUntil: "networkidle" });
    await expect(page.getByText("Link already used")).toBeVisible();
    await expect(page.getByText(/already been accepted/i)).toBeVisible();
  });
});
