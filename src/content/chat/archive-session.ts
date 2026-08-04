import type { UserMessageArchive } from './user-message-archive';

/** The archive of the channel session currently on screen. It has two readers with nothing else
 * in common — the user card's per-user list and the dashboard's search — so it is owned here
 * rather than inside either of them. Null between sessions and after teardown. */
let sessionArchive: UserMessageArchive | null = null;

export function configureUserMessageArchive(archive: UserMessageArchive | null): void {
  sessionArchive = archive;
}

export function getUserMessageArchive(): UserMessageArchive | null {
  return sessionArchive;
}
