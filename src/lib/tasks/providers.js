// Task providers — the seam that lets tasks come from more than one source.
//
// Today there is one enabled provider: `local` (Supabase planner_tasks). The
// Tasks timeline reads through getTaskProviders() so a future **ClickUp**
// provider can slot in beside it without the page or editor changing — it just
// implements the same interface and flips `enabled`. (The personal_tasks
// migration originally stood in as "the ClickUp placeholder"; this is where the
// real integration will live.)

import { supabase } from "../../supabase";
import { normalizeTask } from "./model";
import * as taskMutations from "./mutations";

/**
 * Provider interface:
 *   id        stable string key
 *   label     human name (shown when >1 provider is active)
 *   enabled   whether to include it in getTaskProviders()
 *   listTasks async ({ userId }) => normalized Task[]
 *   mutations the write surface (see lib/tasks/mutations) or null if read-only
 */
export const localProvider = {
  id: "local",
  label: "Mangodoro",
  enabled: true,
  mutations: taskMutations,
  async listTasks({ userId }) {
    if (!userId) return [];
    const { data, error } = await supabase
      .from("planner_tasks")
      .select("*")
      .eq("user_id", userId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false })
      .order("sort_order", { ascending: true });
    if (error) { console.error("[tasks] local listTasks", error); return []; }
    return (data || []).map((r) => normalizeTask(r, "planner"));
  },
};

// Placeholder for the future ClickUp sync. Same shape; disabled until an OAuth
// token + list mapping + a sync worker exist. Kept here so wiring it up is a
// localized change (enable + implement listTasks/mutations against the ClickUp
// REST API, mapping ClickUp tasks → normalizeTask).
export const clickupProvider = {
  id: "clickup",
  label: "ClickUp",
  enabled: false,
  mutations: null,
  async listTasks() {
    return [];
  },
};

const ALL_PROVIDERS = [localProvider, clickupProvider];

export function getTaskProviders() {
  return ALL_PROVIDERS.filter((p) => p.enabled);
}

export function getProvider(id) {
  return ALL_PROVIDERS.find((p) => p.id === id) || localProvider;
}
