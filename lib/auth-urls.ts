/**
 * The app's two auth entry points.
 *
 * Both go straight to Auth0 Universal Login — there is no in-app email form in
 * front of them. An earlier design collected the address on a branded `/signup`
 * page and forwarded it as `login_hint`, which meant people met two sign-in
 * screens in a row and typed their email on the first only to see it again on
 * the second. Universal Login is branded to match the site instead, so the
 * first screen is the only screen.
 *
 * Auth0 owns credential entry either way — this app never handles a password.
 *
 * `returnTo` is a fixed literal, never user input, so neither URL can become an
 * open redirect.
 */

const RETURN_TO = "/dashboard";

/** Existing user → Universal Login. */
export const SIGN_IN_URL = `/auth/login?returnTo=${encodeURIComponent(RETURN_TO)}`;

/** New user → Universal Login's signup screen (`screen_hint`). */
export const SIGN_UP_URL = `/auth/login?screen_hint=signup&returnTo=${encodeURIComponent(RETURN_TO)}`;
