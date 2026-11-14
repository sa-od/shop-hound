import type { LastKnown } from "@/lib/brief";
import { LocalTime } from "./LocalTime";

/** "Last read Nov 6: 140 products" */
export function LastRead({ l }: { l: LastKnown }) {
  return (
    <>
      Last read <LocalTime iso={l.snapshotDate} format="calendar" />: {l.productCount.toLocaleString()} products
    </>
  );
}
