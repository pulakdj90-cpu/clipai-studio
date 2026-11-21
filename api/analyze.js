
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
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
      error: "Please paste a longer transcript"
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
- Choose funny, emotional, surprising or informative moments.
- Each clip should be 20 to 60 seconds.
- Use timestamps if present.
- Do not invent timestamps if transcript has none.
- Return JSON only.

TRANSCRIPT:
${transcript}
`;

  try {
    const response = await fetch(
    https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent  ?key=" + apiKey,
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
      return res.status(response.status).json({
        error: data.error?.message || "Gemini API request failed"
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({
        error: "Gemini returned an empty response"
      });
    }

    return res.status(200).json(JSON.parse(text));

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
