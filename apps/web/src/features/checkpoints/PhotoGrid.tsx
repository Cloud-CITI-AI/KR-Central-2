"use client";
import type { FileMeta } from "@kr/contracts";
import Image from "next/image";
import { useViewer } from "@/features/viewer";
import { fileContentUrl } from "./fileUrl";
import styles from "./PhotoGrid.module.css";

export interface PhotoGridProps {
  /** Every photo of the folder: the viewer pages through all of them, the grid shows the ones that may be served. */
  readonly photos: readonly FileMeta[];
}

/** Whether the API will serve the content: clean (or skipped when scanning is off locally). */
export function isServable(file: FileMeta): boolean {
  return file.scanStatus === "clean" || file.scanStatus === "skipped";
}

/** 96 px (4:3) thumbnails; a click opens the viewer on that photo. A photo still being scanned or blocked has none. */
export function PhotoGrid({ photos }: PhotoGridProps) {
  const viewer = useViewer();
  const shown = photos.filter(isServable);
  if (shown.length === 0) return null;
  return (
    <div className={styles.thumbs}>
      {shown.map((photo) => (
        <button
          key={photo.id}
          type="button"
          className={styles.thumb}
          title={photo.name}
          onClick={() => {
            viewer.open(
              photos,
              photos.findIndex((p) => p.id === photo.id),
            );
          }}
        >
          <Image src={fileContentUrl(photo.id)} alt={photo.name} fill sizes="96px" unoptimized />
        </button>
      ))}
    </div>
  );
}
