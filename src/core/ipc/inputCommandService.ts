import { invoke } from "@tauri-apps/api/core";
import type { ParsedInputCommand } from "../inputCommands";

export async function parseInputCommandFile(path: string): Promise<ParsedInputCommand[]> {
  return invoke<ParsedInputCommand[]>("parse_input_command_file", { path });
}
