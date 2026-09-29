import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { siteOrigin } from "../lib/config";
import { validCode, validEmail } from "../lib/journal";
import { getSupabase } from "../lib/supabase";

type AuthResult = Readonly<{ ok: true } | { ok: false; message: string }>;

type AuthValue = Readonly<{
  ready: boolean;
  configured: boolean;
  session: Session | null;
  sendCode: (email: string) => Promise<AuthResult>;
  verifyCode: (email: string, code: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}>;

const AuthContext = createContext<AuthValue | null>(null);

const sentMessage =
  "If this address has access, we sent a private sign-in link.";

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const supabase = useMemo(() => getSupabase(), []);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setReady(true);
      })
      .catch(() => {
        if (active) setReady(true);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      configured: Boolean(supabase),
      session,
      async sendCode(email) {
        if (!supabase) {
          return {
            ok: false,
            message: "Add the publishable key before signing in.",
          };
        }
        if (!validEmail(email)) {
          return { ok: false, message: "Enter a complete email address." };
        }
        try {
          await supabase.auth.signInWithOtp({
            email: email.trim().toLowerCase(),
            options: {
              shouldCreateUser: false,
              emailRedirectTo: `${siteOrigin}/auth/callback`,
            },
          });
        } catch {
          // Same as the web form: unknown addresses, provider failures,
          // and rate limits share one response.
        }
        return { ok: true };
      },
      async verifyCode(email, code) {
        if (!supabase) {
          return {
            ok: false,
            message: "Add the publishable key before signing in.",
          };
        }
        const normalized = email.trim().toLowerCase();
        if (!validEmail(normalized) || !validCode(code)) {
          return { ok: false, message: "Enter the six-digit code." };
        }
        try {
          const { error } = await supabase.auth.verifyOtp({
            email: normalized,
            token: code.trim(),
            type: "email",
          });
          if (error) {
            return {
              ok: false,
              message:
                "That code is not available. Request a new code and try again.",
            };
          }
          const { data, error: membershipError } = await supabase
            .from("circle_memberships")
            .select("circle_id")
            .limit(2);
          if (membershipError) {
            await supabase.auth.signOut({ scope: "local" });
            return {
              ok: false,
              message: "Our Days is temporarily unavailable. Please try again.",
            };
          }
          if (!data || data.length === 0) {
            await supabase.auth.signOut({ scope: "local" });
            return {
              ok: false,
              message: "This account does not have access to a circle.",
            };
          }
          return { ok: true };
        } catch {
          return {
            ok: false,
            message: "Our Days is temporarily unavailable. Please try again.",
          };
        }
      },
      async signOut() {
        await supabase?.auth.signOut();
      },
    }),
    [ready, session, supabase],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}

export { sentMessage };
