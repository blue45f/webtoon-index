import type {
  StudioCrdtRasterDocumentSnapshot,
  StudioCrdtRasterRawRoots,
} from "../../../shared/lib/studio-crdt-raster-document-contract";

export const STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION = 1 as const;

export interface StudioCrdtRasterWorkerRunMessage {
  type: "studio-crdt-raster/run";
  version: typeof STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION;
  roots: StudioCrdtRasterRawRoots;
}

export interface StudioCrdtRasterWorkerSuccessMessage {
  type: "studio-crdt-raster/success";
  version: typeof STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION;
  snapshot: StudioCrdtRasterDocumentSnapshot;
}

export interface StudioCrdtRasterWorkerReadyMessage {
  type: "studio-crdt-raster/ready";
  version: typeof STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION;
}

export interface StudioCrdtRasterWorkerFailureMessage {
  type: "studio-crdt-raster/failure";
  version: typeof STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION;
  error: {
    name: string;
    message: string;
  };
}

export type StudioCrdtRasterWorkerResponseMessage =
  | StudioCrdtRasterWorkerReadyMessage
  | StudioCrdtRasterWorkerSuccessMessage
  | StudioCrdtRasterWorkerFailureMessage;
