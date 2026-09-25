-- capture.lua — MAME lua: aguarda sentinela do harness e despeja RAM.
-- Saída: $REX_CAPTURE (binário): [0x100 bytes status em $FF0000] +
--        [8 buffers de 0x200 a partir de $FF0200].
local out = os.getenv("REX_CAPTURE") or "/tmp/lz4w-variants-h/capture.bin"
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
    fh:write(grab(sp, 0xFF0200, 0x200 * 8))
    fh:close()
    print("REX-DUMP frames=" .. frames .. " sentinel=" .. string.format("%08X", sent) .. " -> " .. out)
    done_dump = true
    mach:exit()
  end
end)
