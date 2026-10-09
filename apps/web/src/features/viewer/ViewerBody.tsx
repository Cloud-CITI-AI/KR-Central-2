"use client";
import type { FileMeta } from "@kr/contracts";
import Image from "next/image";
import { lazy, Suspense } from "react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Spinner } from "@/components/ui/Spinner";
import { contentUrl, viewFor } from "./content";
import { VIEWER_MESSAGES } from "./messages";
import { TextView } from "./TextView";
import styles from "./ViewerBody.module.css";

/** pdf.js and the page drawing load only when a PDF is opened (bundle budget, FE-9). */
const PdfView = lazy(() => import("./PdfView").then((module) => ({ default: module.PdfView })));

export interface ViewerBodyProps {
  readonly file: FileMeta;
}

/** What the dialog shows for one file, by kind (§11.1). Scan states that block the file replace the content. */
export function ViewerBody({ file }: ViewerBodyProps) {
  const view = viewFor(file);
  switch (view.type) {
    case "unavailable":
      return (
        <p role="status" className={styles.notice}>
          {view.message}
        </p>
      );
    case "image":
      return (
        <div className={styles.picture}>
          <Image className={styles.image} src={contentUrl(file.id)} alt={file.name} fill unoptimized />
        </div>
      );
    case "video":
      return (
        <video className={styles.video} src={contentUrl(file.id)} controls preload="metadata">
          <track kind="captions" />
        </video>
      );
    case "text":
      return <TextView file={file} />;
    case "email":
      return <TextView file={file} body={view.body} />;
    case "dwg":
      return (
        <div className={styles.notice}>
          <b>{VIEWER_MESSAGES.dwgTitle}</b>
          <span>{VIEWER_MESSAGES.dwgHint}</span>
          <ButtonLink href={contentUrl(file.id, "attachment")} variant="primary">
            Download {file.name}
          </ButtonLink>
        </div>
      );
    case "pdf":
      return (
        <Suspense fallback={<Spinner label={VIEWER_MESSAGES.loading} />}>
          <PdfView file={file} />
        </Suspense>
      );
  }
}
