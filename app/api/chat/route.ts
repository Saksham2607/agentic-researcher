import { google } from '@ai-sdk/google';
import {
  streamText,
  generateText,
  convertToModelMessages,
  UIMessage,
  tool,
  stepCountIs,
} from 'ai';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { redis } from '@/lib/redis';
import { ratelimit } from '@/lib/rate-limit';
import {
  searchMemories,
  shouldCheckForMemory,
  extractMemory,
  storeMemory,
} from '@/lib/memory';

// Retries a fetch once if the response comes back 429 (rate-limited),
// waiting briefly first since OpenAlex's shared free-tier limit is often
// transient and clears within a second or two.
async function fetchWithRetry(
  url: string,
  retries = 1,
  delayMs = 1500
): Promise<Response> {
  let response = await fetch(url);

  for (let attempt = 0; attempt < retries && response.status === 429; attempt++) {
    console.log(`📚 OpenAlex 429 — retrying in ${delayMs}ms (attempt ${attempt + 1})`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    response = await fetch(url);
  }

  return response;
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const cookieStore = await cookies();
  const sessionId = cookieStore.get('sessionId')?.value;

  // Rate limiting
  if (sessionId) {
    const { success } = await ratelimit.limit(sessionId);

    if (!success) {
      return Response.json(
        {
          error:
            'Too many messages. Please wait a moment and try again.',
        },
        { status: 429 }
      );
    }
  }

  // Prevent multiple messages from being processed simultaneously
  let lockAcquired = false;

  if (sessionId) {
    const lockKey = `lock:${sessionId}`;

    const acquired = await redis.set(lockKey, '1', {
      nx: true,
      ex: 30,
    });

    if (!acquired) {
      return Response.json(
        {
          error:
            'Your previous message is still being processed. Please wait.',
        },
        { status: 429 }
      );
    }

    lockAcquired = true;
  }

  // Get current user message
  const currentMessage = messages[messages.length - 1];

  const currentMessageText = currentMessage
    ? currentMessage.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
    : '';

  // Search long-term memory
  const relevantMemories =
    sessionId && currentMessageText
      ? await searchMemories(sessionId, currentMessageText)
      : [];

  // Convert memories into context
  const memoryContext =
    relevantMemories.length > 0
      ? relevantMemories
          .map(
            (memory, index) =>
              `Memory ${index + 1}: ${memory.content}`
          )
          .join('\n')
      : '';

  // Keep recent messages for short-term context (reduced to save tokens)
  const recentMessages = messages.slice(-6);

  const modelMessages = await convertToModelMessages(
    recentMessages
  );

  // Anything that isn't trivial filler should be forced to ground itself in a real search
  const requiresGrounding = shouldCheckForMemory(currentMessageText);

  // These arrays capture the ACTUAL results that came back from the tools during
  // this request — not what the model claims it used. This is the ground truth
  // we verify citations against in Phase B below.
  const collectedWebResults: any[] = [];
  const collectedAcademicResults: any[] = [];

  // Request-scoped dedup trackers — these persist across MULTIPLE calls to the
  // same tool within one request (e.g. an initial search + a retry search),
  // not just within a single call's own strong+recent merge.
  const seenAcademicTitles = new Set<string>();
  const seenWebUrls = new Set<string>();

  const sharedInstructions = `You have access to web search and academic search tools.

For any substantive question, you must call one of these tools before answering — do not answer purely from your own training knowledge when the user is asking about facts, current information, or research.

GROUNDING STRATEGY — call both tools together, then stop:
When you are required to ground your answer, call BOTH searchWeb AND searchAcademic in the SAME response, not one after another. Do not call one tool, wait, and then decide whether to call the other — issue both tool calls together immediately. This gives you current context and academic sources at the same time instead of sequentially.

Once you have received results from both tools, evaluate what you have:
- A tool call that returns ANY non-empty results counts as "usable" for this rule — even if the results feel topically broad, general, or not a perfect match for the question. Do NOT retry a search just because the results feel insufficiently specific or relevant; only retry if a tool returned a literal empty result set or an error.
- If together the tools gave you at least 2 usable (non-empty) results total, STOP searching and write your final text answer now. Do not call any more tools, even if you judge the specific topical fit to be imperfect — write the best answer you can with what you have instead.
- Only make one additional, differently-worded search per tool if that specific tool returned a literal empty result set or an error on the first attempt. Never retry a tool that already returned non-empty results, regardless of how relevant those results seem.
- You may issue at most one retry round total per tool across this entire response. Never search the same tool more than twice.
- If after that you still have insufficient (empty) results from a tool, do not keep searching — answer with whatever you have, and say plainly which parts are less well-supported rather than continuing to search indefinitely.

You must always end by producing a text answer for the user. Never let a response consist only of tool calls with no final written answer — the user needs to see actual text, even if it has to acknowledge gaps in the available sources.

CRITICAL — Citation accuracy: When referencing academic papers, studies, authors, or findings, you may ONLY reference ones that appear verbatim in the tool results returned above in this conversation. Never state a paper title, author name, publication venue, year, or research finding that did not come directly from a tool result. If the tool results do not contain enough information to answer fully, say so honestly rather than filling gaps from memory. Fabricating citations is a serious error. This also applies to named techniques, algorithms, or paper titles that appear only inside a tool result's embedded reference list or "related articles" snippet — do not present those as if they were directly discussed or verified findings; only draw on content that the source actually describes in its own text.

The academic search tool returns a mix of highly-cited foundational papers and recently published papers on the topic together. When writing your answer, draw on both where relevant — use foundational papers for well-established concepts and recent papers to reflect the current state of the field. Do not treat an older paper as outdated or lesser just because of its year; cite whichever paper actually supports the specific claim you're making.

SOURCES SECTION — REQUIRED at the end of every substantive answer:
After your written answer, add a section titled "### Sources" and list every source you actually drew on, using ONLY data from the tool results returned in this conversation:
- Academic papers (from searchAcademic): list as "Title — First Author et al., Year — [link]" using the exact title, year, and url/DOI from the tool result. If no url was returned for that paper, omit the link but still list the paper.
- Web sources (from searchWeb): list as "Title — [link]" using the exact title and url from the tool result.
- Never invent a source, a link, or details about a source that were not in the tool results.
- Do not list the same source twice.
- If a tool returned zero usable results (e.g. a search failure), do not list anything for it — instead write one line noting that source type was unavailable for this query (e.g. "Academic search was temporarily unavailable for this query; the answer above is based on web sources only.").

For greetings, acknowledgements, or statements where the user is just sharing a preference, opinion, or fact about themselves, no tool call is needed — simply acknowledge it naturally.${
    memoryContext
      ? `

Relevant long-term memory from previous interactions:

${memoryContext}

Use this memory only when it is relevant to the user's current request. Do not mention that you are using stored memory unless directly asked.`
      : ''
  }`;

  const tools = {
    searchWeb: tool({
      description:
        'Search the general web for current information, explanations, or context on a topic. Use this for any substantive question. Never use this for greetings, acknowledgements, or statements of preference/opinion that do not require external information.',

      inputSchema: z.object({
        query: z.string().describe('The search query'),
      }),

      execute: async ({ query }: { query: string }) => {
        console.log('🔍 Searching Tavily for:', query);

        const response = await fetch(
          'https://api.tavily.com/search',
          {
            method: 'POST',

            headers: {
              'Content-Type': 'application/json',
            },

            body: JSON.stringify({
              api_key: process.env.TAVILY_API_KEY,
              query,
              max_results: 3,
            }),
          }
        );

        const data = await response.json();

        console.log(
          '🔍 Cleaned Tavily results:',
          JSON.stringify(data.results, null, 2)
        );

        // Capture into the ground-truth whitelist, deduping by URL across
        // however many times this tool gets called in one request.
        if (Array.isArray(data.results)) {
          for (const r of data.results) {
            if (r?.url && !seenWebUrls.has(r.url)) {
              seenWebUrls.add(r.url);
              collectedWebResults.push(r);
            }
          }
        }

        return data.results;
      },
    }),

    searchAcademic: tool({
      description:
        'Search academic papers for scholarly grounding on a technical or scientific topic. Returns a blend of the most highly-cited (strongest) papers and the most recently published papers on the topic. Use this whenever the user asks about research, studies, or academic findings on a subject. Never use this for greetings, acknowledgements, or the user simply stating a preference (e.g. "I prefer X over Y") — that is not a request for information. Only cite papers that appear in the results this tool returns — never invent titles, authors, or findings.',

      inputSchema: z.object({
        query: z.string().describe('The academic search query'),
      }),

      execute: async ({ query }: { query: string }) => {
        console.log('📚 Searching OpenAlex for:', query);

        const currentYear = new Date().getFullYear();
        const recentYearThreshold = currentYear - 3; // last ~3 years

        const baseParams =
          `search=${encodeURIComponent(query)}` +
          `&select=title,publication_year,authorships,doi` +
          `&mailto=sakshamsgamingden@gmail.com` +
          `&api_key=${process.env.OPENALEX_API_KEY}`;

        const strongUrl =
          `https://api.openalex.org/works?${baseParams}&sort=cited_by_count:desc&per_page=3`;

        const recentUrl =
          `https://api.openalex.org/works?${baseParams}&filter=publication_year:>${recentYearThreshold}&sort=publication_date:desc&per_page=3`;

        const [strongResponse, recentResponse] = await Promise.all([
          fetchWithRetry(strongUrl, 1, 1500),
          fetchWithRetry(recentUrl, 1, 1500),
        ]);

        const strongData = await strongResponse.json();
        const recentData = await recentResponse.json();

        console.log('📚 Strong-papers status:', strongResponse.status);
        console.log('📚 Recent-papers status:', recentResponse.status);

        const combinedRaw = [
          ...(strongData.results ?? []),
          ...(recentData.results ?? []),
        ];

        const results = combinedRaw
          .filter((work: any) => {
            // Dedup across however many times this tool gets called in one
            // request, not just within this single call's own merge.
            if (seenAcademicTitles.has(work.title)) return false;
            seenAcademicTitles.add(work.title);
            return true;
          })
          .map((work: any) => ({
            title: work.title,
            year: work.publication_year,
            authors:
              work.authorships
                ?.map((a: any) => a.author?.display_name)
                .filter(Boolean) ?? [],
            url: work.doi ?? null,
          }));

        console.log(
          '📚 Cleaned OpenAlex results:',
          JSON.stringify(results, null, 2)
        );

        // Capture into the ground-truth whitelist used by Phase B's verifier
        collectedAcademicResults.push(...results);

        return results;
      },
    }),
  };

  let result;

  try {
    if (!requiresGrounding) {
      // No citation risk for greetings/small talk — a single pass is fine,
      // and this stays fast since tools aren't forced.
      result = streamText({
        model: google('gemini-3.6-flash'),
        prepareStep: () => ({ toolChoice: 'auto' }),
        instructions: sharedInstructions,
        messages: modelMessages,
        stopWhen: stepCountIs(5),
        tools,
        onError: async (error) => {
          if (sessionId && lockAcquired) {
            await redis.del(`lock:${sessionId}`);
          }
          console.error('streamText error:', error);
        },
      });
    } else {
      // PHASE A — draft silently. Nothing here reaches the user yet.
      console.log('✍️ Phase A: drafting (not yet shown to user)...');

      const draftResult = await generateText({
        model: google('gemini-3.6-flash'),
        prepareStep: ({ stepNumber }: { stepNumber: number }) => {
          if (stepNumber === 0) {
            return { toolChoice: 'required' };
          }
          return { toolChoice: 'auto' };
        },
        instructions: sharedInstructions,
        messages: modelMessages,
        stopWhen: stepCountIs(5),
        tools,
      });

      const draftText = draftResult.text;

      // Build the ground-truth whitelist from what the tools ACTUALLY returned
      // during Phase A — not what the model claims it used. Already deduped
      // via seenAcademicTitles / seenWebUrls above, even across multiple calls.
      const whitelist = {
        academicPapers: collectedAcademicResults.map((p) => ({
          title: p.title,
          authors: p.authors,
          year: p.year,
          url: p.url,
        })),
        webSources: collectedWebResults.map((w) => ({
          title: w.title,
          url: w.url,
        })),
      };

      console.log(
        '🛡️ Verified whitelist for Phase B:',
        JSON.stringify(whitelist, null, 2)
      );

      // PHASE B — verify + rewrite. THIS is what actually streams to the user.
      console.log('🛡️ Phase B: verifying citations against whitelist...');

      result = streamText({
        model: google('gemini-3.6-flash'),

        instructions: `You are a strict citation-accuracy checker for a research tool. You will be given a drafted answer and a VERIFIED SOURCE LIST — the only sources that are confirmed real for this request.

Your job: output a corrected version of the draft that follows these rules exactly:

1. Keep the content, structure, and wording of the draft as close to unchanged as possible.
2. Any inline citation (e.g. "(Author et al., Year)") that does NOT match an entry in the verified source list below must be removed from the sentence. If removing it leaves the sentence making a specific claim that now has no support, soften the sentence to a general statement instead of presenting it as a specific sourced finding.
3. Never invent a new citation, title, author, year, or link that is not in the verified source list, even to "fix" a removed one.
4. Do not add commentary about this verification process to the output — just produce the corrected final answer as if it were written directly.

5. REWRITE the "### Sources" section at the end using EXACTLY this format, with no deviation:
   - For each academic paper you keep: "Title — FirstAuthor et al., Year — Link" on its own line, starting with a hyphen. Use ONLY the first author's name followed by "et al." (never list every author, even if the source list gives you a full author array). Always include the year. Always include the link exactly as given in the source list (it will look like a DOI URL, e.g. "https://doi.org/..."). If a paper has no url in the source list, write "Title — FirstAuthor et al., Year" with no link, but still include it.
   - For each web source you keep: "Title — Link" on its own line, starting with a hyphen. Always include the link exactly as given.
   - Only include a paper or web source here if it is actually referenced or drawn upon in the answer text above it. Do not list every source from the verified list if the answer didn't use it — only list what was actually used.
   - If you removed every citation of a given type (e.g. no academic papers ended up supported), write one line instead: "Academic search was temporarily unavailable for this query; the answer above is based on web sources only." (or the equivalent for web sources being unavailable). Only use this fallback line if the source list below is genuinely empty for that type — if the source list has entries but the draft simply didn't end up citing any of them because they weren't a good topical fit, do NOT say "unavailable"; instead omit that type's heading/line entirely, since the search did succeed, it just wasn't used.
   - Double-check every line in your Sources section has: a title, a year (for papers), and a link, before finishing your output. A Sources line missing a year or a link is incorrect — go back and fix it using the data in the verified source list below.

VERIFIED SOURCE LIST (the only sources you may cite — use this exact data, do not alter titles, years, or links):
${JSON.stringify(whitelist, null, 2)}`,

        messages: [
          {
            role: 'user',
            content: `Here is the drafted answer to verify and correct:\n\n${draftText}`,
          },
        ],

        onError: async (error) => {
          if (sessionId && lockAcquired) {
            await redis.del(`lock:${sessionId}`);
          }
          console.error('Phase B streamText error:', error);
        },
      });
    }
  } catch (error) {
    if (sessionId && lockAcquired) {
      await redis.del(`lock:${sessionId}`);
    }
    console.error('Draft generation error:', error);

    return Response.json(
      { error: 'Something went wrong generating a response. Please try again.' },
      { status: 500 }
    );
  }

  return result.toUIMessageStreamResponse({
    originalMessages: messages,

    onFinish: async ({ messages: finishedMessages }) => {
      if (!sessionId) return;

      try {
        await redis.set(
          `conversation:${sessionId}`,
          JSON.stringify(finishedMessages)
        );
      } catch (error) {
        console.error('Conversation save error:', error);
      } finally {
        if (lockAcquired) {
          await redis.del(`lock:${sessionId}`);
        }
      }

      // Fire-and-forget: don't make the lock/response wait on this
      if (currentMessageText && shouldCheckForMemory(currentMessageText)) {
        extractMemory(currentMessageText)
          .then((extractedMemory) => {
            if (extractedMemory) {
              return storeMemory(sessionId, extractedMemory).then(() => {
                console.log('🧠 Stored memory:', extractedMemory);
              });
            }
          })
          .catch((error) => {
            console.error('Memory extraction/storage error:', error);
          });
      }
    },
  });
}

export async function GET() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('sessionId')?.value;

  if (!sessionId) {
    return Response.json({ messages: [] });
  }

  const saved = await redis.get(
    `conversation:${sessionId}`
  );

  if (!saved) {
    return Response.json({ messages: [] });
  }

  const messages =
    typeof saved === 'string'
      ? JSON.parse(saved)
      : saved;

  return Response.json({ messages });
}