// The number of a figure, table or note inside a React island: the same mark as
// Structural.astro (lib/structural.ts), which the provenance test requires to read exactly
// "Figura N" (or Tabela, Nota), with N its position on the page.
import { type StructuralKind, structuralText } from "../lib/structural";

export default function StructuralMark({ kind, n }: { kind: StructuralKind; n: number }) {
  return (
    <span className="structural" data-structural={kind}>
      {structuralText(kind, n)}
    </span>
  );
}
