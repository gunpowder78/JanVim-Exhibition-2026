local protocol = require("janvim_exhibition.protocol")
local actions = require("janvim_exhibition.actions")

local M = {}
local Connection = {}
Connection.__index = Connection

local HOST = "127.0.0.1"
local CONNECT_TIMEOUT_MS = 1000
local MAX_QUEUED_COMMANDS = 32
local PARENT_RECHECK_DELAY_MS = 100
local MAX_PARENT_RECHECKS = 20

local function valid_port(value)
  return type(value) == "number" and value % 1 == 0 and value >= 1 and value <= 65535
end

local function valid_token(value)
  return type(value) == "string"
    and #value >= 16
    and value:match("^[%w%._%-]+$") ~= nil
end

function M.setup(options)
  options = options or {}
  local port = tonumber(options.port or vim.env.JANVIM_EXHIBITION_PORT)
  local token = options.token or vim.env.JANVIM_EXHIBITION_TOKEN
  assert(valid_port(port), "JANVIM_EXHIBITION_PORT must be an integer from 1 to 65535")
  assert(valid_token(token), "JANVIM_EXHIBITION_TOKEN format is invalid")

  local uv = options.uv or vim.uv or vim.loop
  assert(uv and type(uv.new_tcp) == "function" and type(uv.new_timer) == "function", "Neovim uv TCP support is required")
  local schedule_wrap = options.schedule_wrap or vim.schedule_wrap
  local parent_pid = options.parent_pid or uv.os_getppid()
  assert(type(parent_pid) == "number" and parent_pid % 1 == 0 and parent_pid > 0,
    "JanVim parent PID is required")
  local parent_alive = options.parent_alive or function(pid)
    local ok, result, _, error_name = pcall(uv.kill, pid, 0)
    if not ok then
      return nil
    end
    if result == 0 then
      return true
    end
    if result == nil and error_name == "ESRCH" then
      return false
    end
    return nil
  end
  local schedule = options.schedule or vim.schedule
  local defer = options.defer or vim.defer_fn
  local exit_backend = options.exit_backend or function()
    vim.cmd("qaall!")
  end
  assert(type(parent_alive) == "function", "JanVim parent liveness check is required")
  assert(type(schedule) == "function", "Neovim scheduler is required")
  assert(type(defer) == "function", "Neovim deferred scheduler is required")
  assert(type(exit_backend) == "function", "Neovim backend exit is required")

  local self = setmetatable({
    port = port,
    token = token,
    uv = uv,
    schedule_wrap = schedule_wrap,
    tcp = assert(uv.new_tcp()),
    connect_timer = nil,
    receive_buffer = "",
    queue = {},
    busy = false,
    connected = false,
    transport_closed = false,
    disposed = false,
    parent_pid = parent_pid,
    parent_alive = parent_alive,
    schedule = schedule,
    defer = defer,
    exit_backend = exit_backend,
    shutdown_requested = false,
    shutdown_probe_started = false,
    parent_recheck_scheduled = false,
    backend_exit_scheduled = false,
  }, Connection)

  self.agent = options.agent or actions.new({
    token = token,
    ranges = options.ranges,
    close_connection = function()
      self.shutdown_requested = true
    end,
  })
  self:start()
  return self
end

function Connection:start()
  local timer = assert(self.uv.new_timer())
  self.connect_timer = timer
  timer:start(CONNECT_TIMEOUT_MS, 0, self.schedule_wrap(function()
    self:close_transport()
  end))

  self.tcp:connect(HOST, self.port, self.schedule_wrap(function(error_message)
    if error_message then
      self:close_transport()
      return
    end

    self:stop_connect_timer()
    self.connected = true
    local hello = vim.json.encode({ schema = 1, type = "hello", token = self.token }) .. "\n"
    self.tcp:write(hello, self.schedule_wrap(function(write_error)
      if write_error then
        self:close_transport()
      end
    end))
    if self.transport_closed then
      return
    end
    self.tcp:read_start(self.schedule_wrap(function(read_error, chunk)
      self:receive(read_error, chunk)
    end))
  end))
