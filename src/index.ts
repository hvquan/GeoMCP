import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { parseGeometryProblem } from "./parser.js";
import { parseGeometryProblemWithLLM } from "./llmParser.js";
import { buildLayout } from "./layout.js";
import { enrichModelForV2 } from "./v2Model.js";
import { refineLayoutWithSolver } from "./solver.js";
import { renderSvg } from "./svg.js";

const TOOL_NAME = "read_and_draw_geometry";
const TOOL_NAME_V2 = "read_and_draw_geometry_v2_llm";

const inputSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    problem: {
      type: "string",
      description: "De bai hinh hoc bang van ban"
    }
  },
  required: ["problem"]
};

const tool: Tool = {
  name: TOOL_NAME,
  description:
    "Doc de hinh hoc, trich xuat doi tuong hinh hoc, tinh toa do va tra ve SVG",
  inputSchema
};

const inputSchemaV2: Tool["inputSchema"] = {
  type: "object",
  properties: {
    problem: {
      type: "string",
      description: "De bai hinh hoc bang van ban"
    },
    llmModel: {
      type: "string",
      description: "Tuy chon model LLM (neu bo qua se dung bien moi truong hoac mac dinh)"
    },
    fallbackToHeuristic: {
      type: "boolean",
      description: "Neu LLM loi thi fallback ve parser cu"
    },
    useConstraintSolver: {
      type: "boolean",
      description: "Bat bo giai rang buoc tong quat cho version 2"
    },
    solverIterations: {
      type: "number",
      description: "So vong lap cho constraint solver"
    }
  },
  required: ["problem"]
};

const toolV2: Tool = {
  name: TOOL_NAME_V2,
  description:
    "Version 2: dung LLM de parse de hinh hoc, sau do tinh toa do va tra ve SVG",
  inputSchema: inputSchemaV2
};

const argsValidator = z.object({
  problem: z.string().min(1)
});

const argsValidatorV2 = z.object({
  problem: z.string().min(1),
  llmModel: z.string().min(1).optional(),
  fallbackToHeuristic: z.boolean().optional().default(true),
  useConstraintSolver: z.boolean().optional().default(true),
  solverIterations: z.number().int().positive().max(2000).optional().default(160)
});

const server = new Server(
  {
    name: "geomcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [tool, toolV2]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== TOOL_NAME && request.params.name !== TOOL_NAME_V2) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  let result: unknown;

  if (request.params.name === TOOL_NAME) {
    const { problem } = argsValidator.parse(request.params.arguments ?? {});

    const parsed = parseGeometryProblem(problem);
    const layout = buildLayout(parsed);
    const svg = renderSvg(layout);

    result = {
      parserVersion: "v1-heuristic",
      parsed,
      layout,
      svg
    };
  } else {
    const {
      problem,
      llmModel,
      fallbackToHeuristic,
      useConstraintSolver,
      solverIterations
    } = argsValidatorV2.parse(
      request.params.arguments ?? {}
    );

    let parsed;
    let parserVersion = "v2-llm";
    let warnings: string[] = [];

    try {
      parsed = await parseGeometryProblemWithLLM(problem, { model: llmModel });
    } catch (error) {
      if (!fallbackToHeuristic) {
        throw error;
      }
      parsed = parseGeometryProblem(problem);
      parserVersion = "v2-fallback-v1";
      warnings = [
        `LLM parser failed, fallback to heuristic parser: ${error instanceof Error ? error.message : String(error)}`
      ];
    }

    const enriched = enrichModelForV2(parsed);
    const baseLayout = buildLayout(enriched);
    const layout = useConstraintSolver
      ? refineLayoutWithSolver(enriched, baseLayout, { iterations: solverIterations })
      : baseLayout;
    const svg = renderSvg(layout);
    result = {
      parserVersion,
      solver: useConstraintSolver
        ? { enabled: true, iterations: solverIterations }
        : { enabled: false },
      warnings,
      parsed: enriched,
      layout,
      svg
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("GeoMCP failed to start:", error);
  process.exit(1);
});
