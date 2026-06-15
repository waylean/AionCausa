# AionCausa

[中文](./README.md) | English

AionCausa is an AI-powered event-world simulator. You enter a “what if” event, and the system first checks whether the input contains enough information to create a coherent world. If the precheck passes, it expands the background, key assumptions, character relationships, and causal pressures, then generates a small world that can be advanced scene by scene.

It is not a simple story continuation tool. It is closer to an event sandbox: different character agents act in the same world with their own goals, fears, interests, memories, and constraints. They test, negotiate, ally, clash, and eventually produce a new order.

## Why This Project Exists

When a TV series ends badly, when history leaves a painful regret, or when a novel does not end the way you wished, there is often an impulse to rewrite it.

But the interesting part is not only changing the ending. The interesting part is watching what happens after the world has been changed.

What if Xiang Yu killed Liu Bang at the Hongmen Banquet?

What if Shang Yang survived after his reforms?

What if a key character in a novel did not die, and everyone else had to choose again?

AionCausa is built for that impulse. You provide the “what if,” and it tries to generate a small world where that possibility can unfold.

## What It Can Do

- Feasibility precheck: judge whether the input is rich enough to create a world.
- Background completion: expand missing background, assumptions, and points of dispute.
- Character agent generation: prefer concrete characters over abstract factions.
- Scene-by-scene simulation: each scene is a relatively stable snapshot after world movement.
- World stage: show actors as dots and world changes as ordered action cards.
- Actor details: inspect an actor’s intent, intent changes, and action history.
- World summary: summarize everything that has happened so far as one coherent narrative.
- Interview history: keep previous questions asked inside the current world.
- Multi-model support: works with OpenAI-compatible Chat Completions and Anthropic-compatible Messages APIs.

## Run From Scratch

### 1. Prepare Your Environment

Install:

- Node.js 22 or newer: [https://nodejs.org](https://nodejs.org)
- Git, if you want to clone the repository. You can also download the GitHub ZIP instead.
- A usable LLM API key, such as OpenAI, Gemini, Kimi, Zhipu GLM, MiniMax, Claude, or any local/cloud gateway compatible with OpenAI Chat Completions.

Check your installation:

```bash
node -v
npm -v
```

If both commands print versions, Node.js and npm are ready.

### 2. Get the Project

Option A: clone with Git.

```bash
git clone https://github.com/waylean/AionCausa.git
cd AionCausa
```

Option B: download ZIP.

1. Open the GitHub repository page.
2. Click `Code`.
3. Click `Download ZIP`.
4. Unzip the archive.
5. Open a terminal inside the project directory.

### 3. Install Dependencies

Run this in the project root:

```bash
npm install
```

The first install may take a while.

### 4. Start the Dev Server

```bash
npm run dev
```

The terminal will print a local URL, usually:

```text
http://127.0.0.1:5173
```

Open that URL in your browser. If port `5173` is already used, Vite will choose another port. Use the URL printed by the terminal.

### 5. Connect an AI Model

AionCausa requires an LLM API to generate worlds. The project does not include any API key, and real keys should never be committed to GitHub.

Open the `Model Configuration` page and fill in:

- Provider: select a preset service or use a custom endpoint.
- Protocol: usually `OpenAI-compatible` or `Anthropic-compatible`.
- Base URL: API endpoint of your model service.
- Model: model name.
- API Key: your model service key.
- Temperature: controls generation randomness.
- Max Tokens: controls the maximum output length.

Common examples:

| Service | Recommended Protocol | Example Base URL | Example Model |
| --- | --- | --- | --- |
| OpenAI / GPT | OpenAI-compatible | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Gemini OpenAI-compatible | OpenAI-compatible | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Kimi / Moonshot | OpenAI-compatible | `https://api.moonshot.ai/v1` | `kimi-k2.6` |
| Zhipu GLM | OpenAI-compatible | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| MiniMax | OpenAI-compatible | `https://api.minimax.io/v1` | `MiniMax-M2.5` |
| Anthropic / Claude | Anthropic-compatible | `https://api.anthropic.com/v1` | `claude-3-5-sonnet-latest` |
| Local compatible gateway | OpenAI-compatible | `http://localhost:11434/v1` | `llama3.1` |

You can also run a minimal provider smoke test with environment variables:

```powershell
$env:AIONCAUSA_PROTOCOL="openai-compatible"
$env:AIONCAUSA_BASE_URL="https://api.openai.com/v1"
$env:AIONCAUSA_MODEL="gpt-4o-mini"
$env:AIONCAUSA_API_KEY="<your-api-key>"
npm run test:provider
```

Passing `test:provider` only means the model connection works. It does not guarantee that every complex world will generate perfectly. For normal use, follow the web flow: `Analyze Feasibility -> Generate World -> Advance Next Scene`.

### 6. Create Your First World

1. Go back to the world creation page.
2. Enter a central event, for example:

```text
What if Shang Yang survived after his reforms? How would Qin develop?
```

3. Click `Analyze Feasibility`.
4. Wait for the model to judge whether the event can create a world.
5. If the precheck passes, click `Generate World`.
6. Enter the world stage.
7. Click `Advance Next Scene` to continue the simulation.
8. Click an actor dot to inspect that actor’s intent and actions.
9. Click `Summarize World` to summarize the full story so far.

Tip: run `Analyze Feasibility` before generating a world. If the input is too vague, the system will reject it instead of producing generic content.

### 7. Check, Test, and Build

Lint:

```bash
npm run lint
```

Run tests:

```bash
npm run test
```

Build for production:

```bash
npm run build
```

The production output is written to `dist/`. To preview it locally:

```bash
npm run preview
```

## Button Guide

### World Creation Page

- `Analyze Feasibility`: sends the central event to the model first and checks whether there is enough information to create a world. Use this before generation.
- `Generate World`: creates the event world after the precheck passes. If the input is insufficient, the system explains why.
- `Recent Worlds`: opens previously generated local worlds.
- `Delete World`: deletes one local archived world.
- `Refresh`: reloads the recent-world list.
- `Model Configuration`: opens the model settings page.

### World Stage Page

- `Advance Next Scene`: continues the world by one scene. A scene is a relatively stable world snapshot, not a fixed turn.
- `Summarize World`: summarizes everything that has happened so far as one coherent narrative.
- `Interview History`: shows questions previously asked in the current world.
- `Actor Dot`: opens actor details, current intent, and action history.
- `Action Card`: shows actions in the current scene in chronological order.
- `Back to Creation`: returns to the creation page.

## Recommended Inputs

Good inputs include a clear point of divergence:

```text
What if Shang Yang survived after his reforms? How would Qin develop?
```

```text
What if Xiang Yu killed Liu Bang at the Hongmen Banquet? What happens next?
```

```text
What if Lin Daiyu entered the Harry Potter world and met Voldemort?
```

Avoid vague inputs:

```text
What if Zhang San did not leave?
```

If the characters, world, and premise cannot be identified, the system should reject world creation or ask for more information.

## Project Structure

```text
src/App.tsx                    Main UI, page switching, interaction state
src/domain/worldRuntime.ts      World runtime, scene advancement, actor action merging
src/domain/types.ts             Core event-world types
src/services/providers.ts       Model provider presets and request construction
src/services/runtime.ts         World advancement service
src/services/summary.ts         World summary service
src/services/interview.ts       Actor interview service
src/services/archives.ts        Local world archive read/write
vite.config.ts                  Vite config and local API middleware
docs/EXAMPLE.md                 Example event and usage flow
```

## License

This project is released under the [MIT License](./LICENSE).
