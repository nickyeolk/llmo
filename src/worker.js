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

    // 2025 Model List
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
        const rankList = content.split(",").map(x => x.trim().toLowerCase());
        
        const index = rankList.indexOf(company.toLowerCase());
        
        // Save BOTH the rank and the raw content
        results[model] = {
            rank: index !== -1 ? `#${index + 1}` : "Not in Top 5",
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