import User from "../../models/User.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeParticipantEmails(input = []) {
  if (!input) {
    return [];
  }

  let rawList = [];

  if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === "string") {
    rawList = input.split(",");
  } else {
    throw new Error("participantEmails must be an array or comma-separated string");
  }

  const normalizedSet = new Set();

  for (const item of rawList) {
    if (typeof item !== "string") {
      throw new Error("Participant email must be a string");
    }

    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }

    if (!emailPattern.test(trimmed)) {
      throw new Error(`Invalid participant email format: "${trimmed}"`);
    }

    normalizedSet.add(trimmed.toLowerCase());
  }

  return Array.from(normalizedSet);
}

export function formatParticipantSummary(user) {
  return {
    id: user._id ? user._id.toString() : user.id,
    name: user.name || "",
    email: user.email ? user.email.toLowerCase() : "",
    timezone: user.timezone || "UTC",
  };
}

export async function resolveParticipants({
  organizerId,
  participantEmails = [],
  UserModel = User,
  organizerFallback = null,
}) {
  if (!organizerId) {
    throw new Error("organizerId is required");
  }

  let organizer = null;

  try {
    if (UserModel && typeof UserModel.findById === "function") {
      organizer = await UserModel.findById(organizerId);
    }
  } catch {
  }

  if (!organizer) {
    if (organizerFallback) {
      organizer = organizerFallback;
    } else {
      throw new Error("Organizer not found");
    }
  }

  const organizerSummary = formatParticipantSummary(organizer);
  const normalizedEmails = normalizeParticipantEmails(participantEmails);

  const additionalEmails = normalizedEmails.filter(
    (email) => email !== organizerSummary.email,
  );

  if (additionalEmails.length === 0) {
    return {
      participants: [organizerSummary],
      userIds: [organizerSummary.id],
    };
  }

  let foundUsers = [];

  try {
    const query = UserModel.find({
      email: { $in: additionalEmails },
    });

    if (typeof query.collation === "function") {
      foundUsers = await query.collation({ locale: "en", strength: 2 });
    } else {
      foundUsers = await query;
    }
  } catch {
    foundUsers = await UserModel.find({
      email: { $in: additionalEmails },
    });
  }

  const foundEmailMap = new Map();
  for (const user of foundUsers) {
    if (user?.email) {
      foundEmailMap.set(user.email.toLowerCase(), user);
    }
  }

  const missingEmails = [];
  const participantSummaries = [];

  for (const requestedEmail of additionalEmails) {
    const matchedUser = foundEmailMap.get(requestedEmail);
    if (!matchedUser) {
      missingEmails.push(requestedEmail);
    } else {
      participantSummaries.push(formatParticipantSummary(matchedUser));
    }
  }

  if (missingEmails.length > 0) {
    throw new Error(
      `User not found for participant email: ${missingEmails.join(", ")}`,
    );
  }

  const allParticipants = [organizerSummary, ...participantSummaries];

  return {
    participants: allParticipants,
    userIds: allParticipants.map((p) => p.id),
  };
}
