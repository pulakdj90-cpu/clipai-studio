export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST method" });
  }

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    const { transcript, language = "Hindi" } = req.body || {};

    // 1. Validate transcript
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

    // 2. Extract timestamps
    function extractTimestamps(text) {
      const regex =
        /\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d+))?\b|\b(\d{1,2}):(\d{2})(?:[.,](\d+))?\b/g;

      const times = [];

      for (const match of text.matchAll(regex)) {
        let seconds;

        if (match[3] !== undefined) {
          // HH:MM:SS
          seconds =
            Number(match[1] || 0) * 3600 +
            Number(match[2]) * 60 +
            Number(match[3]);
        } else {
          // MM:SS
          seconds =
            Number(match[5]) * 60 +
            Number(match[6]);
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
        error: "Timestamped transcript required. Please paste transcript containing timestamps such as 00:01:25."
      });
    }

    const transcriptDuration = Math.max(...timestamps);

    // 3. Build AI prompt
    const prompt = `
You are an expert YouTube Shorts viral clip editor.

Analyze the transcript and select the BEST viral moments.

LANGUAGE: ${language}

RULES:
- Return maximum 5 clips.
- Use ONLY timestamps from the supplied timestamp list.
- NEVER invent timestamps.
- StartTime and EndTime must exactly match timestamps in the list.
- Clip length must be between 20 and 60 seconds.
- Select engaging moments independently.
- Clips must not overlap.
- Do not repeat the same moment.
- Avoid boring introductions.
- Prefer hooks, surprising facts, emotional moments, arguments,
  jokes, reactions, stories, powerful advice, suspense or curiosity.
- Each clip should make sense without watching the full video.
- Do not invent quotes.
- Return fewer clips if fewer good moments exist.
- Return JSON only.

AVAILABLE TIMESTAMPS (SECONDS):
${timestamps.join(", ")}

TRANSCRIPT:
${transcript}

Return this JSON structure:

{
  "clips": [
    {
      "title": "Catchy title",
      "startTime": 25,
      "endTime": 50,
      "hook": "Opening hook",
      "startQuote": "Exact opening transcript words",
      "endQuote": "Exact ending transcript words",
      "viral": 90,
      "reason": "Why this moment is engaging",
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

    // 4. Model fallback list
    const models = [
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite"
    ];

    let data = null;
    let modelUsed = "";
    let lastError = "";

    // 5. Try models with retry
    for (const model of models) {
      let success = false;

      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();

        const timeout = setTimeout(() => {
          controller.abort();
        }, 25000);

        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              signal: controller.signal,
              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                            parts: [{ text: prompt }]
                  }
                ],
                generationConfig: {
                  temperature: 0.2,
                  responseMimeType: "application/json"
                }
              })
          });

          clearTimeout(timeout);

          const result = await response.json();

          if (!response.ok) {
            lastError =
              result?.error?.message ||
              `Gemini HTTP ${response.status}`;

            // Retry temporary errors
            if (
              response.status === 429 ||
              response.status === 500 ||
              response.status === 502 ||
              response.status === 503 ||
              response.status === 504
            ) {
              if (attempt === 0) {
                await sleep(1200);
                continue;
              }
            }

            // Try next model for permanent model errors
            break;
          }

          const responseText =
            result?.candidates?.[0]?.content?.parts
              ?.map(part => part.text || "")
              .join("")
              .trim();

          if (!responseText) {
            lastError = "Gemini returned an empty response.";
            break;
          }

          data = parseAIJson(responseText);

          if (!data || !Array.isArray(data.clips)) {
            lastError = "Invalid AI response structure.";
            data = null;
            break;
          }

          modelUsed = model;
          success = true;
          break;

        } catch (error) {
          clearTimeout(timeout);

          lastError =
            error.name === "AbortError"
              ? "Gemini request timed out."
              : error.message || "Network request failed.";

          if (attempt === 0) {
            await sleep(1000);
          }
        }
      }

      if (success) break;
    }

    // 6. All models failed
    if (!data) {
      console.error("Gemini API failure:", lastError);

      return res.status(503).json({
        error: "AI service is temporarily unavailable. Please try again.",
        details: lastError
      });
    }

    // 7. Validate clips
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

    // 8. Remove duplicates and overlapping clips
    validClips.sort((a, b) => b.viral - a.viral);

    const finalClips = [];
    const usedStarts = new Set();

    for (const clip of validClips) {
      if (usedStarts.has(clip.startTime)) continue;

      const overlap = finalClips.some(existing =>
        clip.startTime < existing.endTime &&
        clip.endTime > existing.startTime
      );

      if (overlap) continue;

      usedStarts.add(clip.startTime);
      finalClips.push(clip);
    }

    // 9. Success
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
          ? "Only clips with valid timestamps and 20–60 second duration were accepted."
          : null
    });

  } catch (error) {
    console.error("Viral API error:", error);

    return res.status(500).json({
      error: "Viral analysis failed.",
      details: error.message || String(error)
    });
  }
}

// 10. Safe JSON parser
function parseAIJson(text) {
  if (!text) return null;

  let cleaned = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // First try direct JSON
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // Extract JSON object if AI adds extra text
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first !== -1 && last > first) {
    const json = cleaned.slice(first, last + 1);

    try {
      return JSON.parse(json);
    } catch (_) {}
  }

  return null;
}
