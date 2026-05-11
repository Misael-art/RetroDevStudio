import { open } from "@tauri-apps/plugin-dialog";

async function browseFile(
  setter: (value: string) => void,
  opts?: {
    directory?: boolean;
    filters?: { name: string; extensions: string[] }[];
  }
) {
  const result = await open({
    multiple: false,
    directory: opts?.directory ?? false,
    filters: opts?.filters,
  });
  if (typeof result === "string") {
    setter(result);
  }
}

interface PathFieldProps {
  label: string;
  value: string;
  set: (value: string) => void;
  placeholder?: string;
  directory?: boolean;
  extensions?: string[];
  accentColor?: string;
}

export default function ToolPathField({
  label,
  value,
  set,
  placeholder = "/caminho/para/arquivo",
  directory = false,
  extensions,
  accentColor = "cba6f7",
}: PathFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-[#7f849c]">{label}</label>
      <div className="flex gap-1">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          className={`flex-1 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs font-mono text-[#cdd6f4] focus:outline-none focus:border-[#${accentColor}]`}
          onChange={(event) => set(event.target.value)}
        />
        <button
          type="button"
          onClick={() =>
            void browseFile(set, {
              directory,
              filters: extensions ? [{ name: "File", extensions }] : undefined,
            })
          }
          className="shrink-0 rounded bg-[#313244] px-2 py-1 text-xs text-[#a6adc8] transition-colors hover:bg-[#45475a]"
          title={directory ? "Selecionar pasta" : "Selecionar arquivo"}
        >
          ...
        </button>
      </div>
    </div>
  );
}
