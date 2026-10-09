/** Exact viewer texts (PRODUCT_SPEC §5.5, §11.1). Australian English. */
export const VIEWER_MESSAGES = {
  pending: "This file is still being checked for viruses.",
  infected: "Blocked – failed the virus scan",
  scanError: "Couldn't be checked for viruses – remove it and upload it again",
  dwgTitle: "DWG drawings can't be previewed in the browser",
  dwgHint: "Download it and open it in your CAD software.",
  openInNewTab: "Open in new tab",
} as const;
