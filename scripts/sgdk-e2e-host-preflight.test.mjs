import { describe, expect, it } from "vitest";

import {
  buildTauriDriverCheck,
  probeExecutable,
} from "./sgdk-e2e-host-preflight.mjs";

describe("sgdk e2e host preflight", () => {
  it("does not mark tauri-driver ready when the executable probe is blocked", () => {
    const check = buildTauriDriverCheck({
      externalDriver: false,
      tauriDriverPath: "C:/Users/test/.cargo/bin/tauri-driver.exe",
      executableProbe: {
        ok: false,
        statusCode: "tauri_driver_blocked",
        detail: "Uma politica de Controle de Aplicativo bloqueou este arquivo.",
      },
    });

    expect(check.ok).toBe(false);
    expect(check.exists).toBe(true);
    expect(check.executable).toBe(false);
    expect(check.statusCode).toBe("tauri_driver_blocked");
    expect(check.detail).toContain("Controle de Aplicativo");
  });

  it("keeps external-driver mode ready without probing a local tauri-driver binary", () => {
    const check = buildTauriDriverCheck({
      externalDriver: true,
      tauriDriverPath: "",
      executableProbe: null,
    });

    expect(check.ok).toBe(true);
    expect(check.executable).toBeNull();
    expect(check.statusCode).toBeNull();
  });

  it("can prove a normal executable starts successfully", async () => {
    const probe = await probeExecutable(process.execPath, ["--version"], 5000);

    expect(probe.ok).toBe(true);
    expect(probe.statusCode).toBeNull();
  });
});
