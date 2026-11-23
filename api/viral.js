
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST method" });
  }

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    const { transcript, language = "Hindi" } = req.body || {};

    if (typeof transcript !== "string" || transcript.trim().length < 30) {
      return res.status(400).json({
        error: "Please paste a longer transcript."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is missing in Vercel Environment Variables."
      });
    }

    // ----------------------------------------
    // TIMESTAMP EXTRACTION (supports milliseconds)
    // ----------------------------------------
    function extractTimestamps(text) {
      const regex =
        /(?<!\d)(\d{1,2}):(\d{2}):(\d{2})(?:[.,]\d+)?(?!\d)|(?<!\d)(\d{1,2}):(\d{2})(?:[.,]\d+)?(?!\d)/g;

      const times = [];

      for (const match of text.matchAll(regex)) {
        let seconds;

        // HH:MM:SS
        if (match[1] !== undefined) {
          seconds =
            Number(match[1]) * 3600 +
            Number(match[2]) * 60 +
            Number(match[3]);
        } else {
          // MM:SS
          seconds =
            Number(match[4]) * 60 +
            Number(match[5]);
        }

        if (Number.isFinite(seconds)) {
          times.push(seconds);
        }
      }

      return [...new Set(times)].sort((a, b) => a - b);
    }

    const timestamps = extractTimestamps(transcript);

    if (timestamps.length < 2) {
      return res.status(400).json({
        error: "Timestamped transcript required. Please paste transcript with timestamps such as 00:01:25."
      });
    }

    const transcriptDuration = Math.max(...timestamps);

    // ----------------------------------------
    // PROMPT
    // ----------------------------------------
    const prompt = `
You are a professional YouTube Shorts viral clip editor.

Analyze the transcript and find the BEST viral moments.

LANGUAGE: ${language}

RULES:
- Return up to 5 clips.
- Use ONLY timestamps from the provided timestamp list.
- Never invent timestamps.
- StartTime and EndTime MUST be exact values from the timestamp list.
- Each clip must be between 20 and 60 seconds.
- Clips must contain meaningful content.
- Prefer strong hooks, emotional moments, surprising facts,
  jokes, arguments, reactions, stories or useful advice.
- Each clip should make sense independently.
- Do not create overlapping clips.
- Do not return duplicate clips.
- Do not force 5 clips if fewer good clips exist.
- Never use a timestamp that is not present in the list.

AVAILABLE TIMESTAMPS:
${timestamps.join(", ")}

TRANSCRIPT:
${transcript}

Return JSON ONLY in this structure:

{
  "clips": [
    {
      "title": "Catchy title",
      "startTime": 25,
      "endTime": 50,
      "hook": "Strong opening hook",
      "startQuote": "Exact opening transcript words",
      "endQuote": "Exact ending transcript words",
      "viral": 90,
      "reason": "Why this clip could perform well",
      "confidence": 85
    }
  ],
  "titles": [
    "Shorts title 1",
    "Shorts title 2",
    "Shorts title 3"
  ],
  "hashtags": [
    "#shorts",
    "#viral"
  ]
}
`;

    // ----------------------------------------
    // MODEL FALLBACK
    // ----------------------------------------
    const models = [
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite"
    ];

    let result = null;
    let modelUsed = "";
    let lastError = "";

    for (const model of models) {
      let modelSuccess = false;

      // One retry for temporary server errors
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const controller = new AbortController();

          const timeout = setTimeout(
            () => controller.abort(),
            25000
          );

          const response = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/" +
              model +
              ":generateContent?key=" +
              encodeURIComponent(apiKey),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              signal: controller.signal,
              body: JSON.stringify({
                contents: [
                  {
                    parts: [{ text: prompt }]
                  }
                ],
                generationConfig: {
                  temperature: 0.25,
                  responseMimeType: "application/json"
                }
              })
            }
          );

          clearTimeout(timeout);

          const json = await response.json().catch(() => ({}));

          if (!response.ok) {
            const apiError =
              json?.error?.message ||
              "Gemini request failed (" + response.status + ")";

            lastError = apiError;

            // Retry only temporary errors
            if (
              response.status === 429 ||
              response.status === 500 ||
              response.status === 502 ||
              response.status === 503 ||
              response.status === 504
            ) {
              if (attempt === 0) {
                await sleep(1000);
                continue;
              }

              break;
            }

            // Permanent error: try next model
            break;
          }

          result = json;
          modelUsed = model;
          modelSuccess = true;
          break;

        } catch (error) {
          lastError =
            error.name === "AbortError"
              ? "Gemini request timed out."
              : error.message || "Network request failed.";

          if (attempt === 0) {
            await sleep(1000);
          }
        }
      }

      if (modelSuccess) break;
    }

    // ----------------------------------------
    // IF ALL MODELS FAIL
    // ----------------------------------------
    if (!result) {
      return res.status(503).json({
        error:
          "AI is temporarily busy. Please try again in a few seconds.",
        details: lastError
      });
    }

    // ----------------------------------------
    // READ RESPONSE
    // ----------------------------------------
    const responseText =
      result?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!responseText) {
      return res.status(502).json({
        error: "AI returned an empty response. Please try again."
      });
    }

    // ----------------------------------------
    // CLEAN JSON
    // ----------------------------------------
    function parseAIJson(text) {
      let cleaned = text
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      try {
        return JSON.parse(cleaned);
      } catch (_) {
        // Try extracting JSON object from response
        const first = cleaned.indexOf("{");
        const last = cleaned.lastIndexOf("}");

        if (first !== -1 && last > first) {
          return JSON.parse(cleaned.substring(first, last + 1));
        }

        throw new Error("AI response was not valid JSON.");
      }
    }

    const data = parseAIJson(responseText);

    if (!Array.isArray(data.clips)) {
      return res.status(502).json({
        error: "AI response format was invalid. Please try again."
      });
    }

    // ----------------------------------------
    // VALIDATE CLIPS
    // ----------------------------------------
    const validClips = data.clips
      .filter(clip => {
        const start = Number(clip.startTime);
        const end = Number(clip.endTime);

        return (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          start >= 0 &&
          end > start &&
          end - start >= 20 &&
          end - start <= 60 &&
          timestamps.includes(start) &&
          timestamps.includes(end)
        );
      })
      .map(clip => ({
        title: String(clip.title || "Viral Moment"),
        startTime: Number(clip.startTime),
        endTime: Number(clip.endTime),
        hook: String(clip.hook || ""),
        startQuote: String(clip.startQuote || ""),
        endQuote: String(clip.endQuote || ""),
        viral: Math.max(
          0,
          Math.min(100, Number(clip.viral) || 0)
        ),
        reason: String(clip.reason || ""),
        confidence: Math.max(
          0,
          Math.min(100, Number(clip.confidence) || 0)
        ),
        timingMode: "transcript"
      }));

    // ----------------------------------------
    // REMOVE DUPLICATES AND OVERLAPS
    // ----------------------------------------
    const finalClips = [];
    const usedStarts = new Set();

    // Best scores first
    validClips.sort((a, b) => b.viral - a.viral);

    for (const clip of validClips) {
      if (usedStarts.has(clip.startTime)) continue;

      const overlaps = finalClips.some(existing =>
        clip.startTime < existing.endTime &&
        clip.endTime > existing.startTime
      );

      if (overlaps) continue;

      usedStarts.add(clip.startTime);
      finalClips.push(clip);
    }

    // ----------------------------------------
    // SUCCESS
    // ----------------------------------------
    return res.status(200).json({
      success: true,
      modelUsed,
      timingMode: "transcript-based",
      timestampCount: timestamps.length,
      transcriptDuration,
      clips: finalClips.slice(0, 5),
      titles: Array.isArray(data.titles)
        ? data.titles.slice(0, 10)
        : [],
      hashtags: Array.isArray(data.hashtags)
        ? data.hashtags.slice(0, 20)
        : [],
      warning:
        finalClips.length < 5
          ? "Only clips with valid timestamps and 20-60 second duration were accepted."
          : null
    });

  } catch (error) {
    console.error("Viral API error:", error);

    return res.status(500).json({
      error:
        "Viral analysis failed. Please try again.",
      details: error.message || String(error)
    });
  }
}
