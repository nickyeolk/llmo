from js import Response, fetch
import json

async def on_fetch(request, env):
    """
    Functional Entry Point.
    """
    try:
        url = request.url

        # 1. API Route
        if "/api/rank" in url and request.method == "POST":
            return await handle_ranking(request, env)

        # 2. Static Assets (Fallback)
        return await env.ASSETS.fetch(request)

    except Exception as e:
        # CRITICAL FIX: Return JSON so the frontend can display the error
        return Response.new(json.dumps({"error": f"Critical Error: {str(e)}"}), status=500, headers={
            "Content-Type": "application/json"
        })

async def handle_ranking(request, env):
    try:
        # Parse the incoming JSON body
        # (We use await request.text() + json.loads for maximum safety in the beta environment)
        req_text = await request.text()
        req_json = json.loads(req_text)
        
        company = req_json.get("company", "")
        industry = req_json.get("industry", "")
        
        if not company or not industry:
            return Response.new(json.dumps({"error": "Missing company or industry"}), status=400, headers={"Content-Type": "application/json"})

        # Models to poll
        models = [
            "openai/gpt-4o",
            "anthropic/claude-3.5-sonnet", 
            "meta-llama/llama-3-70b-instruct"
        ]
        
        prompt = f"List the top 10 most popular companies in the {industry} industry. Return ONLY a comma-separated list of names. Do not number them."

        results = {}

        for model in models:
            try:
                # API Call to OpenRouter
                api_url = "https://openrouter.ai/api/v1/chat/completions"
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}]
                }
                
                # Check if API Key exists
                # Note: In functional syntax, env is a JS Object. We access keys with dot notation.
                api_key = env.OPENROUTER_API_KEY
                if not api_key:
                    results[model] = "Error: Missing API Key in Dashboard"
                    continue

                resp = await fetch(api_url, method="POST", headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }, body=json.dumps(payload))
                
                # Parse Response safely
                resp_text = await resp.text()
                data = json.loads(resp_text)
                
                if "error" in data:
                    results[model] = f"API Error: {data['error'].get('message', 'Unknown')}"
                    continue

                content = data['choices'][0]['message']['content']
                
                # Ranking Logic
                rank_list = [x.strip().lower() for x in content.split(",")]
                try:
                    rank = rank_list.index(company.lower()) + 1
                    results[model] = f"#{rank}"
                except ValueError:
                    results[model] = "Not in Top 10"

            except Exception as inner_e:
                results[model] = f"Processing Error: {str(inner_e)}"

        return Response.new(json.dumps(results), headers={
            "Content-Type": "application/json"
        })

    except Exception as e:
        return Response.new(json.dumps({"error": f"Worker Logic Error: {str(e)}"}), status=500, headers={
            "Content-Type": "application/json"
        })