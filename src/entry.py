from js import Response, fetch, JSON
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
        # Return JSON error to prevent frontend crash
        return Response.new(json.dumps({"error": f"Critical Error: {str(e)}"}), status=500, headers={
            "Content-Type": "application/json"
        })

async def handle_ranking(request, env):
    try:
        # Robust Request Parsing
        try:
            req_text = await request.text()
            req_json = json.loads(req_text)
        except:
            return Response.new(json.dumps({"error": "Invalid JSON body"}), status=400)
        
        company = req_json.get("company", "")
        industry = req_json.get("industry", "")
        
        if not company or not industry:
            return Response.new(json.dumps({"error": "Missing company or industry"}), status=400)

        # Models to check
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

                # --- THE ROBUST FIX ---
                # 1. Create Python Dict
                py_options = {
                    "method": "POST",
                    "headers": {
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    },
                    "body": json.dumps({
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}]
                    })
                }
                
                # 2. Convert to JS Object using the "JSON Hack"
                # This bypasses the need for pyodide.ffi imports
                js_options = JSON.parse(json.dumps(py_options))
                
                # 3. Fetch
                resp = await fetch(api_url, js_options)
                # ----------------------

                if resp.status != 200:
                    results[model] = f"API Error {resp.status}"
                    continue

                resp_text = await resp.text()
                data = json.loads(resp_text)
                
                if "error" in data:
                    results[model] = f"API Error: {data['error'].get('message', 'Unknown')}"
                    continue

                content = data['choices'][0]['message']['content']
                
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