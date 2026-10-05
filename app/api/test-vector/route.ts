import { vector } from '@/lib/vector';

export async function GET() {
  try {
    await vector.upsert({
      id: 'test-memory-1',
      data: 'The user is building an AI research agent using Tavily, Semantic Scholar, Redis, and Groq.',
    });

    const results = await vector.query({
      data: 'What technologies is the user using to build their AI agent?',
      topK: 3,
      includeData: true,
    });

    return Response.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('Vector test error:', error);

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}