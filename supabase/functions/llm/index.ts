// Puts the OpenRouter key behind the user's session. The app sends the same request body it would
// send to OpenRouter; only the Authorization header is swapped here.
//
// Auth is the platform's: deployed with JWT verification on, so the handler only runs for a
// request carrying a valid Supabase session.
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
// Jev is a "decisions model": it refuses the chat endpoint outright and answers typed questions
// here instead. Same key, same session check — only the upstream path differs.
const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("This endpoint takes POST.", { status: 405 });
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return new Response("Rewriting is not configured.", { status: 503 });

  const body = await request.text();
  // The app posts to /llm for chat and /llm/decisions for a classification.
  const upstream_url = new URL(request.url).pathname.endsWith("/decisions") ? DECISIONS_URL : CHAT_URL;

  const upstream = await fetch(upstream_url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });

  // Passed through as-is: the app already knows how to read OpenRouter's successes and errors.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
});
