local runtime_root = assert(vim.env.JANVIM_EXHIBITION_NVIM_ROOT, "test runtime root is required")
vim.opt.runtimepath:prepend(runtime_root)

local protocol = require("janvim_exhibition.protocol")

local TOKEN = "fixture-token-2026-lua"
local HASH = string.rep("a", 64)
local failures = 0

local function expect(condition, message)
  if not condition then
    error(message, 2)
  end
end

local function run(name, test)
  local ok, err = xpcall(test, debug.traceback)
  if ok then
    print("PASS protocol: " .. name)
  else
    failures = failures + 1
    print("FAIL protocol: " .. name .. "\n" .. tostring(err))
  end
end

local function command(action)
  return {
    schema = 1,
    token = TOKEN,
    loopId = "loop-protocol",
    cueId = "cue-protocol",
    action = action,
  }
end

run("accepts only the closed command set", function()
  local valid = {
    { type = "prepare", poem = "白日依山尽", expectedSha256 = HASH },
    { type = "status" },
    { type = "move", keys = "j", ["repeat"] = 12 },
    { type = "insert", text = "生成文本", charsPerSecond = 24 },
    { type = "select", rangeId = "opening" },
    { type = "replace", rangeId = "opening", text = "替换文本" },
    { type = "escape" },
    { type = "reset" },
    { type = "shutdown" },
  }

  for _, action in ipairs(valid) do
    local normalized, error_code = protocol.validate_command(command(action), TOKEN)
    expect(normalized ~= nil, action.type .. " should be accepted: " .. tostring(error_code))
  end

  local rejected, error_code = protocol.validate_command(command({ type = "command", value = ":w" }), TOKEN)
  expect(rejected == nil and error_code == "unknown-action", "arbitrary command action must be rejected")
end)

run("rejects wrong tokens, unknown fields, Ex text, and shell text", function()
  local wrong_token = command({ type = "status" })
  wrong_token.token = "wrong-token-2026-0000"
  expect(select(1, protocol.validate_command(wrong_token, TOKEN)) == nil, "wrong token was accepted")

  local with_unknown = command({ type = "shutdown", command = ":qa!" })
  expect(select(1, protocol.validate_command(with_unknown, TOKEN)) == nil, "shutdown accepted user text")

  local ex_text = command({ type = "insert", text = ":write", charsPerSecond = 20 })
  expect(select(1, protocol.validate_command(ex_text, TOKEN)) == nil, "Ex-looking text was accepted")

  local shell_text = command({ type = "insert", text = "!calc.exe", charsPerSecond = 20 })
  expect(select(1, protocol.validate_command(shell_text, TOKEN)) == nil, "shell-looking text was accepted")
end)

run("rejects overlong text and out-of-range move repeats", function()
  local overlong = command({ type = "insert", text = string.rep("a", 513), charsPerSecond = 20 })
  local _, text_error = protocol.validate_command(overlong, TOKEN)
  expect(text_error == "text-too-long", "513-byte text must be rejected")

  local repeat_command = command({ type = "move", keys = "j", ["repeat"] = 257 })
  local _, repeat_error = protocol.validate_command(repeat_command, TOKEN)
  expect(repeat_error == "repeat-out-of-range", "repeat 257 must be rejected")
end)

run("decodes bounded NDJSON and emits one newline-terminated ACK", function()
  local line = vim.json.encode(command({ type = "status" }))
  local decoded, decode_error = protocol.decode_line(line, TOKEN)
  expect(decoded ~= nil, "valid line failed: " .. tostring(decode_error))

  local overlong, overlong_error = protocol.decode_line(string.rep("a", 4097), TOKEN)
  expect(overlong == nil and overlong_error == "line-too-long", "4097-byte line must be rejected")

  local ack = protocol.encode_ack({
    schema = 1,
    loopId = "loop-protocol",
    cueId = "cue-protocol",
    outcome = "applied",
    mode = "n",
    cursor = { row = 0, col = 0 },
    bufferSha256 = HASH,
  })
  expect(ack:sub(-1) == "\n", "ACK must terminate with exactly one newline")
  expect(not ack:sub(1, -2):find("\n", 1, true), "ACK payload contains an unexpected newline")
end)

if failures > 0 then
  vim.cmd("cquit 1")
else
  vim.cmd("qa!")
end
