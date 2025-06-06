import { formatDataStreamPart, Message } from "@ai-sdk/ui-utils";
import {
  convertToCoreMessages,
  DataStreamWriter,
  ToolExecutionOptions,
  ToolSet,
} from "ai";
import { z } from "zod";

// Approval string to be shared across frontend and backend
export const APPROVAL = {
  YES: "Yes, confirmed.",
  NO: "No, denied.",
} as const;

function isValidToolName<K extends PropertyKey, T extends object>(
  key: K,
  obj: T
): key is K & keyof T {
  return key in obj;
}

export async function processToolCalls<
  Tools extends ToolSet,
  ExecutableTools extends {
    [Tool in keyof Tools as Tools[Tool] extends { execute: (...args: unknown[]) => unknown }
      ? never
      : Tool]: Tools[Tool];
  }
>(
  {
    dataStream,
    messages,
  }: {
    tools: Tools; // used for type inference
    dataStream: DataStreamWriter;
    messages: Message[];
  },
  executeFunctions: {
    [K in keyof Tools & keyof ExecutableTools]?: (
      args: z.infer<ExecutableTools[K]["parameters"]>,
      context: ToolExecutionOptions
    ) => Promise<unknown>;
  }
): Promise<Message[]> {
  const lastMessage = messages[messages.length - 1];
  const parts = lastMessage.parts;
  if (!parts) return messages;

  const processedParts = await Promise.all(
    parts.map(async (part) => {
      // Only process tool invocations parts
      if (part.type !== "tool-invocation") return part;

      const { toolInvocation } = part;
      const toolName = toolInvocation.toolName;

      // Special handling for document upload and additional support tools
      if (toolName === "documentUpload" && toolInvocation.state === "call") {
        // For document upload, we just return the part as is
        // The actual upload will be handled by the UI component
        return part;
      }
      
      if (toolName === "additionalSupport" && toolInvocation.state === "call") {
        // For additional support, we just return the part as is
        // The actual support will be handled by the UI component or backend
        return part;
      }

      // Only continue if we have an execute function for the tool (meaning it requires confirmation) and it's in a 'result' state
      if (!(toolName in executeFunctions) || toolInvocation.state !== "result")
        return part;

      let result;

      if (toolInvocation.result === APPROVAL.YES) {
        // Get the tool and check if the tool has an execute function.
        if (
          !isValidToolName(toolName, executeFunctions) ||
          toolInvocation.state !== "result"
        ) {
          return part;
        }

        const toolInstance = executeFunctions[toolName];
        if (toolInstance) {
          result = await toolInstance(toolInvocation.args, {
            messages: convertToCoreMessages(messages),
            toolCallId: toolInvocation.toolCallId,
          });
        } else {
          result = "Error: No execute function found on tool";
        }
      } else if (toolInvocation.result === APPROVAL.NO) {
        result = "Error: User denied access to tool execution";
      } else if (toolName === "documentUpload") {
        // Handle document upload result from UI
        result = toolInvocation.result;
      } else if (toolName === "additionalSupport") {
        // Handle additional support result
        result = toolInvocation.result || "A representative from a support group may reach out to you.";
      } else {
        // For any unhandled responses, return the original part.
        return part;
      }

      // Forward updated tool result to the client.
      dataStream.write(
        formatDataStreamPart("tool_result", {
          toolCallId: toolInvocation.toolCallId,
          result,
        })
      );

      // Return updated toolInvocation with the actual result.
      return {
        ...part,
        toolInvocation: {
          ...toolInvocation,
          result,
        },
      };
    })
  );

  // Finally return the processed messages
  return [...messages.slice(0, -1), { ...lastMessage, parts: processedParts }];
}

export function getToolsRequiringConfirmation<
  T extends ToolSet
  // E extends {
  //   [K in keyof T as T[K] extends { execute: Function } ? never : K]: T[K];
  // },
>(tools: T): string[] {
  return (Object.keys(tools) as (keyof T)[]).filter((key) => {
    const maybeTool = tools[key];
    return typeof maybeTool.execute !== "function";
  }) as string[];
}
