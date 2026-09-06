import { useEffect } from "react";

import { bootStudioTournamentPersistence } from "../../studio-tournament-persistence-bootstrap";

/** Starts optional persistence outside the pen-down dependency path. */
export function useStudioTournamentPersistenceBoot(): void {
  useEffect(() => {
    void bootStudioTournamentPersistence();
  }, []);
}
