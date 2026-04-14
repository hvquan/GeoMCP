import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { runGeometryPipeline } from "./pipeline/index.js";

const TOOL_NAME = "read_and_draw_geometry";

const inputSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    problem: {
      type: "string",
      description: "De bai hinh hoc bang van ban"
    },
    llmModel: {
      type: "string",
      description: "Tuy chon model LLM (neu bo qua se dung bien moi truong hoac mac dinh)"
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

const argsValidator = z.object({
  problem: z.string().min(1),
  llmModel: z.string().min(1).optional()
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
    tools: [tool]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== TOOL_NAME) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { problem, llmModel } = argsValidator.parse(request.params.arguments ?? {});

  const pipelineResult = await runGeometryPipeline(problem, {
    model: llmModel,
  });

  const result = {
    parserVersion: pipelineResult.parserVersion,
    warnings: pipelineResult.warnings,
    dsl: pipelineResult.dsl,
    svg: pipelineResult.svg
  };

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


