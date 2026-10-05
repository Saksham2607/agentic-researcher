import { groq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { vector } from '@/lib/vector';

export function shouldCheckForMemory(content: string) {
  const text = content.trim().toLowerCase();

  if (text.length < 15) {
    return false;
  }

  const ignoredMessages = [
    'hi',
    'hello',
    'hey',
    'thanks',
    'thank you',
    'okay',
    'ok',
    'yes',
    'no',
    'cool',
    'great',
    'nice',
    'got it',
  ];

  if (ignoredMessages.includes(text)) {
    return false;
  }

  return true;
}

export async function extractMemory(content: string) {
  const result = await generateText({
    model: groq('openai/gpt-oss-120b'),

    prompt: `You are a memory extraction system.

Decide whether the following message contains useful long-term information that should be remembered for future conversations.

Store things such as:
- important project details
- technical decisions
- architecture decisions
- user preferences
- long-term goals
- important facts

Do NOT store:
- greetings
- temporary questions
- filler conversation
- acknowledgements
- information unlikely to matter later

If there is useful long-term information, return ONLY one concise memory statement.

If there is nothing worth remembering, return exactly:

NO_MEMORY

Message:
${content}`,
  });

  const memory = result.text.trim();

  if (memory === 'NO_MEMORY') {
    return null;
  }

  return memory;
}

export async function storeMemory(
  sessionId: string,
  content: string
) {
  const id = `memory-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 9)}`;

  await vector.upsert(
    {
      id,
      data: content,
    },
    {
      namespace: sessionId,
    }
  );

  return id;
}

export async function searchMemories(
  sessionId: string,
  query: string
) {
  const results = await vector.query(
    {
      data: query,
      topK: 5,
      includeData: true,
    },
    {
      namespace: sessionId,
    }
  );

  return results
    .filter(
      (result) =>
        result.data &&
        result.score >= 0.7
    )
    .map((result) => ({
      content: result.data as string,
      score: result.score,
    }));
}