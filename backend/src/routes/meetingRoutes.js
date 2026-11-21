import express from "express";
import {
  cancelMeeting,
  confirmMeeting,
  getInvitations,
  respondInvitation,
} from "../controllers/meetingController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.use(requireAuth);

router.post("/confirm", confirmMeeting);
router.get("/invitations", getInvitations);
router.patch("/:id/invitation-response", respondInvitation);
router.post("/:id/cancel", cancelMeeting);

export default router;
