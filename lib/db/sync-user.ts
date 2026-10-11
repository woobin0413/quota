/**
 * User Sync Helper
 *
 * Ensures users exist in the database when they authenticate via Auth0.
 * Auto-creates users on first request if they don't exist.
 *
 * @module lib/db/sync-user
 */

import { getUserByAuth0Id, createUser } from "./users";
import type { User } from "@/types/database";

export interface SyncUserInput {
  auth0UserId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}

/**
 * Get or create user from Auth0 session data
 *
 * Ensures a user row exists for the authenticated Auth0 subject.
 * Creates the user automatically on first login.
 */
export async function getOrCreateUser(input: SyncUserInput): Promise<User> {
  const existingUser = await getUserByAuth0Id(input.auth0UserId);

  if (existingUser) {
    return existingUser;
  }

  const newUser = await createUser({
    auth0UserId: input.auth0UserId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    avatarUrl: input.avatarUrl,
  });

  console.log(
    `[DB] Created new user: ${newUser.id} for Auth0 user: ${input.auth0UserId}`
  );

  return newUser;
}
