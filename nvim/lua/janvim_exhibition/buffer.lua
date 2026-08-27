local Buffer = {}
Buffer.__index = Buffer

local function split_lines(text)
  return vim.split(text, "\n", { plain = true })
end

local function is_integer(value)
  return type(value) == "number" and value == value and value % 1 == 0
end

local function copy_range(value)
  return {
    start_row = value.start_row,
    start_col = value.start_col,
    end_row = value.end_row,
    end_col = value.end_col,
  }
end

local function valid_position(lines, row, col)
  return is_integer(row)
    and is_integer(col)
    and row >= 0
    and row < #lines
    and col >= 0
    and col <= #lines[row + 1]
end

local function valid_range(lines, value)
  if type(value) ~= "table" then
    return false
  end
  if not valid_position(lines, value.start_row, value.start_col) then
    return false
  end
  if not valid_position(lines, value.end_row, value.end_col) then
    return false
  end
  if value.start_row > value.end_row then
    return false
  end
  if value.start_row == value.end_row and value.start_col >= value.end_col then
    return false
  end
  return true
end

local function validate_ranges(lines, templates)
  local ranges = {}
  for name, value in pairs(templates) do
    if type(name) ~= "string" or #name == 0 or not valid_range(lines, value) then
      return nil
    end
    ranges[name] = copy_range(value)
  end
  return ranges
end

function Buffer.new(options)
  options = options or {}
  return setmetatable({
    range_templates = vim.deepcopy(options.ranges or {}),
    ranges = {},
    buffer = nil,
    snapshot = nil,
    snapshot_hash = nil,
  }, Buffer)
end

function Buffer:prepare(poem, expected_hash)
  if type(poem) ~= "string" or #poem == 0 then
    return nil, "invalid-poem"
  end
  if vim.fn.sha256(poem) ~= expected_hash then
    return nil, "hash-mismatch"
  end

  local lines = split_lines(poem)
  local ranges = validate_ranges(lines, self.range_templates)
  if not ranges then
    return nil, "invalid-range-map"
  end

  local new_buffer = vim.api.nvim_create_buf(false, true)
  local ok, error_message = pcall(function()
    vim.api.nvim_set_option_value("buftype", "nofile", { buf = new_buffer })
    vim.api.nvim_set_option_value("bufhidden", "hide", { buf = new_buffer })
    vim.api.nvim_set_option_value("swapfile", false, { buf = new_buffer })
    vim.api.nvim_set_option_value("undofile", false, { buf = new_buffer })
    vim.api.nvim_set_option_value("undolevels", -1, { buf = new_buffer })
    vim.api.nvim_set_option_value("modifiable", true, { buf = new_buffer })
    vim.api.nvim_buf_set_lines(new_buffer, 0, -1, true, lines)
    vim.api.nvim_set_option_value("modified", false, { buf = new_buffer })
    vim.api.nvim_set_current_buf(new_buffer)
  end)
  if not ok then
    if vim.api.nvim_buf_is_valid(new_buffer) then
      vim.api.nvim_buf_delete(new_buffer, { force = true })
    end
    return nil, "buffer-create-failed:" .. tostring(error_message)
  end

  local old_buffer = self.buffer
  self.buffer = new_buffer
  self.snapshot = poem
  self.snapshot_hash = expected_hash
  self.ranges = ranges

  if old_buffer and old_buffer ~= new_buffer and vim.api.nvim_buf_is_valid(old_buffer) then
    vim.api.nvim_buf_delete(old_buffer, { force = true })
  end
  return new_buffer
end

function Buffer:reset()
  if not self.snapshot or not self.snapshot_hash then
    return nil, "not-prepared"
  end
  return self:prepare(self.snapshot, self.snapshot_hash)
end

function Buffer:number()
  if self.buffer and vim.api.nvim_buf_is_valid(self.buffer) then
    return self.buffer
  end
  return nil
end

function Buffer:activate()
  local buffer_number = self:number()
  if not buffer_number then
    return nil, "not-prepared"
  end
  if vim.api.nvim_get_current_buf() ~= buffer_number then
    vim.api.nvim_set_current_buf(buffer_number)
  end
  return buffer_number
end

function Buffer:get_range(range_id)
  local value = self.ranges[range_id]
  if not value then
    return nil, "unknown-range"
  end
  return copy_range(value)
end

function Buffer:replace(range_id, text)
  local buffer_number, activation_error = self:activate()
  if not buffer_number then
    return nil, activation_error
  end
  local range, range_error = self:get_range(range_id)
  if not range then
    return nil, range_error
  end

  vim.api.nvim_buf_set_text(
    buffer_number,
    range.start_row,
    range.start_col,
    range.end_row,
    range.end_col,
    split_lines(text)
  )
  self:invalidate_ranges()
  return true
end

function Buffer:invalidate_ranges()
  self.ranges = {}
end

function Buffer:text()
  local buffer_number = self:number()
  if not buffer_number then
    return nil, "not-prepared"
  end
  return table.concat(vim.api.nvim_buf_get_lines(buffer_number, 0, -1, true), "\n")
end

function Buffer:status()
  local buffer_number, activation_error = self:activate()
  if not buffer_number then
    return nil, activation_error
  end

  local cursor = vim.api.nvim_win_get_cursor(0)
  local text = assert(self:text())
  return {
    mode = vim.api.nvim_get_mode().mode,
    cursor = { row = cursor[1] - 1, col = cursor[2] },
    bufferSha256 = vim.fn.sha256(text),
  }
end

function Buffer:dispose()
  local buffer_number = self:number()
  self.buffer = nil
  self.ranges = {}
  self.snapshot = nil
  self.snapshot_hash = nil
  if buffer_number and vim.api.nvim_buf_is_valid(buffer_number) then
    vim.api.nvim_buf_delete(buffer_number, { force = true })
  end
end

return Buffer
