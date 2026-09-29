import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { applyUpdateAtLaunch } from "../lib/app-updates";
import { verifyEmailCode } from "../lib/auth-flow";
import { authStorageKey, siteOrigin } from "../lib/config";
import { validEmail } from "../lib/journal";
import { secureSessionStorage } from "../lib/secure-session";
import { getSupabase } from "../lib/supabase";

type AuthResult = Readonly<{ ok: true } | { ok: false; message: string }>;

type AuthValue = Readonly<{
  ready: boolean;
  configured: boolean;
  session: Session | null;
  /** Last sign-in or session failure. Lives here so it survives screen remounts. */
  authError: string | null;
  clearAuthError: () => void;
  sendCode: (email: string) => Promise<AuthResult>;
  verifyCode: (email: string, code: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}>;

const AuthContext = createContext<AuthValue | null>(null);

const sentMessage =
  "If this address has access, we sent a private sign-in link.";

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const supabase = useMemo(() => getSupabase(), []);
  const [ready, setReady] = useState(() => !supabase);
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const intentionalSignOut = useRef(false);
  const verifying = useRef(false);

  useEffect(() => {
    // Never reload under a sign-in in progress.
    void applyUpdateAtLaunch(() => !verifying.current);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAuthError(
          `Your saved sign-in could not be read (${String(error)}). Please sign in again.`,
        );
        setReady(true);
      });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (
        event === "SIGNED_OUT" &&
        !intentionalSignOut.current &&
        !verifying.current
      ) {
        setAuthError("You were signed out. Please sign in again.");
      }
      if (event === "SIGNED_OUT") intentionalSignOut.current = false;
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
        setAuthError(null);
        verifying.current = true;
        try {
          const result = await verifyEmailCode(supabase, email, code, {
            storage: secureSessionStorage,
            storageKey: authStorageKey(),
          });
          if (!result.ok) {
            setAuthError(result.message);
            return result;
          }
          setSession(result.session);
          return { ok: true };
        } catch (error) {
          const message = `Sign-in failed unexpectedly (${String(error)}).`;
          setAuthError(message);
          return { ok: false, message };
        } finally {
          verifying.current = false;
        }
      },
      async signOut() {
        intentionalSignOut.current = true;
        setAuthError(null);
        await supabase?.auth.signOut();
      },
      authError,
      clearAuthError() {
        setAuthError(null);
      },
    }),
    [authError, ready, session, supabase],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}

export { sentMessage };
