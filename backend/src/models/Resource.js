import mongoose from "mongoose";

const resourceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Resource name is required"],
      trim: true,
      maxlength: [120, "Resource name cannot exceed 120 characters"],
    },
    type: {
      type: String,
      required: [true, "Resource type is required"],
      enum: {
        values: ["room", "equipment"],
        message: "Resource type must be either 'room' or 'equipment'",
      },
    },
    capacity: {
      type: Number,
      required: [true, "Capacity is required"],
      validate: {
        validator: function (val) {
          return Number.isInteger(val) && val >= 1;
        },
        message: "Capacity must be an integer of at least 1",
      },
    },
    location: {
      type: String,
      trim: true,
      default: "",
      maxlength: [200, "Location cannot exceed 200 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    bookingVersion: {
      type: Number,
      default: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Resource creator is required"],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

resourceSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);

const Resource =
  mongoose.models.Resource || mongoose.model("Resource", resourceSchema);

export default Resource;

