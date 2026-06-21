import { ICONS } from "../icons.js";

// React counterpart of Icon.astro, for use inside React islands.
export default function Icon({ name, size = 18, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
      {...rest}
    />
  );
}
