local M = {}

local MAX_LINE_BYTES = 4096
local MAX_TEXT_BYTES = 512
local MAX_MOVE_REPEAT = 256

local move_keys = {
  h = true,
  j = true,
  k = true,
  l = true,
  w = true,
  b = true,
  e = true,
  ["0"] = true,
  ["$"] = true,
  G = true,
}

local function is_integer(value)
  return type(value) == "number" and value == value and value % 1 == 0
end

local function has_exact_keys(value, keys)
  if type(value) ~= "table" then
    return false
  end

  local count = 0
  for key, _ in pairs(value) do
    if not keys[key] then
      return false
    end
    count = count + 1
  end

  local expected = 0
  for _, _ in pairs(keys) do
    expected = expected + 1
  end
  return count == expected
end

local function valid_hash(value)
  return type(value) == "string" and #value == 64 and value:match("^[0-9a-f]+$") ~= nil
end

local function valid_identifier(value)
  return type(value) == "string" and #value > 0 and #value <= 256
end

local function valid_text(value)
  if type(value) ~= "string" or #value > MAX_TEXT_BYTES then
    return false, "text-too-long"
  end
  local first = value:sub(1, 1)
  if first == ":" or first == "!" then
    return false, "forbidden-text"
  end
  return true
end

local function validate_action(action)
  if type(action) ~= "table" or type(action.type) ~= "string" then
    return nil, "unknown-action"
  end

  if action.type == "prepare" then
    if not has_exact_keys(action, { type = true, poem = true, expectedSha256 = true }) then
      return nil, "invalid-action"
    end
    if type(action.poem) ~= "string" or #action.poem == 0 then
      return nil, "invalid-poem"
    end
    if not valid_hash(action.expectedSha256) then
      return nil, "invalid-hash"
    end
  elseif action.type == "status" or action.type == "escape" or action.type == "reset" or action.type == "shutdown" then
    if not has_exact_keys(action, { type = true }) then
      return nil, "invalid-action"
    end
  elseif action.type == "move" then
    if not has_exact_keys(action, { type = true, keys = true, ["repeat"] = true }) then
      return nil, "invalid-action"
    end
    if not move_keys[action.keys] then
      return nil, "invalid-move-key"
    end
    local repeat_count = action["repeat"]
    if not is_integer(repeat_count) or repeat_count < 0 or repeat_count > MAX_MOVE_REPEAT then
      return nil, "repeat-out-of-range"
    end
  elseif action.type == "insert" then
    if not has_exact_keys(action, { type = true, text = true, charsPerSecond = true }) then
      return nil, "invalid-action"
    end
    local text_ok, text_error = valid_text(action.text)
    if not text_ok then
      return nil, text_error
    end
    if type(action.charsPerSecond) ~= "number" or action.charsPerSecond ~= action.charsPerSecond or action.charsPerSecond < 0 or action.charsPerSecond > 1000 then
      return nil, "invalid-speed"
    end
  elseif action.type == "select" then
    if not has_exact_keys(action, { type = true, rangeId = true }) or not valid_identifier(action.rangeId) then
      return nil, "invalid-range"
    end
  elseif action.type == "replace" then
    if not has_exact_keys(action, { type = true, rangeId = true, text = true }) or not valid_identifier(action.rangeId) then
      return nil, "invalid-range"
    end
    local text_ok, text_error = valid_text(action.text)
    if not text_ok then
      return nil, text_error
    end
  else
    return nil, "unknown-action"
  end

  return action
end

function M.validate_command(value, expected_token)
  if not has_exact_keys(value, {
    schema = true,
    token = true,
    loopId = true,
    cueId = true,
    action = true,
  }) then
    return nil, "invalid-command"
  end
  if value.schema ~= 1 then
    return nil, "invalid-schema"
  end
  if type(expected_token) ~= "string" or value.token ~= expected_token then
    return nil, "authentication-failed"
  end
  if not valid_identifier(value.loopId) or not valid_identifier(value.cueId) then
    return nil, "invalid-id"
  end

  local action, action_error = validate_action(value.action)
  if not action then
    return nil, action_error
  end
  return value
end

function M.decode_line(line, expected_token)
  if type(line) ~= "string" then
    return nil, "invalid-line"
  end
  if #line > MAX_LINE_BYTES then
    return nil, "line-too-long"
  end

  local ok, value = pcall(vim.json.decode, line)
  if not ok or type(value) ~= "table" then
    return nil, "invalid-json"
  end
  return M.validate_command(value, expected_token)
end

function M.encode_ack(acknowledgement)
  return vim.json.encode(acknowledgement) .. "\n"
end

M.MAX_LINE_BYTES = MAX_LINE_BYTES
M.MAX_TEXT_BYTES = MAX_TEXT_BYTES
M.MAX_MOVE_REPEAT = MAX_MOVE_REPEAT

return M
