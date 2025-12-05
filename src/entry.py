from js import Response, fetch, JSON
import json

async def on_fetch(request, env):
    """
    Standard Python Worker Entry Point (Functional Style)
    """
    try:
        url = request.url

        # 1. API Route: Handle the ranking logic
        # Check if the URL path ends with /api/rank
        if "/api/rank" in url and request.method == "POST":
            return await handle_ranking(request, env)

        # 2. Static Assets (Fallback)
        # Pass the request to the Asset Server (your HTML files)
        return await env.ASSETS.fetch(request)

    except Exception as e:
        return Response.new(f"Critical Error: {str(e)}", status=500)

async def handle_ranking(request, env):
    try:
        req_json = await request.json()
        company = req_json.get("company", "")
        industry = req_json.get("industry", "")
        
        if not company or not industry:
            return Response.new("Missing company or industry", status=400)

        # Define models to check
        models = [
            "openai/gpt-4o",
            "anthropic/claude-3-sonnet",
            "meta-llama/llama-3-70b-instruct"
        ]
        
        prompt = f"List the top 10 most popular companies in the {industry} industry. Return ONLY a comma-separated list of names."

        results = {}

        # Loop through models
        for model in models:
            api_url = "https://openrouter.ai/api/v1/chat/completions"
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}]
            }
            
            # Note: In functional style, we access secrets via 'env.SECRET_NAME'
            api_key = env.OPENROUTER_API_KEY
            
            resp = await fetch(api_url, method="POST", headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }, body=json.dumps(payload))
            
            data = await resp.json()
            
            # Safety check if OpenRouter returns an error
            if hasattr(data, 'error'):
                 results[model] = "API Error"
                 continue

            try:
                content = data['choices'][0]['message']['content']
                rank_list = [x.strip().lower() for x in content.split(",")]
                
                # Find rank
                rank = rank_list.index(company.lower()) + 1
                results[model] = f"#{rank}"
            except Exception:
                # If company not found or format is weird
                results[model] = "Not in Top 10"

        return Response.new(json.dumps(results), headers={
            "Content-Type": "application/json"
        })

    except Exception as e:
        return Response.new(f"Worker Logic Error: {str(e)}", status=500)