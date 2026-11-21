import User from "../models/User.js";
import { hashPassword, verifyPassword } from "./passwordService.js";
import { invalidateParticipantSearchCache } from "./search/participantSearchService.js";

export async function findOrCreateUserFromGoogleProfile(
  profile,
  { UserModel = User } = {},
) {
  if (!profile?.googleId) {
    throw new Error("Google profile googleId is required");
  }

  if (!profile?.email) {
    throw new Error("Google profile email is required");
  }

  const existingUser = await UserModel.findOne({
    $or: [{ googleId: profile.googleId }, { email: profile.email }],
  });

  // Creating an account, or linking Google to an existing account by email,
  // is only allowed when Google asserts the address is verified. Otherwise an
  // unverified Google identity could take over an existing account.
  const alreadyLinked =
    existingUser?.googleId && existingUser.googleId === profile.googleId;

  if (!alreadyLinked && profile.emailVerified !== true) {
    throw new Error("Google account email is not verified");
  }

  if (existingUser) {
    existingUser.googleId = profile.googleId;
    existingUser.email = profile.email;
    existingUser.name = profile.name || existingUser.name;
    existingUser.avatarUrl = profile.avatarUrl || existingUser.avatarUrl;
    existingUser.authProvider = "google";

    const savedUser = await existingUser.save();
    invalidateParticipantSearchCache();
    return savedUser;
  }

  const createdUser = await UserModel.create({
    googleId: profile.googleId,
    email: profile.email,
    name: profile.name || profile.email,
    avatarUrl: profile.avatarUrl || null,
    authProvider: "google",
  });
  invalidateParticipantSearchCache();
  return createdUser;
}

export async function registerLocalUser(
  { name, email, password },
  { UserModel = User } = {},
) {
  if (!name?.trim()) {
    throw new Error("Name is required");
  }

  if (!email?.trim()) {
    throw new Error("Email is required");
  }

  const existingUser = await UserModel.findOne({
    email: email.trim().toLowerCase(),
  });

  if (existingUser) {
    throw new Error("An account with this email already exists");
  }

  const passwordHash = await hashPassword(password);

  const newUser = await UserModel.create({
    name,
    email,
    passwordHash,
    authProvider: "local",
  });
  invalidateParticipantSearchCache();
  return newUser;
}

export async function loginLocalUser(
  { email, password },
  { UserModel = User } = {},
) {
  if (!email?.trim()) {
    throw new Error("Email is required");
  }

  if (!password) {
    throw new Error("Password is required");
  }

  const user = await UserModel.findOne({
    email: email.trim().toLowerCase(),
  }).select("+passwordHash");

  if (!user || user.authProvider !== "local") {
    throw new Error("Invalid email or password");
  }

  const passwordIsValid = await verifyPassword(password, user.passwordHash);

  if (!passwordIsValid) {
    throw new Error("Invalid email or password");
  }

  return user;
}
