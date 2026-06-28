# Room privacy & expanded room settings

Status: **proposed** (planning only — no code yet)
Author: design discussion 2026-06-26

## Why

"Private" rooms don't actually keep anyone out, and rooms have very few
configurable settings. We want real privacy controls plus a broader room
settings surface (chat persistence, guests, etc.).

## Current state (what we're fixing)

Three independent ideas are smeared into one half-working feature:

| Concept | Controls | Today |
|---|---|---|
| Visibility | who *sees* the room in the hallway | `room_teams` gating (client-side filter) |
| Entry | who can *join* | `rooms.invite_code` — **not enforced server-side** |
| Lock | freezing entry mid-session | doesn't exist |

The decisive problem: **entry is never enforced on the server.**

- `start_or_join_room_session` (`20260620120000:40-81`) checks only
  `room_id is not null`, takes an advisory lock, creates/returns the session.
- `join_sync_session` (`20260527140000:90-96`) checks only display-name /
  active / not-full.
- The invite-code prompt lives entirely in `OfficePage.handleStart`
  (`:94-100`) and `OfficeShell` auto-join (`:174-177`). Pure UI.
- `rooms` SELECT policy (`20260612130000:66-70`) returns the **whole row**,
  so `invite_code` is readable by every team member — the "secret" leaks.
- Lifecycle today (`20260615020000`): code is auto-minted on first join,
  auto-cleared when the room empties. So "private" = an ephemeral shared
  code that exists only while someone is inside. No persistent ownership,
  no allowlist.

Net: any team member can read a room's join/invite code and call the join
RPC directly, bypassing the prompt. Privacy is theater.

## Target model

Decouple **privacy** from `rooms.kind`. Any room (general / meeting /
private) gets an explicit, server-enforced **entry policy** plus orthogonal
runtime controls. The four mechanisms the user asked for compose like this:

