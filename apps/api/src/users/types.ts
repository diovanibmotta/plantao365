import type { Role } from '../auth/index.js';

export interface ProfileDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  participatesInRotation: boolean;
  remindersEnabled: boolean;
}

export interface UserListItemDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  participatesInRotation: boolean;
  createdAt: string;
  linked: boolean;
}

export interface UpdateProfileInput {
  phone?: string | null;
  remindersEnabled?: boolean;
}

export interface CreateUserInput {
  name: string;
  email: string;
  role?: Role;
  participatesInRotation?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  participatesInRotation?: boolean;
  active?: boolean;
}
