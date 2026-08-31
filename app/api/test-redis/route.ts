import { redis } from '@/lib/redis';

export async function GET() {
  await redis.set('test-key', 'Redis is connected!');

  const value = await redis.get<string>('test-key');

  return Response.json({
    success: true,
    value,
  });
}