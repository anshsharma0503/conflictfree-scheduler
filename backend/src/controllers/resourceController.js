import {
  createResource,
  deleteResource,
  getResourceById,
  listActiveResources,
  updateResource,
} from "../services/resourceService.js";
import {
  REALTIME_EVENTS,
  emitToAuthenticated,
} from "../realtime/realtimeService.js";

export async function createResourceHandler(req, res) {
  try {
    const resource = await createResource({
      ...req.body,
      userId: req.user.id,
    });

    emitToAuthenticated(REALTIME_EVENTS.RESOURCE_CREATED, { resource });

    return res.status(201).json({
      success: true,
      resource,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function listResourcesHandler(req, res) {
  try {
    const resources = await listActiveResources();
    return res.status(200).json({
      success: true,
      resources,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function getResourceByIdHandler(req, res) {
  try {
    const resource = await getResourceById(req.params.id);
    return res.status(200).json({
      success: true,
      resource,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function updateResourceHandler(req, res) {
  try {
    const resource = await updateResource(
      req.params.id,
      req.user.id,
      req.body,
    );

    emitToAuthenticated(REALTIME_EVENTS.RESOURCE_UPDATED, { resource });

    return res.status(200).json({
      success: true,
      resource,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function deleteResourceHandler(req, res) {
  try {
    const resource = await deleteResource(req.params.id, req.user.id);

    emitToAuthenticated(REALTIME_EVENTS.RESOURCE_DEACTIVATED, { resource });

    return res.status(200).json({
      success: true,
      message: "Resource deactivated successfully",
      resource,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

 