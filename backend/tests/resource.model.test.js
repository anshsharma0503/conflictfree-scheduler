import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Resource from "../src/models/Resource.js";

test("Resource model accepts valid room resource", () => {
  const resource = new Resource({
    name: "Conference Room A",
    type: "room",
    capacity: 10,
    location: "Building 1, Floor 2",
    description: "Has projector and whiteboard",
    createdBy: new mongoose.Types.ObjectId(),
  });

  const error = resource.validateSync();
  assert.equal(error, undefined);
  assert.equal(resource.name, "Conference Room A");
  assert.equal(resource.type, "room");
  assert.equal(resource.capacity, 10);
  assert.equal(resource.isActive, true);
});

test("Resource model accepts valid equipment resource", () => {
  const resource = new Resource({
    name: "HD Projector #1",
    type: "equipment",
    capacity: 1,
    createdBy: new mongoose.Types.ObjectId(),
  });

  const error = resource.validateSync();
  assert.equal(error, undefined);
  assert.equal(resource.type, "equipment");
});

test("Resource model requires name, type, capacity, and createdBy", () => {
  const resource = new Resource({});
  const error = resource.validateSync();

  assert.notEqual(error, undefined);
  assert.ok(error.errors.name);
  assert.ok(error.errors.type);
  assert.ok(error.errors.capacity);
  assert.ok(error.errors.createdBy);
});

test("Resource model rejects invalid type", () => {
  const resource = new Resource({
    name: "Vehicle 1",
    type: "vehicle",
    capacity: 4,
    createdBy: new mongoose.Types.ObjectId(),
  });

  const error = resource.validateSync();
  assert.notEqual(error, undefined);
  assert.ok(error.errors.type);
});

test("Resource model rejects non-integer or capacity less than 1", () => {
  const zeroResource = new Resource({
    name: "Small Room",
    type: "room",
    capacity: 0,
    createdBy: new mongoose.Types.ObjectId(),
  });
  assert.notEqual(zeroResource.validateSync(), undefined);

  const floatResource = new Resource({
    name: "Fractional Room",
    type: "room",
    capacity: 5.5,
    createdBy: new mongoose.Types.ObjectId(),
  });
  assert.notEqual(floatResource.validateSync(), undefined);

  const negativeResource = new Resource({
    name: "Negative Room",
    type: "room",
    capacity: -3,
    createdBy: new mongoose.Types.ObjectId(),
  });
  assert.notEqual(negativeResource.validateSync(), undefined);
});

