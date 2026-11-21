import express from "express";
import { searchParticipantsHandler } from "../controllers/participantController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/search", searchParticipantsHandler);

export default router;

