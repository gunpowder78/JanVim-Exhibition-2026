local protocol = require("janvim_exhibition.protocol")
local ShowBuffer = require("janvim_exhibition.buffer")

local Agent = {}
Agent.__index = Agent

local MAX_ACKNOWLEDGEMENTS = 512
local MAX_PENDING_DUPLICATES = 4
local MAX_ACTIONS_PER_LOOP = 256
local MAX_INSERT_DURATION_MS = 1500
local MOVE_CHUNK_SIZE = 16

local editor_actions = {
  move = true,
  insert = true,
  select = true,
  replace = true,
  escape = true,
  reset = true,
}

local function command_key(command)
  return command.loopId .. "\0" .. command.cueId
end

local function duplicate_ack(acknowledgement)
  local duplicate = vim.deepcopy(acknowledgement)
  duplicate.outcome = "duplicate"
  return duplicate
end

local function fixed_escape()
  return vim.api.nvim_replace_termcodes("<Esc>", true, false, true)
end

local function fallback_status()
  return {
    mode = "normal",
    cursor = { row = 0, col = 0 },
    bufferSha256 = vim.fn.sha256(""),
  }
end

local function monotonic_now_ms()
  local uv = vim.uv or vim.loop
  return uv.hrtime() / 1000000
end

local function safe_id(value, key)
  if type(value) == "table" and type(value[key]) == "string" and #value[key] > 0 then
    return value[key]
  end
  return "invalid"
end

local function visual_end_column(line, end_col)
  if end_col <= 0 then
    return 0
  end

  local current = 0
  local previous = 0
  while current < end_col do
    previous = current
    local byte = line:byte(current + 1)
    if not byte then
      break
    elseif byte < 0x80 then
      current = current + 1
    elseif byte < 0xE0 then
      current = current + 2
    elseif byte < 0xF0 then
      current = current + 3
    else
      current = current + 4
    end
  end
  return previous
end

