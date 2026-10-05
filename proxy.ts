import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const sessionId = request.cookies.get('sessionId');

  if (sessionId) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const newSessionId = crypto.randomUUID();

  response.cookies.set('sessionId', newSessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });

  return response;
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};