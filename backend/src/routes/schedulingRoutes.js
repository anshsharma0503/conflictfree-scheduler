import express from "express";
import {
  checkConflicts,
  findSlots,
  suggestSlots,
} from "../controllers/schedulingController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.use(requireAuth);

router.post("/conflicts", checkConflicts);
router.post("/available-slots", findSlots);
router.post("/suggestions", suggestSlots);

export default router;