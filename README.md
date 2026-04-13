# GeoMCP

MCP server for reading geometry problems and drawing accurate SVG diagrams.

## Features

- Accepts geometry problems as plain text (Vietnamese or English)
- Parses geometric objects:
  - Points (A, B, C ...)
  - Segments with given length (AB = 3)
  - Triangles (triangle ABC)
  - Right-angle condition at a vertex (right angle at A)
  - Isosceles triangles, equilateral triangles
  - Right triangles (e.g. `right triangle ABC at A`)
  - Midpoints (M is the midpoint of AB)
  - Points on a segment (D lies on BC)
  - Parallel lines (AB parallel to CD)
  - Perpendicular lines (AB perpendicular to CD)
  - Altitudes, medians, angle bisectors
  - Tangent at a point of a circle
  - Inscribed and circumscribed circles of a triangle
  - Circle by diameter (circle with diameter AB)
  - Basic quadrilaterals (rectangle, square, parallelogram, trapezoid)
  - Circle given center and radius
- Computes coordinates and renders an SVG diagram
- Returns `diagnostics` reporting constraints that lack sufficient data

## System Architecture

GeoMCP is **not** a pure AI agent. It is a **geometry processing pipeline** that combines NLP/LLM (structured extraction) with a deterministic geometry engine (coordinate placement + constraint solving + SVG rendering). AI is only involved in the first step — converting natural language into structured JSON — the rest is deterministic algorithms.

The system runs in **two parallel modes**:

| Mode | Entry point | Transport | Audience |
|---|---|---|---|
| **MCP tool server** | `src/index.ts` | stdio (MCP protocol) | AI assistants (Claude, Cursor, Zed, …) |
| **Web application** | `src/webapp.ts` | HTTP REST + static files | Human users via browser |

### Components

```
┌──────────────────────────────────────────────────────────────┐
│  src/nlp/               NLP / Parsing layer                  │
│    parser.ts            Bilingual heuristic parser (regex)   │
│    llmParser.ts         LLM → GeometryModel (flat JSON)      │
│    dslParser.ts         LLM → GeometryDsl (richer IR)        │
│    dsl.ts               DSL types + dslToGeometryModel()     │
├──────────────────────────────────────────────────────────────┤
│  src/model/             Data model                           │
│    types.ts             All TypeScript interfaces            │
│    v2Model.ts           enrichModelForV2() – infer implied   │
│                         constraints (altitudes, medians, …)  │
├──────────────────────────────────────────────────────────────┤
│  src/geometry/          Deterministic geometry engine        │
│    layout.ts            buildLayout() – initial coordinates  │
│    solver.ts            refineLayoutWithSolver() – relaxation│
│    svg.ts               renderSvg() – produce SVG            │
├──────────────────────────────────────────────────────────────┤
│  src/index.ts           MCP server (stdio)                   │
│  src/webapp.ts          HTTP server (REST API + sessions)    │
├──────────────────────────────────────────────────────────────┤
│  web/                   Browser frontend                     │
│    index.html           Chat UI (calls /api/solve/stream)    │
│    config.js            Backend URL config                   │
└──────────────────────────────────────────────────────────────┘
```

### Data flow

```
Text input (or image)
  │
  ├─ [If image] → LLM vision (extractTextFromImage) → problem text
  │
  ├─ Heuristic parser (regex) [fast, no LLM]
  │    or
  │  LLM → JSON GeometryModel / GeometryDsl [more accurate]
  │    (fallback to heuristic on error)
  │
  ├─ enrichModelForV2()   – infer implied constraints
  │
  ├─ buildLayout()        – place initial heuristic coordinates
  │
  ├─ refineLayoutWithSolver()  – iterative constraint relaxation
  │
  └─ renderSvg()          – output SVG string
```

In the browser frontend (`web/index.html`), after receiving the SVG, users can drag points interactively. The client-side constraint solver (`applyCircleConstraints`) uses a **directed dependency graph (DAG)** and **Kahn's topological sort** to update dependent points in the correct order (F0 → F1 → F2 → …) without iteration.

### LLM usage

