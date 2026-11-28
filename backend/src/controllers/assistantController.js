import User from "../models/User.js";
import {
  getAssistantStatus,
  interpretSchedulingRequest,
  takeAssistantQuota,
} from "../services/assistant/assistantService.js";
import { validateRequestText } from "../services/assistant/schedulingRequestParser.js";
import { logger } from "../services/logger.js";
import { normalizeTimezone } from "../services/timezoneService.js";

export function getStatus(req, res) {
  return res.status(200).json({ success: true, assistant: getAssistantStatus() });
}

export async function parseRequest(req, res) {
  // Validate before spending quota, so a typo does not count as a request.
  try {
    validateRequestText(req.body?.text);
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }

  const quota = takeAssistantQuota(req.user.id);

  if (!quota.allowed) {
    res.set("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      success: false,
      message: `Too many assistant requests. Try again in ${quota.retryAfterSeconds}s.`,
    });
  }

  try {
    const account = await User.findById(req.user.id).select("timezone email name").lean();

    if (!account) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const started = Date.now();
    const { draft, model } = await interpretSchedulingRequest({
      text: req.body?.text,
      user: {
        id: req.user.id,
        email: account.email,
        timezone: normalizeTimezone(account.timezone, "UTC"),
      },
    });

    // Never log the request text: it can contain names and plans.
    logger.info("assistant_request_parsed", {
      model,
      latencyMs: Date.now() - started,
      participants: draft.participants.length,
      assumptions: draft.assumptions.length,
    });

    return res.status(200).json({ success: true, request: draft, model });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "The assistant could not read that request.",
    });
  }
}
