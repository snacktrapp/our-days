// Optional scheduler. Supabase injects SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY. SAFETY_JOB_SECRET is set in the function env.
// This function only forwards a POST to public.tick_safety_jobs.

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = Deno.env.get("SAFETY_JOB_SECRET") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || authorization !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response("Unavailable", { status: 503 });
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/tick_safety_jobs`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  return new Response(await response.text(), {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});
