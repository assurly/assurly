import { NextResponse } from 'next/server';
import { AuthenticationError } from './auth';
import { AuthorizationError } from './authorization';
import { ConfigurationError } from './env';

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ConfigurationError) {
    console.error(`[Configuration Error] ${error.message}`);
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  console.error(error);
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}
