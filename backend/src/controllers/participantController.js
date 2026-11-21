import { searchParticipants } from "../services/search/participantSearchService.js";

export async function searchParticipantsHandler(req, res) {
  const { q, limit } = req.query;

  if (typeof q !== "string" || q.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: "Search query must be at least 2 characters",
    });
  }

  if (limit !== undefined && limit !== null && limit !== "") {
    const parsedLimit = Number(limit);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 20
    ) {
      return res.status(400).json({
        success: false,
        message: "Limit must be an integer between 1 and 20",
      });
    }
  }

  try {
    const participants = await searchParticipants({
      query: q,
      limit,
      organizerId: req.user?.id || req.user?._id,
      organizerEmail: req.user?.email,
    });

    return res.status(200).json({
      success: true,
      participants,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
}

