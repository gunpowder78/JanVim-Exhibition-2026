local Observer = {}
Observer.__index = Observer

local MOVEMENT = { move = true, insert = true, select = true }
local INTERVAL_MS = 125
local MAX_SEQUENCE = 2147483647

local function bounded_integer(value, minimum, maximum)
  return type(value) == "number" and value % 1 == 0 and value >= minimum and value <= maximum
end

local function position(buffer_number)
  -- Never activate a buffer (or hash its text) to obtain an optional observation.
  if not buffer_number or not vim.api.nvim_buf_is_valid(buffer_number)
      or vim.api.nvim_get_current_buf() ~= buffer_number then
    return nil
  end
  local cursor = vim.api.nvim_win_get_cursor(0)
  local row = cursor[1] - 1
  local line = vim.api.nvim_buf_get_lines(buffer_number, row, row + 1, true)[1]
  if not line then return nil end
  local cell_col = vim.fn.strdisplaywidth(line:sub(1, cursor[2]))
  if not bounded_integer(row, 0, 1000000) or not bounded_integer(cell_col, 0, 1000000) then
    return nil
  end
  return { row = row, cellCol = cell_col }
end

local function clamp(value, size)
  return math.max(0, math.min(value, size - 1))
end

function Observer.new(options)
  return setmetatable({
    now = options.now,
    on_cursor = options.on_cursor,
    seq = 0,
    last_sent_ms = -math.huge,
  }, Observer)
end

function Observer:begin(command, buffer_number)
  self:clear()
  if not MOVEMENT[command.action.type] then return end
  self.context = { loopId = command.loopId, cueId = command.cueId, started_at_ms = self.now() }
  self:rebase(buffer_number)
end

function Observer:rebase(buffer_number)
  self.previous = position(buffer_number)
end

function Observer:sample(buffer_number)
  if not self.context or not self.on_cursor then return end
  local current = position(buffer_number)
  if not current then
    self.previous = nil
    return
  end
  local previous = self.previous
  self.previous = current
  if not previous or (previous.row == current.row and previous.cellCol == current.cellCol) then return end
  local now = self.now()
  local elapsed_ms = now - self.context.started_at_ms
  if not (elapsed_ms >= 0 and elapsed_ms <= 2000) or now - self.last_sent_ms < INTERVAL_MS
      or self.seq >= MAX_SEQUENCE then return end

  local window = vim.api.nvim_get_current_win()
  -- Buffer offsets cannot account for wrapped rows or preceding wrapped lines.
  -- These window-relative cursor APIs also update Neovim's pending viewport scroll.
  local view_row = vim.fn.winline() - 1
  local view_col = vim.fn.wincol() - 1
  local rows = vim.api.nvim_win_get_height(window)
  local info = vim.fn.getwininfo(window)[1]
  local cols = vim.api.nvim_win_get_width(window) - info.textoff
  if not bounded_integer(rows, 1, 65536) or not bounded_integer(cols, 1, 65536) then return end
  local event = {
    schema = 1, type = "cursor", loopId = self.context.loopId, cueId = self.context.cueId,
    seq = self.seq + 1, elapsedMs = elapsed_ms, row = current.row, cellCol = current.cellCol,
    viewRow = clamp(view_row, rows),
    viewCol = clamp(view_col - info.textoff, cols), rows = rows, cols = cols,
  }
  if #vim.json.encode(event) > 1024 then return end
  self.seq = event.seq
  self.last_sent_ms = now
  pcall(self.on_cursor, event)
end

function Observer:clear()
  self.context = nil
  self.previous = nil
end

function Observer:dispose()
  self:clear()
  self.on_cursor = nil
end

return Observer
