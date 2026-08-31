import { google } from '@ai-sdk/google';
import { streamText, convertToModelMessages, UIMessage, tool, stepCountIs } from 'ai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: google('gemini-3.6-flash'),
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    tools: {
      searchWeb: tool({
        description:
          'Search the general web for current information, explanations, or context on a topic.',
        inputSchema: z.object({
          query: z.string().describe('The search query'),
        }),
        execute: async ({ query }) => {
          console.log('🔍 Searching Tavily for:', query);
          const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: process.env.TAVILY_API_KEY,
              query,
              max_results: 5,
            }),
          });
          const data = await response.json();
          return data.results;
        },
      }),
      searchAcademic: tool({
        description:
          'Search academic papers for scholarly grounding on a technical or scientific topic — use this for fundamentals, research-backed explanations, or prior work on a subject.',
        inputSchema: z.object({
          query: z.string().describe('The academic search query'),
        }),
        execute: async ({ query }) => {
          console.log('📚 Searching Semantic Scholar for:', query);
          const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
            query
          )}&limit=5&fields=title,abstract,year,authors,url`;
          const response = await fetch(url);
          const data = await response.json();
          return data.data;
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}