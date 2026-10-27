export function isVercelQueueDispatchEnabled() {
  return process.env.VERCEL === "1";
}

// Only Vercel's queue broker delivers to the /queue callback routes. Self-hosted
// backends (BullMQ, QStash, internal) call the authenticated internal routes
// directly, so off Vercel these routes must not run unauthenticated handlers.
export function vercelQueueOnly(
  handler: (request: Request) => Promise<Response>,
) {
  return (request: Request) => {
    if (!isVercelQueueDispatchEnabled()) {
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }
    return handler(request);
  };
}
