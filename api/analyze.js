
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST method required" });
  }

  try {
    const { transcript } = req.body || {};

    if (!transcript || transcript.trim().length < 50) {
      return res.status(400).json({
        error: "Please provide a video transcript (at least 50 characters)."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is missing"
      });
    }

    const prompt = `
Analyze this video transcript and suggest the best viral short clips.

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

Suggest up to 5 clips. Prefer interesting, emotional,
funny, surprising, or informative moments.

TRANSCRIPT:
${transcript}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Gemini API error"
      });
    }

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!result) {
      return res.status(500).json({
        error: "No response from AI"
      });
    }

    return res.status(200).json(JSON.parse(result));

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
