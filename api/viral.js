export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST method" });
  }

  try {
    const { transcript, language = "Hindi" } = req.body || {};

    if (
      typeof transcript !== "string" ||
      transcript.trim().length < 30
    ) {
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

    // Extract actual timestamps from transcript
    function extractTimestamps(text) {
      const regex =
        /\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b|\b(\d{1,2}):(\d{2})\b/g;

      const times = [];

      for (const match of text.matchAll(regex)) {
        let seconds;

        if (match[3] !== undefined) {
          seconds =
            Number(match[1] || 0) * 3600 +
            Number(match[2]) * 60 +
            Number(match[3]);
        } else {
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
    const hasTimestamps = timestamps.length >= 2;
    const transcriptDuration = hasTimestamps
      ? Math.max(...timestamps)
      : null;

    // Require real timestamps for reliable clip timing
    if (!hasTimestamps) {
      return res.status(400).json({
        error:
          "Transcript timestamps not found. Please paste YouTube transcript with timestamps."
      });
    }

    const prompt = `
You are an expert YouTube Shorts viral clip editor.

Analyze this transcript and find the 5 BEST viral moments.

LANGUAGE: ${language}

STRICT TIMING RULES:
- Use ONLY timestamps found in the transcript.
- Never invent timestamps.
- Every clip must start and end at real transcript timestamps.
- Prefer clips between 20 and 60 seconds.
- Never return clips shorter than 20 seconds.
- Never return clips longer than 60 seconds.
- Clips must be different moments.
- Do not repeat the same start time.
- Do not create overlapping clips unless absolutely necessary.
- Never use 00:00 unless the transcript actually has timestamp 00:00.
- Choose moments with jokes, reactions, surprising facts, suspense,
  emotional moments, strong hooks or interesting conversations.
- Select meaningful moments, not random sections.
- If fewer than 5 reliable clips exist, return only the clips that
  meet the rules.
- Do not fake timestamps to fill 5 clips.

AVAILABLE REAL TIMESTAMPS IN SECONDS:
${timestamps.join(", ")}

TRANSCRIPT:
${transcript}

Return valid JSON ONLY in this exact format:

{
  "clips": [
    {
      "title": "Catchy clip title",
      "startTime": 25,
      "endTime": 50,
      "hook": "Opening hook",
      "startQuote": "Exact transcript beginning",
      "endQuote": "Exact transcript ending",
      "viral": 90,
      "reason": "Why viewers will watch",
      "confidence": 85
    }
  ],
  "titles": [
    "YouTube title 1",
    "YouTube title 2",
    "YouTube title 3"
  ],
  "hashtags": [
    "#shorts",
    "#viral"
  ]
}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
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

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          result?.error?.message ||
          "Gemini API request failed"
      });
    }

    const responseText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      throw new Error("Empty Gemini response");
    }

    // Clean JSON response
    const cleaned = responseText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const data = JSON.parse(cleaned);

    if (!Array.isArray(data.clips)) {
      throw new Error("Invalid clips response");
    }

    // Validate clips using transcript timestamps
    const validClips = data.clips
      .filter((clip) => {
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
      .map((clip) => ({
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

    // Remove duplicate and overlapping clips
    const finalClips = [];
    const usedStarts = new Set();

    for (const clip of validClips) {
      if (usedStarts.has(clip.startTime)) continue;

      const overlaps = finalClips.some(
        (existing) =>
          clip.startTime < existing.endTime &&
          clip.endTime > existing.startTime
      );

      if (overlaps) continue;

      usedStarts.add(clip.startTime);
      finalClips.push(clip);
    }

    return res.status(200).json({
      success: true,
      modelUsed: "gemini-3.5-flash-lite",
      timingMode: "transcript-based",
      timestampCount: timestamps.length,
      transcriptDuration: transcriptDuration,
      clips: finalClips.slice(0, 5),
      titles: Array.isArray(data.titles)
        ? data.titles
        : [],
      hashtags: Array.isArray(data.hashtags)
        ? data.hashtags
        : [],
      warning:
        finalClips.length < 5
          ? "Only clips with valid transcript timestamps and 20-60 second duration were accepted."
          : null
    });
  } catch (error) {
    console.error("Viral API error:", error);

    return res.status(500).json({
      error: error.message || "Viral analysis failed."
    });
  }
}
