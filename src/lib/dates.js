// Every formatter carries `in: UTC` so a filename day displays as that same day regardless of the build machine's timezone.
import { format } from "date-fns";
import { tz } from "@date-fns/tz";

const UTC = tz("UTC");

export const fmtFull = (iso) => format(iso, "MMMM d, yyyy", { in: UTC });
export const fmtMedium = (iso) => format(iso, "MMM d, yyyy", { in: UTC });
export const fmtDay = (iso) => format(iso, "MMM d", { in: UTC });
export const fmtWeekday = (iso) => format(iso, "EEE, MMM do yyyy", { in: UTC });
// Reading UTC fields gives back the local wall-clock the `updated` stamp encodes (see EntryEditor's localStamp).
export const fmtWeekdayTime = (iso) => format(iso, "EEE, MMM do yyyy, HH:mm:ss", { in: UTC });
