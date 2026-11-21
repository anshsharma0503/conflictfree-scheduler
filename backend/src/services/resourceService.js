import mongoose from "mongoose";
import Resource from "../models/Resource.js";

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

export function formatResource(resource) {
  if (!resource) return null;
  return {
    id: resource._id ? resource._id.toString() : resource.id,
    name: resource.name,
    type: resource.type,
    capacity: resource.capacity,
    location: resource.location || "",
    description: resource.description || "",
    isActive: resource.isActive,
    createdBy: resource.createdBy?.toString(),
    createdAt: resource.createdAt instanceof Date ? resource.createdAt.toISOString() : resource.createdAt,
    updatedAt: resource.updatedAt instanceof Date ? resource.updatedAt.toISOString() : resource.updatedAt,
  };
}

export async function createResource(
  { name, type, capacity, location = "", description = "", userId },
  { ResourceModel = Resource } = {},
) {
  if (!name || typeof name !== "string" || !name.trim()) {
    const error = new Error("Resource name is required");
    error.status = 400;
    throw error;
  }

  const trimmedName = name.trim();

  if (!type || !["room", "equipment"].includes(type)) {
    const error = new Error("Resource type must be either 'room' or 'equipment'");
    error.status = 400;
    throw error;
  }

  const parsedCapacity = Number(capacity);
  if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
    const error = new Error("Capacity must be an integer of at least 1");
    error.status = 400;
    throw error;
  }

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error("A valid creator user ID is required");
    error.status = 400;
    throw error;
  }

  // Case-insensitive duplicate check
  let existing = null;
  try {
    const query = ResourceModel.findOne({ name: trimmedName });
    if (typeof query.collation === "function") {
      existing = await query.collation({ locale: "en", strength: 2 });
    } else {
      existing = await query;
    }
  } catch {
    existing = await ResourceModel.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, "i") },
    });
  }

  if (existing) {
    const error = new Error(`Resource with name "${trimmedName}" already exists`);
    error.status = 400;
    throw error;
  }

  const resource = await ResourceModel.create({
    name: trimmedName,
    type,
    capacity: parsedCapacity,
    location: location ? location.trim() : "",
    description: description ? description.trim() : "",
    isActive: true,
    createdBy: userId,
  });

  return formatResource(resource);
}

export async function listActiveResources({ ResourceModel = Resource } = {}) {
  const resources = await ResourceModel.find({ isActive: true }).sort({ name: 1 });
  return resources.map(formatResource);
}

export async function getResourceById(id, { ResourceModel = Resource } = {}) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error("Resource not found");
    error.status = 404;
    throw error;
  }

  const resource = await ResourceModel.findById(id);
  if (!resource) {
    const error = new Error("Resource not found");
    error.status = 404;
    throw error;
  }

  return formatResource(resource);
}

export async function updateResource(
  id,
  userId,
  updates = {},
  { ResourceModel = Resource } = {},
) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error("Resource not found");
    error.status = 404;
    throw error;
  }

  const resource = await ResourceModel.findById(id);
  if (!resource) {
    const error = new Error("Resource not found");
    error.status = 404;
    throw error;
  }

  if (resource.createdBy.toString() !== userId.toString()) {
    const error = new Error("You are not authorized to edit this resource");
    error.status = 403;
    throw error;
  }

  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || !updates.name.trim()) {
      const error = new Error("Resource name cannot be empty");
      error.status = 400;
      throw error;
    }

    const trimmedName = updates.name.trim();

    let duplicate = null;
    try {
      const query = ResourceModel.findOne({
        _id: { $ne: resource._id },
        name: trimmedName,
      });
      if (typeof query.collation === "function") {
        duplicate = await query.collation({ locale: "en", strength: 2 });
      } else {
        duplicate = await query;
      }
    } catch {
      duplicate = await ResourceModel.findOne({
        _id: { $ne: resource._id },
        name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, "i") },
      });
    }

    if (duplicate) {
      const error = new Error(`Resource with name "${trimmedName}" already exists`);
      error.status = 400;
      throw error;
    }

    resource.name = trimmedName;
  }

  if (updates.type !== undefined) {
    if (!["room", "equipment"].includes(updates.type)) {
      const error = new Error("Resource type must be either 'room' or 'equipment'");
      error.status = 400;
      throw error;
    }
    resource.type = updates.type;
  }

  if (updates.capacity !== undefined) {
    const parsedCapacity = Number(updates.capacity);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
      const error = new Error("Capacity must be an integer of at least 1");
      error.status = 400;
      throw error;
    }
    resource.capacity = parsedCapacity;
  }

  if (updates.location !== undefined) {
    resource.location = typeof updates.location === "string" ? updates.location.trim() : "";
  }

  if (updates.description !== undefined) {
    resource.description = typeof updates.description === "string" ? updates.description.trim() : "";
  }

  if (updates.isActive !== undefined) {
    resource.isActive = Boolean(updates.isActive);
  }

  await resource.save();
  return formatResource(resource);
}

export async function deleteResource(
  id,
  userId,
  { ResourceModel = Resource } = {},
) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error("Resource not found");
    error.status = 404;
    throw error;
  }

  const resource = await ResourceModel.findById(id);
  if (!resource) {
    const error = new Error("Resource not found");
    error.status = 404;
    throw error;
  }

  if (resource.createdBy.toString() !== userId.toString()) {
    const error = new Error("You are not authorized to delete this resource");
    error.status = 403;
    throw error;
  }

  // Soft deactivation
  resource.isActive = false;
  await resource.save();

  return formatResource(resource);
}

