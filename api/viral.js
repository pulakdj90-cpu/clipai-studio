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

    // Transcript ke timestamps detect karna
    function parseTimestamp(text) {
      const regex = /(?:\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]|\b(\d{1,2}):(\d{2}):(\d{2})\b|\b(\d{1,2}):(\d{2})\b)/g;
      let match;
      const times = [];

      while ((match = regex.exec(text)) !== null) {
        let seconds = 0;

        if (match[1] !== undefined) {
          seconds = match[3] !== undefined
            ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
            : Number(match[1]) * 60 + Number(match[2]);
        } else if (match[4] !== undefined) {
          seconds = Number(match[4]) * 3600 + Number(match[5]) * 60 + Number(match[6]);
        } else {
          seconds = Number(match[7]) * 60 + Number(match[8]);
        }

        times.push(seconds);
      }

      return [...new Set(times)].sort((a, b) => a - b);
    }

    const transcriptTimes = parseTimestamp(transcript);
    const hasRealTimestamps = transcriptTimes.length >= 2;
    const transcriptDuration = transcriptTimes.length
      ? Math.max(...transcriptTimes)
      : null;

    const prompt = `
You are an expert YouTube Shorts viral clip editor.

Analyze the transcript and select exactly 5 genuinely engaging moments.

LANGUAGE:
${language}

IMPORTANT TIMESTAMP RULES:
- If transcript contains timestamps, use ONLY those timestamp positions as timing anchors.
- Never invent timestamps when real transcript timestamps are available.
- Each clip must begin near its actual interesting sentence.
- End near the end of that moment.
- Clips must not overlap unnecessarily.
- Each clip should ideally be 30-60 seconds.
- If the transcript has no timestamps, you may estimate timing, but estimates MUST NOT be presented as exact.
- Do not give every clip the same start or end time.
- Do not create fake quotes.
- startTime and endTime must be numeric seconds.
- endTime must always be greater than startTime.

TRANSCRIPT HAS TIMESTAMPS: ${hasRealTimestamps}
AVAILABLE TIMESTAMPS (seconds):
${transcriptTimes.join(", ") || "NONE"}

TRANSCRIPT DURATION (seconds):
${transcriptDuration ?? "UNKNOWN"}

Find clips based on:
1. Strong hooks
2. Surprising or emotional moments
3. Funny or relatable moments
4. Useful or informative moments
5. High curiosity or shareability

Return JSON only in this format:

{
  "clips": [
    {
      "title": "Catchy clip title",
      "startTime": 30,
      "endTime": 65,
      "hook": "Strong opening hook",
      "startQuote": "Exact transcript beginning",
      "endQuote": "Exact transcript ending",
      "viral": 85,
      "reason": "Why viewers will watch",
      "confidence": 85
    }
  ],
  "titles": ["Title 1", "Title 2", "Title 3"],
  "hashtags": ["#shorts", "#viral", "#youtube"]
}

TRANSCRIPT:
${transcript}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error("Gemini API error: " + errorText);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Gemini returned an empty response.");
    }

    const data = JSON.parse(text);
    const clips = Array.isArray(data.clips) ? data.clips : [];

    // Clip data validation
    const validClips = clips
      .filter(clip =>
        Number.isFinite(Number(clip.startTime)) &&
        Number.isFinite(Number(clip.endTime)) &&
        Number(clip.endTime) > Number(clip.startTime)
      )
      .map(clip => {
        let start = Math.max(0, Number(clip.startTime));
        let end = Math.max(start + 1, Number(clip.endTime));

        // Real timestamp transcript ke duration se bahar nahi jane dena
        if (transcriptDuration !== null) {
          start = Math.min(start, transcriptDuration);
          end = Math.min(end, transcriptDuration);
        }

        return {
          ...clip,
          startTime: Math.round(start),
          endTime: Math.round(end),
          viral: Math.min(100, Math.max(0, Number(clip.viral) || 0)),
          confidence: Math.min(100, Math.max(0, Number(clip.confidence) || 0)),
          timingSource: hasRealTimestamps ? "transcript" : "estimated"
        };
      })
      .filter(clip => clip.endTime > clip.startTime);

    return res.status(200).json({
      success: true,
      modelUsed: "gemini-3.5-flash-lite",
      timestampMode: hasRealTimestamps ? "transcript-based" : "estimated",
      transcriptTimestampCount: transcriptTimes.length,
      clips: validClips,
      titles: data.titles || [],
      hashtags: data.hashtags || [],
      warning: hasRealTimestamps
        ? null
        : "Transcript mein real timestamps nahi hain. Clip timing estimated hai."
    });

  } catch (error) {
    console.error("Viral API Error:", error);

    return res.status(500).json({
      error: error.message || "Viral analysis failed."
    });
  }
}
