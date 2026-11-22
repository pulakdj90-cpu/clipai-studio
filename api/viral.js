
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

    // Detect timestamps from transcript
    function extractTimestamps(text) {
      const regex =
        /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]|(\b\d{1,2}:\d{2}:\d{2}\b)/g;

      const times = [];

      for (const match of text.matchAll(regex)) {
        let seconds = 0;

        if (match[1] !== undefined) {
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
        } else if (match[4]) {
          const parts = match[4].split(":").map(Number);
          seconds =
            parts[0] * 3600 +
            parts[1] * 60 +
            parts[2];
        }

        times.push(seconds);
      }

      return [...new Set(times)].sort((a, b) => a - b);
    }

    const timestamps = extractTimestamps(transcript);
    const hasTimestampedTranscript = timestamps.length >= 2;
    const transcriptEnd = timestamps.length
      ? Math.max(...timestamps)
      : null;

    const prompt = `
You are a professional YouTube Shorts viral clip editor.

Analyze the transcript and find the 5 best engaging moments.

LANGUAGE: ${language}

TIMESTAMP RULES:
- Transcript timestamps are the most important timing reference.
- Use timestamps that are supported by the transcript.
- Do not invent exact timings when transcript timestamps are missing.
- Never use the same start time for multiple clips.
- Clips must not overlap unless absolutely necessary.
- Each clip should ideally be 30 to 60 seconds.
- If the transcript is too short, use shorter clips rather than inventing content.
- startTime and endTime must be numbers in seconds.
- endTime must be greater than startTime.
- Do not invent quotes. Use words actually present in the transcript.
- Select moments with hooks, emotion, surprise, humor, useful information, or curiosity.
- If timestamps are missing, timing is only an estimate.

TRANSCRIPT TIMESTAMP MODE:
${hasTimestampedTranscript ? "TIMESTAMPED TRANSCRIPT" : "NO RELIABLE TIMESTAMPS"}

AVAILABLE TIMESTAMPS IN SECONDS:
${timestamps.length ? timestamps.join(", ") : "None"}

TRANSCRIPT END TIME:
${transcriptEnd !== null ? transcriptEnd : "Unknown"}

Return JSON only in this exact structure:

{
  "clips": [
    {
      "title": "Short catchy title",
      "startTime": 30,
      "endTime": 60,
      "hook": "Opening hook",
      "startQuote": "Exact quote from transcript",
      "endQuote": "Exact quote from transcript",
      "viral": 85,
      "reason": "Why this moment is engaging",
      "confidence": 80
    }
  ],
  "titles": ["Title 1", "Title 2", "Title 3"],
  "hashtags": ["#shorts", "#viral", "#youtube"]
}

TRANSCRIPT:
${transcript}
`;

    const apiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" +
      encodeURIComponent(apiKey);

    const response = await fetch(apiUrl, {
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
          responseMimeType: "application/json",
          temperature: 0.2
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);

      return res.status(502).json({
        error: "Gemini analysis failed.",
        details: errorText.slice(0, 500)
      });
    }

    const result = await response.json();
    const responseText =
      result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      throw new Error("Empty response from Gemini.");
    }

    const data = JSON.parse(responseText);

    if (!Array.isArray(data.clips)) {
      throw new Error("Invalid clips response.");
    }

    // Validate and clean clip results
    const clips = data.clips
      .filter(clip => {
        return (
          Number.isFinite(Number(clip.startTime)) &&
          Number.isFinite(Number(clip.endTime)) &&
          Number(clip.endTime) > Number(clip.startTime)
        );
      })
      .map(clip => {
        let start = Math.max(0, Number(clip.startTime));
        let end = Math.max(start, Number(clip.endTime));

        // Never exceed known transcript duration
        if (transcriptEnd !== null) {
          start = Math.min(start, transcriptEnd);
          end = Math.min(end, transcriptEnd);
        }

        return {
          title: String(clip.title || "Viral Moment"),
          startTime: Math.round(start),
          endTime: Math.round(end),
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
          timingSource: hasTimestampedTranscript
            ? "transcript"
            : "estimated"
        };
      })
      .filter(clip => clip.endTime > clip.startTime);

    // Remove duplicate start times
    const uniqueClips = [];
    const seenStarts = new Set();

    for (const clip of clips) {
      if (seenStarts.has(clip.startTime)) continue;
      seenStarts.add(clip.startTime);
      uniqueClips.push(clip);
    }

    return res.status(200).json({
      success: true,
      modelUsed: "gemini-3.5-flash-lite",
      timestampMode: hasTimestampedTranscript
        ? "transcript-based"
        : "estimated",
      timestampCount: timestamps.length,
      clips: uniqueClips.slice(0, 5),
      titles: Array.isArray(data.titles) ? data.titles : [],
      hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
      warning: hasTimestampedTranscript
        ? null
        : "Transcript has no reliable timestamps. Clip timings are estimated."
    });

  } catch (error) {
    console.error("Viral API Error:", error);

    return res.status(500).json({
      error: error.message || "Viral analysis failed."
    });
  }
}
