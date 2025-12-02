# from js import Response, fetch, JSON
from js import fetch, JSON, Headers
# from workers import WorkerEntrypoint
from workers import WorkerEntrypoint, Response
import json

class Default(WorkerEntrypoint):
    async def fetch(self, request):
        url = request.url
        
        # 1. API Route: Handle the ranking logic
        if url.endswith("/api/rank") and request.method == "POST":
            return await self.handle_ranking(request)

        # 2. Static Assets: Serve index.html for everything else
        # This calls the 'binding = "ASSETS"' defined in wrangler.toml
        return await self.env.ASSETS.fetch(request)

    async def handle_ranking(self, request):
        try:
            req_json = await request.json()
            company = req_json.get("company", "")
            industry = req_json.get("industry", "")
            
            if not company or not industry:
                return Response.new("Missing company or industry", status=400)

            # We'll check these models
            models = [
                "openai/gpt-4o",
                "anthropic/claude-3-sonnet",
                "meta-llama/llama-3-70b-instruct"
            ]
            
            prompt = f"List the top 10 most popular companies in the {industry} industry. Return ONLY a comma-separated list of names."

            results = {}

            # In a real app, you might want to use asyncio.gather to run these in parallel
            for model in models:
                api_url = "https://openrouter.ai/api/v1/chat/completions"
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}]
                }
                
                # Fetch from OpenRouter
                resp = await fetch(api_url, method="POST", headers={
                    "Authorization": f"Bearer {self.env.OPENROUTER_API_KEY}",
                    "Content-Type": "application/json"
                }, body=json.dumps(payload))
                
                data = await resp.json()
                content = data['choices'][0]['message']['content']
                
                # Simple ranking logic
                rank_list = [x.strip().lower() for x in content.split(",")]
                try:
                    rank = rank_list.index(company.lower()) + 1
                    results[model] = f"#{rank}"
                except ValueError:
                    results[model] = "Not in Top 10"

            return Response.new(json.dumps(results), headers={
                "Content-Type": "application/json"
            })

        except Exception as e:
            return Response.new(f"Error: {str(e)}", status=500)