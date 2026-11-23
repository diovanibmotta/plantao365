export { createUsersRouter, type UsersRouterDeps } from './router.js';
export { assertCanDeactivate, listFutureShifts, UsersError } from './service.js';
export type {
  CreateUserInput,
  FutureShiftDto,
  FutureShiftsFinder,
  ProfileDto,
  UpdateProfileInput,
  UpdateUserInput,
  UserListItemDto,
} from './types.js';
