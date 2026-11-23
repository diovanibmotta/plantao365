export { createUnavailabilityRouter, type UnavailabilityRouterDeps } from './router.js';
export { listUnavailableByDate } from './service.js';
export type {
  CollectiveImpactChecker,
  ConflictArgs,
  ConflictChecker,
  ConflictWarning,
  ShiftsAffectedWarning,
  UnavailabilityConflictEvent,
  UnavailabilityWarning,
  UnavailabilityDto,
  UnavailabilityKind,
  UnavailableByDate,
} from './types.js';
