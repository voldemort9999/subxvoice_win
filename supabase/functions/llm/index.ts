// Puts the OpenRouter key behind the user's session. The app sends the same request body it would
// send to OpenRouter; only the Authorization header is swapped here.
//
// Auth is the platform's: deployed with JWT verification on, so the handler only runs for a
// request carrying a valid Supabase session.
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
// Jev is a "decisions model": it refuses the chat endpoint outright and answers typed questions
// here instead. Same key, same session check — only the upstream path differs.
const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
// The assistant talks to Claude in Anthropic's own Messages format (its SDK appends /v1/messages
// to the proxy URL), so tool calls and screenshots stay native. Plan T14.
const MESSAGES_URL = "https://openrouter.ai/api/v1/messages";

/** Which OpenRouter path a proxy path maps to. */
function upstreamFor(pathname: string): string {
  if (pathname.endsWith("/messages")) return MESSAGES_URL;
  if (pathname.endsWith("/decisions")) return DECISIONS_URL;
  return CHAT_URL;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("This endpoint takes POST.", { status: 405 });
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return new Response("Rewriting is not configured.", { status: 503 });

  const body = await request.text();
  // The app posts to /llm for chat, /llm/decisions for a classification, /llm/v1/messages for the assistant.
  const upstream_url = upstreamFor(new URL(request.url).pathname);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  // Anthropic's version and beta headers decide the request's shape; they carry no secret.
  for (const name of ["anthropic-version", "anthropic-beta"]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  const upstream = await fetch(upstream_url, { method: "POST", headers, body });

  // Passed through as-is: the app already knows how to read OpenRouter's successes and errors.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
});
