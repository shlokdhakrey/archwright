import type { RequestContext } from '../types/context.js';

/** Invokes the next layer of the pipeline. */
export type Next = () => Promise<Response>;

/** The innermost unit: turns a context into a response. */
export type Handler = (ctx: RequestContext) => Promise<Response> | Response;

/** An onion-model middleware wrapping the rest of the pipeline. */
export type Middleware = (ctx: RequestContext, next: Next) => Promise<Response> | Response;
