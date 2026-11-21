import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatParticipantSummary,
  normalizeParticipantEmails,
  resolveParticipants,
} from "../src/services/scheduling/participantAvailabilityService.js";

describe("participantAvailabilityService", () => {
  describe("normalizeParticipantEmails", () => {
    it("returns an empty array for undefined, null, or empty string", () => {
      assert.deepEqual(normalizeParticipantEmails(), []);
      assert.deepEqual(normalizeParticipantEmails(null), []);
      assert.deepEqual(normalizeParticipantEmails(""), []);
      assert.deepEqual(normalizeParticipantEmails([]), []);
    });

    it("normalizes and lowercases an array of emails", () => {
      const result = normalizeParticipantEmails([
        "  ALEX@Example.com  ",
        "bob@domain.org",
      ]);
      assert.deepEqual(result, ["alex@example.com", "bob@domain.org"]);
    });

    it("normalizes a comma-separated string of emails", () => {
      const result = normalizeParticipantEmails(
        " raj@example.com, Sarah@example.com , ",
      );
      assert.deepEqual(result, ["raj@example.com", "sarah@example.com"]);
    });

    it("deduplicates emails case-insensitively", () => {
      const result = normalizeParticipantEmails([
        "Raj@Example.com",
        "raj@example.com",
        "RAJ@EXAMPLE.COM",
      ]);
      assert.deepEqual(result, ["raj@example.com"]);
    });

    it("throws an error for invalid email format", () => {
      assert.throws(
        () => normalizeParticipantEmails(["valid@example.com", "not-an-email"]),
        /Invalid participant email format: "not-an-email"/,
      );
    });

    it("throws an error for non-string, non-array input", () => {
      assert.throws(
        () => normalizeParticipantEmails(12345),
        /participantEmails must be an array or comma-separated string/,
      );
    });
  });

  describe("formatParticipantSummary", () => {
    it("returns only id, name, email, and timezone, omitting private properties", () => {
      const userDoc = {
        _id: "user-123",
        name: "Test User",
        email: "Test@Example.COM",
        timezone: "Asia/Kolkata",
        passwordHash: "secret_hash",
        googleId: "google-123",
        __v: 0,
      };

      const summary = formatParticipantSummary(userDoc);
      assert.deepEqual(summary, {
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
        timezone: "Asia/Kolkata",
      });
      assert.equal(summary.passwordHash, undefined);
      assert.equal(summary.googleId, undefined);
    });
  });

  describe("resolveParticipants", () => {
    const mockOrganizer = {
      _id: "org-1",
      name: "Organizer User",
      email: "organizer@example.com",
      timezone: "America/New_York",
    };

    const mockParticipant = {
      _id: "part-1",
      name: "Participant User",
      email: "participant@example.com",
      timezone: "Europe/London",
    };

    it("throws if organizerId is missing", async () => {
      await assert.rejects(
        () => resolveParticipants({}),
        /organizerId is required/,
      );
    });

    it("throws if organizer is not found", async () => {
      const mockUserModel = {
        findById: async () => null,
      };

      await assert.rejects(
        () =>
          resolveParticipants({
            organizerId: "missing-org",
            UserModel: mockUserModel,
          }),
        /Organizer not found/,
      );
    });

    it("returns organizer as participants[0] when participantEmails is empty", async () => {
      const mockUserModel = {
        findById: async (id) => (id === "org-1" ? mockOrganizer : null),
      };

      const result = await resolveParticipants({
        organizerId: "org-1",
        participantEmails: [],
        UserModel: mockUserModel,
      });

      assert.equal(result.participants.length, 1);
      assert.equal(result.participants[0].id, "org-1");
      assert.equal(result.participants[0].timezone, "America/New_York");
      assert.deepEqual(result.userIds, ["org-1"]);
    });

    it("safely deduplicates organizer email if entered in participantEmails", async () => {
      const mockUserModel = {
        findById: async (id) => (id === "org-1" ? mockOrganizer : null),
        find: async () => [],
      };

      const result = await resolveParticipants({
        organizerId: "org-1",
        participantEmails: ["ORGANIZER@example.com"],
        UserModel: mockUserModel,
      });

      assert.equal(result.participants.length, 1);
      assert.equal(result.participants[0].id, "org-1");
      assert.deepEqual(result.userIds, ["org-1"]);
    });

    it("resolves valid participants and returns safe summary with organizer first", async () => {
      const mockUserModel = {
        findById: async (id) => (id === "org-1" ? mockOrganizer : null),
        find: () => ({
          collation: async () => [mockParticipant],
        }),
      };

      const result = await resolveParticipants({
        organizerId: "org-1",
        participantEmails: ["participant@example.com"],
        UserModel: mockUserModel,
      });

      assert.equal(result.participants.length, 2);
      assert.equal(result.participants[0].id, "org-1");
      assert.equal(result.participants[1].id, "part-1");
      assert.deepEqual(result.userIds, ["org-1", "part-1"]);
    });

    it("throws an error when one or more participant emails cannot be found", async () => {
      const mockUserModel = {
        findById: async (id) => (id === "org-1" ? mockOrganizer : null),
        find: () => ({
          collation: async () => [mockParticipant],
        }),
      };

      await assert.rejects(
        () =>
          resolveParticipants({
            organizerId: "org-1",
            participantEmails: [
              "participant@example.com",
              "unknown@example.com",
            ],
            UserModel: mockUserModel,
          }),
        /User not found for participant email: unknown@example.com/,
      );
    });

    it("resolves mixed-case stored emails case-insensitively with lowercase search input", async () => {
      const mixedCaseUser = {
        _id: "mixed-1",
        name: "Mixed Case User",
        email: "Raj.Patel@Example.COM",
        timezone: "Asia/Kolkata",
      };

      const mockUserModel = {
        findById: async (id) => (id === "org-1" ? mockOrganizer : null),
        find: () => ({
          collation: async () => [mixedCaseUser],
        }),
      };

      const result = await resolveParticipants({
        organizerId: "org-1",
        participantEmails: ["raj.patel@example.com"],
        UserModel: mockUserModel,
      });

      assert.equal(result.participants.length, 2);
      assert.equal(result.participants[1].id, "mixed-1");
      assert.equal(result.participants[1].email, "raj.patel@example.com");
    });
  });
});
