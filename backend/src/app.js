import cookieParser from "cookie-parser";
import express from "express";
import { apiNotFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import assistantRoutes from "./routes/assistantRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import meetingRoutes from "./routes/meetingRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import participantRoutes from "./routes/participantRoutes.js";
import resourceRoutes from "./routes/resourceRoutes.js";
import schedulingRoutes from "./routes/schedulingRoutes.js";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use("/api/assistant", assistantRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/meetings", meetingRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/participants", participantRoutes);
app.use("/api/resources", resourceRoutes);
app.use("/api/scheduling", schedulingRoutes);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ConflictFree API is running",
  });
});

app.use("/api", apiNotFoundHandler);
app.use(errorHandler);

export default app;
