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
    const apiKey = env.OPENROUTER_API_KEY;

    if (!company || !industry) {
      return new Response(JSON.stringify({ error: "Missing company or industry" }), { status: 400 });
    }
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API Key Missing on Server" }), { status: 500 });
    }

    // =========================================
    // PHASE 1: Get Industry Dimensions
    // =========================================
    let dimensions = [];
    try {
      const dimResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "meta-llama/llama-3.2-3b-instruct",
            messages: [
              { role: "system", content: "You are a helpful assistant. Return only a comma-separated list." },
              { role: "user", content: `List exactly 5 key marketing dimensions critical for brand success in the ${industry} industry. Return ONLY a comma-separated list of 5 short phrases.` }
            ]
          })
      });

      if (!dimResponse.ok) throw new Error(`Failed to fetch dimensions: ${dimResponse.status}`);
      const dimData = await dimResponse.json();
      dimensions = dimData.choices[0].message.content.split(",").map(d => d.trim()).slice(0, 5);
      if (dimensions.length === 0) throw new Error("Could not generate dimensions");

    } catch (e) {
       return new Response(JSON.stringify({ error: `Dimension Phase Error: ${e.message}` }), { status: 500 });
    }

    // =========================================
    // PHASE 2: The Matrix Query
    // =========================================
    const models = [
      "openai/gpt-5-nano",
      "anthropic/claude-haiku-4.5",
      "meta-llama/llama-4-scout",
      "mistralai/ministral-3b-2512",
      "deepseek/deepseek-v3.2",
      "x-ai/grok-4.1-fast"
    ];

    const finalOutput = {
        dimensions: dimensions,
        modelResults: {},
        summary: "" // Placeholder for Phase 3
    };

    // To help Phase 3, we will collect a text transcript of all results
    let analysisTranscript = `Analysis for company "${company}" in industry "${industry}".\n\nData collected:\n`;

    await Promise.all(models.map(async (model) => {
      finalOutput.modelResults[model] = {};
      
      await Promise.all(dimensions.map(async (dimension) => {
        try {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: model,
              messages: [
                { role: "system", content: "You are an expert industry analyst. Return only a comma-separated list." },
                { role: "user", content: `List the top 5 leading brands in the ${industry} industry specifically regarding '${dimension}'. Return ONLY a comma-separated list.` }
              ]
            })
          });

          if (!response.ok) {
             finalOutput.modelResults[model][dimension] = { rank: "Error", raw: `HTTP ${response.status}` };
             return;
          }

          const data = await response.json();
          if (data.error) {
             finalOutput.modelResults[model][dimension] = { rank: "Error", raw: data.error.message };
             return;
          }

          const content = data.choices[0].message.content;
          const rankList = content.split(",").map(x => x.trim());
          const rankIndex = findRank(rankList, company);
          const rankStr = rankIndex !== -1 ? `#${rankIndex}` : "Not in Top 5";

          // Save Data
          finalOutput.modelResults[model][dimension] = {
              rank: rankStr,
              raw: content
          };

          // Append to transcript for Phase 3
          // We include the full list so Grok can see competitors
          analysisTranscript += `Model: ${model} | Dimension: ${dimension} | ${company} Rank: ${rankStr} | Full List: [${content}]\n`;

        } catch (err) {
          finalOutput.modelResults[model][dimension] = { rank: "Error", raw: err.message };
        }
      }));
    }));

    // =========================================
    // PHASE 3: AI Consensus Summary (New!)
    // =========================================
    try {
        const summaryResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "x-ai/grok-4.1-fast", // Using the smart model requested
                messages: [
                    { 
                        role: "system", 
                        content: "You are a Senior Market Analyst. You will receive raw ranking data for a target company. Your job is to write a concise, professional paragraph (approx 80-100 words) summarizing the consensus. 1) Mention the company's strongest and weakest dimensions. 2) Identify the 2-3 main competitors that appear most frequently in the lists. 3) Give a final verdict on their market position." 
                    },
                    { 
                        role: "user", 
                        content: analysisTranscript 
                    }
                ]
            })
        });

        if (summaryResponse.ok) {
            const summaryData = await summaryResponse.json();
            finalOutput.summary = summaryData.choices[0].message.content;
        } else {
            finalOutput.summary = "Unable to generate summary due to API error.";
        }

    } catch (e) {
        finalOutput.summary = `Summary generation failed: ${e.message}`;
    }

    return new Response(JSON.stringify(finalOutput), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: `Server Error: ${e.message}` }), { status: 500 });
  }
}

// Helper Functions
function findRank(list, target) {
  if (!target) return -1;
  const cleanTarget = target.toLowerCase().trim();
  const stripSuffix = (str) => str.replace(/\b(inc|corp|corporation|ltd|limited|group|international|holdings|brand|the)\b/g, "").trim();

  for (let i = 0; i < list.length; i++) {
    let item = list[i].toLowerCase().trim();
    if (item === cleanTarget) return i + 1;
    if (item.includes(cleanTarget) || cleanTarget.includes(item)) return i + 1;
    if (stripSuffix(item) === stripSuffix(cleanTarget) && stripSuffix(item).length > 2) return i + 1;
    if (item.length > 3 && cleanTarget.length > 3 && levenshtein(item, cleanTarget) <= 2) return i + 1;
  }
  return -1;
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 100;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
}