import { CreatorHomePage as MarketingCreatorHomePage } from "../marketing/CreatorHomePage";

import { CreatorHubEntry } from "./CreatorHubEntry";

/**
 * The root route renders the creator-first marketing home (#799) followed by the
 * creator resources hub entry (#788). Load both with the home route, never with the
 * shared Studio shell.
 */
export function CreatorHomePage() {
  return <><MarketingCreatorHomePage /><CreatorHubEntry /></>;
}
