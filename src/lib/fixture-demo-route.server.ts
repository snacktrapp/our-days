import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isFixtureDemoRouteEnabled } from "../../config/fixture-demo-route-policy";

export async function requireFixtureDemoRoute() {
  await connection();
  if (!isFixtureDemoRouteEnabled(process.env)) redirect("/sign-in");
}