| Location | Purpose | Default model |
|---|---|---|
| `webapp.ts` `extractTextFromImage()` | Extract problem text from image | `gpt-4.1-mini` (vision) |
| `llmParser.ts` | Text → GeometryModel JSON | `gpt-4.1-mini` |
| `dslParser.ts` | Text → GeometryDsl JSON | `gpt-4.1-mini` |

All use the OpenAI-compatible API and can be switched to Ollama (local) or OpenRouter. The LLM is **not** involved in geometry solving or proof — only in structured extraction from natural language.

## Installation

```bash
npm install
```

## Development

```bash
npm run build   # compile TypeScript → dist/
npm test        # run all tests
```

### Development Scripts

Scripts follow the pattern `{surface}:{local?}:{debug?}`:

| Script | Surface | Backend | Inspector | Command |
|---|---|---|---|---|
| `npm run web` | webapp | OpenAI | ❌ | `tsx src/webapp.ts` |
| `npm run web:debug` | webapp | OpenAI | ✅ | webapp + `--inspect` |
| `npm run web:local` | webapp | Ollama local | ❌ | webapp + `geomcp-qwen` via `localhost:11434` |
| `npm run web:local:debug` | webapp | Ollama local | ✅ | webapp + Ollama + `--inspect` |
| `npm run mcp` | MCP server | OpenAI | ❌ | `tsx src/index.ts` |
| `npm run mcp:debug` | MCP server | OpenAI | ✅ | MCP server + `--inspect` |
| `npm run mcp:local` | MCP server | Ollama local | ❌ | MCP server + `geomcp-qwen` via `localhost:11434` |

**When to use which:**
- **Day-to-day development** → `npm run web:local` (no API key needed, no inspector overhead)
- **Debugging with breakpoints** → `npm run web:local:debug` (attach VS Code or Chrome DevTools to `localhost:9229`)
- **Testing against OpenAI** → `npm run web:debug`
- **MCP tool testing** (Claude / Cursor / …) → `npm run mcp` or `npm run mcp:local`

The `web:local` and `web:local:debug` scripts automatically kill any existing webapp process before starting, so you can re-run without port conflicts.

## Build and run

```bash
npm run build
npm start
```

## Interactive demo

A drag-and-drop HTML demo is available for a sample problem:

```bash
open interactive-demo.html
```

In this demo you can drag point `E` along the circle and dependent points like `A`, `B`, `H` update automatically according to the problem constraints.

## Chat UI (text / image → draw)

A chat-style web UI is included:

- Type a geometry problem as text
- Upload an image for OCR → text
- Uses LLM parsing + constraint solver to draw the SVG
- Streams real-time progress (OCR → parse → solve → render)
- Persists conversation history per session across page refreshes

Run the UI locally:

```bash
npm run web
```

Open the browser at:

```text
http://localhost:4310
```

Or run from the build:

```bash
npm run build
npm run start:web
```

Required environment variables for OCR / LLM parsing:

```bash
export GEOMCP_OPENAI_API_KEY="<your_api_key>"
export GEOMCP_OPENAI_MODEL="gpt-4.1-mini"
# optional
export GEOMCP_OPENAI_BASE_URL="https://api.openai.com/v1"
```

### Using a local LLM (Ollama, no online API needed)

To parse with a local model:

1. Make sure Ollama is running:

```bash
ollama serve
```

2. Pull a local model (example):

```bash
ollama pull qwen2.5:7b
```

3. Configure GeoMCP to use the local OpenAI-compatible endpoint:

```bash
export GEOMCP_OPENAI_BASE_URL="http://localhost:11434/v1"
export GEOMCP_OPENAI_MODEL="qwen2.5:7b"
unset GEOMCP_OPENAI_API_KEY
unset OPENAI_API_KEY
```

With this setup the `read_and_draw_geometry_v2_llm` tool will parse using the local LLM via Ollama.

### Running online 24/7 (serverless deployment)

Split into two parts:

1. Static frontend on GitHub Pages
2. Backend API on a cloud host (Render / Fly / Cloud Run)

#### A. Deploy the backend on Render

- Create a `Web Service` from this repo
- Build command:

```bash
npm install && npm run build
```

- Start command:

```bash
npm run start:web
```

