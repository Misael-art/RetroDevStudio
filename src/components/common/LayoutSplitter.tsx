/**
 * LayoutSplitter — divisor estilizado para react-resizable-panels.
 * Área de clique 2–4px, bg sutil, destaque em hover/drag (estilo engine moderna).
 */
import { Separator } from "react-resizable-panels";

interface LayoutSplitterProps {
  id?: string;
  orientation?: "horizontal" | "vertical";
}

export default function LayoutSplitter({
  id,
  orientation = "horizontal",
}: LayoutSplitterProps) {
  const className =
    orientation === "vertical"
      ? "h-px min-h-px w-full flex-shrink-0 bg-[#313244]/60 transition-colors duration-150 hover:bg-[#89b4fa] data-[separator=pointer]:bg-[#89b4fa]"
      : "w-px min-w-px flex-shrink-0 bg-[#313244]/60 transition-colors duration-150 hover:bg-[#89b4fa] data-[separator=pointer]:bg-[#89b4fa]";

  return (
    <Separator
      id={id}
      className={className}
      style={
        orientation === "vertical"
          ? { flexBasis: 4, minHeight: 4 }
          : { flexBasis: 4, minWidth: 4 }
      }
    />
  );
}
