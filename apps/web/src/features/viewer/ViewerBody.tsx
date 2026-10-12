"use client";
import type { FileMeta } from "@kr/contracts";
import Image from "next/image";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Spinner } from "@/components/ui/Spinner";
import { contentUrl, probeContentStatus, viewFor } from "./content";
import { VIEWER_MESSAGES, loadFailedText } from "./messages";
import { EmailView } from "./EmailView";
import { TextView } from "./TextView";
import styles from "./ViewerBody.module.css";

/** pdf.js and the page drawing load only when a PDF is opened (bundle budget, FE-9). */
const PdfView = lazy(() => import("./PdfView").then((module) => ({ default: module.PdfView })));

export interface ViewerBodyProps {
  readonly file: FileMeta;
}

interface MediaViewProps {
  readonly file: FileMeta;
}

/**
 * An `<img>` or `<video>` only says "error": once it does, find out why from the server and swap the media for a notice
 * (a broken-image icon or a dead player says nothing). Callers key this by file id, so moving to another file starts clean.
 */
function MediaFrame({ file, render }: MediaViewProps & { readonly render: (onError: () => void) => ReactNode }) {
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!failed) return;
    const controller = new AbortController();
    probeContentStatus(file.id, controller.signal).then(
      (status) => {
        setNotice(loadFailedText({ status }, VIEWER_MESSAGES.loadFailed));
      },
      () => undefined, // aborted: the file changed or the dialog closed
    );
    return () => {
      controller.abort();
    };
  }, [failed, file.id]);

  if (notice !== null)
    return (
      <p role="status" className={styles.notice}>
        {notice}
      </p>
    );
  return render(() => {
    setFailed(true);
  });
}

function ImageView({ file }: MediaViewProps) {
  return (
    <MediaFrame
      file={file}
      render={(onError) => (
        // Its own size, only scaled down to the dialog (the prototype's `.dlg-b img`): `fill` stretched a small image to the whole box.
        <Image
          className={styles.image}
          src={contentUrl(file.id)}
          alt={file.name}
          width={0}
          height={0}
          sizes="100vw"
          unoptimized
          onError={onError}
        />
      )}
    />
  );
}

function VideoView({ file }: MediaViewProps) {
  return (
    <MediaFrame
      file={file}
      render={(onError) => (
        <video className={styles.video} src={contentUrl(file.id)} controls preload="metadata" onError={onError}>
          <track kind="captions" />
        </video>
      )}
    />
  );
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
      return <ImageView key={file.id} file={file} />;
    case "video":
      return <VideoView key={file.id} file={file} />;
    case "text":
      return <TextView file={file} />;
    case "email":
      return <EmailView file={file} />;
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