- Set environment variables:
  - `GEOMCP_OPENAI_API_KEY`
  - `GEOMCP_OPENAI_MODEL` (e.g. `gpt-4.1-mini` or a free model)
  - `GEOMCP_OPENAI_BASE_URL` (e.g. OpenRouter: `https://openrouter.ai/api/v1`)
  - `GEOMCP_ALLOWED_ORIGINS` (e.g. `https://hvquan.github.io`)

After deployment you will have a backend URL such as:

```text
https://geomcp-api.onrender.com
```

#### B. Configure the frontend for GitHub Pages

Edit `web/config.js`:

```js
window.GEOMCP_API_BASE = "https://geomcp-api.onrender.com";
```

Commit and push to `main`; GitHub Pages will update automatically.

Users can then open:

```text
https://hvquan.github.io/GeoMCP/
```

The frontend calls the cloud API and does not depend on your local machine.

## Publish to GitHub

1. Create a new repository on GitHub (set to Public).
2. Inside the project directory, run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

3. Enable GitHub Pages:
  - Go to `Settings` → `Pages`
  - `Source`: select `Deploy from a branch`
  - `Branch`: select `main` and folder `/ (root)`

4. The public URL will be:

```text
https://<username>.github.io/<repo>/
```

This page automatically opens `interactive-demo.html` via `index.html`.

## MCP client configuration

Example MCP client configuration pointing at the start command:

```json
{
  "mcpServers": {
    "geomcp": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/GeoMCP/dist/index.js"]
    }
  }
}
```

## Available tools

- `read_and_draw_geometry`
  - Input:
    - `problem` (string): geometry problem text
  - Output:
    - JSON with `parsed`, `layout`, `svg`

- `read_and_draw_geometry_v2_llm`
  - Input:
    - `problem` (string): geometry problem text
    - `llmModel` (string, optional): LLM model name
    - `fallbackToHeuristic` (boolean, optional, default `true`)
    - `useConstraintSolver` (boolean, optional, default `true`)
    - `solverIterations` (number, optional, default `160`)
  - Output:
    - JSON with `parserVersion`, `solver`, `warnings`, `parsed`, `layout`, `svg`

## Version 2 (LLM parser)

The original parser is still available via `read_and_draw_geometry`.
Version 2 uses an LLM via `read_and_draw_geometry_v2_llm`.

Version 2 adds full support for three approaches:

1. LLM-based JSON schema extraction
2. Geometry constraint solver (iterative relaxation)
3. Automatic inference of additional relationships: altitudes, medians, tangents, perpendiculars, points on lines, points on circles

Set environment variables before starting the server:

```bash
export GEOMCP_OPENAI_API_KEY="<your_api_key>"
export GEOMCP_OPENAI_MODEL="gpt-4.1-mini"
# optional
export GEOMCP_OPENAI_BASE_URL="https://api.openai.com/v1"
```

## Example problem

```text
Triangle ABC, AB = 5, AC = 6, BC = 7.
Draw the altitude from A to BC at H.
Draw the median from B to M.
Draw the angle bisector of angle BAC, intersecting BC at E.
AB parallel to DE.
AH perpendicular to BC.
Draw the inscribed circle and the circumscribed circle of triangle ABC.
```

## Sentence patterns the parser handles well

- Parallel: `AB parallel to CD`
- Perpendicular: `AB perpendicular to CD`
- Altitude: `altitude from A to BC at H`
- Median: `median from B to M` (M will be the midpoint of the opposite side if the triangle is known)
- Angle bisector: `angle bisector of angle BAC intersects BC at E`
- Tangent: `tangent at P to circle with center O`
- Inscribed circle: `inscribed circle of triangle ABC`
- Circumscribed circle: `circumscribed circle of triangle ABC`
- Right triangle: `right triangle ABC at A`
- Diameter: `circle with diameter AB`
- Rectangle: `rectangle ABCD`
- Square: `square ABCD`
- Parallelogram: `parallelogram ABCD`
- Trapezoid: `trapezoid ABCD`

The tool returns an SVG string that you can save as a `.svg` file and view in any browser.

## Notes

This MVP uses a heuristic parser and a basic geometry solver. For higher accuracy on complex problems, next steps would be:

1. Use an LLM to extract structure (JSON schema)
2. Add a full geometry constraint solver
3. Automatically handle additional relationships: parallels, bisectors, tangents, altitudes …
