export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "API key missing" });
  }

  const { transcript } = req.body || {};

  if (!transcript || transcript.length < 50) {
    return res.status(400).json({
      error: "Please paste a longer transcript"
    });
  }

  const models = [
    "gemini-2.5-flash",
    "gemini-2.0-flash"
  ];

  const prompt = `
Analyze this transcript and suggest 5 viral short video clips.

Return ONLY JSON:
{
  "clips": [
    {
      "start": "00:00:10",
      "end": "00:00:40",
      "title": "Clip title",
      "reason": "Why it is engaging"
    }
  ]
}

TRANSCRIPT:
${transcript}
`;

  for (const model of models) {
    try {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        model +
        ":generateContent?key=" +
        apiKey,
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
            ]
          })
        }
      );

      const data = await response.json();

      if (response.ok) {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text) {
          const cleaned = text.replace(/```json|```/g, "").trim();
          return res.status(200).json(JSON.parse(cleaned));
        }
      }
    } catch (error) {
      continue;
    }
  }

  return res.status(500).json({
    error: "Gemini models unavailable. Please try again later."
  });
}
