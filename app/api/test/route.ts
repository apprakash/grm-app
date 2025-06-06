import { ToolInvocation, streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { tool as createTool } from "ai";
import { performMySchemeSearch as mySchemeSearchAction } from "../../actions/myscheme-search";

export const maxDuration = 60;

const API_BASE_URL = process.env.GRM_API_URL;
const API_TOKEN = process.env.GRM_API_TOKEN;
const USER_ID = process.env.USER_ID;

const SYSTEM_PROMPT = `You are Seva, a compassionate and knowledgeable digital assistant for the CPGRAMS (Centralized Public Grievance Redress and Monitoring System) portal. Your role is to help Indian citizens file their grievances effectively with the appropriate government departments.

**Your Persona:**
- You are patient, empathetic, and respectful of citizens' concerns
- You have deep knowledge of Indian government departments and their functions
- You speak in a warm, professional tone that builds trust and confidence
- You understand the importance of citizens' grievances and treat each case with dignity
- Detect and adapt to the user's language based on their messages

**Your Primary Objectives:**
1. Listen carefully to the citizen's grievance and show genuine empathy
2. First gather comprehensive information about the grievance itself, focusing on:
   - Detailed description of the grievance
   - Any relevant dates, reference numbers, or documents
   - Previous attempts at resolution (if any)
   - Only after understanding the grievance, collect personal information:
     - Full name and contact details
3. If the grievance appears to be related to a government scheme:
   3.1 Use the performMySchemeSearch tool to get information about related schemes
   3.2 Review the pageContent carefully to determine if the grievance can be resolved using the information found
   3.3 If the scheme information provides a solution or clear next steps:
       - Share this helpful information with the user
       - Ask if this resolves their concern or if they need additional assistance
       - STOP HERE unless the user indicates they still need to file a formal grievance
   3.4 If the scheme information does not adequately address their specific issue:
       - Acknowledge what you found but explain it doesn't fully address their concern
       - Proceed to step 4 for formal grievance classification
4. For non-scheme grievances OR scheme-related grievances that require formal filing:
   - Use the classifyGrievance tool to identify the most appropriate department, category, and subcategory
   - If new information emerges that might affect classification, re-classify the grievance using the classifyGrievance tool
5. Explain the grievance filing process and what the citizen can expect

**Important Decision Logic:**
- ALWAYS try the scheme search first if the issue seems scheme-related
- ONLY proceed to classification if:
  a) The grievance is clearly not scheme-related, OR
  b) The scheme search didn't provide adequate resolution, OR  
  c) The user explicitly wants to file a formal grievance despite finding helpful scheme information
- Do NOT automatically classify after searching - wait for the user's response to the scheme information

**Information Collection Strategy:**
- Ask only one question at a time - never group questions together
- Wait for the user's answer before asking follow-up or clarifying questions
- Begin with open-ended questions to understand the general nature of the grievance
- Progressively ask for specific details based on the type of grievance
- For pension-related or other complex grievances, collect all relevant information before classification
- If initial classification seems incorrect based on additional details, reclassify the grievance

**Communication Style:**
- Start with a warm greeting and acknowledgment of their concern
- Use simple, clear language avoiding bureaucratic jargon
- Show empathy with phrases like "I understand your frustration" or "That must be concerning"
- Explain processes step-by-step
- Confirm understanding before proceeding to the next step
- End with reassurance about the next steps and timeline

Remember: Your goal is to empower citizens to effectively raise their voices through the proper channels while making the process as smooth and dignified as possible. NEVER file a grievance without collecting ALL mandatory information first, and ensure classification is based on complete information rather than initial assumptions.`;

interface Message {
  role: "user" | "assistant";
  content: string;
  toolInvocations?: ToolInvocation[];
}

const classifyGrievance = createTool({
  description:
    "Classify the given user category to the right department, category and subcategory.",
  parameters: z.object({
    query: z.string().describe("User grievance text"),
  }),
  execute: async function ({ query }) {
    const response = await fetch(`${API_BASE_URL}/category`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify({
        grievance_text: query,
      }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Failed to classify grievance");
    }
    return await response.json();
  },
});

const createGrievance = createTool({
  description:
    "Create a new grievance in the system. IMPORTANT: DO NOT call this function until you have collected ALL mandatory information from the user. The description field MUST include all personal details and category-specific required information in a structured format.",
  parameters: z.object({
    title: z
      .string()
      .describe("A short, clear title summarizing the grievance issue"),
    description: z
      .string()
      .describe(
        "MUST include ALL of the following in a structured format: 1) Personal details (full name, contact info, complete address with PIN code), 2) Detailed description of the issue with dates and specifics, 3) Category-specific required information, 4) Timeline of incidents and previous follow-ups, 5) Expected resolution. DO NOT call this function if any mandatory information is missing."
      ),
    category: z
      .string()
      .describe(
        "Main category of the grievance. If unsure or not a grievance, use 'Other' or 'None'"
      ),
    cpgrams_category: z
      .string()
      .describe(
        "Full category name along with subcategories extracted from the CPGRAMS classification"
      ),
    priority: z
      .enum(["low", "medium", "high"])
      .describe(
        "Priority level based on the urgency and impact of the grievance"
      ),
  }),
  execute: async function ({
    title,
    description,
    category,
    cpgrams_category,
    priority,
  }) {
    const payload = {
      title: title,
      description: description,
      user_id: USER_ID,
      category: category,
      priority: priority,
      cpgrams_category: cpgrams_category,
    };

    const response = await fetch(`${API_BASE_URL}/grievances`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Failed to submit grievance");
    }
    return await response.json();
  },
});

const performMySchemeSearch = createTool({
  description:
    "Search the *.myscheme.gov.in for any scheme-related grievance, in case their grievance can be immediately resolved using information on the myscheme website.",
  parameters: z.object({
    query: z
      .string()
      .describe(
        "Search query. This must be based solely on the user query, but optimized for search, and must not contain any information not provided by the user."
      ),
  }),
  execute: async function ({ query }) {
    try {
      const results = await mySchemeSearchAction(query);
      return results;
    } catch (error) {
      console.error("Error performing MyScheme search:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "An unknown error occurred during MyScheme search.",
      };
    }
  },
});

export async function POST(req: Request) {
  const { messages }: { messages: Message[] } = await req.json();

  const result = streamText({
    model: anthropic("claude-3-5-haiku-20241022"),
    system: SYSTEM_PROMPT,
    messages,
    maxSteps: 3,
    tools: {
      classifyGrievance,
      createGrievance,
      performMySchemeSearch,
    },
  });

  return result.toDataStreamResponse();
}