end

function Connection:receive(error_message, chunk)
  if self.transport_closed then
    return
  end
  if error_message or chunk == nil then
    self:close_transport()
    return
  end

  self.receive_buffer = self.receive_buffer .. chunk
  while true do
    local newline = self.receive_buffer:find("\n", 1, true)
    if not newline then
      if #self.receive_buffer > protocol.MAX_LINE_BYTES then
        self:close_transport()
      end
      break
    end
    if newline - 1 > protocol.MAX_LINE_BYTES then
      self:close_transport()
      return
    end

    local line = self.receive_buffer:sub(1, newline - 1)
    self.receive_buffer = self.receive_buffer:sub(newline + 1)
    if #line == 0 or #self.queue >= MAX_QUEUED_COMMANDS then
      self:close_transport()
      return
    end
    table.insert(self.queue, line)
  end
  self:pump()
end

function Connection:pump()
  if self.transport_closed or self.busy or #self.queue == 0 then
    return
  end

  local line = table.remove(self.queue, 1)
  local command = protocol.decode_line(line, self.token)
  if not command then
    self:close_transport()
    return
  end

  self.busy = true
  local ok = pcall(function()
    self.agent:dispatch(command, function(acknowledgement)
      if self.transport_closed then
        self.busy = false
        return
      end

      local encoded = protocol.encode_ack(acknowledgement)
      self.tcp:write(encoded, self.schedule_wrap(function(write_error)
        self.busy = false
        if write_error then
          self:close_transport()
        elseif not self:complete_requested_shutdown() then
          self:pump()
        end
      end))
    end)
  end)
  if not ok then
    self.busy = false
    self:close_transport()
  end
end

function Connection:complete_requested_shutdown()
  if not self.shutdown_requested then
    return false
  end
  self:close_transport()
  if not self.shutdown_probe_started then
    self.shutdown_probe_started = true
    self:probe_parent_after_shutdown(MAX_PARENT_RECHECKS)
  end
  return true
end

function Connection:probe_parent_after_shutdown(remaining_rechecks)
  if self.disposed or self.backend_exit_scheduled then
    return
  end
  local ok, alive = pcall(self.parent_alive, self.parent_pid)
  if ok and alive == false and not self.backend_exit_scheduled then
    self.backend_exit_scheduled = true
    self.schedule(function()
      pcall(self.exit_backend)
    end)
  elseif remaining_rechecks > 0
      and not self.parent_recheck_scheduled then
    self.parent_recheck_scheduled = true
    local fired = false
    self.defer(function()
      if fired then
        return
      end
      fired = true
      self.parent_recheck_scheduled = false
      self:probe_parent_after_shutdown(remaining_rechecks - 1)
    end, PARENT_RECHECK_DELAY_MS)
  end
end

function Connection:stop_connect_timer()
  local timer = self.connect_timer
  self.connect_timer = nil
  if not timer then
    return
  end

  pcall(function()
    timer:stop()
    if not timer:is_closing() then
      timer:close()
    end
  end)
end

function Connection:close_transport()
  if self.transport_closed then
    return
  end
  self.transport_closed = true
  self.connected = false
  self.busy = false
  self.queue = {}
  self.receive_buffer = ""
  self:stop_connect_timer()

  pcall(function()
    self.tcp:read_stop()
  end)
  pcall(function()
    if not self.tcp:is_closing() then
      self.tcp:close()
    end
  end)
end

function Connection:diagnostics()
  return {
    connected = self.connected,
    closed = self.transport_closed,
    busy = self.busy,
    queuedCommands = #self.queue,
  }
end

function Connection:close()
  if self.disposed then
    return
  end
  self.disposed = true
  self:close_transport()
  self.agent:dispose()
end

return M
