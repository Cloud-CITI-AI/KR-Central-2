import type { FileMeta } from "@kr/contracts";
import { DocRow } from "./DocRow";
import styles from "./FileList.module.css";

export interface FileListProps {
  readonly files: readonly FileMeta[];
  readonly onOpen: (file: FileMeta) => void;
  readonly onRemove: (file: FileMeta) => void;
  /** Ids the parent is currently deleting. */
  readonly removing?: ReadonlySet<string>;
}

/** The prototype `.docs` list of `DocRow`s. */
export function FileList({ files, onOpen, onRemove, removing }: FileListProps) {
  return (
    <ul className={styles.docs}>
      {files.map((file) => (
        <DocRow
          key={file.id}
          file={file}
          onOpen={onOpen}
          onRemove={onRemove}
          removing={removing?.has(file.id) ?? false}
        />
      ))}
    </ul>
  );
}
