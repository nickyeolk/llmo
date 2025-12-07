# 🏆 LLMO Ranker

**LLMO Ranker** is a competitive intelligence tool designed for the age of AI. As traditional SEO gives way to **LLMO (Large Language Model Optimization)**, understanding how AI models perceive and rank your brand is critical.

This tool "pokes a wire" into the brains of 6 top frontier models simultaneously to tease out their implicit rankings, biases, and brand associations.

 *(Replace with your actual screenshot)*

## 🚀 Features

  * **Multi-Model Analysis:** Queries GPT-5, Claude, Llama 4, Mistral, DeepSeek, and Grok in parallel.
  * **Dynamic Dimension Discovery:** Automatically uses a smaller model to identify the top 5 marketing dimensions for any specific industry (e.g., "Sustainability," "Price," "Innovation").
  * **Real-Time Streaming:** Results stream in cell-by-cell using Server-Sent Events (SSE) for instant feedback—no waiting 15s for a loading spinner.
  * **Smart Entity Resolution:** Uses a hybrid algorithm (Fuzzy Matching + GPT-4o-mini fallback) to correctly identify brands even if models use synonyms or sub-brand names (e.g., "Hill's" vs "Hill's Science Diet").
  * **AI Consensus Report:** Synthesizes a strategic executive summary using `x-ai/grok-4.1-fast`.

## 🛠️ Architecture & Design Choices

We made several specific architectural decisions to ensure speed, stability, and low cost:

1.  **Cloudflare Workers (Native JS):**
      * *Why:* We initially attempted this in Python, but the beta runtime struggled with the complex async networking required (`pyodide` crashes). We switched to Native JavaScript (ES Modules) which is rock-solid on Cloudflare, allows for 0ms cold starts, and handles massive parallelism effortlessly.
2.  **Server-Sent Events (SSE):**
      * *Why:* The app makes \~32 concurrent AI calls per user request. Waiting for all of them to finish would freeze the UI for 15+ seconds. We implemented SSE to push results to the frontend the millisecond they arrive.
3.  **Circuit Breaker & Request Budgeting:**
      * *Why:* Cloudflare Workers have a hard limit of 50 subrequests per execution. Our "Entity Resolution" fallback could breach this if many brands matched fuzzily. We implemented a "Budget Tracker" that disables secondary checks if we approach the limit, preventing crashes.
4.  **Multi-Model Matrix:**
      * *Why:* Relying on one model introduces bias. We query 6 different models to get a true consensus.
5.  **Hybrid Entity Resolution:**
      * *Why:* Simple string matching fails on complex brand names. We use a fast algorithm first, then fall back to a cheap, smart LLM (`gpt-4o-mini`) to resolve ambiguities only when necessary.

## 📋 Prerequisites

1.  **Cloudflare Account:** For hosting the worker and site (Free tier works great).
2.  **OpenRouter Account:** To access the LLM APIs via a single unified gateway.
3.  **Node.js & npm:** Installed locally to run the deployment tools.

-----

## ⚙️ Setup Guide

### 1\. Clone & Install

```bash
git clone https://github.com/your-username/llmo-ranker.git
cd llmo-ranker
npm install
```

### 2\. OpenRouter Configuration

1.  Go to [OpenRouter.ai](https://openrouter.ai).
2.  Create an account and add credits (start with $5 - it goes a long way).
3.  Go to **Keys** and create a new API Key.
4.  **Copy this key** immediately.

### 3\. Cloudflare Configuration

1.  Install the Cloudflare CLI (Wrangler):
    ```bash
    npm install -g wrangler
    ```
2.  Login to your account:
    ```bash
    wrangler login
    ```
    *(This will open a browser window to authorize your terminal)*.

### 4\. Local Development

To run the app on your machine, you need to set your API key locally.

1.  Create a file named `.dev.vars` in the root folder.
2.  Add your key inside:
    ```text
    OPENROUTER_API_KEY="sk-or-v1-your-actual-key-here"
    ```
3.  Start the server:
    ```bash
    npx wrangler dev
    ```
4.  Open `http://localhost:8787` in your browser.

-----

## 🚀 Deployment

### 1\. Configure Production Secrets

Cloudflare Workers do not read `.dev.vars` in production. You must set the secret on the remote worker.

**Option A (CLI - Recommended):**

```bash
npx wrangler secret put OPENROUTER_API_KEY
# Paste your key when prompted
```

**Option B (Dashboard):**

1.  Log in to [Cloudflare Dashboard](https://dash.cloudflare.com).
2.  Go to **Workers & Pages** -\> **llmo-ranker**.
3.  Go to **Settings** -\> **Variables and Secrets**.
4.  Click **Add** -\> Secret -\> Name: `OPENROUTER_API_KEY` -\> Paste Value.

### 2\. Deploy

Push your code to the global edge:

```bash
npx wrangler deploy
```

Your app is now live globally\! 🌍

-----

## 📂 Project Structure

  * `src/worker.js`: The backend logic. Handles the API stream, dimensions discovery, matrix querying, and consensus generation.
  * `public/index.html`: The frontend. A single-file app that handles the inputs, SSE stream parsing, Markdown rendering, and dynamic grid updates.
  * `wrangler.toml`: Cloudflare configuration file. Points the worker to the static assets in `public/`.

## 📜 License

MIT