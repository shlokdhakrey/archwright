import type { RequestContext } from '../types/context.js';
import type { Handler, Middleware } from './types.js';

/**
 * Compose middlewares around a terminal handler in onion order: the first
 * middleware is the outermost layer. Guards against a middleware calling `next()`
 * more than once.
 */
export function compose(middlewares: readonly Middleware[], handler: Handler): Handler {
  return (ctx: RequestContext): Promise<Response> => {
    let lastIndex = -1;

    const dispatch = (index: number): Promise<Response> => {
      if (index <= lastIndex) {
        return Promise.reject(new Error('next() called multiple times'));
      }
      lastIndex = index;
      const middleware = middlewares[index];
      if (!middleware) {
        return Promise.resolve(handler(ctx));
      }
      return Promise.resolve(middleware(ctx, () => dispatch(index + 1)));
    };

    return dispatch(0);
  };
}
