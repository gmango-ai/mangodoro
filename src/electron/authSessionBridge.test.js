import { describe, expect, it, vi } from "vitest";
import {
  isElectronAuthPayload,
  restoreElectronAuthSession,
  toElectronAuthPayload,
} from "./authSessionBridge";

describe("electron auth session bridge", () => {
  it("serializes only the token fields needed to restore Supabase auth", () => {
    expect(
      toElectronAuthPayload({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: 123,
        token_type: "bearer",
        user: { id: "user-id" },
      })
    ).toEqual({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_at: 123,
      token_type: "bearer",
    });
  });

  it("returns null when either token is missing", () => {
    expect(toElectronAuthPayload(null)).toBeNull();
    expect(toElectronAuthPayload({ access_token: "access-token" })).toBeNull();
    expect(toElectronAuthPayload({ refresh_token: "refresh-token" })).toBeNull();
  });

  it("validates payload shape", () => {
    expect(isElectronAuthPayload({ access_token: "a", refresh_token: "r" })).toBe(true);
    expect(isElectronAuthPayload({ access_token: "", refresh_token: "r" })).toBe(false);
    expect(isElectronAuthPayload({ access_token: "a", refresh_token: "" })).toBe(false);
    expect(isElectronAuthPayload({ access_token: "a" })).toBe(false);
  });

  it("restores a Supabase session from a valid payload", async () => {
    const restoredSession = { user: { id: "user-id" } };
    const setSession = vi.fn().mockResolvedValue({ data: { session: restoredSession }, error: null });

    await expect(
      restoreElectronAuthSession(
        { auth: { setSession } },
        { access_token: "access-token", refresh_token: "refresh-token" }
      )
    ).resolves.toBe(restoredSession);

    expect(setSession).toHaveBeenCalledWith({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
  });

  it("does not call Supabase when payload is invalid", async () => {
    const setSession = vi.fn();

    await expect(
      restoreElectronAuthSession({ auth: { setSession } }, { access_token: "access-token" })
    ).resolves.toBeNull();

    expect(setSession).not.toHaveBeenCalled();
  });
});