function Agent.new(options)
  options = options or {}
  assert(type(options.token) == "string" and #options.token >= 16, "agent token is required")

  return setmetatable({
    token = options.token,
    show_buffer = ShowBuffer.new({ ranges = options.ranges }),
    input = options.input or vim.api.nvim_input,
    normal_input = options.normal_input or function(keys)
      vim.api.nvim_feedkeys(keys, "ntx", false)
    end,
    defer = options.defer or vim.defer_fn,
    now = options.now or monotonic_now_ms,
    close_connection = options.close_connection or function() end,
    acknowledgements = {},
    acknowledgement_order = {},
    pending = {},
    loop_action_counts = {},
    loop_order = {},
    timers = {},
    disposed = false,
  }, Agent)
end

function Agent:dispatch(value, callback)
  assert(type(callback) == "function", "agent callback is required")
  if self.disposed then
    callback(self:make_ack(value, "failed", "agent-disposed"))
    return
  end

  local command, validation_error = protocol.validate_command(value, self.token)
  if not command then
    callback(self:make_ack(value, "rejected", validation_error))
    return
  end

  local key = command_key(command)
  local remembered = self.acknowledgements[key]
  if remembered then
    callback(duplicate_ack(remembered))
    return
  end

  local in_flight = self.pending[key]
  if in_flight then
    if #in_flight.duplicates >= MAX_PENDING_DUPLICATES then
      callback(self:make_ack(command, "rejected", "duplicate-limit"))
    else
      table.insert(in_flight.duplicates, callback)
    end
    return
  end

  if editor_actions[command.action.type] and not self:reserve_action(command.loopId) then
    callback(self:make_ack(command, "rejected", "action-limit"))
    return
  end

  self.pending[key] = { callback = callback, duplicates = {} }
  local completed = false
  local function finish(outcome, error_code)
    if completed then
      return
    end
    completed = true

    local pending = self.pending[key]
    self.pending[key] = nil
    if not pending then
      return
    end

    local acknowledgement = self:make_ack(command, outcome, error_code)
    self:remember(key, acknowledgement)
    pending.callback(acknowledgement)
    for _, duplicate_callback in ipairs(pending.duplicates) do
      duplicate_callback(duplicate_ack(acknowledgement))
    end
  end

  local ok = xpcall(function()
    self:execute(command, finish)
  end, debug.traceback)
  if not ok then
    finish("failed", "action-failed")
  end
end

function Agent:execute(command, finish)
  local action = command.action
  if action.type == "prepare" then
    local prepared, prepare_error = self.show_buffer:prepare(action.poem, action.expectedSha256)
    finish(prepared and "applied" or "rejected", prepare_error)
  elseif action.type == "status" then
    local status, status_error = self.show_buffer:status()
    finish(status and "applied" or "rejected", status_error)
  elseif action.type == "reset" then
    local reset, reset_error = self.show_buffer:reset()
    finish(reset and "applied" or "rejected", reset_error)
  elseif action.type == "replace" then
    local replaced, replace_error = self.show_buffer:replace(action.rangeId, action.text)
    finish(replaced and "applied" or "rejected", replace_error)
  elseif action.type == "select" then
    self:select_range(action.rangeId, finish)
  elseif action.type == "move" then
    self:move(action.keys, action["repeat"], finish)
  elseif action.type == "insert" then
    self:insert(action.text, action.charsPerSecond, finish)
  elseif action.type == "escape" then
    local activated, activation_error = self.show_buffer:activate()
    if not activated then
      finish("rejected", activation_error)
      return
    end
    self.normal_input(fixed_escape())
    self:later(function()
      finish("applied")
    end, 0)
  elseif action.type == "shutdown" then
    finish("applied")
    self.close_connection()
  end
end

function Agent:move(key, repeat_count, finish)
  local activated, activation_error = self.show_buffer:activate()
  if not activated then
    finish("rejected", activation_error)
    return
  end

  self.normal_input(fixed_escape())
  local remaining = repeat_count
  local function feed_chunk()
    if remaining <= 0 then
      self:later(function()
        finish("applied")
      end, 0)
      return
    end

    local count = math.min(remaining, MOVE_CHUNK_SIZE)
    self.normal_input(string.rep(key, count))
    remaining = remaining - count
    self:later(feed_chunk, 0)
  end
  feed_chunk()
end

function Agent:insert(text, chars_per_second, finish)
  local activated, activation_error = self.show_buffer:activate()
  if not activated then
    finish("rejected", activation_error)
    return
  end

  local characters = vim.fn.split(text, "\\zs")
  local interval = chars_per_second == 0 and 0 or math.max(1, math.floor(1000 / chars_per_second))
  if interval * #characters > MAX_INSERT_DURATION_MS then
    finish("rejected", "insert-duration-too-long")
    return
  end

  local cursor = vim.api.nvim_win_get_cursor(0)
  local insertion_row = cursor[1] - 1
  local insertion_col = cursor[2]
  self.input("i")
  local started_at_ms = self.now()
  local index = 1
  local function feed_character()
    local character = characters[index]
    if not character then
      self.input(fixed_escape())
      if #characters > 0 then
        self.show_buffer:invalidate_ranges()
      end
      self:later(function()
        finish("applied")
      end, 0)
      return
    end

    if character == "\n" then
      vim.api.nvim_buf_set_text(activated, insertion_row, insertion_col, insertion_row, insertion_col, { "", "" })
      insertion_row = insertion_row + 1
      insertion_col = 0
      vim.api.nvim_win_set_cursor(0, { insertion_row + 1, 0 })
    else
      vim.api.nvim_buf_set_text(activated, insertion_row, insertion_col, insertion_row, insertion_col, { character })
      vim.api.nvim_win_set_cursor(0, { insertion_row + 1, insertion_col })
      insertion_col = insertion_col + #character
    end
    local target_ms = started_at_ms + index * interval
    index = index + 1
    local delay_ms = math.max(0, math.ceil(target_ms - self.now()))
    self:later(feed_character, delay_ms)
  end
  self:later(feed_character, 0)
end

function Agent:select_range(range_id, finish)
  local activated, activation_error = self.show_buffer:activate()
  if not activated then
    finish("rejected", activation_error)
    return
  end
  local range, range_error = self.show_buffer:get_range(range_id)
  if not range then
    finish("rejected", range_error)
    return
  end

  self.normal_input(fixed_escape())
  vim.api.nvim_win_set_cursor(0, { range.start_row + 1, range.start_col })
  self.normal_input("v")
  self:later(function()
    local lines = vim.api.nvim_buf_get_lines(activated, 0, -1, true)
    local end_row = range.end_row
    local end_col = range.end_col
    if end_col == 0 and end_row > range.start_row then
      end_row = end_row - 1
      end_col = #lines[end_row + 1]
    end
    local line = lines[end_row + 1] or ""
    vim.api.nvim_win_set_cursor(0, { end_row + 1, visual_end_column(line, end_col) })
    finish("applied")
  end, 0)
end

function Agent:make_ack(command, outcome, error_code)
  local status = self.show_buffer:status() or fallback_status()
  local acknowledgement = {
    schema = 1,
    loopId = safe_id(command, "loopId"),
    cueId = safe_id(command, "cueId"),
    outcome = outcome,
    mode = status.mode,
    cursor = status.cursor,
    bufferSha256 = status.bufferSha256,
  }
  if error_code then
    acknowledgement.errorCode = error_code
  end
  return acknowledgement
end

function Agent:remember(key, acknowledgement)
  self.acknowledgements[key] = vim.deepcopy(acknowledgement)
  table.insert(self.acknowledgement_order, key)
  if #self.acknowledgement_order > MAX_ACKNOWLEDGEMENTS then
    local oldest = table.remove(self.acknowledgement_order, 1)
    self.acknowledgements[oldest] = nil
  end
end

function Agent:reserve_action(loop_id)
  if self.loop_action_counts[loop_id] == nil then
    self.loop_action_counts[loop_id] = 0
    table.insert(self.loop_order, loop_id)
    if #self.loop_order > 2 then
      local oldest = table.remove(self.loop_order, 1)
      self.loop_action_counts[oldest] = nil
    end
  end

  local next_count = self.loop_action_counts[loop_id] + 1
  if next_count > MAX_ACTIONS_PER_LOOP then
    return false
  end
  self.loop_action_counts[loop_id] = next_count
  return true
end

function Agent:later(callback, delay_ms)
  if self.disposed then
    return
  end

  local handle
  handle = self.defer(function()
    if handle then
      self.timers[handle] = nil
    end
    if not self.disposed then
      callback()
    end
  end, delay_ms)
  if handle then
    self.timers[handle] = true
  end
end

function Agent:buffer_number()
  return self.show_buffer:number()
end

function Agent:dispose()
  if self.disposed then
    return
  end
  self.disposed = true
  for handle, _ in pairs(self.timers) do
    pcall(function()
      handle:stop()
      if not handle:is_closing() then
        handle:close()
      end
    end)
  end
  self.timers = {}
  self.pending = {}
  self.show_buffer:dispose()
end

return {
  new = Agent.new,
}
