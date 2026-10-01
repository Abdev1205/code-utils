import { redirect } from "next/navigation";

import { DEFAULT_UTIL } from "@/lib/utils-registry";

export default function Home() {
  redirect(`/${DEFAULT_UTIL}`);
}
