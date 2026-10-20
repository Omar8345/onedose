import "server-only";

import { cookies } from "next/headers";
import { Account, AppwriteException, Client, Teams, type Models } from "node-appwrite";
import { z } from "zod";

const SESSION_COOKIE = "onedose_session";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APPWRITE_ENDPOINT: z.url(),
  NEXT_PUBLIC_APPWRITE_PROJECT_ID: z.string().min(1),
});

const adminEnvSchema = publicEnvSchema.extend({
  APPWRITE_API_KEY: z.string().min(1),
});

export type OneDosePrefs = Models.Preferences & {
  primaryTeamId?: string;
  circleId?: string;
};

function client(session?: string) {
  const env = publicEnvSchema.parse(process.env);
  const appwrite = new Client()
    .setEndpoint(env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(env.NEXT_PUBLIC_APPWRITE_PROJECT_ID);

  if (session) appwrite.setSession(session);
  return appwrite;
}

export function getAdminAccount() {
  const env = adminEnvSchema.parse(process.env);
  const appwrite = new Client()
    .setEndpoint(env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(env.NEXT_PUBLIC_APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
  return new Account(appwrite);
}

export function getPublicAccount() {
  return new Account(client());
}

export function getSessionServices(secret: string) {
  const appwrite = client(secret);
  return {
    account: new Account(appwrite),
    teams: new Teams(appwrite),
  };
}

export async function getSessionSecret() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function getCurrentUser() {
  const secret = await getSessionSecret();
  if (!secret) return null;

  try {
    return await getSessionServices(secret).account.get<OneDosePrefs>();
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 401) return null;
    throw error;
  }
}

export async function requireCurrentUser() {
  const secret = await getSessionSecret();
  if (!secret) throw new AppwriteException("Authentication required.", 401);

  const services = getSessionServices(secret);
  const user = await services.account.get<OneDosePrefs>();
  return { secret, user, ...services };
}

export async function setSessionCookie(session: Models.Session) {
  const expires = new Date(session.expire);
  (await cookies()).set(SESSION_COOKIE, session.secret, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
