import type { StudioCommentActor, StudioCommentThread } from "./studio-comments";

function normalizedActorName(actor: StudioCommentActor): string {
  return actor.displayName.trim().normalize("NFKC").toLocaleLowerCase();
}

/** Matches the same collaborator while keeping account IDs authoritative. */
export function studioCommentActorsRepresentSamePerson(
  left: StudioCommentActor,
  right: StudioCommentActor
): boolean {
  if (left.id || right.id) return Boolean(left.id && right.id && left.id === right.id);
  return normalizedActorName(left) === normalizedActorName(right);
}

export function studioCommentThreadAssignedToActor(
  thread: StudioCommentThread,
  actor: StudioCommentActor
): boolean {
  return Boolean(
    thread.assignee
    && studioCommentActorsRepresentSamePerson(thread.assignee, actor)
  );
}

/** The opening message and every reply participate in the mention inbox. */
export function studioCommentThreadMentionsActor(
  thread: StudioCommentThread,
  actor: StudioCommentActor
): boolean {
  return [thread, ...thread.replies].some((message) =>
    message.mentions.some((mention) =>
      studioCommentActorsRepresentSamePerson(mention, actor)
    )
  );
}
