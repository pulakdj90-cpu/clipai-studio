
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST method" });
  }

  try {
    const { transcript, language = "Hindi" } = req.body || {};

    if (!transcript || typeof transcript !== "string" || transcript.trim().length < 30) {
      return res.status(400).json({
        error: "Please paste a longer transcript."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Gemini API key missing"
      });
    }

    // Transcript se available timestamps detect karo
    function parseTimestamp(text) {
      const matches = [...text.matchAll(
        /(?:\[|\()?\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b(?:\]|\))?/g
      )];

      let maxTime = 0;

      for (const match of matches) {
        let seconds;

        if (match[3] !== undefined) {
          seconds =
            Number(match[1]) * 3600 +
            Number(match[2]) * 60 +
            Number(match[3]);
        } else {
          seconds =
            Number(match[1]) * 60 +
            Number(match[2]);
        }

        if (seconds > maxTime) maxTime = seconds;
      }

      return maxTime;
    }

    const transcriptDuration = parseTimestamp(transcript);

    const prompt = `
You are an expert YouTube Shorts viral clip editor.

Analyze the transcript and find exactly 5 engaging moments.

LANGUAGE:
${language}

TIMESTAMP RULES:
1. Every clip MUST have numeric startTime and endTime in seconds.
2. Never return null, empty, missing, or identical timestamps.
3. startTime must be at least 0.
4. endTime must be greater than startTime.
5. Clips should ideally be 30 to 60 seconds.
6. Do not create clips outside the transcript duration.
7. Use actual transcript timestamps whenever available.
8. If transcript timestamps are unavailable, estimate timings using transcript position and length.
9. Every clip must have a different time range.
10. Never use 0-30 for every clip.
11. Do not invent exact transcript quotes.
12. Prefer funny, surprising, emotional, controversial, informative, or strong-hook moments.
13. If the transcript is short, clips may be shorter than 30 seconds.

TRANSCRIPT TIMESTAMP INFORMATION:
Maximum timestamp detected: ${transcriptDuration} seconds.
${transcriptDuration > 0
  ? "Use the detected transcript timestamps as your timing reference."
  : "Transcript has no reliable timestamps. Estimate clip timings from transcript position and clearly treat them as estimates."}

RETURN JSON ONLY:

{
  "clips": [
    {
      "title": "Catchy clip title",
      "startTime": 45,
      "endTime": 85,
      "hook": "Opening hook",
      "startQuote": "Quote from transcript",
      "endQuote": "Quote from transcript",
      "viralScore": 90,
      "reason": "Why viewers may watch"
    }
  ],
  "titles": [
    "YouTube title 1",
    "YouTube title 2",
    "YouTube title 3"
  ],
  "hashtags": [
    "#shorts",
    "#viral",
    "#youtube",
    "#trending",
    "#video"
  ]
}

TRANSCRIPT:
${transcript}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Gemini API error"
      });
    }

    const rawResult =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawResult) {
      return res.status(500).json({
        error: "AI returned empty response"
      });
    }

    // JSON response clean karo
    const cleanedResult = rawResult
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleanedResult);

    if (!Array.isArray(parsed.clips)) {
      return res.status(500).json({
        error: "AI response format is invalid"
      });
    }

    // Timestamp validation aur correction
    const clips = parsed.clips.slice(0, 5).map((clip, index) => {
      let start = Number(clip.startTime);
      let end = Number(clip.endTime);

      const invalidStart =
        !Number.isFinite(start) || start < 0;

      const invalidEnd =
        !Number.isFinite(end) || end <= start;

      // Missing timestamp ke liye estimated fallback
      if (invalidStart || invalidEnd) {
        const fallbackStart = index * 40;

        start = fallbackStart;
        end = fallbackStart + 30;
      }

      // Duration ko 30-60 sec range mein adjust karo
      let duration = end - start;

      if (duration > 60) {
        end = start + 60;
      }

      if (duration < 30) {
        end = start + 30;
      }

      // Transcript ke known duration se bahar na jane do
      if (transcriptDuration > 0) {
        if (start >= transcriptDuration) {
          start = Math.max(0, transcriptDuration - 30);
        }

        if (end > transcriptDuration) {
          end = transcriptDuration;
        }

        if (end <= start) {
          start = Math.max(0, end - 15);
        }
      }

      return {
        ...clip,
        startTime: Math.round(start),
        endTime: Math.round(end),
        duration: Math.max(0, Math.round(end - start)),
        viralScore: Math.min(
          100,
          Math.max(0, Number(clip.viralScore) || 70)
        )
      };
    });

    return res.status(200).json({
      ...parsed,
      clips,
      mode: "gemini-ai",
      timestampStatus: "validated"
    });

  } catch (error) {
    console.error("Viral analysis error:", error);

    return res.status(500).json({
      error: error.message || "AI analysis failed"
    });
  }
}
