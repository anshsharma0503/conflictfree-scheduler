import mongoose from "mongoose";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Allowed reminder lead times in minutes. 0 turns reminders off. */
export const REMINDER_LEAD_OPTIONS = Object.freeze([0, 5, 10, 15, 30, 60, 1440]);
export const DEFAULT_REMINDER_MINUTES = 15;

const userSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      match: [emailPattern, "Please provide a valid email address"],
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: null,
      trim: true,
    },
    timezone: {
      type: String,
      required: true,
      default: "UTC",
      trim: true,
    },
    passwordHash: {
      type: String,
      default: null,
      select: false,
    },
    authProvider: {
      type: String,
      enum: ["google", "local"],
      required: true,
      default: "local",
    },
    calendarVersion: {
      type: Number,
      default: 0,
    },
    // Minutes before an event's start to send an in-app reminder (0 = off).
    reminderMinutesBefore: {
      type: Number,
      enum: REMINDER_LEAD_OPTIONS,
      default: DEFAULT_REMINDER_MINUTES,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

userSchema.pre("validate", function validateAuthProvider() {
  if (this.authProvider === "google" && !this.googleId) {
    this.invalidate("googleId", "Google users require a Google id");
  }

  if (this.authProvider === "local" && !this.passwordHash) {
    this.invalidate("passwordHash", "Local users require a password hash");
  }
});

const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;