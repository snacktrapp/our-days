import { NextResponse } from "next/server";
import { createOurDaysServerClient } from "@/lib/supabase/server";

function appRedirect(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) return appRedirect(request, "/sign-in?link=invalid");

  try {
    const supabase = await createOurDaysServerClient();
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      return appRedirect(request, "/sign-in?link=invalid");
    }

    const { data, error: membershipError } = await supabase
      .from("circle_memberships")
      .select("circle_id")
      .limit(2);

    if (membershipError) {
      await supabase.auth.signOut({ scope: "local" });
      return appRedirect(request, "/sign-in?link=unavailable");
    }

    if (!data || data.length === 0) {
      return appRedirect(request, "/access-unavailable");
    }

    return appRedirect(request, "/family");
  } catch {
    return appRedirect(request, "/sign-in?link=unavailable");
  }
}
