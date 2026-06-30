# Messaging v2 — org-scoped inbox, team channels, and a structured list

Status: planning (2026-06-29). Supersedes the ad-hoc DM/group MVP shipped 2026-06-26
(`20260627140000_messaging.sql`). See the `messaging` memory for the MVP shape.

## Why

Two problems, one root cause, plus a product gap:

1. **Bug — cross-org name failure.** Switch orgs and you still see the *other* org's
   conversations, but the participant names render as "Member".
2. **Product — "PM is very basic."** Only ad-hoc 1:1 DMs and ad-hoc groups exist. The app
   already has an org → sub-team hierarchy (`teams` = org, `org_teams` = squad) that messaging
   ignores. Users want messages **organized by org, and by team within an org.**

### Root cause of the bug

The inbox and the name source are scoped differently:

- **Inbox is NOT org-scoped.** `listConversations()` (`src/lib/messages.js:19-23`) selects every
  conversation the user participates in — no `team_id` filter. RLS scopes only by *participation*,
  so DMs from all orgs pile into one list regardless of the active org.
- **Names ARE org-scoped.** `MessagesPage` resolves names from `useTeam().teamMembers`
  (`src/pages/MessagesPage.jsx:192-199`), loaded only for `activeTeamId` via
  `get_team_member_profiles(activeTeamId)`. After an org switch, any conversation whose
  participants live in a *different* org can't resolve → fallback `"Member"`.
- **Stale list on switch.** `MessagesProvider.reload` depends only on `userId`
  (`src/context/MessagesContext.jsx:21-24`), so it never re-runs when `activeTeamId` changes.

So "I see the other org's messages" (no filter) and "names don't load" (active-org-only name
source) are the same scoping mismatch.

### Data model recap (the lever)

- **`teams`** — the **org** / top-level workspace you switch between (`activeTeamId`).
- **`org_teams`** — **sub-team / squad** inside an org (e.g. "SWE", "PM"). First-class:
  `org_team_members` (role member/lead), color, RLS, realtime, member chips (`MemberIdentity`).
  Pattern precedent: `create_default_room_for_org_team()` auto-makes a room per org_team
  (`20260613210000_auto_room_per_org_team.sql`) — we mirror it for channels.
- **`conversations.team_id`** — already references the org, set at creation, but treated as
  metadata (never filtered, can be wrong — see caveat below).

### Design principle

The whole app is org-scoped; messaging should be too. **The inbox follows the active org.**
Names then always resolve because every participant is in the active org's member list. Within
an org, structure the list by sub-team. Keep an org-independent profile resolver as a correctness
backstop for legacy/edge rows.

---

## Phase 0 — Org-scope the inbox (the bug fix)

Smallest correct change. No schema change strictly required, but see the `team_id` caveat.

- **`src/lib/messages.js`** — `listConversations(userId, teamId)`: add `team_id` to the select and
  `.eq("team_id", teamId)`. (Keep a guard: if `teamId` is null, return `[]` rather than leaking
  all orgs.)
- **`src/context/MessagesContext.jsx`** — consume `useTeam()` (provider is already nested inside
  `TeamProvider`, App.jsx:374→379). Thread `activeTeamId` into `reload`; add `activeTeamId` to the
  `reload`/effect deps so the list reloads on org switch. The realtime channel can stay keyed on
  `userId`; just filter incoming reloads to the active org.
- **`src/components/messages/NavMessages.jsx`** — the unread badge becomes per-active-org
  automatically once the list is scoped. (Decision: do we want a *global* unread dot across orgs?
  See open questions.)
- **`MessagesPage` `nameOf`/`memberById`** — unchanged; now correct because participants are all in
  the active org's `teamMembers`.

### `team_id` correctness caveat (must handle, not optional)

- `conversations.team_id` is `references teams(id) on delete set null` → can become null.
- `create_group_conversation` sets `tid` from `select team_id from team_members where user_id = me
  limit 1` — **arbitrary org**, not the org the group was created in. Groups can be mis-tagged.
- `get_or_create_dm` sets `tid` from *a* shared team — if two users share two orgs, the DM pins to
  whichever the query returned first.

Mitigations:
1. **Backfill migration** — best-effort set `team_id` for null/likely-wrong rows from participants'
   shared org (skip when ambiguous; those fall back to Phase 1 resolution).
2. **Fix creation RPCs** to take an explicit `p_team_id` (the active org) instead of guessing, and
   validate every participant shares *that* org. New forward migration (never edit the applied
   `20260627140000`; see the `supabase-migrations-shared-db` memory).
3. A DM you share across two orgs should arguably appear in **both** inboxes — acceptable since it's
   the same people. Decide vs. pin-to-one (open question).

---

## Phase 1 — Org-independent profile resolution (backstop)

So names never fall back to "Member" even for null-`team_id` or cross-org legacy rows, and to unblock
the deferred public-profiles refactor (`profiles-rethink` memory).

- New RPC `get_profiles_for_ids(p_ids uuid[])` → `(user_id, name, avatar_url)`, `security definer`,
  gated on **"shares any team with caller"** (reuse `shares_team_with` logic, batched). Returns
  names from `user_settings` without requiring the requested users to be in the *active* org.
