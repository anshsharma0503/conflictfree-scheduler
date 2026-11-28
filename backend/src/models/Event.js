import mongoose from "mongoose";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const eventParticipantSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [emailPattern, "Please provide a valid participant email"],
    },
    name: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
    },
    respondedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  },
);

const eventSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000,
    },
    startAt: {
      type: Date,
      required: true,
    },
    endAt: {
      type: Date,
      required: true,
    },
    timezone: {
      type: String,
      required: true,
      default: "UTC",
      trim: true,
    },
    location: {
      type: String,
      trim: true,
      default: "",
      maxlength: 200,
    },
    participants: {
      type: [eventParticipantSchema],
      default: [],
    },
    source: {
      type: String,
      enum: ["manual", "google"],
      default: "manual",
    },
    googleEventId: {
      type: String,
      trim: true,
      default: null,
    },
    resource: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resource",
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "cancelled"],
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

eventSchema.pre("validate", function validateEventTime() {
  if (this.startAt && this.endAt && this.endAt <= this.startAt) {
    this.invalidate("endAt", "Event end time must be after start time");
  }
});

eventSchema.index({ owner: 1, startAt: 1 });
eventSchema.index({ owner: 1, endAt: 1 });
eventSchema.index({ resource: 1, startAt: 1 });
eventSchema.index({ resource: 1, endAt: 1 });
eventSchema.index({ "participants.user": 1, startAt: 1 });
eventSchema.index({ "participants.email": 1, startAt: 1 });
eventSchema.index({ "participants.user": 1, "participants.status": 1 });
eventSchema.index({ status: 1 });
// Reminder sweep: active events starting inside the next reminder window.
eventSchema.index({ startAt: 1, status: 1 });

const Event = mongoose.models.Event || mongoose.model("Event", eventSchema);

export default Event;
