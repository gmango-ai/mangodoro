import { useSyncExternalStore } from "react";
import {
  getParticipantSort,
  setParticipantSort,
  subscribeParticipantSort,
} from "../lib/participantSort";

// Read the shared participant-sort choice and a setter. Every list that calls
// this re-renders together when the choice changes (see lib/participantSort).
export function useParticipantSort() {
  const mode = useSyncExternalStore(
    subscribeParticipantSort,
    getParticipantSort,
    getParticipantSort
  );
  return [mode, setParticipantSort];
}
