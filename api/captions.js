
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { videoTitle, captions, language = "Hindi" } = req.body || {};

    if (!captions || !captions.trim()) {
      return res.status(400).json({
        error: "Please provide video captions"
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Gemini API key is missing"
      });
    }

    const prompt = `
You are an expert YouTube Shorts creator.

Analyze these video captions and create:
1. A catchy Shorts title
2. 5 viral hooks
3. Best short clip moments
4. Captions for each moment
5. Suggested hashtags

Video title: ${videoTitle || "Unknown"}

Language: ${language}

Video captions:
${captions}

Return the answer in clear ${language}.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey,
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

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "AI request failed"
      });
    }

    const result =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return res.status(200).json({
      success: true,
      result
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
