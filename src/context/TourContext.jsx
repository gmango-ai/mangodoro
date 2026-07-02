import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "./AppContext";
import { useTeam } from "./TeamContext";
import { TOURS, getTour } from "../lib/tours/registry";
import { runTour, showRemedy, waitForElement } from "../lib/tours/engine";
import {
  evalPrerequisite,
  isTourAvailable as calcAvailable,
  tourStatus as calcStatus,
  computeAnnouncements,
} from "../lib/tours/logic";

// Ties the pure tour logic (logic.js) to the driver.js engine (engine.js) and
// the live app. Provides start/replay + status queries; persists completion via
// AppContext's onboarding setters. Mounted inside the Router + App/Team
// providers (see AuthenticatedApp), so `useNavigate`/`useApp`/`useTeam` are safe.

const TourContext = createContext(null);
export const useTour = () => useContext(TourContext) || { active: false };

export function TourProvider({ children }) {
  const navigate = useNavigate();
  const { settings, session, dataLoaded, markTourComplete, setSeenTourMarker } = useApp();
  const team = useTeam();
  const [active, setActive] = useState(false);
  const [activeTourId, setActiveTourId] = useState(null);
  const driverRef = useRef(null);
  const onboarding = settings?.onboarding || {};

  // Live snapshot a prerequisite reads. `waitFor` is bound here so steps/entries
  // can await lazily-mounted targets (routes are Suspense-lazy; menus mount on click).
  const buildCtx = useCallback(() => ({
    navigate,
    waitFor: (sel, opts) => waitForElement(sel, opts),
    teams: team.teams || [],
    activeTeam: team.activeTeam || null,
    isAdmin: !!team.isAdmin,
    canManageRooms: !!team.isAdmin || (team.myOrgTeamLeadIds?.size || 0) > 0,
    teamMembers: team.teamMembers || [],
    visibleRooms: team.visibleRooms || [],
    rooms: team.rooms || [],
    hasJoinedRoomEver: !!onboarding.checklist?.room,
    hasGoals: !!onboarding.checklist?.goal,
    settings,
  }), [
    navigate, team.teams, team.activeTeam, team.isAdmin, team.myOrgTeamLeadIds,
    team.teamMembers, team.visibleRooms, team.rooms, onboarding.checklist, settings,
  ]);

  const endActive = useCallback(() => { setActive(false); setActiveTourId(null); driverRef.current = null; }, []);

  const startTour = useCallback(async (id) => {
    const tour = getTour(id);
    if (!tour || active) return;
    const ctx = buildCtx();
    const pre = evalPrerequisite(tour, ctx);
    if (!pre.ok) {
      // Don't launch a tour whose target can't exist yet — guide to the unmet
      // prerequisite (deep-link + explanatory popover) instead.
      if (pre.remedy?.type === "deep-link" && pre.remedy.to) navigate(pre.remedy.to);
      driverRef.current = await showRemedy(
        pre.remedy?.selector || null,
        { title: "One step first", description: pre.reason || "Finish the earlier step to unlock this tutorial." },
        ctx,
      );
      return;
    }
    setActive(true);
    setActiveTourId(id);
    if (tour.entry?.to) navigate(tour.entry.to);
    if (tour.entry?.await) await ctx.waitFor(tour.entry.await, { timeout: 6000 });
    driverRef.current = runTour(tour, ctx, {
      onComplete: () => { markTourComplete(id); endActive(); },
      onDismiss: endActive,
    });
  }, [active, buildCtx, navigate, markTourComplete, endActive]);

  const isTourAvailable = useCallback((id) => calcAvailable(getTour(id), buildCtx()), [buildCtx]);
  const tourStatus = useCallback((id) => calcStatus(getTour(id), buildCtx(), onboarding), [buildCtx, onboarding]);

  // "New feature" announcements (WhatsNew-style). On a user's first-ever load we
  // seed the marker to the newest one SILENTLY so existing users aren't blasted
  // with the whole backlog. Surfacing newer-than-seen tours as a toast lands in
  // Phase 5; the seed is safe to run now (no-op until a tour declares a marker).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !dataLoaded || !session?.user?.id) return;
    if (onboarding.seenTourMarker != null) { seededRef.current = true; return; }
    const { seedMarker } = computeAnnouncements(TOURS, onboarding.seenTourMarker, buildCtx());
    seededRef.current = true;
    if (seedMarker) setSeenTourMarker(seedMarker);
  }, [dataLoaded, session?.user?.id, onboarding.seenTourMarker, buildCtx, setSeenTourMarker]);

  const value = useMemo(() => ({
    active, activeTourId, startTour, replayTour: startTour,
    isTourAvailable, tourStatus, tours: TOURS,
  }), [active, activeTourId, startTour, isTourAvailable, tourStatus]);

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
