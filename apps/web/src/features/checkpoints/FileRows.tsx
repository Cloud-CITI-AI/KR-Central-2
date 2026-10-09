"use client";
import type { FileMeta } from "@kr/contracts";
import { FileList } from "@/components/ui/FileList";
import { useViewer } from "@/features/viewer";
import { useDeleteFile } from "./useDeleteFile";

export interface FileRowsProps {
  readonly jobId: string;
  readonly checkpointKey: string;
  /** The files of one folder: the viewer pages through exactly these. */
  readonly files: readonly FileMeta[];
}

/** The document rows of a folder: a name opens the viewer on it, × asks "Remove? Yes / No" and removes. Renders nothing for no files. */
export function FileRows({ jobId, checkpointKey, files }: FileRowsProps) {
  const viewer = useViewer();
  const { remove, removing } = useDeleteFile(jobId, checkpointKey);
  if (files.length === 0) return null;
  return (
    <FileList
      files={files}
      removing={removing}
      onOpen={(file) => {
        viewer.open(
          files,
          files.findIndex((f) => f.id === file.id),
        );
      }}
      onRemove={(file) => {
        void remove(file);
      }}
    />
  );
}
