import JournalScreen from "./journal";
import SignInScreen from "./sign-in";

import { useAuth } from "../components/auth-provider";
import { coldStartSurface } from "../lib/cold-start";

export default function Index() {
  const { ready, session } = useAuth();
  const surface = coldStartSurface(ready, Boolean(session));
  if (surface === "splash") return null;
  if (surface === "sign-in") return <SignInScreen />;
  return <JournalScreen />;
}
