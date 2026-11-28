import express from "express";
import { getStatus, parseRequest } from "../controllers/assistantController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/status", getStatus);
router.post("/parse-request", parseRequest);

export default router;
