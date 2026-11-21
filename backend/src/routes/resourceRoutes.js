import express from "express";
import {
  createResourceHandler,
  deleteResourceHandler,
  getResourceByIdHandler,
  listResourcesHandler,
  updateResourceHandler,
} from "../controllers/resourceController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.use(requireAuth);

router.post("/", createResourceHandler);
router.get("/", listResourcesHandler);
router.get("/:id", getResourceByIdHandler);
router.patch("/:id", updateResourceHandler);
router.delete("/:id", deleteResourceHandler);

export default router;

