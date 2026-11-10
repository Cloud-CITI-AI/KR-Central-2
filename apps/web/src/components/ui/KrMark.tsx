import type { SVGProps } from "react";

/** The KR monogram from the brand mark (packages/design-tokens/assets/kr-mark.svg), as an inline SVG so it takes `currentColor`. */
export function KrMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="100 130 300 230" aria-hidden="true" focusable="false" fill="currentColor" {...props}>
      <path d="M 118.69,150.01 L 143.11,150.01 L 143.11,344 L 118.69,344 Z M 214.74,150.01 L 241.93,150.01 L 154.18,260.09 L 154.18,224.12 Z M 190.77,232.34 L 242.45,344 L 217.52,344 L 175.45,252 Z M 266.61,150.01 L 290.36,150.01 L 290.36,344 L 266.61,344 Z M 301.25,150.01 L 357.43,150.01 L 384.31,176.9 L 384.31,233.98 L 358.31,259.99 L 301.25,259.99 L 301.25,239 L 346.68,239 L 360.62,225.07 L 360.62,187.99 L 346.61,173.99 L 301.25,173.99 Z M 323.91,271 L 346.88,271 L 380.99,344 L 355.83,344 Z" />
    </svg>
  );
}
