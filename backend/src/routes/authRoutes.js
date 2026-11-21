import express from "express";
import {
  getCurrentUser,
  handleGoogleCallback,
  login,
  logout,
  register,
  startGoogleLogin,
} from "../controllers/authController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/google", startGoogleLogin);
router.get("/google/callback", handleGoogleCallback);
router.get("/me", requireAuth, getCurrentUser);
router.post("/logout", logout);

export default router;