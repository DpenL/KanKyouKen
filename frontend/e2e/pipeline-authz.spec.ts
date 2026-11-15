import {
  test,
  expect,
  request as playwrightRequest,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Authorization of the pipeline and consent Server Actions.
 *
 * A Server Action is an HTTP endpoint: any client can POST to it with whatever
 * arguments it likes, regardless of what the UI would send. These actions write
 * with the service-role client, so RLS does not protect them; the check has to
 * be in the action. The tests below call the real actions the way a hostile
 * client would (a genuine session, the genuine action ids, hand-written
 * arguments) and then look at the database.
 *
 * Actors:
 *   victim      owns study V, which has one custom script
 *   outsider    owns their own study O; no role of any kind on V
 *   researcher  has the `researcher` role on V (below supervisor)
 */

const ts = Date.now();
const password = "password123";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

interface Study {
  projectId: string;
  studyId: string;
}

interface Actor {
  userId: string;
  email: string;
  context?: BrowserContext;
  page?: Page;
}

type ActionName =
  | "createScript"
  | "updateScript"
  | "deleteScript"
  | "setScriptEnabled"
  | "saveConsentConfig";

async function createUser(label: string): Promise<Actor> {
  const email = `authz-${label}-${ts}@example.com`;
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}) failed: ${error?.message}`);
  return { userId: data.user.id, email };
}

async function createStudy(ownerId: string, label: string): Promise<Study> {
  const supabase = serviceClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({ owner_id: ownerId, name: `Authz ${label} project ${ts}` })
    .select("id")
    .single();
  if (projectError || !project) throw new Error(`project insert failed: ${projectError?.message}`);

  const { data: study, error: studyError } = await supabase
    .from("studies")
    .insert({ project_id: project.id, owner_id: ownerId, name: `Authz ${label} study ${ts}` })
    .select("id")
    .single();
  if (studyError || !study) throw new Error(`study insert failed: ${studyError?.message}`);

  return { projectId: project.id, studyId: study.id };
}

async function signIn(browser: Browser, baseURL: string, actor: Actor) {
  actor.context = await browser.newContext({ baseURL });
  actor.page = await actor.context.newPage();
  await actor.page.goto("/login");
  await actor.page.getByLabel("Email").fill(actor.email);
  await actor.page.getByLabel("Password").fill(password);
  await actor.page.getByRole("button", { name: "Sign in" }).click();
  await actor.page.waitForURL("/dashboard");
}

const pipelineUrl = (s: Study) => `/projects/${s.projectId}/studies/${s.studyId}/settings/pipeline`;
const consentUrl = (s: Study) => `/projects/${s.projectId}/studies/${s.studyId}/settings/consent`;

/** Run a UI interaction and return the id of the Server Action it invoked. */
async function captureActionId(page: Page, interact: () => Promise<void>): Promise<string> {
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]),
    interact(),
  ]);
  await request.response();
  return request.headers()["next-action"];
}

function scriptForm(name: string, endpointUrl = "/functions/v1/rt-stats") {
  return {
    name,
    description: "",
    scriptType: "analytics",
    endpointUrl,
    triggerTables: ["events"],
    triggerEventTypes: [],
    triggerOutputTypes: [],
    writesToTable: "script_outputs",
    outputType: "",
    config: {},
  };
}

test.describe.serial("Pipeline and consent actions: authorization", () => {
  const actionIds = {} as Record<ActionName, string>;
  let baseURL: string;
  let victim: Actor;
  let outsider: Actor;
  let researcher: Actor;
  let V: Study;
  let O: Study;
  let victimScriptId: string;
  let globalScriptId: string;

  /** POST straight to a Server Action with hand-written arguments. */
  async function callAction(
    actor: Actor | null,
    pageUrl: string,
    action: ActionName,
    args: unknown[],
  ) {
    const request = actor ? actor.page!.request : await playwrightRequest.newContext({ baseURL });
    try {
      await request.post(pageUrl, {
        headers: {
          "next-action": actionIds[action],
          "content-type": "text/plain;charset=UTF-8",
          accept: "text/x-component",
          origin: new URL(baseURL).origin,
        },
        data: JSON.stringify(args),
        maxRedirects: 0,
      });
    } finally {
      if (!actor) await request.dispose();
    }
  }

  async function scriptRow(id: string) {
    const { data } = await serviceClient()
      .from("pipeline_scripts")
      .select("id, study_id, name, endpoint_url")
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  async function scriptsNamed(name: string) {
    const { data } = await serviceClient().from("pipeline_scripts").select("id, study_id").eq("name", name);
    return data ?? [];
  }

  async function overrides(studyId: string, scriptId: string) {
    const { data } = await serviceClient()
      .from("study_script_config")
      .select("enabled")
      .eq("study_id", studyId)
      .eq("script_id", scriptId);
    return data ?? [];
  }

  async function consentConfig(studyId: string) {
    const { data } = await serviceClient()
      .from("study_consent_config")
      .select("custom_content_md")
      .eq("study_id", studyId)
      .maybeSingle();
    return data;
  }

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    baseURL = testInfo.project.use.baseURL!;
    const supabase = serviceClient();

    victim = await createUser("victim");
    outsider = await createUser("outsider");
    researcher = await createUser("researcher");
    V = await createStudy(victim.userId, "victim");
    O = await createStudy(outsider.userId, "outsider");

    const { error: roleError } = await supabase.from("study_roles").insert({
      user_id: researcher.userId,
      study_id: V.studyId,
      role: "researcher",
      granted_by: victim.userId,
    });
    if (roleError) throw new Error(`role insert failed: ${roleError.message}`);

    const { data: victimScript, error: scriptError } = await supabase
      .from("pipeline_scripts")
      .insert({
        study_id: V.studyId,
        name: `authz-victim-script-${ts}`,
        script_type: "analytics",
        endpoint_url: "/functions/v1/rt-stats",
        trigger_tables: ["events"],
        writes_to_table: "study_metrics",
        enabled: true,
      })
      .select("id")
      .single();
    if (scriptError || !victimScript) throw new Error(`script insert failed: ${scriptError?.message}`);
    victimScriptId = victimScript.id;

    // Stands in for a platform built-in (study_id IS NULL) so the real ones are left alone.
    // Disabled, and its trigger table matches nothing, so it never runs.
    const { data: globalScript, error: globalError } = await supabase
      .from("pipeline_scripts")
      .insert({
        study_id: null,
        name: `authz-global-script-${ts}`,
        script_type: "analytics",
        endpoint_url: "/functions/v1/rt-stats",
        trigger_tables: ["__authz_test__"],
        writes_to_table: "study_metrics",
        enabled: false,
      })
      .select("id")
      .single();
    if (globalError || !globalScript) throw new Error(`global insert failed: ${globalError?.message}`);
    globalScriptId = globalScript.id;

    await signIn(browser, baseURL, outsider);
    await signIn(browser, baseURL, researcher);

    // Learn the action ids the way any client can: use the UI once, on the
    // outsider's own study, and read them off the requests it makes.
    const page = outsider.page!;
    await page.goto(pipelineUrl(O));

    await page.getByRole("button", { name: "+ Add script" }).click();
    await page.getByLabel("Name").fill(`authz-own-script-${ts}`);
    await page.getByLabel("Endpoint URL").fill("/functions/v1/rt-stats");
    actionIds.createScript = await captureActionId(page, () =>
      page.getByRole("button", { name: "Save" }).click(),
    );
    await expect(page.getByRole("dialog")).not.toBeVisible();

    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    actionIds.updateScript = await captureActionId(page, () =>
      page.getByRole("button", { name: "Save" }).click(),
    );
    await expect(page.getByRole("dialog")).not.toBeVisible();

    actionIds.setScriptEnabled = await captureActionId(page, () =>
      page.getByRole("switch").first().click(),
    );

    actionIds.deleteScript = await captureActionId(page, () =>
      page.getByRole("button", { name: "Delete" }).first().click(),
    );
    await expect(page.getByText(`authz-own-script-${ts}`, { exact: true })).not.toBeVisible();

    await page.goto(consentUrl(O));
    actionIds.saveConsentConfig = await captureActionId(page, () =>
      page.getByRole("button", { name: "Save" }).click(),
    );
    await expect(page.getByText("Saved.")).toBeVisible();
  });

  test.afterAll(async () => {
    const supabase = serviceClient();
    await outsider?.context?.close();
    await researcher?.context?.close();
    if (globalScriptId) await supabase.from("pipeline_scripts").delete().eq("id", globalScriptId);
    for (const study of [V, O]) {
      if (study) await supabase.from("projects").delete().eq("id", study.projectId);
    }
    for (const actor of [victim, outsider, researcher]) {
      if (actor) await supabase.auth.admin.deleteUser(actor.userId);
    }
  });

  // Guards every test below against passing for the wrong reason: if the way
  // actions are invoked ever changes, this fails instead of them silently passing.
  test("control: a hand-made call does run the action for an authorised caller", async () => {
    const name = `authz-control-${ts}`;
    await callAction(outsider, pipelineUrl(O), "createScript", [O.studyId, scriptForm(name)]);

    const rows = await scriptsNamed(name);
    expect(rows).toHaveLength(1);
    expect(rows[0].study_id).toBe(O.studyId);

    await callAction(outsider, pipelineUrl(O), "updateScript", [O.studyId, rows[0].id, scriptForm(`${name}-v2`)]);
    expect((await scriptRow(rows[0].id))?.name).toBe(`${name}-v2`);

    await callAction(outsider, pipelineUrl(O), "deleteScript", [O.studyId, rows[0].id]);
    expect(await scriptRow(rows[0].id)).toBeNull();
  });

  test("a user with no role on a study cannot create a script on it", async () => {
    const name = `authz-outsider-create-${ts}`;
    await callAction(outsider, pipelineUrl(O), "createScript", [V.studyId, scriptForm(name)]);
    expect(await scriptsNamed(name)).toHaveLength(0);
  });

  test("a user with no role on a study cannot update or delete its scripts", async () => {
    const hijacked = scriptForm(`authz-hijacked-${ts}`);

    // Naming the victim study, naming their own study, and the pre-fix call shape.
    await callAction(outsider, pipelineUrl(O), "updateScript", [V.studyId, victimScriptId, hijacked]);
    await callAction(outsider, pipelineUrl(O), "updateScript", [O.studyId, victimScriptId, hijacked]);
    await callAction(outsider, pipelineUrl(O), "updateScript", [victimScriptId, hijacked]);
    expect((await scriptRow(victimScriptId))?.name).toBe(`authz-victim-script-${ts}`);

    await callAction(outsider, pipelineUrl(O), "deleteScript", [V.studyId, victimScriptId]);
    await callAction(outsider, pipelineUrl(O), "deleteScript", [O.studyId, victimScriptId]);
    await callAction(outsider, pipelineUrl(O), "deleteScript", [victimScriptId]);
    expect(await scriptRow(victimScriptId)).not.toBeNull();
  });

  test("global built-in scripts cannot be edited or deleted, even by a study owner", async () => {
    const hijacked = scriptForm(`authz-hijacked-global-${ts}`);

    await callAction(outsider, pipelineUrl(O), "updateScript", [O.studyId, globalScriptId, hijacked]);
    await callAction(outsider, pipelineUrl(O), "updateScript", [globalScriptId, hijacked]);
    expect((await scriptRow(globalScriptId))?.name).toBe(`authz-global-script-${ts}`);

    await callAction(outsider, pipelineUrl(O), "deleteScript", [O.studyId, globalScriptId]);
    await callAction(outsider, pipelineUrl(O), "deleteScript", [globalScriptId]);
    expect(await scriptRow(globalScriptId)).not.toBeNull();
  });

  test("script toggles are confined to the caller's own study", async () => {
    // Not their study.
    await callAction(outsider, pipelineUrl(O), "setScriptEnabled", [V.studyId, globalScriptId, true]);
    expect(await overrides(V.studyId, globalScriptId)).toHaveLength(0);

    // Their study, but a script that belongs to someone else's.
    await callAction(outsider, pipelineUrl(O), "setScriptEnabled", [O.studyId, victimScriptId, false]);
    expect(await overrides(O.studyId, victimScriptId)).toHaveLength(0);

    // Their study and a global script: allowed.
    await callAction(outsider, pipelineUrl(O), "setScriptEnabled", [O.studyId, globalScriptId, true]);
    expect(await overrides(O.studyId, globalScriptId)).toEqual([{ enabled: true }]);
  });

  test("a user with no role on a study cannot write its consent config", async () => {
    const config = { base_template_id: null, custom_content_md: `authz-pwned-${ts}`, requires_scroll: false };

    await callAction(outsider, consentUrl(O), "saveConsentConfig", [V.studyId, config]);
    expect(await consentConfig(V.studyId)).toBeNull();

    // Authorised for their own study, with the victim's id smuggled into the payload.
    await callAction(outsider, consentUrl(O), "saveConsentConfig", [O.studyId, { ...config, study_id: V.studyId }]);
    expect(await consentConfig(V.studyId)).toBeNull();
    expect((await consentConfig(O.studyId))?.custom_content_md).toBe(`authz-pwned-${ts}`);
  });

  test("a researcher (below supervisor) on the study cannot manage its scripts or consent", async () => {
    const name = `authz-researcher-create-${ts}`;

    await callAction(researcher, pipelineUrl(V), "createScript", [V.studyId, scriptForm(name)]);
    expect(await scriptsNamed(name)).toHaveLength(0);

    await callAction(researcher, pipelineUrl(V), "updateScript", [V.studyId, victimScriptId, scriptForm(name)]);
    expect((await scriptRow(victimScriptId))?.name).toBe(`authz-victim-script-${ts}`);

    await callAction(researcher, pipelineUrl(V), "deleteScript", [V.studyId, victimScriptId]);
    expect(await scriptRow(victimScriptId)).not.toBeNull();

    await callAction(researcher, pipelineUrl(V), "setScriptEnabled", [V.studyId, globalScriptId, true]);
    expect(await overrides(V.studyId, globalScriptId)).toHaveLength(0);

    await callAction(researcher, consentUrl(V), "saveConsentConfig", [
      V.studyId,
      { base_template_id: null, custom_content_md: `authz-researcher-${ts}`, requires_scroll: false },
    ]);
    expect(await consentConfig(V.studyId)).toBeNull();
  });

  test("without a session the actions do nothing", async () => {
    const name = `authz-anonymous-create-${ts}`;

    for (const url of [pipelineUrl(V), "/login"]) {
      await callAction(null, url, "createScript", [V.studyId, scriptForm(name)]);
      await callAction(null, url, "deleteScript", [V.studyId, victimScriptId]);
      await callAction(null, url, "saveConsentConfig", [
        V.studyId,
        { base_template_id: null, custom_content_md: name, requires_scroll: false },
      ]);
    }

    expect(await scriptsNamed(name)).toHaveLength(0);
    expect(await scriptRow(victimScriptId)).not.toBeNull();
    expect(await consentConfig(V.studyId)).toBeNull();
  });

  // The event-router sends the service-role key to a script's endpoint, so the
  // endpoint may only ever be an Edge Function of this project. The dialog checks
  // this too, but the action must not rely on that.
  test("the endpoint must be a /functions/v1/<name> path, even for the study owner", async () => {
    const badEndpoints = [
      "https://attacker.example/collect",
      "http://attacker.example/collect",
      "//attacker.example/collect",
      ".attacker.example/collect",
      "@attacker.example/collect",
      "/rest/v1/study_roles",
      "/auth/v1/admin/users",
      "/functions/v1/../../rest/v1/study_roles",
      "/functions/v1/rt-stats/../../../auth/v1/admin/users",
      "/functions/v1/rt-stats?redirect=https://attacker.example",
      "/functions/v1/rt-stats/extra",
      "/functions/v1/",
      "functions/v1/rt-stats",
      " /functions/v1/rt-stats",
    ];

    for (const [i, endpoint] of badEndpoints.entries()) {
      const name = `authz-bad-endpoint-${ts}-${i}`;
      await callAction(outsider, pipelineUrl(O), "createScript", [O.studyId, scriptForm(name, endpoint)]);
      expect(await scriptsNamed(name), `endpoint ${JSON.stringify(endpoint)} was accepted`).toHaveLength(0);
    }

    // The same rule applies when an existing script is edited.
    const name = `authz-good-endpoint-${ts}`;
    await callAction(outsider, pipelineUrl(O), "createScript", [O.studyId, scriptForm(name)]);
    const [own] = await scriptsNamed(name);
    expect(own).toBeTruthy();

    await callAction(outsider, pipelineUrl(O), "updateScript", [
      O.studyId,
      own.id,
      scriptForm(name, "https://attacker.example/collect"),
    ]);
    expect((await scriptRow(own.id))?.endpoint_url).toBe("/functions/v1/rt-stats");
  });
});
