import User from "../../models/User.js";
import { Trie } from "./trieService.js";

let cachedTrie = null;

export function invalidateParticipantSearchCache() {
  cachedTrie = null;
}

export function getCachedParticipantTrie() {
  return cachedTrie;
}

export async function buildParticipantTrie({
  UserModel = User,
} = {}) {
  const trie = new Trie();

  if (UserModel && typeof UserModel.find === "function") {
    const users = await UserModel.find({})
      .select("_id name email timezone")
      .lean();

    for (const user of users) {
      trie.indexUser({
        id: user._id ? user._id.toString() : user.id,
        name: user.name,
        email: user.email,
        timezone: user.timezone,
      });
    }
  }

  return trie;
}

export async function getOrBuildParticipantTrie({
  UserModel = User,
  forceRefresh = false,
} = {}) {
  if (!cachedTrie || forceRefresh) {
    cachedTrie = await buildParticipantTrie({ UserModel });
  }

  return cachedTrie;
}

export function validateParticipantSearchQuery(query) {
  if (typeof query !== "string") {
    throw new Error("Search query must be a string");
  }

  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new Error("Search query must be at least 2 characters");
  }

  return trimmed;
}

export function validateParticipantSearchLimit(limit) {
  if (limit === undefined || limit === null || limit === "") {
    return 10;
  }

  const parsed = Number(limit);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new Error("Limit must be an integer between 1 and 20");
  }

  return parsed;
}

export async function searchParticipants({
  query,
  limit = 10,
  organizerId,
  organizerEmail,
  UserModel = User,
  forceRefresh = false,
} = {}) {
  const normalizedQuery = validateParticipantSearchQuery(query);
  const normalizedLimit = validateParticipantSearchLimit(limit);

  const trie = await getOrBuildParticipantTrie({
    UserModel,
    forceRefresh,
  });

  // Request extra items from Trie in case organizer is present and filtered out
  const rawResults = trie.searchPrefix(normalizedQuery, normalizedLimit + 1);

  const normalizedOrganizerId = organizerId ? organizerId.toString() : null;
  const normalizedOrganizerEmail = organizerEmail
    ? organizerEmail.trim().toLowerCase()
    : null;

  const filtered = rawResults.filter((participant) => {
    if (
      normalizedOrganizerId &&
      participant.id.toString() === normalizedOrganizerId
    ) {
      return false;
    }

    if (
      normalizedOrganizerEmail &&
      participant.email.toLowerCase() === normalizedOrganizerEmail
    ) {
      return false;
    }

    return true;
  });

  return filtered.slice(0, normalizedLimit);
}