- **Base policy** (`rooms.entry_policy`): `open` | `code` | `members`
  - `open` — any team member who can see the room (today's default).
  - `code` — a PIN the owner sets (persistent, hashed, never returned).
  - `members` — only people on the room's allowlist (`room_members`).
- **Knock-to-enter** (`rooms.knock_enabled`): anyone who fails the base
  policy may *request* entry; an occupant/owner approves (waiting room).
- **Lock-after-start** (`sync_sessions.locked`): an occupant freezes entry
  mid-session; new entrants must knock (or are blocked). Resets when the
  session dies, mirroring today's unlock-on-empty philosophy.
- **External guests** (`rooms.guests_allowed` + `room_guests`): anonymous-auth
  users enter via a tokenized link, subject to the same policy, with
  least-privilege RLS modeled on org-device accounts.

Settings UI presents one **Access** section: pick the base policy, then
toggle knock / guests; lock is a live button inside the room.

### Storage decisions

- **Access-control flags are real columns**, not jsonb — RLS policies and
  security-definer RPCs must read them in SQL. (`entry_policy`,
  `knock_enabled`, `guests_allowed`, `chat_mode` on `rooms`; `locked` on
  `sync_sessions`.)
- **Secrets live in a no-policy table.** `room_secrets(room_id, code_hash)`
  with RLS on and **no** select policy — only the security-definer join RPC
  reads it. Mirrors `org_device_secrets`. The PIN never rides in the room row.
- New relational concerns get their own tables: `room_members` (allowlist),
  `room_knock_requests` (waiting room), `room_guests` (guest grants),
  `room_guest_links` (tokens).

### The single enforcement point

A security-definer `can_enter_room(p_room_id uuid, p_access_code text)`
returns a verdict: `allowed` | `needs_code` | `needs_knock` | `denied`.
It is the *only* place privacy is decided, and it's called by **both** join
RPCs so direct calls can't bypass it:

- `start_or_join_room_session` gains a `p_access_code` param; raises unless
  `can_enter_room` says `allowed`.
- `join_sync_session`: after locating the session, if it has a `room_id`,
  re-run `can_enter_room` (consulting allowlist / approved knock grant /
  lock state). This closes the "read the join_code and call the RPC
  directly" hole.

Verdict logic (precedence):
1. Org admin / room owner → `allowed`.
2. Session `locked` and caller not already an active participant →
   `needs_knock` (or `denied` if knock disabled).
3. `entry_policy = members`: on allowlist → `allowed`; else fall through.
4. `entry_policy = code`: correct PIN → `allowed`; else fall through.
5. `entry_policy = open`: team member → `allowed`.
6. An approved, unexpired `room_knock_requests` grant for this caller →
   `allowed`.
7. `knock_enabled` → `needs_knock`; otherwise `denied`.

## Phases

Each phase ships independently. **Phase 0 is the security fix and should
land first**, even alone.

### Phase 0 — Make entry real (security fix)

Goal: today's private rooms actually enforce; the code stops leaking.

- Migration: `room_secrets` table (no-policy RLS); `entry_policy` enum +
  column on `rooms` (default `open`); `can_enter_room()`.
- Migrate existing `kind='private'` rooms → `entry_policy='code'`; move any
  current `invite_code` into a hashed `room_secrets.code_hash`; **stop
  returning `invite_code`** (drop the column from client reads — either drop
  it or expose only via an owner-only RPC).
- Retire the auto-mint (`fix_private_room_code_gen`) and auto-unlock
  (`unlock_private_room_on_session_delete`) triggers — superseded by an
  explicit, persistent PIN.
- Wire `p_access_code` through `start_or_join_room_session` + re-check in
  `join_sync_session`.
- Client: replace the `room.invite_code` checks in `OfficePage.handleStart`
  (`:94-100`) and `OfficeShell` auto-join (`:174-177`) with a verdict-driven
  gate; PIN entry sheet replaces `PrivateRoomCodeSheet`.
- `rooms.js`: `setRoomAccessCode(roomId, code|null)`,
  `setRoomEntryPolicy(roomId, policy)`.

**This phase alone fixes the reported bug.**

### Phase 1 — Member allowlist + room ownership

- Migration: `room_members(room_id, user_id, role owner|member, added_by,
  added_at)` + RLS (members read their rooms' membership; owners/admins
  write via RPC). `entry_policy` gains `members`.
- `can_enter_room` consults the allowlist.
- Ownership: creator of a private room becomes `owner`; settings RPCs extend
  their permission check (`is_org_admin_of_room` / lead) to also allow room
  owners — so a non-admin can manage their own private room.
- Migrate existing private rooms: creator → `owner`.
- `rooms.js`: `listRoomMembers`, `addRoomMember`, `removeRoomMember`,
  `setRoomMemberRole`.
- UI: `RoomMembersPanel` (add by name like chat @-mention autocomplete);
  Access section radio in `RoomSettingsModal`.

### Phase 2 — Lock-after-start + knock-to-enter

- Migration: `sync_sessions.locked boolean default false`;
  `lock_room_session(p_session_id, p_locked)` (occupant/leader only).
- Migration: `room_knock_requests(id, room_id, session_id, user_id,
  display_name, status pending|approved|denied, decided_by, created_at,
  decided_at)` + RLS (requester reads own; occupants read their room's
  pending) + realtime publication.
- RPCs: `request_room_entry(p_room_id)` → pending row;
  `decide_room_entry(p_request_id, p_approve)` → occupant/owner only.
- `can_enter_room` consults `locked` + approved grant.
- UI: lock toggle button in the room header; a waiting-room/knock toast for
  occupants (subscribe to `room_knock_requests`); a "waiting for approval"
  state for the requester (subscribe to own request row).

### Phase 3 — External guest links

Reuse the existing **anonymous-auth** guest path (not the edge-function
device path — no synthetic user to mint).

- Migration: `room_guest_links(id, room_id, token, created_by, expires_at,
  revoked_at)`; `room_guests(room_id, user_id, link_id, display_name,
  expires_at)` — the guest analog of `org_devices`.
- Helper `current_guest_room()` (security-definer, like
  `current_device_room()`); additive SELECT policies granting a guest read
  access to **only** its room's `rooms` / `sync_sessions` /
  `sync_session_participants` rows. Guests never see member lists, other
  rooms, or time entries.
- `resolve_room_by_guest_token(p_token)` — anon-callable, security-definer:
  validates token + `guests_allowed`, inserts the `room_guests` grant for
  `auth.uid()` (the anonymous user), returns room_id. No edge function.
- `can_enter_room` treats a valid guest grant like allowlist membership;
  guests still obey knock/lock.
- Client: `/office/guest/:token` landing → `signInAnonymously` (already used
  for pomodoro guests) → resolve → enter room shell in guest mode.
- `rooms.js`: `createGuestLink`, `revokeGuestLink`, `resolveRoomByGuestToken`.

### Phase 4 — Remaining settings

- `rooms.chat_mode enum('persistent','ephemeral')` (default `persistent`).
  Ephemeral: delete `chat_messages` for the room when its session is
  deleted — hook into the existing `BEFORE DELETE` trigger on
  `sync_sessions` (the same lifecycle hook that handled unlock).
- `rooms.guests_allowed boolean` toggle (gates Phase 3 link creation) + a
  guest chat-write RLS policy (additive, `current_guest_room()`-scoped) if
  guests may chat.
- Tidy `RoomSettingsModal` into sections: Identity (name/color) · Access
  (policy/PIN/knock/guests) · Members · Chat · Duration · Danger zone.
- Optional: per-room `max_participants` override.

## Files touched (reference)

- Migrations (new, timestamps **must** be fresh `20260627xxxxxx`+ — shared DB
  across branches, never reuse a timestamp): `room_secrets`, `entry_policy`,
  `can_enter_room`, `room_members`, `room_knock_requests`, `sync_sessions.locked`,
  `room_guests`/`room_guest_links`, `chat_mode`.
- RPCs to modify: `start_or_join_room_session`, `join_sync_session`,
  the room-settings RPCs' permission checks.
- Client: `src/pages/OfficePage.jsx` (handleStart, code sheet),
  `src/components/office/OfficeShell.jsx` (auto-join effect ~`:157-195`),
  `src/components/office/HallwayView.jsx` (lock badge),
  `src/components/RoomSettingsModal.jsx` (Access/Members/Chat sections),
  `src/lib/rooms.js` (new wrappers), new `RoomMembersPanel`, knock UI,
  guest landing page.

## Open questions (decide before/while building)

1. **Lock vs members:** when an occupant locks a session, are allowlisted
   members still let in automatically, or must everyone new knock? (Plan
   assumes: everyone new knocks — the point is "don't barge into my
   meeting.")
2. **PIN + allowlist coexistence:** allow a room to be `members` *and* accept
   a PIN as a second path, or keep base policy single-choice? (Plan keeps
   base policy single-choice; knock is the universal escape hatch.)
3. **Keep `kind='private'`?** Once privacy is policy-driven, `private` as a
   *kind* is redundant. Keep it as a layout/labeling hint, or collapse into
   `general` + `entry_policy`? (Plan keeps the column, stops using it as the
   gate.)
4. **Guest chat + whiteboard:** do guests get chat write / whiteboard access,
   or view-only presence? Affects how many additive RLS policies Phase 3/4
   needs.

## Deployment notes

- DB migrations only; **no edge-function deploy** required (guests use
  client-side anonymous auth). Confirm Supabase anonymous sign-in stays
  enabled.
- No new npm deps expected → no lockfile concern.
- Realtime: `room_knock_requests` and the `locked` flag ride the existing
  realtime subscription pattern.
