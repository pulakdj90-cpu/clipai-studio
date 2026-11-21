
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST method" });
  }

  try {
    const { transcript } = req.body || {};

    if (!transcript || transcript.trim().length < 20) {
      return res.status(400).json({
        error: "Please provide a longer transcript."
      });
    }

    // Clean transcript
    const text = transcript.trim();

    // Split transcript into sentences
    const sentences = text
      .replace(/\n+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .filter(s => s.trim().length > 10);

    const keywords = [
      "funny", "amazing", "surprise", "shocking",
      "secret", "crazy", "fail", "win", "best",
      "incredible", "unexpected", "emotional",
      "interesting", "problem", "solution", "wow"
    ];

    // Score sentences for interesting moments
    const scored = sentences.map((sentence, index) => {
      const lower = sentence.toLowerCase();
      let score = 0;

      keywords.forEach(word => {
        if (lower.includes(word)) score += 2;
      });

      if (sentence.length > 40) score += 1;
      if (sentence.includes("!")) score += 2;
      if (sentence.includes("?")) score += 1;

      return { sentence, index, score };
    });

    // Select best sentences
    scored.sort((a, b) => b.score - a.score);

    const selected = scored.slice(0, 5).sort(
      (a, b) => a.index - b.index
    );

    const clips = selected.map((item, i) => {
      const startSeconds = i * 30;
      const endSeconds = startSeconds + 30;

      const formatTime = seconds => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        return [
          String(h).padStart(2, "0"),
          String(m).padStart(2, "0"),
          String(s).padStart(2, "0")
        ].join(":");
      };

      return {
        start: formatTime(startSeconds),
        end: formatTime(endSeconds),
        title: item.sentence.slice(0, 80),
        reason: "Selected from transcript using keyword and engagement scoring. Timing is estimated."
      };
    });

    return res.status(200).json({
      clips,
      mode: "fallback",
      message: "Clip suggestions generated without AI. Times are estimates."
    });

  } catch (error) {
    return res.status(500).json({
      error: "Fallback analysis failed."
    });
  }
}
