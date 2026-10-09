import { formatMegabytes } from "@/lib/format";
import { Wrap } from "./Wrap";
import styles from "./Footer.module.css";

export interface FooterProps {
  /** Server upload limit (`Me.uploadMaxBytes`): generates the accepted-types sentence. Omitted on public pages. */
  readonly maxUploadBytes?: number;
  /** `FEEDBACK_URL`; the "Send feedback" link is hidden without it (§12). */
  readonly feedbackUrl?: string;
}

/** Prototype footer text with the size limit taken from the server; renders nothing when it has nothing to say. */
export function Footer({ maxUploadBytes, feedbackUrl }: FooterProps) {
  if (maxUploadBytes === undefined && !feedbackUrl) return null;
  return (
    <footer className={styles.footer}>
      <Wrap>
        {maxUploadBytes !== undefined && (
          <p>
            Status and responsibility are set manually on each checkpoint. Files accepted: PDF, images (PNG, JPG, GIF,
            WebP), video, and text/CSV files, up to {formatMegabytes(maxUploadBytes)} MB each.
          </p>
        )}
        {feedbackUrl && (
          <p>
            <a href={feedbackUrl} target="_blank" rel="noopener noreferrer">
              Send feedback
            </a>
          </p>
        )}
      </Wrap>
    </footer>
  );
}
