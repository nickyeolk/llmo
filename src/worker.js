export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/api/rank") && request.method === "POST") {
      return handleRanking(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleRanking(request, env) {
  try {
    const { company, industry } = await request.json();

    if (!company || !industry) {
      return new Response(JSON.stringify({ error: "Missing company or industry" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const models = [
      "openai/gpt-5-nano",
      "anthropic/claude-haiku-4.5",
      "meta-llama/llama-4-scout",
      "mistralai/ministral-3b-2512",
      "deepseek/deepseek-v3.2",
      "x-ai/grok-4.1-fast"
    ];

    const prompt = `List the top 5 most popular companies in the ${industry} industry. Return ONLY a comma-separated list of names.`;
    const results = {};

    await Promise.all(models.map(async (model) => {
      try {
        const apiKey = env.OPENROUTER_API_KEY;
        if (!apiKey) {
          results[model] = { rank: "Error", raw: "API Key Missing" };
          return;
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: prompt }]
          })
        });

        if (!response.ok) {
          results[model] = { rank: "Error", raw: `HTTP Status ${response.status}` };
          return;
        }

        const data = await response.json();
        
        if (data.error) {
           results[model] = { rank: "Error", raw: data.error.message };
           return;
        }

        const content = data.choices[0].message.content;
        
        // Split and clean up the list from the LLM
        const rankList = content.split(",").map(x => x.trim());
        
        // --- NEW FUZZY LOGIC HERE ---
        const rankIndex = findRank(rankList, company);
        // ----------------------------
        
        results[model] = {
            rank: rankIndex !== -1 ? `#${rankIndex}` : "Not in Top 5",
            raw: content
        };

      } catch (err) {
        results[model] = { rank: "Error", raw: err.message };
      }
    }));

    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: `Server Error: ${e.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Smart Fuzzy Finder
 * Returns the 1-based rank (e.g., 1, 2, 3) or -1 if not found.
 */
function findRank(list, target) {
  const cleanTarget = target.toLowerCase().trim();

  // Helper to remove common suffixes for better matching
  // e.g. "Heineken International" -> "heineken"
  const stripSuffix = (str) => str.replace(/\b(inc|corp|corporation|ltd|limited|group|international|holdings)\b/g, "").trim();

  for (let i = 0; i < list.length; i++) {
    let item = list[i].toLowerCase().trim();
    
    // 1. Exact Match
    if (item === cleanTarget) return i + 1;
    
    // 2. Substring Match (Solves the "Heineken" vs "Heineken International" issue)
    // We check if the input is inside the result, OR if the result is inside the input.
    if (item.includes(cleanTarget) || cleanTarget.includes(item)) return i + 1;
    
    // 3. Cleaned Match (Stripping "International", "Inc", etc.)
    if (stripSuffix(item) === stripSuffix(cleanTarget)) return i + 1;

    // 4. Simple Typo Tolerance (Levenshtein Distance)
    // Allows for 2 character mistakes (e.g. "Hieneken" -> "Heineken")
    if (levenshtein(item, cleanTarget) <= 2) return i + 1;
  }
  
  return -1;
}

// Simple Edit Distance Algorithm (Levenshtein)
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  // Optimization: If string length difference is big, don't bother calculating
  if (Math.abs(a.length - b.length) > 2) return 100;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1) // insertion/deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}