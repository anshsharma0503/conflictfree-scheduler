import express from "express";
import {
  getNotifications,
  getPreferences,
  readAllNotifications,
  readNotification,
  updatePreferences,
} from "../controllers/notificationController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.use(requireAuth);

// Fixed paths before "/:id" so "preferences" is never read as an id.
router.get("/", getNotifications);
router.get("/preferences", getPreferences);
router.patch("/preferences", updatePreferences);
router.post("/read-all", readAllNotifications);
router.patch("/:id/read", readNotification);

export default router;
