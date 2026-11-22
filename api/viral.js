export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST method" });
  }

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
        error: "Gemini API key missing"
      });
    }

    // Detect timestamps in transcript
    function extractTimestamps(text) {
      const regex = /\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?/g;
      const times = [];

      for (const match of text.matchAll(regex)) {
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

        if (Number.isFinite(seconds)) {
          times.push(seconds);
        }
      }

      return [...new Set(times)].sort((a, b) => a - b);
    }

    const timestamps = extractTimestamps(transcript);
    const hasTimestamps = timestamps.length >= 2;
    const transcriptEnd = timestamps.length
      ? Math.max(...timestamps)
      : null;

    const prompt = `
You are an expert YouTube Shorts viral clip editor.

Find the 5 BEST engaging moments from the transcript.

LANGUAGE: ${language}

STRICT TIMESTAMP RULES:
- Read the transcript carefully.
- If transcript timestamps exist, use them as timing references.
- Never invent timestamp values that are not supported by the transcript.
- Never make clips start at 0 unless the actual moment starts at 0.
- Never create clips at fixed intervals such as 0, 10, 20, 30.
- Clips must start at DIFFERENT moments.
- Do not repeat the same clip.
- Prefer clips of 30 to 60 seconds.
- If the available transcript is shorter, shorter clips are acceptable.
- startTime and endTime must be numeric seconds.
- endTime must always be greater than startTime.
- Use transcript wording for startQuote and endQuote.
- Never invent quotes.
- Choose funny, emotional, surprising, useful or curiosity-building moments.
- If timestamps are missing, timing is an ESTIMATE, not exact.

TIMESTAMP MODE:
${hasTimestamps ? "TIMESTAMPED TRANSCRIPT" : "NO TIMESTAMPS"}

TIMESTAMP VALUES AVAILABLE:
${timestamps.length ? timestamps.join(", ") : "None"}

MAX TRANSCRIPT TIME:
${transcriptEnd !== null ? transcriptEnd : "Unknown"}

Return JSON ONLY:

{
  "clips": [
    {
      "title": "Short catchy title",
      "startTime": 120,
      "endTime": 165,
      "hook": "Opening hook",
      "startQuote": "Exact words from transcript",
      "endQuote": "Exact ending words from transcript",
      "viral": 85,
      "reason": "Why viewers will watch",
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
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);

      return res.status(502).json({
        error: "Gemini analysis failed.",
        details: errorText.slice(0, 300)
      });
    }

    const result = await response.json();
    const responseText =
      result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      throw new Error("Gemini returned an empty response.");
    }

    const data = JSON.parse(responseText);

    if (!Array.isArray(data.clips)) {
      throw new Error("Invalid clips response.");
    }

    // Validate AI timestamps
    const clips = data.clips
      .filter(clip =>
        Number.isFinite(Number(clip.startTime)) &&
        Number.isFinite(Number(clip.endTime)) &&
        Number(clip.endTime) > Number(clip.startTime)
      )
      .map(clip => {
        let start = Math.max(0, Number(clip.startTime));
        let end = Math.max(start, Number(clip.endTime));

        // Limit timestamps to transcript range
        if (transcriptEnd !== null) {
          start = Math.min(start, transcriptEnd);
          end = Math.min(end, transcriptEnd);
        }

        start = Math.round(start);
        end = Math.round(end);

        return {
          title: String(clip.title || "Viral Moment"),
          startTime: start,
          endTime: end,
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
          timingSource: hasTimestamps
            ? "transcript"
            : "estimated"
        };
      })
      .filter(clip => clip.endTime > clip.startTime);

    // Remove duplicate or almost-identical clips
    const uniqueClips = [];
    const usedStarts = new Set();

    for (const clip of clips) {
      if (usedStarts.has(clip.startTime)) continue;

      usedStarts.add(clip.startTime);
      uniqueClips.push(clip);
    }

    return res.status(200).json({
      success: true,
      modelUsed: "gemini-3.5-flash-lite",
      timestampMode: hasTimestamps
        ? "transcript-based"
        : "estimated",
      timestampCount: timestamps.length,
      clips: uniqueClips.slice(0, 5),
      titles: Array.isArray(data.titles)
        ? data.titles
        : [],
      hashtags: Array.isArray(data.hashtags)
        ? data.hashtags
        : [],
      warning: hasTimestamps
        ? null
        : "Transcript timestamps missing. Clip timings are AI estimates, not exact."
    });

  } catch (error) {
    console.error("Viral API Error:", error);

    return res.status(500).json({
      error: error.message || "Viral analysis failed."
    });
  }
}
