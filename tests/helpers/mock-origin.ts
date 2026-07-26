import type { Fetcher } from '../../src/types/io.js';

/**
 * An in-memory HTTP origin over a byte buffer. It honours HEAD, full GET, and
 * `bytes=` ranges (including suffix ranges), returns ETag/Last-Modified, records
 * every request for subrequest-count assertions, and can inject transient
 * failures and range-unsupported behaviour to exercise the resilience paths.
 */
export interface MockOriginOptions {
  readonly url?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly supportsSuffixRange?: boolean;
  readonly failTimes?: number;
}

export interface RecordedRequest {
  readonly method: string;
  readonly range: string | null;
}

export interface MockOrigin {
  readonly url: string;
  readonly fetch: Fetcher;
  readonly requests: RecordedRequest[];
  callCount(): number;
}

export function createMockOrigin(bytes: Uint8Array, options: MockOriginOptions = {}): MockOrigin {
  const url = options.url ?? 'https://origin.example/archive.zip';
  const etag = options.etag ?? '"mock-etag-v1"';
  const lastModified = options.lastModified ?? 'Wed, 21 Oct 2026 07:28:00 GMT';
  const supportsSuffix = options.supportsSuffixRange ?? true;
  let remainingFailures = options.failTimes ?? 0;
  const requests: RecordedRequest[] = [];

  const validators = { etag, 'last-modified': lastModified, 'accept-ranges': 'bytes' };

  const fetcher: Fetcher = (input, init) => {
    const requestUrl = resolveUrl(input);
    const method = resolveMethod(input, init);
    const headers = resolveHeaders(input, init);
    const rangeHeader = headers.get('range');
    requests.push({ method, range: rangeHeader });

    const signal = init?.signal ?? undefined;
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    if (requestUrl !== url) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      return Promise.resolve(new Response('unavailable', { status: 503 }));
    }

    if (method === 'HEAD') {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { ...validators, 'content-length': String(bytes.byteLength) },
        }),
      );
    }

    if (rangeHeader !== null) {
      const parsed = parseRange(rangeHeader, bytes.byteLength, supportsSuffix);
      if (parsed === 'invalid') {
        return Promise.resolve(
          new Response('range not satisfiable', {
            status: 416,
            headers: { 'content-range': `bytes */${bytes.byteLength}` },
          }),
        );
      }
      const slice = bytes.subarray(parsed.start, parsed.end + 1);
      return Promise.resolve(
        new Response(slice, {
          status: 206,
          headers: {
            ...validators,
            'content-range': `bytes ${parsed.start}-${parsed.end}/${bytes.byteLength}`,
            'content-length': String(slice.byteLength),
          },
        }),
      );
    }

    return Promise.resolve(fullResponse(bytes, validators));
  };

  return { url, fetch: fetcher, requests, callCount: () => requests.length };
}

function fullResponse(bytes: Uint8Array, validators: Record<string, string>): Response {
  return new Response(bytes, {
    status: 200,
    headers: { ...validators, 'content-length': String(bytes.byteLength) },
  });
}

type ParsedRange = { start: number; end: number } | 'invalid';

function parseRange(header: string, size: number, supportsSuffix: boolean): ParsedRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (startText === '' && endText === '') return 'invalid';

  if (startText === '') {
    // An origin that does not support suffix ranges answers 416 here.
    if (!supportsSuffix) return 'invalid';
    const suffix = Number(endText);
    if (suffix === 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startText);
  if (start >= size) return 'invalid';
  const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  if (end < start) return 'invalid';
  return { start, end };
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function resolveMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === 'object' && !(input instanceof URL) && 'method' in input) {
    return input.method.toUpperCase();
  }
  return 'GET';
}

function resolveHeaders(input: RequestInfo | URL, init: RequestInit | undefined): Headers {
  if (init?.headers) return new Headers(init.headers);
  if (typeof input === 'object' && !(input instanceof URL) && 'headers' in input) {
    return new Headers(input.headers);
  }
  return new Headers();
}
