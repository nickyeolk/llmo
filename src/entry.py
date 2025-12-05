from js import Response
from pyodide.http import pyfetch
import json

async def on_fetch(request, env):
    try:
        url = request.url

        # 1. API Route
        if "/api/rank" in url and request.method == "POST":
            return await handle_ranking(request, env)

        # 2. Static Assets (Fallback)
        return await env.ASSETS.fetch(request)

    except Exception as e:
        return Response.new(json.dumps({"error": f"Critical Error: {str(e)}"}), status=500, headers={
            "Content-Type": "application/json"
        })

async def handle_ranking(request, env):
    try:
        # Parse Request
        try:
            req_text = await request.text()
            req_json = json.loads(req_text)
        except:
            return Response.new(json.dumps({"error": "Invalid JSON body"}), status=400)
        
        company = req_json.get("company", "")
        industry = req_json.get("industry", "")
        
        if not company or not industry:
            return Response.new(json.dumps({"error": "Missing company or industry"}), status=400)

        models = [
            "openai/gpt-4o",
            "anthropic/claude-3.5-sonnet", 
            "meta-llama/llama-3-70b-instruct"
        ]
        
        prompt = f"List the top 5 most popular companies in the {industry} industry. Return ONLY a comma-separated list."

        results = {}

        for model in models:
            try:
                api_url = "https://openrouter.ai/api/v1/chat/completions"
                api_key = env.OPENROUTER_API_KEY
                
                if not api_key:
                    results[model] = "Error: Key Missing"
                    continue

                # --- THE FIX: Use pyfetch ---
                # pyfetch handles the 'headers' dict and 'body' conversion automatically.
                # It behaves like a standard Python async library.
                resp = await pyfetch(
                    api_url,
                    method="POST",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    },
                    body=json.dumps({
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}]
                    })
                )
                # ----------------------------

                if resp.status != 200:
                    results[model] = f"API Error {resp.status}"
                    continue

                # pyfetch returns a response object with an async .json() method
                data = await resp.json()
                
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
                    results[model] = "Not in Top 5"

            except Exception as inner_e:
                results[model] = f"Processing Error: {str(inner_e)}"

        return Response.new(json.dumps(results), headers={
            "Content-Type": "application/json"
        })

    except Exception as e:
        return Response.new(json.dumps({"error": f"Worker Logic Error: {str(e)}"}), status=500, headers={
            "Content-Type": "application/json"
        })