- Client: `MessagesPage` resolves names from `teamMembers` first, then fills any misses via a small
  `useParticipantProfiles(ids)` cache backed by this RPC. Removes the hard dependency on active-org
  membership for display.

This phase is optional if Phase 0 + the backfill fully scope the inbox, but it's the robust answer
and cheap. Recommended.

---

## Phase 2 — Team channels (the real upgrade)

Turn "ping a teammate" into a lightweight Slack: a persistent channel per `org_team`.

### Schema (new forward migration, `20260629xxxxxx`)

- `conversations`: add `kind text not null default 'dm'` check in `('dm','group','channel')`
  (or `org_team_id uuid references org_teams(id) on delete cascade` + `is_group` stays). Prefer an
  explicit `kind` column for the 3-way list sectioning; keep `is_group` for back-comat or migrate it.
- `conversations.org_team_id` — set for channels; unique partial index
  `(org_team_id) where kind = 'channel' and archived_at is null` so each org_team has exactly one
  channel.
- Membership = `org_team_members`. Two options:
  - **A. Virtual membership** — don't duplicate rows into `conversation_participants`; make RLS for
    channel conversations check `org_team_members` directly (`is_org_team_member(org_team_id)`
    helper). Auto-stays in sync with team membership. **Preferred** — no add/remove triggers.
  - **B. Materialized** — triggers mirror `org_team_members` ⇄ `conversation_participants`. More
    moving parts; only needed if per-channel `last_read_at` must live in `conversation_participants`.
    (We need read state per user per channel — so likely a hybrid: virtual read access via RLS, but a
    lightweight `channel_read_state(conversation_id, user_id, last_read_at)` or reuse
    `conversation_participants` rows just for read tracking.)

### Auto-provision

Mirror `create_default_room_for_org_team()`: a trigger on `org_teams` insert creates the channel
conversation (idempotent). Backfill channels for existing `org_teams`.

### RLS

- Channel SELECT/INSERT-message gated on `is_org_team_member(org_team_id)` (security-definer helper,
  same no-recursion pattern as `is_conversation_participant`).
- Posting a message: sender must be an org_team member.
- Notifications: reuse the `dm_messages` insert trigger; for channels emit `'dm'` (or a new
  `'channel'` kind) to org_team members except sender. Consider muting/per-channel prefs later.

---

## Phase 3 — Structured list + org switcher

The "organize by org and team" payoff, in the UI.

- **Org switcher row** at the top of `MessagesPage` (reuse the existing team switcher component /
  `teams` from `useTeam`), with a per-org unread count so you can see activity elsewhere without
  losing scoping.
- **Sectioned conversation list** within the active org:
  1. **Team channels** — `kind = 'channel'`, color-coded with the org_team chip color.
  2. **Group chats** — `kind = 'group'`.
  3. **Direct messages** — `kind = 'dm'`.
- `List` in `MessagesPage.jsx` groups by `kind`; channel rows show `#name` + org_team color dot.

---

## Phase 4 — Polish (makes it feel real)

Mostly the MVP's own v2 list, plus mention hooks:

- Last-message **preview + sender** in the list (needs `listConversations` to also fetch the latest
  message per conversation — add to the RPC/query).
- **Search** conversations + messages.
- **Edit / delete** message UI (RLS already allows; `dm_messages.edited_at/deleted_at` exist).
- **Read receipts / typing** via Realtime Presence (no schema needed).
- **@-mentions** → `emit_notification` (notification layer already wired for `'dm'`).
- **Add people / leave group**, group rename.

---

## Migration & deploy notes

- Shared DB across all branches (`clmmljondpxiwyvcqrjg`). **Never reuse a migration timestamp** — db
  push silently skips collisions (`supabase-migrations-shared-db` memory). Latest applied is
  `20260628150000`; new files use `20260629xxxxxx`+.
- Never edit an already-applied migration (`20260627140000`, `20260628140000`) — always forward.
- `notify pgrst, 'reload schema';` after RPC/column changes.
- Add new tables/columns to `supabase_realtime` publication where the client subscribes.
- After client dep/schema changes, `npm install` + `npm run build` (Vercel builds with npm —
  `lockfile-vercel-build` memory).

## Open questions (decide before Phase 0 ships)

1. **Cross-org DM** with someone in two shared orgs: show in both inboxes, or pin to one?
   (Recommend: show in both — same people, less surprising.)
2. **Global vs per-org unread badge** in the nav: a single dot for "any org has unread", or only the
   active org? (Recommend: per-org count in the switcher + a global dot in nav.)
3. **Channel membership** model: virtual (RLS off `org_team_members`) vs materialized participants.
   (Recommend: virtual for access, lightweight read-state for unread.)
4. **`kind` column vs `is_group`**: introduce `kind ('dm','group','channel')` and migrate `is_group`,
   or add `org_team_id` and keep `is_group`? (Recommend: `kind` — cleaner sectioning.)

## Suggested sequencing

Phase 0 (+ backfill) ships the fix on its own and is independently valuable. Phase 1 hardens it.
Phases 2–3 are the feature. Phase 4 is incremental polish that can land piecemeal.
