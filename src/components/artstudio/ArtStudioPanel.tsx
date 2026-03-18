import { useCallback, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../core/store/editorStore";
import { artProcessPalette } from "../../core/ipc/artStudioService";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function ArtStudioPanel() {
  const { logMessage } = useEditorStore();
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback(async () => {
    try {
      const selected = await open({
        title: "Selecionar imagem",
        filters: [
          { name: "Imagem", extensions: ["png", "jpg", "jpeg", "bmp", "ppm", "gif"] },
        ],
      });
      if (!selected) return;

      const imagePath = typeof selected === "string" ? selected : selected[0];
      if (!imagePath) return;

      setBusy(true);
      setError(null);
      setOriginalImage(null);
      setProcessedImage(null);

      const result = await artProcessPalette(imagePath);
      if (!result.ok) {
        const msg = result.error ?? "Falha ao processar imagem.";
        setError(msg);
        logMessage("error", `[ArtStudio] ${msg}`);
        return;
      }

      setOriginalImage(convertFileSrc(imagePath));
      if (result.processed_base64) {
        setProcessedImage(`data:image/png;base64,${result.processed_base64}`);
      }
      logMessage("success", "[ArtStudio] Imagem processada com quantização Mega Drive.");
    } catch (err) {
      const msg = describeError(err);
      setError(msg);
      logMessage("error", `[ArtStudio] ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [logMessage]);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const files = event.dataTransfer?.files;
      if (!files?.length) return;

      const file = files[0];
      const path = (file as File & { path?: string }).path;
      if (path) {
        void (async () => {
          setBusy(true);
          setError(null);
          setOriginalImage(null);
          setProcessedImage(null);
          try {
            const result = await artProcessPalette(path);
            if (!result.ok) {
              const msg = result.error ?? "Falha ao processar imagem.";
              setError(msg);
              logMessage("error", `[ArtStudio] ${msg}`);
              return;
            }
            setOriginalImage(convertFileSrc(path));
            if (result.processed_base64) {
              setProcessedImage(`data:image/png;base64,${result.processed_base64}`);
            }
            logMessage("success", "[ArtStudio] Imagem processada com quantização Mega Drive.");
          } catch (err) {
            const msg = describeError(err);
            setError(msg);
            logMessage("error", `[ArtStudio] ${msg}`);
          } finally {
            setBusy(false);
          }
        })();
      } else {
        logMessage("warn", "[ArtStudio] Arraste não suportado. Use o botão para selecionar.");
      }
    },
    [logMessage]
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleFileSelect}
          disabled={busy}
          className="rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-3 py-1.5 text-xs font-semibold text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Processando..." : "Selecionar imagem"}
        </button>
        <span className="text-[10px] text-[#6c7086]">
          PNG, JPG, BMP, PPM. Quantização 15 cores + palette snapping Mega Drive.
        </span>
      </div>

      <div
        className="flex flex-1 min-h-0 gap-3"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="flex flex-1 flex-col gap-2 overflow-hidden rounded border border-[#313244] bg-[#1e1e2e] p-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#45475a]">
            Original
          </span>
          <div className="flex flex-1 min-h-0 items-center justify-center overflow-auto rounded bg-[#11111b]">
            {originalImage ? (
              <img
                src={originalImage}
                alt="Original"
                className="max-h-full max-w-full object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <p className="text-[10px] text-[#45475a]">
                Arraste uma imagem ou clique em Selecionar
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 overflow-hidden rounded border border-[#313244] bg-[#1e1e2e] p-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#45475a]">
            Processado (15 cores + MD)
          </span>
          <div className="flex flex-1 min-h-0 items-center justify-center overflow-auto rounded bg-[#11111b]">
            {processedImage ? (
              <img
                src={processedImage}
                alt="Processado"
                className="max-h-full max-w-full object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <p className="text-[10px] text-[#45475a]">—</p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="shrink-0 rounded border border-[#f38ba8] bg-[#f38ba8]/10 px-3 py-2 text-[10px] text-[#f38ba8]">
          {error}
        </div>
      )}
    </div>
  );
}
