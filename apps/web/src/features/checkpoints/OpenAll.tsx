"use client";
import type { FileMeta } from "@kr/contracts";
import { Button } from "@/components/ui/Button";
import { useViewer } from "@/features/viewer";

export interface OpenAllProps {
  readonly files: readonly FileMeta[];
  /** "Open all" for documents, "View all" for photos. */
  readonly label?: string;
}

/** The folder header's button: opens the viewer on the first file, with ‹ › across all of them. */
export function OpenAll({ files, label = "Open all" }: OpenAllProps) {
  const viewer = useViewer();
  return (
    <Button
      small
      onClick={() => {
        viewer.open(files, 0);
      }}
    >
      {label}
    </Button>
  );
}
