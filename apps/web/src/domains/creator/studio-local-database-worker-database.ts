import type {
  StudioBrushLibraryDatabase,
  StudioCrdtOutboxDatabase,
  StudioCrdtRecoveryDatabase,
  StudioFilterLibraryDatabase,
} from "./studio-local-database";
import type { StudioLocalDatabaseWorkerMethod } from "./studio-local-database-worker-protocol";

/** The concrete SQLite implementation's complete public async capability surface. */
export type StudioLocalDatabaseWorkerDatabase = StudioBrushLibraryDatabase &
  StudioFilterLibraryDatabase &
  StudioCrdtOutboxDatabase &
  StudioCrdtRecoveryDatabase;

type AsyncMethodName<T> = {
  [Key in keyof T]: T[Key] extends (...args: never[]) => Promise<unknown> ? Key : never;
}[keyof T];

type DatabaseRpcMethod = Exclude<
  Extract<AsyncMethodName<StudioLocalDatabaseWorkerDatabase>, string>,
  "close"
>;
type MissingProtocolMethod = Exclude<DatabaseRpcMethod, StudioLocalDatabaseWorkerMethod>;
type UnknownProtocolMethod = Exclude<StudioLocalDatabaseWorkerMethod, DatabaseRpcMethod>;

/** Compile-time drift tripwire: protocol and concrete async DB surface must remain identical. */
export const STUDIO_LOCAL_DATABASE_WORKER_METHOD_SURFACE_IS_COMPLETE: [
  MissingProtocolMethod,
  UnknownProtocolMethod,
] extends [never, never]
  ? true
  : never = true;
