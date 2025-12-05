export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. API Route
    if (url.pathname.endsWith("/api/rank") && request.method === "POST") {
      return handleRanking(request, env);
    }

    // 2. Static Assets (Fallback)
    // This serves your HTML from the public folder
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
      "openai/gpt-4o",
      "anthropic/claude-3.5-sonnet",
      "meta-llama/llama-3-70b-instruct"
    ];

    const prompt = `List the top 5 most popular companies in the ${industry} industry. Return ONLY a comma-separated list of names.`;
    const results = {};

    // Loop through models
    // We use Promise.all to run them in PARALLEL (much faster than Python loop)
    await Promise.all(models.map(async (model) => {
      try {
        const apiKey = env.OPENROUTER_API_KEY;
        if (!apiKey) {
          results[model] = "Error: Key Missing";
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
          results[model] = `API Error ${response.status}`;
          return;
        }

        const data = await response.json();
        
        if (data.error) {
           results[model] = `API Error: ${data.error.message}`;
           return;
        }

        const content = data.choices[0].message.content;
        const rankList = content.split(",").map(x => x.trim().toLowerCase());
        
        // Find Rank
        const index = rankList.indexOf(company.toLowerCase());
        results[model] = index !== -1 ? `#${index + 1}` : "Not in Top 5";

      } catch (err) {
        results[model] = `Error: ${err.message}`;
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