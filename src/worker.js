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

    if (!company || !industry) return new Response(JSON.stringify({ error: "Missing inputs" }), { status: 400 });
    if (!apiKey) return new Response(JSON.stringify({ error: "API Key Missing" }), { status: 500 });

    const budget = { count: 0, limit: 45 };

    // PHASE 1: Get Dimensions
    budget.count++; 
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
      if (!dimResponse.ok) throw new Error("Dimension fetch failed");
      const dimData = await dimResponse.json();
      dimensions = dimData.choices[0].message.content.split(",").map(d => d.trim()).slice(0, 5);
    } catch (e) {
       return new Response(JSON.stringify({ error: `Phase 1 Error: ${e.message}` }), { status: 500 });
    }

    // PHASE 2: The Matrix Query
    const models = [
      "openai/gpt-5-nano",
      "anthropic/claude-haiku-4.5",
      "meta-llama/llama-4-scout",
      "mistralai/ministral-3b-2512",
      "deepseek/deepseek-v3.2",
      "x-ai/grok-4.1-fast"
    ];

    const finalOutput = { dimensions, modelResults: {}, summary: "" };
    let analysisTranscript = `Analysis for "${company}" in "${industry}".\n\nData:\n`;

    await Promise.all(models.map(async (model) => {
      finalOutput.modelResults[model] = {};
      
      await Promise.all(dimensions.map(async (dimension) => {
        budget.count++; 
        try {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: model,
              messages: [
                { role: "system", content: "Expert analyst. Return comma-separated list." },
                { role: "user", content: `List top 5 brands in ${industry} for '${dimension}'. Return ONLY comma-separated list.` }
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
          
          let rankIndex = findRank(rankList, company);

          if (rankIndex === -1) {
             if (budget.count < budget.limit) {
                 budget.count++; 
                 const aiMatchIndex = await resolveEntityWithAI(apiKey, rankList, company);
                 if (aiMatchIndex !== -1) rankIndex = aiMatchIndex;
             }
          }

          const rankStr = rankIndex !== -1 ? `#${rankIndex}` : "Not in Top 5";

          finalOutput.modelResults[model][dimension] = { rank: rankStr, raw: content };
          analysisTranscript += `Model: ${model} | Dim: ${dimension} | Rank: ${rankStr} | List: [${content}]\n`;

        } catch (err) {
          finalOutput.modelResults[model][dimension] = { rank: "Error", raw: err.message };
        }
      }));
    }));

    // PHASE 3: AI Consensus Summary (UPDATED PROMPT)
    try {
        budget.count++; 
        const summaryResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "x-ai/grok-4.1-fast",
                messages: [
                    { 
                        role: "system", 
                        // REVISED PROMPT BELOW:
                        content: "You are a Senior Market Analyst. Write a professional, concise executive summary paragraph based on the provided data. Do not mention word counts or metadata. 1) Highlight the company's strongest and weakest dimensions. 2) Identify the most frequent competitors. 3) Provide a final strategic verdict on their market position." 
                    },
                    { role: "user", content: analysisTranscript }
                ]
            })
        });

        if (summaryResponse.ok) {
            const summaryData = await summaryResponse.json();
            finalOutput.summary = summaryData.choices[0].message.content;
        } else {
            finalOutput.summary = "Summary unavailable (API Error).";
        }
    } catch (e) {
        finalOutput.summary = "Summary unavailable.";
    }

    return new Response(JSON.stringify(finalOutput), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Server Error: ${e.message}` }), { status: 500 });
  }
}

async function resolveEntityWithAI(apiKey, list, target) {
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini",
                messages: [
                    { role: "system", content: "Return the 1-based index if Target is in List (even if spelled differently). Return 0 if not found/competitor. Return ONLY digit." },
                    { role: "user", content: `List: ${JSON.stringify(list)}\nTarget: "${target}"` }
                ]
            })
        });
        if (!response.ok) return -1;
        const data = await response.json();
        const content = data.choices[0].message.content.trim();
        if (content === "0") return -1;
        const match = content.match(/(\d+)/);
        if (match) {
            const index = parseInt(match[1]);
            if (index >= 1 && index <= list.length) return index;
        }
        return -1;
    } catch (e) { return -1; }
}

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