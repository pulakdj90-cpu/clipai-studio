
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Gemini API key missing in Vercel" });
  }

  const { transcript } = req.body || {};

  if (!transcript || transcript.length < 50) {
    return res.status(400).json({
      error: "Please paste a longer transcript"
    });
  }

  const prompt = `
Analyze this video transcript and find the 5 best viral short clips.

Return ONLY valid JSON in this format:
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
- Clips should be engaging, funny, surprising, emotional, or informative.
- Each clip should be 20 to 60 seconds.
- Use timestamps if present in the transcript.
- Do not invent timestamps if the transcript has none.
- Return JSON only.

TRANSCRIPT:
${transcript}
`;

  const models = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash"
  ];

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
        continue;
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (text) {
        return res.status(200).json(JSON.parse(text));
      }
    } catch (error) {
      continue;
    }
  }

  return res.status(500).json({
    error: "Gemini AI unavailable. Check API key, quota and model access."
  });
}
