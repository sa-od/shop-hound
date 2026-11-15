import { redirect } from "next/navigation";

/** The Briefs list became My competitors; each store's runs live on its store page. */
export default function BriefsArchive() {
  redirect("/competitors");
}
