
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST method" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY missing in Vercel settings"
    });
  }

  const { transcript } = req.body || {};

  if (!transcript || transcript.length < 50) {
    return res.status(400).json({
      error: "Please provide a longer transcript"
    });
  }

  const prompt = `
Analyze this transcript and suggest 5 viral short video clips.

Return ONLY valid JSON:
{
  "clips": [
    {
      "start": "00:00:10",
      "end": "00:00:40",
      "title": "Clip title",
      "reason": "Why this clip is engaging"
    }
  ]
}

Rules:
- Suggest 5 clips.
- Prefer funny, emotional, surprising or informative moments.
- Each clip should be 20 to 60 seconds.
- Use timestamps if they exist in the transcript.
- If timestamps are missing, do not invent exact timestamps.
- Return JSON only.

TRANSCRIPT:
${transcript}
`;

  const models = [
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash"
  ];

  let lastError = "All Gemini models failed";

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
              responseMimeType: "application/json"
            }
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        lastError =
          data.error?.message || `${model} failed`;

        continue;
      }

      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        lastError = `${model} returned empty response`;
        continue;
      }

      let result;

      try {
        result = JSON.parse(text);
      } catch {
        lastError = `${model} returned invalid JSON`;
        continue;
      }

      if (!result.clips || !Array.isArray(result.clips)) {
        lastError = `${model} returned invalid clips`;
        continue;
      }

      return res.status(200).json(result);

    } catch (error) {
      lastError = error.message || `${model} failed`;
    }
  }

  return res.status(503).json({
    error: "All AI models are busy or unavailable. Please try again later.",
    details: lastError
  });
}
