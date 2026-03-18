/**
 * LayoutSplitter — divisor estilizado para react-resizable-panels.
 * Área de clique 2–4px, bg sutil, destaque em hover/drag (estilo engine moderna).
 */
import { Separator } from "react-resizable-panels";

const SPLITTER_CLASS =
  "w-px min-w-px flex-shrink-0 bg-[#313244]/60 transition-colors duration-150 " +
  "hover:bg-[#89b4fa] " +
  "data-[separator=pointer]:bg-[#89b4fa]";

interface LayoutSplitterProps {
  id?: string;
}

export default function LayoutSplitter({ id }: LayoutSplitterProps) {
  return (
    <Separator
      id={id}
      className={SPLITTER_CLASS}
      style={{ flexBasis: 4, minWidth: 4 }}
    />
  );
}
