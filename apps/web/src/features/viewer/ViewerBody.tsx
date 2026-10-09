"use client";
import type { FileMeta } from "@kr/contracts";
import Image from "next/image";
import { contentUrl } from "./content";
import styles from "./ViewerBody.module.css";

export interface ViewerBodyProps {
  readonly file: FileMeta;
}

/** What the dialog shows for one file, by kind (§11.1). The other kinds follow in the next changes. */
export function ViewerBody({ file }: ViewerBodyProps) {
  if (file.kind === "image") {
    return (
      <div className={styles.picture}>
        <Image className={styles.image} src={contentUrl(file.id)} alt={file.name} fill unoptimized />
      </div>
    );
  }
  return null;
}
