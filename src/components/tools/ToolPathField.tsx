import { open } from "@tauri-apps/plugin-dialog";
import Icon from "../common/Icon";
import IconButton from "../common/IconButton";
import Input from "../common/Input";

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
  helperText?: string;
  accentColor?: string;
}

export default function ToolPathField({
  label,
  value,
  set,
  placeholder = "/caminho/para/arquivo",
  directory = false,
  extensions,
  helperText,
}: PathFieldProps) {
  return (
    <div className="flex min-w-0 items-end gap-1">
      <Input
          fieldClassName="min-w-0 flex-1"
          controlSize="sm"
          label={label}
          helperText={helperText}
          type="text"
          value={value}
          placeholder={placeholder}
          className="font-mono"
          onChange={(event) => set(event.target.value)}
        />
      <IconButton
        size="sm"
        variant="secondary"
        aria-label={directory ? `Selecionar pasta para ${label}` : `Selecionar arquivo para ${label}`}
        icon={<Icon name="folder" size={16} />}
        onClick={() =>
          void browseFile(set, {
            directory,
            filters: extensions ? [{ name: "Arquivo", extensions }] : undefined,
          })
        }
      />
    </div>
  );
}
