-- capture.lua — MAME lua: aguarda sentinela do harness e despeja RAM.
-- Saída: $REX_CAPTURE (binário): [0x100 bytes status em $FF0000] +
--        [8 buffers de 0x200 a partir de $FF0200].
local out = os.getenv("REX_CAPTURE") or "/tmp/lz4w-variants-h/capture.bin"
local ncases = tonumber(os.getenv("REX_NCASES") or "8")
local stride = tonumber(os.getenv("REX_DST_STRIDE") or "512")
-- REX_DUMP_BYTES sobrepõe o layout legado (n*stride): usado pelo harness2
-- (streams Rust) com strides variáveis.
local dump_bytes = tonumber(os.getenv("REX_DUMP_BYTES") or "")
local done_dump = false
local frames = 0

local function grab(sp, start, len)
  local b = {}
  for i = 0, len - 1 do b[#b + 1] = string.char(sp:read_u8(start + i)) end
  return table.concat(b)
end

emu.register_frame_done(function()
  frames = frames + 1
  if done_dump then return end
  local mach = manager.machine
  local sp = mach.devices[":maincpu"].spaces["program"]
  local sent = sp:read_u32(0xFF0180)
  if sent == 0xDEADBEEF or frames > 600 then
    local fh = io.open(out, "wb")
    fh:write(grab(sp, 0xFF0000, 0x100))
    if dump_bytes then
      fh:write(grab(sp, 0xFF0200, dump_bytes))
    else
      fh:write(grab(sp, 0xFF0200, stride * ncases))
    end
    fh:close()
    print("REX-DUMP frames=" .. frames .. " sentinel=" .. string.format("%08X", sent) .. " -> " .. out)
    done_dump = true
    mach:exit()
  end
end)
